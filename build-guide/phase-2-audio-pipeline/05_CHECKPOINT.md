# Step 5: HUMAN CHECKPOINT

## STOP — This file requires human verification

Claude Code: You CANNOT complete this step yourself. Notify the user that Phase 2 is complete and human verification is needed.

---

## Checklist for the user

Start the app with `npm start` and test the following (use headphones!):

### Audio Passthrough
- [ ] Init audio → you hear your own voice through headphones
- [ ] The sound is clear, no distortion or artifacts
- [ ] Latency feels minimal (near-instant, <20ms)

### Volume Controls
- [ ] Loopback volume slider: 0% = silent, 100% = normal, 200% = noticeably louder
- [ ] Mic boost slider: changing it affects how loud your voice is

### Device Selection
- [ ] Mic dropdown lists your available microphones
- [ ] Speaker dropdown lists your available outputs
- [ ] Switching mic changes the input source
- [ ] Switching speaker changes where audio plays

### Audio Settings
- [ ] Audio settings modal opens
- [ ] Toggling a setting and applying briefly interrupts audio, then it returns
- [ ] All three toggles (AGC, Noise Suppression, Echo Cancellation) work

### Mute
- [ ] Mic mute stops your voice from being heard

---

## Result

**If everything is OK:** Phase 2 is complete. Proceed to Phase 3.

**If audio doesn't work at all:** Check the browser console for errors. Common issues:
- Microphone permission denied → grant permission in system settings
- AudioContext suspended → ensure init is triggered by a user interaction (click)
- "Failed to load AudioWorklet" → check the worklet file path and CSP `worker-src` directive

**If there's echo/feedback:** Make sure you're using headphones. Loopback + speakers = feedback loop.
