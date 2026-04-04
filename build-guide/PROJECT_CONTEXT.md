# Project Context — Voice Chat Application with Real-Time Effects

## What This Project Is

A desktop application for real-time peer-to-peer voice communication with built-in voice effects, designed for gaming and tabletop roleplay. Users can apply character voice presets (e.g., deep orc, ethereal elf, menacing demon) to their microphone in real time and chat with up to 6 people simultaneously — no server required.

The application is built with Electron (Chromium + Node.js), uses the Web Audio API with AudioWorklet for low-latency audio processing, PeerJS for WebRTC signaling, and vanilla JavaScript (no frontend frameworks).

## Core Features

- **Voice Effects** — 7 real-time DSP effects: Pitch Shift, Tremolo, Vibrato, Distortion, Chorus, Echo, Reverb
- **Character Presets** — 10 built-in character voices + 3 user-customizable save slots
- **Basic & Advanced Modes** — Basic mode for quick preset selection; Advanced mode for manual slider control of all effect parameters
- **P2P Voice Chat** — WebRTC mesh network, up to 6 participants, no central server
- **Host Migration** — If the host disconnects, the next peer automatically takes over
- **Text Chat** — In-room messaging via WebRTC data channels
- **File Sharing** — Drag-and-drop P2P file transfer (10 MB max), inline viewers for images/text/markdown
- **Video Chat** — Optional, in a separate window, with adaptive quality
- **Three Themes** — Two custom-icon themes + one system-icon minimal theme
- **Taskbar Controls** — Windows thumbnail toolbar + system tray with per-peer volume
- **Protocol Handler** — Deep links to join rooms via custom URL scheme
- **Loopback Monitoring** — Hear your own voice with effects in real time

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Electron ^28.3.3 |
| UI | HTML5 + CSS3 + Vanilla JavaScript |
| Audio (local) | Web Audio API (AudioWorklet) |
| Audio (peer) | WebRTC peer connections |
| P2P Signaling | PeerJS ^1.5.5 (bundled, loaded as global script) |
| NAT/Firewall | Google STUN + OpenRelay TURN servers |
| Build | electron-builder ^26.8.1 (NSIS installer) |
| Dev | electron-reload ^2.0.0-alpha.1 |
| Icons | Custom .ico files (themed) + Phosphor Icons CDN (minimal theme) |

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Electron | Access to system audio devices, protocol handlers, tray/taskbar |
| Audio processing | AudioWorklet | Low-latency (<20ms), runs on audio thread, no main-thread blocking |
| Effects location | Sender-side | Receiver doesn't need to process — lighter, consistent for all listeners |
| Track delivery | `replaceTrack()` | PeerJS ignores custom MediaStream — must swap track after call setup |
| Remote playback | `<audio>` element | Chromium can't route remote WebRTC audio through Web Audio API |
| Remote volume >100% | GainNode via MediaStreamDestination | Re-route: remoteStream → MediaStreamSource → GainNode → MediaStreamDest → `<audio>` |
| WebRTC events | `addEventListener()` | PeerJS overwrites `pc.onX` properties internally |
| Network topology | Mesh (all-to-all) | Simple, low-latency, no relay server needed (max 6 peers) |
| PeerJS loading | Global `<script>` tag | PeerJS ES module build has issues in Electron; global works reliably |
| Signaling server | Public 0.peerjs.com | Free, sufficient for small-scale use |
| Video chat | Separate BrowserWindow | Independent lifecycle, doesn't block audio if video fails |
| Video WebRTC | Native RTCPeerConnection | PeerJS media is too tightly coupled; native gives full control |
| Video signaling | Relay via data channel | Reuses existing PeerJS data channel infrastructure |
| ASAR | Enabled, unpack worklet | AudioWorklet cannot load from ASAR archive |
| Security | contextIsolation + sandbox | No Node.js access from renderer; all IPC via preload bridge |
| CSP | Meta tag in HTML | Restricts script/connect sources; allows PeerJS WSS + Phosphor CDN |

## Audio Architecture

### Sender (two parallel paths from the same microphone)

```
Microphone [with AGC, noise suppression, echo cancellation]
  │
  ▼
createMediaStreamSource (sourceNode)
  │
  ▼
inputGainNode (Mic Boost: 0–200%, shared by both paths)
  │
  ├──── MONITOR PATH ────────────────────────────────────────────────────
  │     │
  │     ▼
  │   AudioWorkletNode (monitor instance — applies voice effects)
  │     │
  │     ▼
  │   GainNode (Loopback Volume: 0–200%)
  │     │
  │     ▼
  │   DynamicsCompressor (threshold -24dB, ratio 3:1, attack 3ms, release 150ms)
  │     │
  │     ▼
  │   audioContext.destination → Local Speakers
  │
  └──── SEND PATH ───────────────────────────────────────────────────────
        │
        ▼
      AudioWorkletNode (send instance — same effects, separate node)
        │
        ▼
      GainNode (Send Gain: typically 1.0)
        │
        ▼
      DynamicsCompressor (same settings as monitor)
        │
        ▼
      MediaStreamDestination → processedTrack
        │
        ▼
      WebRTC: PeerJS call set up with raw micStream,
              then sender.replaceTrack(processedTrack)
              Opus codec at 128 kbps
```

### Receiver

```
WebRTC remote stream (already has sender's effects applied)
  │
  ├── ATTEMPT: GainNode routing (for 0–300% volume) ──────────────────
  │   remoteStream → createMediaStreamSource → GainNode →
  │   MediaStreamDestination → <audio>.srcObject → speakers
  │   (async verification: if silent after 1.25s, use fallback)
  │
  └── FALLBACK: Direct playback (volume capped at 100%) ──────────────
      remoteStream → <audio>.srcObject → speakers
      (audioElement.volume for 0–100% control only)
```

### Effect Chain Order (inside AudioWorklet)

```
Input → Pitch Shift → Tremolo → Vibrato → Distortion → Chorus → Echo → Reverb → Master Gain (tanh soft limit) → Output
```

## Video Architecture

Video uses a separate Electron BrowserWindow with its own preload script. Signaling is relayed through the main window's existing PeerJS data channel.

```
Video Window ←→ video-preload.js ←→ main.js ←→ preload.js ←→ renderer.js ←→ connection.js data channel ←→ Remote Peer
```

Signal buffering in main.js ensures signals arriving before the video window is ready are queued and delivered after the peer list is sent.

## Known Chromium/Electron Limitations

These are hard-won lessons. **Do not attempt alternative approaches** — they have been tested and they fail silently.

1. **PeerJS ignores custom MediaStream** — When you pass a processed stream to `peer.call()`, PeerJS internally uses the raw microphone track. You MUST use `RTCRtpSender.replaceTrack()` after the call is established to force your processed track.

2. **Remote WebRTC audio cannot route through Web Audio API** — `createMediaStreamSource()` on a remote WebRTC stream produces silence in Chromium/Electron. Remote audio must play directly through an `<audio>` element.

3. **PeerJS overwrites `pc.onX` properties** — PeerJS internally assigns to `peerConnection.oniceconnectionstatechange` etc. If you set these properties, PeerJS will overwrite them. Use `addEventListener()` instead.

4. **MediaStreamDestination needs explicit sample writes** — In the AudioWorklet `process()` method, you must copy input to a temp buffer sample-by-sample and write output sample-by-sample. Without this, `MediaStreamDestination` may not register changes (Chromium optimization behavior).

5. **AudioWorklet cannot load from ASAR** — The worklet processor file must be unpacked from the ASAR archive. Configure `asarUnpack` in electron-builder for this file.

6. **RTCSessionDescription/RTCIceCandidate cannot cross IPC** — Electron's structured clone algorithm doesn't support these WebRTC types. Convert to plain objects (`{ type, sdp }` / `{ candidate, sdpMid, sdpMLineIndex }`) before sending via IPC.

## File Structure (Final)

```
project-root/
├── package.json
├── .gitignore
├── build/
│   └── icon.ico                         ← App icon for installer
├── assets/
│   ├── icons/                           ← Custom .ico files (theme-aware)
│   │   ├── {name}_1.ico                 ← Theme 1 variant
│   │   └── {name}_2.ico                 ← Theme 2 variant
│   └── generated_icons/                 ← Generated .png files (banners, chat symbols)
├── src/
│   ├── main.js                          ← Electron main process
│   ├── preload.js                       ← IPC bridge (main window)
│   ├── video-preload.js                 ← IPC bridge (video window)
│   ├── taskbar-icons.js                 ← Programmatic PNG icon generation
│   ├── renderer/
│   │   ├── index.html                   ← Main UI
│   │   ├── renderer.js                  ← UI logic, event handlers, theme switching
│   │   ├── styles.css                   ← All themes and layout
│   │   ├── audio.js                     ← AudioManager class
│   │   ├── connection.js                ← ConnectionManager class
│   │   ├── audio-worklet-processor.js   ← DSP effects (AudioWorklet)
│   │   ├── presets.js                   ← Character preset definitions
│   │   ├── ice-config.js               ← STUN/TURN server configuration
│   │   └── peerjs.min.js               ← PeerJS library (bundled)
│   └── video/
│       ├── video.html                   ← Video chat window UI
│       ├── video-renderer.js            ← Video WebRTC implementation
│       └── video-styles.css             ← Video window styles
└── dist/                                ← Build output (gitignored)
```

## Icon System

The app supports themed icons. Two "rich" themes use custom `.ico` files; a third minimal theme uses Phosphor system icons from CDN.

**Naming convention**: `{iconname}_1.ico` for Theme 1, `{iconname}_2.ico` for Theme 2.

**HTML markup**: `<img data-icon="iconname" src="assets/icons/iconname_1.ico">` — the `data-icon` attribute is used by `updateIconsForTheme(theme)` to swap icon sources when the user changes theme.

**Minimal theme**: Hides `<img>` icons and shows `<i class="ph-... slate-icon">` elements instead. Uses system-ui font and text-only preset buttons.

**Icon categories** (create your own art for each):
- App logo (themed variants)
- Room action buttons (create, join, leave, copy ID, lock/password, video)
- Audio controls (microphone, speakers, settings)
- Character preset buttons (one per preset)
- Host/guest indicators
- Custom save slot icons (numbered)
- UI elements (chat symbols, banners, placeholders)

## Phase Plan

| Phase | Name | Outcome |
|-------|------|---------|
| 1 | Foundation | Electron window with themed UI layout, icon system, basic/advanced toggle |
| 2 | Audio Pipeline | Microphone passthrough, dual AudioWorklet chain, device management |
| 3 | Voice Effects | 7 DSP effects, 10 presets, 3 custom slots, slider UI |
| 4 | P2P Voice | Mesh network (6 peers), text chat, file sharing, host migration |
| 5 | Video & Packaging | Video chat window, taskbar controls, protocol handler, installer |

## Dependencies

```json
{
  "devDependencies": {
    "electron": "^28.3.3",
    "electron-builder": "^26.8.1",
    "electron-reload": "^2.0.0-alpha.1"
  },
  "dependencies": {
    "peerjs": "^1.5.5"
  }
}
```

Note: PeerJS is installed via npm but loaded in the renderer as a bundled global `<script>` tag (copy `node_modules/peerjs/dist/peerjs.min.js` to `src/renderer/`). This avoids ES module issues in Electron's sandboxed renderer.
