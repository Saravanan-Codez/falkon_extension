import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import * as fs from "fs";

const FALKON_EXTENSIONS = new Set([".flk"]);

function isFalkonFile(fsPath: string): boolean {
  return FALKON_EXTENSIONS.has(path.extname(fsPath).toLowerCase());
}

async function buildAndRun(document: vscode.TextDocument): Promise<void> {
  const filePath = document.uri.fsPath;
  if (!isFalkonFile(filePath)) {
    return;
  }

  // Save the document first to ensure the latest changes are built
  if (document.isDirty) {
    await document.save();
  }

  const folder = path.dirname(filePath);
  const fileName = path.parse(filePath).name;
  
  const isWindows = process.platform === "win32";
  const exeName = isWindows ? `${fileName}.exe` : fileName;
  
  // Find existing Falkon terminal or create a new one
  let terminal = vscode.window.terminals.find((t: vscode.Terminal) => t.name === "Falkon Run");
  if (!terminal) {
    terminal = vscode.window.createTerminal({
      name: "Falkon Run",
      cwd: folder,
      // Ensure we use PowerShell on Windows if specifically requested or available
      shellPath: isWindows ? "powershell.exe" : undefined
    });
  }

  terminal.show(true); // Show terminal but preserve focus in the editor

  // Build the command: falkon build <file> ; .\<exe>
  // PowerShell uses ; for command chaining. Newer PS also supports &&.
  const buildCmd = `falkon build "${path.basename(filePath)}"`;
  const runCmd = isWindows ? `.\\"${exeName}"` : `./"${exeName}"`;
  
  // On Windows PowerShell, we use ; to chain commands reliably across versions.
  const fullCmd = isWindows 
    ? `${buildCmd} ; ${runCmd}` 
    : `${buildCmd} && ${runCmd}`;

  terminal.sendText(fullCmd);
}

class FalkonDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
  /**
   * Provide initial debug configurations.
   */
  provideDebugConfigurations(
    folder: vscode.WorkspaceFolder | undefined,
    token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    return [
      {
        type: 'falkon',
        name: 'Launch',
        request: 'launch'
      }
    ];
  }

  /**
   * Massage a debug configuration before it is used to launch a debug session.
   */
  async resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    token?: vscode.CancellationToken
  ): Promise<vscode.DebugConfiguration | undefined> {
    console.log("Falkon Debug: resolveDebugConfiguration called", config);
    
    const falkonConfig = vscode.workspace.getConfiguration("falkon");
    const enableDebugIntercept = falkonConfig.get<boolean>("enableDebugIntercept", true);

    if (!enableDebugIntercept) {
      console.log("Falkon Debug: Intercept disabled in settings.");
      return undefined;
    }

    // If no config is provided (e.g. F5 without launch.json), we provide a default one
    if (!config.type && !config.request && !config.name) {
      console.log("Falkon Debug: Config is empty, providing defaults");
      config.type = 'falkon';
      config.name = 'Launch';
      config.request = 'launch';
    }

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      console.log("Falkon Debug: Active editor path:", editor.document.uri.fsPath);
      if (isFalkonFile(editor.document.uri.fsPath)) {
        console.log("Falkon Debug: Is a Falkon file, calling buildAndRun");
        await buildAndRun(editor.document);
      } else {
        console.log("Falkon Debug: NOT a Falkon file");
        vscode.window.showErrorMessage("Active file is not a .flk file.");
      }
    } else {
      console.log("Falkon Debug: No active editor");
      vscode.window.showErrorMessage("No active Falkon file to run.");
    }

    return undefined; // Abort the actual debug session launch as we handle it via terminal
  }
}

export function activate(context: vscode.ExtensionContext): void {
  console.log("Falkon extension is now active!");

  // Register the debug configuration provider
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider('falkon', new FalkonDebugConfigurationProvider())
  );

  const runCommand = vscode.commands.registerCommand("falkon.buildAndRun", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active editor found.");
      return;
    }

    if (!isFalkonFile(editor.document.uri.fsPath)) {
      vscode.window.showWarningMessage("Active file is not a Falkon source file.");
      return;
    }

    await buildAndRun(editor.document);
  });

  context.subscriptions.push(runCommand);
}

export function deactivate(): void {}
