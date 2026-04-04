# Step 9: Room UI

## Task
Wire up the connection panel, participant list, per-peer volume controls, invite links, and display name input.

## Instructions

### 9.1 Connection panel states

The users panel has three visual states. Use CSS classes or data attributes to show/hide:

**Disconnected state** (default):
- "Create" button — calls `createRoom()`
- "Join" button + room ID text input + optional password input
- Warning text: "Start audio first" (visible if audio not initialized)

**Waiting state** (host, no peers yet):
- Room ID display (clickable to copy)
- "Invite" button — copies a shareable link to clipboard
- "Lock" button — opens password modal (host only)
- "Video" button (disabled until a peer joins)
- "Leave" button

**Connected state** (peers in room):
- Room ID (small badge)
- Host/Guest role indicator with icon
- "Invite", "Lock" (host only), "Video", "Leave" buttons
- Participant count

### 9.2 Create room handler

```javascript
const createBtn = document.getElementById('create-room-btn');
createBtn.addEventListener('click', async () => {
  if (!audioManager.isInitialized) {
    await initAudio();
  }

  const sendStream = audioManager.getSendStream();
  const roomId = await connectionManager.createRoom(sendStream);

  // Update UI to waiting state
  showConnectionState('waiting', roomId);
});
```

### 9.3 Join room handler

```javascript
const joinBtn = document.getElementById('join-room-btn');
const roomIdInput = document.getElementById('room-id-input');
const passwordInput = document.getElementById('password-input');

joinBtn.addEventListener('click', async () => {
  const roomId = roomIdInput.value.trim().toLowerCase();
  if (!roomId) return;

  if (!audioManager.isInitialized) {
    await initAudio();
  }

  const sendStream = audioManager.getSendStream();
  const password = passwordInput.value || null;

  try {
    await connectionManager.joinRoom(roomId, sendStream, password);
  } catch (err) {
    console.error('[Room] Join failed:', err);
    // Show error in UI
  }
});
```

### 9.4 Invite link

Generate a web link that can be shared. The format is `https://yoursite.com/join/{roomId}` (or just copy the room ID):

```javascript
function copyInviteLink() {
  const roomId = connectionManager.roomId;
  if (!roomId) return;

  // Copy a join URL or just the room ID
  const link = roomId; // Or: `https://yourdomain.com/join/${roomId}`
  navigator.clipboard.writeText(link).then(() => {
    console.log('[Room] Invite link copied');
    // Show brief "Copied!" feedback in UI
  });
}
```

### 9.5 Display name

```javascript
const displayNameInput = document.getElementById('display-name-input');

displayNameInput.addEventListener('change', () => {
  const name = displayNameInput.value.trim().substring(0, 30);
  connectionManager.displayName = name;

  // Broadcast name to all peers
  for (const [peerId, peerData] of connectionManager.peers) {
    if (peerData.dataConn) {
      peerData.dataConn.send({ type: 'peer-info', displayName: name });
    }
  }
});

// Load from localStorage
const savedName = localStorage.getItem('display-name');
if (savedName) {
  displayNameInput.value = savedName;
  connectionManager.displayName = savedName;
}
displayNameInput.addEventListener('change', () => {
  localStorage.setItem('display-name', displayNameInput.value.trim());
});
```

### 9.6 Participant list

Render a list entry for each connected peer with volume control and mute button:

```javascript
function updateParticipantList() {
  const container = document.getElementById('participant-list');
  container.innerHTML = '';

  for (const [peerId, peerData] of connectionManager.peers) {
    if (!peerData.stream && !peerData.dataConn) continue;

    const item = document.createElement('div');
    item.classList.add('participant-item');

    // Name
    const name = document.createElement('span');
    name.classList.add('participant-name');
    name.textContent = peerData.info.displayName || peerId.substring(0, 8);

    // Host crown
    if (connectionManager.peerOrder[0] === peerId) {
      const crown = document.createElement('span');
      crown.textContent = ' 👑';
      name.appendChild(crown);
    }

    // Volume slider (0–300%)
    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.min = 0;
    volumeSlider.max = 300;
    volumeSlider.value = 100;
    volumeSlider.classList.add('peer-volume-slider');
    volumeSlider.addEventListener('input', () => {
      const volume = parseInt(volumeSlider.value) / 100;
      audioManager.setRemoteVolume(peerId, volume);
    });

    // Mute button
    const muteBtn = document.createElement('button');
    muteBtn.textContent = '🔊';
    muteBtn.classList.add('peer-mute-btn');
    let isMuted = false;
    muteBtn.addEventListener('click', () => {
      isMuted = !isMuted;
      audioManager.setRemoteVolume(peerId, isMuted ? 0 : parseInt(volumeSlider.value) / 100);
      muteBtn.textContent = isMuted ? '🔇' : '🔊';
    });

    // Kick button (host only)
    if (connectionManager.isHost) {
      const kickBtn = document.createElement('button');
      kickBtn.textContent = '✕';
      kickBtn.classList.add('kick-btn');
      kickBtn.addEventListener('click', () => {
        connectionManager.kickPeer(peerId);
      });
      item.appendChild(kickBtn);
    }

    item.appendChild(name);
    item.appendChild(volumeSlider);
    item.appendChild(muteBtn);
    container.appendChild(item);
  }

  // Update participant count
  const countEl = document.getElementById('participant-count');
  if (countEl) {
    const count = connectionManager.peers.size + 1; // +1 for self
    countEl.textContent = `${count} online`;
  }
}
```

### 9.7 Update participant list on changes

```javascript
connectionManager.onPeerJoined = (peerId, info) => {
  addSystemMessage(`${info.displayName || 'Someone'} joined`);
  updateParticipantList();
};

connectionManager.onPeerLeft = (peerId) => {
  addSystemMessage('A peer left the room');
  updateParticipantList();
  audioManager.stopRemoteAudio(peerId);
};

connectionManager.onHostMigration = (newHostId, isMe) => {
  addSystemMessage(isMe ? 'You are now the host' : 'Host has changed');
  updateParticipantList(); // Re-render to show/hide kick buttons
};
```

### 9.8 Leave room handler

```javascript
const leaveBtn = document.getElementById('leave-btn');
leaveBtn.addEventListener('click', () => {
  connectionManager.leaveRoom();
  showConnectionState('disconnected');
  document.getElementById('participant-list').innerHTML = '';
});
```

### 9.9 Password modal

```javascript
const lockBtn = document.getElementById('lock-btn');
const passwordModal = document.getElementById('password-modal');
const passwordApplyBtn = document.getElementById('password-apply-btn');

lockBtn.addEventListener('click', () => {
  passwordModal.style.display = '';
});

passwordApplyBtn.addEventListener('click', () => {
  const pw = document.getElementById('room-password-input').value.trim();
  connectionManager.password = pw || null;
  passwordModal.style.display = 'none';
  console.log(`[Room] Password ${pw ? 'set' : 'removed'}`);
});
```

### 9.10 Prepare taskbar IPC (stub for Phase 5)

Add a function that sends state to the main process for taskbar updates (implemented in Phase 5):

```javascript
function sendTaskbarState() {
  if (!window.ipcAPI?.taskbar) return;

  const peers = [];
  for (const [peerId, peerData] of connectionManager.peers) {
    peers.push({
      id: peerId,
      name: peerData.info.displayName || peerId.substring(0, 8),
    });
  }

  window.ipcAPI.taskbar.sendStateUpdate({
    micMuted: audioManager.isMicMuted || false,
    outputMuted: audioManager.isOutputMuted || false,
    peers,
  });
}
```

## Verification
- [ ] "Create" button creates a room and shows the room ID
- [ ] "Join" with a valid room ID connects to the host
- [ ] Participant list shows all connected peers with names
- [ ] Per-peer volume slider works (0–300%)
- [ ] Per-peer mute button works
- [ ] Host sees kick button; guests do not
- [ ] Kick removes the peer
- [ ] Display name updates and broadcasts to others
- [ ] Invite button copies room ID/link to clipboard
- [ ] Password modal sets/clears room password
- [ ] Leave button disconnects cleanly
- [ ] No console errors
