# Step 5: Remote Audio Playback

## Task
Play received WebRTC audio through `<audio>` elements with volume control from 0% to 300%.

## Architecture Rule

> Remote WebRTC audio CANNOT be routed through `createMediaStreamSource()` → Web Audio API → speakers in Chromium/Electron. It produces silence.
>
> **Primary approach (0–300% volume):** Route via MediaStreamDestination:
> `remoteStream → createMediaStreamSource → GainNode → MediaStreamDestination → <audio>.srcObject`
>
> **Fallback (0–100% volume):** If the primary approach produces silence (detected by AnalyserNode), fall back to direct:
> `remoteStream → <audio>.srcObject` with `audioElement.volume` for 0–100% only.

## Instructions

### 5.1 Implement `setupRemoteAudio()` in AudioManager

```javascript
async setupRemoteAudio(peerId, remoteStream) {
  // Create <audio> element for this peer
  const audioElement = document.createElement('audio');
  audioElement.autoplay = true;

  // Set output device if we've selected one
  if (this._outputDeviceId && audioElement.setSinkId) {
    await audioElement.setSinkId(this._outputDeviceId);
  }

  // Try the GainNode routing for 0–300% volume control
  let gainNode = null;
  try {
    const source = this.audioContext.createMediaStreamSource(remoteStream);
    gainNode = this.audioContext.createGain();
    gainNode.gain.value = 1.0;

    const dest = this.audioContext.createMediaStreamDestination();
    source.connect(gainNode);
    gainNode.connect(dest);
    audioElement.srcObject = dest.stream;

    // Verify audio is actually flowing (Chromium may silently fail)
    await this._verifyAudioFlow(source, peerId, audioElement, remoteStream, gainNode);
  } catch (err) {
    console.warn(`[Audio] GainNode routing failed for ${peerId}, using fallback:`, err);
    audioElement.srcObject = remoteStream;
    gainNode = null;
  }

  this.remotePeers.set(peerId, { audioElement, stream: remoteStream, gainNode });
  console.log(`[Audio] Remote audio setup for ${peerId} (gain routing: ${gainNode ? 'yes' : 'fallback'})`);
}
```

### 5.2 Verify audio flow

The GainNode approach sometimes produces silence. Detect this with an AnalyserNode:

```javascript
async _verifyAudioFlow(source, peerId, audioElement, remoteStream, gainNode) {
  const analyser = this.audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const dataArray = new Float32Array(analyser.fftSize);

  // Check 5 times over 1.25 seconds
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    analyser.getFloatTimeDomainData(dataArray);

    // Check if any sample is non-zero
    const hasAudio = dataArray.some(v => Math.abs(v) > 0.0001);
    if (hasAudio) {
      analyser.disconnect();
      console.log(`[Audio] Verified audio flow for ${peerId} (attempt ${attempt + 1})`);
      return; // Success — GainNode routing works
    }
  }

  // Silent after all attempts — fall back to direct playback
  analyser.disconnect();
  console.warn(`[Audio] GainNode routing silent for ${peerId} — falling back to direct`);
  audioElement.srcObject = remoteStream;
  // Null out the gainNode so setRemoteVolume knows to use audioElement.volume
  const peerData = this.remotePeers.get(peerId);
  if (peerData) peerData.gainNode = null;
}
```

### 5.3 Volume control

```javascript
setRemoteVolume(peerId, volume) {
  // volume: 0.0 to 3.0 (0% to 300%)
  const peerData = this.remotePeers.get(peerId);
  if (!peerData) return;

  if (peerData.gainNode) {
    // GainNode routing — supports 0–300%
    peerData.gainNode.gain.value = volume;
  } else {
    // Fallback — audioElement.volume only supports 0–1.0
    peerData.audioElement.volume = Math.min(volume, 1.0);
  }
}
```

### 5.4 Stop remote audio

```javascript
stopRemoteAudio(peerId) {
  const peerData = this.remotePeers.get(peerId);
  if (!peerData) return;

  if (peerData.audioElement) {
    peerData.audioElement.pause();
    peerData.audioElement.srcObject = null;
  }

  this.remotePeers.delete(peerId);
  console.log(`[Audio] Stopped remote audio for ${peerId}`);
}
```

### 5.5 Wire up in renderer.js

```javascript
connectionManager.onRemoteStream = (peerId, stream) => {
  audioManager.setupRemoteAudio(peerId, stream);
};

connectionManager.onRemoteStreamRemoved = (peerId) => {
  audioManager.stopRemoteAudio(peerId);
};
```

### 5.6 Output mute

To mute all output (both local monitor and remote audio):

```javascript
// In AudioManager:
setOutputMuted(muted) {
  // Mute local monitor
  if (this.monitorGain) {
    this.monitorGain.gain.value = muted ? 0 : this._savedMonitorVolume || 1.0;
  }
  // Mute all remote peers
  for (const [peerId, peerData] of this.remotePeers) {
    if (peerData.gainNode) {
      peerData.gainNode.gain.value = muted ? 0 : (peerData.savedVolume || 1.0);
    } else if (peerData.audioElement) {
      peerData.audioElement.volume = muted ? 0 : Math.min(peerData.savedVolume || 1.0, 1.0);
    }
  }
}
```

## Verification
- [ ] Connect two instances → both hear each other's voice
- [ ] Per-peer volume slider: 0% = silent, 100% = normal, 200%+ = louder (if GainNode routing works)
- [ ] Console logs show whether GainNode routing or fallback was used for each peer
- [ ] Muting output silences all audio (local + remote)
- [ ] Disconnecting a peer stops their audio cleanly (no residual sound)
- [ ] Switching output device updates remote audio too
- [ ] No console errors
