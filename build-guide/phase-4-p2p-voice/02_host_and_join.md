# Step 2: Host and Join

## Task
Implement room creation (host flow) and room joining (guest flow) with optional password protection.

## Instructions

### 2.1 Implement `createRoom()`

The host creates a PeerJS Peer whose ID IS the room ID. This means anyone who knows the room ID can connect.

```javascript
async createRoom(sendStream, password = null) {
  this.roomId = this._generateRoomId();
  this.password = password;
  this.isHost = true;

  try {
    this.peer = await this._createPeer(this.roomId);
  } catch (err) {
    console.error('[Room] Failed to create room:', err);
    throw err;
  }

  this.peerOrder = [this.peer.id];
  this._localStream = sendStream;

  // Listen for incoming calls (voice connections)
  this.peer.on('call', (call) => this._handleIncomingCall(call));

  // Listen for incoming data connections (chat, control messages)
  this.peer.on('connection', (conn) => this._handleIncomingDataConnection(conn));

  console.log(`[Room] Created room: ${this.roomId}`);
  if (this.onConnectionStateChange) this.onConnectionStateChange('waiting');

  return this.roomId;
}
```

### 2.2 Implement `joinRoom()`

The guest creates a PeerJS Peer with a random auto-generated ID, then simultaneously opens a data connection AND a voice call to the host (room ID).

```javascript
async joinRoom(roomId, sendStream, password = null) {
  if (!this._validateRoomId(roomId)) {
    throw new Error('Invalid room ID format');
  }

  this.roomId = roomId;
  this.isHost = false;
  this._localStream = sendStream;

  try {
    this.peer = await this._createPeer(null); // auto-generated ID
  } catch (err) {
    console.error('[Room] Failed to create peer:', err);
    throw err;
  }

  // Open data connection to host FIRST (for join-request/approval)
  const dataConn = this.peer.connect(roomId, { reliable: true });

  dataConn.on('open', () => {
    console.log(`[Room] Data channel open to host: ${roomId}`);
    // Send join request with password (if room is password-protected)
    dataConn.send({ type: 'join-request', password: password || '', displayName: this.displayName });
  });

  // Also call the host with voice
  const call = this.peer.call(roomId, this._localStream);

  // Store the pending connection to host
  this.peers.set(roomId, { call, dataConn, stream: null, info: {} });

  // Set up call event handlers
  this._setupCallHandlers(call, roomId);
  this._setupDataHandlers(dataConn, roomId);

  // Listen for incoming calls and data connections from OTHER peers (mesh)
  this.peer.on('call', (incomingCall) => this._handleIncomingCall(incomingCall));
  this.peer.on('connection', (conn) => this._handleIncomingDataConnection(conn));

  // Connection timeout
  this._joinTimeout = setTimeout(() => {
    if (!this.peers.has(roomId) || !this.peers.get(roomId).stream) {
      console.warn('[Room] Join timeout — no response from host');
      if (this.onConnectionStateChange) this.onConnectionStateChange('timeout');
    }
  }, 15000);

  if (this.onConnectionStateChange) this.onConnectionStateChange('connecting');
}
```

### 2.3 Handle incoming calls (host side)

```javascript
_handleIncomingCall(call) {
  const peerId = call.peer;
  console.log(`[Room] Incoming call from: ${peerId}`);

  // Check capacity
  if (this.peers.size >= 5) {
    console.warn(`[Room] Room full — rejecting call from ${peerId}`);
    call.close();
    return;
  }

  if (this.password) {
    // Password-protected: store call as pending, wait for join-request
    this._pendingCalls.set(peerId, call);
    console.log(`[Room] Call from ${peerId} pending password verification`);
  } else {
    // Open room: answer immediately
    this._answerCall(call, peerId);
  }
}
```

### 2.4 Answer a call

```javascript
_answerCall(call, peerId) {
  call.answer(this._localStream);
  console.log(`[Room] Answered call from: ${peerId}`);

  if (!this.peers.has(peerId)) {
    this.peers.set(peerId, { call, dataConn: null, stream: null, info: {} });
  } else {
    this.peers.get(peerId).call = call;
  }

  this._setupCallHandlers(call, peerId);
}
```

### 2.5 Set up call event handlers

```javascript
_setupCallHandlers(call, peerId) {
  call.on('stream', (remoteStream) => {
    console.log(`[WebRTC] Received remote stream from: ${peerId}`);
    const peerData = this.peers.get(peerId);
    if (peerData) peerData.stream = remoteStream;

    if (this.onRemoteStream) this.onRemoteStream(peerId, remoteStream);

    // Replace raw mic track with processed track
    this._replaceWithProcessedTrack(call);

    clearTimeout(this._joinTimeout);
    if (this.onConnectionStateChange) this.onConnectionStateChange('connected');
  });

  call.on('close', () => {
    console.log(`[WebRTC] Call closed with: ${peerId}`);
    this._removePeer(peerId);
  });

  call.on('error', (err) => {
    console.error(`[WebRTC] Call error with ${peerId}:`, err);
    this._removePeer(peerId);
  });
}
```

### 2.6 Handle incoming data connections

```javascript
_handleIncomingDataConnection(conn) {
  const peerId = conn.peer;
  console.log(`[Room] Incoming data connection from: ${peerId}`);

  conn.on('open', () => {
    if (this.peers.has(peerId)) {
      this.peers.get(peerId).dataConn = conn;
    } else {
      this.peers.set(peerId, { call: null, dataConn: conn, stream: null, info: {} });
    }
    this._setupDataHandlers(conn, peerId);
  });
}
```

### 2.7 Handle join request (password verification)

```javascript
_setupDataHandlers(conn, peerId) {
  conn.on('data', (data) => {
    this._handleDataMessage(data, peerId);
  });

  conn.on('close', () => {
    console.log(`[Room] Data channel closed with: ${peerId}`);
  });
}

_handleDataMessage(data, peerId) {
  if (!data || !data.type) return;

  switch (data.type) {
    case 'join-request':
      this._handleJoinRequest(peerId, data);
      break;

    case 'join-approved':
      console.log(`[Room] Join approved by host`);
      clearTimeout(this._joinTimeout);
      if (this.onConnectionStateChange) this.onConnectionStateChange('connected');
      break;

    case 'join-rejected':
      console.warn(`[Room] Join rejected: ${data.reason}`);
      if (this.onJoinRejected) this.onJoinRejected(data.reason);
      break;

    case 'room-full':
      console.warn('[Room] Room is full');
      if (this.onRoomFull) this.onRoomFull();
      break;

    // Additional message types added in later steps...
  }
}

_handleJoinRequest(peerId, data) {
  if (!this.isHost) return;

  if (this.password && data.password !== this.password) {
    // Wrong password
    const conn = this.peers.get(peerId)?.dataConn;
    if (conn) conn.send({ type: 'join-rejected', reason: 'Wrong password' });
    // Close the pending call
    const pendingCall = this._pendingCalls.get(peerId);
    if (pendingCall) pendingCall.close();
    this._pendingCalls.delete(peerId);
    this.peers.delete(peerId);
    return;
  }

  // Password correct (or no password) — answer the pending call
  const pendingCall = this._pendingCalls.get(peerId);
  if (pendingCall) {
    this._answerCall(pendingCall, peerId);
    this._pendingCalls.delete(peerId);
  }

  // Send approval
  const conn = this.peers.get(peerId)?.dataConn;
  if (conn) conn.send({ type: 'join-approved' });

  // Store display name if provided
  if (data.displayName) {
    const peerData = this.peers.get(peerId);
    if (peerData) peerData.info.displayName = data.displayName;
  }
}
```

## Verification
- [ ] Host: clicking "Create" generates a room ID and logs `[Room] Created room: icevox-XXXXX`
- [ ] Guest: entering a valid room ID and clicking "Join" connects to the host
- [ ] Both instances log `[WebRTC] Received remote stream`
- [ ] Password protection: joining with wrong password → rejection message
- [ ] Password protection: joining with correct password → connection succeeds
- [ ] Connection timeout: joining a non-existent room → timeout after 15 seconds
- [ ] No console errors during normal connection flow
