# Step 1: Project Initialization

## Task
Create the project structure, install dependencies, and set up npm scripts.

## Instructions

### 1.1 Initialize the project

```bash
npm init -y
```

Edit `package.json` to set:
- `name`: your app name (lowercase, no spaces)
- `version`: `"0.1.0"`
- `description`: a one-line description of your app
- `main`: `"src/main.js"`
- `author`: your name
- `license`: `"MIT"` (or your choice)

### 1.2 Install dependencies

```bash
npm install peerjs
npm install --save-dev electron electron-builder electron-reload
```

- `electron` — the app framework
- `electron-builder` — builds Windows installer
- `electron-reload` — auto-reload during development
- `peerjs` — WebRTC signaling library (will be bundled as a global script later)

### 1.3 Add npm scripts

In `package.json`, set the `scripts` section:

```json
{
  "scripts": {
    "start": "electron .",
    "dev": "set ELECTRON_ENABLE_LOGGING=1 && electron .",
    "build": "electron-builder --win",
    "build:dir": "electron-builder --win --dir"
  }
}
```

### 1.4 Create the folder structure

```
project-root/
├── src/
│   ├── renderer/
│   └── video/
├── assets/
│   ├── icons/
│   └── generated_icons/
└── build/
```

- `src/` — all source code
- `src/renderer/` — main window HTML, CSS, JS
- `src/video/` — video chat window (Phase 5)
- `assets/icons/` — custom themed .ico files
- `assets/generated_icons/` — generated .png assets (banners, symbols)
- `build/` — build resources (app icon for installer)

### 1.5 Copy PeerJS bundle

Copy the PeerJS minified bundle into the renderer folder for later use:

```bash
cp node_modules/peerjs/dist/peerjs.min.js src/renderer/peerjs.min.js
```

Also copy the source map if available:
```bash
cp node_modules/peerjs/dist/peerjs.min.js.map src/renderer/peerjs.min.js.map
```

This will be loaded as a global `<script>` tag in the HTML (NOT as an ES module import — PeerJS has issues with ES modules in Electron's sandboxed renderer).

### 1.6 Create .gitignore

```
node_modules/
dist/
*.log
.env
```

### 1.7 Place your app icon

Place an `.ico` file at `build/icon.ico`. This will be used for the Windows installer and app shortcut. If you don't have one yet, create a placeholder — it can be replaced later.

## Verification
- [ ] `package.json` exists with correct `main` field pointing to `src/main.js`
- [ ] `node_modules/` contains electron, electron-builder, electron-reload, peerjs
- [ ] `src/renderer/peerjs.min.js` exists (copied from node_modules)
- [ ] Folder structure matches the layout above
- [ ] `.gitignore` exists
- [ ] `build/icon.ico` exists (even if placeholder)
