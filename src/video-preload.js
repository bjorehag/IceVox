const { contextBridge, ipcRenderer } = require('electron');

// Expose video-specific IPC API to the video window renderer
contextBridge.exposeInMainWorld('videoIPC', {
  // Receive the list of currently connected peers when window opens
  onPeerList: (callback) => {
    ipcRenderer.on('video:peer-list', (event, peers) => callback(peers));
  },

  // Receive notification when a new peer joins the room
  onPeerJoined: (callback) => {
    ipcRenderer.on('video:peer-joined', (event, peerId, peerInfo) => callback(peerId, peerInfo));
  },

  // Receive notification when a peer leaves the room
  onPeerLeft: (callback) => {
    ipcRenderer.on('video:peer-left', (event, peerId) => callback(peerId));
  },

  // Receive video signaling data (SDP/ICE) from a remote peer
  onSignalFromPeer: (callback) => {
    ipcRenderer.on('video:signal-from-peer', (event, peerId, signal) => callback(peerId, signal));
  },

  // Send video signaling data (SDP/ICE) to a specific remote peer
  sendSignalToPeer: (peerId, signal) => {
    ipcRenderer.send('video:signal-to-peer', peerId, signal);
  },

  // Notify main process that the video window is ready
  notifyReady: () => {
    ipcRenderer.send('video:window-ready');
  },

  // Request to close the video window
  close: () => {
    ipcRenderer.send('video:close-window');
  },

  // Receive ICE config from main window
  onIceConfig: (callback) => {
    ipcRenderer.on('video:ice-config', (event, config) => callback(config));
  },

  // Receive own peer ID
  onOwnPeerId: (callback) => {
    ipcRenderer.on('video:own-peer-id', (event, peerId) => callback(peerId));
  },
});
