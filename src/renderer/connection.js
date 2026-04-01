// Connection module - manages all P2P networking via PeerJS
// PeerJS is loaded globally via script tag in index.html
// Phase 5: Mesh networking — all peers connected to all other peers

class ConnectionManager {
  constructor() {
    this.peer = null;           // PeerJS Peer instance
    this.roomId = null;         // Active room ID
    this.isHost = false;        // Is this instance the host?
    this.state = 'disconnected'; // disconnected | connecting | waiting | connected | error
    this.localStream = null;    // Local MediaStream (for sending)

    // Phase 5: Multi-peer support
    this.peers = new Map();     // peerId → { call, dataConn, stream, info, lastPong }
    this.peerOrder = [];        // Ordered list of peer IDs (first = host), used for host migration

    // Display name
    this.displayName = null;

    // Chat history (in-memory, not persistent)
    this.chatHistory = [];
    this.maxHistorySize = 200;

    // Callbacks
    this.onStateChange = null;         // (newState, oldState)
    this.onRemoteStream = null;        // (peerId, stream|null)
    this.onPeerJoined = null;          // (peerId, peerInfo)
    this.onPeerLeft = null;            // (peerId)
    this.onError = null;               // (error)
    this.onChatMessage = null;         // (peerId, messageData)
    this.onHostMigration = null;       // (newHostId, newRoomId)
    this.onGetProcessedTrack = null;   // () => track — callback to get processed audio track for replaceTrack()
    this.onVideoSignal = null;         // (fromPeerId, signalData) — relay video signaling to video window

    // Timers
    this._connectionTimeout = null;
    this._keepAliveInterval = null;
    this._migrationFallbackTimer = null;

    // Password protection
    this.roomPassword = null;       // Password required to join (null = open room)
    this._pendingCalls = new Map(); // peerId → { call?, dataConn? } awaiting password verification

    // File transfer
    this._storedFiles = new Map();   // fileId → { fileName, fileType, buffer } — sender keeps file here
    this._incomingFiles = new Map(); // fileId → { fileName, fileType, totalChunks, chunks[], received }
    this.onFileReceived = null;      // (fileId, fileName, fileType, blob) — called when all chunks assembled
  }

  // ==================== PEER CREATION ====================

  async createPeer(roomId = null) {
    const peerId = roomId || this._generateRoomId();

    this._setState('connecting');

    return new Promise((resolve, reject) => {
      this.peer = new window.Peer(peerId, {
        debug: 2,  // 0=nothing, 1=errors, 2=warnings, 3=all
        config: {
          iceServers: ICE_SERVERS  // Shared config from ice-config.js
        }
      });

      this.peer.on('open', (id) => {
        console.log(`[PeerJS] Connected to signaling server. Peer ID: ${id}`);
        this.roomId = id;
        resolve(id);
      });

      this.peer.on('error', (err) => {
        console.error(`[PeerJS] Error: ${err.type} — ${err.message}`);
        this._setState('error');
        if (this.onError) this.onError(err);

        if (err.type === 'unavailable-id') {
          console.error('[PeerJS] Room ID already taken');
        } else if (err.type === 'network') {
          console.error('[PeerJS] Cannot reach signaling server');
        } else if (err.type === 'peer-unavailable') {
          console.error('[PeerJS] Target peer not found — room may have moved after host migration');
        }

        reject(err);
      });

      this.peer.on('disconnected', () => {
        console.warn('[PeerJS] Lost connection to signaling server');
        if (!this.peer.destroyed) {
          console.log('[PeerJS] Attempting reconnect...');
          this.peer.reconnect();
        }
      });

      this.peer.on('close', () => {
        console.log('[PeerJS] Peer destroyed');
        this._setState('disconnected');
      });
    });
  }

  _generateRoomId() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let id = 'icevox-';
    for (let i = 0; i < 5; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  _setState(newState) {
    const oldState = this.state;
    this.state = newState;
    console.log(`[Room] State: ${oldState} → ${newState}`);
    if (this.onStateChange) {
      this.onStateChange(newState, oldState);
    }
  }

  getState() {
    return this.state;
  }

  getRoomId() {
    return this.roomId;
  }

  getInviteLink() {
    if (!this.roomId) return null;
    return `https://icevox.net/join/${this.roomId}`;
  }

  getProtocolLink() {
    if (!this.roomId) return null;
    return `icevox://join/${this.roomId}`;
  }

  // ==================== PEER MANAGEMENT ====================

  _addPeer(peerId, call, dataConn) {
    if (this.peers.has(peerId)) {
      console.warn(`[Mesh] Peer ${peerId} already registered — updating`);
    }

    this.peers.set(peerId, {
      id: peerId,
      call: call,
      dataConn: dataConn,
      stream: null,
      info: { name: peerId },
      lastPong: Date.now()
    });

    // Add to peer order for host migration
    if (!this.peerOrder.includes(peerId)) {
      this.peerOrder.push(peerId);
    }

    console.log(`[Mesh] Peer added: ${peerId}. Total peers: ${this.peers.size}`);
  }

  _removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Capture whether the removed peer was the host BEFORE modifying peerOrder
    const wasHost = this.peerOrder.length > 0 && this.peerOrder[0] === peerId;

    if (peer.call) peer.call.close();
    if (peer.dataConn) peer.dataConn.close();
    // NOTE: Do NOT stop remote stream tracks here — audio.js manages playback via <audio> elements

    this.peers.delete(peerId);
    this.peerOrder = this.peerOrder.filter(id => id !== peerId);

    console.log(`[Mesh] Peer removed: ${peerId}. Remaining: ${this.peers.size}. Was host: ${wasHost}`);

    // Emit system message
    this._emitSystemMessage(`${peer.info?.name || peerId} left the room`);

    // Notify UI
    if (this.onPeerLeft) this.onPeerLeft(peerId);
    if (this.onRemoteStream) this.onRemoteStream(peerId, null);

    // If we are host, announce peer departure to others
    if (this.isHost) {
      const message = JSON.stringify({
        type: 'peer-left',
        peerId: peerId,
        order: this.peerOrder
      });

      this.peers.forEach((p) => {
        if (p.dataConn && p.dataConn.open) {
          p.dataConn.send(message);
        }
      });
    }

    // If the removed peer was the host and we are NOT host, trigger migration
    if (wasHost && !this.isHost) {
      console.log(`[Migration] Host ${peerId} disconnected — checking if I should become host`);
      this._checkIfIShouldBecomeHost();
    }

    this._updateState();
  }

  _shouldInitiateTo(otherPeerId) {
    // Initiator rule: lower peer ID initiates the connection.
    // Prevents duplicate connections when both sides learn about each other simultaneously.
    return this.peer.id < otherPeerId;
  }

  _canAcceptPeer() {
    const MAX_PEERS = 5; // Max 5 other peers (6 total including host)
    return this.peers.size < MAX_PEERS;
  }

  // ==================== CREATE ROOM (HOST) ====================

  async createRoom(localStream, password = null) {
    if (!localStream) {
      throw new Error('No local audio stream available. Start audio first.');
    }

    this.isHost = true;
    this.localStream = localStream;
    this.roomPassword = password ? password.trim() : null;
    if (this.roomPassword) {
      console.log(`[Room] Room created with password protection`);
    }

    const tracks = localStream.getAudioTracks();
    console.log(`[Room] Creating room with local stream:`, {
      id: localStream.id,
      tracks: tracks.length,
      trackLabels: tracks.map(t => t.label)
    });

    const roomId = await this.createPeer();

    this._setState('waiting');

    // Own peer ID is first in order (host = first)
    this.peerOrder = [this.peer.id];

    // Listen for ALL incoming calls (not just one like Phase 4)
    this.peer.on('call', (call) => {
      console.log(`[Mesh] Incoming call from: ${call.peer}`);
      this._handleIncomingCall(call);
    });

    // Listen for incoming data connections
    this.peer.on('connection', (dataConn) => {
      console.log(`[Mesh] Incoming data connection from: ${dataConn.peer}`);
      this._handleIncomingDataConnection(dataConn);
    });

    console.log(`[Room] Room created. ID: ${roomId}. Waiting for guests...`);
    return roomId;
  }

  // ==================== JOIN ROOM (GUEST) ====================

  async joinRoom(roomId, localStream, password = '') {
    if (!localStream) {
      throw new Error('No local audio stream available. Start audio first.');
    }
    if (!roomId || typeof roomId !== 'string') {
      throw new Error('Invalid room ID');
    }

    roomId = roomId.trim().toLowerCase();

    this.isHost = false;
    this.localStream = localStream;

    const tracks = localStream.getAudioTracks();
    console.log(`[Room] Joining room with local stream:`, {
      id: localStream.id,
      tracks: tracks.length,
      trackLabels: tracks.map(t => t.label)
    });

    await this.createPeer();
    // Override roomId: createPeer() sets it to our own peer ID, but for a guest
    // the roomId should be the HOST's peer ID (= the room we're joining).
    // Our own peer ID is always available via this.peer.id.
    this.roomId = roomId;
    this._setState('connecting');
    console.log(`[Room] Joining room: ${roomId} (our peer ID: ${this.peer.id})`);

    // 1. Open data connection to host (for control messages)
    const dataConn = this.peer.connect(roomId, { reliable: true });

    dataConn.on('open', () => {
      console.log(`[Mesh] Data channel to host open`);

      // Always send a join-request as the first message.
      // If the host has no password, an empty password is accepted.
      dataConn.send(JSON.stringify({ type: 'join-request', password: password || '' }));

      const existing = this.peers.get(roomId);
      if (existing) {
        existing.dataConn = dataConn;
      } else {
        this._addPeer(roomId, null, dataConn);
      }
    });

    dataConn.on('data', (data) => {
      this._handleDataMessage(roomId, data);
    });

    dataConn.on('close', () => {
      console.log(`[Mesh] Data channel to host closed`);
    });

    dataConn.on('error', (err) => {
      console.error(`[Mesh] Data channel error to host: ${err}`);
      this._setState('error');
      if (this.onError) this.onError(err);
    });

    // 2. Call host (audio) — SIMULTANEOUSLY, not nested in data connection open callback
    const call = this.peer.call(roomId, this.localStream);
    if (call) {
      this._setupOutgoingCall(roomId, call);
    } else {
      console.error('[Mesh] Failed to call host');
    }

    // 3. Listen for incoming connections from OTHER peers (mesh)
    this.peer.on('call', (incomingCall) => {
      console.log(`[Mesh] Incoming call from peer: ${incomingCall.peer}`);
      this._handleIncomingCall(incomingCall);
    });

    this.peer.on('connection', (conn) => {
      console.log(`[Mesh] Incoming data connection from peer: ${conn.peer}`);
      this._handleIncomingDataConnection(conn);
    });

    // Timeout
    this._connectionTimeout = setTimeout(() => {
      if (this.state === 'connecting') {
        console.error('[Room] Connection timeout — no response from host');
        this._setState('error');
        if (this.onError) this.onError(new Error('Connection timeout. Room may not exist or host is unreachable.'));
        this.leaveRoom();
      }
    }, 15000);
  }

  // ==================== INCOMING CALL HANDLING ====================

  _handleIncomingCall(call) {
    const peerId = call.peer;

    if (this.roomPassword) {
      // Password-protected room: store the call without answering.
      // It will be answered in _handleDataMessage once join-request is verified.
      const pending = this._pendingCalls.get(peerId) || {};
      pending.call = call;
      this._pendingCalls.set(peerId, pending);
      console.log(`[Mesh] Stored pending call from ${peerId} (awaiting password verification)`);
      return;
    }

    // Open room: process immediately
    if (!this._canAcceptPeer() && !this.peers.has(peerId)) {
      console.warn(`[Mesh] Room full. Rejecting: ${peerId}`);
      call.close();
      return;
    }

    call.answer(this.localStream);
    console.log(`[Mesh] Answered call from: ${peerId}`);

    const existing = this.peers.get(peerId);
    if (existing) {
      existing.call = call;
    } else {
      this._addPeer(peerId, call, null);
    }

    this._setupAnsweredCall(call);
  }

  // Set up stream/close/error events on an already-answered call.
  // Extracted so it can be called from both _handleIncomingCall (open rooms)
  // and the join-request handler (password-protected rooms).
  _setupAnsweredCall(call) {
    const peerId = call.peer;

    call.on('stream', (remoteStream) => {
      console.log(`[Mesh] Received stream from: ${peerId}`);
      const peer = this.peers.get(peerId);
      if (peer) peer.stream = remoteStream;
      if (this.onRemoteStream) this.onRemoteStream(peerId, remoteStream);
      this._replaceWithProcessedTrack(call);
      this._updateState();
    });

    call.on('close', () => {
      console.log(`[Mesh] Call closed: ${peerId}`);
      this._removePeer(peerId);
    });

    call.on('error', (err) => {
      console.error(`[Mesh] Call error (${peerId}): ${err}`);
      this._removePeer(peerId);
    });

    this._monitorCallHealth(call, peerId);
  }

  // ==================== INCOMING DATA CONNECTION HANDLING ====================

  _handleIncomingDataConnection(dataConn) {
    const peerId = dataConn.peer;

    dataConn.on('open', () => {
      console.log(`[Mesh] Data channel open with: ${peerId}`);

      if (this.isHost && this.roomPassword) {
        // Password-protected: store pending and wait for join-request message.
        // Capacity check + peer setup happen in the join-request handler.
        const pending = this._pendingCalls.get(peerId) || {};
        pending.dataConn = dataConn;
        this._pendingCalls.set(peerId, pending);
        console.log(`[Mesh] Stored pending data connection from ${peerId} (awaiting password)`);
        return;
      }

      // Open room: proceed immediately
      if (!this._canAcceptPeer() && !this.peers.has(peerId)) {
        dataConn.send(JSON.stringify({ type: 'room-full' }));
        console.log(`[Room] Room full — rejected: ${peerId}`);
        setTimeout(() => dataConn.close(), 1000);
        return;
      }

      const existing = this.peers.get(peerId);
      if (existing) {
        existing.dataConn = dataConn;
      } else {
        this._addPeer(peerId, null, dataConn);
      }

      if (this.isHost) {
        this._sendPeerList(dataConn);
        this._announceNewPeer(peerId);
      }

      this._sendPeerInfoTo(dataConn);
    });

    dataConn.on('data', (data) => {
      this._handleDataMessage(peerId, data);
    });

    dataConn.on('close', () => {
      console.log(`[Mesh] Data channel closed: ${peerId}`);
    });

    dataConn.on('error', (err) => {
      console.error(`[Mesh] Data channel error (${peerId}): ${err}`);
    });
  }

  // ==================== OUTGOING CALL SETUP ====================

  _setupOutgoingCall(peerId, call) {
    if (!call) {
      console.error(`[Mesh] Failed to call ${peerId}`);
      return;
    }

    // Register or update peer with call
    const existing = this.peers.get(peerId);
    if (existing) {
      existing.call = call;
    } else {
      this._addPeer(peerId, call, null);
    }

    call.on('stream', (remoteStream) => {
      console.log(`[Mesh] Received stream from: ${peerId}`);
      const peer = this.peers.get(peerId);
      if (peer) peer.stream = remoteStream;
      if (this.onRemoteStream) this.onRemoteStream(peerId, remoteStream);

      // Clear connection timeout on first successful connection
      if (this._connectionTimeout) {
        clearTimeout(this._connectionTimeout);
        this._connectionTimeout = null;
      }

      // SENDER-SIDE EFFECTS: Replace raw mic track with processed track
      this._replaceWithProcessedTrack(call);

      this._updateState();
    });

    call.on('close', () => {
      console.log(`[Mesh] Call to ${peerId} closed`);
      this._removePeer(peerId);
    });

    call.on('error', (err) => {
      console.error(`[Mesh] Call error (${peerId}): ${err}`);
    });

    this._monitorCallHealth(call, peerId);
  }

  // ==================== CONNECT TO PEER (MESH) ====================

  _connectToPeer(peerId) {
    console.log(`[Mesh] Initiating connection to peer: ${peerId}`);

    // Data connection (independent)
    const dataConn = this.peer.connect(peerId, { reliable: true });

    dataConn.on('open', () => {
      console.log(`[Mesh] Data channel to ${peerId} open`);
      const existing = this.peers.get(peerId);
      if (existing) {
        existing.dataConn = dataConn;
      } else {
        this._addPeer(peerId, null, dataConn);
      }

      // Send our peer info
      this._sendPeerInfoTo(dataConn);
    });

    dataConn.on('data', (data) => {
      this._handleDataMessage(peerId, data);
    });

    dataConn.on('close', () => {
      console.log(`[Mesh] Data channel to ${peerId} closed`);
    });

    dataConn.on('error', (err) => {
      console.error(`[Mesh] Data connection error (${peerId}): ${err}`);
    });

    // Call (independent — sent simultaneously, not in open callback)
    const call = this.peer.call(peerId, this.localStream);
    this._setupOutgoingCall(peerId, call);
  }

  // ==================== PEER LIST & ANNOUNCEMENTS ====================

  _sendPeerList(dataConn) {
    const peerList = Array.from(this.peers.keys()).filter(id => id !== dataConn.peer);
    const message = {
      type: 'peer-list',
      peers: peerList,
      order: this.peerOrder
    };
    dataConn.send(JSON.stringify(message));
    console.log(`[Mesh] Sent peer list to ${dataConn.peer}: ${peerList.length} peers`);
  }

  _announceNewPeer(newPeerId) {
    if (!this.isHost) return;

    // Update peerOrder
    if (!this.peerOrder.includes(newPeerId)) {
      this.peerOrder.push(newPeerId);
    }

    const message = JSON.stringify({
      type: 'new-peer',
      peerId: newPeerId,
      order: this.peerOrder
    });

    // Send to all EXCEPT the new peer (they already got the peer list)
    this.peers.forEach((peer, id) => {
      if (id !== newPeerId && peer.dataConn && peer.dataConn.open) {
        peer.dataConn.send(message);
      }
    });

    console.log(`[Mesh] Announced new peer ${newPeerId} to ${this.peers.size - 1} existing peers`);
  }

  // ==================== DATA MESSAGE HANDLING ====================

  _handleDataMessage(fromPeerId, rawData) {
    let data;
    try {
      data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch (e) {
      console.warn(`[Mesh] Invalid message from ${fromPeerId}:`, rawData);
      return;
    }

    switch (data.type) {
      case 'peer-list':
        console.log(`[Mesh] Received peer list: ${data.peers.length} peers`);
        this.peerOrder = data.order;
        // Connect to each peer in the list — but ONLY if we should initiate (lower ID)
        data.peers.forEach(peerId => {
          if (peerId !== this.peer.id && !this.peers.has(peerId)) {
            if (this._shouldInitiateTo(peerId)) {
              this._connectToPeer(peerId);
            } else {
              console.log(`[Mesh] Waiting for ${peerId} to connect to us (initiator rule)`);
            }
          }
        });
        break;

      case 'new-peer':
        console.log(`[Mesh] New peer announced: ${data.peerId}`);
        if (data.peerId !== this.peer.id && !this.peers.has(data.peerId)) {
          if (this._shouldInitiateTo(data.peerId)) {
            this._connectToPeer(data.peerId);
          } else {
            console.log(`[Mesh] Waiting for ${data.peerId} to connect to us (initiator rule)`);
          }
        }
        this.peerOrder = data.order || this.peerOrder;
        break;

      case 'peer-left':
        console.log(`[Room] Peer left: ${data.peerId}`);
        this._removePeer(data.peerId);
        this.peerOrder = data.order || this.peerOrder;
        break;

      case 'peer-order':
        this.peerOrder = data.order;
        console.log(`[Room] Updated peer order: ${data.order.join(', ')}`);
        break;

      case 'peer-info':
        {
          const targetId = data.peerId || fromPeerId;
          const peer = this.peers.get(targetId);
          if (peer) {
            peer.info = { name: data.name };
            console.log(`[Room] Peer info: ${targetId} → "${data.name}"`);
            if (this.onPeerJoined) this.onPeerJoined(targetId, peer.info);
          }
        }
        break;

      case 'room-full':
        console.warn('[Room] Room is full');
        this._setState('error');
        if (this.onError) this.onError(new Error('Room is full (max 6 participants)'));
        this.leaveRoom();
        break;

      case 'chat':
        if (!this._validateChatMessage(data)) {
          console.warn(`[Chat] Invalid message from ${fromPeerId}`);
          break;
        }
        console.log(`[Chat] Message from ${fromPeerId}: "${data.message?.substring(0, 50)}"`);
        this._emitChatEvent(fromPeerId, {
          text: data.message,
          senderName: data.senderName || fromPeerId,
          timestamp: data.timestamp || Date.now(),
          isLocal: false
        });
        break;

      case 'file-announce':
        // Remote peer is sharing a file — store metadata, show card in chat
        if (!data.fileId || !data.fileName || !data.totalChunks) break;
        // Security: cap chunk count to prevent memory exhaustion (10 MB / 32 KB = 320)
        const maxChunks = Math.ceil(10 * 1024 * 1024 / (32 * 1024));
        if (data.totalChunks > maxChunks || data.totalChunks < 1) {
          console.warn(`[File] Rejected file announce with invalid chunk count: ${data.totalChunks}`);
          break;
        }
        // Security: validate MIME type format (type/subtype, alphanumeric + dash/dot/plus)
        const claimedType = data.fileType || 'application/octet-stream';
        const safeFileType = /^[a-z]+\/[a-z0-9.+-]+$/i.test(claimedType)
          ? claimedType : 'application/octet-stream';
        this._incomingFiles.set(data.fileId, {
          fileName: data.fileName,
          fileType: safeFileType,
          fileSize: data.fileSize || 0,
          totalChunks: data.totalChunks,
          senderId: data.senderId || fromPeerId,
          chunks: new Array(data.totalChunks),
          received: 0
        });
        this._emitChatEvent(fromPeerId, {
          isFile: true,
          fileId: data.fileId,
          fileName: data.fileName,
          fileType: safeFileType,
          fileSize: data.fileSize || 0,
          senderId: data.senderId || fromPeerId,
          senderName: data.senderName || fromPeerId,
          timestamp: data.timestamp || Date.now(),
          isLocal: false
        });
        break;

      case 'file-request':
        // A peer is requesting a file we shared — send the chunks
        if (!data.fileId) break;
        this._sendFileChunksTo(fromPeerId, data.fileId);
        break;

      case 'file-chunk':
        // Receiving a chunk from the sender
        if (!data.fileId) break;
        this._receiveFileChunk(data);
        break;

      case 'host-migration':
        console.log(`[Migration] New host announced: ${data.newHostId}`);

        // Clear any fallback timer
        if (this._migrationFallbackTimer) {
          clearTimeout(this._migrationFallbackTimer);
          this._migrationFallbackTimer = null;
        }

        // If WE tried to become host but someone else won (earlier in order)
        if (this.isHost && data.newHostId !== this.peer.id) {
          if (data.order.indexOf(data.newHostId) < data.order.indexOf(this.peer.id)) {
            console.log('[Migration] Another peer took host role — stepping down');
            this.isHost = false;
          }
        }

        // Update order
        this.peerOrder = data.order || this.peerOrder;

        // Update room ID to new host's ID
        if (data.newRoomId && data.newRoomId !== this.roomId) {
          console.log(`[Migration] Room ID changed: ${this.roomId} → ${data.newRoomId}`);
          this.roomId = data.newRoomId;
        }

        // Emit system message
        this._emitSystemMessage(`Host changed. New room ID: ${data.newRoomId}`);

        // Notify UI
        if (this.onHostMigration) {
          this.onHostMigration(data.newHostId, data.newRoomId);
        }
        break;

      case 'ping':
        {
          const peerEntry = this.peers.get(fromPeerId);
          if (peerEntry && peerEntry.dataConn && peerEntry.dataConn.open) {
            peerEntry.dataConn.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
          }
        }
        break;

      case 'pong':
        {
          const p = this.peers.get(fromPeerId);
          if (p) {
            p.lastPong = Date.now();
            p.latency = Date.now() - data.timestamp;
          }
        }
        break;

      case 'effectParams':
        // Legacy Phase 4 — informational only with sender-side effects
        console.log(`[DataChannel] Received effect params from ${fromPeerId} (informational)`);
        break;

      case 'join-request':
        if (!this.isHost) break;
        {
          const pending = this._pendingCalls.get(fromPeerId);

          if (!pending) {
            // Open room (no password): join-request is silently ignored — peer-list was already sent
            break;
          }

          const passwordOk = data.password === (this.roomPassword || '');
          const roomOk = this._canAcceptPeer() || this.peers.has(fromPeerId);

          if (passwordOk && roomOk) {
            this._pendingCalls.delete(fromPeerId);

            // Register the peer
            this._addPeer(fromPeerId, pending.call || null, pending.dataConn || null);

            // Answer the pending audio call and wire up its events
            if (pending.call) {
              pending.call.answer(this.localStream);
              console.log(`[Mesh] Answered pending call from ${fromPeerId} (password verified)`);
              this._setupAnsweredCall(pending.call);
            }

            // Notify guest, deliver peer list, announce to existing peers
            if (pending.dataConn && pending.dataConn.open) {
              pending.dataConn.send(JSON.stringify({ type: 'join-approved' }));
              this._sendPeerList(pending.dataConn);
              this._announceNewPeer(fromPeerId);
              this._sendPeerInfoTo(pending.dataConn);
            }
          } else {
            this._pendingCalls.delete(fromPeerId);
            const reason = !passwordOk ? 'Wrong password' : 'Room is full';
            console.log(`[Room] Rejected ${fromPeerId}: ${reason}`);
            if (pending.dataConn && pending.dataConn.open) {
              pending.dataConn.send(JSON.stringify({ type: 'join-rejected', reason }));
              setTimeout(() => { try { pending.dataConn.close(); } catch (e) {} }, 800);
            }
            if (pending.call) {
              try { pending.call.close(); } catch (e) {}
            }
          }
        }
        break;

      case 'join-approved':
        console.log('[Room] Join approved by host');
        break;

      case 'join-rejected':
        console.warn(`[Room] Join rejected: ${data.reason}`);
        this._setState('error');
        if (this.onError) this.onError(new Error(data.reason || 'Connection rejected by host'));
        this.leaveRoom();
        break;

      case 'kicked':
        console.warn('[Room] Removed from room by host');
        this._setState('error');
        if (this.onError) this.onError(new Error('You were removed from the room by the host'));
        this.leaveRoom();
        break;

      case 'video-signal':
        // Relay video signaling (SDP offer/answer/ICE) to the video window
        console.log(`[Video] Received video-signal from ${fromPeerId} via data channel. Has callback: ${!!this.onVideoSignal}, Has signal: ${!!data.signal}`);
        if (this.onVideoSignal && data.signal) {
          this.onVideoSignal(fromPeerId, data.signal);
        }
        break;

      default:
        console.warn(`[Mesh] Unknown message type: ${data.type}`);
    }
  }

  // ==================== HOST CONTROLS ====================

  kickPeer(peerId) {
    if (!this.isHost) {
      console.warn('[Room] Only the host can kick peers');
      return;
    }
    const peer = this.peers.get(peerId);
    if (!peer) {
      console.warn(`[Room] Cannot kick: peer ${peerId} not found`);
      return;
    }
    // Send kick message then close the connection shortly after
    if (peer.dataConn && peer.dataConn.open) {
      peer.dataConn.send(JSON.stringify({ type: 'kicked' }));
    }
    setTimeout(() => {
      this._removePeer(peerId);
      console.log(`[Room] Kicked peer: ${peerId}`);
    }, 300);
  }

  setRoomPassword(password) {
    this.roomPassword = password ? password.trim() : null;
    console.log(`[Room] Room password ${this.roomPassword ? 'updated' : 'cleared'}`);
  }

  // ==================== VIDEO SIGNALING ====================

  sendVideoSignal(peerId, signal) {
    // Send video signaling data (SDP offer/answer/ICE candidate) to a specific peer
    const peer = this.peers.get(peerId);
    if (peer && peer.dataConn && peer.dataConn.open) {
      peer.dataConn.send(JSON.stringify({ type: 'video-signal', signal }));
      console.log(`[Video] Sent video-signal to ${peerId} via data channel. Signal type: ${signal.type}`);
    } else {
      console.warn(`[Video] Cannot send signal to ${peerId}: no open data channel (peer exists: ${!!peer}, dataConn: ${!!(peer && peer.dataConn)}, open: ${!!(peer && peer.dataConn && peer.dataConn.open)})`);
    }
  }

  broadcastVideoSignal(signal) {
    // Send video signaling to ALL connected peers
    const message = JSON.stringify({ type: 'video-signal', signal });
    this.peers.forEach((peer, id) => {
      if (peer.dataConn && peer.dataConn.open) {
        peer.dataConn.send(message);
      }
    });
  }

  getConnectedPeerIds() {
    // Return list of currently connected peer IDs (for video window to know who to connect to)
    return Array.from(this.peers.keys());
  }

  getOwnPeerId() {
    return this.peer ? this.peer.id : null;
  }

  // ==================== SENDER-SIDE EFFECTS ====================

  _replaceWithProcessedTrack(call) {
    // SENDER-SIDE EFFECTS: After PeerJS sets up the call with raw mic,
    // swap the audio sender's track with the processed track from sendWorkletNode.
    // This ensures WebRTC transmits audio with effects applied.

    if (!this.onGetProcessedTrack) {
      console.warn('[WebRTC] No onGetProcessedTrack callback set — sending raw audio');
      return;
    }

    const processedTrack = this.onGetProcessedTrack();
    if (!processedTrack) {
      console.error('[WebRTC] Could not get processed track — sending raw audio');
      return;
    }

    const pc = call.peerConnection;
    if (!pc) {
      console.error('[WebRTC] peerConnection not available — cannot replace track');
      return;
    }

    const senders = pc.getSenders();
    const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

    if (!audioSender) {
      console.error('[WebRTC] No audio sender found — cannot replace track');
      return;
    }

    console.log('[WebRTC] Replacing raw mic track with processed track...');

    audioSender.replaceTrack(processedTrack)
      .then(() => {
        console.log('[WebRTC] ✓ Successfully replaced with processed track (sender-side effects active)');
        // Configure Opus for higher quality audio (default is ~32kbps).
        // 128kbps provides noticeably clearer voice — comparable to Discord's
        // voice quality. Bandwidth per peer: 128kbps (trivial for modern connections).
        const params = audioSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = 128000; // 128kbps Opus
        audioSender.setParameters(params)
          .then(() => console.log('[WebRTC] ✓ Opus bitrate set to 128kbps'))
          .catch(err => console.warn('[WebRTC] Could not set bitrate:', err));
      })
      .catch(err => {
        console.error('[WebRTC] ✗ Failed to replace track:', err);
      });
  }

  // ==================== CALL HEALTH MONITORING ====================

  _monitorCallHealth(call, peerId) {
    const pc = call.peerConnection;

    if (!pc) {
      console.warn(`[WebRTC] call.peerConnection not available for ${peerId} — skipping ICE monitoring`);
      return;
    }

    console.log(`[WebRTC] Monitoring call health for ${peerId}`);

    pc.addEventListener('iceconnectionstatechange', () => {
      const iceState = pc.iceConnectionState;
      console.log(`[WebRTC] ICE state (${peerId}): ${iceState}`);

      switch (iceState) {
        case 'connected':
        case 'completed':
          console.log(`[WebRTC] Peer ${peerId} connected successfully`);
          break;
        case 'disconnected':
          console.warn(`[WebRTC] Peer ${peerId} disconnected — may reconnect`);
          break;
        case 'failed':
          console.error(`[WebRTC] Connection to ${peerId} failed`);
          this._removePeer(peerId);
          break;
        case 'closed':
          console.log(`[WebRTC] Connection to ${peerId} closed`);
          this._removePeer(peerId);
          break;
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      console.log(`[WebRTC] Connection state (${peerId}): ${pc.connectionState}`);
    });

    // Monitor track events — workaround for PeerJS stream event not firing
    pc.addEventListener('track', (event) => {
      console.log(`[WebRTC] ontrack event (${peerId}):`, {
        trackKind: event.track.kind,
        trackEnabled: event.track.enabled,
        streamCount: event.streams.length
      });

      const peer = this.peers.get(peerId);
      if (event.streams && event.streams[0] && peer && !peer.stream) {
        console.log(`[WebRTC] Manually handling stream from ontrack for ${peerId}`);
        const remoteStream = event.streams[0];
        peer.stream = remoteStream;

        // Clear connection timeout
        if (this._connectionTimeout) {
          clearTimeout(this._connectionTimeout);
          this._connectionTimeout = null;
        }

        this._setState('connected');
        if (this.onRemoteStream) this.onRemoteStream(peerId, remoteStream);
      }
    });
  }

  // ==================== KEEP-ALIVE ====================

  _startKeepAlive() {
    if (this._keepAliveInterval) return; // Already running

    this._keepAliveInterval = setInterval(() => {
      const now = Date.now();

      // Send ping to all peers
      this.peers.forEach((peer) => {
        if (peer.dataConn && peer.dataConn.open) {
          peer.dataConn.send(JSON.stringify({ type: 'ping', timestamp: now }));
        }
      });

      // Run dead-peer-detection
      this._checkDeadPeers();
    }, 5000);

    console.log('[Room] Keep-alive started');
  }

  _stopKeepAlive() {
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
      this._keepAliveInterval = null;
      console.log('[Room] Keep-alive stopped');
    }
  }

  _checkDeadPeers() {
    const now = Date.now();
    const timeout = 15000; // 15 seconds without pong = dead

    this.peers.forEach((peer, id) => {
      if (now - peer.lastPong > timeout) {
        console.warn(`[Room] Peer ${id} appears dead (no pong for ${timeout}ms)`);
        this._removePeer(id);
      }
    });
  }

  // ==================== STATE MANAGEMENT ====================

  _updateState() {
    if (this.peers.size > 0) {
      this._setState('connected');
      this._startKeepAlive(); // Idempotent — only starts if not already running
    } else if (this.isHost) {
      this._stopKeepAlive();
      this._setState('waiting');
    } else {
      this._stopKeepAlive();
      this._setState('disconnected');
    }
  }

  // ==================== HOST MIGRATION ====================

  _checkIfIShouldBecomeHost() {
    if (this.isHost) return; // Already host

    // peerOrder has already been updated by _removePeer (host removed).
    // Find the first living peer in the order (including ourselves).
    const nextHost = this.peerOrder.find(id => {
      if (id === this.peer.id) return true;
      const p = this.peers.get(id);
      return p && (p.dataConn?.open || p.call);
    });

    console.log(`[Migration] Evaluating: nextHost=${nextHost}, myId=${this.peer.id}, peerOrder=[${this.peerOrder.join(', ')}]`);

    if (nextHost === this.peer.id) {
      console.log('[Migration] I am next in line — initiating host migration');
      this._becomeHost();
    } else if (nextHost) {
      console.log(`[Migration] Next host should be: ${nextHost}. Waiting...`);
      // Wait 3 seconds — if nobody took over, try ourselves
      this._migrationFallbackTimer = setTimeout(() => {
        if (!this.isHost && this.peers.size > 0) {
          console.log('[Migration] Fallback: No host emerged. Taking over.');
          this._becomeHost();
        }
      }, 3000);
    } else {
      console.warn('[Migration] No viable host candidate found in peerOrder');
    }
  }

  _becomeHost() {
    console.log('[Migration] Becoming new host...');

    const oldRoomId = this.roomId;

    // 1. Set host flag
    this.isHost = true;

    // 2. Room ID changes to our own peer ID
    //    (We do NOT create a new Peer — existing peer already listens for call/connection events)
    this.roomId = this.peer.id;

    // 3. Set peerOrder with us as host (first in list)
    this.peerOrder = [this.peer.id, ...this.peerOrder.filter(id => id !== this.peer.id)];

    // 4. Announce host migration to all peers
    const migrationMsg = JSON.stringify({
      type: 'host-migration',
      newHostId: this.peer.id,
      newRoomId: this.roomId,
      oldRoomId: oldRoomId,
      order: this.peerOrder
    });

    this.peers.forEach((peer) => {
      if (peer.dataConn && peer.dataConn.open) {
        peer.dataConn.send(migrationMsg);
      }
    });

    // 5. Our existing peer already listens on peer.on('call') and peer.on('connection')
    //    (registered in joinRoom). New peers connecting to our peer ID are handled automatically.

    this._updateState();
    console.log(`[Migration] Host migration complete. New room ID: ${this.roomId} (was: ${oldRoomId})`);
  }

  // ==================== CHAT ====================

  sendChatMessage(text) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) return;

    const message = {
      type: 'chat',
      message: text.trim(),
      senderId: this.peer.id,
      senderName: this.displayName || this.peer.id,
      timestamp: Date.now()
    };

    const serialized = JSON.stringify(message);

    // Send to all peers
    let sentCount = 0;
    this.peers.forEach((peer) => {
      if (peer.dataConn && peer.dataConn.open) {
        peer.dataConn.send(serialized);
        sentCount++;
      }
    });

    console.log(`[Chat] Sent message to ${sentCount} peer(s): "${text.substring(0, 50)}"`);

    // Local message: save in history and notify UI
    const localMsg = {
      text: text.trim(),
      senderName: this.displayName || this.peer.id,
      timestamp: Date.now(),
      isLocal: true
    };
    this._emitChatEvent(this.peer.id, localMsg);
  }

  _emitChatEvent(peerId, messageData) {
    // 1. Save in history
    this._addToHistory(peerId, messageData);

    // 2. Notify UI
    if (this.onChatMessage) {
      this.onChatMessage(peerId, messageData);
    }
  }

  _emitSystemMessage(text) {
    this._emitChatEvent(null, {
      text: text,
      senderName: 'System',
      timestamp: Date.now(),
      isLocal: false,
      isSystem: true
    });
  }

  _validateChatMessage(data) {
    if (!data.message || typeof data.message !== 'string') return false;
    if (data.message.trim().length === 0) return false;
    if (data.message.length > 500) return false;
    return true;
  }

  _addToHistory(peerId, messageData) {
    this.chatHistory.push({
      peerId,
      ...messageData
    });

    if (this.chatHistory.length > this.maxHistorySize) {
      this.chatHistory = this.chatHistory.slice(-this.maxHistorySize);
    }
  }

  getChatHistory() {
    return [...this.chatHistory];
  }

  // ==================== FILE TRANSFER ====================

  // Announce a file to all peers, store buffer locally for on-demand sending.
  // Returns { fileId, localCard } so renderer can show a local file card.
  async announceFile(file) {
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_FILE_SIZE) throw new Error('File too large (max 10 MB)');

    const buffer = await file.arrayBuffer();
    const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    const CHUNK_SIZE = 32 * 1024; // 32 KB per chunk
    const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);

    this._storedFiles.set(fileId, { fileName: file.name, fileType: file.type || 'application/octet-stream', buffer });

    const announce = {
      type: 'file-announce',
      fileId,
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
      totalChunks,
      senderName: this.displayName || this.peer?.id,
      senderId: this.peer?.id,
      timestamp: Date.now()
    };

    let sentCount = 0;
    this.peers.forEach((peer) => {
      if (peer.dataConn && peer.dataConn.open) {
        peer.dataConn.send(JSON.stringify(announce));
        sentCount++;
      }
    });

    console.log(`[File] Announced "${file.name}" (${file.size} bytes, ${totalChunks} chunks) to ${sentCount} peer(s)`);

    // Return data so renderer can create the local chat card
    return {
      fileId,
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
      senderName: this.displayName || this.peer?.id,
      senderId: this.peer?.id,
      timestamp: announce.timestamp
    };
  }

  // Request a file from a specific peer. Called when receiver clicks "View / Save".
  requestFile(fileId, senderId) {
    const peer = this.peers.get(senderId);
    if (!peer || !peer.dataConn || !peer.dataConn.open) {
      console.warn(`[File] Cannot request ${fileId} — sender ${senderId} no longer connected`);
      return false;
    }
    peer.dataConn.send(JSON.stringify({ type: 'file-request', fileId }));
    console.log(`[File] Requested file ${fileId} from ${senderId}`);
    return true;
  }

  // Send all chunks of a stored file to a specific peer.
  _sendFileChunksTo(peerId, fileId) {
    const stored = this._storedFiles.get(fileId);
    if (!stored) {
      console.warn(`[File] Requested file ${fileId} not in storage — may have left room`);
      return;
    }
    const peer = this.peers.get(peerId);
    if (!peer || !peer.dataConn || !peer.dataConn.open) return;

    const CHUNK_SIZE = 32 * 1024;
    const buffer = stored.buffer;
    const totalChunks = Math.ceil(buffer.byteLength / CHUNK_SIZE);

    console.log(`[File] Sending "${stored.fileName}" to ${peerId} (${totalChunks} chunks)`);

    const sendChunk = (index) => {
      // Re-check connection on each chunk in case peer disconnected mid-transfer
      const p = this.peers.get(peerId);
      if (!p || !p.dataConn || !p.dataConn.open) return;

      const start = index * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
      const chunk = buffer.slice(start, end);

      // Safe base64 conversion (avoids spread-operator stack limit on large arrays)
      const bytes = new Uint8Array(chunk);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }

      p.dataConn.send(JSON.stringify({
        type: 'file-chunk',
        fileId,
        chunkIndex: index,
        totalChunks,
        data: btoa(binary)
      }));

      if (index + 1 < totalChunks) {
        setTimeout(() => sendChunk(index + 1), 8);
      } else {
        console.log(`[File] Done sending "${stored.fileName}" to ${peerId}`);
      }
    };

    sendChunk(0);
  }

  // Reassemble an incoming file chunk. When all chunks are received, emits onFileReceived.
  _receiveFileChunk(data) {
    const { fileId, chunkIndex, data: base64 } = data;
    const incoming = this._incomingFiles.get(fileId);

    if (!incoming) {
      console.warn(`[File] Received chunk for unknown file ${fileId} — announce may have been missed`);
      return;
    }

    if (chunkIndex < 0 || chunkIndex >= incoming.totalChunks) return; // out of bounds, ignore
    if (incoming.chunks[chunkIndex] !== undefined) return; // duplicate chunk, ignore
    incoming.chunks[chunkIndex] = base64;
    incoming.received++;

    if (incoming.received >= incoming.totalChunks) {
      // Reassemble all chunks into a Blob
      let binary = '';
      for (let i = 0; i < incoming.totalChunks; i++) {
        binary += atob(incoming.chunks[i]);
      }
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: incoming.fileType });

      this._incomingFiles.delete(fileId);
      console.log(`[File] Reassembled "${incoming.fileName}" (${blob.size} bytes)`);

      if (this.onFileReceived) {
        this.onFileReceived(fileId, incoming.fileName, incoming.fileType, blob);
      }
    }
  }

  // ==================== DISPLAY NAME ====================

  setDisplayName(name) {
    this.displayName = name.trim().substring(0, 30);
    // Broadcast updated info to all peers
    this._broadcastPeerInfo();
    console.log(`[Room] Display name set: "${this.displayName}"`);
  }

  getDisplayName() {
    return this.displayName || this.peer?.id || 'Unknown';
  }

  _broadcastPeerInfo() {
    const info = JSON.stringify({
      type: 'peer-info',
      peerId: this.peer.id,
      name: this.displayName || this.peer.id.replace('icevox-', '').substring(0, 8)
    });

    this.peers.forEach((peer) => {
      if (peer.dataConn && peer.dataConn.open) {
        peer.dataConn.send(info);
      }
    });
  }

  _sendPeerInfoTo(dataConn) {
    const info = JSON.stringify({
      type: 'peer-info',
      peerId: this.peer.id,
      name: this.displayName || this.peer.id.replace('icevox-', '').substring(0, 8)
    });

    if (dataConn && dataConn.open) {
      dataConn.send(info);
    }
  }

  // ==================== EFFECT PARAMS (legacy, informational) ====================

  sendEffectParams(params) {
    // Send effect params to all peers via DataChannel (informational with sender-side effects)
    const serialized = JSON.stringify({
      type: 'effectParams',
      params: params
    });

    this.peers.forEach((peer) => {
      if (peer.dataConn && peer.dataConn.open) {
        peer.dataConn.send(serialized);
      }
    });
  }

  isDataChannelOpen() {
    // Returns true if we have at least one open data channel
    for (const [, peer] of this.peers) {
      if (peer.dataConn && peer.dataConn.open) return true;
    }
    return false;
  }

  // ==================== ROOM INFO & DIAGNOSTICS ====================

  getRoomInfo() {
    const peerList = [];
    this.peers.forEach((peer, id) => {
      peerList.push({
        id: id,
        name: peer.info?.name || id,
        hasAudio: peer.stream !== null,
        hasData: peer.dataConn?.open || false
      });
    });

    return {
      roomId: this.roomId,
      isHost: this.isHost,
      state: this.state,
      peerCount: this.peers.size,
      maxPeers: 5,
      peers: peerList,
      peerOrder: this.peerOrder,
      myPeerId: this.peer?.id || null
    };
  }

  getDiagnostics() {
    const info = {
      state: this.state,
      roomId: this.roomId,
      isHost: this.isHost,
      peerOpen: this.peer ? !this.peer.destroyed : false,
      peerCount: this.peers.size,
      peerOrder: this.peerOrder,
      myPeerId: this.peer?.id || null,
      peers: {}
    };

    this.peers.forEach((peer, id) => {
      info.peers[id] = {
        hasCall: peer.call !== null,
        hasDataConn: peer.dataConn !== null,
        dataConnOpen: peer.dataConn?.open || false,
        hasStream: peer.stream !== null,
        name: peer.info?.name || id,
        latency: peer.latency || null,
        lastPong: peer.lastPong
      };
    });

    return info;
  }

  // ==================== LEAVE & CLEANUP ====================

  leaveRoom() {
    console.log('[Room] Leaving room...');

    this._stopKeepAlive();

    if (this._connectionTimeout) {
      clearTimeout(this._connectionTimeout);
      this._connectionTimeout = null;
    }

    if (this._migrationFallbackTimer) {
      clearTimeout(this._migrationFallbackTimer);
      this._migrationFallbackTimer = null;
    }

    // CRITICAL: Prevent cascading disconnections during teardown.
    // When host calls leaveRoom(), closing a call triggers call.on('close') → _removePeer()
    // which (if isHost) would broadcast peer-left to remaining peers, causing them to
    // close their direct P2P connections to each other.
    // Fix: Clear isHost and peers Map BEFORE closing connections.
    this.isHost = false;

    // Collect all connections before clearing the map
    const connections = [];
    this.peers.forEach((peer) => {
      if (peer.call) connections.push(peer.call);
      if (peer.dataConn) connections.push(peer.dataConn);
    });

    // Clean up any pending (unverified) connections
    this._pendingCalls.forEach((pending) => {
      try { if (pending.call) pending.call.close(); } catch (e) {}
      try { if (pending.dataConn) pending.dataConn.close(); } catch (e) {}
    });
    this._pendingCalls.clear();
    this.roomPassword = null;

    // Clear map FIRST — any call.on('close') callbacks will find nothing in peers
    // and _removePeer() will return early
    this.peers.clear();
    this.peerOrder = [];

    // Now close all connections safely
    connections.forEach(conn => {
      try { conn.close(); } catch (e) { /* ignore */ }
    });

    // NOTE: Do NOT stop localStream — it's owned by audio.js

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    this.roomId = null;
    this.localStream = null;
    this.chatHistory = [];
    this._storedFiles.clear();
    this._incomingFiles.clear();
    this._setState('disconnected');

    console.log('[Room] Left room. All connections closed.');
  }

  destroy() {
    this.leaveRoom();
  }
}

// Export singleton instance
const connectionManager = new ConnectionManager();
export default connectionManager;
