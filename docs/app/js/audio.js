// Audio module - manages all audio processing (IceVox Web)
//
// Adapted from the desktop AudioManager (src/renderer/audio.js) via the
// mobile version. Browser-specific differences, marked [MOBILE] or [WEB]:
//  - AudioContext is created WITHOUT a forced sampleRate. Mobile devices
//    (especially iOS WebKit) reject or resample forced rates; the worklet
//    reads the global `sampleRate` so all DSP adapts automatically.
//  - init() MUST be called from a user gesture (tap/click). Browsers start
//    AudioContext suspended until user interaction.
//  - Monitor (hearing your own voice) is OFF by default. Speaker use would
//    cause instant feedback. Toggleable in UI.
//  - [WEB] Output device switching IS supported where the browser allows it
//    (Chrome/Edge fully, Firefox partially, Safari mostly not) — feature-
//    detected via outputSelectionSupported().
//  - Handles AudioContext interruptions (phone calls, backgrounding) via
//    statechange listener + resumeIfSuspended().

class AudioManager {
  constructor() {
    this.audioContext = null;
    this.micStream = null;
    this.sourceNode = null;
    this.workletNode = null;       // Monitor worklet (local playback with effects)
    this.gainNode = null;
    this.isInitialized = false;
    this.isMuted = false;
    this.previousGain = 1.0;

    // [MOBILE] Monitor disabled by default (speaker feedback risk)
    this.monitorEnabled = false;

    // Send mute (mutes mic track directly)
    this.isSendMuted = false;

    // Output mute (mutes ALL output: monitor + all remote peers)
    this.isOutputMuted = false;
    this._savedMasterGain = null;
    this._savedPeerVolumes = null;

    // Currently selected input device ID (null = system default)
    this.currentInputDeviceId = null;

    // [WEB] Currently selected output device ID (null = system default)
    this.currentOutputDeviceId = null;

    // Microphone processing constraints — applied via getUserMedia.
    // AGC normalises the mic level in the capture pipeline (BEFORE the Web Audio graph),
    // so it does not interfere with voice effects applied in the AudioWorklet.
    // Echo cancellation is extra important on mobile (speakerphone use).
    this.micConstraints = {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true
    };

    // SENDER-SIDE EFFECTS: Send path worklet + MediaStreamDestination
    this.sendWorkletNode = null;   // Send worklet (processes audio before transmission)
    this.sendGain = null;
    this.sendCompressor = null;    // DynamicsCompressor on send path (evens out volume)
    this.monitorCompressor = null; // DynamicsCompressor on monitor path
    this.sendStreamDestination = null; // MediaStreamDestination for WebRTC

    // Remote audio (incoming from WebRTC) — already has effects applied
    // Map of <audio> elements, one per remote peer
    this.remotePeers = new Map(); // peerId → { audioElement, stream, gainNode }

    // Input gain node (pre-effect mic boost, shared by monitor + send paths)
    this.inputGainNode = null;

    // Current effect parameters (applied to BOTH monitor and send worklets)
    this.currentEffectParams = {};

    // [MOBILE] Callback when the AudioContext gets interrupted/resumed
    this.onContextStateChange = null; // (state) => {}
  }

  async init() {
    try {
      // [MOBILE] Create AudioContext WITHOUT forced sampleRate — let the device
      // pick its native rate. The AudioWorklet DSP adapts via the global
      // `sampleRate` value inside the worklet scope.
      this.audioContext = new AudioContext({
        latencyHint: 'interactive'
      });

      // [MOBILE] Must be resumed from a user gesture — init() is called from
      // a tap handler, so resume here is allowed.
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      console.log('=== AudioContext Created ===');
      console.log(`State: ${this.audioContext.state}`);
      console.log(`Sample Rate: ${this.audioContext.sampleRate} Hz`);
      console.log(`Base Latency: ${(this.audioContext.baseLatency * 1000).toFixed(2)} ms`);

      // [MOBILE] Track interruptions (incoming phone calls, headset unplug, backgrounding)
      this.audioContext.addEventListener('statechange', () => {
        console.log(`[Audio] AudioContext state: ${this.audioContext.state}`);
        if (this.onContextStateChange) this.onContextStateChange(this.audioContext.state);
      });

      // Load AudioWorklet processor (fixed relative path — no Electron IPC on mobile)
      await this.audioContext.audioWorklet.addModule('js/audio-worklet-processor.js');
      console.log('AudioWorklet module loaded');

      // Request microphone access with stored processing constraints
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: this._buildAudioConstraints()
      });

      const audioTrack = this.micStream.getAudioTracks()[0];
      const settings = audioTrack.getSettings();

      console.log('=== Microphone Access Granted ===');
      console.log(`Device: ${audioTrack.label}`);
      console.log(`Channels: ${settings.channelCount || 'N/A'}`);
      console.log(`Sample Rate: ${settings.sampleRate || 'N/A'} Hz`);

      // Setup audio graph (monitor + send paths)
      this.setupPassthrough();

      // Enumerate devices after getting microphone permission
      await this.enumerateDevices();

      // Listen for device changes (bluetooth headset connect/disconnect etc.)
      this.setupDeviceChangeListener();

      this.isInitialized = true;
      return { success: true, deviceLabel: audioTrack.label };

    } catch (error) {
      console.error('Audio initialization failed:', error);

      let errorMessage = 'Failed to initialize audio';
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Microphone access denied';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'No microphone found';
      }

      return { success: false, error: errorMessage };
    }
  }

  // [MOBILE] Called on visibilitychange / user tap after an interruption.
  async resumeIfSuspended() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        console.log('[Audio] AudioContext resumed');
      } catch (err) {
        console.warn('[Audio] Failed to resume AudioContext:', err);
      }
    }
  }

  setupPassthrough() {
    // SENDER-SIDE EFFECTS ARCHITECTURE (identical to desktop):
    //
    // Local monitoring (optional on mobile, default OFF):
    //   Mic → sourceNode → inputGainNode → workletNode (effects) → gainNode → compressor → speakers
    //
    // Sending to remote peer (effects applied BEFORE sending):
    //   Mic → sourceNode → inputGainNode → sendWorkletNode (effects) → sendGain → compressor → sendStreamDestination → WebRTC
    //   After PeerJS call setup: sender.replaceTrack(processedTrack)
    //
    // Receiving from remote peer (audio already has effects applied):
    //   WebRTC stream → <audio> element → speakers (no processing needed)

    // Create source node from microphone stream
    this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);

    // === INPUT GAIN (pre-effect mic boost, shared by both paths) ===
    this.inputGainNode = this.audioContext.createGain();
    this.inputGainNode.gain.value = 1.0;
    this.sourceNode.connect(this.inputGainNode);

    // === MONITOR PATH (local playback with effects) ===
    this.workletNode = new AudioWorkletNode(this.audioContext, 'icevox-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });

    this.gainNode = this.audioContext.createGain();
    // [MOBILE] Monitor starts silent — user opts in via "Hear myself" toggle
    this.gainNode.gain.value = this.monitorEnabled ? this.previousGain : 0;

    // DynamicsCompressor on monitor path — evens out volume for local playback
    this.monitorCompressor = this._createVoiceCompressor();

    this.inputGainNode.connect(this.workletNode);
    this.workletNode.connect(this.gainNode);
    this.gainNode.connect(this.monitorCompressor);
    this.monitorCompressor.connect(this.audioContext.destination);

    // === SEND PATH (effects applied before transmission) ===
    this.sendWorkletNode = new AudioWorkletNode(this.audioContext, 'icevox-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });

    this.sendGain = this.audioContext.createGain();
    this.sendGain.gain.value = 1.0;

    // DynamicsCompressor on send path — evens out volume before WebRTC transmission.
    this.sendCompressor = this._createVoiceCompressor();

    this.sendStreamDestination = this.audioContext.createMediaStreamDestination();

    this.inputGainNode.connect(this.sendWorkletNode);
    this.sendWorkletNode.connect(this.sendGain);
    this.sendGain.connect(this.sendCompressor);
    this.sendCompressor.connect(this.sendStreamDestination);

    console.log('=== Audio Graph Active ===');
    console.log(`Monitor: ${this.monitorEnabled ? 'ON' : 'OFF (mobile default)'}`);
    console.log('✓ Sender-side effects: processed audio sent via WebRTC');
  }

  // [MOBILE] Toggle hearing your own voice (headphones recommended!)
  setMonitorEnabled(enabled) {
    this.monitorEnabled = enabled;
    if (!this.gainNode) return;
    if (this.isOutputMuted) return; // output mute wins; state restored on unmute
    this.gainNode.gain.value = enabled ? this.previousGain : 0;
    console.log(`[Audio] Monitor ${enabled ? 'enabled' : 'disabled'}`);
  }

  setInputGain(value) {
    // Controls mic input boost (pre-effect, affects both monitor and send paths)
    if (this.inputGainNode) {
      this.inputGainNode.gain.value = value;
    }
  }

  setMasterGain(value) {
    // Value should be 0.0 to 2.0 — monitor (loopback) volume
    this.previousGain = value;
    if (this.isOutputMuted) {
      this._savedMasterGain = value;
      return;
    }
    if (this.gainNode && !this.isMuted && this.monitorEnabled) {
      this.gainNode.gain.value = value;
    }
  }

  getSendStream() {
    // Returns raw mic stream for PeerJS call setup.
    // After the call is established, connection.js will call replaceTrack()
    // to swap the raw mic track with the processed track from getProcessedTrack().
    if (!this.micStream) {
      console.error('[Audio] getSendStream called but micStream is null');
      return null;
    }

    const tracks = this.micStream.getAudioTracks();
    if (tracks.length === 0) {
      console.error('[Audio] getSendStream: micStream has no audio tracks');
      return null;
    }

    const track = tracks[0];
    if (track.muted) {
      console.warn('[Audio] WARNING: Track is muted at system level.');
    }
    if (track.readyState !== 'live') {
      console.warn(`[Audio] WARNING: Track readyState is "${track.readyState}", expected "live"`);
    }

    return this.micStream;
  }

  getProcessedTrack() {
    // Returns the processed audio track from MediaStreamDestination.
    // This track has effects applied via sendWorkletNode.
    // Used by connection.js for replaceTrack() after call setup.
    if (!this.sendStreamDestination) {
      console.error('[Audio] getProcessedTrack: sendStreamDestination not created');
      return null;
    }

    const track = this.sendStreamDestination.stream.getAudioTracks()[0];
    if (!track) {
      console.error('[Audio] getProcessedTrack: no audio track in destination stream');
    }
    return track;
  }

  toggleSendMute() {
    if (!this.micStream) return false;

    this.isSendMuted = !this.isSendMuted;

    // Mute by disabling the mic track (affects WebRTC sending)
    const tracks = this.micStream.getAudioTracks();
    tracks.forEach(track => {
      track.enabled = !this.isSendMuted;
    });

    console.log(`[Audio] Send ${this.isSendMuted ? 'muted' : 'unmuted'}`);
    return this.isSendMuted;
  }

  muteSend() {
    if (!this.micStream || this.isSendMuted) return;
    this.isSendMuted = true;
    this.micStream.getAudioTracks().forEach(track => { track.enabled = false; });
    console.log('[Audio] Send muted (track disabled)');
  }

  unmuteSend() {
    if (!this.micStream || !this.isSendMuted) return;
    this.isSendMuted = false;
    this.micStream.getAudioTracks().forEach(track => { track.enabled = true; });
    console.log('[Audio] Send unmuted (track enabled)');
  }

  async getDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      const inputs = devices
        .filter(d => d.kind === 'audioinput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.substring(0, 8)}`,
          kind: d.kind
        }));

      // [MOBILE] Outputs are not selectable on mobile (no setSinkId) —
      // still enumerated for diagnostics, but UI does not expose them.
      const outputs = devices
        .filter(d => d.kind === 'audiooutput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Speaker ${d.deviceId.substring(0, 8)}`,
          kind: d.kind
        }));

      return { inputs, outputs };
    } catch (error) {
      console.error('Failed to enumerate devices:', error);
      return { inputs: [], outputs: [] };
    }
  }

  async enumerateDevices() {
    const devices = await this.getDevices();
    console.log(`=== Audio Devices: ${devices.inputs.length} input(s), ${devices.outputs.length} output(s) ===`);
    devices.inputs.forEach((d, i) => console.log(`  IN ${i + 1}. ${d.label}`));
    return devices;
  }

  setupDeviceChangeListener() {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      console.log('=== Device Change Detected ===');
      await this.enumerateDevices();
    });
  }

  _buildAudioConstraints(deviceId) {
    // Build getUserMedia audio constraints combining mic processing settings and device selection.
    const constraints = { ...this.micConstraints };
    const id = deviceId !== undefined ? deviceId : this.currentInputDeviceId;
    if (id) {
      constraints.deviceId = { exact: id };
    }
    return constraints;
  }

  async applyMicConstraints(newConstraints) {
    // Update stored constraints and re-initialize the mic stream.
    // Called when the user changes noise suppression / echo cancellation / AGC in settings.
    Object.assign(this.micConstraints, newConstraints);

    if (!this.isInitialized) {
      return { success: true };
    }

    try {
      console.log('[Audio] Applying new mic constraints:', this.micConstraints);

      if (this.micStream) {
        this.micStream.getTracks().forEach(track => track.stop());
      }
      if (this.sourceNode) {
        this.sourceNode.disconnect();
      }

      // Re-acquire mic with updated constraints (keeps current device)
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: this._buildAudioConstraints()
      });

      // Reconnect source → inputGainNode (the rest of the graph is unchanged)
      this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);
      this.sourceNode.connect(this.inputGainNode);

      // Preserve send-mute state across the new track
      if (this.isSendMuted) {
        this.micStream.getAudioTracks().forEach(track => { track.enabled = false; });
      }

      const audioTrack = this.micStream.getAudioTracks()[0];
      console.log('[Audio] ✓ Mic constraints applied:', audioTrack.getSettings());

      return { success: true, deviceLabel: audioTrack.label };
    } catch (error) {
      console.error('[Audio] Failed to apply mic constraints:', error);
      return { success: false, error: error.message };
    }
  }

  async switchInput(deviceId) {
    if (!this.audioContext || !this.isInitialized) {
      console.error('Cannot switch input: audio not initialized');
      return { success: false, error: 'Audio not initialized' };
    }

    try {
      console.log(`Switching input to device: ${deviceId.substring(0, 16)}...`);

      if (this.micStream) {
        this.micStream.getTracks().forEach(track => track.stop());
      }
      if (this.sourceNode) {
        this.sourceNode.disconnect();
      }

      this.currentInputDeviceId = deviceId;

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: this._buildAudioConstraints(deviceId)
      });

      const audioTrack = this.micStream.getAudioTracks()[0];

      // Create new source node and reconnect through input gain node
      this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);
      this.sourceNode.connect(this.inputGainNode);

      // Preserve send-mute state across the new track
      if (this.isSendMuted) {
        this.micStream.getAudioTracks().forEach(track => { track.enabled = false; });
      }

      console.log(`✓ Switched input to: ${audioTrack.label}`);

      // Note: sendStreamDestination's track is a live output from the audio graph —
      // processed audio automatically flows to the same track. No replaceTrack() needed.

      return { success: true, deviceLabel: audioTrack.label };
    } catch (error) {
      console.error('Failed to switch input:', error);
      return { success: false, error: error.message };
    }
  }

  // [WEB] Is speaker/output selection available in this browser at all?
  // HTMLMediaElement.setSinkId covers remote peers; AudioContext.setSinkId
  // (Chrome 110+) additionally covers the local monitor path.
  outputSelectionSupported() {
    return typeof HTMLMediaElement !== 'undefined' &&
           typeof HTMLMediaElement.prototype.setSinkId === 'function';
  }

  async switchOutput(deviceId) {
    // [WEB] Same strategy as desktop: switch the AudioContext (monitor path)
    // where supported, and every remote peer <audio> element individually.
    if (!this.audioContext) {
      return { success: false, error: 'Audio not initialized' };
    }
    if (!this.outputSelectionSupported()) {
      console.warn('[Audio] setSinkId not supported in this browser');
      return { success: false, error: 'Output switching not supported in this browser' };
    }

    try {
      console.log(`Switching output to device: ${deviceId.substring(0, 16)}...`);

      // Monitor path (AudioContext → speakers) — Chrome 110+ only, optional
      if (typeof this.audioContext.setSinkId === 'function') {
        await this.audioContext.setSinkId(deviceId).catch(err => {
          console.warn('[Audio] AudioContext.setSinkId failed (monitor keeps default):', err.message);
        });
      }

      // All active remote peer <audio> elements — remote audio bypasses the
      // AudioContext, so each element's sink must be updated independently.
      const sinkPromises = [];
      this.remotePeers.forEach((entry, peerId) => {
        if (typeof entry.audioElement.setSinkId === 'function') {
          sinkPromises.push(
            entry.audioElement.setSinkId(deviceId).then(() => {
              console.log(`[Audio] Remote peer ${peerId} output switched`);
            }).catch(err => {
              console.warn(`[Audio] Failed to switch output for peer ${peerId}:`, err);
            })
          );
        }
      });
      await Promise.all(sinkPromises);

      // Remember for future <audio> elements created by setupRemoteAudio()
      this.currentOutputDeviceId = deviceId;

      console.log(`✓ Switched output (${this.remotePeers.size} remote peer(s))`);
      return { success: true };
    } catch (error) {
      console.error('Failed to switch output:', error);
      return { success: false, error: error.message };
    }
  }

  _createVoiceCompressor() {
    // Voice-optimised DynamicsCompressorNode (same tuning as desktop).
    const comp = this.audioContext.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value      = 12;
    comp.ratio.value     = 3;
    comp.attack.value    = 0.003;
    comp.release.value   = 0.15;
    return comp;
  }

  setEffectParams(params) {
    // Update current params cache
    Object.assign(this.currentEffectParams, params);

    // Send to BOTH monitor and send worklets (sender-side effects)
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'setParams', data: params });
    }
    if (this.sendWorkletNode) {
      this.sendWorkletNode.port.postMessage({ type: 'setParams', data: params });
    }
  }

  getCurrentEffectParams() {
    return { ...this.currentEffectParams };
  }

  setupRemoteAudio(peerId, remoteStream) {
    // SENDER-SIDE EFFECTS: Remote audio already has effects applied.
    // One <audio> element per peer, same strategy as desktop (Chromium WebView
    // has the same remote-stream quirks as Electron).
    this.stopRemoteAudio(peerId);

    const tracks = remoteStream.getAudioTracks();
    console.log(`[Audio] Setting up remote audio from ${peerId}:`, {
      streamId: remoteStream.id,
      trackCount: tracks.length
    });

    const audioElement = document.createElement('audio');
    audioElement.volume = 1.0;
    // playsinline avoids fullscreen takeover quirks on mobile
    audioElement.setAttribute('playsinline', '');
    document.body.appendChild(audioElement);

    // === Attempt GainNode routing for >100% volume amplification ===
    // Strategy identical to desktop: createMediaStreamSource → GainNode →
    // MediaStreamDestination → play destination stream. Verified async;
    // falls back to direct playback (volume capped at 100%) if silent.
    let gainNode = null;
    let gainDestination = null;

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        const source = this.audioContext.createMediaStreamSource(remoteStream);
        gainNode = this.audioContext.createGain();
        gainNode.gain.value = 1.0;
        gainDestination = this.audioContext.createMediaStreamDestination();

        source.connect(gainNode);
        gainNode.connect(gainDestination);

        audioElement.srcObject = gainDestination.stream;
        console.log(`[Audio] GainNode routing attempt for ${peerId} — verifying...`);
      } catch (err) {
        console.warn(`[Audio] GainNode routing failed for ${peerId}:`, err.message);
        gainNode = null;
        gainDestination = null;
      }
    }

    // Fallback: direct playback if Web Audio routing wasn't possible
    if (!gainDestination) {
      audioElement.srcObject = remoteStream;
      console.log(`[Audio] Direct playback for ${peerId} (volume capped at 100%)`);
    }

    // [WEB] Apply previously selected output device to the new element
    if (this.currentOutputDeviceId && typeof audioElement.setSinkId === 'function') {
      audioElement.setSinkId(this.currentOutputDeviceId).catch(err => {
        console.warn(`[Audio] Failed to set initial sink for ${peerId}:`, err);
      });
    }

    // Start playback
    audioElement.play().catch(err => {
      console.warn(`[Audio] Remote audio play() failed for ${peerId}:`, err);
    });

    this.remotePeers.set(peerId, { audioElement, stream: remoteStream, gainNode });
    console.log(`[Audio] Remote audio from ${peerId} connected. Total: ${this.remotePeers.size}`);

    // Verify gain path produces audio; fall back to direct if silent
    if (gainDestination) {
      this._verifyGainRouting(peerId, remoteStream, gainDestination);
    }

    // If output is globally muted, mute the new peer and save its default volume
    if (this.isOutputMuted) {
      if (this._savedPeerVolumes) {
        this._savedPeerVolumes.set(peerId, { gain: 1.0, elementVolume: 1.0 });
      }
      if (gainNode) gainNode.gain.value = 0;
      audioElement.volume = 0;
    }
  }

  _verifyGainRouting(peerId, remoteStream, gainDestination) {
    // Check if the gain-routed stream actually carries audio.
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const checkSource = this.audioContext.createMediaStreamSource(gainDestination.stream);
    checkSource.connect(analyser);

    let checksRemaining = 5; // ~1.25 seconds
    const checkInterval = setInterval(() => {
      checksRemaining--;
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

      if (avg > 1) {
        clearInterval(checkInterval);
        checkSource.disconnect();
        console.log(`[Audio] ✓ GainNode routing VERIFIED for ${peerId} — volume range 0–300%`);
        return;
      }

      if (checksRemaining <= 0) {
        clearInterval(checkInterval);
        checkSource.disconnect();

        const entry = this.remotePeers.get(peerId);
        if (entry) {
          console.warn(`[Audio] GainNode routing silent for ${peerId} — falling back to direct playback`);
          entry.audioElement.srcObject = remoteStream;
          entry.gainNode = null;
          entry.audioElement.play().catch(() => {});
        }
      }
    }, 250);
  }

  stopRemoteAudio(peerId) {
    const entry = this.remotePeers.get(peerId);
    if (entry) {
      if (entry.gainNode) entry.gainNode.disconnect();
      entry.audioElement.pause();
      entry.audioElement.srcObject = null;
      if (entry.audioElement.parentNode) {
        entry.audioElement.parentNode.removeChild(entry.audioElement);
      }
      this.remotePeers.delete(peerId);
      if (this._savedPeerVolumes) this._savedPeerVolumes.delete(peerId);
      console.log(`[Audio] Remote audio from ${peerId} stopped`);
    }
  }

  stopAllRemoteAudio() {
    this.remotePeers.forEach((entry) => {
      if (entry.gainNode) entry.gainNode.disconnect();
      entry.audioElement.pause();
      entry.audioElement.srcObject = null;
      if (entry.audioElement.parentNode) {
        entry.audioElement.parentNode.removeChild(entry.audioElement);
      }
    });
    this.remotePeers.clear();
    if (this._savedPeerVolumes) this._savedPeerVolumes.clear();
    console.log('[Audio] All remote audio stopped');
  }

  setRemoteVolume(peerId, value) {
    // value range: 0.0 to 3.0 (0% to 300%) — same dual-mode logic as desktop
    const clamped = Math.min(Math.max(value, 0), 3.0);

    if (this.isOutputMuted) {
      if (this._savedPeerVolumes) {
        this._savedPeerVolumes.set(peerId, {
          gain: clamped,
          elementVolume: Math.min(clamped, 1.0)
        });
      }
      return;
    }

    const entry = this.remotePeers.get(peerId);
    if (entry) {
      if (entry.gainNode) {
        entry.gainNode.gain.value = clamped;
        entry.audioElement.volume = 1.0;
      } else {
        entry.audioElement.volume = Math.min(clamped, 1.0);
      }
    } else {
      console.warn(`[Audio] Cannot set remote volume for ${peerId}: no entry`);
    }
  }

  // ==================== OUTPUT MUTE (all audio) ====================

  muteAllOutput() {
    if (this.isOutputMuted) return;
    this.isOutputMuted = true;

    this._savedMasterGain = this.gainNode ? this.gainNode.gain.value : this.previousGain;
    if (this.gainNode) this.gainNode.gain.value = 0;

    this._savedPeerVolumes = new Map();
    this.remotePeers.forEach((entry, peerId) => {
      this._savedPeerVolumes.set(peerId, {
        gain: entry.gainNode ? entry.gainNode.gain.value : 1.0,
        elementVolume: entry.audioElement.volume
      });
      if (entry.gainNode) entry.gainNode.gain.value = 0;
      entry.audioElement.volume = 0;
    });

    console.log('[Audio] All output muted');
  }

  unmuteAllOutput() {
    if (!this.isOutputMuted) return;
    this.isOutputMuted = false;

    // Restore monitor gain — only if monitor is enabled on mobile
    if (this.gainNode) {
      this.gainNode.gain.value = this.monitorEnabled
        ? (this._savedMasterGain ?? this.previousGain)
        : 0;
    }

    this.remotePeers.forEach((entry, peerId) => {
      const saved = this._savedPeerVolumes ? this._savedPeerVolumes.get(peerId) : null;
      if (saved) {
        if (entry.gainNode) {
          entry.gainNode.gain.value = saved.gain;
          entry.audioElement.volume = 1.0;
        } else {
          entry.audioElement.volume = saved.elementVolume;
        }
      } else {
        if (entry.gainNode) entry.gainNode.gain.value = 1.0;
        entry.audioElement.volume = 1.0;
      }
    });

    this._savedMasterGain = null;
    this._savedPeerVolumes = null;
    console.log('[Audio] All output unmuted');
  }

  getEffectivePeerVolume(peerId) {
    if (this.isOutputMuted && this._savedPeerVolumes) {
      const saved = this._savedPeerVolumes.get(peerId);
      return saved ? saved.gain : 1.0;
    }
    const entry = this.remotePeers.get(peerId);
    if (!entry) return 1.0;
    return entry.gainNode ? entry.gainNode.gain.value : entry.audioElement.volume;
  }

  cleanup() {
    if (this.sourceNode) { this.sourceNode.disconnect(); this.sourceNode = null; }
    if (this.inputGainNode) { this.inputGainNode.disconnect(); this.inputGainNode = null; }
    if (this.workletNode) { this.workletNode.disconnect(); this.workletNode = null; }
    if (this.sendWorkletNode) { this.sendWorkletNode.disconnect(); this.sendWorkletNode = null; }
    if (this.sendGain) { this.sendGain.disconnect(); this.sendGain = null; }
    if (this.sendCompressor) { this.sendCompressor.disconnect(); this.sendCompressor = null; }
    if (this.monitorCompressor) { this.monitorCompressor.disconnect(); this.monitorCompressor = null; }

    this.sendStreamDestination = null;

    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }

    this.stopAllRemoteAudio();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.isInitialized = false;
    this.currentEffectParams = {};
  }
}

// Export singleton instance
const audioManager = new AudioManager();
export default audioManager;
