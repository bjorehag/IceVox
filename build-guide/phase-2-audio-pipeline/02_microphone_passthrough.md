# Step 2: Microphone Passthrough

## Task
Capture the microphone and route it directly to the speakers so the user hears their own voice. This is the simplest audio path — we'll replace it with the full worklet chain in the next step.

## Instructions

### 2.1 Request microphone access

In the `AudioManager.init()` method, after creating the AudioContext, request the microphone:

```javascript
// Request microphone with audio processing constraints
this.micStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
  }
});

console.log('[Audio] Microphone access granted');
```

**Why these constraints?**
- `autoGainControl: true` (AGC) — Normalizes mic level automatically. This runs in the browser's capture pipeline, BEFORE the audio reaches the Web Audio graph. It does NOT interfere with voice effects.
- `noiseSuppression: true` — Reduces background noise (fan, keyboard, etc.)
- `echoCancellation: true` — Prevents feedback when not using headphones

### 2.2 Create source node and connect to speakers

```javascript
// Create a source node from the microphone stream
this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);

// For now, connect directly to speakers (passthrough)
this.sourceNode.connect(this.audioContext.destination);

console.log('[Audio] Passthrough active — you should hear your voice');
```

### 2.3 Add a gain node for loopback volume

Insert a GainNode between the source and destination for volume control:

```javascript
this.monitorGain = this.audioContext.createGain();
this.monitorGain.gain.value = 1.0; // 100% = unity gain

this.sourceNode.connect(this.monitorGain);
this.monitorGain.connect(this.audioContext.destination);
```

### 2.4 Expose volume control

Add a method to set the loopback (monitor) volume:

```javascript
setMonitorVolume(value) {
  // value: 0.0 to 2.0 (0% to 200%)
  if (this.monitorGain) {
    this.monitorGain.gain.value = value;
  }
}
```

Wire this to the loopback volume slider in `renderer.js`:

```javascript
const loopbackSlider = document.getElementById('loopback-volume');
if (loopbackSlider) {
  loopbackSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value) / 100; // slider 0-200, convert to 0.0-2.0
    audioManager.setMonitorVolume(value);
  });
}
```

### 2.5 Important: headphones warning

When testing passthrough, you MUST use headphones. Without headphones, the mic picks up the speaker output, creating a feedback loop. In the final product, users should set loopback to 0% when in a voice chat room (to avoid echo for other participants).

## Verification
- [ ] `npm start` → clicking "Start Audio" (or your init trigger) → browser prompts for mic permission
- [ ] After granting: you hear your own voice through speakers/headphones
- [ ] Loopback volume slider changes the volume in real time
- [ ] Setting loopback to 0% silences the monitor output
- [ ] Console shows mic access granted message
- [ ] No console errors

**Note:** This simple passthrough will be REPLACED in the next step with the full dual worklet chain. This step just verifies that mic capture and audio routing work.
