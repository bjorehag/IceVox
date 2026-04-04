# Step 4: Sender-Side Effects

## Task
Implement `replaceTrack()` to send processed (effect-applied) audio instead of raw microphone audio, and set up WebRTC connection monitoring.

## Architecture Rule

> PeerJS ignores any custom MediaStream you pass to `peer.call()`. After the call connects and `call.on('stream')` fires, you MUST:
> 1. Get the `RTCPeerConnection` from the call: `call.peerConnection`
> 2. Find the audio sender: `pc.getSenders().find(s => s.track?.kind === 'audio')`
> 3. Call `sender.replaceTrack(processedTrack)` with the track from `audioManager.getProcessedTrack()`
>
> Also: Use `addEventListener()` for all WebRTC events. PeerJS overwrites `pc.onX` properties internally.

## Instructions

### 4.1 Implement `_replaceWithProcessedTrack()`

```javascript
async _replaceWithProcessedTrack(call) {
  if (!this.onGetProcessedTrack) {
    console.warn('[WebRTC] No onGetProcessedTrack callback set');
    return;
  }

  const processedTrack = this.onGetProcessedTrack();
  if (!processedTrack) {
    console.warn('[WebRTC] No processed track available');
    return;
  }

  const pc = call.peerConnection;
  if (!pc) {
    console.warn('[WebRTC] No peerConnection on call');
    return;
  }

  const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
  if (!audioSender) {
    console.warn('[WebRTC] No audio sender found');
    return;
  }

  try {
    await audioSender.replaceTrack(processedTrack);
    console.log(`[WebRTC] Replaced track for peer: ${call.peer}`);

    // Set Opus codec bitrate to 128 kbps for high-quality voice
    this._setOpusBitrate(pc, 128000);
  } catch (err) {
    console.error('[WebRTC] replaceTrack failed:', err);
  }
}
```

### 4.2 Set Opus bitrate

Higher bitrate = better voice quality. The default WebRTC bitrate is often 32-64 kbps; we want 128 kbps:

```javascript
_setOpusBitrate(pc, bitrate) {
  const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
  if (!audioSender) return;

  const params = audioSender.getParameters();
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}];
  }
  params.encodings[0].maxBitrate = bitrate;

  audioSender.setParameters(params).then(() => {
    console.log(`[WebRTC] Opus bitrate set to ${bitrate / 1000} kbps`);
  }).catch(err => {
    console.warn('[WebRTC] Failed to set bitrate:', err);
  });
}
```

### 4.3 Wire up the callback in renderer.js

```javascript
connectionManager.onGetProcessedTrack = () => {
  return audioManager.getProcessedTrack();
};
```

### 4.4 Monitor call health

Add WebRTC connection monitoring using `addEventListener` (NOT property assignment):

```javascript
_monitorCallHealth(call, peerId) {
  const pc = call.peerConnection;
  if (!pc) return;

  // CRITICAL: Use addEventListener, NOT pc.oniceconnectionstatechange
  // PeerJS overwrites property assignments internally
  pc.addEventListener('iceconnectionstatechange', () => {
    const state = pc.iceConnectionState;
    console.log(`[WebRTC] ICE state for ${peerId}: ${state}`);

    if (state === 'failed' || state === 'disconnected' || state === 'closed') {
      console.warn(`[WebRTC] Connection to ${peerId} lost (${state})`);
      // Don't remove peer immediately on 'disconnected' — it may recover
      // Only remove on 'failed' or 'closed'
      if (state === 'failed' || state === 'closed') {
        this._removePeer(peerId);
      }
    }
  });

  pc.addEventListener('connectionstatechange', () => {
    console.log(`[WebRTC] Connection state for ${peerId}: ${pc.connectionState}`);
  });
}
```

Call `_monitorCallHealth()` in `_setupCallHandlers()` after the call is set up:

```javascript
// In _setupCallHandlers, after setting up stream/close/error handlers:
this._monitorCallHealth(call, peerId);
```

### 4.5 Keep-alive system

Implement ping/pong to detect dead peers that didn't disconnect cleanly:

```javascript
_startKeepAlive() {
  this._keepAliveInterval = setInterval(() => {
    const now = Date.now();
    for (const [peerId, peerData] of this.peers) {
      if (peerData.dataConn) {
        peerData.dataConn.send({ type: 'ping', timestamp: now });
      }
      // Check if we haven't heard from this peer in 15 seconds
      if (peerData.lastPong && (now - peerData.lastPong > 15000)) {
        console.warn(`[Mesh] Peer ${peerId} timed out (no pong for 15s)`);
        this._removePeer(peerId);
      }
    }
  }, 5000); // Send ping every 5 seconds
}
```

Handle ping/pong in `_handleDataMessage()`:

```javascript
case 'ping':
  // Respond to ping
  const peerConn = this.peers.get(peerId)?.dataConn;
  if (peerConn) peerConn.send({ type: 'pong', timestamp: data.timestamp });
  break;

case 'pong':
  const pd = this.peers.get(peerId);
  if (pd) pd.lastPong = Date.now();
  break;
```

Start keep-alive when the first peer connects.

## Verification
- [ ] Test with 2 instances: both hear each other's effect-processed voice (not raw mic)
- [ ] Apply a preset on one instance → the other hears the effect
- [ ] Console shows "Replaced track" and "Opus bitrate set to 128 kbps"
- [ ] ICE state changes are logged with `[WebRTC]` prefix
- [ ] Keep-alive pings are sent every 5 seconds (check console)
- [ ] Disconnecting one instance → the other detects it within 15 seconds
- [ ] No console errors during normal operation
