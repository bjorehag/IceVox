# Step 3: Dual AudioWorklet Chain

## Task
Replace the simple passthrough with the full audio graph: two parallel AudioWorklet chains (monitor + send), DynamicsCompressor on both paths, and a MediaStreamDestination on the send path.

## Architecture Rule

> **This is the most critical audio architecture decision in the project.**
>
> You MUST create TWO separate AudioWorkletNode instances — one for the monitor path (local speakers) and one for the send path (WebRTC). They share the same processor class but are independent nodes.
>
> The send path ends in a `MediaStreamDestination` node, which produces a `MediaStream` with a processed audio track. In Phase 4, this track will be swapped into the WebRTC connection via `replaceTrack()`.
>
> **Why two chains?** PeerJS ignores any custom MediaStream you pass to `peer.call()`. It internally uses the raw microphone track. The only way to send processed audio is to:
> 1. Set up the call with the raw mic stream (PeerJS expects this)
> 2. After the call connects, use `RTCRtpSender.replaceTrack()` to swap in our processed track
>
> The dual chain lets us independently control monitor volume (what you hear locally) and send gain (what goes to WebRTC), while running the same effects on both.

## Instructions

### 3.1 Create the AudioWorklet processor stub

Create `src/renderer/audio-worklet-processor.js` — a passthrough processor that we'll add effects to in Phase 3:

```javascript
class VoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.params = {};
    this.port.onmessage = (event) => {
      const { type, data } = event.data;
      if (type === 'setParams') Object.assign(this.params, data);
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    for (let channel = 0; channel < output.length; channel++) {
      const inputChannel = input[channel] || input[0];
      const outputChannel = output[channel];

      // Passthrough — copy input to output sample-by-sample
      // CRITICAL: explicit per-sample write so MediaStreamDestination
      // registers the change (Chromium behavior)
      for (let i = 0; i < outputChannel.length; i++) {
        outputChannel[i] = inputChannel[i];
      }
    }

    return true;
  }
}

registerProcessor('voice-processor', VoiceProcessor);
```

**Why the explicit sample-by-sample copy?** Chromium may optimize away a `Float32Array.set()` or similar bulk copy, causing `MediaStreamDestination` to not register any audio change. The explicit for-loop forces a per-sample write that Chromium cannot skip.

### 3.2 Register the AudioWorklet

In `AudioManager.init()`, register the worklet processor before building the graph:

```javascript
// Get the correct path for the worklet file (handles ASAR unpacking in production)
let workletPath;
if (window.ipcAPI) {
  workletPath = await window.ipcAPI.getWorkletPath();
  workletPath = `file://${workletPath}`;
} else {
  workletPath = 'audio-worklet-processor.js';
}

await this.audioContext.audioWorklet.addModule(workletPath);
console.log('[Audio] AudioWorklet registered');
```

### 3.3 Build the full audio graph

Replace the simple passthrough from Step 2 with the dual chain:

```javascript
// ── Shared input stage ──
this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);

this.inputGainNode = this.audioContext.createGain();
this.inputGainNode.gain.value = 1.25; // Default mic boost (125%)
this.sourceNode.connect(this.inputGainNode);

// ── MONITOR PATH (local speakers) ──
this.workletNode = new AudioWorkletNode(this.audioContext, 'voice-processor');

this.monitorGain = this.audioContext.createGain();
this.monitorGain.gain.value = 1.0; // Loopback volume

this.monitorCompressor = this._createVoiceCompressor();

this.inputGainNode.connect(this.workletNode);
this.workletNode.connect(this.monitorGain);
this.monitorGain.connect(this.monitorCompressor);
this.monitorCompressor.connect(this.audioContext.destination);

// ── SEND PATH (WebRTC) ──
this.sendWorkletNode = new AudioWorkletNode(this.audioContext, 'voice-processor');

this.sendGain = this.audioContext.createGain();
this.sendGain.gain.value = 1.0;

this.sendCompressor = this._createVoiceCompressor();

this.sendStreamDestination = this.audioContext.createMediaStreamDestination();

this.inputGainNode.connect(this.sendWorkletNode);
this.sendWorkletNode.connect(this.sendGain);
this.sendGain.connect(this.sendCompressor);
this.sendCompressor.connect(this.sendStreamDestination);

console.log('[Audio] Dual worklet chain active (monitor + send)');
```

### 3.4 Create the DynamicsCompressor helper

The compressor evens out mic levels — it prevents loud peaks from clipping and boosts quiet sections. Both paths use identical settings:

```javascript
_createVoiceCompressor() {
  const comp = this.audioContext.createDynamicsCompressor();
  comp.threshold.value = -24;  // dB — start compressing at this level
  comp.knee.value = 12;        // dB — soft knee for natural sound
  comp.ratio.value = 3;        // 3:1 compression ratio
  comp.attack.value = 0.003;   // 3ms attack (fast, catches transients)
  comp.release.value = 0.15;   // 150ms release (smooth recovery)
  return comp;
}
```

### 3.5 Expose the processed track

Add methods that Phase 4 will use to get the processed audio for WebRTC:

```javascript
getProcessedTrack() {
  if (!this.sendStreamDestination) return null;
  const tracks = this.sendStreamDestination.stream.getAudioTracks();
  return tracks.length > 0 ? tracks[0] : null;
}

getSendStream() {
  return this.sendStreamDestination ? this.sendStreamDestination.stream : null;
}
```

### 3.6 Expose volume and gain controls

```javascript
setMonitorVolume(value) {
  // value: 0.0 to 2.0 (0% to 200%)
  if (this.monitorGain) {
    this.monitorGain.gain.value = value;
  }
}

setInputGain(value) {
  // value: 0.0 to 2.0 (0% to 200%, labeled "Mic Boost")
  if (this.inputGainNode) {
    this.inputGainNode.gain.value = value;
  }
}
```

### 3.7 Send effect parameters to both worklets

Add a method that sends parameters to BOTH worklet nodes simultaneously:

```javascript
setEffectParams(params) {
  const message = { type: 'setParams', data: params };
  if (this.workletNode) this.workletNode.port.postMessage(message);
  if (this.sendWorkletNode) this.sendWorkletNode.port.postMessage(message);
}
```

This will be used in Phase 3 when effects are implemented.

### 3.8 Wire up the mic boost slider in renderer.js

```javascript
const micBoostSlider = document.getElementById('mic-boost');
if (micBoostSlider) {
  micBoostSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value) / 100;
    audioManager.setInputGain(value);
  });
}
```

## Verification
- [ ] `npm start` → init audio → you hear your voice through speakers (passthrough, same as before)
- [ ] Loopback volume slider still works (controls monitor path only)
- [ ] Mic boost slider adjusts the input gain
- [ ] Console shows "Dual worklet chain active" message
- [ ] Console shows "AudioWorklet registered" message
- [ ] `audioManager.getProcessedTrack()` returns a MediaStreamTrack (check in DevTools console)
- [ ] No audio clicks, pops, or artifacts
- [ ] No console errors
