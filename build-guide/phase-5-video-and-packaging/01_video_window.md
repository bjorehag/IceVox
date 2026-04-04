# Step 1: Video Window Setup

## Task
Create a separate Electron BrowserWindow for video chat with its own preload script, and set up the IPC relay through main.js.

## Why a separate window?
- Video is optional — not everyone wants/has a camera
- Independent lifecycle: closing video doesn't close the app
- Separate crash domain: if video WebRTC fails, audio chat continues
- Can be minimized/moved independently

## Instructions

### 1.1 Create `src/video/video.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'self';
    script-src 'self' 'unsafe-inline';
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob:;
    media-src 'self' blob: mediastream:;
    connect-src 'self';
    object-src 'none';
    base-uri 'self';
  ">
  <title>Video Chat</title>
  <link rel="stylesheet" href="video-styles.css">
</head>
<body>
  <div id="video-grid">
    <!-- Local preview -->
    <div class="video-cell local" id="local-cell">
      <video id="local-video" autoplay muted playsinline></video>
      <span class="video-label">You</span>
    </div>
    <!-- Remote peer cells are added dynamically -->
  </div>

  <div id="video-controls">
    <button id="camera-toggle">Camera On</button>
    <button id="layout-toggle">Grid</button>
    <button id="video-settings-btn">Settings</button>
    <button id="close-video-btn">Close</button>
  </div>

  <!-- Settings panel (hidden) -->
  <div id="settings-panel" style="display: none;">
    <label>Camera:
      <select id="camera-select"></select>
    </label>
    <label>Quality:
      <select id="quality-select">
        <option value="auto" selected>Auto</option>
        <option value="high">High (720p)</option>
        <option value="medium">Medium (480p)</option>
        <option value="low">Low (360p)</option>
      </select>
    </label>
  </div>

  <script src="video-renderer.js"></script>
</body>
</html>
```

### 1.2 Create `src/video/video-styles.css`

Style the video grid, controls bar, and settings panel. Use the same theme approach (read `data-theme` from the opener window or have the main process pass it).

Key styles:
- Video grid: CSS grid, auto-fit with responsive columns
- Each video cell: 16:9 aspect ratio, object-fit cover, rounded corners
- "Camera off" placeholder when peer's camera is disabled
- Controls bar at the bottom: transparent background, hover to reveal
- Focus mode: one large video + thumbnails below

### 1.3 Create `src/video-preload.js`

The video window's preload script — bridges IPC for video signaling:

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('videoIPC', {
  // Receive peer list from main window (via main.js relay)
  onPeerList: (callback) => {
    ipcRenderer.on('video:peer-list', (event, peers, iceConfig, ownPeerId) => {
      callback(peers, iceConfig, ownPeerId);
    });
  },

  // Receive notification when a new peer joins
  onPeerJoined: (callback) => {
    ipcRenderer.on('video:peer-joined', (event, peerId, peerInfo) => {
      callback(peerId, peerInfo);
    });
  },

  // Receive notification when a peer leaves
  onPeerLeft: (callback) => {
    ipcRenderer.on('video:peer-left', (event, peerId) => {
      callback(peerId);
    });
  },

  // Receive a WebRTC signal (SDP or ICE candidate) from a remote peer
  onSignalFromPeer: (callback) => {
    ipcRenderer.on('video:signal-from-peer', (event, peerId, signal) => {
      callback(peerId, signal);
    });
  },

  // Send a WebRTC signal to a remote peer (via main.js → main window → data channel)
  sendSignalToPeer: (peerId, signal) => {
    ipcRenderer.send('video:signal-to-peer', peerId, signal);
  },

  // Notify main.js that the video window is ready
  notifyReady: () => {
    ipcRenderer.send('video:window-ready');
  },

  // Close the video window
  close: () => {
    ipcRenderer.send('video:close-window');
  },
});
```

### 1.4 Add video window creation to main.js

```javascript
let videoWindow = null;
let videoWindowReady = false;
let pendingVideoSignals = [];

function createVideoWindow() {
  if (videoWindow) {
    videoWindow.focus();
    return;
  }

  videoWindow = new BrowserWindow({
    width: 640,
    height: 480,
    minWidth: 320,
    minHeight: 240,
    title: 'Video Chat',
    backgroundColor: '#0e1520',
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'video-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    }
  });

  Menu.setApplicationMenu(null);
  videoWindow.loadFile(path.join(__dirname, 'video', 'video.html'));
  videoWindowReady = false;
  pendingVideoSignals = [];

  videoWindow.on('closed', () => {
    videoWindow = null;
    videoWindowReady = false;
    pendingVideoSignals = [];
    // Notify main window that video window closed
    if (mainWindow) mainWindow.webContents.send('video:window-closed');
  });
}
```

### 1.5 Set up IPC relay in main.js

main.js acts as a relay between the main window and the video window:

```javascript
// Main window requests video window to open/close
ipcMain.on('video:open-window', () => createVideoWindow());
ipcMain.on('video:close-window', () => {
  if (videoWindow) videoWindow.close();
});

// Video window is ready — request peer list from main window
ipcMain.on('video:window-ready', () => {
  videoWindowReady = true;
  // Ask main window for the current peer list
  if (mainWindow) mainWindow.webContents.send('video:request-peer-list');
});

// Main window sends peer list → forward to video window
ipcMain.on('video:send-peer-list', (event, peers, iceConfig, ownPeerId) => {
  if (videoWindow) {
    videoWindow.webContents.send('video:peer-list', peers, iceConfig, ownPeerId);
    // Deliver any buffered signals
    for (const { peerId, signal } of pendingVideoSignals) {
      videoWindow.webContents.send('video:signal-from-peer', peerId, signal);
    }
    pendingVideoSignals = [];
  }
});

// Signal relay: main window → video window
ipcMain.on('video:signal-from-peer', (event, peerId, signal) => {
  if (videoWindow && videoWindowReady) {
    videoWindow.webContents.send('video:signal-from-peer', peerId, signal);
  } else {
    // Buffer signals until video window is ready
    pendingVideoSignals.push({ peerId, signal });
  }
});

// Signal relay: video window → main window
ipcMain.on('video:signal-to-peer', (event, peerId, signal) => {
  if (mainWindow) {
    mainWindow.webContents.send('video:signal-to-peer', peerId, signal);
  }
});

// Peer joined/left notifications → forward to video window
ipcMain.on('video:peer-joined', (event, peerId, peerInfo) => {
  if (videoWindow) videoWindow.webContents.send('video:peer-joined', peerId, peerInfo);
});

ipcMain.on('video:peer-left', (event, peerId) => {
  if (videoWindow) videoWindow.webContents.send('video:peer-left', peerId);
});
```

### 1.6 Signal buffering explained

Signals from remote peers may arrive (via data channel → renderer → main.js) before the video window finishes loading. Without buffering, these signals would be lost, breaking the video connection.

The sequence is:
1. Main window sends `video:open-window` → main.js creates video BrowserWindow
2. Video window loads HTML, runs script, calls `videoIPC.notifyReady()`
3. main.js receives `video:window-ready`, sets flag, requests peer list from main window
4. Main window responds with `video:send-peer-list` (peer IDs + ICE config + own peer ID)
5. main.js forwards peer list to video window, then delivers any buffered signals
6. Video window creates RTCPeerConnections and starts signaling

## Verification
- [ ] Clicking "Video" in the main window opens a separate video window
- [ ] The video window loads without errors
- [ ] Closing the video window doesn't crash the main app
- [ ] Console logs show the signal relay sequence
- [ ] No console errors in either window
