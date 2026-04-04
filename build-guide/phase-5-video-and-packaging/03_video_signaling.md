# Step 3: Video Signaling

## Task
Implement the 4-hop signal relay chain, glare handling, and ICE candidate buffering.

## Architecture Rule

> **RTCSessionDescription and RTCIceCandidate CANNOT cross Electron IPC.**
> Electron's structured clone algorithm does not support these WebRTC types. You MUST convert them to plain objects before sending via IPC:
> - SDP: `{ type: desc.type, sdp: desc.sdp }`
> - ICE: `{ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex }`

## The 4-hop relay chain

Video signaling (SDP offers/answers and ICE candidates) travels this path:

```
Video Window → video-preload.js → main.js → preload.js → renderer.js → connection.js → data channel → Remote Peer
         (and the reverse for incoming signals)
```

## Instructions

### 3.1 Initiate signaling from video window

When the video window receives the peer list, it creates connections and starts signaling:

```javascript
// In video-renderer.js:

window.videoIPC.onPeerList((peers, config, myPeerId) => {
  console.log(`[Video] Received peer list: ${peers.length} peers, own ID: ${myPeerId}`);
  iceConfig = config;
  ownPeerId = myPeerId;

  initCamera().then(() => {
    for (const peer of peers) {
      // Use initiator rule: lower ID creates the offer
      if (ownPeerId < peer.id) {
        createOfferTo(peer.id);
      }
      // Otherwise, wait for their offer
    }
  });
});

window.videoIPC.onPeerJoined((peerId, peerInfo) => {
  console.log(`[Video] Peer joined: ${peerId}`);
  if (ownPeerId < peerId) {
    createOfferTo(peerId);
  }
});

window.videoIPC.onPeerLeft((peerId) => {
  console.log(`[Video] Peer left: ${peerId}`);
  removePeerConnection(peerId);
});
```

### 3.2 Create and send offer

```javascript
async function createOfferTo(peerId) {
  const pc = createPeerConnection(peerId);

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // CRITICAL: Convert to plain object for IPC serialization
    window.videoIPC.sendSignalToPeer(peerId, {
      type: 'video-offer',
      sdp: { type: offer.type, sdp: offer.sdp },
    });

    console.log(`[Video] Sent offer to: ${peerId}`);
  } catch (err) {
    console.error(`[Video] Failed to create offer for ${peerId}:`, err);
  }
}
```

### 3.3 Handle incoming signals

```javascript
window.videoIPC.onSignalFromPeer(async (peerId, signal) => {
  switch (signal.type) {
    case 'video-offer':
      await handleOffer(peerId, signal.sdp);
      break;
    case 'video-answer':
      await handleAnswer(peerId, signal.sdp);
      break;
    case 'ice-candidate':
      await handleIceCandidate(peerId, signal.candidate);
      break;
  }
});
```

### 3.4 Handle offer (with glare handling)

"Glare" occurs when both sides send an offer simultaneously. Resolution: the peer with the lower ID wins — the other side rolls back and becomes the answerer.

```javascript
async function handleOffer(peerId, sdp) {
  let peerData = peerConnections.get(peerId);

  // Glare handling: if we already sent an offer to this peer
  if (peerData && peerData.pc.signalingState === 'have-local-offer') {
    if (ownPeerId < peerId) {
      // We win — ignore their offer, they should accept ours
      console.log(`[Video] Glare with ${peerId} — we win (lower ID), ignoring their offer`);
      return;
    } else {
      // They win — rollback our offer and accept theirs
      console.log(`[Video] Glare with ${peerId} — they win, rolling back`);
      await peerData.pc.setLocalDescription({ type: 'rollback' });
    }
  }

  if (!peerData) {
    createPeerConnection(peerId);
    peerData = peerConnections.get(peerId);
  }

  const pc = peerData.pc;

  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  peerData.remoteDescriptionSet = true;

  // Process buffered ICE candidates
  for (const candidate of peerData.iceCandidateBuffer) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
  peerData.iceCandidateBuffer = [];

  // Create and send answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  window.videoIPC.sendSignalToPeer(peerId, {
    type: 'video-answer',
    sdp: { type: answer.type, sdp: answer.sdp },
  });

  console.log(`[Video] Sent answer to: ${peerId}`);
}
```

### 3.5 Handle answer

```javascript
async function handleAnswer(peerId, sdp) {
  const peerData = peerConnections.get(peerId);
  if (!peerData) return;

  await peerData.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  peerData.remoteDescriptionSet = true;

  // Process buffered ICE candidates
  for (const candidate of peerData.iceCandidateBuffer) {
    await peerData.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
  peerData.iceCandidateBuffer = [];

  console.log(`[Video] Received answer from: ${peerId}`);
}
```

### 3.6 Handle ICE candidates (with buffering)

ICE candidates may arrive before the remote description is set. Buffer them until ready:

```javascript
async function handleIceCandidate(peerId, candidateObj) {
  const peerData = peerConnections.get(peerId);
  if (!peerData) return;

  if (peerData.remoteDescriptionSet) {
    try {
      await peerData.pc.addIceCandidate(new RTCIceCandidate(candidateObj));
    } catch (err) {
      console.warn(`[Video] Failed to add ICE candidate for ${peerId}:`, err);
    }
  } else {
    // Buffer until remote description is set
    peerData.iceCandidateBuffer.push(candidateObj);
  }
}
```

### 3.7 Relay signals in renderer.js (main window side)

In `renderer.js`, relay video signals between the IPC bridge and the data channel:

```javascript
// RELAY 1: Video window → main.js → preload → here → data channel → remote peer
window.ipcAPI.video.onSignalForPeer((peerId, signal) => {
  const peerData = connectionManager.peers.get(peerId);
  if (peerData?.dataConn) {
    peerData.dataConn.send({ type: 'video-signal', signal });
  }
});

// RELAY 2: Remote peer → data channel → here → preload → main.js → video window
// (in _handleDataMessage in connection.js)
case 'video-signal':
  if (window.ipcAPI?.video) {
    window.ipcAPI.video.forwardSignalToVideoWindow(peerId, data.signal);
  }
  break;

// RELAY 3: Video window requests peer list → respond
window.ipcAPI.video.onRequestPeerList(() => {
  const peers = [];
  for (const [id, peerData] of connectionManager.peers) {
    peers.push({ id, info: peerData.info });
  }
  window.ipcAPI.video.sendPeerList(peers, ICE_SERVERS, connectionManager.peer?.id);
});
```

### 3.8 Notify video window of peer changes

```javascript
// When a peer joins the audio room:
connectionManager.onPeerJoined = (peerId, info) => {
  // ... existing UI update code ...
  window.ipcAPI.video.notifyPeerJoined(peerId, info);
};

// When a peer leaves:
connectionManager.onPeerLeft = (peerId) => {
  // ... existing UI update code ...
  window.ipcAPI.video.notifyPeerLeft(peerId);
};
```

### 3.9 Video window ready notification

At the end of `video-renderer.js`, after setting up all listeners:

```javascript
window.videoIPC.notifyReady();
console.log('[Video] Window ready — waiting for peer list');
```

## Verification
- [ ] Open video in a 2-person room → both see each other's video
- [ ] ICE candidates are buffered and delivered correctly
- [ ] Glare handling works (test by both opening video simultaneously)
- [ ] Console shows signal relay messages in both windows
- [ ] Closing video window doesn't affect audio chat
- [ ] No console errors in either window
