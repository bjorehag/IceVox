# Step 5: Protocol Handler

## Task
Register a custom URL protocol so that links like `yourapp://join/{roomId}` open the app and auto-join the specified room.

## Instructions

### 5.1 Register the protocol

In `main.js`, before `app.whenReady()`:

```javascript
// Register custom protocol handler
// In development, we need to pass the full electron path
if (!app.isPackaged) {
  app.setAsDefaultProtocolClient('yourprotocol', process.execPath, [
    path.resolve(process.argv[1])
  ]);
} else {
  app.setAsDefaultProtocolClient('yourprotocol');
}
```

Replace `'yourprotocol'` with your chosen protocol name (e.g., `icevox`). This registers the app to handle `yourprotocol://` URLs.

### 5.2 Single-instance lock

In production, ensure only one instance runs. The second instance passes its URL to the first:

```javascript
// Only enforce single instance in production (allow multiple in dev for testing)
if (app.isPackaged) {
  const gotLock = app.requestSingleInstanceLock();

  if (!gotLock) {
    // Another instance is running — pass our URL to it and quit
    app.quit();
  } else {
    app.on('second-instance', (event, commandLine) => {
      // Focus existing window
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }

      // Check for protocol URL in command line
      const protocolUrl = commandLine.find(arg => arg.startsWith('yourprotocol://'));
      if (protocolUrl) {
        handleProtocolUrl(protocolUrl);
      }
    });
  }
}
```

### 5.3 Parse and handle protocol URLs

```javascript
function handleProtocolUrl(url) {
  console.log(`[Protocol] Handling URL: ${url}`);

  // Parse: yourprotocol://join/{roomId}
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.replace(/^\/+/, '').split('/');

    if (parsed.host === 'join' || pathParts[0] === 'join') {
      const roomId = pathParts[parsed.host === 'join' ? 0 : 1] || parsed.host;
      // Validate room ID format
      if (/^icevox-[a-z0-9]{5}$/.test(roomId)) {
        // Send to renderer to join the room
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('protocol-join-room', roomId);
          console.log(`[Protocol] Dispatched join for room: ${roomId}`);
        }
      }
    }
  } catch (err) {
    console.error('[Protocol] Failed to parse URL:', err);
  }
}
```

### 5.4 Handle URLs on initial launch

When the app is launched FROM a protocol URL (e.g., user clicks a link):

```javascript
// In createWindow(), after window is ready:
mainWindow.webContents.on('did-finish-load', () => {
  // Check if the app was launched with a protocol URL
  const protocolUrl = process.argv.find(arg => arg.startsWith('yourprotocol://'));
  if (protocolUrl) {
    handleProtocolUrl(protocolUrl);
  }
});
```

### 5.5 Handle in renderer.js

```javascript
if (window.ipcAPI) {
  window.ipcAPI.onProtocolJoinRoom((roomId) => {
    console.log(`[Protocol] Joining room from protocol link: ${roomId}`);

    // Auto-fill the room ID input and trigger join
    const roomIdInput = document.getElementById('room-id-input');
    if (roomIdInput) {
      roomIdInput.value = roomId;
    }

    // Auto-join if audio is initialized
    if (audioManager.isInitialized) {
      const sendStream = audioManager.getSendStream();
      connectionManager.joinRoom(roomId, sendStream);
    } else {
      // Init audio first, then join
      initAudio().then(() => {
        const sendStream = audioManager.getSendStream();
        connectionManager.joinRoom(roomId, sendStream);
      });
    }
  });
}
```

### 5.6 Generate invite links

Update the invite link generation in `renderer.js` to use the protocol:

```javascript
function copyInviteLink() {
  const roomId = connectionManager.roomId;
  if (!roomId) return;

  // Use the protocol URL for direct app linking
  // Or use a web URL that redirects to the protocol
  const link = `yourprotocol://join/${roomId}`;
  navigator.clipboard.writeText(link);
  console.log('[Room] Invite link copied');
}
```

## Verification
- [ ] App registers the protocol handler (check Windows registry or test with a URL)
- [ ] Clicking a `yourprotocol://join/icevox-xxxxx` link opens the app
- [ ] If the app is already open, it focuses the existing window
- [ ] The room ID is extracted and the app attempts to join
- [ ] In dev mode, multiple instances are allowed (for testing)
- [ ] In packaged mode, only one instance runs
- [ ] No console errors
