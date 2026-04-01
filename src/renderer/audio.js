// Audio module - manages all audio processing

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

    // Send mute (mutes mic track directly)
    this.isSendMuted = false;

    // Output mute (mutes ALL output: monitor + all remote peers)
    this.isOutputMuted = false;
    this._savedMasterGain = null;
    this._savedPeerVolumes = null;

    // Currently selected output device ID (null = system default)
    this.currentOutputDeviceId = null;

    // Currently selected input device ID (null = system default)
    this.currentInputDeviceId = null;

    // Microphone processing constraints — applied via getUserMedia.
    // AGC normalises the mic level in the capture pipeline (BEFORE the Web Audio graph),
    // so it does not interfere with voice effects applied in the AudioWorklet.
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
    // Phase 5: Map of <audio> elements, one per remote peer
    this.remotePeers = new Map(); // peerId → { audioElement, stream }

    // Input gain node (pre-effect mic boost, shared by monitor + send paths)
    this.inputGainNode = null;

    // Current effect parameters (applied to BOTH monitor and send worklets)
    this.currentEffectParams = {};
  }

  async init() {
    try {
      // Create AudioContext with low latency settings
      this.audioContext = new AudioContext({
        sampleRate: 48000,
        latencyHint: 'interactive'
      });

      // Log AudioContext info
      console.log('=== AudioContext Created ===');
      console.log(`State: ${this.audioContext.state}`);
      console.log(`Sample Rate: ${this.audioContext.sampleRate} Hz`);
      console.log(`Base Latency: ${(this.audioContext.baseLatency * 1000).toFixed(2)} ms`);
      console.log(`Output Latency: ${(this.audioContext.outputLatency * 1000).toFixed(2)} ms`);

      // Load AudioWorklet processor
      // In packaged builds the worklet is unpacked from ASAR — ask main process for the correct path
      let workletPath = './audio-worklet-processor.js';
      if (window.ipcAPI && window.ipcAPI.getWorkletPath) {
        workletPath = await window.ipcAPI.getWorkletPath();
        console.log(`[Audio] Worklet path (from IPC): ${workletPath}`);
      }
      await this.audioContext.audioWorklet.addModule(workletPath);
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

      // Setup audio passthrough
      this.setupPassthrough();

      // Enumerate devices after getting microphone permission
      await this.enumerateDevices();

      // Listen for device changes
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

  setupPassthrough() {
    // SENDER-SIDE EFFECTS ARCHITECTURE:
    //
    // Local monitoring (user hears own voice with effects):
    //   Mic → sourceNode → workletNode (effects) → gainNode → speakers
    //
    // Sending to remote peer (effects applied BEFORE sending):
    //   Mic → sourceNode → sendWorkletNode (effects) → sendGain → sendStreamDestination → WebRTC
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
    this.gainNode.gain.value = 1.0;

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
    // Lifts quiet passages and tames peaks, similar to what Discord does.
    this.sendCompressor = this._createVoiceCompressor();

    this.sendStreamDestination = this.audioContext.createMediaStreamDestination();

    this.inputGainNode.connect(this.sendWorkletNode);
    this.sendWorkletNode.connect(this.sendGain);
    this.sendGain.connect(this.sendCompressor);
    this.sendCompressor.connect(this.sendStreamDestination);

    console.log('=== Audio Passthrough Active ===');
    console.log('⚠️  WARNING: Use headphones to avoid feedback!');
    console.log('AudioWorklet loaded and connected');
    console.log('✓ Sender-side effects: processed audio sent via WebRTC');
    console.log(`Base Latency: ${(this.audioContext.baseLatency * 1000).toFixed(2)} ms`);
    console.log(`Output Latency: ${(this.audioContext.outputLatency * 1000).toFixed(2)} ms`);
    console.log(`Total Estimated Latency: ${((this.audioContext.baseLatency + this.audioContext.outputLatency) * 1000).toFixed(2)} ms`);

    // Log send stream info
    this.logSendStream();
  }

  logSendStream() {
    const sendStream = this.getSendStream();
    if (sendStream) {
      const tracks = sendStream.getAudioTracks();
      console.log(`[Audio] Send stream ready (raw mic for PeerJS setup): ${tracks.length} track(s)`);
      console.log(`[Audio] Send stream ID: ${sendStream.id}`);
      tracks.forEach(t => {
        console.log(`[Audio] Send track: ${t.label}, enabled=${t.enabled}, muted=${t.muted}`);
        const settings = t.getSettings();
        console.log(`[Audio] Send track settings: sampleRate=${settings.sampleRate}, channels=${settings.channelCount}`);
      });
      console.log(`[Audio] Note: Effects applied sender-side via sendWorkletNode → MediaStreamDestination`);
      console.log(`[Audio] Processed track will replace raw track after call setup via replaceTrack()`);
    } else {
      console.error('[Audio] Send stream NOT available');
    }
  }

  setInputGain(value) {
    // Controls mic input boost (pre-effect, affects both monitor and send paths)
    if (this.inputGainNode) {
      this.inputGainNode.gain.value = value;
    }
  }

  setMasterGain(value) {
    // Value should be 0.0 to 2.0
    if (this.isOutputMuted) {
      // Output is globally muted — save for later restore, don't apply
      this._savedMasterGain = value;
      this.previousGain = value;
      return;
    }
    if (this.gainNode && !this.isMuted) {
      this.gainNode.gain.value = value;
      this.previousGain = value;
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
    console.log('[Audio] getSendStream returning:', {
      streamId: this.micStream.id,
      trackLabel: track.label,
      trackEnabled: track.enabled,
      trackMuted: track.muted,
      trackReadyState: track.readyState
    });

    if (track.muted) {
      console.warn('[Audio] WARNING: Track is muted at system level. This may cause silent audio.');
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
    if (track) {
      console.log('[Audio] getProcessedTrack:', {
        label: track.label,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState
      });
    } else {
      console.error('[Audio] getProcessedTrack: no audio track in destination stream');
    }
    return track;
  }

  toggleMute() {
    if (!this.gainNode) return;

    this.isMuted = !this.isMuted;

    if (this.isMuted) {
      this.previousGain = this.gainNode.gain.value;
      this.gainNode.gain.value = 0;
    } else {
      this.gainNode.gain.value = this.previousGain;
    }

    return this.isMuted;
  }

  toggleSendMute() {
    if (!this.micStream) return false;

    this.isSendMuted = !this.isSendMuted;

    // Mute by disabling the mic track (affects WebRTC sending)
    const tracks = this.micStream.getAudioTracks();
    tracks.forEach(track => {
      track.enabled = !this.isSendMuted;
    });

    console.log(`[Audio] Send ${this.isSendMuted ? 'muted' : 'unmuted'} (track.enabled=${!this.isSendMuted})`);
    return this.isSendMuted;
  }

  muteSend() {
    if (!this.micStream) {
      console.warn('[Audio] Cannot mute send: micStream not initialized');
      return;
    }
    if (this.isSendMuted) {
      console.log('[Audio] Already muted');
      return;
    }

    this.isSendMuted = true;
    const tracks = this.micStream.getAudioTracks();
    tracks.forEach(track => {
      track.enabled = false;
    });
    console.log('[Audio] Send muted (track disabled)');
  }

  unmuteSend() {
    if (!this.micStream) {
      console.warn('[Audio] Cannot unmute send: micStream not initialized');
      return;
    }
    if (!this.isSendMuted) {
      console.log('[Audio] Already unmuted');
      return;
    }

    this.isSendMuted = false;
    const tracks = this.micStream.getAudioTracks();
    tracks.forEach(track => {
      track.enabled = true;
    });
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

    console.log('=== Available Audio Devices ===');
    console.log('INPUTS:');
    devices.inputs.forEach((device, index) => {
      console.log(`  ${index + 1}. ${device.label} (deviceId: ${device.deviceId.substring(0, 16)}...)`);
    });
    console.log('OUTPUTS:');
    devices.outputs.forEach((device, index) => {
      console.log(`  ${index + 1}. ${device.label} (deviceId: ${device.deviceId.substring(0, 16)}...)`);
    });

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
    // deviceId param: explicit device (used during switchInput to change device + keep constraints).
    // Without deviceId: uses stored currentInputDeviceId, or no deviceId = system default.
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
    // If audio isn't initialized yet, constraints will be picked up on the next init() call.
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

      const audioTrack = this.micStream.getAudioTracks()[0];
      console.log(`[Audio] ✓ Mic constraints applied. Effective settings:`, audioTrack.getSettings());

      return { success: true, deviceLabel: audioTrack.label };
    } catch (error) {
      console.error('[Audio] Failed to apply mic constraints:', error);
      return { success: false, error: error.message };
    }
  }

  getCurrentDevices() {
    const currentInput = this.micStream
      ? this.micStream.getAudioTracks()[0].label
      : 'None';

    // Web Audio API destination is typically "default"
    const currentOutput = 'default';

    return {
      input: currentInput,
      output: currentOutput
    };
  }

  async switchInput(deviceId) {
    if (!this.audioContext || !this.isInitialized) {
      console.error('Cannot switch input: audio not initialized');
      return { success: false, error: 'Audio not initialized' };
    }

    try {
      console.log(`Switching input to device: ${deviceId.substring(0, 16)}...`);

      // Stop current stream
      if (this.micStream) {
        this.micStream.getTracks().forEach(track => track.stop());
      }

      // Disconnect current source node
      if (this.sourceNode) {
        this.sourceNode.disconnect();
      }

      // Remember the selected device so applyMicConstraints() can reuse it
      this.currentInputDeviceId = deviceId;

      // Get new stream with specific device ID + current processing constraints
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: this._buildAudioConstraints(deviceId)
      });

      const audioTrack = this.micStream.getAudioTracks()[0];
      const settings = audioTrack.getSettings();

      console.log(`[Audio] New mic stream after switch:`, {
        streamId: this.micStream.id,
        trackLabel: audioTrack.label,
        trackEnabled: audioTrack.enabled,
        trackMuted: audioTrack.muted,
        trackReadyState: audioTrack.readyState,
        sampleRate: settings.sampleRate,
        channelCount: settings.channelCount
      });

      // Create new source node and reconnect through input gain node
      this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);
      this.sourceNode.connect(this.inputGainNode);
      // inputGainNode stays connected to both worklets from setupPassthrough()

      console.log(`✓ Switched input to: ${audioTrack.label}`);

      // Note: The sendStreamDestination's track is a live output from the audio graph.
      // When we reconnect the source, the processed audio automatically flows to the
      // same destination stream/track. No need to call replaceTrack() again —
      // the WebRTC sender already has the destination track.

      return { success: true, deviceLabel: audioTrack.label };
    } catch (error) {
      console.error('Failed to switch input:', error);
      return { success: false, error: error.message };
    }
  }

  async switchOutput(deviceId) {
    if (!this.audioContext) {
      console.error('Cannot switch output: audio not initialized');
      return { success: false, error: 'Audio not initialized' };
    }

    try {
      // Check if setSinkId is supported (AudioContext path)
      if (typeof this.audioContext.setSinkId !== 'function') {
        console.warn('setSinkId not supported in this environment');
        return { success: false, error: 'Output switching not supported' };
      }

      console.log(`Switching output to device: ${deviceId.substring(0, 16)}...`);

      // Switch local monitor (AudioContext → speakers)
      await this.audioContext.setSinkId(deviceId);

      // Switch all active remote peer <audio> elements.
      // Remote audio bypasses the AudioContext entirely, so we must update
      // each element's sink independently.
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

      console.log(`✓ Switched output to device: ${deviceId.substring(0, 16)}... (AudioContext + ${this.remotePeers.size} remote peer(s))`);

      return { success: true };
    } catch (error) {
      console.error('Failed to switch output:', error);
      return { success: false, error: error.message };
    }
  }

  _createVoiceCompressor() {
    // Voice-optimised DynamicsCompressorNode.
    // Lifts quiet speech and tames peaks for a consistent, "fuller" sound.
    // These settings are deliberately gentle — enough to smooth out level
    // differences without audible pumping or squashing voice dynamics.
    const comp = this.audioContext.createDynamicsCompressor();
    comp.threshold.value = -24;  // Start compressing at -24 dB (catches quiet speech)
    comp.knee.value      = 12;   // Soft knee — gradual onset, natural feel
    comp.ratio.value     = 3;    // 3:1 — moderate compression, not a hard limiter
    comp.attack.value    = 0.003; // 3 ms — fast enough to catch plosives
    comp.release.value   = 0.15;  // 150 ms — smooth release, avoids pumping
    return comp;
  }

  setEffectParams(params) {
    // Update current params cache
    Object.assign(this.currentEffectParams, params);

    // Send to BOTH monitor and send worklets (sender-side effects)
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'setParams',
        data: params
      });
    }

    if (this.sendWorkletNode) {
      this.sendWorkletNode.port.postMessage({
        type: 'setParams',
        data: params
      });
    }

    console.log('[Audio] Effect params updated on monitor + send worklets:', params);
  }

  getCurrentEffectParams() {
    return { ...this.currentEffectParams };
  }

  setupRemoteAudio(peerId, remoteStream) {
    // SENDER-SIDE EFFECTS: Remote audio already has effects applied.
    // We just need to play it — no Web Audio processing needed.
    // Phase 5: One <audio> element per peer.
    this.stopRemoteAudio(peerId);

    const tracks = remoteStream.getAudioTracks();
    console.log(`[Audio] Setting up remote audio from ${peerId} (sender-side effects — direct playback):`, {
      streamId: remoteStream.id,
      trackCount: tracks.length,
      trackEnabled: tracks[0]?.enabled,
      trackMuted: tracks[0]?.muted,
      trackReadyState: tracks[0]?.readyState
    });

    // Create <audio> element for playback.
    const audioElement = document.createElement('audio');
    audioElement.volume = 1.0;
    document.body.appendChild(audioElement);

    // === Attempt GainNode routing for >100% volume amplification ===
    //
    // Known Chromium/Electron bugs with remote WebRTC streams:
    //   - createMediaStreamSource() → audioContext.destination = SILENT
    //   - createMediaElementSource() on MediaStream-backed <audio> = unreliable
    //
    // Strategy: route through createMediaStreamSource → GainNode → MediaStreamDestination,
    // then play the DESTINATION stream through the <audio> element. This avoids the
    // audioContext.destination silence bug by never connecting to it. If the source node
    // does produce audio internally (bug may only affect final speaker output), the
    // GainNode can amplify 0–300%.
    //
    // Safety: start with direct playback (always works), then verify the gain path.
    // If gain path is silent after 1s, keep direct playback (volume capped at 100%).
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

        // Start with the gain-routed stream
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
      console.log(`[Audio] Direct playback for ${peerId} (volume via audioElement.volume, capped at 100%)`);
    }

    // Set output device
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
    console.log(`[Audio] Remote audio from ${peerId} connected. Total remote sources: ${this.remotePeers.size}`);

    // === VERIFY gain path produces audio (async) ===
    // If the gain-routed stream is silent after 1 second, fall back to direct playback.
    // This handles the case where createMediaStreamSource internally produces no data
    // for remote WebRTC streams.
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
      console.log(`[Audio] New peer ${peerId} muted (output mute active)`);
    }
  }

  _verifyGainRouting(peerId, remoteStream, gainDestination) {
    // Check if the gain-routed stream actually carries audio.
    // Uses an AnalyserNode on the destination stream to detect signal.
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const checkSource = this.audioContext.createMediaStreamSource(gainDestination.stream);
    checkSource.connect(analyser);

    let checksRemaining = 5; // Check 5 times over ~1.25 seconds
    const checkInterval = setInterval(() => {
      checksRemaining--;
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

      if (avg > 1) {
        // Audio detected — gain routing works!
        clearInterval(checkInterval);
        checkSource.disconnect();
        console.log(`[Audio] ✓ GainNode routing VERIFIED for ${peerId} — volume range 0–300%`);
        return;
      }

      if (checksRemaining <= 0) {
        // No audio detected — fall back to direct playback
        clearInterval(checkInterval);
        checkSource.disconnect();

        const entry = this.remotePeers.get(peerId);
        if (entry) {
          console.warn(`[Audio] GainNode routing silent for ${peerId} — falling back to direct playback`);
          entry.audioElement.srcObject = remoteStream;
          entry.gainNode = null; // Mark as non-functional
          entry.audioElement.play().catch(() => {});
        }
      }
    }, 250);
  }

  stopRemoteAudio(peerId) {
    // Clean up <audio> element (and GainNode if present) for a specific peer
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
    // value range: 0.0 to 3.0 (0% to 300%)
    //
    // Two modes depending on whether GainNode routing is active:
    //   - gainNode active:  audio flows through Web Audio graph, GainNode handles 0–300%.
    //                       audioElement.volume stays at 1.0 (it feeds the graph).
    //   - gainNode null:    audio plays directly from <audio> element.
    //                       audioElement.volume handles 0–100% (HTML5 cap).
    const clamped = Math.min(Math.max(value, 0), 3.0);

    if (this.isOutputMuted) {
      // Output is globally muted — save for later restore, don't apply
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
        // GainNode routing verified — it controls the full 0–300% range.
        // Keep audioElement.volume at 1.0 so the graph gets full-level input.
        entry.gainNode.gain.value = clamped;
        entry.audioElement.volume = 1.0;
      } else {
        // Direct playback — audioElement.volume is the only control (0–100%).
        entry.audioElement.volume = Math.min(clamped, 1.0);
      }
      console.log(`[Audio] Volume for ${peerId}: ${(clamped * 100).toFixed(0)}% (${entry.gainNode ? 'GainNode' : 'element'})`);
    } else {
      console.warn(`[Audio] Cannot set remote volume for ${peerId}: no remote audio entry`);
    }
  }

  // ==================== OUTPUT MUTE (all audio to speakers/headphones) ====================

  muteAllOutput() {
    if (this.isOutputMuted) return;
    this.isOutputMuted = true;

    // Save and mute monitor/loopback gain
    this._savedMasterGain = this.gainNode ? this.gainNode.gain.value : this.previousGain;
    if (this.gainNode) this.gainNode.gain.value = 0;

    // Save and mute all remote peers
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

    // Restore monitor/loopback gain
    if (this.gainNode) {
      this.gainNode.gain.value = this._savedMasterGain ?? this.previousGain;
    }

    // Restore all remote peers
    this.remotePeers.forEach((entry, peerId) => {
      const saved = this._savedPeerVolumes ? this._savedPeerVolumes.get(peerId) : null;
      if (saved) {
        if (entry.gainNode) {
          entry.gainNode.gain.value = saved.gain;
          entry.audioElement.volume = 1.0; // GainNode controls volume; element feeds graph
        } else {
          entry.audioElement.volume = saved.elementVolume;
        }
      } else {
        // Peer was added while muted — restore to default
        if (entry.gainNode) entry.gainNode.gain.value = 1.0;
        entry.audioElement.volume = 1.0;
      }
    });

    this._savedMasterGain = null;
    this._savedPeerVolumes = null;
    console.log('[Audio] All output unmuted');
  }

  getEffectivePeerVolume(peerId) {
    // Returns the "real" volume for a peer (what it will be when output is unmuted)
    if (this.isOutputMuted && this._savedPeerVolumes) {
      const saved = this._savedPeerVolumes.get(peerId);
      return saved ? saved.gain : 1.0;
    }
    const entry = this.remotePeers.get(peerId);
    if (!entry) return 1.0;
    return entry.gainNode ? entry.gainNode.gain.value : entry.audioElement.volume;
  }

  // DIAGNOSTIC: Test if local mic stream has audio data
  async testLocalStream() {
    if (!this.micStream) {
      console.error('[Audio Test] No local mic stream available');
      return;
    }

    console.log('[Audio Test] Testing local mic stream...');

    const analyzer = this.audioContext.createAnalyser();
    analyzer.fftSize = 256;
    const dataArray = new Uint8Array(analyzer.frequencyBinCount);

    // Create a temporary source from the mic stream
    const testSource = this.audioContext.createMediaStreamSource(this.micStream);
    testSource.connect(analyzer);

    // Check for audio data over 2 seconds
    let checksWithAudio = 0;
    const checks = 20;

    console.log('[Audio Test] Speak into your microphone now...');

    for (let i = 0; i < checks; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      analyzer.getByteFrequencyData(dataArray);

      const sum = dataArray.reduce((a, b) => a + b, 0);
      const average = sum / dataArray.length;

      if (average > 3) {
        checksWithAudio++;
      }

      console.log(`[Audio Test] Local check ${i + 1}/${checks}: avg level = ${average.toFixed(2)}`);
    }

    testSource.disconnect();

    if (checksWithAudio > 0) {
      console.log(`[Audio Test] ✓ Local mic stream HAS audio (${checksWithAudio}/${checks} checks had audio)`);
      return true;
    } else {
      console.error(`[Audio Test] ✗ Local mic stream is SILENT - check microphone settings`);
      return false;
    }
  }

  // DIAGNOSTIC: Test if the send worklet destination has audio data
  async testSendStream() {
    if (!this.sendStreamDestination) {
      console.error('[Audio Test] No send stream destination available');
      return;
    }

    console.log('[Audio Test] Testing send stream (processed audio from worklet)...');

    const analyzer = this.audioContext.createAnalyser();
    analyzer.fftSize = 256;
    const dataArray = new Uint8Array(analyzer.frequencyBinCount);

    const testSource = this.audioContext.createMediaStreamSource(this.sendStreamDestination.stream);
    testSource.connect(analyzer);

    let checksWithAudio = 0;
    const checks = 20;

    console.log('[Audio Test] Speak into your microphone now...');

    for (let i = 0; i < checks; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      analyzer.getByteFrequencyData(dataArray);

      const sum = dataArray.reduce((a, b) => a + b, 0);
      const average = sum / dataArray.length;

      if (average > 3) {
        checksWithAudio++;
      }

      console.log(`[Audio Test] Send check ${i + 1}/${checks}: avg level = ${average.toFixed(2)}`);
    }

    testSource.disconnect();

    if (checksWithAudio > 0) {
      console.log(`[Audio Test] ✓ Send stream HAS audio (${checksWithAudio}/${checks} checks)`);
    } else {
      console.error(`[Audio Test] ✗ Send stream is SILENT — worklet may not be producing output`);
    }
  }

  cleanup() {
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.inputGainNode) {
      this.inputGainNode.disconnect();
      this.inputGainNode = null;
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.sendWorkletNode) {
      this.sendWorkletNode.disconnect();
      this.sendWorkletNode = null;
    }

    if (this.sendGain) {
      this.sendGain.disconnect();
      this.sendGain = null;
    }

    if (this.sendCompressor) {
      this.sendCompressor.disconnect();
      this.sendCompressor = null;
    }

    if (this.monitorCompressor) {
      this.monitorCompressor.disconnect();
      this.monitorCompressor = null;
    }

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
