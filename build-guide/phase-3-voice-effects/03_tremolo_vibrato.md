# Step 3: Tremolo and Vibrato

## Task
Implement tremolo (amplitude modulation) and vibrato (pitch modulation) — both are LFO-based effects.

## What these effects do

**Tremolo** varies the volume up and down at a regular rate. Low frequency (~2 Hz) gives a dramatic pulsing; high frequency (~15 Hz) gives a "shaky" quality.

**Vibrato** varies the pitch up and down at a regular rate. It uses a modulated delay line — the delay time oscillates, which changes the effective playback speed and thus the perceived pitch.

## Instructions

### 3.1 Add tremolo buffer to `_initEffectBuffers()`

```javascript
// ── Tremolo ──
this._tremoloPhase = 0;  // LFO phase, 0 to 2π
```

Tremolo is stateless except for the LFO phase — no buffer needed.

### 3.2 Implement `_applyTremolo()`

```javascript
_applyTremolo(outputChannel) {
  const { tremoloIntensity, tremoloFrequency } = this.params;
  if (tremoloIntensity <= 0.001) return;  // Skip if inactive

  const phaseInc = (2 * Math.PI * tremoloFrequency) / sampleRate;

  for (let i = 0; i < outputChannel.length; i++) {
    const lfo = 0.5 + 0.5 * Math.sin(this._tremoloPhase);
    const gain = 1.0 - (tremoloIntensity * 0.5) * (1.0 - lfo);
    outputChannel[i] *= gain;
    this._tremoloPhase += phaseInc;
  }

  // Keep phase within 0 to 2π to avoid floating-point drift
  this._tremoloPhase %= (2 * Math.PI);
}
```

**Why `tremoloIntensity * 0.5`?** This scales the depth so that at full intensity (1.0), the volume oscillates between 50% and 100% rather than 0% and 100%. A full zero-to-max swing sounds too aggressive for voice effects.

### 3.3 Add vibrato buffers to `_initEffectBuffers()`

```javascript
// ── Vibrato ──
this._vibratoBufferSize = 2048;
this._vibratoBuffers = [
  new Float32Array(this._vibratoBufferSize),
  new Float32Array(this._vibratoBufferSize)
];
this._vibratoWritePos = [0, 0];
this._vibratoPhase = 0;
```

### 3.4 Implement `_applyVibrato()`

```javascript
_applyVibrato(outputChannel, channelIndex) {
  const { vibratoIntensity, vibratoFrequency } = this.params;
  if (vibratoIntensity <= 0.001) return;

  const maxDelaySamples = 240;  // Max ~5ms modulation depth at 48kHz
  const phaseInc = (2 * Math.PI * vibratoFrequency) / sampleRate;
  const buffer = this._vibratoBuffers[channelIndex];
  let writePos = this._vibratoWritePos[channelIndex];

  for (let i = 0; i < outputChannel.length; i++) {
    // Write current sample to delay buffer
    buffer[writePos] = outputChannel[i];

    // Calculate modulated delay from LFO
    const lfo = 0.5 + 0.5 * Math.sin(this._vibratoPhase);
    const centerDelay = maxDelaySamples * vibratoIntensity * 0.5;
    const modAmount = maxDelaySamples * vibratoIntensity * 0.5 * lfo;
    const delaySamples = centerDelay + modAmount;

    // Read from delay buffer with linear interpolation
    let readPos = writePos - delaySamples;
    if (readPos < 0) readPos += this._vibratoBufferSize;

    const readIndex = Math.floor(readPos);
    const fraction = readPos - readIndex;
    const s1 = buffer[readIndex % this._vibratoBufferSize];
    const s2 = buffer[(readIndex + 1) % this._vibratoBufferSize];
    outputChannel[i] = s1 + fraction * (s2 - s1);

    writePos = (writePos + 1) % this._vibratoBufferSize;
    this._vibratoPhase += phaseInc;
  }

  this._vibratoPhase %= (2 * Math.PI);
  this._vibratoWritePos[channelIndex] = writePos;
}
```

### 3.5 Enable in process()

Uncomment both lines in the effect chain:
```javascript
this._applyTremolo(tempBuffer);
this._applyVibrato(tempBuffer, channel);
```

### 3.6 Test with hardcoded values

**Tremolo test:**
```javascript
this.params.tremoloIntensity = 0.5;
this.params.tremoloFrequency = 4.0;
```
You should hear a clear pulsing volume on your voice.

**Vibrato test:**
```javascript
this.params.vibratoIntensity = 0.3;
this.params.vibratoFrequency = 5.0;
```
You should hear a wobbling pitch effect.

**Restore all to defaults (0.0) after testing.**

## Verification
- [ ] Tremolo: with intensity=0.5, frequency=4 — clear pulsing volume
- [ ] Tremolo: with intensity=0 — no effect (passthrough)
- [ ] Vibrato: with intensity=0.3, frequency=5 — wobbling pitch
- [ ] Vibrato: with intensity=0 — no effect (passthrough)
- [ ] No clicks or pops at effect edges
- [ ] Passthrough still works when both effects are off
- [ ] No console errors
