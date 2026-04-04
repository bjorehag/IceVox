# Build Guide — Instructions for Claude Code

## Before You Begin
Read `PROJECT_CONTEXT.md` in this folder for full project context — what the application is, all technical decisions, architecture diagrams, and known Chromium/Electron limitations.

## Workflow
- Work through the instruction files in `phase-X-name/` in numerical order (01, 02, 03...).
- Each file contains a task with instructions and verification steps.
- Run the verification steps at the end of each file before moving to the next.
- If something breaks — debug and fix BEFORE continuing.
- Stop at files named `XX_CHECKPOINT.md` — these require human verification. Notify the user and wait for OK.

## Architecture Rules (Quick Reference)

These are **non-negotiable**. They are explained in detail in the step files where they apply, but here is the summary:

1. **replaceTrack() for WebRTC audio** — PeerJS ignores custom MediaStream. After `call.on('stream')`, use `RTCRtpSender.replaceTrack(processedTrack)`. *(Phase 4, Step 04)*
2. **`<audio>` element for remote playback** — Do NOT route remote WebRTC audio through Web Audio API. It produces silence in Chromium. *(Phase 4, Step 05)*
3. **addEventListener, not property assignment** — PeerJS overwrites `pc.onX` properties. Always use `pc.addEventListener('iceconnectionstatechange', ...)`. *(Phase 4, Step 04)*
4. **Explicit sample writes in AudioWorklet** — Copy input to temp buffer sample-by-sample so MediaStreamDestination registers the change. *(Phase 3, Step 01)*
5. **ASAR unpack for AudioWorklet** — The worklet processor file must be unpacked from ASAR. Configure `asarUnpack` in electron-builder. *(Phase 2, Step 03)*
6. **Serialize WebRTC objects before IPC** — RTCSessionDescription and RTCIceCandidate cannot cross Electron IPC. Convert to plain objects first. *(Phase 5, Step 03)*

## Console Log Prefixes

Use these prefixes consistently in all `console.log` / `console.warn` / `console.error` calls:

- `[Audio]` — AudioManager, mic, speakers, audio graph
- `[Worklet]` — AudioWorklet processor
- `[PeerJS]` — PeerJS peer events, signaling
- `[WebRTC]` — ICE, connection state, track replacement
- `[Room]` — Room creation, joining, leaving
- `[Mesh]` — Mesh network operations, peer list, initiator
- `[Chat]` — Text messages
- `[File]` — File sharing protocol
- `[Migration]` — Host migration
- `[Video]` — Video window, video WebRTC
- `[Protocol]` — Protocol handler, deep links
- `[Taskbar]` — Tray, thumbnail toolbar

## Code Quality and Architectural Thinking

This is a LARGE project with 5 phases. Every line of code you write today will live on and be built upon in later phases. Consider this with EVERY decision.

**BEFORE implementing a solution — ask yourself:**
1. Will this still work in Phase 5, or only right now?
2. Is this the real solution, or a shortcut that saves time now but requires rewriting later?
3. Does this fit the project's existing architecture, or am I creating a side path?

**ALWAYS do this:**
- Read existing code in relevant files BEFORE writing new code. Understand the architecture.
- Implement solutions that work globally and scale with the project — not local hacks.
- If an instruction says a function should be exposed (e.g., in audio.js or connection.js), do it via the module's public API — not as a local variable in renderer.js.
- If you're unsure about the architecture: read PROJECT_CONTEXT.md BEFORE deciding.
- If a solution requires understanding an external API (PeerJS, Web Audio, WebRTC): read documentation or search for information BEFORE guessing.

**NEVER do this:**
- Implement temporary solutions "for testing" without marking them clearly with `// TODO: temporary`.
- Create local functions that duplicate logic already in a module.
- Hard-code values that should be configurable or dynamic.
- Assume a function works a certain way — verify by reading the code.
- Skip error handling because "it works for now".

## Visual Choices and Placeholders

All visual choices in the instructions (colors, fonts, icon art, theme names, app branding) are **placeholders**. The person following these instructions should customize them to their preference. The instructions describe WHAT each UI element should do and WHERE it goes — not the exact visual appearance.

When you see instructions like "choose a dark color scheme" or "create an icon for this button", make reasonable choices and document them in CSS variables or constants so they're easy to change later.

## Testing Rules
- Run `npm start` after every step to verify the app still starts without errors.
- Use headphones when testing audio to avoid feedback loops.
- For networking phases (4+), test with 2-3 instances on separate machines or using separate PeerJS peer IDs.
- Never assume something works — verify it.

## Rules
- Do not create files outside the project folder.
- Do not make git commits without being told to.
- Do not make independent technical decisions that deviate from PROJECT_CONTEXT.md — ask the user if you're unsure.
- Write code in English (variable names, comments). UI-facing text can be in any language.
