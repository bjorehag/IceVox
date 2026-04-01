const { contextBridge, ipcRenderer } = require('electron');

// Expose API to renderer process via contextBridge
contextBridge.exposeInMainWorld('ipcAPI', {
  // Audio device API (to be implemented in later phases)
  audio: {
    getDevices: () => ipcRenderer.invoke('audio:getDevices'),
    selectDevice: (deviceId) => ipcRenderer.invoke('audio:selectDevice', deviceId)
  },

  // Protocol handler: called when app is opened via icevox://join/[room-id]
  onProtocolJoinRoom: (callback) => {
    ipcRenderer.on('protocol-join-room', (event, roomId) => {
      callback(roomId);
    });
  },

  // Resolve AudioWorklet path — differs between development and packaged build
  getWorkletPath: () => ipcRenderer.invoke('get-worklet-path'),

  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Taskbar controls (thumbnail toolbar + system tray)
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
    }
  },

  // Video window management
  video: {
    // Open/close the video window
    openWindow: () => ipcRenderer.send('video:open-window'),
    closeWindow: () => ipcRenderer.send('video:close-window'),

    // Listen for video window closed (by user or system)
    onWindowClosed: (callback) => {
      ipcRenderer.on('video:window-closed', () => callback());
    },

    // RELAY: Remote peer sent us a video signal via data channel.
    // Forward it to main process → video window.
    forwardSignalToVideoWindow: (peerId, signal) => {
      ipcRenderer.send('video:signal-from-peer', peerId, signal);
    },

    // RELAY: Video window wants to send a signal to a remote peer.
    // Main process forwards to us → we send via data channel.
    onSignalForPeer: (callback) => {
      ipcRenderer.on('video:signal-to-peer', (event, peerId, signal) => callback(peerId, signal));
    },

    // Main process asks us for current peer list (video window is ready)
    onRequestPeerList: (callback) => {
      ipcRenderer.on('video:request-peer-list', () => callback());
    },

    // Send peer list and config to main process → video window
    sendPeerList: (peers, iceConfig, ownPeerId) => {
      ipcRenderer.send('video:send-peer-list', peers, iceConfig, ownPeerId);
    },

    // Notify video window about peer join/leave
    notifyPeerJoined: (peerId, peerInfo) => {
      ipcRenderer.send('video:peer-joined', peerId, peerInfo);
    },
    notifyPeerLeft: (peerId) => {
      ipcRenderer.send('video:peer-left', peerId);
    },
  },
});
