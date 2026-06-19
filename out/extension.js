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
const fs = __importStar(require("fs"));
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
    let terminal;
    try {
        terminal = vscode.window.createTerminal({
            name: "Falkon Run",
            cwd: folder,
            shellPath: isWindows ? "powershell.exe" : undefined,
        });
    }
    catch (error) {
        console.warn("Falkon: Failed to create terminal with powershell.exe, falling back to default shell.", error);
        terminal = vscode.window.createTerminal({
            name: "Falkon Run",
            cwd: folder,
        });
    }
    terminal.show(true);
    // Build and conditionally run (only if build succeeds)
    const buildCmd = `falkon build "${path.basename(filePath)}"`;
    const runCmd = isWindows ? `& ".\\${exeName}"` : `./"${exeName}"`;
    const fullCmd = isWindows
        ? `${buildCmd} ; if ($LASTEXITCODE -eq 0) { ${runCmd} }`
        : `${buildCmd} && ${runCmd}`;
    // Show status bar feedback for compilation/running
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = `$(sync~spin) Falkon: Building & Running "${path.basename(filePath)}"...`;
    statusBarItem.tooltip = "Click to focus build terminal";
    statusBarItem.command = "workbench.action.terminal.focus";
    statusBarItem.show();
    setTimeout(() => {
        statusBarItem.dispose();
    }, 4000);
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
        cp.exec("falkon -v", { timeout: 5000 }, (error, stdout, stderr) => {
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
    const markerPath = path.join(context.extensionPath, ".installed_marker");
    let isFreshInstall = false;
    try {
        if (!fs.existsSync(markerPath)) {
            isFreshInstall = true;
            fs.writeFileSync(markerPath, "installed", "utf8");
        }
    }
    catch (err) {
        console.error("Falkon: Failed to check/write install marker", err);
    }
    if (isFreshInstall) {
        console.log("Falkon: Fresh installation detected. Resetting onboarding state...");
        context.globalState.update("falkon.hasVerifiedCli", undefined);
        context.globalState.update("falkon.hasOpenedSettings", undefined);
        context.globalState.update("falkon.walkthroughCompleted", undefined);
        context.globalState.update("falkon.walkthroughPromptDismissed", undefined);
    }
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
        checkCompletionStatus(context);
        if (statusBarItem) {
            await checkFalkonInstallation(statusBarItem, true);
        }
    }));
    // Command: falkon.openSettings
    context.subscriptions.push(vscode.commands.registerCommand("falkon.openSettings", () => {
        context.globalState.update("falkon.hasOpenedSettings", true);
        checkCompletionStatus(context);
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
        if (welcomePanel) {
            welcomePanel.webview.postMessage({ command: "resetProgress" });
        }
        else {
            showWelcomeWebview(context);
        }
        vscode.window.showInformationMessage("Falkon onboarding state has been reset.");
    }));
    // Listen for config changes to track shortcut configuration step completion
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("falkon.shortcutPreset") || e.affectsConfiguration("falkon.enableDebugIntercept")) {
            context.globalState.update("falkon.hasOpenedSettings", true);
            checkCompletionStatus(context);
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
    // If version changes (update scenario), reset completion states so onboarding runs again
    if (lastVersion && lastVersion !== currentVersion) {
        context.globalState.update("falkon.walkthroughCompleted", undefined);
        context.globalState.update("falkon.hasVerifiedCli", undefined);
        context.globalState.update("falkon.hasOpenedSettings", undefined);
    }
    const isCompleted = context.globalState.get("falkon.walkthroughCompleted", false);
    if (!isCompleted && (!hasShownInSession || lastVersion !== currentVersion)) {
        hasShownInSession = true;
        context.globalState.update("lastVersion", currentVersion);
        console.log("Falkon: scheduling welcome page open");
        setTimeout(() => {
            console.log("Falkon: opening welcome page");
            showWelcomeWebview(context);
        }, 1000);
    }
    // Register Webview Serializer to restore the Welcome tab on VS Code restart
    if (vscode.window.registerWebviewPanelSerializer) {
        vscode.window.registerWebviewPanelSerializer("falkonWelcome", {
            async deserializeWebviewPanel(webviewPanel, state) {
                setupWelcomeWebview(webviewPanel, context);
            }
        });
    }
}
function deactivate() { }
function setupWelcomeWebview(panel, context) {
    welcomePanel = panel;
    // Convert SVG paths to webview URIs
    const welcomeSvgUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, "falkon 128x128.svg")));
    const verifyCliSvgUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, "resources", "images", "verify_cli.svg")));
    const configureShortcutSvgUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, "resources", "images", "configure_shortcut.svg")));
    // Load configuration
    const config = vscode.workspace.getConfiguration("falkon");
    const initialShortcutPreset = config.get("shortcutPreset", "f4");
    const hasVerifiedCli = context.globalState.get("falkon.hasVerifiedCli", false);
    const hasOpenedSettings = context.globalState.get("falkon.hasOpenedSettings", false);
    // Load HTML Content with CSP source
    panel.webview.html = getWelcomeHtml(welcomeSvgUri, verifyCliSvgUri, configureShortcutSvgUri, initialShortcutPreset, hasVerifiedCli, hasOpenedSettings, panel.webview.cspSource);
    // Function to update CLI status inside webview
    const updateCliStatusInWebview = (status, version, isVerification) => {
        panel.webview.postMessage({
            command: "updateCliStatus",
            status: status,
            version: version || "",
            isVerification: !!isVerification
        });
    };
    // Perform initial background CLI check to update badge silently (does NOT set isVerification = true)
    cp.exec("falkon -v", { timeout: 5000 }, (error, stdout, stderr) => {
        if (error) {
            updateCliStatusInWebview("missing", undefined, false);
        }
        else {
            const version = stdout.trim() || stderr.trim() || "unknown";
            updateCliStatusInWebview("ready", version, false);
        }
    });
    // Handle messages from Webview
    const messageListener = panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "verifyCli": {
                context.globalState.update("falkon.hasVerifiedCli", true);
                // Check installation and send back result
                if (statusBarItem) {
                    const isInstalled = await checkFalkonInstallation(statusBarItem, true);
                    if (isInstalled) {
                        context.globalState.update("falkon.hasVerifiedCli", true);
                        checkCompletionStatus(context);
                        cp.exec("falkon -v", { timeout: 5000 }, (error, stdout, stderr) => {
                            const version = stdout.trim() || stderr.trim() || "unknown";
                            updateCliStatusInWebview("ready", version, true);
                        });
                    }
                    else {
                        updateCliStatusInWebview("missing", undefined, true);
                    }
                }
                break;
            }
            case "checkCliSilent": {
                if (statusBarItem) {
                    checkFalkonInstallation(statusBarItem, false).then((isInstalled) => {
                        if (isInstalled) {
                            cp.exec("falkon -v", { timeout: 5000 }, (error, stdout, stderr) => {
                                const version = stdout.trim() || stderr.trim() || "unknown";
                                updateCliStatusInWebview("ready", version, false);
                            });
                        }
                        else {
                            updateCliStatusInWebview("missing", undefined, false);
                        }
                    });
                }
                break;
            }
            case "shortcutInteracted": {
                context.globalState.update("falkon.hasOpenedSettings", true);
                checkCompletionStatus(context);
                break;
            }
            case "changeShortcut": {
                const newPreset = message.preset;
                await vscode.workspace
                    .getConfiguration("falkon")
                    .update("shortcutPreset", newPreset, vscode.ConfigurationTarget.Global);
                context.globalState.update("falkon.hasOpenedSettings", true);
                checkCompletionStatus(context);
                break;
            }
            case "createFile": {
                // Create new hello.flk safely
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    const rootPath = workspaceFolders[0].uri.fsPath;
                    const filePath = path.join(rootPath, "hello.flk");
                    const fileUri = vscode.Uri.file(filePath);
                    // Safety Check: Check if hello.flk already exists before writing
                    try {
                        await vscode.workspace.fs.stat(fileUri);
                        // File exists, skip writing template to prevent data loss
                    }
                    catch {
                        // File does not exist, safe to write template content
                        const content = `# Falkon Source File\nprint("Hello from Falkon!")\n`;
                        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, "utf8"));
                    }
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    await vscode.window.showTextDocument(doc);
                }
                else {
                    // Open an untitled file with default content
                    const content = `# Falkon Source File\nprint("Hello from Falkon!")\n`;
                    const doc = await vscode.workspace.openTextDocument({
                        content: content,
                        language: "falkon"
                    });
                    await vscode.window.showTextDocument(doc);
                }
                break;
            }
            case "close": {
                context.globalState.update("falkon.walkthroughCompleted", true);
                panel.dispose();
                break;
            }
            case "skip": {
                context.globalState.update("falkon.walkthroughCompleted", true);
                panel.dispose();
                break;
            }
        }
    }, undefined, context.subscriptions);
    // Sync settings configuration changes
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("falkon.shortcutPreset") || e.affectsConfiguration("falkon.enableDebugIntercept")) {
            const currentPreset = vscode.workspace
                .getConfiguration("falkon")
                .get("shortcutPreset", "f4");
            panel.webview.postMessage({
                command: "updateSettings",
                shortcutPreset: currentPreset,
            });
        }
    });
    panel.onDidDispose(() => {
        if (welcomePanel === panel) {
            welcomePanel = undefined;
        }
        messageListener.dispose();
        configListener.dispose();
    });
}
function showWelcomeWebview(context) {
    if (welcomePanel) {
        welcomePanel.dispose();
    }
    const panel = vscode.window.createWebviewPanel("falkonWelcome", "Welcome to Falkon", vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
            context.extensionUri,
        ],
    });
    setupWelcomeWebview(panel, context);
}
function getWelcomeHtml(welcomeSvgUri, verifyCliSvgUri, configureShortcutSvgUri, initialShortcutPreset, initialVerifiedCli, initialOpenedSettings, cspSource) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; script-src 'unsafe-inline' ${cspSource}; style-src 'unsafe-inline' ${cspSource} https://fonts.googleapis.com https://fonts.gstatic.com; font-src https://fonts.gstatic.com;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Falkon</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body {
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: 'Outfit', var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
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
      max-width: 860px;
      width: 100%;
      animation: fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
    }
    .logo {
      width: 120px;
      height: 120px;
      margin-bottom: 20px;
      border-radius: 50%;
      border: 3px solid rgba(138, 43, 226, 0.4);
      box-shadow: 0 0 20px rgba(138, 43, 226, 0.3);
      object-fit: cover;
      overflow: hidden;
      filter: drop-shadow(0 8px 16px rgba(138, 43, 226, 0.25));
      animation: float 4s ease-in-out infinite;
    }
    @keyframes float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-6px) rotate(1deg); }
    }
    h1 {
      font-size: 36px;
      font-weight: 800;
      margin: 0 0 12px 0;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #A855F7, #06B6D4);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      font-size: 16px;
      opacity: 0.75;
      margin: 0 auto;
      max-width: 600px;
      line-height: 1.5;
    }
    .progress-section {
      background: var(--vscode-welcomePage-tileBackground, rgba(255, 255, 255, 0.02));
      border: 1px solid var(--vscode-welcomePage-tileBorder, rgba(255, 255, 255, 0.08));
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px 32px;
      margin-bottom: 40px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    }
    .progress-text {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      letter-spacing: 0.5px;
    }
    .progress-bar {
      height: 8px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 20px;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #8A2BE2, #00FFFF, #8A2BE2);
      background-size: 200% auto;
      width: 0%;
      transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
      animation: gradientShift 4s linear infinite;
    }
    @keyframes gradientShift {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    .checklist {
      display: flex;
      gap: 36px;
      justify-content: center;
    }
    .check-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      opacity: 0.4;
      transition: all 0.4s ease;
    }
    .check-item.completed {
      opacity: 1;
      color: #00FF87;
      font-weight: 600;
      text-shadow: 0 0 10px rgba(0, 255, 135, 0.2);
    }
    .check-item .check-icon {
      font-size: 16px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 28px;
      margin-bottom: 40px;
    }
    .card {
      background: var(--vscode-welcomePage-tileBackground, rgba(255, 255, 255, 0.03));
      border: 1px solid var(--vscode-welcomePage-tileBorder, rgba(255, 255, 255, 0.08));
      border-radius: 16px;
      padding: 36px 28px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, rgba(138, 43, 226, 0.03) 0%, rgba(0, 255, 255, 0.03) 100%);
      opacity: 0;
      transition: opacity 0.4s ease;
      z-index: 0;
    }
    .card:hover::before {
      opacity: 1;
    }
    .card > * {
      position: relative;
      z-index: 1;
    }
    .card:hover {
      transform: translateY(-8px);
      border-color: rgba(0, 255, 255, 0.35);
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.25), 0 0 20px rgba(138, 43, 226, 0.1);
    }
    .card-icon {
      width: 80px;
      height: 80px;
      margin-bottom: 20px;
      transition: transform 0.4s ease;
      filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15));
    }
    .logo-icon {
      border-radius: 50%;
      border: 2px solid rgba(138, 43, 226, 0.4);
      box-shadow: 0 0 10px rgba(138, 43, 226, 0.3);
      object-fit: cover;
      overflow: hidden;
    }
    .card:hover .card-icon {
      transform: scale(1.08);
    }
    .card h2 {
      font-size: 18px;
      margin: 0 0 12px 0;
      font-weight: 700;
      letter-spacing: -0.25px;
    }
    .card p {
      font-size: 13px;
      line-height: 1.6;
      opacity: 0.7;
      margin: 0 0 24px 0;
      flex-grow: 1;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      font-size: 10px;
      font-weight: 700;
      border-radius: 30px;
      margin-bottom: 20px;
      text-transform: uppercase;
      letter-spacing: 0.75px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
    }
    .badge-checking {
      background-color: var(--vscode-statusBarItem-warningBackground, #c97a00);
      color: var(--vscode-statusBarItem-warningForeground, #ffffff);
    }
    .badge-ready {
      background-color: #00FF87;
      color: #121214;
      box-shadow: 0 0 10px rgba(0, 255, 135, 0.3);
    }
    .badge-missing {
      background-color: #FF5F56;
      color: #ffffff;
    }
    .btn {
      background: linear-gradient(135deg, var(--vscode-button-background) 0%, rgba(138, 43, 226, 0.85) 100%);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 12px 20px;
      font-size: 13px;
      font-weight: 700;
      border-radius: 8px;
      cursor: pointer;
      width: 100%;
      transition: all 0.3s ease;
      box-sizing: border-box;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .btn:hover {
      filter: brightness(1.15);
      box-shadow: 0 6px 20px rgba(138, 43, 226, 0.35);
      transform: translateY(-1px);
    }
    .btn:active {
      transform: translateY(1px);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: none;
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    }
    .select-input {
      background-color: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, rgba(255, 255, 255, 0.15));
      padding: 12px 14px;
      font-size: 13px;
      border-radius: 8px;
      width: 100%;
      cursor: pointer;
      outline: none;
      box-sizing: border-box;
      transition: all 0.3s ease;
    }
    .select-input:hover, .select-input:focus {
      border-color: var(--vscode-focusBorder, #007fd4);
      box-shadow: 0 0 8px rgba(0, 127, 212, 0.25);
    }
    .footer {
      display: flex;
      justify-content: center;
      align-items: center;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-top: 40px;
      gap: 20px;
    }
    .footer-btn {
      max-width: 200px;
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

    <!-- Onboarding Progress Section -->
    <div class="progress-section">
      <div class="progress-text">
        <span>Onboarding Progress</span>
        <span id="progress-percent">0%</span>
      </div>
      <div class="progress-bar">
        <div id="progress-fill" class="progress-fill" style="width: 0%;"></div>
      </div>
      <div class="checklist">
        <div class="check-item" id="check-cli">
          <span class="check-icon">○</span> Verify Falkon CLI
        </div>
        <div class="check-item" id="check-shortcut">
          <span class="check-icon">○</span> Configure Shortcut Preset
        </div>
      </div>
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
        <img class="card-icon logo-icon" src="${welcomeSvgUri}" alt="Start Coding" />
        <h2>Start Coding</h2>
        <span style="height: 16px; margin-bottom: 16px;"></span> <!-- Spacer to align with badge -->
        <p>Initialize a new workspace with a sample template file and start compiling your Falkon projects.</p>
        <button id="btn-create-file" class="btn btn-secondary">Create hello.flk</button>
      </div>
    </div>

    <div class="footer">
      <button id="btn-skip" class="btn btn-secondary footer-btn">Skip / Do Later</button>
      <button id="btn-close" class="btn footer-btn">Finish Setup</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    let isCliReady = ${initialVerifiedCli};
    let isShortcutConfigured = ${initialOpenedSettings};

    function updateProgress() {
      let completedCount = 0;
      if (isCliReady) {
        completedCount++;
        document.getElementById('check-cli').classList.add('completed');
        document.getElementById('check-cli').querySelector('.check-icon').innerText = '✓';
      } else {
        document.getElementById('check-cli').classList.remove('completed');
        document.getElementById('check-cli').querySelector('.check-icon').innerText = '○';
      }

      if (isShortcutConfigured) {
        completedCount++;
        document.getElementById('check-shortcut').classList.add('completed');
        document.getElementById('check-shortcut').querySelector('.check-icon').innerText = '✓';
      } else {
        document.getElementById('check-shortcut').classList.remove('completed');
        document.getElementById('check-shortcut').querySelector('.check-icon').innerText = '○';
      }

      const percent = Math.round((completedCount / 2) * 100);
      document.getElementById('progress-percent').innerText = percent + '%';
      document.getElementById('progress-fill').style.width = percent + '%';

      const closeBtn = document.getElementById('btn-close');
      if (percent === 100) {
        closeBtn.innerText = 'Complete Setup 🎉';
        closeBtn.style.boxShadow = '0 0 12px rgba(0, 255, 135, 0.4)';
      } else {
        closeBtn.innerText = 'Finish Setup';
        closeBtn.style.boxShadow = 'none';
      }
    }

    document.getElementById('btn-verify').addEventListener('click', () => {
      const badge = document.getElementById('cli-badge');
      badge.className = 'status-badge badge-checking';
      badge.innerText = 'Checking...';
      vscode.postMessage({ command: 'verifyCli' });
    });

    const selectShortcut = document.getElementById('select-shortcut');
    const markShortcutConfigured = () => {
      if (!isShortcutConfigured) {
        isShortcutConfigured = true;
        updateProgress();
        vscode.postMessage({ command: 'shortcutInteracted' });
      }
    };

    selectShortcut.addEventListener('change', (e) => {
      markShortcutConfigured();
      vscode.postMessage({ command: 'changeShortcut', preset: e.target.value });
    });

    selectShortcut.addEventListener('click', markShortcutConfigured);
    selectShortcut.addEventListener('focus', markShortcutConfigured);

    document.getElementById('btn-create-file').addEventListener('click', () => {
      vscode.postMessage({ command: 'createFile' });
    });

    document.getElementById('btn-close').addEventListener('click', () => {
      vscode.postMessage({ command: 'close' });
    });

    document.getElementById('btn-skip').addEventListener('click', () => {
      vscode.postMessage({ command: 'skip' });
    });

    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'resetProgress': {
          isCliReady = false;
          isShortcutConfigured = false;
          const selectElement = document.getElementById('select-shortcut');
          if (selectElement) {
            selectElement.value = 'f4';
          }
          const badge = document.getElementById('cli-badge');
          if (badge) {
            badge.className = 'status-badge badge-checking';
            badge.innerText = 'Checking...';
          }
          vscode.postMessage({ command: 'checkCliSilent' });
          updateProgress();
          break;
        }
        case 'updateSettings':
          document.getElementById('select-shortcut').value = message.shortcutPreset;
          isShortcutConfigured = true;
          updateProgress();
          break;
        case 'updateCliStatus': {
          const badge = document.getElementById('cli-badge');
          if (badge) {
            if (message.status === 'ready') {
              badge.className = 'status-badge badge-ready';
              badge.innerText = 'Ready (' + message.version + ')';
              if (message.isVerification) {
                isCliReady = true;
              }
            } else {
              badge.className = 'status-badge badge-missing';
              badge.innerText = 'Missing CLI';
              if (message.isVerification) {
                isCliReady = false;
              }
            }
          }
          updateProgress();
          break;
        }
      }
    });

    // Run initial progress check
    updateProgress();
  </script>
</body>
</html>`;
}
function checkCompletionStatus(context) {
    const hasVerifiedCli = context.globalState.get("falkon.hasVerifiedCli", false);
    const hasOpenedSettings = context.globalState.get("falkon.hasOpenedSettings", false);
    if (hasVerifiedCli && hasOpenedSettings) {
        context.globalState.update("falkon.walkthroughCompleted", true);
    }
}
//# sourceMappingURL=extension.js.map