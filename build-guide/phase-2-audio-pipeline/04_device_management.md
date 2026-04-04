# Step 4: Device Management

## Task
Implement audio device enumeration, switching (input and output), and the audio settings modal for toggling AGC, noise suppression, and echo cancellation.

## Instructions

### 4.1 Enumerate audio devices

Add a method to AudioManager that lists available input and output devices:

```javascript
async getDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: devices.filter(d => d.kind === 'audioinput'),
    outputs: devices.filter(d => d.kind === 'audiooutput'),
  };
}
```

### 4.2 Switch input device (microphone)

Switching the microphone requires stopping the old stream, requesting a new one with the chosen device, and reconnecting it to the existing audio graph:

```javascript
async switchInput(deviceId) {
  if (!this.audioContext) return;

  // Stop the old mic stream
  if (this.micStream) {
    this.micStream.getTracks().forEach(t => t.stop());
  }

  // Disconnect old source node
  if (this.sourceNode) {
    this.sourceNode.disconnect();
  }

  // Request new mic with the chosen device
  this.micStream = await navigator.mediaDevices.getUserMedia({
    audio: this._buildAudioConstraints(deviceId),
  });

  // Create new source and reconnect to the shared inputGainNode
  this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);
  this.sourceNode.connect(this.inputGainNode);

  console.log(`[Audio] Switched input to: ${deviceId}`);
}
```

**Important:** The rest of the graph (worklet nodes, compressors, etc.) stays connected. Only the sourceNode changes. The send path's MediaStreamDestination already holds a reference to the processed track — no `replaceTrack()` is needed here because the destination track is live.

### 4.3 Build audio constraints helper

```javascript
_buildAudioConstraints(deviceId) {
  const constraints = {
    noiseSuppression: this._noiseSuppression ?? true,
    echoCancellation: this._echoCancellation ?? true,
    autoGainControl: this._agc ?? true,
  };
  if (deviceId) {
    constraints.deviceId = { exact: deviceId };
  }
  return constraints;
}
```

### 4.4 Switch output device (speakers)

Switching the output device uses `setSinkId()` on the AudioContext AND on any remote peer `<audio>` elements (added in Phase 4):

```javascript
async switchOutput(deviceId) {
  if (this.audioContext && this.audioContext.setSinkId) {
    await this.audioContext.setSinkId(deviceId);
    console.log(`[Audio] Switched output to: ${deviceId}`);
  }

  // Also update all remote peer <audio> elements (Phase 4)
  if (this.remotePeers) {
    for (const [peerId, peer] of this.remotePeers) {
      if (peer.audioElement && peer.audioElement.setSinkId) {
        await peer.audioElement.setSinkId(deviceId);
      }
    }
  }

  this._outputDeviceId = deviceId;
}
```

### 4.5 Apply mic constraints (settings changes)

When the user toggles AGC, noise suppression, or echo cancellation in the audio settings modal, the mic must be restarted with the new constraints:

```javascript
async applyMicConstraints({ noiseSuppression, echoCancellation, agc }) {
  this._noiseSuppression = noiseSuppression;
  this._echoCancellation = echoCancellation;
  this._agc = agc;

  // Restart mic with new constraints
  if (this.micStream) {
    const currentDeviceId = this.micStream.getAudioTracks()[0]?.getSettings().deviceId;
    await this.switchInput(currentDeviceId);
    console.log('[Audio] Mic constraints updated — restarted mic');
  }
}
```

### 4.6 Device change listener

Listen for device changes (headphones plugged/unplugged):

```javascript
// In init():
navigator.mediaDevices.addEventListener('devicechange', async () => {
  console.log('[Audio] Device list changed');
  // Optionally refresh device dropdowns in the UI via callback
  if (this.onDeviceChange) this.onDeviceChange();
});
```

### 4.7 Wire up device selectors in renderer.js

Populate the mic and speaker dropdowns with available devices:

```javascript
async function populateDeviceSelectors() {
  const { inputs, outputs } = await audioManager.getDevices();

  const micSelect = document.getElementById('mic-select');
  const speakerSelect = document.getElementById('speaker-select');

  if (micSelect) {
    micSelect.innerHTML = '';
    inputs.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Microphone ${micSelect.options.length + 1}`;
      micSelect.appendChild(option);
    });
    micSelect.addEventListener('change', (e) => {
      audioManager.switchInput(e.target.value);
    });
  }

  if (speakerSelect) {
    speakerSelect.innerHTML = '';
    outputs.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Speaker ${speakerSelect.options.length + 1}`;
      speakerSelect.appendChild(option);
    });
    speakerSelect.addEventListener('change', (e) => {
      audioManager.switchOutput(e.target.value);
    });
  }
}
```

Call `populateDeviceSelectors()` after audio init, and again on device change:

```javascript
audioManager.onDeviceChange = populateDeviceSelectors;
```

### 4.8 Wire up audio settings modal

The audio settings modal has three toggles. When the user changes them and clicks "Apply":

```javascript
function applyAudioSettings() {
  const ns = document.getElementById('noise-suppression-toggle').checked;
  const ec = document.getElementById('echo-cancellation-toggle').checked;
  const agc = document.getElementById('agc-toggle').checked;

  audioManager.applyMicConstraints({
    noiseSuppression: ns,
    echoCancellation: ec,
    agc: agc,
  });

  // Close the modal
  document.getElementById('audio-settings-modal').style.display = 'none';
}
```

### 4.9 Initialize remotePeers map

In the AudioManager constructor, initialize the map that will hold remote peer audio (used in Phase 4):

```javascript
constructor() {
  this.audioContext = null;
  this.isInitialized = false;
  this.remotePeers = new Map(); // peerId → { audioElement, stream, gainNode }
}
```

### 4.10 Mute send functionality

Add a method to mute/unmute the microphone for WebRTC (stops sending audio to other participants):

```javascript
setMicMuted(muted) {
  if (this.micStream) {
    this.micStream.getAudioTracks().forEach(track => {
      track.enabled = !muted;
    });
    console.log(`[Audio] Mic ${muted ? 'muted' : 'unmuted'}`);
  }
}
```

## Verification
- [ ] Device dropdowns populate with available microphones and speakers
- [ ] Selecting a different mic switches the input (voice comes from new mic)
- [ ] Selecting a different speaker switches the output
- [ ] Audio settings modal opens, shows three toggles (NS, EC, AGC — all ON by default)
- [ ] Changing a toggle and applying restarts the mic (brief interruption, then audio returns)
- [ ] Plugging/unplugging headphones triggers device list refresh
- [ ] Mic mute stops audio from being picked up
- [ ] No console errors
- [ ] App still starts cleanly with `npm start`
