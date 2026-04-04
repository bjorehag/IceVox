# Step 2: Pitch Shift

## Task
Implement pitch shifting using crossfaded granular synthesis with dual read heads. This is the most complex DSP effect in the project.

## How pitch shifting works

Pitch shifting changes the perceived pitch of audio without changing its speed. We use a **circular buffer** where we write incoming audio at normal speed but read it back at a different speed (faster = higher pitch, slower = lower pitch).

The challenge: when the read position gets too far from (or too close to) the write position, we'd get silence or repeated audio. The solution is **two read heads** with **crossfading** — when one head drifts out of range, we start a second head at a safe position and smoothly blend from one to the other.

## Instructions

### 2.1 Add pitch shift buffers to `_initEffectBuffers()`

```javascript
// ── Pitch shift (crossfaded granular synthesis) ──
this._pitchBufSize = 8192;         // Circular buffer size (samples)
this._pitchGrainSize = 2048;       // Safe zone boundary
this._pitchFadeLen = 512;          // ~10ms @ 48kHz — inaudible crossfade

// Per-channel circular buffers
this._pitchBufs = [
  new Float32Array(this._pitchBufSize),
  new Float32Array(this._pitchBufSize)
];
this._pitchWritePos = [0, 0];

// Two read heads per channel: A (active) and B (crossfade target)
const initOffset = Math.floor(this._pitchBufSize * 0.5);
this._pitchHeadA = [initOffset, initOffset];
this._pitchHeadB = [initOffset, initOffset];
this._pitchFadePos = [-1, -1];  // -1 = not crossfading, ≥0 = fade progress
```

### 2.2 Implement `_applyPitchShift()`

This is the complete algorithm. Study the comments carefully:

```javascript
_applyPitchShift(outputChannel, channelIndex) {
  const { pitchShift } = this.params;

  // Skip if pitch is unchanged (within tolerance)
  if (Math.abs(pitchShift - 1.0) < 0.01) return;

  const buf  = this._pitchBufs[channelIndex];
  const BUF  = this._pitchBufSize;
  const FADE = this._pitchFadeLen;
  const SAFE_MIN = this._pitchGrainSize;         // 2048
  const SAFE_MAX = BUF - this._pitchGrainSize;   // 6144

  let writePos = this._pitchWritePos[channelIndex];
  let headA    = this._pitchHeadA[channelIndex];
  let headB    = this._pitchHeadB[channelIndex];
  let fadePos  = this._pitchFadePos[channelIndex];

  for (let i = 0; i < outputChannel.length; i++) {
    // Write current sample to circular buffer
    buf[writePos] = outputChannel[i];
    writePos = (writePos + 1) % BUF;

    // Read from head A (with linear interpolation for smooth sub-sample reads)
    const ia = Math.floor(headA) % BUF;
    const fa = headA - Math.floor(headA);
    const sA = buf[ia] * (1 - fa) + buf[(ia + 1) % BUF] * fa;

    if (fadePos >= 0) {
      // ── Crossfading A → B ──
      const ib = Math.floor(headB) % BUF;
      const fb = headB - Math.floor(headB);
      const sB = buf[ib] * (1 - fb) + buf[(ib + 1) % BUF] * fb;

      // Linear crossfade: blend from A to B
      const t = fadePos / FADE;
      outputChannel[i] = sA * (1 - t) + sB * t;

      headB += pitchShift;
      fadePos++;

      if (fadePos >= FADE) {
        // Crossfade complete — B becomes the new A
        headA = headB;
        fadePos = -1;
      }
    } else {
      // ── Normal output from head A ──
      outputChannel[i] = sA;

      // Check if A has drifted out of the safe zone
      let dist = writePos - headA;
      if (dist < 0) dist += BUF;

      if (dist < SAFE_MIN || dist > SAFE_MAX) {
        // Reposition B at the center of the safe zone and start crossfade
        headB = (writePos - (BUF >> 1) + BUF) % BUF;
        fadePos = 0;
      }
    }

    headA += pitchShift;
  }

  // Save state for next process() call
  this._pitchWritePos[channelIndex] = writePos;
  this._pitchHeadA[channelIndex]    = headA;
  this._pitchHeadB[channelIndex]    = headB;
  this._pitchFadePos[channelIndex]  = fadePos;
}
```

### 2.3 Enable in process()

Uncomment `this._applyPitchShift(tempBuffer, channel)` in the effect chain.

### 2.4 Test with hardcoded values

Temporarily set in the constructor:
```javascript
this.params.pitchShift = 0.75; // Lower pitch (orc-like)
```

Start the app — you should hear your voice noticeably deeper.

Then try:
```javascript
this.params.pitchShift = 1.5; // Higher pitch
```

You should hear your voice significantly higher.

**Restore to 1.0 (no change) after testing.**

### 2.5 Understanding the algorithm

**Why dual heads?** A single read head works until it drifts too close to (or too far from) the write position. At that point, reading produces stale data or unwritten silence. The dual-head approach places a second head at a safe position and crossfades to it, eliminating clicks.

**Why 512-sample crossfade?** At 48kHz, 512 samples ≈ 10ms. This is long enough for an inaudible transition but short enough to not introduce perceptible delay.

**Why linear interpolation?** The read position advances by `pitchShift` per sample, which is usually fractional. Without interpolation, we'd snap to the nearest integer position, creating aliasing artifacts. Linear interpolation smooths the read between adjacent samples.

## Verification
- [ ] With pitchShift=0.75: voice sounds clearly deeper
- [ ] With pitchShift=1.5: voice sounds clearly higher
- [ ] With pitchShift=1.0: voice sounds unchanged (passthrough)
- [ ] No clicks, pops, or glitches at any pitch setting
- [ ] No clicks during the crossfade transitions
- [ ] Stereo audio works correctly (both channels affected independently)
- [ ] No console errors
