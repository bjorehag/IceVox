# Step 7: Text Chat

## Task
Implement text messaging via WebRTC data channels with system messages for join/leave/migration events.

## Instructions

### 7.1 Send chat messages

```javascript
// In ConnectionManager:
sendChatMessage(text) {
  if (!text || text.trim().length === 0) return;

  const trimmed = text.trim().substring(0, 500); // Max 500 characters
  const message = {
    type: 'chat',
    text: trimmed,
    senderName: this.displayName || 'Anonymous',
    timestamp: Date.now(),
  };

  // Send to all connected peers
  for (const [peerId, peerData] of this.peers) {
    if (peerData.dataConn) {
      peerData.dataConn.send(message);
    }
  }

  // Show locally too
  if (this.onChatMessage) {
    this.onChatMessage(this.displayName || 'You', trimmed, message.timestamp, true);
  }

  console.log(`[Chat] Sent: ${trimmed.substring(0, 50)}...`);
}
```

### 7.2 Receive chat messages

Add to `_handleDataMessage()`:

```javascript
case 'chat':
  if (this.onChatMessage) {
    this.onChatMessage(data.senderName, data.text, data.timestamp, false);
  }
  break;
```

### 7.3 System messages

Send system messages when peers join/leave and during host migration. In the UI code (renderer.js), create a helper:

```javascript
function addSystemMessage(text) {
  addChatMessage(null, text, Date.now(), false, true); // isSystem = true
}
```

Call it from the callbacks:

```javascript
connectionManager.onPeerJoined = (peerId, info) => {
  const name = info.displayName || peerId.substring(0, 8);
  addSystemMessage(`${name} joined the room`);
  // Update participant list...
};

connectionManager.onPeerLeft = (peerId) => {
  addSystemMessage(`Peer left the room`);
  // Update participant list...
};

connectionManager.onHostMigration = (newHostId, isMe) => {
  if (isMe) {
    addSystemMessage('You are now the host');
  } else {
    addSystemMessage('Host has changed');
  }
};
```

### 7.4 Chat UI in renderer.js

```javascript
const MAX_CHAT_MESSAGES = 200;
let chatMessages = [];

function addChatMessage(senderName, text, timestamp, isLocal, isSystem = false) {
  // Add to history
  chatMessages.push({ senderName, text, timestamp, isLocal, isSystem });
  if (chatMessages.length > MAX_CHAT_MESSAGES) {
    chatMessages.shift(); // Remove oldest
  }

  // Create message element
  const messagesContainer = document.getElementById('chat-messages');
  const msgEl = document.createElement('div');
  msgEl.classList.add('chat-message');

  if (isSystem) {
    msgEl.classList.add('system-message');
    msgEl.textContent = text;
  } else {
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const nameSpan = document.createElement('span');
    nameSpan.classList.add('chat-sender');
    nameSpan.textContent = senderName;
    nameSpan.style.color = getPeerColor(senderName); // Consistent color per name

    const timeSpan = document.createElement('span');
    timeSpan.classList.add('chat-timestamp');
    timeSpan.textContent = time;

    const textSpan = document.createElement('span');
    textSpan.classList.add('chat-text');
    textSpan.textContent = text;

    msgEl.appendChild(nameSpan);
    msgEl.appendChild(timeSpan);
    msgEl.appendChild(textSpan);
  }

  messagesContainer.appendChild(msgEl);

  // Auto-scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Consistent color per sender name
function getPeerColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 65%)`;
}
```

### 7.5 Wire chat input

```javascript
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');

function sendChat() {
  const text = chatInput.value;
  if (text.trim()) {
    connectionManager.sendChatMessage(text);
    chatInput.value = '';
  }
}

chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});
```

### 7.6 Enable/disable chat input based on connection state

```javascript
connectionManager.onConnectionStateChange = (state) => {
  const connected = state === 'connected';
  chatInput.disabled = !connected;
  chatSendBtn.disabled = !connected;
};
```

## Verification
- [ ] Send a message from one instance → appears on the other
- [ ] Messages show sender name (colored), timestamp, and text
- [ ] System messages appear for join/leave events (dimmed, italic)
- [ ] Messages auto-scroll to the bottom
- [ ] Enter key sends messages
- [ ] Chat input is disabled when not connected
- [ ] Max 500 characters enforced
- [ ] No console errors
