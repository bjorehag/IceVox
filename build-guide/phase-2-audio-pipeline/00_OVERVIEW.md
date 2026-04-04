# Phase 2 — Audio Pipeline

## Goal
Set up the complete Web Audio API graph with microphone input, dual AudioWorklet chains (monitor + send), DynamicsCompressor on both paths, and device enumeration/switching. After this phase, the user hears their own voice through the app and has a processed send stream ready for WebRTC.

## Why this phase matters
The audio pipeline is the foundation for everything that follows. Voice effects (Phase 3) plug into the AudioWorklet nodes. P2P voice chat (Phase 4) uses the send path's MediaStreamDestination. Getting the graph architecture right now prevents painful rewiring later.

## What the app should do after this phase
- Click a "Start Audio" button (or auto-init) → microphone access is requested
- You hear your own voice through your speakers/headphones (passthrough)
- Loopback volume slider controls how loud you hear yourself (0–200%)
- Mic boost slider controls input gain before processing (0–200%)
- You can select a different microphone or speaker from dropdowns
- Audio settings modal lets you toggle AGC, noise suppression, echo cancellation
- The send path captures processed audio into a MediaStream (no effects yet — passthrough)

## Files to work through (in order)
1. `01_audio_context.md` — Create AudioContext and understand latency
2. `02_microphone_passthrough.md` — Capture microphone and play through speakers
3. `03_dual_worklet_chain.md` — The full audio graph with two worklet nodes
4. `04_device_management.md` — Enumerate and switch audio devices
5. `05_CHECKPOINT.md` — Human verification

## Rules for Claude Code
- ALWAYS run `npm start` and test audio after each step
- Use headphones to avoid feedback loops during testing
- Log all audio operations with `[Audio]` prefix
- The AudioManager class in `audio.js` must be a clean ES module — expose public methods, keep internals private
- The dual worklet chain MUST exist from Step 3 onward, even though effects aren't implemented until Phase 3
