# Step 4: Distortion and Chorus

## Task
Implement distortion (tanh waveshaping) and chorus (3-voice modulated delay lines).

## Instructions

### 4.1 Implement `_applyDistortion()`

Distortion is stateless — no buffers needed. It uses `tanh()` waveshaping for soft saturation that sounds warm rather than harsh.

```javascript
_applyDistortion(outputChannel) {
  const { distortionAmount } = this.params;
  if (distortionAmount <= 0.001) return;

  // Map 0–1 to drive 1–30 (exponential feel)
  const drive = 1 + distortionAmount * 29;
  // Normalize so that max output ≈ max input (prevents overall volume boost)
  const norm = Math.tanh(drive);

  for (let i = 0; i < outputChannel.length; i++) {
    outputChannel[i] = Math.tanh(drive * outputChannel[i]) / norm;
  }
}
```

**Why tanh instead of hard clipping?** Hard clipping (`Math.max(-1, Math.min(1, x))`) creates harsh harmonics. `Math.tanh()` provides smooth saturation — the signal compresses gradually as it approaches the limits, producing a warmer "analog" distortion character.

**Why normalize?** Without dividing by `Math.tanh(drive)`, increasing the drive would also increase the overall volume. Normalization keeps the output level consistent regardless of drive amount.

### 4.2 Add chorus buffers to `_initEffectBuffers()`

```javascript
// ── Chorus (3-voice modulated delay lines) ──
this._chorusLfoFreqsHz = [0.5, 0.7, 1.1];  // Incommensurate frequencies (no resonance)
this._chorusBaseSamples = [0.007, 0.011, 0.013].map(d => d * sampleRate);  // 7ms, 11ms, 13ms
this._chorusMaxDepthSamples = 0.006 * sampleRate;  // 6ms max modulation depth
this._chorusBufSize = Math.ceil((0.013 + 0.006) * sampleRate) + 10;  // Large enough for max delay

this._chorusBufs = [
  new Float32Array(this._chorusBufSize),
  new Float32Array(this._chorusBufSize)
];
this._chorusWritePos = 0;
this._chorusLfoPhases = [0, 0, 0];
```

**Why three voices?** A single delayed copy creates a comb filter that cancels specific frequencies. Three voices with different delays and LFO rates smear the cancellations across the spectrum, producing a thick, pleasing sound instead of hollow coloring.

**Why incommensurate LFO frequencies (0.5, 0.7, 1.1)?** Frequencies that don't have simple ratios never align, ensuring the three voices never combine in a way that amplifies a single frequency.

### 4.3 Implement `_applyChorus()`

```javascript
_applyChorus(outputChannel, channelIndex) {
  const { chorusDepth, chorusMix } = this.params;
  if (chorusMix <= 0.001) return;

  // Minimum 5% depth prevents static comb filtering at zero depth
  const BASE_MOD = 0.05;
  const effectiveDepth = BASE_MOD + chorusDepth * (1 - BASE_MOD);

  const buf = this._chorusBufs[channelIndex];
  const bufSize = this._chorusBufSize;
  const baseWritePos = this._chorusWritePos;

  for (let i = 0; i < outputChannel.length; i++) {
    const writePos = (baseWritePos + i) % bufSize;
    buf[writePos] = outputChannel[i];

    let wetSum = 0;
    for (let v = 0; v < 3; v++) {
      const lfoPhase = this._chorusLfoPhases[v] +
        (2 * Math.PI * this._chorusLfoFreqsHz[v] * i) / sampleRate;
      const lfo = Math.sin(lfoPhase);

      const delaySamples = this._chorusBaseSamples[v] +
        this._chorusMaxDepthSamples * effectiveDepth * 0.5 * (1 + lfo);

      let rp = writePos - delaySamples;
      if (rp < 0) rp += bufSize;

      // Linear interpolation
      const ri = Math.floor(rp) % bufSize;
      const frac = rp - Math.floor(rp);
      const s0 = buf[ri];
      const s1 = buf[(ri + 1) % bufSize];
      wetSum += s0 + frac * (s1 - s0);
    }

    // Average the 3 voices to prevent summing above dry level
    outputChannel[i] = outputChannel[i] + (wetSum / 3) * chorusMix;
  }

  // Advance LFO phases by the full block length
  for (let v = 0; v < 3; v++) {
    this._chorusLfoPhases[v] = (
      this._chorusLfoPhases[v] +
      (2 * Math.PI * this._chorusLfoFreqsHz[v] * outputChannel.length) / sampleRate
    ) % (2 * Math.PI);
  }
}
```

### 4.4 Update shared write positions in process()

After the per-channel loop in `process()`, advance the chorus write position:

```javascript
// Advance shared write positions once after all channels
this._chorusWritePos = (this._chorusWritePos + output[0].length) % this._chorusBufSize;
```

### 4.5 Enable in process()

Uncomment in the effect chain:
```javascript
this._applyDistortion(tempBuffer);
this._applyChorus(tempBuffer, channel);
```

### 4.6 Test with hardcoded values

**Distortion test:**
```javascript
this.params.distortionAmount = 0.3;
```
You should hear warm saturation on your voice.

**Chorus test:**
```javascript
this.params.chorusDepth = 0.5;
this.params.chorusMix = 0.5;
```
You should hear a thicker, layered version of your voice.

**Restore to defaults (0.0) after testing.**

## Verification
- [ ] Distortion: amount=0.3 gives warm saturation, no harsh clipping
- [ ] Distortion: amount=0 has no effect
- [ ] Chorus: depth=0.5, mix=0.5 gives a thick, layered sound
- [ ] Chorus: mix=0 has no effect
- [ ] Combined: both effects active simultaneously produce a pleasing result
- [ ] No clicks, pops, or artifacts
- [ ] No console errors
