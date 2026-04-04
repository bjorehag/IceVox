# Step 4: Taskbar Controls

## Task
Add Windows thumbnail toolbar buttons (mic/output mute) and a system tray icon with context menu for quick access to controls.

## Instructions

### 4.1 Create `src/taskbar-icons.js`

Windows thumbnail toolbar requires `NativeImage` objects. Since we can't load .ico files easily for this, generate simple 16x16 PNG icons programmatically:

```javascript
// taskbar-icons.js — Programmatic PNG icon generation for taskbar

const { nativeImage } = require('electron');

// Minimal PNG encoder (uncompressed, 16x16 RGBA)
function createPNG(pixels) {
  // PNG file structure: signature + IHDR + IDAT + IEND
  // pixels: Uint8Array of RGBA values (16*16*4 = 1024 bytes)

  const width = 16, height = 16;

  // PNG signature
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = createChunk('IHDR', (() => {
    const data = new Uint8Array(13);
    const view = new DataView(data.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    data[8] = 8;  // bit depth
    data[9] = 6;  // color type: RGBA
    data[10] = 0; // compression
    data[11] = 0; // filter
    data[12] = 0; // interlace
    return data;
  })());

  // IDAT chunk (raw image data with filter bytes)
  const rawData = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // Filter: None
    for (let x = 0; x < width * 4; x++) {
      rawData[y * (1 + width * 4) + 1 + x] = pixels[y * width * 4 + x];
    }
  }

  // Compress with zlib (use Node.js zlib)
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(Buffer.from(rawData));
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', new Uint8Array(0));

  // Combine
  const png = Buffer.concat([
    Buffer.from(signature),
    Buffer.from(ihdr),
    Buffer.from(idat),
    Buffer.from(iend),
  ]);

  return nativeImage.createFromBuffer(png);
}

function createChunk(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data instanceof Uint8Array ? data : new Uint8Array(data), 8);
  const crc = crc32(chunk.slice(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return chunk;
}

// CRC32 implementation
function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Helper: fill a 16x16 pixel buffer with a color
function fillRect(pixels, x, y, w, h, r, g, b, a = 255) {
  for (let py = y; py < y + h && py < 16; py++) {
    for (let px = x; px < x + w && px < 16; px++) {
      const idx = (py * 16 + px) * 4;
      pixels[idx] = r; pixels[idx+1] = g; pixels[idx+2] = b; pixels[idx+3] = a;
    }
  }
}

// Generate mic icons (on/off)
function createMicIcon(muted) {
  const pixels = new Uint8Array(16 * 16 * 4);
  // Draw a simple microphone shape
  // (customize the pixel art to your liking)
  const color = muted ? [200, 60, 60] : [100, 200, 100];
  fillRect(pixels, 6, 2, 4, 8, ...color);   // Mic body
  fillRect(pixels, 4, 10, 8, 2, ...color);  // Mic base
  fillRect(pixels, 7, 12, 2, 2, ...color);  // Mic stand
  if (muted) {
    // Draw X
    for (let i = 0; i < 16; i++) {
      fillRect(pixels, i, i, 1, 1, 200, 60, 60);
      fillRect(pixels, 15-i, i, 1, 1, 200, 60, 60);
    }
  }
  return createPNG(pixels);
}

// Generate speaker icons (on/off)
function createSpeakerIcon(muted) {
  const pixels = new Uint8Array(16 * 16 * 4);
  const color = muted ? [200, 60, 60] : [100, 200, 100];
  fillRect(pixels, 2, 5, 4, 6, ...color);   // Speaker body
  fillRect(pixels, 6, 3, 4, 10, ...color);  // Speaker cone
  if (muted) {
    for (let i = 0; i < 16; i++) {
      fillRect(pixels, i, i, 1, 1, 200, 60, 60);
    }
  }
  return createPNG(pixels);
}

module.exports = { createMicIcon, createSpeakerIcon };
```

### 4.2 Set up thumbnail toolbar in main.js

```javascript
const { createMicIcon, createSpeakerIcon } = require('./taskbar-icons');

function updateThumbarButtons(micMuted, outputMuted) {
  if (!mainWindow) return;

  mainWindow.setThumbarButtons([
    {
      tooltip: micMuted ? 'Unmute Mic' : 'Mute Mic',
      icon: createMicIcon(micMuted),
      click: () => {
        mainWindow.webContents.send('taskbar:toggle-mic-mute');
      },
    },
    {
      tooltip: outputMuted ? 'Unmute Output' : 'Mute Output',
      icon: createSpeakerIcon(outputMuted),
      click: () => {
        mainWindow.webContents.send('taskbar:toggle-output-mute');
      },
    },
  ]);
}
```

### 4.3 Set up system tray in main.js

```javascript
const { Tray, Menu } = require('electron');

let tray = null;

function createTray() {
  const trayIcon = createMicIcon(false); // Default icon
  tray = new Tray(trayIcon);
  tray.setToolTip('Your App Name');
  updateTrayMenu({ micMuted: false, outputMuted: false, peers: [] });
}

function updateTrayMenu(state) {
  const { micMuted, outputMuted, peers } = state;

  const peerMenuItems = peers.map(peer => ({
    label: peer.name,
    submenu: [0, 25, 50, 75, 100, 150, 200].map(vol => ({
      label: `${vol}%`,
      type: 'radio',
      checked: false,
      click: () => {
        mainWindow.webContents.send('taskbar:set-peer-volume', peer.id, vol / 100);
      },
    })),
  }));

  const contextMenu = Menu.buildFromTemplate([
    { label: micMuted ? 'Unmute Mic' : 'Mute Mic', click: () => mainWindow.webContents.send('taskbar:toggle-mic-mute') },
    { label: outputMuted ? 'Unmute Output' : 'Mute Output', click: () => mainWindow.webContents.send('taskbar:toggle-output-mute') },
    { type: 'separator' },
    ...peerMenuItems,
    { type: 'separator' },
    { label: 'Show App', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
}
```

### 4.4 Handle state updates from renderer

```javascript
ipcMain.on('taskbar:state-update', (event, state) => {
  updateThumbarButtons(state.micMuted, state.outputMuted);
  updateTrayMenu(state);
});
```

### 4.5 Wire up in renderer.js

```javascript
// Handle taskbar button clicks
window.ipcAPI.taskbar.onToggleMicMute(() => {
  const muted = !audioManager.isMicMuted;
  audioManager.setMicMuted(muted);
  audioManager.isMicMuted = muted;
  sendTaskbarState();
  // Update UI button state
});

window.ipcAPI.taskbar.onToggleOutputMute(() => {
  const muted = !audioManager.isOutputMuted;
  audioManager.setOutputMuted(muted);
  audioManager.isOutputMuted = muted;
  sendTaskbarState();
  // Update UI button state
});

window.ipcAPI.taskbar.onSetPeerVolume((peerId, volume) => {
  audioManager.setRemoteVolume(peerId, volume);
  // Update the volume slider in the participant list
});
```

### 4.6 Create tray on app ready

In `main.js`, call `createTray()` inside `createWindow()` (after window creation) or in `app.whenReady()`.

## Verification
- [ ] Hovering over the taskbar icon shows mic/speaker mute buttons
- [ ] Clicking thumbnail buttons toggles mute state
- [ ] System tray icon appears
- [ ] Right-clicking tray shows context menu with mute toggles
- [ ] Per-peer volume submenu appears when peers are connected
- [ ] "Show App" brings the window to front
- [ ] "Quit" closes the app
- [ ] No console errors
