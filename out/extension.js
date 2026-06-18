"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const cp = __importStar(require("child_process"));
const FALKON_EXTENSIONS = new Set([".flk"]);
let hasShownInSession = false;
let statusBarItem;
let welcomePanel;
function isFalkonFile(fsPath) {
    return FALKON_EXTENSIONS.has(path.extname(fsPath).toLowerCase());
}
async function buildAndRun(document) {
    const filePath = document.uri.fsPath;
    if (!isFalkonFile(filePath)) {
        return;
    }
    // Save the document first so the latest changes are compiled
    if (document.isDirty) {
        await document.save();
    }
    const folder = path.dirname(filePath);
    const fileName = path.parse(filePath).name;
    const isWindows = process.platform === "win32";
    const exeName = isWindows ? `${fileName}.exe` : fileName;
    // Always dispose and recreate terminal so cwd is always correct
    const existingTerminal = vscode.window.terminals.find((t) => t.name === "Falkon Run");
    if (existingTerminal) {
        existingTerminal.dispose();
    }
    const terminal = vscode.window.createTerminal({
        name: "Falkon Run",
        cwd: folder,
        shellPath: isWindows ? "powershell.exe" : undefined,
    });
    terminal.show(true);
    // Build and conditionally run (only if build succeeds)
    const buildCmd = `falkon build "${path.basename(filePath)}"`;
    const runCmd = isWindows ? `& ".\\${exeName}"` : `./"${exeName}"`;
    const fullCmd = isWindows
        ? `${buildCmd} ; if ($LASTEXITCODE -eq 0) { ${runCmd} }`
        : `${buildCmd} && ${runCmd}`;
    terminal.sendText(fullCmd);
}
class FalkonDebugConfigurationProvider {
    provideDebugConfigurations(folder, token) {
        return [{ type: "falkon", name: "Launch", request: "launch" }];
    }
    async resolveDebugConfiguration(folder, config, token) {
        const falkonConfig = vscode.workspace.getConfiguration("falkon");
        if (!falkonConfig.get("enableDebugIntercept", true)) {
            return undefined;
        }
        if (!config.type && !config.request && !config.name) {
            config.type = "falkon";
            config.name = "Launch";
            config.request = "launch";
        }
        const editor = vscode.window.activeTextEditor;
        if (editor && isFalkonFile(editor.document.uri.fsPath)) {
            await buildAndRun(editor.document);
        }
        else {
            vscode.window.showErrorMessage(editor ? "Active file is not a .flk file." : "No active Falkon file to run.");
        }
        return undefined;
    }
}
function checkFalkonInstallation(bar, showNotification) {
    return new Promise((resolve) => {
        cp.exec("falkon -v", (error, stdout, stderr) => {
            if (error) {
                bar.text = `$(alert) Falkon: CLI Missing`;
                bar.tooltip = `Falkon compiler not found in PATH. Click to verify.`;
                bar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
                if (showNotification) {
                    vscode.window.showErrorMessage("Falkon CLI not found in PATH. Please install it and add it to your system PATH.");
                }
                resolve(false);
            }
            else {
                const version = stdout.trim() || stderr.trim() || "unknown version";
                bar.text = `$(check) Falkon: Ready`;
                bar.tooltip = `Falkon compiler is ready.\nVersion: ${version}`;
                bar.backgroundColor = undefined;
                if (showNotification) {
                    vscode.window.showInformationMessage(`Falkon CLI is ready! (${version})`);
                }
                resolve(true);
            }
        });
    });
}
function activate(context) {
    console.log("Falkon extension activating...");
    // context.extension is guaranteed available in VS Code 1.74+ (we require 1.90+).
    // Using it directly is the most reliable way to get the exact extension ID and
    // version without path-comparison heuristics that can fail on Windows.
    const extensionId = context.extension.id.toLowerCase();
    const currentVersion = context.extension.packageJSON.version;
    console.log(`Falkon: extensionId = "${extensionId}", version = "${currentVersion}"`);
    // Status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = "falkon.checkCli";
    context.subscriptions.push(statusBarItem);
    // Debug configuration provider (intercepts F5 for .flk files)
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider("falkon", new FalkonDebugConfigurationProvider()));
    // Command: falkon.buildAndRun
    context.subscriptions.push(vscode.commands.registerCommand("falkon.buildAndRun", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage("No active editor.");
            return;
        }
        if (!isFalkonFile(editor.document.uri.fsPath)) {
            vscode.window.showWarningMessage("Active file is not a .flk Falkon source file.");
            return;
        }
        await buildAndRun(editor.document);
    }));
    const checkCompletionStatus = () => {
        const hasVerifiedCli = context.globalState.get("falkon.hasVerifiedCli", false);
        const hasOpenedSettings = context.globalState.get("falkon.hasOpenedSettings", false);
        if (hasVerifiedCli && hasOpenedSettings) {
            context.globalState.update("falkon.walkthroughCompleted", true);
        }
    };
    let hasPromptedThisSession = false;
    const triggerOnboardingPrompt = () => {
        if (hasPromptedThisSession) {
            return;
        }
        const isCompleted = context.globalState.get("falkon.walkthroughCompleted", false);
        const isDismissed = context.globalState.get("falkon.walkthroughPromptDismissed", false);
        if (!isCompleted && !isDismissed) {
            hasPromptedThisSession = true;
            vscode.window.showInformationMessage("Welcome to Falkon! Get started by verifying the compiler CLI and configuring your shortcuts.", "Open Walkthrough", "Don't Show Again").then((selection) => {
                if (selection === "Open Walkthrough") {
                    context.globalState.update("falkon.walkthroughPromptDismissed", true);
                    vscode.commands.executeCommand("falkon.showWalkthrough");
                }
                else if (selection === "Don't Show Again") {
                    context.globalState.update("falkon.walkthroughPromptDismissed", true);
                }
            });
        }
    };
    // Command: falkon.checkCli
    context.subscriptions.push(vscode.commands.registerCommand("falkon.checkCli", async () => {
        context.globalState.update("falkon.hasVerifiedCli", true);
        checkCompletionStatus();
        const existing = vscode.window.terminals.find((t) => t.name === "Falkon Check");
        if (existing) {
            existing.dispose();
        }
        const isWindows = process.platform === "win32";
        const checkTerminal = vscode.window.createTerminal({
            name: "Falkon Check",
            shellPath: isWindows ? "powershell.exe" : undefined,
        });
        checkTerminal.show(false);
        checkTerminal.sendText("falkon -v");
        if (statusBarItem) {
            await checkFalkonInstallation(statusBarItem, true);
        }
    }));
    // Command: falkon.openSettings
    context.subscriptions.push(vscode.commands.registerCommand("falkon.openSettings", () => {
        context.globalState.update("falkon.hasOpenedSettings", true);
        checkCompletionStatus();
        vscode.commands.executeCommand("workbench.action.openSettings", "falkon");
    }));
    // Command: falkon.showWalkthrough (opens our custom welcome webview)
    context.subscriptions.push(vscode.commands.registerCommand("falkon.showWalkthrough", () => {
        showWelcomeWebview(context);
    }));
    // Command: falkon.resetOnboarding
    context.subscriptions.push(vscode.commands.registerCommand("falkon.resetOnboarding", async () => {
        await context.globalState.update("falkon.hasVerifiedCli", undefined);
        await context.globalState.update("falkon.hasOpenedSettings", undefined);
        await context.globalState.update("falkon.walkthroughCompleted", undefined);
        await context.globalState.update("falkon.walkthroughPromptDismissed", undefined);
        hasPromptedThisSession = false;
        vscode.window.showInformationMessage("Falkon onboarding state has been reset.");
    }));
    // Listen for config changes to track shortcut configuration step completion
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("falkon.shortcutPreset") || e.affectsConfiguration("falkon.enableDebugIntercept")) {
            context.globalState.update("falkon.hasOpenedSettings", true);
            checkCompletionStatus();
        }
    }));
    // Status bar: show only when a .flk file is active
    const updateStatusBar = (editor) => {
        if (!statusBarItem) {
            return;
        }
        if (editor && isFalkonFile(editor.document.uri.fsPath)) {
            statusBarItem.show();
            triggerOnboardingPrompt();
        }
        else {
            statusBarItem.hide();
        }
    };
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));
    updateStatusBar(vscode.window.activeTextEditor);
    // Silent CLI check on activation to set initial status bar state
    checkFalkonInstallation(statusBarItem, false);
    // ─── Auto-open welcome page ────────────────────────────────────────────────
    const lastVersion = context.globalState.get("lastVersion");
    if (!hasShownInSession || lastVersion !== currentVersion) {
        hasShownInSession = true;
        context.globalState.update("lastVersion", currentVersion);
        console.log("Falkon: scheduling welcome page open");
        setTimeout(() => {
            console.log("Falkon: opening welcome page");
            showWelcomeWebview(context);
        }, 1000);
    }
}
function deactivate() { }
function showWelcomeWebview(context) {
    if (welcomePanel) {
        welcomePanel.reveal(vscode.ViewColumn.One);
        return;
    }
    welcomePanel = vscode.window.createWebviewPanel("falkonWelcome", "Welcome to Falkon", vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
            vscode.Uri.file(path.join(context.extensionPath, "resources")),
        ],
    });
    // Convert SVG paths to webview URIs
    const welcomeSvgUri = welcomePanel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, "resources", "images", "welcome.svg")));
    const verifyCliSvgUri = welcomePanel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, "resources", "images", "verify_cli.svg")));
    const configureShortcutSvgUri = welcomePanel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, "resources", "images", "configure_shortcut.svg")));
    // Load configuration
    const config = vscode.workspace.getConfiguration("falkon");
    const initialShortcutPreset = config.get("shortcutPreset", "f4");
    // Load initial HTML Content
    welcomePanel.webview.html = getWelcomeHtml(welcomeSvgUri, verifyCliSvgUri, configureShortcutSvgUri, initialShortcutPreset);
    // Function to update CLI status inside webview
    const updateCliStatusInWebview = (status, version) => {
        if (welcomePanel) {
            welcomePanel.webview.postMessage({
                command: "updateCliStatus",
                status: status,
                version: version || "",
            });
        }
    };
    // Perform initial background CLI check to update badge
    cp.exec("falkon -v", (error, stdout, stderr) => {
        if (error) {
            updateCliStatusInWebview("missing");
        }
        else {
            const version = stdout.trim() || stderr.trim() || "unknown";
            updateCliStatusInWebview("ready", version);
        }
    });
    // Handle messages from Webview
    welcomePanel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "verifyCli": {
                context.globalState.update("falkon.hasVerifiedCli", true);
                // Spawn the verify terminal
                const existing = vscode.window.terminals.find((t) => t.name === "Falkon Check");
                if (existing) {
                    existing.dispose();
                }
                const isWindows = process.platform === "win32";
                const checkTerminal = vscode.window.createTerminal({
                    name: "Falkon Check",
                    shellPath: isWindows ? "powershell.exe" : undefined,
                });
                checkTerminal.show(false);
                checkTerminal.sendText("falkon -v");
                // Check installation and send back result
                if (statusBarItem) {
                    const isInstalled = await checkFalkonInstallation(statusBarItem, true);
                    if (isInstalled) {
                        cp.exec("falkon -v", (error, stdout, stderr) => {
                            const version = stdout.trim() || stderr.trim() || "unknown";
                            updateCliStatusInWebview("ready", version);
                        });
                    }
                    else {
                        updateCliStatusInWebview("missing");
                    }
                }
                break;
            }
            case "changeShortcut": {
                const newPreset = message.preset;
                await vscode.workspace
                    .getConfiguration("falkon")
                    .update("shortcutPreset", newPreset, vscode.ConfigurationTarget.Global);
                context.globalState.update("falkon.hasOpenedSettings", true);
                break;
            }
            case "createFile": {
                // Create new main.flk
                let targetUri;
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    const rootPath = workspaceFolders[0].uri.fsPath;
                    const filePath = path.join(rootPath, "main.flk");
                    const fileUri = vscode.Uri.file(filePath);
                    const content = `# Falkon Source File\nprint("Hello from Falkon!")\n`;
                    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf8"));
                    targetUri = fileUri;
                }
                else {
                    // Open an untitled file
                    targetUri = vscode.Uri.parse("untitled:main.flk");
                }
                if (targetUri) {
                    const doc = await vscode.workspace.openTextDocument(targetUri);
                    await vscode.window.showTextDocument(doc);
                }
                // Close the welcome page
                if (welcomePanel) {
                    welcomePanel.dispose();
                }
                break;
            }
            case "close": {
                if (welcomePanel) {
                    welcomePanel.dispose();
                }
                break;
            }
        }
    }, undefined, context.subscriptions);
    // Sync settings configuration changes
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (welcomePanel && e.affectsConfiguration("falkon.shortcutPreset")) {
            const currentPreset = vscode.workspace
                .getConfiguration("falkon")
                .get("shortcutPreset", "f4");
            welcomePanel.webview.postMessage({
                command: "updateSettings",
                shortcutPreset: currentPreset,
            });
        }
    });
    welcomePanel.onDidDispose(() => {
        welcomePanel = undefined;
        configListener.dispose();
    });
}
function getWelcomeHtml(welcomeSvgUri, verifyCliSvgUri, configureShortcutSvgUri, initialShortcutPreset) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Falkon</title>
  <style>
    body {
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      padding: 40px 24px;
      margin: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      box-sizing: border-box;
    }
    .container {
      max-width: 800px;
      width: 100%;
      animation: fadeIn 0.8s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .header {
      text-align: center;
      margin-bottom: 48px;
    }
    .logo {
      width: 128px;
      height: 128px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 36px;
      font-weight: 700;
      margin: 0 0 8px 0;
      letter-spacing: -0.5px;
    }
    .subtitle {
      font-size: 16px;
      opacity: 0.8;
      margin: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 24px;
      margin-bottom: 48px;
    }
    .card {
      background: var(--vscode-welcomePage-tileBackground, rgba(255, 255, 255, 0.03));
      border: 1px solid var(--vscode-welcomePage-tileBorder, rgba(255, 255, 255, 0.08));
      border-radius: 12px;
      padding: 28px 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      position: relative;
    }
    .card:hover {
      transform: translateY(-4px);
      border-color: var(--vscode-focusBorder, #007fd4);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    }
    .card-icon {
      width: 80px;
      height: 80px;
      margin-bottom: 16px;
    }
    .card h2 {
      font-size: 18px;
      margin: 0 0 12px 0;
      font-weight: 600;
    }
    .card p {
      font-size: 13px;
      line-height: 1.5;
      opacity: 0.7;
      margin: 0 0 24px 0;
      flex-grow: 1;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      font-size: 10px;
      font-weight: bold;
      border-radius: 20px;
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-checking {
      background-color: var(--vscode-statusBarItem-warningBackground, #c97a00);
      color: var(--vscode-statusBarItem-warningForeground, #ffffff);
    }
    .badge-ready {
      background-color: #00FF87;
      color: #121214;
    }
    .badge-missing {
      background-color: #FF5F56;
      color: #ffffff;
    }
    .btn {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      width: 100%;
      transition: background-color 0.2s;
      box-sizing: border-box;
    }
    .btn:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
      background-color: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.08));
      color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    }
    .btn-secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.12));
    }
    .select-input {
      background-color: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, rgba(255, 255, 255, 0.15));
      padding: 10px 12px;
      font-size: 13px;
      border-radius: 6px;
      width: 100%;
      cursor: pointer;
      outline: none;
      box-sizing: border-box;
    }
    .footer {
      display: flex;
      justify-content: center;
      align-items: center;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-top: 32px;
    }
    .footer-btn {
      max-width: 220px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img class="logo" src="${welcomeSvgUri}" alt="Falkon Logo" />
      <h1>Welcome to Falkon</h1>
      <p class="subtitle">Sleek, Python-compatible syntax highlighting and build tools for VS Code.</p>
    </div>

    <div class="grid">
      <!-- Card 1: Compiler Check -->
      <div class="card">
        <img class="card-icon" src="${verifyCliSvgUri}" alt="CLI Check" />
        <h2>Verify Compiler CLI</h2>
        <span id="cli-badge" class="status-badge badge-checking">Checking...</span>
        <p>The Falkon compiler (falkon) must be installed and added to your system's PATH configuration.</p>
        <button id="btn-verify" class="btn">Run Verification</button>
      </div>

      <!-- Card 2: Configuration -->
      <div class="card">
        <img class="card-icon" src="${configureShortcutSvgUri}" alt="Shortcut" />
        <h2>Build & Run Shortcut</h2>
        <span style="height: 16px; margin-bottom: 16px;"></span> <!-- Spacer to align with badge -->
        <p>Select your default keyboard shortcut preset to compile and execute Falkon files inside the editor.</p>
        <select id="select-shortcut" class="select-input">
          <option value="f4" ${initialShortcutPreset === "f4" ? "selected" : ""}>F4 (Default)</option>
          <option value="ctrl+f5" ${initialShortcutPreset === "ctrl+f5" ? "selected" : ""}>Ctrl + F5</option>
          <option value="f7" ${initialShortcutPreset === "f7" ? "selected" : ""}>F7</option>
          <option value="none" ${initialShortcutPreset === "none" ? "selected" : ""}>None (Disabled)</option>
        </select>
      </div>

      <!-- Card 3: New File -->
      <div class="card">
        <img class="card-icon" src="${welcomeSvgUri}" alt="Start Coding" />
        <h2>Start Coding</h2>
        <span style="height: 16px; margin-bottom: 16px;"></span> <!-- Spacer to align with badge -->
        <p>Initialize a new workspace with a sample template file and start compiling your Falkon projects.</p>
        <button id="btn-create-file" class="btn btn-secondary">Create main.flk</button>
      </div>
    </div>

    <div class="footer">
      <button id="btn-close" class="btn footer-btn">Finish Setup</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('btn-verify').addEventListener('click', () => {
      const badge = document.getElementById('cli-badge');
      badge.className = 'status-badge badge-checking';
      badge.innerText = 'Checking...';
      vscode.postMessage({ command: 'verifyCli' });
    });

    document.getElementById('select-shortcut').addEventListener('change', (e) => {
      vscode.postMessage({ command: 'changeShortcut', preset: e.target.value });
    });

    document.getElementById('btn-create-file').addEventListener('click', () => {
      vscode.postMessage({ command: 'createFile' });
    });

    document.getElementById('btn-close').addEventListener('click', () => {
      vscode.postMessage({ command: 'close' });
    });

    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'updateSettings':
          document.getElementById('select-shortcut').value = message.shortcutPreset;
          break;
        case 'updateCliStatus':
          const badge = document.getElementById('cli-badge');
          if (message.status === 'ready') {
            badge.className = 'status-badge badge-ready';
            badge.innerText = 'Ready (' + message.version + ')';
          } else {
            badge.className = 'status-badge badge-missing';
            badge.innerText = 'Missing CLI';
          }
          break;
      }
    });
  </script>
</body>
</html>`;
}
//# sourceMappingURL=extension.js.map