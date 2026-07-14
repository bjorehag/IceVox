// IceVox Web — UI logic
// Ported from desktop renderer.js via the mobile app. Browser adaptations:
//  - Start overlay (AudioContext requires a user gesture in browsers)
//  - Responsive: tabs on narrow screens, three columns on wide screens
//  - [WEB] ?room=<id> / #<id> deep link — prefills and auto-joins after start
//  - [WEB] Output device selector when the browser supports setSinkId
//  - navigator.share for invite links, Web Share for saving files
//  - Long-press (instead of right-click) to clear saved presets
//  - Wake Lock keeps the screen on while in a room
//  - In-app video overlay (video.js) instead of desktop's separate window

import audioManager from './audio.js';
import { PRESETS, DEFAULT_PARAMS } from './presets.js';
import connectionManager from './connection.js';
import videoManager from './video.js';

const APP_VERSION = '0.2.0';

// ===== TAB NAVIGATION =====

const tabButtons = document.querySelectorAll('.tab-btn');
const views = {
  effects: document.getElementById('view-effects'),
  room: document.getElementById('view-room'),
  chat: document.getElementById('view-chat'),
};
let activeView = 'effects';
let unreadChatCount = 0;
const chatBadge = document.getElementById('chat-badge');
const roomDot = document.getElementById('room-dot');

function switchView(name) {
  activeView = name;
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('view-active', key === name);
  });
  tabButtons.forEach(btn => {
    btn.classList.toggle('tab-active', btn.dataset.view === name);
  });
  if (name === 'chat') {
    unreadChatCount = 0;
    chatBadge.style.display = 'none';
    // Scroll chat to bottom when opening
    const container = document.getElementById('chatMessages');
    container.scrollTop = container.scrollHeight;
  }
}

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function bumpChatBadge() {
  if (activeView === 'chat') return;
  unreadChatCount++;
  chatBadge.textContent = unreadChatCount > 9 ? '9+' : String(unreadChatCount);
  chatBadge.style.display = 'block';
}

// ===== AUDIO SETTINGS (load before init so constraints apply) =====

const AUDIO_SETTINGS_DEFAULTS = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true
};

function loadAudioSettings() {
  const saved = localStorage.getItem('icevox-audio-settings');
  if (saved) {
    try { return { ...AUDIO_SETTINGS_DEFAULTS, ...JSON.parse(saved) }; }
    catch (e) { /* fall through */ }
  }
  return { ...AUDIO_SETTINGS_DEFAULTS };
}

function saveAudioSettings(settings) {
  localStorage.setItem('icevox-audio-settings', JSON.stringify(settings));
}

const noiseSuppressionToggle = document.getElementById('setting-noise-suppression');
const echoCancellationToggle = document.getElementById('setting-echo-cancellation');
const autoGainToggle         = document.getElementById('setting-auto-gain');

const savedAudioSettings = loadAudioSettings();
noiseSuppressionToggle.checked = savedAudioSettings.noiseSuppression;
echoCancellationToggle.checked = savedAudioSettings.echoCancellation;
autoGainToggle.checked         = savedAudioSettings.autoGainControl;
audioManager.micConstraints.noiseSuppression = savedAudioSettings.noiseSuppression;
audioManager.micConstraints.echoCancellation = savedAudioSettings.echoCancellation;
audioManager.micConstraints.autoGainControl  = savedAudioSettings.autoGainControl;

// ===== START OVERLAY (user gesture → audio init) =====

const startOverlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-audio-btn');
const startError = document.getElementById('start-error');
const appEl = document.getElementById('app');

// [WEB] Deep link: ?room=<id> (matches icevox.net/join.html convention) or #<id>.
// The room is joined automatically right after the user starts audio.
function parseDeepLinkRoom() {
  const fromQuery = new URLSearchParams(location.search).get('room');
  const fromHash = location.hash ? location.hash.substring(1) : '';
  const candidate = (fromQuery || fromHash || '').trim().toLowerCase();
  return /^icevox-[a-z0-9]{5}$/.test(candidate) ? candidate : null;
}

let pendingRoomId = parseDeepLinkRoom();
if (pendingRoomId) {
  const hint = document.getElementById('start-room-hint');
  hint.textContent = `You're joining room ${pendingRoomId}`;
  hint.style.display = 'block';
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  startError.style.display = 'none';

  const result = await audioManager.init();

  if (result.success) {
    // Default mic boost 125% (matches desktop default behaviour)
    const micGainInput = document.getElementById('mic-gain-input');
    audioManager.setInputGain(parseInt(micGainInput.value) / 100);

    startOverlay.style.display = 'none';
    appEl.style.display = 'flex';

    await populateDeviceList();
    console.log('[App] Audio started:', result.deviceLabel);

    // [WEB] Deep-linked room: go to Room view and join it immediately
    if (pendingRoomId) {
      roomIdInput.value = pendingRoomId;
      updateJoinButtonState();
      switchView('room');
      pendingRoomId = null;
      handleJoinRoom();
    }
  } else {
    startBtn.disabled = false;
    startError.textContent = result.error +
      (result.error === 'Microphone access denied'
        ? ' — enable microphone permission for IceVox in system settings and try again.'
        : '');
    startError.style.display = 'block';
  }
});

// Resume AudioContext after interruptions (phone call, backgrounding)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    audioManager.resumeIfSuspended();
    reacquireWakeLock();
  }
});
document.addEventListener('touchend', () => audioManager.resumeIfSuspended(), { passive: true });

// ===== WAKE LOCK (keep screen on while in a room) =====

let wakeLock = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
    console.log('[App] Wake lock acquired');
  } catch (err) {
    console.warn('[App] Wake lock failed:', err.message);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
    console.log('[App] Wake lock released');
  }
}

function reacquireWakeLock() {
  // Wake locks auto-release when the page is hidden — re-acquire when visible again
  if (!wakeLock && connectionManager.getState() !== 'disconnected' && !document.hidden) {
    acquireWakeLock();
  }
}

// ===== EFFECT SLIDERS =====

let activePreset = null;

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

Object.keys(effectSliders).forEach(sliderId => {
  const config = effectSliders[sliderId];
  const sliderElement = document.getElementById(sliderId);
  const valueElement = document.getElementById(config.valueId);
  if (!sliderElement) return;

  sliderElement.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    valueElement.textContent = config.format(value);

    // Sync dual pitch sliders manually to avoid updateSlidersFromParams loop
    if (sliderId === 'pitch-slider') {
      const other = document.getElementById('basic-pitch-slider');
      const otherVal = document.getElementById('basic-pitch-value');
      if (other) { other.value = value; otherVal.textContent = config.format(value); }
    } else if (sliderId === 'basic-pitch-slider') {
      const other = document.getElementById('pitch-slider');
      const otherVal = document.getElementById('pitch-value');
      if (other) { other.value = value; otherVal.textContent = config.format(value); }
    }

    const params = {};
    params[config.param] = value;
    audioManager.setEffectParams(params);
    connectionManager.sendEffectParams(audioManager.getCurrentEffectParams());

    if (activePreset !== null) {
      activePreset = null;
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    }
  });
});

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

// ===== PRESETS =====

const presetButtons = document.querySelectorAll('.preset-btn:not(.saved-slot)');

presetButtons.forEach((btn) => {
  const index = parseInt(btn.dataset.preset, 10);
  btn.addEventListener('click', () => {
    if (activePreset === index) {
      activePreset = null;
      btn.classList.remove('active');
      audioManager.setEffectParams(DEFAULT_PARAMS);
      updateSlidersFromParams(DEFAULT_PARAMS);
      connectionManager.sendEffectParams(DEFAULT_PARAMS);
    } else {
      activePreset = index;
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const preset = PRESETS[index];
      audioManager.setEffectParams(preset.params);
      updateSlidersFromParams(preset.params);
      connectionManager.sendEffectParams(preset.params);
    }
  });
});

// Reset button
document.getElementById('reset-effects-btn').addEventListener('click', () => {
  activePreset = null;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  audioManager.setEffectParams(DEFAULT_PARAMS);
  updateSlidersFromParams(DEFAULT_PARAMS);
  connectionManager.sendEffectParams(DEFAULT_PARAMS);
});

// ===== SAVED PRESETS (long-press to delete on mobile) =====

const SAVED_PRESETS_KEY = 'icevox-saved-presets';
const NUM_SAVED_SLOTS = 3;

let savedSlots = (() => {
  try {
    const raw = localStorage.getItem(SAVED_PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
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
  const slotNum = parseInt(btn.id.replace('saved-slot-', ''), 10) + 1;
  const iconName = `save_custom_nr${slotNum}`;
  const themeSuffix = (document.documentElement.getAttribute('data-theme') === 'arctic') ? '2' : '1';

  const icon = document.createElement('img');
  icon.className = 'preset-icon-img';
  icon.setAttribute('data-icon', iconName);
  icon.src = `assets/icons/${iconName}_${themeSuffix}.ico`;
  icon.alt = '';

  const label = document.createElement('span');
  label.className = 'preset-name';
  label.textContent = slotData ? slotData.name : 'Save';

  btn.classList.toggle('empty', !slotData);
  btn.appendChild(icon);
  btn.appendChild(label);
}

for (let i = 0; i < NUM_SAVED_SLOTS; i++) {
  const btn = document.getElementById(`saved-slot-${i}`);
  if (!btn) continue;

  renderSavedSlot(btn, savedSlots[i]);

  let longPressTimer = null;
  let longPressFired = false;

  const clearSlot = () => {
    if (savedSlots[i]) {
      savedSlots[i] = null;
      persistSavedSlots();
      btn.classList.remove('active');
      renderSavedSlot(btn, null);
    }
  };

  btn.addEventListener('pointerdown', () => {
    longPressFired = false;
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      clearSlot();
      if (navigator.vibrate) navigator.vibrate(30);
    }, 600);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(evt => {
    btn.addEventListener(evt, () => clearTimeout(longPressTimer));
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

  btn.addEventListener('click', () => {
    if (longPressFired) return; // long-press already handled this touch

    if (savedSlots[i]) {
      activePreset = null;
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      audioManager.setEffectParams(savedSlots[i].params);
      updateSlidersFromParams(savedSlots[i].params);
      connectionManager.sendEffectParams(savedSlots[i].params);
    } else {
      const params = audioManager.getCurrentEffectParams();
      let name;
      if (activePreset !== null && PRESETS[activePreset]) {
        name = PRESETS[activePreset].name;
      } else {
        name = `Custom ${i + 1}`;
      }
      savedSlots[i] = { name, params: { ...params } };
      persistSavedSlots();
      renderSavedSlot(btn, savedSlots[i]);
    }
  });
}

// ===== MONITOR (hear myself) + VOLUMES =====

const monitorToggle = document.getElementById('monitor-toggle');
const monitorVolumeRow = document.getElementById('monitor-volume-row');
const monitorVolume = document.getElementById('popup-monitor-volume');
const monitorVolumeValue = document.getElementById('popup-volume-value');

monitorToggle.addEventListener('change', () => {
  audioManager.setMonitorEnabled(monitorToggle.checked);
  monitorVolumeRow.style.display = monitorToggle.checked ? 'block' : 'none';
});

monitorVolume.addEventListener('input', (e) => {
  const value = parseInt(e.target.value);
  monitorVolumeValue.textContent = value + '%';
  audioManager.setMasterGain(value / 100);
});

const micGainInput = document.getElementById('mic-gain-input');
const micGainValue = document.getElementById('mic-gain-value');
micGainInput.addEventListener('input', (e) => {
  const value = parseInt(e.target.value);
  micGainValue.textContent = value + '%';
  audioManager.setInputGain(value / 100);
});

// ===== HEADER: MUTE BUTTONS =====

const muteSendBtn = document.getElementById('mute-send-btn');
const outputMuteBtn = document.getElementById('output-mute-btn');
let isSendMuted = false;
let isOutputMuted = false;

muteSendBtn.addEventListener('click', () => {
  isSendMuted = !isSendMuted;
  if (isSendMuted) audioManager.muteSend();
  else audioManager.unmuteSend();
  muteSendBtn.classList.toggle('muted', isSendMuted);
});

outputMuteBtn.addEventListener('click', () => {
  isOutputMuted = !isOutputMuted;
  if (isOutputMuted) audioManager.muteAllOutput();
  else audioManager.unmuteAllOutput();
  outputMuteBtn.classList.toggle('muted', isOutputMuted);
});

// ===== CONNECTION UI =====

const connectionViewDisconnected = document.getElementById('connection-view-disconnected');
const connectionViewWaiting = document.getElementById('connection-view-waiting');
const connectionViewConnected = document.getElementById('connection-view-connected');
const connectionError = document.getElementById('connection-error');
const headerStatus = document.getElementById('header-status');

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
const inviteBtnConnected = document.getElementById('invite-btn-connected');
const createRoomLabel = document.getElementById('create-room-label');
const joinRoomLabel = document.getElementById('join-room-label');

function setRoleBadge(isHost) {
  const theme = document.documentElement.getAttribute('data-theme');
  const suffix = theme === 'arctic' ? '2' : '1';
  const iconName = isHost ? 'host_symbol' : 'guest_symbol';
  const label = isHost ? 'Host' : 'Guest';
  userRole.innerHTML = `<img data-icon="${iconName}" src="assets/icons/${iconName}_${suffix}.ico" alt="${label}"> ${label}`;
}

function showConnectionView(view) {
  connectionViewDisconnected.style.display = 'none';
  connectionViewWaiting.style.display = 'none';
  connectionViewConnected.style.display = 'none';

  if (view === 'disconnected') connectionViewDisconnected.style.display = 'block';
  else if (view === 'waiting') connectionViewWaiting.style.display = 'block';
  else if (view === 'connected') connectionViewConnected.style.display = 'block';
}

function updateConnectionUI(state) {
  const roomInfo = connectionManager.getRoomInfo();

  switch (state) {
    case 'disconnected':
      showConnectionView('disconnected');
      showChatPlaceholder();
      showUsersPlaceholder();
      updateChatInputState();
      headerStatus.textContent = '';
      headerStatus.className = 'header-status';
      roomDot.style.display = 'none';
      releaseWakeLock();
      break;

    case 'connecting':
      showConnectionView('waiting');
      roomIdDisplay.textContent = '';
      headerStatus.textContent = 'Connecting…';
      headerStatus.className = 'header-status st-waiting';
      break;

    case 'waiting':
      showConnectionView('waiting');
      roomIdDisplay.textContent = roomInfo.roomId || '';
      headerStatus.textContent = `${roomInfo.roomId || ''}`;
      headerStatus.className = 'header-status st-waiting';
      roomDot.style.display = 'block';
      acquireWakeLock();
      break;

    case 'connected':
      showConnectionView('connected');
      roomIdConnected.textContent = roomInfo.roomId || '';
      setRoleBadge(roomInfo.isHost);
      lockRoomBtnConnected.style.display = roomInfo.isHost ? 'flex' : 'none';
      inviteBtnConnected.style.display = roomInfo.peerCount < 5 ? 'flex' : 'none';
      hideConnectionError();
      updateParticipantList();
      updateChatInputState();
      headerStatus.textContent = `${roomInfo.roomId} · ${roomInfo.peerCount + 1} users`;
      headerStatus.className = 'header-status st-connected';
      roomDot.style.display = 'block';
      acquireWakeLock();
      break;

    case 'error':
      headerStatus.textContent = 'Connection failed';
      headerStatus.className = 'header-status st-error';
      break;
  }
}

function showConnectionError(message, isError = true) {
  connectionError.textContent = message;
  connectionError.style.display = 'block';
  connectionError.classList.toggle('warn', !isError);
  if (isError) {
    setTimeout(() => hideConnectionError(), 5000);
  }
}

function hideConnectionError() {
  connectionError.style.display = 'none';
}

function updateJoinButtonState() {
  joinRoomBtn.disabled = roomIdInput.value.trim() === '';
}

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
  if (!/^icevox-[a-z0-9]{5}$/.test(roomId)) {
    return null;
  }
  return roomId;
}

async function handleCreateRoom() {
  try {
    const sendStream = audioManager.getSendStream();
    if (!sendStream) throw new Error('No send stream available');

    createRoomBtn.disabled = true;
    createRoomLabel.textContent = 'Creating…';

    const password = roomPasswordInput.value.trim();
    await connectionManager.createRoom(sendStream, password || null);

    roomPasswordInput.value = '';
    createRoomBtn.disabled = false;
    createRoomLabel.textContent = 'Create room';
  } catch (err) {
    showConnectionError(err.message);
    createRoomBtn.disabled = false;
    createRoomLabel.textContent = 'Create room';
  }
}

async function handleJoinRoom() {
  try {
    const roomId = parseRoomInput(roomIdInput.value);
    if (!roomId) {
      showConnectionError('Please enter a valid room ID or invite link');
      return;
    }

    const sendStream = audioManager.getSendStream();
    if (!sendStream) throw new Error('No send stream available');

    joinRoomBtn.disabled = true;
    joinRoomLabel.textContent = 'Joining…';

    const password = roomPasswordInput.value.trim();
    await connectionManager.joinRoom(roomId, sendStream, password);

    roomPasswordInput.value = '';
    joinRoomBtn.disabled = false;
    joinRoomLabel.textContent = 'Join room';
  } catch (err) {
    showConnectionError(err.message);
    joinRoomBtn.disabled = false;
    joinRoomLabel.textContent = 'Join room';
  }
}

function handleLeaveRoom() {
  videoManager.close();
  audioManager.stopAllRemoteAudio();
  connectionManager.leaveRoom();
  roomIdInput.value = '';
  updateJoinButtonState();
}

// Share invite link — native share sheet if available, clipboard fallback
async function handleShareInvite() {
  const link = connectionManager.getInviteLink();
  if (!link) return;

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Join my IceVox room',
        text: `Join my IceVox voice room: ${link}`,
      });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled — done
      // fall through to clipboard
    }
  }

  try {
    await navigator.clipboard.writeText(link);
    copyFeedback.style.display = 'block';
    setTimeout(() => { copyFeedback.style.display = 'none'; }, 2000);
  } catch (err) {
    console.warn('[UI] Could not copy invite link:', err);
  }
}

createRoomBtn.addEventListener('click', handleCreateRoom);
joinRoomBtn.addEventListener('click', handleJoinRoom);
leaveRoomBtnWaiting.addEventListener('click', handleLeaveRoom);
leaveRoomBtnConnected.addEventListener('click', handleLeaveRoom);
copyRoomIdBtn.addEventListener('click', handleShareInvite);
inviteBtnConnected.addEventListener('click', handleShareInvite);
roomIdInput.addEventListener('input', updateJoinButtonState);

// ===== ROOM PASSWORD MODAL =====

const passwordModalOverlay = document.getElementById('password-modal-overlay');
const passwordModalClose = document.getElementById('password-modal-close');
const passwordModalConfirm = document.getElementById('password-modal-confirm');
const newPasswordInput = document.getElementById('new-password-input');

function openPasswordModal() {
  newPasswordInput.value = '';
  passwordModalOverlay.style.display = 'flex';
  newPasswordInput.focus();
}

function closePasswordModal() {
  passwordModalOverlay.style.display = 'none';
}

function applyPasswordChange() {
  const newPassword = newPasswordInput.value.trim();
  connectionManager.setRoomPassword(newPassword || null);
  closePasswordModal();
}

lockRoomBtnWaiting.addEventListener('click', openPasswordModal);
lockRoomBtnConnected.addEventListener('click', openPasswordModal);
passwordModalClose.addEventListener('click', closePasswordModal);
passwordModalConfirm.addEventListener('click', applyPasswordChange);
newPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyPasswordChange();
});
passwordModalOverlay.addEventListener('click', (e) => {
  if (e.target === passwordModalOverlay) closePasswordModal();
});

// ===== CONNECTION CALLBACKS =====

connectionManager.onRemoteStream = (peerId, stream) => {
  if (stream) {
    audioManager.setupRemoteAudio(peerId, stream);
    // Belt-and-braces for video: the audio stream arriving proves the peer is
    // fully connected — make sure the video mesh knows about it (deduped inside).
    videoManager.notifyPeerJoined(peerId);
  } else {
    audioManager.stopRemoteAudio(peerId);
  }
};

connectionManager.onGetProcessedTrack = () => audioManager.getProcessedTrack();

connectionManager.onStateChange = (newState, oldState) => {
  console.log(`[UI] Connection state: ${oldState} → ${newState}`);
  updateConnectionUI(newState);
  // Broadcast saved display name once connected (peer + data channels exist)
  if (newState === 'connected' && oldState !== 'connected') {
    applySavedDisplayName();
  }
};

connectionManager.onError = (error) => {
  console.error('[UI] Connection error:', error);
  showConnectionError(error.message || 'Connection error occurred');
};

connectionManager.onPeerJoined = (peerId) => {
  updateParticipantList();
  videoManager.notifyPeerJoined(peerId);
};
connectionManager.onPeerLeft = (peerId) => {
  updateParticipantList();
  videoManager.notifyPeerLeft(peerId);
};

connectionManager.onHostMigration = (newHostId, newRoomId) => {
  console.log(`[UI] Host migrated to: ${newHostId}, new room ID: ${newRoomId}`);
  roomIdConnected.textContent = newRoomId || '';
  setRoleBadge(connectionManager.isHost);
  lockRoomBtnConnected.style.display = connectionManager.isHost ? 'flex' : 'none';
  updateParticipantList();
  const roomInfo = connectionManager.getRoomInfo();
  headerStatus.textContent = `${roomInfo.roomId} · ${roomInfo.peerCount + 1} users`;
};


// ===== VIDEO CHAT =====

const videoBtnWaiting = document.getElementById('video-btn-waiting');
const videoBtnConnected = document.getElementById('video-btn-connected');

function openVideo() {
  videoManager.open();
}
videoBtnWaiting.addEventListener('click', openVideo);
videoBtnConnected.addEventListener('click', openVideo);

// Route incoming video signals (from any client type, incl. desktop) to the
// video manager — it buffers them while the overlay is closed.
connectionManager.onVideoSignal = (fromPeerId, signal) => {
  videoManager.handleSignal(fromPeerId, signal);
};

// Indicator dot: someone is trying to video-connect while our video is closed
videoManager.onStateChange = () => {
  const show = videoManager.hasBufferedSignals() && !videoManager.isOpen;
  document.querySelectorAll('.video-indicator').forEach(el => {
    el.style.display = show ? 'inline-block' : 'none';
  });
};

// ===== DISPLAY NAME =====

const displayNameInput = document.getElementById('displayNameInput');
const savedDisplayName = localStorage.getItem('icevox-display-name');
if (savedDisplayName) displayNameInput.value = savedDisplayName;

displayNameInput.addEventListener('change', (e) => {
  const name = e.target.value.trim();
  localStorage.setItem('icevox-display-name', name);
  if (name) connectionManager.setDisplayName(name);
  updateParticipantList();
});

// Apply saved display name once a room exists (peer must exist for broadcast)
function applySavedDisplayName() {
  const name = (displayNameInput.value || '').trim();
  if (name && connectionManager.peer) {
    connectionManager.setDisplayName(name);
  }
}

// ===== PARTICIPANT LIST =====

function updateParticipantList() {
  const container = document.getElementById('participantList');
  container.innerHTML = '';

  const roomInfo = connectionManager.getRoomInfo();
  const participantCount = document.getElementById('participant-count');

  if (connectionManager.state !== 'connected') {
    participantCount.textContent = '';
    showUsersPlaceholder();
    return;
  }

  participantCount.textContent = `Participants (${roomInfo.peerCount + 1}/${roomInfo.maxPeers + 1})`;

  // Self (always first)
  container.appendChild(_createParticipantEntry({
    name: connectionManager.getDisplayName(),
    isSelf: true,
    isHost: roomInfo.isHost,
    hasAudio: true
  }));

  roomInfo.peers.forEach(peer => {
    const isThisHost = roomInfo.peerOrder[0] === peer.id;
    container.appendChild(_createParticipantEntry({
      id: peer.id,
      name: peer.name,
      isSelf: false,
      isHost: isThisHost,
      hasAudio: peer.hasAudio
    }));
  });
}

function _svgIcon(id, cls = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.appendChild(use);
  return svg;
}

function _createParticipantEntry({ id, name, isSelf, isHost, hasAudio }) {
  const row = document.createElement('div');
  row.className = 'participant-row';

  const topRow = document.createElement('div');
  topRow.className = 'participant-top-row';

  const status = document.createElement('span');
  status.className = 'participant-status';
  status.innerHTML = `<span class="dot ${hasAudio ? 'on' : 'off'}"></span>`;
  topRow.appendChild(status);

  const nameEl = document.createElement('span');
  nameEl.className = 'participant-name';
  nameEl.textContent = name + (isSelf ? ' (You)' : '');
  if (isHost) {
    nameEl.appendChild(_svgIcon('i-crown', 'icon host-crown'));
  }
  topRow.appendChild(nameEl);
  row.appendChild(topRow);

  if (!isSelf && id) {
    const volumeContainer = document.createElement('div');
    volumeContainer.className = 'participant-volume-container';
    volumeContainer.style.display = 'none';

    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.min = '0';
    volumeSlider.max = '300'; // 0–300% (>100% amplified via GainNode)
    volumeSlider.value = String(Math.round(audioManager.getEffectivePeerVolume(id) * 100));

    const volumeLabel = document.createElement('span');
    volumeLabel.className = 'participant-volume-label';
    volumeLabel.textContent = volumeSlider.value + '%';

    volumeSlider.addEventListener('input', (e) => {
      const sliderVal = parseInt(e.target.value);
      volumeLabel.textContent = sliderVal + '%';
      audioManager.setRemoteVolume(id, sliderVal / 100);
    });

    volumeContainer.appendChild(volumeSlider);
    volumeContainer.appendChild(volumeLabel);
    row.appendChild(volumeContainer);

    // Tap name to show/hide volume
    nameEl.addEventListener('click', () => {
      const isHidden = volumeContainer.style.display === 'none';
      volumeContainer.style.display = isHidden ? 'flex' : 'none';
    });

    // Per-person mute
    const muteBtn = document.createElement('button');
    muteBtn.className = 'participant-mute-btn';
    muteBtn.appendChild(_svgIcon('i-speaker'));
    let isMuted = false;

    muteBtn.addEventListener('click', () => {
      isMuted = !isMuted;
      audioManager.setRemoteVolume(id, isMuted ? 0 : parseInt(volumeSlider.value) / 100);
      muteBtn.classList.toggle('muted', isMuted);
      muteBtn.innerHTML = '';
      muteBtn.appendChild(_svgIcon(isMuted ? 'i-speaker-off' : 'i-speaker'));
    });
    topRow.appendChild(muteBtn);

    // Kick — host only
    if (connectionManager.isHost) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'participant-kick-btn';
      kickBtn.appendChild(_svgIcon('i-x'));
      kickBtn.addEventListener('click', () => {
        if (confirm(`Remove ${name} from the room?`)) {
          connectionManager.kickPeer(id);
        }
      });
      topRow.appendChild(kickBtn);
    }
  }

  return row;
}

function showUsersPlaceholder() {
  const container = document.getElementById('participantList');
  const s = document.documentElement.getAttribute('data-theme') === 'arctic' ? '2' : '1';
  container.innerHTML = `<div class="empty-state"><img src="assets/generated_icons/icevox_no_connections_placeholder_${s}.png" class="placeholder-img" data-icon-png="icevox_no_connections_placeholder" alt=""><br>No connections</div>`;
}

// ===== TEXT CHAT =====

const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatAttachBtn = document.getElementById('chat-attach-btn');
const chatFileInput = document.getElementById('chat-file-input');

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
  const threshold = 60;
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

function addChatMessageToUI(messageData) {
  const container = document.getElementById('chatMessages');

  const placeholder = container.querySelector('.empty-state');
  if (placeholder) placeholder.remove();

  const msgEl = document.createElement('div');
  msgEl.classList.add('chat-message');

  if (messageData.isSystem) {
    msgEl.classList.add('chat-system');
    msgEl.textContent = messageData.text;

  } else if (messageData.isFile) {
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
    btn.textContent = messageData.isLocal ? 'View' : 'View / Save';
    btn.addEventListener('click', () => _handleFileCardClick(btn));

    bodyEl.appendChild(iconEl);
    bodyEl.appendChild(metaEl);
    bodyEl.appendChild(btn);

    msgEl.appendChild(headerEl);
    msgEl.appendChild(bodyEl);

  } else {
    const nameEl = document.createElement('span');
    nameEl.classList.add('chat-sender');
    nameEl.textContent = messageData.isLocal ? 'You' : messageData.senderName;
    nameEl.style.color = messageData.isLocal ? 'var(--primary)' : _getPeerColor(messageData.senderName);

    const textEl = document.createElement('span');
    textEl.classList.add('chat-text');
    textEl.textContent = ': ' + messageData.text;

    const timeEl = document.createElement('span');
    timeEl.classList.add('chat-time');
    timeEl.textContent = new Date(messageData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgEl.appendChild(nameEl);
    msgEl.appendChild(textEl);
    msgEl.appendChild(timeEl);
  }

  container.appendChild(msgEl);

  if (activeView === 'chat' && _isNearBottom(container)) {
    container.scrollTop = container.scrollHeight;
  }
}

function showChatPlaceholder() {
  const container = document.getElementById('chatMessages');
  const s = document.documentElement.getAttribute('data-theme') === 'arctic' ? '2' : '1';
  container.innerHTML = `<div class="empty-state"><img src="assets/generated_icons/icevox_join_chat_placeholder_${s}.png" class="placeholder-img" data-icon-png="icevox_join_chat_placeholder" alt=""><br>Join a room to chat</div>`;
}

function updateChatInputState() {
  const isConnected = connectionManager.state === 'connected';
  chatInput.disabled = !isConnected;
  chatSendBtn.disabled = !isConnected;
  chatAttachBtn.disabled = !isConnected;
  chatInput.placeholder = isConnected ? 'Type message…' : 'Connect to a room to chat';
}

function sendChatFromUI() {
  const text = chatInput.value.trim();
  if (text.length === 0) return;
  if (connectionManager.state !== 'connected') return;

  connectionManager.sendChatMessage(text);
  chatInput.value = '';
}

chatSendBtn.addEventListener('click', sendChatFromUI);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChatFromUI();
  }
});

connectionManager.onChatMessage = (peerId, messageData) => {
  addChatMessageToUI(messageData);
  if (!messageData.isLocal && !messageData.isSystem) bumpChatBadge();
};

// ===== FILE SHARING (attach button instead of drag-and-drop) =====

const _receivedBlobs = new Map();
let _viewerCurrentBlob = null;
let _viewerCurrentName = '';

chatAttachBtn.addEventListener('click', () => chatFileInput.click());

chatFileInput.addEventListener('change', async () => {
  const file = chatFileInput.files[0];
  chatFileInput.value = ''; // allow re-selecting the same file
  if (!file || connectionManager.state !== 'connected') return;

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

  h = h.replace(/```[\s\S]*?```/g, m => `<pre><code>${m.slice(3, -3).trim()}</code></pre>`);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');

  h = h.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  h = h.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  h = h.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  h = h.replace(/^---+$/gm, '<hr>');

  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');

  h = h.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);

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
    _showFileViewerModal(fileName, `<img src="${url}" alt="${fileName}">`, blob, fileName);
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
      _showFileViewerModal(fileName, `<pre>${escaped}</pre>`, blob, fileName);
    };
    reader.readAsText(blob);
  } else {
    // Non-viewable file — hand to the OS share/save sheet
    _saveBlob(blob, fileName);
  }
}

function _showFileViewerModal(title, contentHtml, blob, fileName) {
  _viewerCurrentBlob = blob;
  _viewerCurrentName = fileName;

  document.getElementById('file-viewer-title').textContent = title;
  document.getElementById('file-viewer-content').innerHTML = contentHtml;
  document.getElementById('file-viewer-overlay').style.display = 'flex';
}

async function _saveBlob(blob, fileName) {
  // [MOBILE] Prefer the native share sheet — lets the user save to Files,
  // send to another app, etc. Blob <a download> is unreliable in WebViews.
  const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('[File] Share failed, falling back to download:', err);
    }
  }

  // Fallback: classic anchor download
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
    const stored = connectionManager._storedFiles.get(fileId);
    if (!stored) { btn.textContent = 'No longer available'; return; }
    const blob = new Blob([stored.buffer], { type: stored.fileType });
    _openFileViewer(fileName, fileType, blob);
    return;
  }

  const cached = _receivedBlobs.get(fileId);
  if (cached) {
    _openFileViewer(fileName, fileType, cached);
    return;
  }

  const ok = connectionManager.requestFile(fileId, senderId);
  if (!ok) {
    btn.textContent = 'Sender offline';
    return;
  }
  btn.textContent = 'Downloading…';
  btn.disabled = true;
}

connectionManager.onFileReceived = (fileId, _fileName, _fileType, blob) => {
  _receivedBlobs.set(fileId, blob);
  const btn = document.querySelector(`.file-view-btn[data-file-id="${fileId}"]`);
  if (btn) {
    btn.textContent = 'View / Save';
    btn.disabled = false;
  }
};

// File viewer modal buttons
document.getElementById('file-viewer-close').addEventListener('click', () => {
  document.getElementById('file-viewer-overlay').style.display = 'none';
});
document.getElementById('file-viewer-save').addEventListener('click', () => {
  if (_viewerCurrentBlob && _viewerCurrentName) _saveBlob(_viewerCurrentBlob, _viewerCurrentName);
});
document.getElementById('file-viewer-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('file-viewer-overlay')) {
    document.getElementById('file-viewer-overlay').style.display = 'none';
  }
});

// ===== ADVANCED PANEL ACCORDION =====

const advancedToggle = document.getElementById('advanced-toggle');
const advancedPanel = document.getElementById('advanced-panel');

advancedToggle.addEventListener('click', () => {
  const isOpen = advancedPanel.style.display !== 'none';
  advancedPanel.style.display = isOpen ? 'none' : 'flex';
  advancedToggle.classList.toggle('open', !isOpen);
});

// ===== AUDIO SETTINGS MODAL =====

const audioSettingsBtn = document.getElementById('audio-settings-btn');
const audioSettingsOverlay = document.getElementById('audio-settings-overlay');
const audioSettingsClose = document.getElementById('audio-settings-close');
const inputSelect = document.getElementById('input-select');
const outputSelect = document.getElementById('output-select');
const outputSelectRow = document.getElementById('output-select-row');

audioSettingsBtn.addEventListener('click', async () => {
  audioSettingsOverlay.style.display = 'flex';
  await populateDeviceList();
});
audioSettingsClose.addEventListener('click', () => {
  audioSettingsOverlay.style.display = 'none';
});
audioSettingsOverlay.addEventListener('click', (e) => {
  if (e.target === audioSettingsOverlay) audioSettingsOverlay.style.display = 'none';
});

async function populateDeviceList() {
  const devices = await audioManager.getDevices();
  inputSelect.innerHTML = '<option value="">Default</option>';
  devices.inputs.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label;
    if (device.deviceId === audioManager.currentInputDeviceId) option.selected = true;
    inputSelect.appendChild(option);
  });

  // [WEB] Output selector — only where the browser supports setSinkId
  if (audioManager.outputSelectionSupported()) {
    outputSelectRow.style.display = 'flex';
    outputSelect.innerHTML = '<option value="">Default</option>';
    devices.outputs.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label;
      if (device.deviceId === audioManager.currentOutputDeviceId) option.selected = true;
      outputSelect.appendChild(option);
    });
  }
}

// [WEB] Output device switching
outputSelect.addEventListener('change', async (e) => {
  const deviceId = e.target.value;
  if (!audioManager.isInitialized || !deviceId) return;
  const result = await audioManager.switchOutput(deviceId);
  if (!result.success) {
    console.warn('[UI] Output switch failed:', result.error);
  }
});

inputSelect.addEventListener('change', async (e) => {
  const deviceId = e.target.value;
  if (!audioManager.isInitialized) return;

  if (deviceId) {
    const result = await audioManager.switchInput(deviceId);
    if (!result.success) {
      showConnectionError(`Mic switch failed: ${result.error}`);
      return;
    }
  } else {
    // Back to system default
    audioManager.currentInputDeviceId = null;
    await audioManager.applyMicConstraints({});
  }
  reapplyProcessedTrackToWebRTC();
});

// After mic re-init, re-verify WebRTC track (same pattern as desktop)
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
          .then(() => console.log(`[WebRTC] Processed track re-verified for ${id}`))
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

// ===== THEME SWITCHING =====

const THEMES = ['midnight', 'arctic', 'slate'];
let currentTheme = localStorage.getItem('icevox-theme') || 'midnight';

function updateIconsForTheme(theme) {
  // Slate uses midnight's icon set (suffix '1')
  const suffix = theme === 'arctic' ? '2' : '1';
  document.querySelectorAll('[data-icon]').forEach(el => {
    const iconName = el.getAttribute('data-icon');
    el.src = `assets/icons/${iconName}_${suffix}.ico`;
  });
  document.querySelectorAll('[data-icon-png]').forEach(el => {
    const iconName = el.getAttribute('data-icon-png');
    el.src = `assets/generated_icons/${iconName}_${suffix}.png`;
  });
}

updateIconsForTheme(currentTheme);

document.getElementById('theme-toggle-btn').addEventListener('click', () => {
  const nextIndex = (THEMES.indexOf(currentTheme) + 1) % THEMES.length;
  currentTheme = THEMES[nextIndex];
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('icevox-theme', currentTheme);
  updateIconsForTheme(currentTheme);
  if (connectionManager.state === 'connected') updateParticipantList();
});

// ===== ABOUT DIALOG =====

const DONATE_URL = 'https://ko-fi.com/icevox';
const GITHUB_URL = 'https://github.com/bjorehag/IceVox';

document.getElementById('about-trigger').addEventListener('click', () => {
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'settings-modal';
  dialog.innerHTML = `
    <div class="settings-header">
      About
      <button class="settings-close-btn about-close-btn"><svg class="icon"><use href="#i-x"/></svg></button>
    </div>
    <div class="about-body">
      <div class="about-title">IceVox Web</div>
      <div class="about-version">v${APP_VERSION}</div>
      <p class="about-description">Real-time voice effects and P2P voice chat for gaming and roleplay.</p>
      <p class="about-tagline">IceVox is built and maintained by a solo developer.</p>
      <div class="about-links">
        <button class="about-link-btn about-donate-btn">Please donate for better cat food 🐱</button>
        <button class="about-link-btn about-github-btn">🔗 GitHub</button>
      </div>
    </div>
  `;

  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  dialog.querySelector('.about-close-btn').addEventListener('click', () => overlay.remove());
  dialog.querySelector('.about-donate-btn').addEventListener('click', () => window.open(DONATE_URL, '_blank'));
  dialog.querySelector('.about-github-btn').addEventListener('click', () => window.open(GITHUB_URL, '_blank'));
  document.body.appendChild(overlay);
});

// Cleanup on close
window.addEventListener('beforeunload', () => {
  videoManager.close();
  audioManager.stopAllRemoteAudio();
  connectionManager.leaveRoom();
  releaseWakeLock();
});

// ===== INIT =====

updateConnectionUI('disconnected');
updateJoinButtonState();

// Make managers available globally for debugging
window.connection = connectionManager;
window.audio = audioManager;

console.log(`[App] IceVox Web v${APP_VERSION} ready — waiting for user to start audio`);
