// IceVox video module (mobile + web) — in-app video chat.
//
// Ported from the desktop video window (src/video/video-renderer.js).
// The WIRE PROTOCOL is identical to desktop — signals are plain objects
// ({type:'offer'|'answer'|'ice', sdp|candidate}) relayed over the existing
// PeerJS data channels as {type:'video-signal', signal} messages — so video
// interoperates with desktop clients too.
//
// Differences from desktop (in-app overlay instead of separate window):
//  - Overlay UI with minimize (connections keep running) and close.
//  - Incoming signals while the overlay is CLOSED are buffered and processed
//    when the user opens video (desktop does the same in main.js).
//  - Camera flip button cycles video devices (front/back on phones).
//  - Video defaults to front camera (facingMode 'user', non-exact).

import connectionManager from './connection.js';

// ==================== QUALITY PROFILES (desktop verbatim) ====================

const QUALITY_PROFILES = {
  high:   { width: 1280, height: 720, frameRate: 24, bitrate: 1200000 },
  medium: { width: 854,  height: 480, frameRate: 20, bitrate: 600000 },
  low:    { width: 640,  height: 360, frameRate: 15, bitrate: 300000 },
};

function getAutoProfile(peerCount) {
  if (peerCount <= 2) return QUALITY_PROFILES.high;
  if (peerCount <= 3) return QUALITY_PROFILES.medium;
  return QUALITY_PROFILES.low;
}

class VideoManager {
  constructor() {
    this.isOpen = false;        // overlay visible or minimized (connections active)
    this.isMinimized = false;
    this.localStream = null;
    this.cameraOn = false;      // camera defaults OFF (desktop parity)
    this.qualityMode = 'auto';
    this.focusedPeerId = null;

    this.videoPeers = new Map();          // peerId → { pc, videoEl, cell, label, noCamera }
    this.pendingIceCandidates = new Map(); // peerId → [candidates] (before remoteDescription)
    this.bufferedSignals = [];             // signals received while closed (max cap)
    this.MAX_BUFFERED = 200;

    this.cameraDevices = [];    // enumerated videoinput devices
    this.cameraIndex = -1;      // -1 = default (facingMode user)

    this.onStateChange = null;  // () => {} — app.js updates buttons/pill/badge

    this._dom = null;           // resolved on first open
  }

  // ==================== DOM ====================

  _resolveDom() {
    if (this._dom) return this._dom;
    this._dom = {
      overlay: document.getElementById('video-overlay'),
      grid: document.getElementById('video-grid'),
      localCell: document.getElementById('video-local-cell'),
      localVideo: document.getElementById('video-local'),
      localNoCamera: document.getElementById('video-local-nocam'),
      cameraToggle: document.getElementById('video-camera-toggle'),
      flipBtn: document.getElementById('video-flip-btn'),
      qualitySelect: document.getElementById('video-quality-select'),
      minimizeBtn: document.getElementById('video-minimize-btn'),
      closeBtn: document.getElementById('video-close-btn'),
      fab: document.getElementById('video-fab'),
      fabCount: document.getElementById('video-fab-count'),
    };
    this._dom.localCell.dataset.peerId = 'local'; // for focus-mode class matching
    this._wireDom();
    return this._dom;
  }

  _wireDom() {
    const d = this._dom;

    d.cameraToggle.addEventListener('click', () => this.toggleCamera());
    d.flipBtn.addEventListener('click', () => this.flipCamera());
    d.minimizeBtn.addEventListener('click', () => this.minimize());
    d.closeBtn.addEventListener('click', () => this.close());
    d.fab.addEventListener('click', () => this.restore());

    d.qualitySelect.addEventListener('change', () => {
      this.qualityMode = d.qualitySelect.value;
      this._updateAllBitrates();
      console.log(`[Video] Quality mode: ${this.qualityMode}`);
    });

    // Tap local cell to focus self
    d.localCell.addEventListener('click', () => this._toggleFocus('local'));

    navigator.mediaDevices.addEventListener('devicechange', () => {
      if (this.isOpen) this._enumerateCameras();
    });
  }

  _emitState() {
    if (this.onStateChange) this.onStateChange();
  }

  // ==================== OPEN / MINIMIZE / CLOSE ====================

  async open() {
    const d = this._resolveDom();
    if (this.isOpen) { this.restore(); return; }

    this.isOpen = true;
    this.isMinimized = false;
    d.overlay.style.display = 'flex';
    d.fab.style.display = 'none';

    await this._enumerateCameras();

    // Create receive-only connections to ALL current room peers
    // (camera off by default — tracks are added when camera is toggled on)
    connectionManager.getConnectedPeerIds().forEach(peerId => {
      this._createWhenChannelReady(peerId, 0);
    });

    // Process signals that arrived while video was closed
    const buffered = this.bufferedSignals;
    this.bufferedSignals = [];
    for (const { peerId, signal } of buffered) {
      await this._handleSignalNow(peerId, signal);
    }

    this._updateAllBitrates();
    this._updateGridLayout();
    this._emitState();
    console.log(`[Video] Opened. Connections: ${this.videoPeers.size}, buffered signals processed: ${buffered.length}`);
  }

  minimize() {
    if (!this.isOpen) return;
    const d = this._resolveDom();
    this.isMinimized = true;
    d.overlay.style.display = 'none';
    d.fab.style.display = 'flex';
    this._updateFab();
    this._emitState();
  }

  restore() {
    if (!this.isOpen) return;
    const d = this._resolveDom();
    this.isMinimized = false;
    d.overlay.style.display = 'flex';
    d.fab.style.display = 'none';
    this._emitState();
  }

  close() {
    const d = this._resolveDom();
    this._stopCamera();

    this.videoPeers.forEach((entry) => {
      entry.pc.close();
      if (entry.cell.parentNode) entry.cell.parentNode.removeChild(entry.cell);
    });
    this.videoPeers.clear();
    this.pendingIceCandidates.clear();
    this.bufferedSignals = [];
    this.focusedPeerId = null;

    this.isOpen = false;
    this.isMinimized = false;
    d.overlay.style.display = 'none';
    d.fab.style.display = 'none';
    this._updateGridLayout();
    this._emitState();
    console.log('[Video] Closed — all connections released');
  }

  hasBufferedSignals() {
    return this.bufferedSignals.length > 0;
  }

  // ==================== CAMERA ====================

  _getCurrentProfile() {
    if (this.qualityMode === 'auto') return getAutoProfile(this.videoPeers.size);
    return QUALITY_PROFILES[this.qualityMode] || QUALITY_PROFILES.high;
  }

  _buildVideoConstraints() {
    const profile = this._getCurrentProfile();
    const constraints = {
      width: { ideal: profile.width },
      height: { ideal: profile.height },
      frameRate: { ideal: profile.frameRate },
    };
    if (this.cameraIndex >= 0 && this.cameraDevices[this.cameraIndex]) {
      constraints.deviceId = { exact: this.cameraDevices[this.cameraIndex].deviceId };
    } else {
      // Default: front camera on phones, any camera on desktop.
      // Non-exact so devices without facingMode support don't fail.
      constraints.facingMode = 'user';
    }
    return constraints;
  }

  async _startCamera() {
    const d = this._resolveDom();
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: this._buildVideoConstraints(),
        audio: false, // audio is handled by the main audio pipeline
      });

      d.localVideo.srcObject = this.localStream;
      d.localVideo.play().catch(() => {});
      d.localNoCamera.classList.add('hidden');
      this.cameraOn = true;
      this._updateCameraButton();

      // Labels become readable after permission — refresh device list
      await this._enumerateCameras();

      const profile = this._getCurrentProfile();
      console.log(`[Video] Camera started: ~${profile.width}x${profile.height}@${profile.frameRate}fps`);
      return true;
    } catch (err) {
      console.warn('[Video] Camera not available:', err.message || err);
      d.localNoCamera.querySelector('span').textContent = 'No camera — receiving only';
      d.localNoCamera.classList.remove('hidden');
      this.localStream = null;
      this.cameraOn = false;
      this._updateCameraButton();
      return false;
    }
  }

  _stopCamera() {
    const d = this._resolveDom();
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    d.localVideo.srcObject = null;
    d.localNoCamera.querySelector('span').textContent = 'Camera off';
    d.localNoCamera.classList.remove('hidden');
    this.cameraOn = false;
    this._updateCameraButton();
  }

  _updateCameraButton() {
    const d = this._resolveDom();
    d.cameraToggle.classList.toggle('active', this.cameraOn);
    d.cameraToggle.querySelector('.icon-cam-on').style.display = this.cameraOn ? '' : 'none';
    d.cameraToggle.querySelector('.icon-cam-off').style.display = this.cameraOn ? 'none' : '';
    // Flip is only meaningful with an active camera and >1 device
    d.flipBtn.style.display = (this.cameraOn && this.cameraDevices.length > 1) ? '' : 'none';
  }

  async toggleCamera() {
    if (this.cameraOn) {
      this._stopCamera();
      // Remove video tracks from all connections and renegotiate.
      // WE changed our tracks, so WE send the new offer (desktop parity;
      // glare is handled by lower-peer-ID priority in _handleSignalNow).
      this.videoPeers.forEach((entry, peerId) => {
        entry.pc.getSenders().forEach(s => {
          if (s.track && s.track.kind === 'video') entry.pc.removeTrack(s);
        });
        this._createAndSendOffer(peerId, entry.pc);
      });
    } else {
      const started = await this._startCamera();
      if (started && this.localStream) {
        const track = this.localStream.getVideoTracks()[0];
        this.videoPeers.forEach((entry, peerId) => {
          entry.pc.addTrack(track, this.localStream);
          this._createAndSendOffer(peerId, entry.pc);
        });
      }
    }
  }

  async _enumerateCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.cameraDevices = devices.filter(dv => dv.kind === 'videoinput');
      this._updateCameraButton();
      console.log(`[Video] ${this.cameraDevices.length} camera(s) available`);
    } catch (err) {
      console.warn('[Video] Failed to enumerate cameras:', err);
    }
  }

  async flipCamera() {
    // Cycle through available cameras (front ↔ back on phones).
    // Stop-then-reacquire, then replaceTrack on all connections
    // (no renegotiation needed — desktop parity).
    if (!this.cameraOn || this.cameraDevices.length < 2) return;

    this.cameraIndex = (this.cameraIndex + 1) % this.cameraDevices.length;
    const d = this._resolveDom();

    try {
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
      }
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: this._buildVideoConstraints(),
        audio: false,
      });

      d.localVideo.srcObject = this.localStream;
      d.localVideo.play().catch(() => {});
      const newTrack = this.localStream.getVideoTracks()[0];
      console.log(`[Video] Switched camera to: ${newTrack.label}`);

      this.videoPeers.forEach((entry, peerId) => {
        const videoSender = entry.pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(newTrack)
            .then(() => console.log(`[Video] Replaced track for ${peerId}`))
            .catch(err => console.warn(`[Video] replaceTrack failed for ${peerId}:`, err));
        }
      });
    } catch (err) {
      console.warn('[Video] Failed to switch camera:', err.message || err);
    }
  }

  // ==================== PEER CONNECTIONS ====================

  _shouldInitiateTo(peerId) {
    // Same initiator rule as the audio mesh: lower peer ID initiates.
    const ownId = connectionManager.getOwnPeerId();
    return ownId && ownId < peerId;
  }

  _peerName(peerId) {
    const peer = connectionManager.peers.get(peerId);
    return (peer && peer.info && peer.info.name) || peerId.replace('icevox-', '');
  }

  _createPeerConnection(peerId, isInitiator) {
    if (this.videoPeers.has(peerId)) {
      console.log(`[Video] Connection to ${peerId} already exists`);
      return;
    }
    const d = this._resolveDom();

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
    } else {
      // Camera off: add a receive-only video transceiver so that OUR offers
      // still contain a video m-line. Without it, an offer from a camera-off
      // initiator has no media sections at all, and the remote side's camera
      // track can never be attached to the answer (SDP answers can only
      // respond to offered m-lines). Wire-compatible with desktop peers.
      pc.addTransceiver('video', { direction: 'recvonly' });
    }

    pc.ontrack = (event) => {
      console.log(`[Video] Received video track from ${peerId}`);
      const entry = this.videoPeers.get(peerId);
      if (entry && entry.videoEl) {
        const stream = event.streams[0] || new MediaStream([event.track]);
        entry.videoEl.srcObject = stream;
        entry.videoEl.play().catch(() => {});
        entry.noCamera.classList.add('hidden');

        event.track.onended = () => {
          entry.noCamera.querySelector('span').textContent = 'Camera off';
          entry.noCamera.classList.remove('hidden');
        };
        event.track.onmute = () => {
          entry.noCamera.querySelector('span').textContent = 'Camera off';
          entry.noCamera.classList.remove('hidden');
        };
        event.track.onunmute = () => {
          entry.noCamera.classList.add('hidden');
        };
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        connectionManager.sendVideoSignal(peerId, {
          type: 'ice',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Video] ICE state (${peerId}): ${pc.iceConnectionState}`);
      // Connected but no track yet → the peer's camera is off, not "connecting"
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        const entry = this.videoPeers.get(peerId);
        if (entry && !entry.noCamera.classList.contains('hidden') && !entry.videoEl.srcObject) {
          entry.noCamera.querySelector('span').textContent = 'Camera off';
        }
      }
    };

    // Build the video cell
    const cell = document.createElement('div');
    cell.className = 'video-cell';
    cell.dataset.peerId = peerId;

    const videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.setAttribute('playsinline', ''); // iOS needs the attribute form
    videoEl.muted = true; // audio comes via the main audio pipeline

    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = this._peerName(peerId);

    const noCamera = document.createElement('div');
    noCamera.className = 'video-no-camera';
    noCamera.innerHTML = '<span>Connecting…</span>';

    cell.appendChild(videoEl);
    cell.appendChild(label);
    cell.appendChild(noCamera);
    cell.addEventListener('click', () => this._toggleFocus(peerId));
    d.grid.appendChild(cell);

    this.videoPeers.set(peerId, { pc, videoEl, cell, label, noCamera });
    this._updateGridLayout();
    this._applyBitrateConstraints(pc);

    if (isInitiator) {
      this._createAndSendOffer(peerId, pc);
    }

    console.log(`[Video] Created connection to ${peerId} (initiator: ${isInitiator}). Total: ${this.videoPeers.size}`);
  }

  async _createAndSendOffer(peerId, pc) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Plain object (desktop wire-format parity)
      connectionManager.sendVideoSignal(peerId, {
        type: 'offer',
        sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      });
      console.log(`[Video] Sent offer to ${peerId}`);
    } catch (err) {
      console.error(`[Video] Failed to create offer for ${peerId}:`, err);
    }
  }

  _removePeerConnection(peerId) {
    const entry = this.videoPeers.get(peerId);
    if (!entry) return;
    entry.pc.close();
    if (entry.cell.parentNode) entry.cell.parentNode.removeChild(entry.cell);
    this.videoPeers.delete(peerId);
    this.pendingIceCandidates.delete(peerId);
    if (this.focusedPeerId === peerId) this._toggleFocus(peerId); // unfocus
    this._updateGridLayout();
    console.log(`[Video] Removed connection to ${peerId}. Remaining: ${this.videoPeers.size}`);
  }

  // ==================== SIGNALING ====================

  handleSignal(peerId, signal) {
    if (!this.isOpen) {
      // Video not open — buffer (desktop main.js does the same). The UI shows
      // an indicator so the user knows someone started video.
      if (this.bufferedSignals.length < this.MAX_BUFFERED) {
        this.bufferedSignals.push({ peerId, signal });
      }
      this._emitState();
      return;
    }
    this._handleSignalNow(peerId, signal);
  }

  async _handleSignalNow(peerId, signal) {
    let entry = this.videoPeers.get(peerId);

    if (signal.type === 'offer') {
      if (!entry) {
        this._createPeerConnection(peerId, false);
        entry = this.videoPeers.get(peerId);
      }
      if (!entry) return;

      try {
        // Glare: both sides sent offers simultaneously.
        // Lower peer ID wins (keeps their offer); the other rolls back.
        if (entry.pc.signalingState === 'have-local-offer') {
          if (this._shouldInitiateTo(peerId)) {
            console.log(`[Video] Glare with ${peerId}: we have priority, ignoring their offer`);
            return;
          }
          console.log(`[Video] Glare with ${peerId}: rolling back our offer`);
          await entry.pc.setLocalDescription({ type: 'rollback' });
        }

        await entry.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        await this._applyBufferedCandidates(peerId, entry.pc);

        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        connectionManager.sendVideoSignal(peerId, {
          type: 'answer',
          sdp: { type: entry.pc.localDescription.type, sdp: entry.pc.localDescription.sdp },
        });
        console.log(`[Video] Sent answer to ${peerId}`);
      } catch (err) {
        console.error(`[Video] Failed to handle offer from ${peerId}:`, err);
      }

    } else if (signal.type === 'answer') {
      if (!entry) {
        console.warn(`[Video] Received answer from ${peerId} but no connection exists`);
        return;
      }
      try {
        if (entry.pc.signalingState !== 'have-local-offer') {
          console.warn(`[Video] Ignoring stale answer from ${peerId} (state: ${entry.pc.signalingState})`);
          return;
        }
        await entry.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        console.log(`[Video] Received answer from ${peerId}`);
        await this._applyBufferedCandidates(peerId, entry.pc);
      } catch (err) {
        console.error(`[Video] Failed to handle answer from ${peerId}:`, err);
      }

    } else if (signal.type === 'ice') {
      if (!entry || !entry.pc.remoteDescription) {
        if (!this.pendingIceCandidates.has(peerId)) {
          this.pendingIceCandidates.set(peerId, []);
        }
        this.pendingIceCandidates.get(peerId).push(signal.candidate);
        return;
      }
      try {
        await entry.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (err) {
        console.warn(`[Video] ICE candidate error (${peerId}):`, err.message);
      }
    }
  }

  async _applyBufferedCandidates(peerId, pc) {
    const candidates = this.pendingIceCandidates.get(peerId);
    if (!candidates || candidates.length === 0) return;
    console.log(`[Video] Applying ${candidates.length} buffered ICE candidate(s) for ${peerId}`);
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn(`[Video] Buffered ICE candidate error (${peerId}):`, err.message);
      }
    }
    this.pendingIceCandidates.delete(peerId);
  }

  // ==================== ROOM EVENTS (wired from app.js) ====================

  notifyPeerJoined(peerId) {
    if (!this.isOpen) return;
    if (this.videoPeers.has(peerId)) {
      // Update label in case display name arrived after the cell was created
      const entry = this.videoPeers.get(peerId);
      if (entry) entry.label.textContent = this._peerName(peerId);
      return;
    }
    this._createWhenChannelReady(peerId, 0);
  }

  // Create the video connection only once the peer's DATA CHANNEL is open —
  // offers sent into a not-yet-open channel are silently dropped by
  // connection.js (onRemoteStream often fires before the channel opens).
  _createWhenChannelReady(peerId, attempt) {
    if (!this.isOpen || this.videoPeers.has(peerId)) return;
    const peer = connectionManager.peers.get(peerId);
    if (!peer) return; // peer left in the meantime

    if (peer.dataConn && peer.dataConn.open) {
      this._createPeerConnection(peerId, this._shouldInitiateTo(peerId));
      this._updateAllBitrates();
      return;
    }

    if (attempt >= 40) { // ~12 s — give up, peer's channel never opened
      console.warn(`[Video] Data channel to ${peerId} never opened — skipping video connection`);
      return;
    }
    setTimeout(() => this._createWhenChannelReady(peerId, attempt + 1), 300);
  }

  notifyPeerLeft(peerId) {
    // Drop buffered signals from the departed peer
    this.bufferedSignals = this.bufferedSignals.filter(b => b.peerId !== peerId);
    if (!this.isOpen) { this._emitState(); return; }
    this._removePeerConnection(peerId);
    this._updateAllBitrates();
    this._updateFab();
  }

  // ==================== BITRATE ====================

  _applyBitrateConstraints(pc) {
    const profile = this._getCurrentProfile();
    const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!videoSender) return;
    try {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = profile.bitrate;
      videoSender.setParameters(params).catch(err => console.warn('[Video] Could not set bitrate:', err));
    } catch (err) {
      console.warn('[Video] Bitrate parameters not available:', err);
    }
  }

  _updateAllBitrates() {
    this.videoPeers.forEach((entry) => this._applyBitrateConstraints(entry.pc));
  }

  // ==================== LAYOUT ====================

  _updateGridLayout() {
    const d = this._resolveDom();
    const totalCells = this.videoPeers.size + 1; // +1 local preview
    d.grid.classList.remove('single-video', 'two-videos', 'focus-mode');
    if (this.focusedPeerId) {
      d.grid.classList.add('focus-mode');
    } else if (totalCells === 1) {
      d.grid.classList.add('single-video');
    } else if (totalCells === 2) {
      d.grid.classList.add('two-videos');
    }
    this._updateFab();
  }

  _toggleFocus(peerId) {
    const d = this._resolveDom();
    if (this.focusedPeerId === peerId) {
      // Unfocus — back to grid
      this.focusedPeerId = null;
      d.grid.querySelectorAll('.video-cell').forEach(c => c.classList.remove('focused'));
    } else {
      this.focusedPeerId = peerId;
      d.grid.querySelectorAll('.video-cell').forEach(c => {
        c.classList.toggle('focused', c.dataset.peerId === peerId);
      });
    }
    this._updateGridLayout();
  }

  _updateFab() {
    const d = this._resolveDom();
    if (d.fabCount) {
      d.fabCount.textContent = String(this.videoPeers.size + 1);
    }
  }
}

// Export singleton instance
const videoManager = new VideoManager();
export default videoManager;
