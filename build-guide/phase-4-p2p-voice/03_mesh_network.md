# Step 3: Mesh Network

## Task
Expand from 2-person connections to full mesh (all-to-all) supporting up to 6 participants.

## How mesh networking works

In a mesh topology, every participant connects to every other participant directly. With 6 participants, there are 15 peer connections total. The host coordinates the mesh by announcing new peers to existing ones.

```
     A ─── B
    /│\   /│\
   / │ \ / │ \
  C──┼──D──┼──E
   \ │ / \ │ /
    \│/   \│/
     F ─── (all connected to all)
```

## Instructions

### 3.1 The Initiator Rule

When a new peer joins, the host tells everyone about the new peer. But who initiates the connection between two non-host peers? To prevent duplicate connections, use the **initiator rule**: the peer with the lexicographically lower ID initiates.

```javascript
_shouldInitiateTo(otherPeerId) {
  return this.peer.id < otherPeerId;
}
```

### 3.2 Host sends peer list to new joiner

When a new peer joins (after approval), the host sends the list of all existing peers:

```javascript
_sendPeerList(newPeerId) {
  const peerList = [];
  for (const [id, peerData] of this.peers) {
    if (id !== newPeerId) {
      peerList.push({ id, info: peerData.info });
    }
  }

  const conn = this.peers.get(newPeerId)?.dataConn;
  if (conn) {
    conn.send({ type: 'peer-list', peers: peerList });
    console.log(`[Mesh] Sent peer list to ${newPeerId}: ${peerList.map(p => p.id).join(', ')}`);
  }
}
```

### 3.3 Host announces new peer to existing peers

```javascript
_announceNewPeer(newPeerId) {
  const newPeerInfo = this.peers.get(newPeerId)?.info || {};

  for (const [id, peerData] of this.peers) {
    if (id !== newPeerId && peerData.dataConn) {
      peerData.dataConn.send({
        type: 'new-peer',
        peerId: newPeerId,
        info: newPeerInfo,
      });
    }
  }

  console.log(`[Mesh] Announced new peer ${newPeerId} to ${this.peers.size - 1} existing peers`);
}
```

### 3.4 Handle peer-list and new-peer messages

Add cases to `_handleDataMessage()`:

```javascript
case 'peer-list':
  console.log(`[Mesh] Received peer list: ${data.peers.map(p => p.id).join(', ')}`);
  for (const peer of data.peers) {
    if (!this.peers.has(peer.id) && peer.id !== this.peer.id) {
      if (this._shouldInitiateTo(peer.id)) {
        this._connectToPeer(peer.id);
      }
    }
  }
  break;

case 'new-peer':
  console.log(`[Mesh] New peer announced: ${data.peerId}`);
  if (!this.peers.has(data.peerId) && data.peerId !== this.peer.id) {
    if (this._shouldInitiateTo(data.peerId)) {
      this._connectToPeer(data.peerId);
    }
  }
  break;
```

### 3.5 Implement `_connectToPeer()`

This initiates both a voice call and a data connection to another peer (non-host):

```javascript
_connectToPeer(peerId) {
  console.log(`[Mesh] Initiating connection to: ${peerId}`);

  // Data connection
  const dataConn = this.peer.connect(peerId, { reliable: true });
  dataConn.on('open', () => {
    console.log(`[Mesh] Data channel open to: ${peerId}`);
    const peerData = this.peers.get(peerId);
    if (peerData) peerData.dataConn = dataConn;
    this._setupDataHandlers(dataConn, peerId);

    // Send our info
    dataConn.send({ type: 'peer-info', displayName: this.displayName });
  });

  // Voice call
  const call = this.peer.call(peerId, this._localStream);
  this.peers.set(peerId, { call, dataConn, stream: null, info: {} });
  this._setupCallHandlers(call, peerId);
}
```

### 3.6 Update peer order

Maintain `peerOrder` — the ordered list of all peers in the room. This is critical for host migration (Step 6).

When a peer joins:
```javascript
// In _handleJoinRequest or wherever a new peer is confirmed:
if (!this.peerOrder.includes(peerId)) {
  this.peerOrder.push(peerId);
  this._broadcastPeerOrder();
}
```

Broadcast the order to all peers:
```javascript
_broadcastPeerOrder() {
  for (const [id, peerData] of this.peers) {
    if (peerData.dataConn) {
      peerData.dataConn.send({ type: 'peer-order', order: this.peerOrder });
    }
  }
}
```

Handle receiving peer order:
```javascript
case 'peer-order':
  this.peerOrder = data.order;
  console.log(`[Mesh] Updated peer order: ${this.peerOrder.join(', ')}`);
  break;
```

### 3.7 Update the host flow to announce and send peer lists

After a new peer's call is answered and streams are exchanged, the host should:

```javascript
// After confirming a new peer (e.g., in _handleJoinRequest after approval):
this._sendPeerList(peerId);
this._announceNewPeer(peerId);
this._broadcastPeerOrder();
```

### 3.8 Handle peer-info messages

```javascript
case 'peer-info':
  const peerData = this.peers.get(peerId);
  if (peerData && data.displayName) {
    peerData.info.displayName = data.displayName;
    if (this.onPeerJoined) this.onPeerJoined(peerId, peerData.info);
  }
  break;
```

## Verification
- [ ] Test with 3 instances: Host (A) creates room, Guest B joins, Guest C joins
- [ ] All three instances can hear each other
- [ ] The mesh forms correctly (A↔B, A↔C, B↔C — all connected)
- [ ] Console logs show peer list and new-peer announcements
- [ ] The initiator rule prevents duplicate connections
- [ ] No console errors
