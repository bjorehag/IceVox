# Step 1: AudioContext Setup

## Task
Create the AudioManager class with an AudioContext configured for low-latency interactive audio.

## Instructions

### 1.1 Create `src/renderer/audio.js`

Create the AudioManager class as an ES module. It will grow significantly through Phases 2–4.

```javascript
// audio.js — AudioManager class
// Manages the complete audio pipeline: mic → effects → speakers/WebRTC

export class AudioManager {
  constructor() {
    this.audioContext = null;
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized) return;

    // Create AudioContext with optimal settings for real-time voice
    this.audioContext = new AudioContext({
      sampleRate: 48000,       // Standard for WebRTC Opus codec
      latencyHint: 'interactive' // Request lowest latency
    });

    // AudioContext may start in 'suspended' state (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    console.log(`[Audio] Context created: ${this.audioContext.sampleRate}Hz, ` +
                `base latency: ${(this.audioContext.baseLatency * 1000).toFixed(1)}ms, ` +
                `output latency: ${(this.audioContext.outputLatency * 1000).toFixed(1)}ms`);

    this.isInitialized = true;
  }

  async destroy() {
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    this.isInitialized = false;
    console.log('[Audio] Context destroyed');
  }
}
```

### 1.2 Why 48kHz?

The Opus codec (used by WebRTC) natively operates at 48kHz. If our AudioContext uses a different sample rate, Chromium must resample — adding latency and potentially introducing artifacts. Using 48kHz avoids this entirely.

### 1.3 Why `latencyHint: 'interactive'`?

This tells the browser to prioritize low latency over power efficiency. On most systems, this achieves 2–5ms base latency, which is critical for real-time voice monitoring.

### 1.4 Wire up in renderer.js

Import AudioManager in `renderer.js` and create an instance:

```javascript
import { AudioManager } from './audio.js';

const audioManager = new AudioManager();
```

Add initialization to a button click or DOMContentLoaded handler:

```javascript
async function initAudio() {
  try {
    await audioManager.init();
    console.log('[Audio] Initialized successfully');
  } catch (err) {
    console.error('[Audio] Init failed:', err);
  }
}
```

You can trigger this from a UI button ("Start Audio") or auto-init when needed.

## Verification
- [ ] AudioManager class exports correctly from audio.js
- [ ] `audioManager.init()` creates an AudioContext at 48kHz
- [ ] Console shows base latency and output latency values
- [ ] No console errors
- [ ] `npm start` still works
