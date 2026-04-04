# Step 6: Installer

## Task
Configure electron-builder to produce a Windows NSIS installer with proper ASAR unpacking for the AudioWorklet processor.

## Instructions

### 6.1 Add build configuration to package.json

Add the `build` section to your `package.json`:

```json
{
  "build": {
    "appId": "com.yourname.yourapp",
    "productName": "YourAppName",
    "copyright": "Copyright © 2025 YourName",

    "directories": {
      "output": "dist",
      "buildResources": "build"
    },

    "files": [
      "src/**/*",
      "assets/**/*",
      "node_modules/**/*",
      "package.json"
    ],

    "asar": true,
    "asarUnpack": [
      "**/audio-worklet-processor.js"
    ],

    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ],
      "icon": "build/icon.ico"
    },

    "nsis": {
      "artifactName": "YourApp-Setup.${ext}",
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "installerIcon": "build/icon.ico",
      "uninstallerIcon": "build/icon.ico",
      "installerHeaderIcon": "build/icon.ico",
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "YourAppName",
      "perMachine": false,
      "allowElevation": true
    },

    "protocols": [
      {
        "name": "YourApp Protocol",
        "schemes": ["yourprotocol"]
      }
    ]
  }
}
```

### 6.2 Key configuration explained

**`asar: true`** — Bundles all source code into a single `app.asar` archive for faster loading and smaller installer size.

**`asarUnpack: ["**/audio-worklet-processor.js"]`** — The AudioWorklet processor file MUST be unpacked from the ASAR archive because `audioWorklet.addModule()` cannot load files from inside ASAR. electron-builder will place this file in `app.asar.unpacked/`.

**`oneClick: false`** — Shows the installation wizard (choose directory, etc.) instead of silently installing.

**`perMachine: false`** — Installs per-user (into `%LOCALAPPDATA%`), no admin rights needed.

**`allowElevation: true`** — Lets the user elevate to admin if they want to install system-wide.

**`protocols`** — Registers the custom protocol handler in the Windows registry during installation.

### 6.3 Verify the worklet path resolution

In `main.js`, the `get-worklet-path` IPC handler must handle both dev and packaged paths:

```javascript
ipcMain.handle('get-worklet-path', () => {
  let workletPath = path.join(__dirname, 'renderer', 'audio-worklet-processor.js');
  if (app.isPackaged) {
    // In production, the file is unpacked from ASAR
    workletPath = workletPath.replace('app.asar', 'app.asar.unpacked');
  }
  return workletPath;
});
```

### 6.4 Ensure build/icon.ico exists

Place your app icon at `build/icon.ico`. This is used for:
- The installer wizard icon
- The desktop shortcut icon
- The start menu shortcut icon
- The Windows taskbar icon

The .ico file should contain multiple sizes: 16x16, 32x32, 48x48, 256x256 for best results across Windows contexts.

### 6.5 Add dist/ to .gitignore

Make sure `dist/` is in your `.gitignore`:

```
node_modules/
dist/
*.log
.env
```

### 6.6 Build the installer

```bash
npm run build
```

This produces `dist/YourApp-Setup.exe` (NSIS installer).

For faster testing (no installer, just unpacked directory):
```bash
npm run build:dir
```

### 6.7 Test the packaged app

1. Run the NSIS installer → install the app
2. Launch from desktop shortcut
3. Verify:
   - Audio works (mic passthrough, effects)
   - Themes switch correctly
   - Icons load (from the unpacked ASAR)
   - Can create/join rooms
   - Protocol handler works (`yourprotocol://join/...`)

### 6.8 Common build issues

- **"Cannot find module" errors in packaged app** — Check that all source files are included in the `files` array
- **AudioWorklet fails to load** — Verify `asarUnpack` includes the worklet file and the path resolution in `get-worklet-path` replaces `app.asar` with `app.asar.unpacked`
- **Icons missing** — Ensure `assets/` is included in the `files` array
- **Protocol handler not registered** — The `protocols` section in build config registers it during installation

## Verification
- [ ] `npm run build` completes without errors
- [ ] `dist/YourApp-Setup.exe` is created
- [ ] Running the installer → app installs successfully
- [ ] Desktop shortcut launches the app
- [ ] Audio works in the packaged app
- [ ] Effects work (AudioWorklet loads from unpacked ASAR)
- [ ] Themes and icons display correctly
- [ ] Creating/joining rooms works
- [ ] Protocol handler works from the installed app
- [ ] Single-instance lock works (second launch focuses first)
