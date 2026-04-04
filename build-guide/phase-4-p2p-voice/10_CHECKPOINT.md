# Step 10: HUMAN CHECKPOINT

## STOP — This file requires human verification

Claude Code: You CANNOT complete this step yourself. Notify the user that Phase 4 is complete and human verification is needed.

---

## Checklist for the user

Test with **at least 2 instances** (ideally 3) on separate machines or using separate user profiles. Use headphones!

### Voice Chat
- [ ] Both instances hear each other's voice
- [ ] Voice effects are applied — change a preset on one instance, the other hears the effect
- [ ] Audio quality is good (no robotic artifacts, no excessive latency)

### Mesh Network (test with 3 instances)
- [ ] All three can hear each other
- [ ] Participant list shows all peers on every instance
- [ ] Per-peer volume sliders work independently

### Host Migration
- [ ] Close the host instance → one of the remaining peers becomes host
- [ ] Remaining peers can still hear each other
- [ ] A new peer can join the migrated room

### Text Chat
- [ ] Send a message → appears on all other instances
- [ ] System messages show for join/leave events
- [ ] Display names appear correctly

### File Sharing
- [ ] Drag a file onto chat → file card appears on other instances
- [ ] Click "Download" on another instance → file transfers correctly
- [ ] Images show inline preview

### Password Protection
- [ ] Host sets a password → joining with wrong password fails
- [ ] Joining with correct password succeeds

### Room Management
- [ ] Leave button disconnects cleanly
- [ ] Host can kick a peer
- [ ] Invite link copies to clipboard

---

## Result

**If everything is OK:** Phase 4 is complete. Proceed to Phase 5.

**If voice doesn't work:** Check console for `[WebRTC]` and `[PeerJS]` errors. Common issues:
- "replaceTrack" not called → check `_replaceWithProcessedTrack()` is called in `_setupCallHandlers`
- No audio → check that `<audio>` elements are created and `autoplay` is set
- One-way audio → both sides need to `replaceTrack()`

**If mesh doesn't form:** Check initiator rule logic. The peer with the lower ID should initiate.

**If host migration fails:** Check `leaveRoom()` clears state BEFORE closing connections.
