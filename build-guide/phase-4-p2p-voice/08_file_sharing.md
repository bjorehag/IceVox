# Step 8: File Sharing

## Task
Implement peer-to-peer file transfer via WebRTC data channels using an announce/request/chunk protocol.

## How it works

1. **Sender** reads a file, stores it locally, and broadcasts metadata (`file-announce`) to all peers
2. **Recipient** sees the announcement in chat as a file card. When they click download, they send a `file-request` back to the sender
3. **Sender** streams the file in 32 KB chunks (`file-chunk`) to the requester only
4. **Recipient** reassembles the chunks into a Blob and presents it for viewing/saving

This is on-demand — only the requesting peer receives the file data, saving bandwidth.

## Instructions

### 8.1 File storage on the sender side

```javascript
// In ConnectionManager:
constructor() {
  // ... existing properties
  this._storedFiles = new Map();   // fileId → { fileName, fileType, buffer }
  this._incomingFiles = new Map(); // fileId → { fileName, fileType, chunks[], totalChunks, from }
}
```

### 8.2 Announce a file

```javascript
async announceFile(file) {
  if (!file || file.size > 10 * 1024 * 1024) {
    console.warn('[File] File too large (max 10 MB)');
    return;
  }

  const buffer = await file.arrayBuffer();
  const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const chunkSize = 32 * 1024; // 32 KB
  const totalChunks = Math.ceil(buffer.byteLength / chunkSize);

  // Store locally
  this._storedFiles.set(fileId, {
    fileName: file.name,
    fileType: file.type || 'application/octet-stream',
    buffer: buffer,
  });

  // Broadcast metadata to all peers
  const announce = {
    type: 'file-announce',
    fileId,
    fileName: file.name,
    fileSize: file.size,
    totalChunks,
    fileType: file.type || 'application/octet-stream',
    senderName: this.displayName || 'Anonymous',
  };

  for (const [peerId, peerData] of this.peers) {
    if (peerData.dataConn) {
      peerData.dataConn.send(announce);
    }
  }

  console.log(`[File] Announced: ${file.name} (${totalChunks} chunks)`);

  // Show in local chat too
  if (this.onFileAnnounce) {
    this.onFileAnnounce(this.peer.id, fileId, file.name, file.size, totalChunks, file.type, true);
  }
}
```

### 8.3 Request a file

When a recipient wants to download an announced file:

```javascript
requestFile(fileId, fromPeerId) {
  const peerData = this.peers.get(fromPeerId);
  if (!peerData?.dataConn) return;

  peerData.dataConn.send({ type: 'file-request', fileId });
  console.log(`[File] Requested ${fileId} from ${fromPeerId}`);
}
```

### 8.4 Send file chunks

When the sender receives a file-request:

```javascript
async _sendFileChunksTo(fileId, peerId) {
  const stored = this._storedFiles.get(fileId);
  if (!stored) return;

  const peerData = this.peers.get(peerId);
  if (!peerData?.dataConn) return;

  const chunkSize = 32 * 1024;
  const totalChunks = Math.ceil(stored.buffer.byteLength / chunkSize);

  console.log(`[File] Sending ${stored.fileName} to ${peerId} (${totalChunks} chunks)`);

  for (let i = 0; i < totalChunks; i++) {
    // Check connection is still alive
    if (!this.peers.has(peerId)) {
      console.warn(`[File] Peer ${peerId} disconnected during transfer`);
      return;
    }

    const offset = i * chunkSize;
    const chunk = stored.buffer.slice(offset, offset + chunkSize);
    // Convert to base64 for reliable data channel transport
    const base64 = btoa(String.fromCharCode(...new Uint8Array(chunk)));

    peerData.dataConn.send({
      type: 'file-chunk',
      fileId,
      chunkIndex: i,
      totalChunks,
      data: base64,
    });

    // Small delay between chunks to avoid overwhelming the data channel
    if (i < totalChunks - 1) {
      await new Promise(resolve => setTimeout(resolve, 8));
    }
  }

  console.log(`[File] Finished sending ${stored.fileName} to ${peerId}`);
}
```

### 8.5 Receive file chunks

```javascript
_receiveFileChunk(data, peerId) {
  const { fileId, chunkIndex, totalChunks, data: base64 } = data;

  // Security: validate chunk count
  const maxChunks = Math.ceil((10 * 1024 * 1024) / (32 * 1024)); // ~320
  if (totalChunks > maxChunks) {
    console.warn(`[File] Rejecting file with too many chunks: ${totalChunks}`);
    return;
  }

  if (chunkIndex < 0 || chunkIndex >= totalChunks) {
    console.warn(`[File] Invalid chunk index: ${chunkIndex}`);
    return;
  }

  if (!this._incomingFiles.has(fileId)) {
    // We need the announce data — skip if we don't have it
    console.warn(`[File] Received chunk for unknown file: ${fileId}`);
    return;
  }

  const incoming = this._incomingFiles.get(fileId);
  incoming.chunks[chunkIndex] = base64;

  // Check if all chunks received
  const receivedCount = incoming.chunks.filter(c => c !== undefined).length;
  if (receivedCount === incoming.totalChunks) {
    // Reassemble
    const binaryParts = incoming.chunks.map(b64 => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    });
    const blob = new Blob(binaryParts, { type: incoming.fileType });

    console.log(`[File] Received complete: ${incoming.fileName}`);

    if (this.onFileReceived) {
      this.onFileReceived(fileId, incoming.fileName, incoming.fileType, blob);
    }

    this._incomingFiles.delete(fileId);
  }
}
```

### 8.6 Handle file messages in `_handleDataMessage()`

```javascript
case 'file-announce':
  // Validate MIME type
  if (data.fileType && !/^[a-z]+\/[a-z0-9.+-]+$/i.test(data.fileType)) {
    console.warn(`[File] Invalid MIME type: ${data.fileType}`);
    break;
  }
  // Store metadata for incoming file
  this._incomingFiles.set(data.fileId, {
    fileName: data.fileName,
    fileType: data.fileType,
    totalChunks: data.totalChunks,
    chunks: new Array(data.totalChunks),
    from: peerId,
  });
  if (this.onFileAnnounce) {
    this.onFileAnnounce(peerId, data.fileId, data.fileName, data.fileSize, data.totalChunks, data.fileType, false);
  }
  break;

case 'file-request':
  this._sendFileChunksTo(data.fileId, peerId);
  break;

case 'file-chunk':
  this._receiveFileChunk(data, peerId);
  break;
```

### 8.7 Cleanup on leave

In `leaveRoom()`, clear stored files:

```javascript
this._storedFiles.clear();
this._incomingFiles.clear();
```

### 8.8 Drag-and-drop UI

In `renderer.js`, set up drag-and-drop on the chat panel:

```javascript
const chatPanel = document.getElementById('chat-panel');

chatPanel.addEventListener('dragover', (e) => {
  e.preventDefault();
  chatPanel.classList.add('drag-over');
});

chatPanel.addEventListener('dragleave', () => {
  chatPanel.classList.remove('drag-over');
});

chatPanel.addEventListener('drop', (e) => {
  e.preventDefault();
  chatPanel.classList.remove('drag-over');

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    connectionManager.announceFile(files[0]);
  }
});
```

### 8.9 File card in chat

When a file is announced, show a card in the chat with a download button:

```javascript
connectionManager.onFileAnnounce = (peerId, fileId, fileName, fileSize, totalChunks, fileType, isLocal) => {
  const card = createFileCard(fileId, fileName, fileSize, fileType, peerId, isLocal);
  document.getElementById('chat-messages').appendChild(card);
};

function createFileCard(fileId, fileName, fileSize, fileType, fromPeerId, isLocal) {
  const card = document.createElement('div');
  card.classList.add('file-card');

  const nameEl = document.createElement('span');
  nameEl.textContent = fileName;
  card.appendChild(nameEl);

  const sizeEl = document.createElement('span');
  sizeEl.textContent = formatFileSize(fileSize);
  card.appendChild(sizeEl);

  if (!isLocal) {
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download';
    downloadBtn.addEventListener('click', () => {
      connectionManager.requestFile(fileId, fromPeerId);
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Downloading...';
    });
    card.appendChild(downloadBtn);
  }

  return card;
}
```

### 8.10 Handle received files

```javascript
connectionManager.onFileReceived = (fileId, fileName, fileType, blob) => {
  // For images: show inline preview
  if (fileType.startsWith('image/')) {
    const url = URL.createObjectURL(blob);
    // Show in a viewer modal or inline in chat
  }

  // For all files: offer save
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};
```

## Verification
- [ ] Drag a file onto the chat panel → file card appears in your chat
- [ ] On the other instance, a file card with "Download" button appears
- [ ] Clicking "Download" → file transfers and saves to disk
- [ ] Images show inline preview
- [ ] Files over 10 MB are rejected
- [ ] Transfer works with 3+ participants
- [ ] No console errors during transfer
