# Phase 4 — P2P Voice Communication

## Goal
Turn the local voice effect app into a multi-user communication tool. Up to 6 participants connect via WebRTC mesh networking, hearing each other's effect-processed voices in real time. Includes text chat, file sharing, host migration, and password-protected rooms.

## Architecture Rules

These three rules are **non-negotiable**. They were discovered through extensive debugging of Chromium/Electron WebRTC behavior. Do NOT attempt alternative approaches.

> ### Rule 1: Use `replaceTrack()` for sending processed audio
> PeerJS ignores any custom MediaStream you pass to `peer.call()`. It internally uses the raw microphone track. After a call connects, you MUST use `RTCRtpSender.replaceTrack(processedTrack)` to swap in the processed audio from the send path's MediaStreamDestination.

> ### Rule 2: Use `<audio>` elements for remote playback
> `createMediaStreamSource()` on a remote WebRTC stream produces **silence** in Chromium/Electron. Do NOT try to route remote audio through the Web Audio API. Play it directly through an `<audio>` element. For volume control >100%, re-route via: `remoteStream → createMediaStreamSource → GainNode → MediaStreamDestination → <audio>`.

> ### Rule 3: Use `addEventListener()`, never property assignment
> PeerJS internally assigns to `peerConnection.oniceconnectionstatechange`, `peerConnection.onconnectionstatechange`, etc. If you set these properties, PeerJS will overwrite your handler. Always use `peerConnection.addEventListener('iceconnectionstatechange', ...)` instead.

## What the app should do after this phase
- User clicks "Create" → generates a room ID (e.g., `icevox-a4b2k`), becomes host
- Another user enters the room ID and clicks "Join" → connects to the host
- Both hear each other's effect-processed voices in real time
- Up to 6 people can be in a room (1 host + 5 guests)
- All-to-all mesh connectivity (everyone hears everyone)
- Per-peer volume control (0–300%)
- Host migration: if the host disconnects, the next peer auto-becomes host
- Text chat via data channels
- File sharing via drag-and-drop (10 MB max, 32 KB chunks)
- Password-protected rooms (optional)
- Display names, participant list, kick functionality

## Files to work through (in order)
1. `01_peerjs_setup.md` — PeerJS configuration and ConnectionManager skeleton
2. `02_host_and_join.md` — Room creation and joining
3. `03_mesh_network.md` — All-to-all mesh topology
4. `04_sender_side_effects.md` — replaceTrack() and WebRTC event monitoring
5. `05_remote_audio.md` — Playing received audio with volume control
6. `06_host_migration.md` — Automatic host succession
7. `07_text_chat.md` — Data channel messaging
8. `08_file_sharing.md` — P2P file transfer protocol
9. `09_room_ui.md` — Connection panel and participant list UI
10. `10_CHECKPOINT.md` — Human verification

## Rules for Claude Code
- Test with at least 2 instances after every networking step
- Log all PeerJS events with `[PeerJS]` prefix, WebRTC events with `[WebRTC]`, room events with `[Room]`
- The ConnectionManager class must be a clean ES module in `connection.js`
- NEVER access PeerJS internals directly — use the public API + replaceTrack()
- All data channel messages must have a `type` field for routing
