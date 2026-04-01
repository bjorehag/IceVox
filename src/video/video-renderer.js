// IceVox Video Window — Renderer
// Manages camera access, per-peer RTCPeerConnections for video,
// and signaling relay via IPC ↔ main window ↔ data channel.

(function() {
  'use strict';

  // ==================== QUALITY PROFILES ====================

  const QUALITY_PROFILES = {
    high:   { width: 1280, height: 720, frameRate: 24, bitrate: 1200000 },
    medium: { width: 854,  height: 480, frameRate: 20, bitrate: 600000 },
    low:    { width: 640,  height: 360, frameRate: 15, bitrate: 300000 },
  };

  // Auto quality: select based on number of video peers
  function getAutoProfile(peerCount) {
    if (peerCount <= 2) return QUALITY_PROFILES.high;
    if (peerCount <= 3) return QUALITY_PROFILES.medium;
    return QUALITY_PROFILES.low;
  }

  // ==================== STATE ====================

  let iceConfig = [];          // ICE servers (received from main window)
  let ownPeerId = null;        // Our peer ID
  let localStream = null;      // Local camera MediaStream
  let cameraOn = true;         // Camera toggle state
  let focusMode = false;       // Grid vs Focus layout
  let focusedPeerId = null;    // Which peer is focused (focus mode)
  let qualityMode = 'auto';    // 'auto' | 'high' | 'medium' | 'low'
  let settingsOpen = false;
  let selectedCameraId = '';   // '' = default, or a specific deviceId

  // Per-peer video connections: peerId → { pc, videoEl, cell }
  const videoPeers = new Map();

  // ==================== DOM REFS ====================

  const videoGrid = document.getElementById('video-grid');
  const localVideo = document.getElementById('local-video');
  const localCell = document.getElementById('local-cell');
  const localNoCamera = document.getElementById('local-no-camera');
  const cameraToggle = document.getElementById('camera-toggle');
  const cameraIconOn = document.getElementById('camera-icon-on');
  const cameraIconOff = document.getElementById('camera-icon-off');
  const layoutToggle = document.getElementById('layout-toggle');
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsPanel = document.getElementById('settings-panel');
  const settingsClose = document.getElementById('settings-close');
  const closeBtn = document.getElementById('close-btn');
  const qualitySelect = document.getElementById('quality-select');
  const qualityInfo = document.getElementById('quality-info');
  const cameraSelect = document.getElementById('camera-select');
  const cameraInfo = document.getElementById('camera-info');

  // ==================== CAMERA ====================

  async function enumerateCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(d => d.kind === 'videoinput');

      // Preserve current selection
      const currentVal = cameraSelect.value;
      cameraSelect.innerHTML = '<option value="">Default</option>';
      cameras.forEach(cam => {
        const opt = document.createElement('option');
        opt.value = cam.deviceId;
        opt.textContent = cam.label || `Camera ${cam.deviceId.substring(0, 8)}`;
        cameraSelect.appendChild(opt);
      });

      // Restore selection if still available
      if (currentVal && [...cameraSelect.options].some(o => o.value === currentVal)) {
        cameraSelect.value = currentVal;
      }

      cameraInfo.textContent = `${cameras.length} camera(s) available`;
      console.log(`[Video] Enumerated ${cameras.length} camera(s)`);
    } catch (err) {
      console.warn('[Video] Failed to enumerate cameras:', err);
    }
  }

  async function startCamera() {
    const profile = getCurrentProfile();
    const videoConstraints = {
      width: { ideal: profile.width },
      height: { ideal: profile.height },
      frameRate: { ideal: profile.frameRate },
    };

    // Use selected camera if set
    if (selectedCameraId) {
      videoConstraints.deviceId = { exact: selectedCameraId };
    }

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false, // Audio handled by main window
      });

      localVideo.srcObject = localStream;
      localNoCamera.classList.add('hidden');
      cameraOn = true;
      updateCameraButton();

      // After getting permission, labels become readable — refresh the list
      await enumerateCameras();

      console.log(`[Video] Camera started: ${profile.width}x${profile.height}@${profile.frameRate}fps`);
      return true;
    } catch (err) {
      console.warn('[Video] Camera not available:', err.message || err);
      localNoCamera.querySelector('span').textContent = 'No camera — receiving only';
      localStream = null;
      cameraOn = false;
      updateCameraButton();
      return false;
    }
  }

  function stopCamera() {
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    localVideo.srcObject = null;
    localNoCamera.classList.remove('hidden');
    localNoCamera.querySelector('span').textContent = 'Camera off';
    cameraOn = false;
    updateCameraButton();
  }

  function updateCameraButton() {
    cameraIconOn.style.display = cameraOn ? '' : 'none';
    cameraIconOff.style.display = cameraOn ? 'none' : '';
    cameraToggle.classList.toggle('active', cameraOn);
  }

  async function switchCamera(deviceId) {
    selectedCameraId = deviceId;
    if (!cameraOn || !localStream) return; // Camera off — just save the selection

    // Restart camera with new device
    const profile = getCurrentProfile();
    const videoConstraints = {
      width: { ideal: profile.width },
      height: { ideal: profile.height },
      frameRate: { ideal: profile.frameRate },
    };
    if (deviceId) {
      videoConstraints.deviceId = { exact: deviceId };
    }

    try {
      // Stop old stream
      localStream.getTracks().forEach(t => t.stop());

      // Start new stream with selected camera
      localStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });

      localVideo.srcObject = localStream;
      const newTrack = localStream.getVideoTracks()[0];
      console.log(`[Video] Switched camera to: ${newTrack.label}`);

      // Replace track in all active peer connections (no renegotiation needed)
      videoPeers.forEach((entry, peerId) => {
        const senders = entry.pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(newTrack)
            .then(() => console.log(`[Video] Replaced track for ${peerId}`))
            .catch(err => console.warn(`[Video] replaceTrack failed for ${peerId}:`, err));
        }
      });
    } catch (err) {
      console.warn('[Video] Failed to switch camera:', err.message || err);
      cameraInfo.textContent = 'Failed to switch — check camera';
    }
  }

  function getCurrentProfile() {
    if (qualityMode === 'auto') {
      return getAutoProfile(videoPeers.size);
    }
    return QUALITY_PROFILES[qualityMode] || QUALITY_PROFILES.high;
  }

  // ==================== PEER CONNECTIONS ====================

  function createPeerConnection(peerId, isInitiator) {
    if (videoPeers.has(peerId)) {
      console.log(`[Video] Connection to ${peerId} already exists`);
      return;
    }

    const pc = new RTCPeerConnection({ iceServers: iceConfig });

    // Add local video track
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Remote video arrives
    pc.ontrack = (event) => {
      console.log(`[Video] Received video track from ${peerId}`);
      const entry = videoPeers.get(peerId);
      if (entry && entry.videoEl) {
        const stream = event.streams[0] || new MediaStream([event.track]);
        entry.videoEl.srcObject = stream;
        if (entry.noCamera) entry.noCamera.classList.add('hidden');

        // When peer turns off camera, track ends — show placeholder
        event.track.onended = () => {
          console.log(`[Video] Track from ${peerId} ended`);
          if (entry.noCamera) {
            entry.noCamera.querySelector('span').textContent = 'Camera off';
            entry.noCamera.classList.remove('hidden');
          }
        };
        event.track.onmute = () => {
          console.log(`[Video] Track from ${peerId} muted`);
          if (entry.noCamera) {
            entry.noCamera.querySelector('span').textContent = 'Camera off';
            entry.noCamera.classList.remove('hidden');
          }
        };
        event.track.onunmute = () => {
          console.log(`[Video] Track from ${peerId} unmuted`);
          if (entry.noCamera) entry.noCamera.classList.add('hidden');
        };
      }
    };

    // ICE candidates → relay to peer
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Convert RTCIceCandidate to plain object for IPC serialization
        window.videoIPC.sendSignalToPeer(peerId, {
          type: 'ice',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[Video] ICE state (${peerId}): ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        console.warn(`[Video] Connection to ${peerId} ${pc.iceConnectionState}`);
      }
    };

    // Create DOM elements
    const cell = document.createElement('div');
    cell.className = 'video-cell';
    cell.dataset.peerId = peerId;

    const videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    // Muted: audio is handled by the main IceVox window
    videoEl.muted = true;

    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = peerId.replace('icevox-', '');

    const noCamera = document.createElement('div');
    noCamera.className = 'video-no-camera';
    noCamera.innerHTML = '<i class="ph-bold ph-video-camera-slash"></i><span>Connecting...</span>';

    cell.appendChild(videoEl);
    cell.appendChild(label);
    cell.appendChild(noCamera);

    // Click to focus
    cell.addEventListener('click', () => {
      if (focusMode) {
        setFocusedPeer(peerId);
      }
    });

    videoGrid.appendChild(cell);

    videoPeers.set(peerId, { pc, videoEl, cell, label, noCamera });
    updateGridLayout();

    // Apply bitrate constraints
    applyBitrateConstraints(pc);

    // If we are the initiator, create and send offer
    if (isInitiator) {
      createAndSendOffer(peerId, pc);
    }

    console.log(`[Video] Created connection to ${peerId} (initiator: ${isInitiator}). Total: ${videoPeers.size}`);
  }

  async function createAndSendOffer(peerId, pc) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Convert RTCSessionDescription to plain object — it can't survive IPC structured clone
      window.videoIPC.sendSignalToPeer(peerId, {
        type: 'offer',
        sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      });
      console.log(`[Video] Sent offer to ${peerId}`);
    } catch (err) {
      console.error(`[Video] Failed to create offer for ${peerId}:`, err);
    }
  }

  // Buffer for ICE candidates that arrive before connection/SDP is ready
  const pendingIceCandidates = new Map();

  async function handleSignal(peerId, signal) {
    let entry = videoPeers.get(peerId);
    console.log(`[Video] handleSignal from ${peerId}: type=${signal.type}, connection exists: ${!!entry}`);

    if (signal.type === 'offer') {
      // Incoming offer — create connection if needed, then answer
      if (!entry) {
        console.log(`[Video] Creating connection for incoming offer (iceConfig: ${iceConfig.length} servers)`);
        createPeerConnection(peerId, false);
        entry = videoPeers.get(peerId);
      }
      if (!entry) return;

      try {
        // Handle glare: if we also sent an offer, we need to rollback first
        if (entry.pc.signalingState === 'have-local-offer') {
          // Glare: both sides sent offers simultaneously.
          // The peer with the lower ID wins (keeps their offer), the other rolls back.
          if (shouldInitiateTo(peerId)) {
            // We have lower ID — ignore their offer, they should accept ours
            console.log(`[Video] Glare with ${peerId}: we have priority, ignoring their offer`);
            return;
          }
          // They have lower ID — rollback our offer and accept theirs
          console.log(`[Video] Glare with ${peerId}: rolling back our offer`);
          await entry.pc.setLocalDescription({ type: 'rollback' });
        }

        await entry.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

        // Apply any ICE candidates that arrived before this offer
        await applyBufferedCandidates(peerId, entry.pc);

        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        // Convert RTCSessionDescription to plain object for IPC
        window.videoIPC.sendSignalToPeer(peerId, {
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
        // Guard: only accept answer if we're expecting one (we sent an offer)
        if (entry.pc.signalingState !== 'have-local-offer') {
          console.warn(`[Video] Ignoring stale answer from ${peerId} (state: ${entry.pc.signalingState})`);
          return;
        }
        await entry.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        console.log(`[Video] Received answer from ${peerId}`);

        // Apply any ICE candidates that arrived before this answer
        await applyBufferedCandidates(peerId, entry.pc);
      } catch (err) {
        console.error(`[Video] Failed to handle answer from ${peerId}:`, err);
      }

    } else if (signal.type === 'ice') {
      if (!entry || !entry.pc.remoteDescription) {
        // Buffer ICE candidate — connection or remote description not ready yet
        if (!pendingIceCandidates.has(peerId)) {
          pendingIceCandidates.set(peerId, []);
        }
        pendingIceCandidates.get(peerId).push(signal.candidate);
        console.log(`[Video] Buffered ICE candidate for ${peerId} (${pendingIceCandidates.get(peerId).length} total)`);
        return;
      }
      try {
        await entry.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (err) {
        // ICE candidate errors are common and often harmless
        console.warn(`[Video] ICE candidate error (${peerId}):`, err.message);
      }
    }
  }

  async function applyBufferedCandidates(peerId, pc) {
    const candidates = pendingIceCandidates.get(peerId);
    if (!candidates || candidates.length === 0) return;

    console.log(`[Video] Applying ${candidates.length} buffered ICE candidate(s) for ${peerId}`);
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn(`[Video] Buffered ICE candidate error (${peerId}):`, err.message);
      }
    }
    pendingIceCandidates.delete(peerId);
  }

  function removePeerConnection(peerId) {
    const entry = videoPeers.get(peerId);
    if (!entry) return;

    entry.pc.close();
    if (entry.cell && entry.cell.parentNode) {
      entry.cell.parentNode.removeChild(entry.cell);
    }
    videoPeers.delete(peerId);
    updateGridLayout();
    console.log(`[Video] Removed connection to ${peerId}. Remaining: ${videoPeers.size}`);
  }

  function removeAllConnections() {
    videoPeers.forEach((entry, peerId) => {
      entry.pc.close();
      if (entry.cell && entry.cell.parentNode) {
        entry.cell.parentNode.removeChild(entry.cell);
      }
    });
    videoPeers.clear();
    updateGridLayout();
  }

  // ==================== BITRATE ====================

  function applyBitrateConstraints(pc) {
    const profile = getCurrentProfile();
    const senders = pc.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (!videoSender) return;

    try {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = profile.bitrate;
      videoSender.setParameters(params)
        .then(() => console.log(`[Video] Bitrate set to ${profile.bitrate / 1000}kbps`))
        .catch(err => console.warn('[Video] Could not set bitrate:', err));
    } catch (err) {
      console.warn('[Video] Bitrate parameters not available:', err);
    }
  }

  function updateAllBitrates() {
    const profile = getCurrentProfile();
    videoPeers.forEach((entry) => {
      applyBitrateConstraints(entry.pc);
    });
    qualityInfo.textContent = `${profile.width}x${profile.height} @ ${profile.frameRate}fps — ${profile.bitrate / 1000}kbps`;
  }

  // ==================== LAYOUT ====================

  function updateGridLayout() {
    const totalCells = videoPeers.size + 1; // +1 for local preview
    videoGrid.classList.remove('single-video', 'two-videos', 'focus-mode');

    if (focusMode) {
      videoGrid.classList.add('focus-mode');
    } else if (totalCells === 1) {
      videoGrid.classList.add('single-video');
    } else if (totalCells === 2) {
      videoGrid.classList.add('two-videos');
    }
  }

  function toggleFocusMode() {
    focusMode = !focusMode;
    if (focusMode && !focusedPeerId) {
      // Focus on first remote peer by default
      const firstPeer = videoPeers.keys().next().value;
      if (firstPeer) {
        setFocusedPeer(firstPeer);
      } else {
        focusMode = false;
      }
    }

    if (!focusMode) {
      // Remove all focus classes
      document.querySelectorAll('.video-cell').forEach(c => c.classList.remove('focused'));
      focusedPeerId = null;
    }

    updateGridLayout();
    layoutToggle.innerHTML = focusMode
      ? '<i class="ph-bold ph-rows"></i>'
      : '<i class="ph-bold ph-grid-four"></i>';
  }

  function setFocusedPeer(peerId) {
    focusedPeerId = peerId;
    document.querySelectorAll('.video-cell').forEach(c => {
      c.classList.toggle('focused', c.dataset.peerId === peerId);
    });
  }

  // ==================== INITIATOR LOGIC ====================

  // Determine who initiates the video connection (same rule as audio mesh):
  // The peer with the lexicographically lower ID initiates.
  function shouldInitiateTo(peerId) {
    return ownPeerId && ownPeerId < peerId;
  }

  // ==================== IPC HANDLERS ====================

  window.videoIPC.onIceConfig((config) => {
    iceConfig = config;
    console.log(`[Video] Received ICE config: ${config.length} servers`);
  });

  window.videoIPC.onOwnPeerId((peerId) => {
    ownPeerId = peerId;
    console.log(`[Video] Own peer ID: ${peerId}`);
  });

  window.videoIPC.onPeerList(async (peers) => {
    console.log(`[Video] Received peer list: ${peers.length} peers`);

    // Camera defaults to OFF — user must click to enable.
    // Connections are created without tracks (receive-only until camera is toggled on).

    // Create connections to all peers
    peers.forEach(peerId => {
      if (!videoPeers.has(peerId)) {
        const isInitiator = shouldInitiateTo(peerId);
        createPeerConnection(peerId, isInitiator);
      }
    });

    updateAllBitrates();
  });

  window.videoIPC.onPeerJoined((peerId, peerInfo) => {
    console.log(`[Video] Peer joined: ${peerId}`);
    if (!videoPeers.has(peerId)) {
      const isInitiator = shouldInitiateTo(peerId);
      createPeerConnection(peerId, isInitiator);
      updateAllBitrates();
    }
  });

  window.videoIPC.onPeerLeft((peerId) => {
    console.log(`[Video] Peer left: ${peerId}`);
    removePeerConnection(peerId);
    updateAllBitrates();
  });

  window.videoIPC.onSignalFromPeer((peerId, signal) => {
    handleSignal(peerId, signal);
  });

  // ==================== UI EVENT HANDLERS ====================

  cameraToggle.addEventListener('click', async () => {
    if (cameraOn) {
      stopCamera();
      // Remove video tracks from all connections and renegotiate
      videoPeers.forEach((entry, peerId) => {
        const senders = entry.pc.getSenders();
        senders.forEach(s => {
          if (s.track && s.track.kind === 'video') {
            entry.pc.removeTrack(s);
          }
        });
        // Always renegotiate — WE changed our tracks, so WE send the new offer
        createAndSendOffer(peerId, entry.pc);
      });
    } else {
      const started = await startCamera();
      if (started && localStream) {
        const track = localStream.getVideoTracks()[0];
        // Add video track to all connections and renegotiate
        videoPeers.forEach((entry, peerId) => {
          entry.pc.addTrack(track, localStream);
          // Always renegotiate — WE changed our tracks, so WE send the new offer
          createAndSendOffer(peerId, entry.pc);
        });
      }
    }
  });

  layoutToggle.addEventListener('click', () => {
    toggleFocusMode();
  });

  settingsToggle.addEventListener('click', () => {
    settingsOpen = !settingsOpen;
    settingsPanel.style.display = settingsOpen ? 'block' : 'none';
  });

  settingsClose.addEventListener('click', () => {
    settingsOpen = false;
    settingsPanel.style.display = 'none';
  });

  qualitySelect.addEventListener('change', () => {
    qualityMode = qualitySelect.value;
    updateAllBitrates();
    console.log(`[Video] Quality mode: ${qualityMode}`);
  });

  cameraSelect.addEventListener('change', () => {
    switchCamera(cameraSelect.value);
  });

  // Re-populate camera list when devices are plugged/unplugged
  navigator.mediaDevices.addEventListener('devicechange', () => {
    enumerateCameras();
  });

  closeBtn.addEventListener('click', () => {
    stopCamera();
    removeAllConnections();
    window.videoIPC.close();
  });

  // Cleanup on window unload
  window.addEventListener('beforeunload', () => {
    stopCamera();
    removeAllConnections();
  });

  // Local preview click → focus on self
  localCell.addEventListener('click', () => {
    if (focusMode) {
      setFocusedPeer('local');
      localCell.classList.add('focused');
    }
  });
  localCell.dataset.peerId = 'local';

  // ==================== INIT ====================

  // Populate camera list on startup (labels may be empty until permission is granted)
  enumerateCameras();

  console.log('[Video] Video renderer initialized');
  window.videoIPC.notifyReady();

})();
