# Step 1: Effect Architecture

## Task
Set up the AudioWorklet processor class with preallocated buffers, parameter handling, and the process() method structure that all effects will plug into.

## Architecture Rule

> **Never allocate memory in `process()`.** The `process()` method runs on the audio thread at 48,000 times per second (in 128-sample blocks). Any heap allocation (new arrays, objects, etc.) triggers garbage collection pauses that cause audible glitches. ALL buffers must be preallocated in the constructor.
>
> **Explicit per-sample writes are mandatory.** When writing to the output buffer, use explicit `for` loops with per-sample assignment. Chromium may optimize away bulk operations like `Float32Array.set()`, causing `MediaStreamDestination` to not register audio changes.

## Instructions

### 1.1 Restructure the processor class

Replace the passthrough stub from Phase 2 with the full effect architecture:

```javascript
// audio-worklet-processor.js

const DEFAULT_PARAMS = {
  pitchShift: 1.0,           // 0.5 (octave down) to 2.0 (octave up), 1.0 = no change
  tremoloIntensity: 0.0,     // 0.0 (off) to 1.0 (full)
  tremoloFrequency: 5.0,     // Hz, 0.5 to 20.0
  vibratoIntensity: 0.0,     // 0.0 (off) to 1.0 (full)
  vibratoFrequency: 5.0,     // Hz, 0.5 to 20.0
  echoDelay: 0.0,            // seconds, 0.0 (off) to 1.0
  echoFeedback: 0.0,         // 0.0 (off) to 0.85 (max)
  distortionAmount: 0.0,     // 0.0 (off) to 1.0 (max)
  chorusDepth: 0.0,          // 0.0 (off) to 1.0 (deep modulation)
  chorusMix: 0.0,            // 0.0 (dry) to 1.0 (wet)
  reverbDecay: 0.0,          // 0.0 (short) to 1.0 (long tail)
  reverbMix: 0.0,            // 0.0 (dry) to 1.0 (full wet)
  masterGain: 1.0,           // output level trim after all effects (1.0 = unity)
};

class VoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.params = { ...DEFAULT_PARAMS };
    this._initEffectBuffers();
    this.port.onmessage = (event) => {
      const { type, data } = event.data;
      if (type === 'setParams') Object.assign(this.params, data);
    };
  }

  _initEffectBuffers() {
    // Buffers for each effect are preallocated here.
    // They will be populated in Steps 2–5 as each effect is implemented.
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    for (let channel = 0; channel < output.length; channel++) {
      const inputChannel = input[channel] || input[0];
      const outputChannel = output[channel];

      // CRITICAL: use temp buffer + explicit per-sample write
      const tempBuffer = new Float32Array(inputChannel.length);
      for (let i = 0; i < inputChannel.length; i++) {
        tempBuffer[i] = inputChannel[i];
      }

      // Effect chain (each method modifies tempBuffer in place):
      // this._applyPitchShift(tempBuffer, channel);
      // this._applyTremolo(tempBuffer);
      // this._applyVibrato(tempBuffer, channel);
      // this._applyDistortion(tempBuffer);
      // this._applyChorus(tempBuffer, channel);
      // this._applyEcho(tempBuffer, channel);
      // this._applyReverb(tempBuffer, channel);

      // Master output gain with tanh soft limiting
      const mg = this.params.masterGain ?? 1.0;
      for (let i = 0; i < outputChannel.length; i++) {
        outputChannel[i] = Math.tanh(tempBuffer[i] * mg);
      }
    }

    // Advance shared write positions once after all channels
    // (will be needed for echo and chorus — added in Steps 4-5)

    return true;
  }
}

registerProcessor('voice-processor', VoiceProcessor);
```

### 1.2 Understanding the process() flow

1. **Copy input to temp buffer** — sample-by-sample (Chromium requirement)
2. **Apply effects in chain order** — each method reads from and writes to `tempBuffer` in place
3. **Master gain + soft limit** — `Math.tanh(sample * masterGain)` prevents hard clipping; preserves dynamics
4. **Write to output** — the master gain loop writes final values to `outputChannel`

### 1.3 Why tanh soft limiting?

Hard clipping (`Math.max(-1, Math.min(1, sample))`) creates harsh digital distortion. `Math.tanh()` provides smooth saturation — loud signals compress gracefully without the harsh "buzz" of clipping. This is especially important when multiple effects (distortion + chorus + reverb) stack their gains.

### 1.4 Note about the tempBuffer allocation

Yes, `new Float32Array(128)` is allocated inside `process()`. This is a small, fixed-size allocation that V8 can optimize (it's on the fast path). The buffers we MUST preallocate are the large, variable-size ones (echo delay lines, reverb comb filters, etc.) that would trigger GC pauses.

## Verification
- [ ] The processor class compiles and loads without errors
- [ ] Audio passthrough still works (same as Phase 2)
- [ ] The effect chain comments are present but commented out (effects not yet implemented)
- [ ] `DEFAULT_PARAMS` contains all 13 parameters
- [ ] No console errors
