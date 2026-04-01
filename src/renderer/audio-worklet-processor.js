// IceVox AudioWorklet Processor
// Phase 3+: Multi-effect chain — Pitch, Tremolo, Vibrato, Distortion, Chorus, Echo, Reverb

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

class IceVoxProcessor extends AudioWorkletProcessor {
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
    // ---- Tremolo ----
    this._tremoloPhase = 0;

    // ---- Vibrato ----
    this._vibratoBufferSize = 2048;
    this._vibratoBuffers = [
      new Float32Array(this._vibratoBufferSize),
      new Float32Array(this._vibratoBufferSize)
    ];
    this._vibratoWritePos = [0, 0];
    this._vibratoPhase = 0;

    // ---- Echo ---- (max 1 second @ 48kHz)
    this._echoBufferSize = 48000;
    this._echoBuffers = [
      new Float32Array(this._echoBufferSize),
      new Float32Array(this._echoBufferSize)
    ];
    this._echoWritePos = 0;

    // ---- Pitch shift (crossfaded granular synthesis) ----
    //
    // Uses two read heads (A and B). When the active head drifts too close to
    // the write position, the inactive head is positioned at a safe location and
    // a short crossfade (FADE_LEN samples) blends from A→B. This eliminates the
    // audible "click" caused by abrupt read-position jumps.
    this._pitchBufSize  = 8192;
    this._pitchGrainSize = 2048;
    this._pitchFadeLen  = 512;  // ~10ms @ 48kHz — inaudible transition
    this._pitchBufs = [
      new Float32Array(this._pitchBufSize),
      new Float32Array(this._pitchBufSize)
    ];
    this._pitchWritePos  = [0, 0];
    // Two read heads per channel: [headA, headB]
    // Initialise both far behind the write position (safe zone at startup)
    const initOffset = Math.floor(this._pitchBufSize * 0.5);
    this._pitchHeadA   = [initOffset, initOffset];
    this._pitchHeadB   = [initOffset, initOffset];
    this._pitchFadePos = [-1, -1]; // -1 = not crossfading, ≥0 = fade progress

    // ---- Distortion ---- (stateless waveshaper, no buffer needed)

    // ---- Chorus (3-voice modulated delay lines) ----
    this._chorusLfoFreqsHz   = [0.5, 0.7, 1.1];
    this._chorusBaseSamples  = [0.007, 0.011, 0.013].map(d => d * sampleRate);
    this._chorusMaxDepthSamples = 0.006 * sampleRate; // 6ms max modulation depth — doubled for audibility
    this._chorusBufSize = Math.ceil((0.013 + 0.006) * sampleRate) + 10;
    this._chorusBufs = [
      new Float32Array(this._chorusBufSize),
      new Float32Array(this._chorusBufSize)
    ];
    this._chorusWritePos  = 0;
    this._chorusLfoPhases = [0, 0, 0];

    // ---- Reverb (Freeverb-style: 4 damped comb + 2 allpass) ----
    const COMB_DELAYS_S    = [0.02531, 0.02694, 0.02898, 0.03079];
    const ALLPASS_DELAYS_S = [0.01261, 0.01000];

    this._reverbCombSizes    = COMB_DELAYS_S.map(d => Math.ceil(d * sampleRate) + 2);
    this._reverbAllpassSizes = ALLPASS_DELAYS_S.map(d => Math.ceil(d * sampleRate) + 2);

    this._reverbCombBufs = [
      this._reverbCombSizes.map(sz => new Float32Array(sz)),
      this._reverbCombSizes.map(sz => new Float32Array(sz))
    ];
    this._reverbCombPos  = [
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
  }

  process(inputs, outputs, parameters) {
    const input  = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    for (let channel = 0; channel < output.length; channel++) {
      const inputChannel  = input[channel] || input[0];
      const outputChannel = output[channel];

      // CRITICAL: use temp buffer + explicit per-sample write so
      // MediaStreamDestination registers the change (Chromium behaviour).
      const tempBuffer = new Float32Array(inputChannel.length);
      for (let i = 0; i < inputChannel.length; i++) tempBuffer[i] = inputChannel[i];

      // Effect chain: Pitch → Tremolo → Vibrato → Distortion → Chorus → Echo → Reverb → MasterGain
      this._applyPitchShift(tempBuffer, channel);
      this._applyTremolo(tempBuffer);
      this._applyVibrato(tempBuffer, channel);
      this._applyDistortion(tempBuffer);
      this._applyChorus(tempBuffer, channel);
      this._applyEcho(tempBuffer, channel);
      this._applyReverb(tempBuffer, channel);

      // Master output gain — compensates for RMS boost from distortion etc.
      // Soft limiting via tanh instead of hard clipping preserves dynamics and
      // avoids the harsh distortion that hard clipping introduces near full scale.
      const mg = this.params.masterGain ?? 1.0;
      for (let i = 0; i < outputChannel.length; i++) {
        outputChannel[i] = Math.tanh(tempBuffer[i] * mg);
      }
    }

    // Advance shared write positions once after all channels
    this._echoWritePos   = (this._echoWritePos   + output[0].length) % this._echoBufferSize;
    this._chorusWritePos = (this._chorusWritePos  + output[0].length) % this._chorusBufSize;

    return true;
  }

  // ================================================================
  //  PITCH SHIFT — crossfaded granular synthesis
  //
  //  Two read heads (A and B). Head A is always the "live" output.
  //  When A's distance to the write pointer leaves the safe zone
  //  [GRAIN, BUF-GRAIN], head B is placed at a safe offset and a
  //  FADE_LEN-sample crossfade blends from A→B. After the fade,
  //  B becomes the new A. The smooth transition eliminates clicks.
  // ================================================================
  _applyPitchShift(outputChannel, channelIndex) {
    const { pitchShift } = this.params;
    if (Math.abs(pitchShift - 1.0) < 0.01) return;

    const buf  = this._pitchBufs[channelIndex];
    const BUF  = this._pitchBufSize;
    const FADE = this._pitchFadeLen;
    const SAFE_MIN = this._pitchGrainSize;        // 2048
    const SAFE_MAX = BUF - this._pitchGrainSize;  // 6144

    let writePos = this._pitchWritePos[channelIndex];
    let headA    = this._pitchHeadA[channelIndex];
    let headB    = this._pitchHeadB[channelIndex];
    let fadePos  = this._pitchFadePos[channelIndex];

    for (let i = 0; i < outputChannel.length; i++) {
      // Write current sample
      buf[writePos] = outputChannel[i];
      writePos = (writePos + 1) % BUF;

      // Read from head A (interpolated)
      const ia = Math.floor(headA) % BUF;
      const fa = headA - Math.floor(headA);
      const sA = buf[ia] * (1 - fa) + buf[(ia + 1) % BUF] * fa;

      if (fadePos >= 0) {
        // --- Crossfading A → B ---
        const ib = Math.floor(headB) % BUF;
        const fb = headB - Math.floor(headB);
        const sB = buf[ib] * (1 - fb) + buf[(ib + 1) % BUF] * fb;

        const t = fadePos / FADE;
        outputChannel[i] = sA * (1 - t) + sB * t;

        headB   += pitchShift;
        fadePos++;

        if (fadePos >= FADE) {
          // Crossfade complete — B becomes the new A
          headA   = headB;
          fadePos = -1;
        }
      } else {
        // --- Normal output from A ---
        outputChannel[i] = sA;

        // Check if A has drifted out of the safe zone
        let dist = writePos - headA;
        if (dist < 0) dist += BUF;

        if (dist < SAFE_MIN || dist > SAFE_MAX) {
          // Reposition B at the centre of the safe zone and start crossfade
          headB   = (writePos - (BUF >> 1) + BUF) % BUF;
          fadePos = 0;
        }
      }

      headA += pitchShift;
    }

    this._pitchWritePos[channelIndex] = writePos;
    this._pitchHeadA[channelIndex]    = headA;
    this._pitchHeadB[channelIndex]    = headB;
    this._pitchFadePos[channelIndex]  = fadePos;
  }

  // ================================================================
  //  TREMOLO (amplitude LFO)
  // ================================================================
  _applyTremolo(outputChannel) {
    const { tremoloIntensity, tremoloFrequency } = this.params;
    if (tremoloIntensity <= 0.001) return;

    const phaseInc = (2 * Math.PI * tremoloFrequency) / sampleRate;
    for (let i = 0; i < outputChannel.length; i++) {
      const lfo  = 0.5 + 0.5 * Math.sin(this._tremoloPhase);
      const gain = 1.0 - (tremoloIntensity * 0.5) * (1.0 - lfo);
      outputChannel[i] *= gain;
      this._tremoloPhase += phaseInc;
    }
    this._tremoloPhase %= (2 * Math.PI);
  }

  // ================================================================
  //  VIBRATO (pitch LFO via modulated delay)
  // ================================================================
  _applyVibrato(outputChannel, channelIndex) {
    const { vibratoIntensity, vibratoFrequency } = this.params;
    if (vibratoIntensity <= 0.001) return;

    const maxDelaySamples = 240;
    const phaseInc        = (2 * Math.PI * vibratoFrequency) / sampleRate;
    const buffer   = this._vibratoBuffers[channelIndex];
    let writePos   = this._vibratoWritePos[channelIndex];

    for (let i = 0; i < outputChannel.length; i++) {
      buffer[writePos] = outputChannel[i];

      const lfo          = 0.5 + 0.5 * Math.sin(this._vibratoPhase);
      const centerDelay  = maxDelaySamples * vibratoIntensity * 0.5;
      const modAmount    = maxDelaySamples * vibratoIntensity * 0.5 * lfo;
      const delaySamples = centerDelay + modAmount;

      let readPos = writePos - delaySamples;
      if (readPos < 0) readPos += this._vibratoBufferSize;

      const readIndex = Math.floor(readPos);
      const fraction  = readPos - readIndex;
      const s1 = buffer[readIndex % this._vibratoBufferSize];
      const s2 = buffer[(readIndex + 1) % this._vibratoBufferSize];
      outputChannel[i] = s1 + fraction * (s2 - s1);

      writePos = (writePos + 1) % this._vibratoBufferSize;
      this._vibratoPhase += phaseInc;
    }

    this._vibratoPhase %= (2 * Math.PI);
    this._vibratoWritePos[channelIndex] = writePos;
  }

  // ================================================================
  //  DISTORTION (soft clipping via tanh waveshaper, normalised)
  //  distortionAmount 0→1 maps to drive 1→30.
  // ================================================================
  _applyDistortion(outputChannel) {
    const { distortionAmount } = this.params;
    if (distortionAmount <= 0.001) return;

    const drive = 1 + distortionAmount * 29;
    const norm  = Math.tanh(drive);

    for (let i = 0; i < outputChannel.length; i++) {
      outputChannel[i] = Math.tanh(drive * outputChannel[i]) / norm;
    }
  }

  // ================================================================
  //  CHORUS (3-voice modulated delay lines)
  //
  //  A small base modulation (5%) runs even at chorusDepth=0 so the
  //  effect is always audible as a thickening rather than a static
  //  comb filter that can cancel vocal frequencies.
  //  Wet blend uses a 0.7 scale to add body without overwhelming dry.
  // ================================================================
  _applyChorus(outputChannel, channelIndex) {
    const { chorusDepth, chorusMix } = this.params;
    if (chorusMix <= 0.001) return;

    // Minimum 5% depth guarantees the LFO always sweeps slightly,
    // preventing static cancellation at any single frequency.
    const BASE_MOD  = 0.05;
    const effectiveDepth = BASE_MOD + chorusDepth * (1 - BASE_MOD);

    const buf          = this._chorusBufs[channelIndex];
    const bufSize      = this._chorusBufSize;
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

        const ri   = Math.floor(rp) % bufSize;
        const frac = rp - Math.floor(rp);
        const s0   = buf[ri];
        const s1   = buf[(ri + 1) % bufSize];
        wetSum += s0 + frac * (s1 - s0);
      }

      // The /3 average prevents the 3 voices from summing above dry level.
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

  // ================================================================
  //  ECHO (feedback delay line, ECHO_WET = 0.65)
  // ================================================================
  _applyEcho(outputChannel, channelIndex) {
    const { echoDelay, echoFeedback } = this.params;
    if (echoDelay <= 0.001 || echoFeedback <= 0.001) return;

    const delaySamples = Math.floor(echoDelay * sampleRate);
    const buffer       = this._echoBuffers[channelIndex];
    const safeFeedback = Math.min(echoFeedback, 0.85);
    const ECHO_WET     = 0.65;

    for (let i = 0; i < outputChannel.length; i++) {
      const writePos = (this._echoWritePos + i) % this._echoBufferSize;
      let   readPos  = writePos - delaySamples;
      if (readPos < 0) readPos += this._echoBufferSize;

      const delayed = buffer[readPos];
      buffer[writePos] = outputChannel[i] + safeFeedback * delayed;
      outputChannel[i] = outputChannel[i] + ECHO_WET * delayed;
    }
  }

  // ================================================================
  //  REVERB (Freeverb-style: 4 parallel damped comb + 2 series allpass)
  //
  //  reverbDecay 0→1: feedback 0.55→0.93 (short to long tail)
  //  wetGain = reverbMix * 0.35 (scaled to not overwhelm dry signal)
  // ================================================================
  _applyReverb(outputChannel, channelIndex) {
    const { reverbDecay, reverbMix } = this.params;
    if (reverbMix <= 0.001) return;

    const feedback = 0.55 + reverbDecay * 0.38;
    const damp     = 0.25;
    const wetGain  = reverbMix * 0.35;

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

      for (let c = 0; c < nCombs; c++) {
        const buf     = combBufs[c];
        const sz      = this._reverbCombSizes[c];
        const pos     = combPos[c];
        const delayed = buf[pos];
        combDamp[c]   = delayed * (1 - damp) + combDamp[c] * damp;
        buf[pos]      = input + feedback * combDamp[c];
        combPos[c]    = (pos + 1) % sz;
        wet += delayed;
      }
      wet /= nCombs;

      const G = 0.5;
      for (let a = 0; a < nAllpass; a++) {
        const buf     = allpassBufs[a];
        const sz      = this._reverbAllpassSizes[a];
        const pos     = allpassPos[a];
        const v_delay = buf[pos];
        const v       = wet - G * v_delay;
        wet           = v_delay + G * v;
        buf[pos]      = v;
        allpassPos[a] = (pos + 1) % sz;
      }

      outputChannel[i] += wetGain * wet;
    }
  }
}

registerProcessor('icevox-processor', IceVoxProcessor);
