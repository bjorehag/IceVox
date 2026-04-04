# Step 6: Host Migration

## Task
Implement automatic host succession when the current host disconnects.

## Architecture Rule

> **`leaveRoom()` MUST clear `isHost` and the `peers` Map BEFORE closing any connections.**
>
> Without this, closing connections triggers `_removePeer()` callbacks, which check `isHost` and may trigger cascading host migration logic while the room is being torn down. This causes crashes and ghost connections.

## Instructions

### 6.1 Implement `_removePeer()`

When a peer disconnects, clean up their state and check if host migration is needed:

```javascript
_removePeer(peerId) {
  const peerData = this.peers.get(peerId);
  if (!peerData) return; // Already removed

  const wasHost = this.peerOrder.length > 0 && this.peerOrder[0] === peerId;

  // Close connections
  if (peerData.call) {
    try { peerData.call.close(); } catch (e) {}
  }
  if (peerData.dataConn) {
    try { peerData.dataConn.close(); } catch (e) {}
  }

  this.peers.delete(peerId);

  // Remove from peer order
  this.peerOrder = this.peerOrder.filter(id => id !== peerId);

  // Notify UI
  if (this.onRemoteStreamRemoved) this.onRemoteStreamRemoved(peerId);
  if (this.onPeerLeft) this.onPeerLeft(peerId);

  console.log(`[Mesh] Peer removed: ${peerId} (was host: ${wasHost})`);

  // Check if we need host migration
  if (wasHost && !this.isHost && this.peers.size > 0) {
    this._checkIfIShouldBecomeHost();
  }

  // If host, broadcast updated peer order
  if (this.isHost) {
    this._broadcastPeerOrder();
  }
}
```

### 6.2 Host migration logic

```javascript
_checkIfIShouldBecomeHost() {
  // Find the first living peer in the order (should be the new host)
  const livingPeers = this.peerOrder.filter(id =>
    id === this.peer.id || this.peers.has(id)
  );

  if (livingPeers.length === 0) return;

  if (livingPeers[0] === this.peer.id) {
    // I'm first in order — I become the new host
    this._becomeHost();
  } else {
    // Someone else should become host — wait for their announcement
    console.log(`[Migration] Waiting for ${livingPeers[0]} to become host`);

    // Fallback: if no one announces within 3 seconds, check again
    setTimeout(() => {
      if (!this.isHost && this.peerOrder[0] !== this.peer.id) {
        // Check if the expected new host is still alive
        const expectedHost = this.peerOrder[0];
        if (!this.peers.has(expectedHost)) {
          console.log('[Migration] Expected host is gone — re-evaluating');
          this._checkIfIShouldBecomeHost();
        }
      }
    }, 3000);
  }
}

_becomeHost() {
  console.log('[Migration] I am the new host!');
  this.isHost = true;
  this.roomId = this.peer.id; // Room ID changes to new host's peer ID

  // Reorder: put self first
  this.peerOrder = [this.peer.id, ...this.peerOrder.filter(id => id !== this.peer.id)];

  // Announce to all peers
  for (const [peerId, peerData] of this.peers) {
    if (peerData.dataConn) {
      peerData.dataConn.send({
        type: 'host-migration',
        newHostId: this.peer.id,
        newRoomId: this.peer.id,
        order: this.peerOrder,
      });
    }
  }

  // Notify UI
  if (this.onHostMigration) this.onHostMigration(this.peer.id, true);

  this._broadcastPeerOrder();
}
```

### 6.3 Handle host-migration message

Add to `_handleDataMessage()`:

```javascript
case 'host-migration':
  console.log(`[Migration] Host migration: new host is ${data.newHostId}`);
  this.peerOrder = data.order;
  this.roomId = data.newRoomId;

  if (data.newHostId === this.peer.id) {
    // I was told I'm the new host (redundant if I already called _becomeHost)
    if (!this.isHost) this._becomeHost();
  } else {
    this.isHost = false;
    if (this.onHostMigration) this.onHostMigration(data.newHostId, false);
  }
  break;
```

### 6.4 Implement safe `leaveRoom()`

**CRITICAL:** Clear state BEFORE closing connections to prevent cascading callbacks.

```javascript
leaveRoom() {
  console.log('[Room] Leaving room...');

  // Stop keep-alive
  if (this._keepAliveInterval) {
    clearInterval(this._keepAliveInterval);
    this._keepAliveInterval = null;
  }

  // CRITICAL: Clear state BEFORE closing connections
  // This prevents _removePeer() from triggering host migration during teardown
  const wasHost = this.isHost;
  this.isHost = false;
  this.roomId = null;
  this.password = null;

  // Copy peers before clearing (so we can close them)
  const peersToClose = new Map(this.peers);
  this.peers.clear();
  this.peerOrder = [];
  this._pendingCalls.clear();

  // Now close all connections safely
  for (const [peerId, peerData] of peersToClose) {
    if (peerData.call) {
      try { peerData.call.close(); } catch (e) {}
    }
    if (peerData.dataConn) {
      try { peerData.dataConn.close(); } catch (e) {}
    }
    if (this.onRemoteStreamRemoved) this.onRemoteStreamRemoved(peerId);
  }

  // Destroy the PeerJS peer
  if (this.peer) {
    try { this.peer.destroy(); } catch (e) {}
    this.peer = null;
  }

  if (this.onConnectionStateChange) this.onConnectionStateChange('disconnected');
  console.log('[Room] Left room successfully');
}
```

### 6.5 Handle kicked message

```javascript
case 'kicked':
  console.log('[Room] Kicked from room');
  this.leaveRoom();
  break;
```

And the kick function for the host:

```javascript
kickPeer(peerId) {
  if (!this.isHost) return;
  const peerData = this.peers.get(peerId);
  if (peerData?.dataConn) {
    peerData.dataConn.send({ type: 'kicked' });
  }
  this._removePeer(peerId);
  console.log(`[Room] Kicked peer: ${peerId}`);
}
```

## Verification
- [ ] Test with 3 instances (A=host, B, C). Close A → B or C becomes the new host
- [ ] After migration, remaining peers can still hear each other
- [ ] The new host can accept new connections
- [ ] Peer order updates correctly after migration
- [ ] Leave room works cleanly — no error storms in console
- [ ] Kick functionality: host kicks a peer → peer is disconnected
- [ ] No cascading disconnection issues (check for error floods in console)
