# Falkon Language Support

VS Code extension for the **Falkon** programming language.

## Features

- **Syntax Highlighting**: Python-compatible grammar tailored for Falkon.
- **File Icons**: Custom icon support for `.flk` files.
- **Build & Run**: Build and execute Falkon source files directly from the editor.
- **Windows Integration**: Optional registration for Falkon file icons in Windows File Explorer.

## Getting Started

1. Open any `.flk` file.
2. Press **`Ctrl+F5`** to build and run the current file.
3. The build process uses the `falkon` CLI and displays output in a dedicated "Falkon Run" terminal (PowerShell on Windows).

## Technical Details

- **Grammar**: Reuses the built-in VS Code Python grammar via aliasing (`source.python` -> `source.falkon`).
- **Icons**: Provides a high-resolution Falkon logo for all `.flk` files.
- **Terminal Integration**: Successive runs reuse the same terminal instance to preserve command history.

## Commands

- `Falkon: Build and Run Active File` (**`Ctrl+F5`**)
- `Falkon: Register Windows File Explorer Icons` (Windows only)

## Troubleshooting

### Icons not appearing or appearing on all files?
If you previously used an older version of the Falkon extension, your Icon Theme might still be set to a legacy theme.
1. Open the Command Palette (`Ctrl+Shift+P`).
2. Select **File Icon Theme**.
3. Choose **Seti (default)** or any other preferred theme.
4. The Falkon extension will automatically provide its icon to any theme that supports language icons.

### F5 doesn't work?
To avoid conflict with VS Code's built-in debugger, the build command is mapped to **`Ctrl+F5`** (Run Without Debugging).
