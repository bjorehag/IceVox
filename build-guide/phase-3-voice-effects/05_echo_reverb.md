# Step 5: Echo and Reverb

## Task
Implement echo (feedback delay line) and reverb (Freeverb-style: 4 parallel damped comb filters + 2 series allpass filters).

## Instructions

### 5.1 Echo buffers (already in `_initEffectBuffers()`)

If not added yet:

```javascript
// ── Echo (max 1 second @ 48kHz) ──
this._echoBufferSize = 48000;
this._echoBuffers = [
  new Float32Array(this._echoBufferSize),
  new Float32Array(this._echoBufferSize)
];
this._echoWritePos = 0;
```

### 5.2 Implement `_applyEcho()`

```javascript
_applyEcho(outputChannel, channelIndex) {
  const { echoDelay, echoFeedback } = this.params;
  if (echoDelay <= 0.001 || echoFeedback <= 0.001) return;

  const delaySamples = Math.floor(echoDelay * sampleRate);
  const buffer = this._echoBuffers[channelIndex];
  const safeFeedback = Math.min(echoFeedback, 0.85);  // Cap to prevent infinite buildup
  const ECHO_WET = 0.65;  // Wet level — delayed signal is slightly quieter than dry

  for (let i = 0; i < outputChannel.length; i++) {
    const writePos = (this._echoWritePos + i) % this._echoBufferSize;
    let readPos = writePos - delaySamples;
    if (readPos < 0) readPos += this._echoBufferSize;

    const delayed = buffer[readPos];
    buffer[writePos] = outputChannel[i] + safeFeedback * delayed;
    outputChannel[i] = outputChannel[i] + ECHO_WET * delayed;
  }
}
```

**Why cap feedback at 0.85?** With feedback ≥ 1.0, the echo never decays — it builds up infinitely until the audio clips. Capping at 0.85 ensures the echo always fades out.

### 5.3 Add reverb buffers to `_initEffectBuffers()`

Freeverb uses 4 parallel damped comb filters feeding into 2 series allpass filters. Each needs its own circular buffer.

```javascript
// ── Reverb (Freeverb-style: 4 damped comb + 2 allpass) ──
const COMB_DELAYS_S = [0.02531, 0.02694, 0.02898, 0.03079];     // ~25-31ms
const ALLPASS_DELAYS_S = [0.01261, 0.01000];                      // ~12.6ms, 10ms

this._reverbCombSizes = COMB_DELAYS_S.map(d => Math.ceil(d * sampleRate) + 2);
this._reverbAllpassSizes = ALLPASS_DELAYS_S.map(d => Math.ceil(d * sampleRate) + 2);

// Per-channel buffers
this._reverbCombBufs = [
  this._reverbCombSizes.map(sz => new Float32Array(sz)),
  this._reverbCombSizes.map(sz => new Float32Array(sz))
];
this._reverbCombPos = [
  new Int32Array(COMB_DELAYS_S.length),
  new Int32Array(COMB_DELAYS_S.length)
];
this._reverbCombDamp = [
  new Float32Array(COMB_DELAYS_S.length),
  new Float32Array(COMB_DELAYS_S.length)
];
this._reverbAllpassBufs = [
  this._reverbAllpassSizes.map(sz => new Float32Array(sz)),
  this._reverbAllpassSizes.map(sz => new Float32Array(sz))
];
this._reverbAllpassPos = [
  new Int32Array(ALLPASS_DELAYS_S.length),
  new Int32Array(ALLPASS_DELAYS_S.length)
];
```

### 5.4 Implement `_applyReverb()`

```javascript
_applyReverb(outputChannel, channelIndex) {
  const { reverbDecay, reverbMix } = this.params;
  if (reverbMix <= 0.001) return;

  const feedback = 0.55 + reverbDecay * 0.38;  // Map 0–1 to 0.55–0.93
  const damp = 0.25;                             // Damping coefficient (high-frequency absorption)
  const wetGain = reverbMix * 0.35;              // Scale wet signal to not overwhelm dry

  const combBufs    = this._reverbCombBufs[channelIndex];
  const combPos     = this._reverbCombPos[channelIndex];
  const combDamp    = this._reverbCombDamp[channelIndex];
  const allpassBufs = this._reverbAllpassBufs[channelIndex];
  const allpassPos  = this._reverbAllpassPos[channelIndex];
  const nCombs      = this._reverbCombSizes.length;
  const nAllpass    = this._reverbAllpassSizes.length;

  for (let i = 0; i < outputChannel.length; i++) {
    const input = outputChannel[i];
    let wet = 0;

    // ── 4 parallel damped comb filters ──
    for (let c = 0; c < nCombs; c++) {
      const buf = combBufs[c];
      const sz = this._reverbCombSizes[c];
      const pos = combPos[c];
      const delayed = buf[pos];

      // Lowpass damping: blends current delayed sample with previous (removes high frequencies over time)
      combDamp[c] = delayed * (1 - damp) + combDamp[c] * damp;
      buf[pos] = input + feedback * combDamp[c];
      combPos[c] = (pos + 1) % sz;
      wet += delayed;
    }
    wet /= nCombs;  // Average the 4 comb filter outputs

    // ── 2 series allpass filters ──
    const G = 0.5;  // Allpass coefficient
    for (let a = 0; a < nAllpass; a++) {
      const buf = allpassBufs[a];
      const sz = this._reverbAllpassSizes[a];
      const pos = allpassPos[a];
      const v_delay = buf[pos];
      const v = wet - G * v_delay;
      wet = v_delay + G * v;
      buf[pos] = v;
      allpassPos[a] = (pos + 1) % sz;
    }

    outputChannel[i] += wetGain * wet;
  }
}
```

### 5.5 Understanding Freeverb

**Comb filters** create a dense pattern of reflections (like sound bouncing off walls in a room). The 4 different delay lengths create different reflection patterns that overlap into a smooth "tail."

**Damping** simulates high-frequency absorption by surfaces. Real rooms absorb high frequencies faster than low ones, so the reverb tail gets darker over time. The one-pole lowpass filter (`combDamp`) achieves this.

**Allpass filters** smear the reflections in time without changing the frequency balance, adding diffusion (the "smoothness" of the reverb). Without them, you'd hear distinct echoes instead of a smooth wash.

**Why 4+2?** More would be smoother but more CPU-intensive. 4 combs + 2 allpasses is the Freeverb standard — the sweet spot for quality vs. performance.

### 5.6 Update shared write positions in process()

Add echo write position advancement alongside chorus:

```javascript
this._echoWritePos = (this._echoWritePos + output[0].length) % this._echoBufferSize;
this._chorusWritePos = (this._chorusWritePos + output[0].length) % this._chorusBufSize;
```

### 5.7 Enable in process()

Uncomment in the effect chain:
```javascript
this._applyEcho(tempBuffer, channel);
this._applyReverb(tempBuffer, channel);
```

### 5.8 Test with hardcoded values

**Echo test:**
```javascript
this.params.echoDelay = 0.3;
this.params.echoFeedback = 0.4;
```
You should hear distinct echoing repetitions of your voice.

**Reverb test:**
```javascript
this.params.reverbDecay = 0.6;
this.params.reverbMix = 0.5;
```
You should hear a spacious, room-like wash around your voice.

**Restore to defaults (0.0) after testing.**

## Verification
- [ ] Echo: delay=0.3, feedback=0.4 — clear repeating echoes
- [ ] Echo: delay=0, feedback=0 — no effect
- [ ] Reverb: decay=0.6, mix=0.5 — spacious room-like effect
- [ ] Reverb: mix=0 — no effect
- [ ] All 7 effects can be active simultaneously without crashes or NaN
- [ ] Heavy effects (high distortion + chorus + reverb) don't clip harshly (tanh soft limiting works)
- [ ] No console errors
