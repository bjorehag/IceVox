// Renderer process logic
import audioManager from './audio.js';
import { PRESETS, DEFAULT_PARAMS } from './presets.js';
import connectionManager from './connection.js';

// Initialize in Basic mode by default
document.body.classList.add('basic-mode');

// Track active preset
let activePreset = null;

// Mode toggle functionality
const modeToggleBtn = document.getElementById('mode-toggle-btn');
const basicModeSpan = document.querySelector('.mode-basic');
const advancedModeSpan = document.querySelector('.mode-advanced');

let isBasicMode = true;

modeToggleBtn.addEventListener('click', () => {
  isBasicMode = !isBasicMode;

  if (isBasicMode) {
    document.body.classList.add('basic-mode');
    basicModeSpan.classList.add('active');
    advancedModeSpan.classList.remove('active');
  } else {
    document.body.classList.remove('basic-mode');
    basicModeSpan.classList.remove('active');
    advancedModeSpan.classList.add('active');
  }
});

// Effect sliders configuration
const effectSliders = {
  'pitch-slider': { param: 'pitchShift', valueId: 'pitch-value', format: (v) => `×${parseFloat(v).toFixed(2)}` },
  'basic-pitch-slider': { param: 'pitchShift', valueId: 'basic-pitch-value', format: (v) => `×${parseFloat(v).toFixed(2)}` },
  'echo-delay-slider': { param: 'echoDelay', valueId: 'echo-delay-value', format: (v) => `${Math.round(v * 1000)}ms` },
  'echo-feedback-slider': { param: 'echoFeedback', valueId: 'echo-feedback-value', format: (v) => `${Math.round(v * 100)}%` },
  'tremolo-freq-slider': { param: 'tremoloFrequency', valueId: 'tremolo-freq-value', format: (v) => `${parseFloat(v).toFixed(1)}Hz` },
  'tremolo-int-slider': { param: 'tremoloIntensity', valueId: 'tremolo-int-value', format: (v) => `${Math.round(v * 100)}%` },
  'vibrato-freq-slider': { param: 'vibratoFrequency', valueId: 'vibrato-freq-value', format: (v) => `${parseFloat(v).toFixed(1)}Hz` },
  'vibrato-int-slider': { param: 'vibratoIntensity', valueId: 'vibrato-int-value', format: (v) => `${Math.round(v * 100)}%` },
  'distortion-slider': { param: 'distortionAmount', valueId: 'distortion-value', format: (v) => `${Math.round(v * 100)}%` },
  'chorus-depth-slider': { param: 'chorusDepth', valueId: 'chorus-depth-value', format: (v) => `${Math.round(v * 100)}%` },
  'chorus-mix-slider': { param: 'chorusMix', valueId: 'chorus-mix-value', format: (v) => `${Math.round(v * 100)}%` },
  'reverb-decay-slider': { param: 'reverbDecay', valueId: 'reverb-decay-value', format: (v) => `${Math.round(v * 100)}%` },
  'reverb-mix-slider': { param: 'reverbMix', valueId: 'reverb-mix-value', format: (v) => `${Math.round(v * 100)}%` },
};

// Setup slider listeners
Object.keys(effectSliders).forEach(sliderId => {
  const config = effectSliders[sliderId];
  const sliderElement = document.getElementById(sliderId);
  const valueElement = document.getElementById(config.valueId);

  if (!sliderElement) return;

  sliderElement.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);

    // Update display
    valueElement.textContent = config.format(value);

    // Sync dual pitch sliders manually to avoid updateSlidersFromParams loop
    if (sliderId === 'pitch-slider') {
      const basicSlider = document.getElementById('basic-pitch-slider');
      const basicValue = document.getElementById('basic-pitch-value');
      if (basicSlider && basicValue) {
        basicSlider.value = value;
        basicValue.textContent = config.format(value);
      }
    } else if (sliderId === 'basic-pitch-slider') {
      const advSlider = document.getElementById('pitch-slider');
      const advValue = document.getElementById('pitch-value');
      if (advSlider && advValue) {
        advSlider.value = value;
        advValue.textContent = config.format(value);
      }
    }

    // Send to audio worklet (local monitoring)
    const params = {};
    params[config.param] = value;
    audioManager.setEffectParams(params);

    // Send to remote peer via DataChannel (client-side effects)
    connectionManager.sendEffectParams(audioManager.getCurrentEffectParams());

    // Deactivate preset if manually adjusted
    if (activePreset !== null) {
      activePreset = null;
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    }
  });
});

// Helper function to update all sliders from params
function updateSlidersFromParams(params) {
  Object.keys(effectSliders).forEach(sliderId => {
    const config = effectSliders[sliderId];
    const sliderElement = document.getElementById(sliderId);
    const valueElement = document.getElementById(config.valueId);

    if (sliderElement && params[config.param] !== undefined) {
      sliderElement.value = params[config.param];
      valueElement.textContent = config.format(params[config.param]);
    }
  });
}

// Preset button click handling
const presetButtons = document.querySelectorAll('.preset-btn:not(.saved-slot)');

presetButtons.forEach((btn, index) => {
  btn.addEventListener('click', () => {
    // If clicking active preset, turn it off
    if (activePreset === index) {
      activePreset = null;
      btn.classList.remove('active');
      // Reset to defaults
      audioManager.setEffectParams(DEFAULT_PARAMS);
      updateSlidersFromParams(DEFAULT_PARAMS);
      // Send to remote peer
      connectionManager.sendEffectParams(DEFAULT_PARAMS);
    } else {
      // Activate new preset
      activePreset = index;
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Apply preset params
      const preset = PRESETS[index];
      audioManager.setEffectParams(preset.params);
      updateSlidersFromParams(preset.params);
      // Send to remote peer
      connectionManager.sendEffectParams(preset.params);
    }
  });
});

// Reset button
const resetBtn = document.getElementById('reset-effects-btn');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    activePreset = null;
    presetButtons.forEach(b => b.classList.remove('active'));
    audioManager.setEffectParams(DEFAULT_PARAMS);
    updateSlidersFromParams(DEFAULT_PARAMS);
    // Send to remote peer
    connectionManager.sendEffectParams(DEFAULT_PARAMS);
  });
}

// Device selector popup
const deviceSelectorPopup = document.getElementById('device-selector-popup');
const deviceStatusItem = document.getElementById('device-status-item');
const deviceStatus = document.getElementById('device-status');
const inputSelect = document.getElementById('input-select');
const outputSelect = document.getElementById('output-select');
const popupMonitorVolume = document.getElementById('popup-monitor-volume');
const popupVolumeValue = document.getElementById('popup-volume-value');
const closePopupBtn = document.getElementById('close-popup-btn');

let isPopupOpen = false;

// Toggle device selector popup
deviceStatusItem.addEventListener('click', async () => {
  isPopupOpen = !isPopupOpen;
  deviceSelectorPopup.style.display = isPopupOpen ? 'block' : 'none';

  if (isPopupOpen) {
    // Populate device lists
    await populateDeviceLists();
  }
});

// Close popup when clicking outside
document.addEventListener('click', (e) => {
  if (isPopupOpen &&
      !deviceSelectorPopup.contains(e.target) &&
      !deviceStatusItem.contains(e.target)) {
    isPopupOpen = false;
    deviceSelectorPopup.style.display = 'none';
  }
});

closePopupBtn.addEventListener('click', () => {
  isPopupOpen = false;
  deviceSelectorPopup.style.display = 'none';
});

async function populateDeviceLists() {
  const devices = await audioManager.getDevices();

  // Populate input select
  inputSelect.innerHTML = '<option value="">Select microphone...</option>';
  devices.inputs.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label;
    inputSelect.appendChild(option);
  });

  // Populate output select
  outputSelect.innerHTML = '<option value="">Select output...</option>';
  devices.outputs.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label;
    outputSelect.appendChild(option);
  });

  // Select first devices by default if not initialized
  if (!audioManager.isInitialized && devices.inputs.length > 0) {
    inputSelect.selectedIndex = 1;
  }
  if (devices.outputs.length > 0) {
    outputSelect.selectedIndex = 1;
  }
}

// Auto-initialize audio on startup (no manual button needed)
async function autoInitAudio() {
  const result = await audioManager.init();
  if (result.success) {
    if (deviceStatus) deviceStatus.textContent = result.deviceLabel.split('(')[0].trim();
    // Re-populate device lists now that permission is granted (labels will be readable)
    await populateDeviceLists();
    updateAudioWarning();
    // Apply default mic boost from HTML input (no 'input' event fires on page load)
    const defaultMicGain = parseInt(document.getElementById('mic-gain-input').value);
    audioManager.setInputGain(defaultMicGain / 100);
    console.log('[Audio] Auto-initialized:', result.deviceLabel);
  } else {
    console.warn('[Audio] Auto-init failed:', result.error);
  }
}

// Volume slider control in popup
popupMonitorVolume.addEventListener('input', (e) => {
  const value = parseInt(e.target.value);
  popupVolumeValue.textContent = value + '%';
  if (audioManager.isInitialized) {
    audioManager.setMasterGain(value / 100);
  }
});

// Mic gain knob
const micGainInput = document.getElementById('mic-gain-input');
if (micGainInput) {
  micGainInput.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    if (audioManager.isInitialized) {
      audioManager.setInputGain(value / 100);
    }
  });
}

// Device switching
inputSelect.addEventListener('change', async (e) => {
  const deviceId = e.target.value;

  if (!deviceId || !audioManager.isInitialized) {
    return;
  }

  deviceStatus.textContent = 'Switching...';
  deviceStatus.style.color = '#888';

  const result = await audioManager.switchInput(deviceId);

  if (result.success) {
    const shortName = result.deviceLabel.split('(')[0].trim();
    deviceStatus.textContent = `${shortName}`;
    deviceStatus.style.color = '#00d4ff';
  } else {
    deviceStatus.textContent = `Error: ${result.error}`;
    deviceStatus.style.color = '#ff4444';
  }
});

outputSelect.addEventListener('change', async (e) => {
  const deviceId = e.target.value;

  if (!deviceId || !audioManager.isInitialized) {
    return;
  }

  const result = await audioManager.switchOutput(deviceId);

  if (!result.success) {
    console.warn('Output switching failed:', result.error);
  }
});

// ===== CONNECTION UI =====

// Get connection UI elements
const connectionViewDisconnected = document.getElementById('connection-view-disconnected');
const connectionViewWaiting = document.getElementById('connection-view-waiting');
const connectionViewConnected = document.getElementById('connection-view-connected');
const connectionError = document.getElementById('connection-error');
const audioWarning = document.getElementById('audio-warning');

const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-room-btn');
const roomIdInput = document.getElementById('room-id-input');
const roomPasswordInput = document.getElementById('room-password-input');
const roomIdDisplay = document.getElementById('room-id-display');
const roomIdConnected = document.getElementById('room-id-connected');
const userRole = document.getElementById('user-role');
const copyRoomIdBtn = document.getElementById('copy-room-id-btn');
const copyFeedback = document.getElementById('copy-feedback');
const leaveRoomBtnWaiting = document.getElementById('leave-room-btn-waiting');
const leaveRoomBtnConnected = document.getElementById('leave-room-btn-connected');
const lockRoomBtnWaiting = document.getElementById('lock-room-btn-waiting');
const lockRoomBtnConnected = document.getElementById('lock-room-btn-connected');
const videoToggleBtnWaiting = document.getElementById('video-toggle-btn-waiting');
const videoToggleBtnConnected = document.getElementById('video-toggle-btn-connected');
let isVideoWindowOpen = false;
const muteSendBtn = document.getElementById('mute-send-btn');
const muteLabel = document.getElementById('mute-label');
const createRoomLabel = document.getElementById('create-room-label');
const joinRoomLabel = document.getElementById('join-room-label');
const connectionStatusText = document.getElementById('connection-status');
const inviteBtnConnected = document.getElementById('invite-btn-connected');


let isSendMuted = false;

// Set role badge with host/guest symbol icon
function setRoleBadge(isHost) {
  const theme = document.documentElement.getAttribute('data-theme');
  const suffix = theme === 'arctic' ? '2' : '1';
  const iconName = isHost ? 'host_symbol' : 'guest_symbol';
  const label = isHost ? 'Host' : 'Guest';
  userRole.innerHTML = `<img data-icon="${iconName}" src="../../assets/icons/${iconName}_${suffix}.ico" class="role-icon" alt="${label}" title="${label}"><span class="role-text" style="display:none">${label}</span>`;
}

// Show/hide connection views
function showConnectionView(view) {
  connectionViewDisconnected.style.display = 'none';
  connectionViewWaiting.style.display = 'none';
  connectionViewConnected.style.display = 'none';

  if (view === 'disconnected') {
    connectionViewDisconnected.style.display = 'block';
  } else if (view === 'waiting') {
    connectionViewWaiting.style.display = 'block';
  } else if (view === 'connected') {
    connectionViewConnected.style.display = 'block';
  }

  // Show alias input row only when connected
  const participantHeaderRow = document.getElementById('participant-header-row');
  if (participantHeaderRow) {
    participantHeaderRow.style.display = view === 'connected' ? 'flex' : 'none';
  }
}

// Update connection UI based on state
function updateConnectionUI(state) {
  const roomInfo = connectionManager.getRoomInfo();

  switch (state) {
    case 'disconnected':
      showConnectionView('disconnected');
      updateAudioWarning();
      updateChatInputState();
      showChatPlaceholder();
      showUsersPlaceholder();
      // Close video window on disconnect
      if (isVideoWindowOpen && window.ipcAPI && window.ipcAPI.video) {
        window.ipcAPI.video.closeWindow();
        isVideoWindowOpen = false;
      }
      if (videoToggleBtnWaiting) videoToggleBtnWaiting.disabled = true;
      break;

    case 'connecting':
      showConnectionView('waiting');
      roomIdDisplay.textContent = '';
      break;

    case 'waiting':
      showConnectionView('waiting');
      roomIdDisplay.textContent = roomInfo.roomId || '';
      if (videoToggleBtnWaiting) videoToggleBtnWaiting.disabled = false;
      break;

    case 'connected':
      showConnectionView('connected');
      roomIdConnected.textContent = roomInfo.roomId || '';
      setRoleBadge(roomInfo.isHost);
      if (lockRoomBtnConnected) lockRoomBtnConnected.style.display = roomInfo.isHost ? 'inline-flex' : 'none';
      if (inviteBtnConnected) inviteBtnConnected.style.display = roomInfo.peerCount < 5 ? 'inline-flex' : 'none';
      hideConnectionError();
      updateParticipantList();
      updateChatInputState();
      break;

    case 'error':
      // Keep current view but show error
      break;
  }

  updateStatusBar(state, roomInfo);
}

// Update status bar
function updateStatusBar(state, roomInfo) {
  switch (state) {
    case 'disconnected':
      connectionStatusText.textContent = '';
      break;

    case 'connecting':
      connectionStatusText.innerHTML = '<i class="ph-fill ph-broadcast"></i> Connecting...';
      connectionStatusText.style.color = '#ffaa00';
      break;

    case 'waiting':
      connectionStatusText.innerHTML = `<i class="ph-light ph-broadcast"></i> Room: ${roomInfo.roomId || ''}`;
      connectionStatusText.style.color = '#00d4ff80';
      break;

    case 'connected':
      connectionStatusText.innerHTML = `<i class="ph-fill ph-broadcast"></i> ${roomInfo.roomId} (${roomInfo.peerCount + 1} users)`;
      connectionStatusText.style.color = '#00ff88';
      break;

    case 'error':
      connectionStatusText.innerHTML = '<i class="ph-fill ph-warning-circle"></i> Connection failed';
      connectionStatusText.style.color = '#ff4444';
      setTimeout(() => {
        if (connectionManager.getState() === 'error') {
          connectionStatusText.textContent = '';
        }
      }, 5000);
      break;
  }
}

// Show connection error
function showConnectionError(message, isError = true) {
  connectionError.textContent = message;
  connectionError.style.display = 'block';
  connectionError.style.backgroundColor = isError ? '#ff4444' : '#ffaa00';

  if (isError) {
    setTimeout(() => {
      hideConnectionError();
    }, 5000);
  }
}

// Hide connection error
function hideConnectionError() {
  connectionError.style.display = 'none';
}

// Update audio warning
function updateAudioWarning() {
  if (!audioManager.isInitialized) {
    audioWarning.style.display = 'block';
    createRoomBtn.disabled = false; // Allow clicking to auto-init
    joinRoomBtn.disabled = false;
  } else {
    audioWarning.style.display = 'none';
    createRoomBtn.disabled = false;
    updateJoinButtonState();
  }
}

// Update join button state
function updateJoinButtonState() {
  joinRoomBtn.disabled = roomIdInput.value.trim() === '';
}

// Handle create room
async function handleCreateRoom() {
  try {
    // Ensure audio is running
    if (!audioManager.isInitialized) {
      showConnectionError('Starting audio...', false);
      const result = await audioManager.init();
      if (!result.success) {
        throw new Error(result.error || 'Failed to initialize audio');
      }
      hideConnectionError();
      updateAudioWarning();
    }

    const sendStream = audioManager.getSendStream();
    if (!sendStream) {
      throw new Error('No send stream available');
    }

    createRoomBtn.disabled = true;
    if (createRoomLabel) createRoomLabel.textContent = 'Creating...';

    const password = roomPasswordInput ? roomPasswordInput.value.trim() : null;
    await connectionManager.createRoom(sendStream, password || null);

    if (roomPasswordInput) roomPasswordInput.value = '';
    createRoomBtn.disabled = false;
    if (createRoomLabel) createRoomLabel.textContent = 'Create';
  } catch (err) {
    showConnectionError(err.message);
    createRoomBtn.disabled = false;
    if (createRoomLabel) createRoomLabel.textContent = 'Create';
  }
}

// Handle join room
// Parse room input — handles web links, protocol links, and raw room IDs
function parseRoomInput(input) {
  input = input.trim();
  let roomId;
  if (input.startsWith('https://icevox.net/join/')) {
    roomId = input.replace('https://icevox.net/join/', '').split('?')[0].toLowerCase();
  } else if (input.startsWith('icevox://join/')) {
    roomId = input.replace('icevox://join/', '').toLowerCase();
  } else {
    roomId = input.toLowerCase();
  }
  // Security: validate room ID format (alphanumeric + dash only)
  if (!/^icevox-[a-z0-9]{5}$/.test(roomId)) {
    return null;
  }
  return roomId;
}

async function handleJoinRoom() {
  try {
    const roomId = parseRoomInput(roomIdInput.value);
    if (!roomId) {
      showConnectionError('Please enter a room ID or invite link');
      return;
    }

    // Ensure audio is running
    if (!audioManager.isInitialized) {
      showConnectionError('Starting audio...', false);
      const result = await audioManager.init();
      if (!result.success) {
        throw new Error(result.error || 'Failed to initialize audio');
      }
      hideConnectionError();
      updateAudioWarning();
    }

    const sendStream = audioManager.getSendStream();
    if (!sendStream) {
      throw new Error('No send stream available');
    }

    joinRoomBtn.disabled = true;
    if (joinRoomLabel) joinRoomLabel.textContent = 'Joining...';

    const password = roomPasswordInput ? roomPasswordInput.value.trim() : '';
    await connectionManager.joinRoom(roomId, sendStream, password);

    if (roomPasswordInput) roomPasswordInput.value = '';
    joinRoomBtn.disabled = false;
    if (joinRoomLabel) joinRoomLabel.textContent = 'Join';
  } catch (err) {
    showConnectionError(err.message);
    joinRoomBtn.disabled = false;
    if (joinRoomLabel) joinRoomLabel.textContent = 'Join';
  }
}

function handleLeaveRoom() {
  audioManager.stopAllRemoteAudio();
  // Close video window when leaving room
  if (isVideoWindowOpen && window.ipcAPI && window.ipcAPI.video) {
    window.ipcAPI.video.closeWindow();
    isVideoWindowOpen = false;
  }
  connectionManager.leaveRoom();
  roomIdInput.value = '';
  isSendMuted = false;
  if (muteLabel) muteLabel.textContent = 'Mute';
  muteSendBtn.classList.remove('muted');
}

// Handle copy invite link
async function handleCopyRoomId() {
  const link = connectionManager.getInviteLink();
  if (!link) return;

  try {
    await navigator.clipboard.writeText(link);
    copyFeedback.style.display = 'block';
    setTimeout(() => {
      copyFeedback.style.display = 'none';
    }, 2000);
  } catch (err) {
    // Fallback: copy raw room ID
    try {
      await navigator.clipboard.writeText(connectionManager.getRoomId());
    } catch (e) { /* ignore */ }
    copyFeedback.style.display = 'block';
    setTimeout(() => {
      copyFeedback.style.display = 'none';
    }, 2000);
  }
}

// Handle mute send
function handleMuteSend() {
  isSendMuted = !isSendMuted;

  if (isSendMuted) {
    audioManager.muteSend();
    if (muteLabel) muteLabel.textContent = 'Unmute';
    muteSendBtn.classList.add('muted');
  } else {
    audioManager.unmuteSend();
    if (muteLabel) muteLabel.textContent = 'Mute';
    muteSendBtn.classList.remove('muted');
  }
}



// Register connection event listeners
createRoomBtn.addEventListener('click', handleCreateRoom);
joinRoomBtn.addEventListener('click', handleJoinRoom);
leaveRoomBtnWaiting.addEventListener('click', handleLeaveRoom);
leaveRoomBtnConnected.addEventListener('click', handleLeaveRoom);
copyRoomIdBtn.addEventListener('click', handleCopyRoomId);
if (inviteBtnConnected) inviteBtnConnected.addEventListener('click', handleCopyRoomId);
muteSendBtn.addEventListener('click', handleMuteSend);
roomIdInput.addEventListener('input', updateJoinButtonState);

// ===== VIDEO TOGGLE =====

function handleVideoToggle() {
  if (!window.ipcAPI || !window.ipcAPI.video) {
    console.warn('[Video] IPC API not available');
    return;
  }
  if (isVideoWindowOpen) {
    window.ipcAPI.video.closeWindow();
    isVideoWindowOpen = false;
  } else {
    window.ipcAPI.video.openWindow();
    isVideoWindowOpen = true;
  }
}

if (videoToggleBtnWaiting) videoToggleBtnWaiting.addEventListener('click', handleVideoToggle);
if (videoToggleBtnConnected) videoToggleBtnConnected.addEventListener('click', handleVideoToggle);

// Listen for video window closed externally (user closed the window)
if (window.ipcAPI && window.ipcAPI.video) {
  window.ipcAPI.video.onWindowClosed(() => {
    isVideoWindowOpen = false;
    console.log('[Video] Video window closed');
  });

  // RELAY 1: Remote peer → data channel → connection.js → HERE → main process → video window
  // When a remote peer sends a video signal via the data channel, connection.js
  // fires onVideoSignal. We forward it to the video window via main process.
  connectionManager.onVideoSignal = (fromPeerId, signal) => {
    console.log(`[Video RELAY 1] Received signal from peer ${fromPeerId} via data channel, forwarding to video window. Signal type: ${signal.type}`);
    window.ipcAPI.video.forwardSignalToVideoWindow(fromPeerId, signal);
  };

  // RELAY 2: Video window → main process → HERE → connection.js → data channel → remote peer
  // When the video window wants to send a signal to a peer, main process forwards it here.
  window.ipcAPI.video.onSignalForPeer((peerId, signal) => {
    console.log(`[Video RELAY 2] Received signal from video window for peer ${peerId}. Signal type: ${signal.type}`);
    connectionManager.sendVideoSignal(peerId, signal);
  });

  // RELAY 3: Video window ready → main process asks us for peer list + ICE config
  window.ipcAPI.video.onRequestPeerList(() => {
    const peers = connectionManager.getConnectedPeerIds();
    const ownId = connectionManager.getOwnPeerId();
    window.ipcAPI.video.sendPeerList(peers, ICE_SERVERS, ownId);
    console.log(`[Video] Sent peer list to video window: ${peers.length} peers`);
  });
}

// ===== ROOM PASSWORD MODAL =====

const passwordModalOverlay = document.getElementById('password-modal-overlay');
const passwordModalClose = document.getElementById('password-modal-close');
const passwordModalConfirm = document.getElementById('password-modal-confirm');
const newPasswordInput = document.getElementById('new-password-input');

function openPasswordModal() {
  if (newPasswordInput) newPasswordInput.value = '';
  if (passwordModalOverlay) passwordModalOverlay.style.display = 'flex';
  if (newPasswordInput) newPasswordInput.focus();
}

function closePasswordModal() {
  if (passwordModalOverlay) passwordModalOverlay.style.display = 'none';
}

function applyPasswordChange() {
  const newPassword = newPasswordInput ? newPasswordInput.value.trim() : '';
  connectionManager.setRoomPassword(newPassword || null);
  closePasswordModal();
  // Visual feedback: update lock icon to show locked/unlocked state
  _updateLockIcons(!!newPassword);
}

function _updateLockIcons(isLocked) {
  [lockRoomBtnWaiting, lockRoomBtnConnected].forEach(btn => {
    if (btn) btn.classList.toggle('locked', isLocked);
  });
}

if (lockRoomBtnWaiting) lockRoomBtnWaiting.addEventListener('click', openPasswordModal);
if (lockRoomBtnConnected) lockRoomBtnConnected.addEventListener('click', openPasswordModal);
if (passwordModalClose) passwordModalClose.addEventListener('click', closePasswordModal);
if (passwordModalConfirm) passwordModalConfirm.addEventListener('click', applyPasswordChange);
if (newPasswordInput) {
  newPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyPasswordChange();
    if (e.key === 'Escape') closePasswordModal();
  });
}
if (passwordModalOverlay) {
  passwordModalOverlay.addEventListener('click', (e) => {
    if (e.target === passwordModalOverlay) closePasswordModal();
  });
}

// Register connection callbacks
connectionManager.onRemoteStream = (peerId, stream) => {
  if (stream) {
    // SENDER-SIDE EFFECTS: Remote audio already has effects applied.
    // Just set up direct playback via <audio> element.
    audioManager.setupRemoteAudio(peerId, stream);
  } else {
    audioManager.stopRemoteAudio(peerId);
  }
};

// Provide processed track callback for replaceTrack()
connectionManager.onGetProcessedTrack = () => {
  return audioManager.getProcessedTrack();
};

connectionManager.onStateChange = (newState, oldState) => {
  console.log(`[UI] Connection state: ${oldState} → ${newState}`);
  updateConnectionUI(newState);
};

connectionManager.onError = (error) => {
  console.error(`[UI] Connection error:`, error);
  showConnectionError(error.message || 'Connection error occurred');
};



// Handle device switch during active call
// When the user switches microphone, the sendWorkletNode graph auto-reconnects,
// but we need to ensure the WebRTC sender still has the processed track.
inputSelect.addEventListener('change', async () => {
  // Update processed track on all active peer connections
  if (connectionManager.peers.size === 0) return;

  // Wait for the new mic stream and send graph to be ready
  setTimeout(() => {
    const processedTrack = audioManager.getProcessedTrack();
    if (!processedTrack) return;

    connectionManager.peers.forEach((peer, id) => {
      if (!peer.call) return;
      const pc = peer.call.peerConnection;
      if (!pc) return;

      const senders = pc.getSenders();
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

      if (audioSender && audioSender.track !== processedTrack) {
        audioSender.replaceTrack(processedTrack)
          .then(() => console.log(`[WebRTC] Re-verified processed track for ${id} after device switch`))
          .catch(err => console.error(`[WebRTC] Failed to re-verify track for ${id}:`, err));
      } else {
        console.log(`[WebRTC] Processed track still active for ${id} after device switch`);
      }
    });
  }, 200);
});

// ===== TEXT CHAT UI =====

const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');

// Peer colors for chat messages
const PEER_COLORS = ['#e06c75', '#98c379', '#d19a66', '#61afef', '#c678dd', '#56b6c2'];
const _peerColorMap = {};
let _colorIndex = 0;

function _getPeerColor(name) {
  if (!_peerColorMap[name]) {
    _peerColorMap[name] = PEER_COLORS[_colorIndex % PEER_COLORS.length];
    _colorIndex++;
  }
  return _peerColorMap[name];
}

function _isNearBottom(element) {
  const threshold = 50;
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

function addChatMessageToUI(messageData) {
  const container = document.getElementById('chatMessages');

  // Remove placeholder if present
  const placeholder = container.querySelector('.empty-state') || container.querySelector('.chat-placeholder');
  if (placeholder) placeholder.remove();

  const msgEl = document.createElement('div');
  msgEl.classList.add('chat-message');

  if (messageData.isSystem) {
    msgEl.classList.add('chat-system');
    msgEl.textContent = messageData.text;

  } else if (messageData.isFile) {
    // File attachment card
    msgEl.classList.add('chat-file-card');

    const senderName = messageData.isLocal ? 'You' : messageData.senderName;
    const senderColor = messageData.isLocal ? 'var(--primary)' : _getPeerColor(messageData.senderName);

    const headerEl = document.createElement('div');
    headerEl.classList.add('file-card-header');

    const nameEl = document.createElement('span');
    nameEl.classList.add('chat-sender');
    nameEl.textContent = senderName;
    nameEl.style.color = senderColor;

    const timeEl = document.createElement('span');
    timeEl.classList.add('chat-time');
    timeEl.textContent = new Date(messageData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    headerEl.appendChild(nameEl);
    headerEl.appendChild(timeEl);

    const bodyEl = document.createElement('div');
    bodyEl.classList.add('file-card-body');

    const iconEl = document.createElement('span');
    iconEl.classList.add('file-card-icon');
    iconEl.textContent = _getFileIcon(messageData.fileType, messageData.fileName);

    const metaEl = document.createElement('div');
    metaEl.classList.add('file-card-meta');

    const fileNameEl = document.createElement('span');
    fileNameEl.classList.add('file-card-name');
    fileNameEl.textContent = messageData.fileName;

    const fileSizeEl = document.createElement('span');
    fileSizeEl.classList.add('file-card-size');
    fileSizeEl.textContent = _formatFileSize(messageData.fileSize);

    metaEl.appendChild(fileNameEl);
    metaEl.appendChild(fileSizeEl);

    const btn = document.createElement('button');
    btn.classList.add('file-view-btn');
    btn.dataset.fileId = messageData.fileId;
    btn.dataset.senderId = messageData.senderId || '';
    btn.dataset.fileName = messageData.fileName;
    btn.dataset.fileType = messageData.fileType || '';
    btn.dataset.isLocalSender = messageData.isLocal ? '1' : '0';

    if (messageData.isLocal) {
      btn.textContent = 'View';
    } else {
      btn.textContent = 'View / Save';
    }
    btn.addEventListener('click', () => _handleFileCardClick(btn));

    bodyEl.appendChild(iconEl);
    bodyEl.appendChild(metaEl);
    bodyEl.appendChild(btn);

    msgEl.appendChild(headerEl);
    msgEl.appendChild(bodyEl);

  } else {
    // Normal text message
    const nameEl = document.createElement('span');
    nameEl.classList.add('chat-sender');
    nameEl.textContent = messageData.isLocal ? 'You' : messageData.senderName;
    nameEl.style.color = messageData.isLocal ? 'var(--primary)' : _getPeerColor(messageData.senderName);

    const textEl = document.createElement('span');
    textEl.classList.add('chat-text');
    textEl.textContent = ': ' + messageData.text;

    const timeEl = document.createElement('span');
    timeEl.classList.add('chat-time');
    const time = new Date(messageData.timestamp);
    timeEl.textContent = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgEl.appendChild(nameEl);
    msgEl.appendChild(textEl);
    msgEl.appendChild(timeEl);
  }

  container.appendChild(msgEl);

  if (_isNearBottom(container)) {
    container.scrollTop = container.scrollHeight;
  }
}

function showChatPlaceholder() {
  const container = document.getElementById('chatMessages');
  const s = document.documentElement.getAttribute('data-theme') === 'arctic' ? '2' : '1';
  container.innerHTML = `<div class="empty-state"><img src="../../assets/generated_icons/icevox_join_chat_placeholder_${s}.png" class="placeholder-img" data-icon-png="icevox_join_chat_placeholder" alt=""><br>Join a room to start chatting</div>`;
}

function showUsersPlaceholder() {
  const container = document.getElementById('participantList');
  if (container) {
    const s = document.documentElement.getAttribute('data-theme') === 'arctic' ? '2' : '1';
    container.innerHTML = `<div class="empty-state small-empty"><img src="../../assets/generated_icons/icevox_no_connections_placeholder_${s}.png" class="placeholder-img" data-icon-png="icevox_no_connections_placeholder" alt=""><br>No connections</div>`;
  }
}

function updateChatInputState() {
  const isConnected = connectionManager.state === 'connected';
  chatInput.disabled = !isConnected;
  chatSendBtn.disabled = !isConnected;
  chatInput.placeholder = isConnected ? 'Type message...' : 'Connect to a room to chat';
}

function sendChatFromUI() {
  const text = chatInput.value.trim();
  if (text.length === 0) return;
  if (connectionManager.state !== 'connected') return;

  connectionManager.sendChatMessage(text);
  chatInput.value = '';
  chatInput.focus();
}

chatSendBtn.addEventListener('click', sendChatFromUI);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatFromUI();
  }
});

// Wire chat callback
connectionManager.onChatMessage = (peerId, messageData) => {
  addChatMessageToUI(messageData);
};

// ===== FILE SHARING =====

// Blobs received from peers, keyed by fileId — kept so user can re-open without re-downloading
const _receivedBlobs = new Map();

// Viewer modal state (current blob + filename for Save button)
let _viewerCurrentBlob = null;
let _viewerCurrentName = '';

function _formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function _getFileIcon(fileType, fileName) {
  const name = (fileName || '').toLowerCase();
  if (fileType && fileType.startsWith('image/')) return '🖼️';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return '📝';
  if (fileType === 'application/pdf' || name.endsWith('.pdf')) return '📕';
  if (fileType === 'application/json' || name.endsWith('.json')) return '📋';
  if (fileType && fileType.startsWith('text/')) return '📄';
  if (name.endsWith('.txt')) return '📄';
  return '📁';
}

// Minimal markdown-to-HTML renderer (HTML-escapes first to prevent XSS)
function _parseMarkdown(rawText) {
  let h = rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks before inline patterns
  h = h.replace(/```[\s\S]*?```/g, m => `<pre><code>${m.slice(3, -3).trim()}</code></pre>`);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  h = h.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  h = h.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  h = h.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rule
  h = h.replace(/^---+$/gm, '<hr>');

  // Bold + italic
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Lists — convert lines then wrap consecutive <li> in <ul>
  h = h.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

  // Paragraph wrap for non-block lines
  const blocks = h.split(/\n{2,}/);
  return blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (/^<(h[1-6]|ul|ol|pre|hr)/.test(trimmed)) return trimmed;
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean).join('\n');
}

function _openFileViewer(fileName, fileType, blob) {
  const name = (fileName || '').toLowerCase();
  const isImage = fileType && fileType.startsWith('image/');
  const isMarkdown = name.endsWith('.md') || name.endsWith('.markdown') || fileType === 'text/markdown';
  const isText = (fileType && fileType.startsWith('text/')) || name.endsWith('.txt') || name.endsWith('.json') || name.endsWith('.csv') || name.endsWith('.yaml') || name.endsWith('.toml');

  if (isImage) {
    const url = URL.createObjectURL(blob);
    _showFileViewerModal(fileName, `<img src="${url}" style="max-width:100%;border-radius:4px;" alt="${fileName}">`, blob, fileName);
  } else if (isMarkdown) {
    const reader = new FileReader();
    reader.onload = (e) => {
      _showFileViewerModal(fileName, _parseMarkdown(e.target.result), blob, fileName);
    };
    reader.readAsText(blob);
  } else if (isText) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const escaped = e.target.result.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      _showFileViewerModal(fileName, `<pre style="white-space:pre-wrap;word-break:break-all;">${escaped}</pre>`, blob, fileName);
    };
    reader.readAsText(blob);
  } else {
    // Non-viewable file — trigger download directly
    _saveBlob(blob, fileName);
  }
}

function _showFileViewerModal(title, contentHtml, blob, fileName) {
  _viewerCurrentBlob = blob;
  _viewerCurrentName = fileName;

  const overlay = document.getElementById('file-viewer-overlay');
  const titleEl = document.getElementById('file-viewer-title');
  const contentEl = document.getElementById('file-viewer-content');
  if (!overlay || !titleEl || !contentEl) return;

  titleEl.textContent = title;
  contentEl.innerHTML = contentHtml;
  overlay.style.display = 'flex';
}

function _saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function _handleFileCardClick(btn) {
  const { fileId, senderId, fileName, fileType, isLocalSender } = btn.dataset;

  if (isLocalSender === '1') {
    // Sender: read file from stored buffer
    const stored = connectionManager._storedFiles.get(fileId);
    if (!stored) { btn.textContent = 'No longer available'; return; }
    const blob = new Blob([stored.buffer], { type: stored.fileType });
    _openFileViewer(fileName, fileType, blob);
    return;
  }

  // Receiver: if we already downloaded it, open directly
  const cached = _receivedBlobs.get(fileId);
  if (cached) {
    _openFileViewer(fileName, fileType, cached);
    return;
  }

  // Request the file from the sender
  const ok = connectionManager.requestFile(fileId, senderId);
  if (!ok) {
    btn.textContent = 'Sender offline';
    return;
  }
  btn.textContent = 'Downloading...';
  btn.disabled = true;
}

// Called when all chunks for a file have been reassembled
connectionManager.onFileReceived = (fileId, _fileName, _fileType, blob) => {
  _receivedBlobs.set(fileId, blob);
  const btn = document.querySelector(`.file-view-btn[data-file-id="${fileId}"]`);
  if (btn) {
    btn.textContent = 'View / Save';
    btn.disabled = false;
  }
};

// File viewer modal — close button and save button
const _fileViewerOverlay = document.getElementById('file-viewer-overlay');
const _fileViewerClose = document.getElementById('file-viewer-close');
const _fileViewerSave = document.getElementById('file-viewer-save');

if (_fileViewerClose) {
  _fileViewerClose.addEventListener('click', () => {
    if (_fileViewerOverlay) _fileViewerOverlay.style.display = 'none';
  });
}
if (_fileViewerSave) {
  _fileViewerSave.addEventListener('click', () => {
    if (_viewerCurrentBlob && _viewerCurrentName) _saveBlob(_viewerCurrentBlob, _viewerCurrentName);
  });
}
if (_fileViewerOverlay) {
  _fileViewerOverlay.addEventListener('click', (e) => {
    if (e.target === _fileViewerOverlay) _fileViewerOverlay.style.display = 'none';
  });
}

// Drag-and-drop onto the chat panel
const _chatPanel = document.querySelector('.chat-panel');
if (_chatPanel) {
  _chatPanel.addEventListener('dragover', (e) => {
    if (connectionManager.state !== 'connected') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    _chatPanel.classList.add('drag-over');
  });

  _chatPanel.addEventListener('dragleave', (e) => {
    if (!_chatPanel.contains(e.relatedTarget)) {
      _chatPanel.classList.remove('drag-over');
    }
  });

  _chatPanel.addEventListener('drop', async (e) => {
    e.preventDefault();
    _chatPanel.classList.remove('drag-over');
    if (connectionManager.state !== 'connected') return;

    const file = e.dataTransfer.files[0];
    if (!file) return;

    const MAX = 10 * 1024 * 1024;
    if (file.size > MAX) {
      alert(`"${file.name}" is too large. Maximum file size is 10 MB.`);
      return;
    }

    try {
      const meta = await connectionManager.announceFile(file);
      addChatMessageToUI({
        isFile: true,
        fileId: meta.fileId,
        fileName: meta.fileName,
        fileType: meta.fileType,
        fileSize: meta.fileSize,
        senderId: meta.senderId,
        senderName: meta.senderName,
        timestamp: meta.timestamp,
        isLocal: true
      });
    } catch (err) {
      console.error('[File] Failed to share file:', err);
      alert(`Could not share file: ${err.message}`);
    }
  });
}

// ===== DISPLAY NAME =====

const displayNameInput = document.getElementById('displayNameInput');
if (displayNameInput) {
  displayNameInput.addEventListener('change', (e) => {
    connectionManager.setDisplayName(e.target.value);
  });
}

// ===== PARTICIPANT LIST (Step 06) =====

function updateParticipantList() {
  const container = document.getElementById('participantList');
  if (!container) return;

  container.innerHTML = '';

  const roomInfo = connectionManager.getRoomInfo();

  // Update persistent count in the header row above the list
  const participantCount = document.getElementById('participant-count');
  if (participantCount) {
    participantCount.textContent = `Participants (${roomInfo.peerCount + 1}/${roomInfo.maxPeers + 1})`;
  }

  // Self (always first)
  const selfEl = _createParticipantEntry({
    name: connectionManager.getDisplayName(),
    isSelf: true,
    isHost: roomInfo.isHost,
    hasAudio: true
  });
  container.appendChild(selfEl);

  // Other peers
  roomInfo.peers.forEach(peer => {
    const isThisHost = roomInfo.peerOrder[0] === peer.id;
    const el = _createParticipantEntry({
      id: peer.id,
      name: peer.name,
      isSelf: false,
      isHost: isThisHost,
      hasAudio: peer.hasAudio
    });
    container.appendChild(el);
  });
}

function _createParticipantEntry({ id, name, isSelf, isHost, hasAudio }) {
  const row = document.createElement('div');
  row.className = 'participant-row';

  // Top row container for status, name, and mute
  const topRow = document.createElement('div');
  topRow.className = 'participant-top-row';
  
  // Status indicator
  const status = document.createElement('span');
  status.className = 'participant-status';
  status.innerHTML = hasAudio ? '<i class="ph-fill ph-check-circle" style="color: var(--success);"></i>' : '<i class="ph-fill ph-pause-circle" style="color: var(--danger);"></i>';
  topRow.appendChild(status);

  // Name
  const nameEl = document.createElement('span');
  nameEl.className = 'participant-name';

  const iconSuffix = (document.documentElement.getAttribute('data-theme') === 'arctic') ? '2' : '1';
  const suffix = isSelf ? ' (You)' : '';
  nameEl.appendChild(document.createTextNode(name + suffix));

  // Banner behind participant row (PNG from generated_icons)
  // Host uses v2 banner for midnight theme, standard for arctic
  const bannerEl = document.createElement('img');
  if (isHost) {
    bannerEl.src = iconSuffix === '1'
      ? '../../assets/generated_icons/banner_host_name_1_v2.png'
      : '../../assets/generated_icons/banner_host_name_2.png';
  } else {
    bannerEl.src = `../../assets/generated_icons/banner_guest_name_${iconSuffix}.png`;
  }
  bannerEl.className = 'participant-banner';
  bannerEl.alt = '';
  row.appendChild(bannerEl);

  topRow.appendChild(nameEl);
  row.appendChild(topRow);

  // Volume control + mute (not for self)
  if (!isSelf && id) {
    // Volume container (hidden by default)
    const volumeContainer = document.createElement('div');
    volumeContainer.className = 'participant-volume-container';
    volumeContainer.style.display = 'none';

    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.min = '0';
    volumeSlider.max = '300';  // 0–300% (>100% amplified via GainNode)
    volumeSlider.value = '100';
    volumeSlider.className = 'participant-volume';

    const volumeLabel = document.createElement('span');
    volumeLabel.className = 'participant-volume-label';
    volumeLabel.textContent = '100%';

    volumeSlider.addEventListener('input', (e) => {
      const sliderVal = parseInt(e.target.value);
      volumeLabel.textContent = sliderVal + '%';
      audioManager.setRemoteVolume(id, sliderVal / 100); // 0.0–3.0
    });

    volumeContainer.appendChild(volumeSlider);
    volumeContainer.appendChild(volumeLabel);
    row.appendChild(volumeContainer);

    // Toggle volume visibility on name click
    nameEl.style.cursor = 'pointer';
    nameEl.title = 'Click to adjust volume';
    nameEl.addEventListener('click', () => {
      const isHidden = volumeContainer.style.display === 'none';
      volumeContainer.style.display = isHidden ? 'flex' : 'none';
    });

    // Per-person mute button (always visible in top row)
    const muteBtn = document.createElement('button');
    muteBtn.className = 'participant-mute-btn';
    muteBtn.innerHTML = '<i class="ph-bold ph-speaker-high"></i>';
    muteBtn.title = `Mute ${name}`;
    let isMuted = false;

    muteBtn.addEventListener('click', () => {
      isMuted = !isMuted;
      audioManager.setRemoteVolume(id, isMuted ? 0 : parseInt(volumeSlider.value) / 100);
      volumeLabel.textContent = isMuted ? '0%' : volumeSlider.value + '%';
      muteBtn.classList.toggle('muted', isMuted);
      muteBtn.innerHTML = isMuted ? '<i class="ph-bold ph-speaker-slash"></i>' : '<i class="ph-bold ph-speaker-high"></i>';
    });

    topRow.appendChild(muteBtn);

    // Kick button — only visible to local host, not for self
    if (connectionManager.isHost) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'participant-kick-btn';
      kickBtn.innerHTML = '<i class="ph-bold ph-x"></i>';
      kickBtn.title = `Kick ${name}`;
      kickBtn.addEventListener('click', () => {
        connectionManager.kickPeer(id);
      });
      topRow.appendChild(kickBtn);
    }
  }

  return row;
}

// Register peer event callbacks
connectionManager.onPeerJoined = (peerId, peerInfo) => {
  updateParticipantList();
  // Notify video window if open
  if (isVideoWindowOpen && window.ipcAPI && window.ipcAPI.video) {
    window.ipcAPI.video.notifyPeerJoined(peerId, peerInfo);
  }
};

connectionManager.onPeerLeft = (peerId) => {
  updateParticipantList();
  // Notify video window if open
  if (isVideoWindowOpen && window.ipcAPI && window.ipcAPI.video) {
    window.ipcAPI.video.notifyPeerLeft(peerId);
  }
};

connectionManager.onHostMigration = (newHostId, newRoomId) => {
  console.log(`[UI] Host migrated to: ${newHostId}, new room ID: ${newRoomId}`);
  // Update room ID display
  roomIdConnected.textContent = newRoomId || '';
  setRoleBadge(connectionManager.isHost);
  if (lockRoomBtnConnected) lockRoomBtnConnected.style.display = connectionManager.isHost ? 'inline-flex' : 'none';
  updateParticipantList();
};

// ===== STATUS BAR CONNECTION INFO =====

function updateStatusBarConnection() {
  const info = connectionManager.getRoomInfo();
  switch (connectionManager.state) {
    case 'connected':
      connectionStatusText.textContent = `📡 ${info.roomId} (${info.peerCount + 1} users)`;
      connectionStatusText.style.color = '#00ff88';
      break;
    case 'waiting':
      connectionStatusText.textContent = `📡 ${info.roomId} (waiting...)`;
      connectionStatusText.style.color = '#00d4ff80';
      break;
  }
}

// Cleanup on app close
window.addEventListener('beforeunload', () => {
  audioManager.stopAllRemoteAudio();
  connectionManager.leaveRoom();
});

// ===== THEME SWITCHING =====

const THEMES = ['midnight', 'arctic', 'slate'];
const THEME_LABELS = { midnight: 'Midnight', arctic: 'Arctic', slate: 'Slate' };

let currentTheme = localStorage.getItem('icevox-theme') || 'midnight';
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeLabel = document.getElementById('theme-label');

function updateIconsForTheme(theme) {
  // Slate uses midnight's icon set (suffix '1') — icons are hidden via CSS anyway
  const suffix = theme === 'arctic' ? '2' : '1';
  document.querySelectorAll('[data-icon]').forEach(el => {
    const iconName = el.getAttribute('data-icon');
    el.src = `../../assets/icons/${iconName}_${suffix}.ico`;
  });
  document.querySelectorAll('[data-icon-png]').forEach(el => {
    const iconName = el.getAttribute('data-icon-png');
    el.src = `../../assets/generated_icons/${iconName}_${suffix}.png`;
  });
}

// Init: set theme label, update theme-button icon, update all icons
const themeIconImg = themeToggleBtn.querySelector('[data-icon]');
// Slate has no custom .ico — reuse midnight's (hidden by CSS in slate anyway)
const themeIconName = (t) => t === 'slate' ? 'theme_midnight' : `theme_${t}`;
themeLabel.textContent = THEME_LABELS[currentTheme];
if (themeIconImg) themeIconImg.setAttribute('data-icon', themeIconName(currentTheme));
updateIconsForTheme(currentTheme);

themeToggleBtn.addEventListener('click', () => {
  const nextIndex = (THEMES.indexOf(currentTheme) + 1) % THEMES.length;
  currentTheme = THEMES[nextIndex];
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('icevox-theme', currentTheme);
  themeLabel.textContent = THEME_LABELS[currentTheme];
  if (themeIconImg) themeIconImg.setAttribute('data-icon', themeIconName(currentTheme));
  updateIconsForTheme(currentTheme);
  updateParticipantList();
});

// ===== ABOUT DIALOG =====

const DONATE_URL = 'https://ko-fi.com/icevox';
const GITHUB_URL = 'https://github.com/bjorehag/IceVox';

function openExternal(url) {
  if (window.ipcAPI && window.ipcAPI.openExternal) {
    window.ipcAPI.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

async function showAboutDialog() {
  const version = await window.ipcAPI?.getAppVersion?.() || '0.2.0';

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'settings-modal about-dialog';
  dialog.innerHTML = `
    <div class="settings-header">
      <i class="ph-bold ph-info"></i>
      About
      <button class="settings-close-btn about-close-btn" title="Close">
        <i class="ph-bold ph-x"></i>
      </button>
    </div>
    <div class="about-body">
      <div class="about-title">IceVox</div>
      <div class="about-version">v${version}</div>
      <p class="about-description">Real-time voice effects and P2P voice chat for gaming and roleplay.</p>
      <p class="about-tagline">IceVox is built and maintained<br>by a solo developer.</p>
      <div class="about-links">
        <button class="about-link-btn about-donate-btn">Please donate for better cat food 🐱</button>
        <button class="about-link-btn about-github-btn">🔗 GitHub</button>
      </div>
    </div>
  `;

  overlay.appendChild(dialog);

  // Event listeners (not inline onclick — contextIsolation)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  dialog.querySelector('.about-close-btn').addEventListener('click', () => overlay.remove());
  dialog.querySelector('.about-donate-btn').addEventListener('click', () => openExternal(DONATE_URL));
  dialog.querySelector('.about-github-btn').addEventListener('click', () => openExternal(GITHUB_URL));

  document.body.appendChild(overlay);
}

document.getElementById('about-trigger').addEventListener('click', showAboutDialog);

// ===== ROTARY KNOB =====

function setupKnob(trackId, inputId, displayId) {
  const track = document.getElementById(trackId);
  const input = document.getElementById(inputId);
  const display = document.getElementById(displayId);
  if (!track || !input) return;

  const min = parseFloat(input.min);
  const max = parseFloat(input.max);

  function render() {
    const pct = (parseFloat(input.value) - min) / (max - min);
    track.style.setProperty('--knob-arc', (pct * 270) + 'deg');
    track.style.setProperty('--knob-rotation', (-135 + pct * 270) + 'deg');
    if (display) display.textContent = Math.round(parseFloat(input.value)) + '%';
  }

  render(); // Initial render

  // Drag up/down to change value
  let dragStartY = 0;
  let dragStartValue = 0;
  track.addEventListener('mousedown', (e) => {
    dragStartY = e.clientY;
    dragStartValue = parseFloat(input.value);
    e.preventDefault();

    const onMove = (e2) => {
      const dy = dragStartY - e2.clientY; // up = increase
      const delta = (dy / 120) * (max - min);
      input.value = Math.max(min, Math.min(max, dragStartValue + delta));
      input.dispatchEvent(new Event('input'));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Scroll wheel for fine adjustment
  track.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = (max - min) / 50;
    input.value = Math.max(min, Math.min(max, parseFloat(input.value) + (e.deltaY < 0 ? step : -step)));
    input.dispatchEvent(new Event('input'));
  }, { passive: false });

  // Re-render when input changes externally
  input.addEventListener('input', render);
}

setupKnob('loopback-knob-track', 'popup-monitor-volume', 'popup-volume-value');
setupKnob('mic-gain-knob-track', 'mic-gain-input', 'mic-gain-value');


// ===== AUDIO SETTINGS MODAL =====

const AUDIO_SETTINGS_DEFAULTS = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true
};

function loadAudioSettings() {
  const saved = localStorage.getItem('icevox-audio-settings');
  if (saved) {
    try { return { ...AUDIO_SETTINGS_DEFAULTS, ...JSON.parse(saved) }; }
    catch (e) { /* fall through to defaults */ }
  }
  return { ...AUDIO_SETTINGS_DEFAULTS };
}

function saveAudioSettings(settings) {
  localStorage.setItem('icevox-audio-settings', JSON.stringify(settings));
}

const audioSettingsBtn  = document.getElementById('audio-settings-btn');
const audioSettingsOverlay = document.getElementById('audio-settings-overlay');
const audioSettingsClose   = document.getElementById('audio-settings-close');
const noiseSuppressionToggle = document.getElementById('setting-noise-suppression');
const echoCancellationToggle = document.getElementById('setting-echo-cancellation');
const autoGainToggle         = document.getElementById('setting-auto-gain');

// Load saved settings and apply to audioManager BEFORE init() is called
const savedAudioSettings = loadAudioSettings();
noiseSuppressionToggle.checked = savedAudioSettings.noiseSuppression;
echoCancellationToggle.checked = savedAudioSettings.echoCancellation;
autoGainToggle.checked         = savedAudioSettings.autoGainControl;
// Write directly to the micConstraints object so init() picks them up
audioManager.micConstraints.noiseSuppression = savedAudioSettings.noiseSuppression;
audioManager.micConstraints.echoCancellation = savedAudioSettings.echoCancellation;
audioManager.micConstraints.autoGainControl  = savedAudioSettings.autoGainControl;

// Open / close modal
audioSettingsBtn.addEventListener('click', () => {
  audioSettingsOverlay.style.display = 'flex';
});
audioSettingsClose.addEventListener('click', () => {
  audioSettingsOverlay.style.display = 'none';
});
audioSettingsOverlay.addEventListener('click', (e) => {
  if (e.target === audioSettingsOverlay) {
    audioSettingsOverlay.style.display = 'none';
  }
});

// After mic re-init, re-verify WebRTC track (same pattern as device switch)
function reapplyProcessedTrackToWebRTC() {
  if (connectionManager.peers.size === 0) return;
  setTimeout(() => {
    const processedTrack = audioManager.getProcessedTrack();
    if (!processedTrack) return;
    connectionManager.peers.forEach((peer, id) => {
      if (!peer.call) return;
      const pc = peer.call.peerConnection;
      if (!pc) return;
      const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
      if (audioSender && audioSender.track !== processedTrack) {
        audioSender.replaceTrack(processedTrack)
          .then(() => console.log(`[WebRTC] Processed track re-verified for ${id} after settings change`))
          .catch(err => console.warn(`[WebRTC] replaceTrack failed for ${id}:`, err));
      }
    });
  }, 300);
}

async function applySettingChange() {
  const newConstraints = {
    noiseSuppression: noiseSuppressionToggle.checked,
    echoCancellation: echoCancellationToggle.checked,
    autoGainControl:  autoGainToggle.checked
  };
  saveAudioSettings(newConstraints);

  if (!audioManager.isInitialized) return;

  const result = await audioManager.applyMicConstraints(newConstraints);
  if (result.success) {
    reapplyProcessedTrackToWebRTC();
  } else {
    console.warn('[UI] Failed to apply audio settings:', result.error);
  }
}

noiseSuppressionToggle.addEventListener('change', applySettingChange);
echoCancellationToggle.addEventListener('change', applySettingChange);
autoGainToggle.addEventListener('change', applySettingChange);


// Initialize UI
updateConnectionUI('disconnected');
populateDeviceLists(); // Initial population (before mic permission, labels may be generic)
autoInitAudio();       // Auto-start audio — re-populates device list with real labels after permission

// Make managers available globally for testing
window.connection = connectionManager;
window.audio = audioManager;

// Handle protocol deep-link join requests (icevox://join/[room-id])
if (window.ipcAPI && window.ipcAPI.onProtocolJoinRoom) {
  window.ipcAPI.onProtocolJoinRoom(async (roomId) => {
    console.log(`[UI] Protocol join request for room: ${roomId}`);

    // Fill in the room ID input so the user can see what happened
    if (roomIdInput) {
      roomIdInput.value = roomId;
      updateJoinButtonState();
    }

    try {
      // Ensure audio is running before joining
      if (!audioManager.isInitialized) {
        showConnectionError('Starting audio...', false);
        const result = await audioManager.init();
        if (!result.success) {
          throw new Error(result.error || 'Failed to initialize audio');
        }
        hideConnectionError();
        updateAudioWarning();
      }

      const sendStream = audioManager.getSendStream();
      if (!sendStream) {
        throw new Error('No send stream available');
      }

      await connectionManager.joinRoom(roomId, sendStream);
    } catch (err) {
      console.error(`[UI] Protocol auto-join failed: ${err.message}`);
      showConnectionError(`Failed to join room: ${err.message}`);
    }
  });
}

// ===== USER-SAVED PRESETS =====

const SAVED_PRESETS_KEY = 'icevox-saved-presets';
const NUM_SAVED_SLOTS = 3;

let savedSlots = (() => {
  try {
    const raw = localStorage.getItem(SAVED_PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Ensure array is always length NUM_SAVED_SLOTS
    const arr = new Array(NUM_SAVED_SLOTS).fill(null);
    if (Array.isArray(parsed)) parsed.forEach((v, i) => { if (i < NUM_SAVED_SLOTS) arr[i] = v; });
    return arr;
  } catch { return new Array(NUM_SAVED_SLOTS).fill(null); }
})();

function persistSavedSlots() {
  localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(savedSlots));
}

function renderSavedSlot(btn, slotData) {
  btn.innerHTML = '';
  if (slotData) {
    btn.classList.remove('empty');
    const slotNum = parseInt(btn.id.replace('saved-slot-', ''), 10) + 1;
    const iconName = `save_custom_nr${slotNum}`;
    const themeSuffix = (document.documentElement.getAttribute('data-theme') === 'arctic') ? '2' : '1';
    const icon = document.createElement('img');
    icon.className = 'preset-icon-img saved-slot-icon saved-slot-filled-glow';
    icon.setAttribute('data-icon', iconName);
    icon.src = `../../assets/icons/${iconName}_${themeSuffix}.ico`;
    icon.alt = '';
    const name = document.createElement('span');
    name.className = 'saved-slot-name';
    name.textContent = slotData.name;
    btn.appendChild(icon);
    btn.appendChild(name);
    btn.title = `Load "${slotData.name}" — right-click to clear`;
  } else {
    btn.classList.add('empty');
    // Derive slot number (saved-slot-0 → 1, saved-slot-1 → 2, saved-slot-2 → 3)
    const slotNum = parseInt(btn.id.replace('saved-slot-', ''), 10) + 1;
    const iconName = `save_custom_nr${slotNum}`;
    const themeSuffix = (document.documentElement.getAttribute('data-theme') === 'arctic') ? '2' : '1';
    const icon = document.createElement('img');
    icon.className = 'preset-icon-img saved-slot-icon';
    icon.setAttribute('data-icon', iconName);
    icon.src = `../../assets/icons/${iconName}_${themeSuffix}.ico`;
    icon.alt = '';
    const label = document.createElement('span');
    label.className = 'saved-slot-name';
    label.textContent = 'Save current';
    btn.appendChild(icon);
    btn.appendChild(label);
    btn.title = 'Click to save current settings';
  }
}

for (let i = 0; i < NUM_SAVED_SLOTS; i++) {
  const btn = document.getElementById(`saved-slot-${i}`);
  if (!btn) continue;

  renderSavedSlot(btn, savedSlots[i]);

  btn.addEventListener('click', () => {
    if (savedSlots[i]) {
      // Load saved preset
      activePreset = null;
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      audioManager.setEffectParams(savedSlots[i].params);
      updateSlidersFromParams(savedSlots[i].params);
      connectionManager.sendEffectParams(savedSlots[i].params);
    } else {
      // Save current settings to this slot
      const params = audioManager.getCurrentEffectParams();
      // Derive display name/emoji from active preset or use "Custom N"
      let name, emoji;
      if (activePreset !== null && PRESETS[activePreset]) {
        name = PRESETS[activePreset].name;
        emoji = PRESETS[activePreset].emoji;
      } else {
        name = `Custom ${i + 1}`;
        emoji = '⭐';
      }
      savedSlots[i] = { name, emoji, params: { ...params } };
      persistSavedSlots();
      renderSavedSlot(btn, savedSlots[i]);
    }
  });

  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (savedSlots[i]) {
      savedSlots[i] = null;
      persistSavedSlots();
      btn.classList.remove('active');
      renderSavedSlot(btn, null);
    }
  });
}


// ===== RESIZABLE CHAT PANEL =====

const chatPanel = document.querySelector('.chat-panel');
const topStrip = document.querySelector('.top-strip');
const panelDivider = document.getElementById('panel-divider');

// Restore saved dimensions
const savedChatWidth = localStorage.getItem('icevox-chat-width');
if (savedChatWidth && chatPanel) {
  document.documentElement.style.setProperty('--chat-panel-width', savedChatWidth);
}
const savedChatHeightNarrow = localStorage.getItem('icevox-chat-height-narrow');
if (savedChatHeightNarrow) {
  document.documentElement.style.setProperty('--chat-panel-height-narrow', savedChatHeightNarrow);
}

if (panelDivider && chatPanel && topStrip) {
  panelDivider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    panelDivider.classList.add('dragging');

    const isNarrow = window.innerWidth <= 580;

    if (isNarrow) {
      // Narrow (stacked) mode: drag changes chat-panel HEIGHT.
      // Reference point is chatPanel.top (not topStrip.top) because in narrow
      // mode the logo sits above the chat panel inside the same top-strip,
      // so topStrip.top would be too high and produce an inflated height.
      const onMove = (e2) => {
        const chatPanelRect = chatPanel.getBoundingClientRect();
        let h = e2.clientY - chatPanelRect.top;
        h = Math.min(Math.max(h, 80), 400);
        document.documentElement.style.setProperty('--chat-panel-height-narrow', h.toFixed(0) + 'px');
      };
      const onUp = () => {
        panelDivider.classList.remove('dragging');
        localStorage.setItem('icevox-chat-height-narrow', getComputedStyle(chatPanel).height);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    } else {
      // Normal (side-by-side) mode: drag changes chat-panel WIDTH
      const onMove = (e2) => {
        const rect = topStrip.getBoundingClientRect();
        let pct = ((e2.clientX - rect.left) / rect.width) * 100;
        pct = Math.min(Math.max(pct, 20), 80);
        document.documentElement.style.setProperty('--chat-panel-width', pct + '%');
      };
      const onUp = () => {
        panelDivider.classList.remove('dragging');
        const w = getComputedStyle(chatPanel).width;
        const rect = topStrip.getBoundingClientRect();
        const pct = (parseFloat(w) / rect.width) * 100;
        localStorage.setItem('icevox-chat-width', pct.toFixed(1) + '%');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
  });
}


// ===== VERTICAL RESIZE — strip divider (top-strip height) =====

const stripDivider = document.getElementById('strip-divider');
const appContainer = document.querySelector('.app-container');

// Restore saved top-strip height
const savedStripHeight = localStorage.getItem('icevox-strip-height');
if (savedStripHeight) {
  document.documentElement.style.setProperty('--top-strip-height', savedStripHeight);
}

if (stripDivider && topStrip && appContainer) {
  stripDivider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    stripDivider.classList.add('dragging');

    const isNarrow = window.innerWidth <= 580;

    if (isNarrow) {
      // Narrow (stacked) mode: top-strip is height:auto so --top-strip-height has no effect.
      // Instead, adjust --chat-panel-height-narrow so the strip-divider tracks the mouse.
      // strip-divider position = chatPanel.top + chatHeight + panelDivider(5px) + usersHeight
      // → chatHeight = mouseY - chatPanel.top - usersHeight - 5
      const usersPanel = document.querySelector('.users-panel');
      const onMove = (e2) => {
        const chatPanelRect = chatPanel.getBoundingClientRect();
        const usersPanelH = usersPanel ? usersPanel.getBoundingClientRect().height : 150;
        let h = e2.clientY - chatPanelRect.top - usersPanelH - 5;
        h = Math.min(Math.max(h, 80), 400);
        document.documentElement.style.setProperty('--chat-panel-height-narrow', h.toFixed(0) + 'px');
      };
      const onUp = () => {
        stripDivider.classList.remove('dragging');
        localStorage.setItem('icevox-chat-height-narrow', getComputedStyle(chatPanel).height);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    } else {
      // Normal (tall) mode: drag adjusts --top-strip-height as % of app-container height.
      const onMove = (e2) => {
        const rect = appContainer.getBoundingClientRect();
        let pct = ((e2.clientY - rect.top) / rect.height) * 100;
        pct = Math.min(Math.max(pct, 15), 70);
        document.documentElement.style.setProperty('--top-strip-height', pct.toFixed(1) + '%');
      };
      const onUp = () => {
        stripDivider.classList.remove('dragging');
        const h = getComputedStyle(topStrip).height;
        const rect = appContainer.getBoundingClientRect();
        const pct = (parseFloat(h) / rect.height) * 100;
        localStorage.setItem('icevox-strip-height', pct.toFixed(1) + '%');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
  });
}


// ===== TASKBAR CONTROLS (thumbnail toolbar + system tray) =====

let isOutputMuted = false;

function sendTaskbarState() {
  if (!window.ipcAPI || !window.ipcAPI.taskbar) return;

  const roomInfo = connectionManager.getRoomInfo();
  const peers = roomInfo.peers.map(p => ({
    id: p.id,
    name: p.name,
    volume: audioManager.getEffectivePeerVolume(p.id)
  }));

  window.ipcAPI.taskbar.sendStateUpdate({
    isMicMuted: isSendMuted,
    isOutputMuted: isOutputMuted,
    peers: peers
  });
}

// Listen for taskbar commands from main process
if (window.ipcAPI && window.ipcAPI.taskbar) {
  window.ipcAPI.taskbar.onToggleMicMute(() => {
    handleMuteSend();
    sendTaskbarState();
  });

  window.ipcAPI.taskbar.onToggleOutputMute(() => {
    isOutputMuted = !isOutputMuted;
    if (isOutputMuted) {
      audioManager.muteAllOutput();
    } else {
      audioManager.unmuteAllOutput();
    }
    sendTaskbarState();
  });

  window.ipcAPI.taskbar.onSetPeerVolume((peerId, volume) => {
    audioManager.setRemoteVolume(peerId, volume);
    sendTaskbarState();
    // Sync the participant list slider if visible
    updateParticipantList();
  });
}

// Sync taskbar on mic mute click (handleMuteSend fires first via earlier listener)
muteSendBtn.addEventListener('click', () => sendTaskbarState());

// Sync on peer join/leave (updates participant list in tray)
const _origOnPeerJoined = connectionManager.onPeerJoined;
connectionManager.onPeerJoined = (peerId, peerInfo) => {
  _origOnPeerJoined(peerId, peerInfo);
  sendTaskbarState();
};

const _origOnPeerLeft = connectionManager.onPeerLeft;
connectionManager.onPeerLeft = (peerId) => {
  _origOnPeerLeft(peerId);
  sendTaskbarState();
};

// Sync on room create/join/leave
createRoomBtn.addEventListener('click', () => setTimeout(sendTaskbarState, 500));
joinRoomBtn.addEventListener('click', () => setTimeout(sendTaskbarState, 500));
leaveRoomBtnWaiting.addEventListener('click', () => setTimeout(sendTaskbarState, 100));
leaveRoomBtnConnected.addEventListener('click', () => setTimeout(sendTaskbarState, 100));

// Initial state push
sendTaskbarState();

console.log('IceVox2 renderer initialized');
