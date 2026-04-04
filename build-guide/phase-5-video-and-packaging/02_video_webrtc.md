# Step 2: Video WebRTC

## Task
Implement video chat using native RTCPeerConnection (NOT PeerJS) with camera management, adaptive quality, and grid/focus layouts.

## Why native RTCPeerConnection?
PeerJS's media handling is tightly coupled to its signaling — you can't easily control codec parameters, renegotiate tracks, or handle camera switching. Native RTCPeerConnection gives full control while reusing the existing data channel for signaling.

## Instructions

### 2.1 Create `src/video/video-renderer.js`

This is the complete video chat implementation, running in the video window:

```javascript
// video-renderer.js — Video chat implementation

let ownPeerId = null;
let localStream = null;
let peerConnections = new Map();  // peerId → RTCPeerConnection
let iceConfig = null;
let cameraEnabled = true;

// Quality profiles
const QUALITY_PROFILES = {
  high:   { width: 1280, height: 720, frameRate: 30 },
  medium: { width: 640,  height: 480, frameRate: 24 },
  low:    { width: 480,  height: 360, frameRate: 15 },
};

let selectedQuality = 'auto';

function getQualityForPeerCount(count) {
  if (selectedQuality !== 'auto') return QUALITY_PROFILES[selectedQuality];
  if (count <= 2) return QUALITY_PROFILES.high;
  if (count <= 4) return QUALITY_PROFILES.medium;
  return QUALITY_PROFILES.low;
}
```

### 2.2 Initialize camera

```javascript
async function initCamera() {
  const quality = getQualityForPeerCount(peerConnections.size);

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: quality.width },
        height: { ideal: quality.height },
        frameRate: { ideal: quality.frameRate },
      },
      audio: false, // Audio is handled by the main window
    });

    const localVideo = document.getElementById('local-video');
    localVideo.srcObject = localStream;

    console.log('[Video] Camera initialized');
    enumerateCameras();
  } catch (err) {
    console.error('[Video] Camera access failed:', err);
    cameraEnabled = false;
  }
}
```

### 2.3 Create peer connection for a remote peer

```javascript
function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection({ iceServers: iceConfig });

  // Add local video track if camera is on
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // Handle incoming video track from remote peer
  pc.addEventListener('track', (event) => {
    console.log(`[Video] Received video track from: ${peerId}`);
    const remoteStream = event.streams[0];
    showRemoteVideo(peerId, remoteStream);
  });

  // ICE candidate handling — buffer until SDP is set
  const iceCandidateBuffer = [];
  let remoteDescriptionSet = false;

  pc.addEventListener('icecandidate', (event) => {
    if (event.candidate) {
      // CRITICAL: Convert to plain object for IPC serialization
      const candidateObj = {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      };
      window.videoIPC.sendSignalToPeer(peerId, {
        type: 'ice-candidate',
        candidate: candidateObj,
      });
    }
  });

  pc.addEventListener('iceconnectionstatechange', () => {
    console.log(`[Video] ICE state for ${peerId}: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
      removePeerConnection(peerId);
    }
  });

  // Store with metadata
  peerConnections.set(peerId, {
    pc,
    iceCandidateBuffer,
    remoteDescriptionSet,
  });

  return pc;
}
```

### 2.4 Camera toggle

```javascript
function toggleCamera() {
  cameraEnabled = !cameraEnabled;

  if (localStream) {
    localStream.getVideoTracks().forEach(track => {
      track.enabled = cameraEnabled;
    });
  }

  // Update UI
  const btn = document.getElementById('camera-toggle');
  btn.textContent = cameraEnabled ? 'Camera On' : 'Camera Off';

  // Update local preview
  const localCell = document.getElementById('local-cell');
  localCell.classList.toggle('camera-off', !cameraEnabled);
}
```

### 2.5 Camera selection

```javascript
async function enumerateCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === 'videoinput');

  const select = document.getElementById('camera-select');
  select.innerHTML = '';
  cameras.forEach(cam => {
    const option = document.createElement('option');
    option.value = cam.deviceId;
    option.textContent = cam.label || `Camera ${select.options.length + 1}`;
    select.appendChild(option);
  });
}

async function switchCamera(deviceId) {
  const quality = getQualityForPeerCount(peerConnections.size);

  const newStream = await navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: quality.width },
      height: { ideal: quality.height },
      frameRate: { ideal: quality.frameRate },
    },
    audio: false,
  });

  const newTrack = newStream.getVideoTracks()[0];

  // Update local preview
  localStream.getVideoTracks().forEach(t => t.stop());
  localStream.removeTrack(localStream.getVideoTracks()[0]);
  localStream.addTrack(newTrack);
  document.getElementById('local-video').srcObject = localStream;

  // Replace track on all peer connections (no renegotiation needed)
  for (const [peerId, peerData] of peerConnections) {
    const sender = peerData.pc.getSenders().find(s => s.track?.kind === 'video');
    if (sender) {
      await sender.replaceTrack(newTrack);
    }
  }

  console.log(`[Video] Switched camera to: ${deviceId}`);
}
```

### 2.6 Show/remove remote video

```javascript
function showRemoteVideo(peerId, stream) {
  let cell = document.getElementById(`video-cell-${peerId}`);
  if (!cell) {
    cell = document.createElement('div');
    cell.id = `video-cell-${peerId}`;
    cell.classList.add('video-cell');

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsinline = true;
    cell.appendChild(video);

    const label = document.createElement('span');
    label.classList.add('video-label');
    label.textContent = peerId.substring(0, 8);
    cell.appendChild(label);

    document.getElementById('video-grid').appendChild(cell);
  }

  cell.querySelector('video').srcObject = stream;
}

function removePeerConnection(peerId) {
  const peerData = peerConnections.get(peerId);
  if (peerData) {
    peerData.pc.close();
    peerConnections.delete(peerId);
  }

  const cell = document.getElementById(`video-cell-${peerId}`);
  if (cell) cell.remove();
}
```

### 2.7 Layout toggle (grid ↔ focus)

```javascript
let focusMode = false;
let focusPeerId = null;

document.getElementById('layout-toggle').addEventListener('click', () => {
  focusMode = !focusMode;
  document.getElementById('video-grid').classList.toggle('focus-mode', focusMode);
  document.getElementById('layout-toggle').textContent = focusMode ? 'Focus' : 'Grid';
});
```

### 2.8 Wire up controls

```javascript
document.getElementById('camera-toggle').addEventListener('click', toggleCamera);
document.getElementById('close-video-btn').addEventListener('click', () => {
  cleanup();
  window.videoIPC.close();
});

document.getElementById('video-settings-btn').addEventListener('click', () => {
  const panel = document.getElementById('settings-panel');
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
});

document.getElementById('camera-select').addEventListener('change', (e) => {
  switchCamera(e.target.value);
});

document.getElementById('quality-select').addEventListener('change', (e) => {
  selectedQuality = e.target.value;
});
```

### 2.9 Cleanup

```javascript
function cleanup() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  for (const [peerId, peerData] of peerConnections) {
    peerData.pc.close();
  }
  peerConnections.clear();
}
```

## Verification
- [ ] Video window shows local camera preview
- [ ] Camera toggle turns video on/off
- [ ] Camera selector lists available cameras
- [ ] Switching camera updates the preview
- [ ] Grid/Focus layout toggle works
- [ ] Settings panel opens/closes
- [ ] Close button closes the video window
- [ ] No console errors
