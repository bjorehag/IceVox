# Step 7: HUMAN CHECKPOINT — FINAL

## STOP — This file requires human verification

Claude Code: You CANNOT complete this step yourself. Notify the user that Phase 5 (the final phase) is complete and human verification is needed.

---

## Checklist for the user

This is the final checkpoint. Test everything end-to-end.

### Video Chat
- [ ] Open "Video" in a 2-person room → video chat window opens
- [ ] Both see each other's camera feed
- [ ] Camera on/off toggle works
- [ ] Camera selection works (if multiple cameras available)
- [ ] Grid and Focus layout toggle works
- [ ] Quality selector works
- [ ] Closing the video window does NOT disconnect audio chat
- [ ] Reopening video reconnects video

### Taskbar Controls (Windows)
- [ ] Hovering over the taskbar icon shows mic/speaker mute buttons
- [ ] Clicking thumbnail buttons toggles mute state in the app
- [ ] System tray icon is visible
- [ ] Right-click tray → context menu appears
- [ ] Mic/Output mute toggles work from tray
- [ ] Per-peer volume control appears when peers are connected
- [ ] "Show App" brings the window to front
- [ ] "Quit" closes the app completely

### Protocol Handler
- [ ] Open `yourprotocol://join/icevox-xxxxx` → app opens/focuses and attempts to join
- [ ] If the app was closed, the protocol URL launches it and joins
- [ ] If the app was open, it focuses and joins without opening a second instance

### Installer
- [ ] `npm run build` → produces installer exe
- [ ] Installer runs and installs the app
- [ ] Installed app starts and works (audio, effects, network)
- [ ] Desktop and Start Menu shortcuts are created
- [ ] AudioWorklet loads correctly in the packaged app (effects work)
- [ ] Icons and themes display correctly in the packaged app

### Full Integration Test
Connect 2-3 instances and verify ALL features together:
- [ ] Voice effects applied and transmitted
- [ ] Text chat works
- [ ] File sharing works
- [ ] Video chat works
- [ ] Host migration works
- [ ] Theme switching works
- [ ] Display names persist
- [ ] Custom preset slots persist

---

## Result

**If everything is OK:** Congratulations — the application is complete! All 5 phases are done.

**If video doesn't work:**
- Check that signals are being relayed through all 4 hops
- Check that RTCSessionDescription is serialized to plain objects before IPC
- Check that ICE candidates are buffered until remote description is set

**If taskbar/tray doesn't work:**
- Check that `createTray()` is called after window creation
- Check that `taskbar-icons.js` generates valid PNG images

**If installer fails:**
- Check that `build/icon.ico` exists
- Check that all source files are listed in the `files` array
- Check that `asarUnpack` includes `audio-worklet-processor.js`

**If protocol handler doesn't work:**
- Check Windows registry for the protocol registration
- In dev mode, check that `app.setAsDefaultProtocolClient` is called with the correct electron path
