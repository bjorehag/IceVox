const { app, BrowserWindow, Menu, Tray, ipcMain, shell } = require('electron');
const path = require('path');
const { createTaskbarIcons } = require('./taskbar-icons');

const PROTOCOL = 'icevox';

let mainWindow;
let videoWindow = null;
let tray = null;
let taskbarIcons = null;

// Taskbar state (synced from renderer)
let taskbarState = {
  isMicMuted: false,
  isOutputMuted: false,
  peers: []  // [{ id, name, volume }]
};

// Register as default protocol client
// In development (electron .), process.defaultApp is true and argv[1] is the app path
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  // In packaged build
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// Single-instance lock — only in production (dev needs multiple instances for voice chat testing)
if (app.isPackaged) {
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    // Another instance is already running — hand off URL and quit
    app.quit();
  } else {
    app.on('second-instance', (event, commandLine) => {
      // Extract protocol URL from command line arguments
      const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`));
      if (url) {
        handleProtocolUrl(url);
      }

      // Bring existing window to focus
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
} else {
  console.log('[Protocol] Development mode — single-instance lock disabled (allows multiple instances for testing)');
}

// Parse and dispatch a protocol URL to the renderer
function handleProtocolUrl(url) {
  console.log(`[Protocol] Received URL: ${url}`);

  try {
    // Expected format: icevox://join/icevox-a4b2k
    const parsed = new URL(url);
    const action = parsed.hostname;           // "join"
    const roomId = parsed.pathname.replace(/^\//, ''); // "icevox-a4b2k"

    if (action === 'join' && roomId) {
      console.log(`[Protocol] Join request for room: ${roomId}`);

      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('protocol-join-room', roomId);
      }
    } else {
      console.warn(`[Protocol] Unknown action or missing room ID: ${action}`);
    }
  } catch (err) {
    console.error(`[Protocol] Failed to parse URL: ${err.message}`);
  }
}

function createWindow() {
  // Disable default menu
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 280,
    minHeight: 200,
    title: `IceVox v${app.getVersion()}`,
    backgroundColor: '#1a1a2e',
    icon: path.join(__dirname, '..', 'assets', 'icons', 'icevox_logo_1.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Prevent the HTML <title> from overriding the dynamic window title (IceVox v0.2.0)
  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  mainWindow.on('closed', () => {
    // Close video window when main window closes
    if (videoWindow && !videoWindow.isDestroyed()) {
      videoWindow.close();
    }
    mainWindow = null;
  });
}

// ==================== VIDEO WINDOW ====================

function createVideoWindow() {
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.focus();
    return;
  }

  videoWindow = new BrowserWindow({
    width: 640,
    height: 480,
    minWidth: 320,
    minHeight: 240,
    title: 'IceVox — Video',
    backgroundColor: '#111318',
    icon: path.join(__dirname, '..', 'assets', 'icons', 'icevox_logo_1.ico'),
    // Independent window — not modal, not child
    parent: null,
    webPreferences: {
      preload: path.join(__dirname, 'video-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // No menu in video window
  videoWindow.setMenu(null);

  videoWindow.loadFile(path.join(__dirname, 'video', 'video.html'));

  // F12 DevTools in video window (development only)
  if (!app.isPackaged) {
    videoWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' && input.type === 'keyDown') {
        videoWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
      if (input.key === 'I' && input.control && input.shift && input.type === 'keyDown') {
        videoWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  videoWindow.on('closed', () => {
    videoWindow = null;
    videoWindowReady = false;
    pendingVideoSignals = [];
    // Notify main window that video window was closed
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('video:window-closed');
    }
    console.log('[Video] Video window closed');
  });

  console.log('[Video] Video window created');
}

// ==================== APP LIFECYCLE ====================

app.whenReady().then(() => {
  createWindow();

  // DevTools hotkey — F12 or Ctrl+Shift+I (development only)
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' && input.type === 'keyDown') {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
      if (input.key === 'I' && input.control && input.shift && input.type === 'keyDown') {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  // Handle protocol URL if the app was launched via a protocol link
  const protocolUrl = process.argv.find(arg => arg.startsWith(`${PROTOCOL}://`));
  if (protocolUrl) {
    // Wait until the renderer is fully loaded before sending
    mainWindow.webContents.once('did-finish-load', () => {
      handleProtocolUrl(protocolUrl);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // ==================== TASKBAR CONTROLS ====================
  initTaskbarControls();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ==================== TASKBAR CONTROLS ====================

function initTaskbarControls() {
  taskbarIcons = createTaskbarIcons();
  setupThumbnailToolbar();
  setupTray();
}

function setupThumbnailToolbar() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.setThumbarButtons([
    {
      tooltip: taskbarState.isMicMuted ? 'Unmute Mic' : 'Mute Mic',
      icon: taskbarState.isMicMuted ? taskbarIcons.micOff : taskbarIcons.micOn,
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('taskbar:toggle-mic-mute');
        }
      }
    },
    {
      tooltip: taskbarState.isOutputMuted ? 'Unmute Output' : 'Mute Output',
      icon: taskbarState.isOutputMuted ? taskbarIcons.speakerOff : taskbarIcons.speakerOn,
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('taskbar:toggle-output-mute');
        }
      }
    }
  ]);
}

function setupTray() {
  const appIcon = path.join(__dirname, '..', 'assets', 'icons', 'icevox_logo_1.ico');
  tray = new Tray(appIcon);
  tray.setToolTip('IceVox');
  rebuildTrayMenu();

  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function rebuildTrayMenu() {
  if (!tray) return;

  const menuItems = [
    {
      label: taskbarState.isMicMuted ? '🔇 Unmute Mic' : '🎙️ Mute Mic',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('taskbar:toggle-mic-mute');
        }
      }
    },
    {
      label: taskbarState.isOutputMuted ? '🔇 Unmute Output' : '🔊 Mute Output',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('taskbar:toggle-output-mute');
        }
      }
    }
  ];

  // Per-participant volume submenus (only when connected with peers)
  if (taskbarState.peers.length > 0) {
    menuItems.push({ type: 'separator' });
    menuItems.push({ label: 'Participants', enabled: false });

    const volumePresets = [
      { label: '0%',   value: 0 },
      { label: '25%',  value: 0.25 },
      { label: '50%',  value: 0.50 },
      { label: '75%',  value: 0.75 },
      { label: '100%', value: 1.0 },
      { label: '150%', value: 1.5 },
      { label: '200%', value: 2.0 }
    ];

    for (const peer of taskbarState.peers) {
      const currentPct = Math.round(peer.volume * 100);
      menuItems.push({
        label: `${peer.name} (${currentPct}%)`,
        submenu: volumePresets.map(p => ({
          label: p.label,
          type: 'radio',
          checked: currentPct === Math.round(p.value * 100),
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('taskbar:set-peer-volume', peer.id, p.value);
            }
          }
        }))
      });
    }
  }

  menuItems.push({ type: 'separator' });
  menuItems.push({
    label: 'Show IceVox',
    click: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
  menuItems.push({
    label: 'Quit',
    click: () => app.quit()
  });

  tray.setContextMenu(Menu.buildFromTemplate(menuItems));
}

// Renderer sends state updates → refresh both toolbar and tray
ipcMain.on('taskbar:state-update', (event, state) => {
  taskbarState = state;
  setupThumbnailToolbar();
  rebuildTrayMenu();
});

// ==================== VIDEO IPC HANDLERS ====================

// Buffer for video signals that arrive before the video window is ready.
// Signals are delivered after the peer list is sent (ensuring ICE config & connections exist).
let pendingVideoSignals = [];
let videoWindowReady = false;

// Main window requests opening the video window
ipcMain.on('video:open-window', () => {
  // Don't clear pendingVideoSignals here — they contain signals from peers
  // that arrived before this window was opened, and we need to deliver them!
  videoWindowReady = false;
  createVideoWindow();
});

// Request to close the video window (from either window)
ipcMain.on('video:close-window', () => {
  pendingVideoSignals = [];
  videoWindowReady = false;
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.close();
  }
});

// Video window signals it is ready — main window sends peer list + config
ipcMain.on('video:window-ready', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Ask main window renderer to send current peer list and ICE config
    mainWindow.webContents.send('video:request-peer-list');
  }
});

// Main window sends peer list to video window
ipcMain.on('video:send-peer-list', (event, peers, iceConfig, ownPeerId) => {
  if (videoWindow && !videoWindow.isDestroyed()) {
    // Send config FIRST so it's set before peer list handler creates connections
    videoWindow.webContents.send('video:ice-config', iceConfig);
    videoWindow.webContents.send('video:own-peer-id', ownPeerId);
    videoWindow.webContents.send('video:peer-list', peers);

    // Now deliver any buffered signals that arrived before the window was ready
    videoWindowReady = true;
    if (pendingVideoSignals.length > 0) {
      console.log(`[Video] Delivering ${pendingVideoSignals.length} buffered signal(s) to video window`);
      pendingVideoSignals.forEach(({ peerId, signal }) => {
        videoWindow.webContents.send('video:signal-from-peer', peerId, signal);
      });
      pendingVideoSignals = [];
    }
  }
});

// Relay: video window → main window → (renderer sends via data channel)
ipcMain.on('video:signal-to-peer', (event, peerId, signal) => {
  console.log(`[Video Main] Relay video->main: signal for peer ${peerId}, type: ${signal && signal.type}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('video:signal-to-peer', peerId, signal);
  } else {
    console.warn('[Video Main] Cannot relay to mainWindow: destroyed or null');
  }
});

// Relay: main window renderer → video window (signal received from remote peer via data channel)
ipcMain.on('video:signal-from-peer', (event, peerId, signal) => {
  console.log(`[Video Main] Relay main->video: signal from peer ${peerId}, type: ${signal && signal.type}, videoReady: ${videoWindowReady}`);
  if (videoWindow && !videoWindow.isDestroyed() && videoWindowReady) {
    videoWindow.webContents.send('video:signal-from-peer', peerId, signal);
  } else {
    // Buffer: video window not ready yet — deliver after peer list arrives
    pendingVideoSignals.push({ peerId, signal });
    console.log(`[Video Main] Buffered signal from ${peerId} (video window not ready). Buffer size: ${pendingVideoSignals.length}`);
  }
});

// Peer joined — relay to video window
ipcMain.on('video:peer-joined', (event, peerId, peerInfo) => {
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.webContents.send('video:peer-joined', peerId, peerInfo);
  }
});

// Peer left — relay to video window
ipcMain.on('video:peer-left', (event, peerId) => {
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.webContents.send('video:peer-left', peerId);
  }
});

// ==================== AUDIO WORKLET PATH ====================

// Resolve AudioWorklet path for both development and packaged builds.
// AudioWorklet files cannot be loaded from inside ASAR, so the file is
// unpacked via asarUnpack in package.json and accessed via this IPC handler.
ipcMain.handle('get-worklet-path', () => {
  if (app.isPackaged) {
    // In production: file lives in app.asar.unpacked/ alongside app.asar
    return path.join(
      __dirname.replace('app.asar', 'app.asar.unpacked'),
      'renderer',
      'audio-worklet-processor.js'
    );
  } else {
    // In development: relative path from index.html works fine
    return './audio-worklet-processor.js';
  }
});

// ==================== APP INFO ====================

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('open-external', (event, url) => {
  // Only allow http/https URLs to prevent arbitrary protocol execution
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});
