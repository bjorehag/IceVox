# Step 1: PeerJS Setup

## Task
Configure PeerJS for WebRTC signaling and create the ConnectionManager class skeleton.

## Instructions

### 1.1 Verify PeerJS is loaded

In Phase 1 Step 3, `peerjs.min.js` was loaded as a global `<script>` tag in `index.html`. Verify this is working:

```javascript
// In renderer.js or DevTools console:
console.log('[PeerJS] Library loaded:', typeof Peer !== 'undefined');
```

PeerJS must be loaded as a global script (NOT as an ES module import) because its ES module build has compatibility issues in Electron's sandboxed renderer.

### 1.2 Create `src/renderer/ice-config.js`

This file holds the shared ICE server configuration used by both the audio mesh (connection.js) and video chat (Phase 5):

```javascript
// Shared ICE server configuration for WebRTC connections.
const ICE_SERVERS = [
  // STUN servers — discover public IP/port for direct P2P
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  // TURN servers — relay fallback for strict NAT/firewall
  // Without TURN, ~20-30% of users behind symmetric NAT cannot connect.
  // These are public OpenRelay project credentials.
  { urls: 'turn:openrelay.metered.ca:80',                username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:80?transport=tcp',  username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp',username: 'openrelayproject', credential: 'openrelayproject' },
];
```

### 1.3 Create `src/renderer/connection.js`

Create the ConnectionManager class skeleton:

```javascript
// connection.js — ConnectionManager class
// Manages P2P mesh networking, text chat, file sharing, host migration

export class ConnectionManager {
  constructor() {
    this.peer = null;           // PeerJS Peer instance
    this.peers = new Map();     // peerId → { call, dataConn, stream, info }
    this.isHost = false;
    this.roomId = null;
    this.peerOrder = [];        // Ordered list of peer IDs (for host migration)
    this.displayName = '';
    this.password = null;       // Room password (null = open room)

    this._pendingCalls = new Map();  // For password-protected rooms

    // Callbacks (set by renderer.js)
    this.onRemoteStream = null;      // (peerId, stream) → play remote audio
    this.onRemoteStreamRemoved = null;
    this.onPeerJoined = null;        // (peerId, peerInfo) → update UI
    this.onPeerLeft = null;          // (peerId) → update UI
    this.onChatMessage = null;       // (senderName, text, timestamp) → show in chat
    this.onFileAnnounce = null;      // (peerId, fileId, fileName, fileSize, totalChunks, fileType)
    this.onFileReceived = null;      // (fileId, fileName, fileType, blob)
    this.onConnectionStateChange = null;  // (state) → update UI
    this.onGetProcessedTrack = null; // () → returns processedTrack from AudioManager
    this.onHostMigration = null;     // (newHostId, isMe) → update UI
    this.onRoomFull = null;          // () → show error
    this.onPasswordRequired = null;  // () → show password modal
    this.onJoinRejected = null;      // (reason) → show error
  }

  _generateRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let suffix = '';
    for (let i = 0; i < 5; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return `icevox-${suffix}`;
  }

  _validateRoomId(roomId) {
    return /^icevox-[a-z0-9]{5}$/.test(roomId);
  }

  _createPeer(peerId) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerId, {
        debug: 2,  // Log level: 0=none, 1=errors, 2=warnings, 3=all
        config: {
          iceServers: ICE_SERVERS,
        }
      });

      peer.on('open', (id) => {
        console.log(`[PeerJS] Connected to signaling server as: ${id}`);
        resolve(peer);
      });

      peer.on('error', (err) => {
        console.error(`[PeerJS] Error: ${err.type} — ${err.message}`);
        reject(err);
      });

      peer.on('disconnected', () => {
        console.warn('[PeerJS] Disconnected from signaling server');
      });

      // Timeout after 15 seconds
      setTimeout(() => reject(new Error('PeerJS connection timeout')), 15000);
    });
  }

  // ... methods added in subsequent steps
}
```

### 1.4 Import and initialize in renderer.js

```javascript
import { ConnectionManager } from './connection.js';

const connectionManager = new ConnectionManager();
```

### 1.5 Make ICE_SERVERS accessible

Since `ice-config.js` is loaded as a plain script (not a module), `ICE_SERVERS` is available globally. Alternatively, import it if you structure it as a module — but ensure it's accessible from both `connection.js` and `video-renderer.js` (Phase 5).

## Verification
- [ ] `typeof Peer` returns `'function'` in the DevTools console
- [ ] ConnectionManager class imports successfully in renderer.js
- [ ] `_generateRoomId()` produces IDs matching the pattern `icevox-XXXXX`
- [ ] `_validateRoomId()` returns true for valid IDs, false for invalid ones
- [ ] No console errors
