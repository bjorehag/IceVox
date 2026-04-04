# Phase 5 — Video and Packaging

## Goal
Add optional video chat in a separate window, Windows taskbar controls (thumbnail toolbar + system tray), a custom protocol handler for invite deep links, and build the installer.

## What the app should do after this phase
- Click "Video" in a room → a separate video chat window opens
- Video uses native RTCPeerConnection (NOT PeerJS), with adaptive quality
- Camera on/off toggle, camera selection, grid/focus layout
- Windows taskbar: thumbnail toolbar with mic/output mute buttons
- System tray: icon with right-click menu for mic/output mute + per-peer volume
- Custom protocol: `yourapp://join/{roomId}` opens the app and joins the room
- Single-instance lock in production (second launch hands off to first)
- Installer: NSIS for Windows, with desktop/start menu shortcuts

## Files to work through (in order)
1. `01_video_window.md` — Separate BrowserWindow, preload, IPC relay design
2. `02_video_webrtc.md` — Video RTCPeerConnection, camera, quality, layout
3. `03_video_signaling.md` — 4-hop signal relay, glare handling, ICE buffering
4. `04_taskbar_controls.md` — Thumbnail toolbar, system tray, programmatic icons
5. `05_protocol_handler.md` — Custom protocol, single-instance, URL dispatch
6. `06_installer.md` — electron-builder NSIS configuration
7. `07_CHECKPOINT.md` — Human verification

## Rules for Claude Code
- Video window is COMPLETELY independent — it must not crash or block the main window
- All video signals pass through main.js as relay — video window never talks directly to renderer
- Use `[Video]` prefix for all video-related console logs
- Use `[Taskbar]` prefix for taskbar/tray logs
- Use `[Protocol]` prefix for protocol handler logs
