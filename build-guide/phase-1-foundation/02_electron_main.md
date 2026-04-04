# Step 2: Electron Main Process

## Task
Create the main Electron process with a secure BrowserWindow and a preload script that bridges IPC communication.

## Instructions

### 2.1 Create `src/main.js`

This is the Electron main process. It creates the app window with security hardening.

```javascript
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 280,
    minHeight: 200,
    title: 'Your App Name',
    // Choose your background color — should match your darkest theme
    backgroundColor: '#0e1520',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    }
  });

  // Remove the default Electron menu bar
  Menu.setApplicationMenu(null);

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show window when ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Prevent the page from changing the window title
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  // DevTools hotkey — only in development
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!app.isPackaged) {
      if (input.key === 'F12' ||
          (input.control && input.shift && input.key === 'I')) {
        mainWindow.webContents.toggleDevTools();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

// ── IPC Handlers ─────────────────────────────────────────────

// Returns the correct path for AudioWorklet (handles ASAR unpacking)
ipcMain.handle('get-worklet-path', () => {
  let workletPath = path.join(__dirname, 'renderer', 'audio-worklet-processor.js');
  if (app.isPackaged) {
    workletPath = workletPath.replace('app.asar', 'app.asar.unpacked');
  }
  return workletPath;
});

// Returns the app version from package.json
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Opens a URL in the user's default browser (security: only http/https)
ipcMain.handle('open-external', (event, url) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});
```

### 2.2 Create `src/preload.js`

The preload script bridges the renderer and main process via `contextBridge`. This is the ONLY way the renderer can communicate with Node.js/Electron APIs.

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipcAPI', {
  // Audio device management (stubs for now — implemented in Phase 2)
  audio: {
    getDevices: () => ipcRenderer.invoke('audio-get-devices'),
    selectDevice: (deviceId) => ipcRenderer.invoke('audio-select-device', deviceId),
  },

  // Utilities
  getWorkletPath: () => ipcRenderer.invoke('get-worklet-path'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Protocol handler (Phase 5)
  onProtocolJoinRoom: (callback) => {
    ipcRenderer.on('protocol-join-room', (event, roomId) => callback(roomId));
  },

  // Taskbar controls (Phase 5)
  taskbar: {
    onToggleMicMute: (callback) => {
      ipcRenderer.on('taskbar:toggle-mic-mute', () => callback());
    },
    onToggleOutputMute: (callback) => {
      ipcRenderer.on('taskbar:toggle-output-mute', () => callback());
    },
    onSetPeerVolume: (callback) => {
      ipcRenderer.on('taskbar:set-peer-volume', (event, peerId, volume) => callback(peerId, volume));
    },
    sendStateUpdate: (state) => {
      ipcRenderer.send('taskbar:state-update', state);
    },
  },

  // Video window controls (Phase 5)
  video: {
    openWindow: () => ipcRenderer.send('video:open-window'),
    closeWindow: () => ipcRenderer.send('video:close-window'),
    onWindowClosed: (callback) => {
      ipcRenderer.on('video:window-closed', () => callback());
    },
    forwardSignalToVideoWindow: (peerId, signal) => {
      ipcRenderer.send('video:signal-from-peer', peerId, signal);
    },
    onSignalForPeer: (callback) => {
      ipcRenderer.on('video:signal-to-peer', (event, peerId, signal) => callback(peerId, signal));
    },
    onRequestPeerList: (callback) => {
      ipcRenderer.on('video:request-peer-list', () => callback());
    },
    sendPeerList: (peers, iceConfig, ownPeerId) => {
      ipcRenderer.send('video:send-peer-list', peers, iceConfig, ownPeerId);
    },
    notifyPeerJoined: (peerId, peerInfo) => {
      ipcRenderer.send('video:peer-joined', peerId, peerInfo);
    },
    notifyPeerLeft: (peerId) => {
      ipcRenderer.send('video:peer-left', peerId);
    },
  },
});
```

### 2.3 Set up electron-reload for development

Add to the top of `src/main.js` (inside a dev-mode check):

```javascript
// Hot reload in development
if (!app.isPackaged) {
  try {
    require('electron-reload')(__dirname, {
      electron: path.join(__dirname, '..', 'node_modules', '.bin', 'electron'),
      hardResetMethod: 'exit',
    });
  } catch (e) {
    // electron-reload not available — ignore
  }
}
```

### 2.4 Create a minimal `src/renderer/index.html`

Create a temporary placeholder HTML to verify the window opens:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Content Security Policy -->
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'self';
    script-src 'self' 'unsafe-inline' https://unpkg.com;
    style-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net;
    font-src 'self' https://unpkg.com https://cdn.jsdelivr.net;
    img-src 'self' blob:;
    media-src 'self' blob: mediastream:;
    connect-src 'self' wss://0.peerjs.com https://0.peerjs.com;
    worker-src 'self' blob:;
    object-src 'none';
    base-uri 'self';
  ">

  <title>App</title>
</head>
<body>
  <h1>It works!</h1>
</body>
</html>
```

**CSP Notes:**
- `unsafe-inline` for scripts: needed for the inline theme-init script (prevents flash of wrong theme)
- `unpkg.com` / `cdn.jsdelivr.net`: for Phosphor Icons (used by the minimal theme)
- `wss://0.peerjs.com`: PeerJS signaling server (Phase 4)
- `blob:` / `mediastream:`: WebRTC audio/video streams
- `worker-src blob:`: AudioWorklet

## Verification
- [ ] `npm start` opens a window with "It works!" displayed
- [ ] The window has no default Electron menu bar
- [ ] The window background is your chosen dark color
- [ ] F12 opens DevTools (only works in dev mode, not packaged)
- [ ] No console errors on startup
