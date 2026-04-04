# Step 7: HUMAN CHECKPOINT

## STOP — This file requires human verification

Claude Code: You CANNOT complete this step yourself. Notify the user that Phase 3 is complete and human verification is needed.

---

## Checklist for the user

Start the app with `npm start` and test (use headphones!):

### Individual Effects
Test each effect by using the Advanced mode sliders:
- [ ] **Pitch Shift**: Move the slider down → voice sounds deeper. Move up → voice sounds higher. Center (1.0) = normal.
- [ ] **Tremolo**: Increase intensity → hear a pulsing volume. Adjust frequency to change the pulse rate.
- [ ] **Vibrato**: Increase intensity → hear a wobbling pitch. Natural vocal wavering effect.
- [ ] **Distortion**: Increase amount → voice gets warmer/grittier. Should be warm, not harsh.
- [ ] **Chorus**: Increase depth and mix → voice sounds thicker, layered, almost doubled.
- [ ] **Echo**: Increase delay and feedback → hear distinct repeating echoes. Long delay = clear echoes.
- [ ] **Reverb**: Increase decay and mix → voice sounds like it's in a large room or cave.

### Combined Effects
- [ ] Activate multiple effects simultaneously → no crashes, no terrible artifacts
- [ ] Heavy effects (max everything) → sound is distorted but doesn't clip harshly (tanh soft limiting)

### Presets
- [ ] Each of the 10 presets sounds distinct and characterful
- [ ] Clicking an active preset deactivates it (returns to normal voice)
- [ ] Sliders move to reflect the preset values

### Custom Slots
- [ ] Click an empty slot → it saves your current effect settings
- [ ] Click a filled slot → it loads those settings
- [ ] Right-click a filled slot → it clears the slot
- [ ] Close and reopen the app → custom slots are preserved

### Basic / Advanced Modes
- [ ] Basic mode shows preset buttons + pitch slider only
- [ ] Advanced mode shows all individual effect sliders
- [ ] Pitch slider in Basic mode syncs with Pitch slider in Advanced mode

---

## Result

**If everything is OK:** Phase 3 is complete. Proceed to Phase 4.

**If effects sound weird:** Adjust preset parameter values. This is an artistic tuning process — the DSP code is correct if effects respond to parameter changes.

**If there are clicks/pops:** Check that all effect methods handle edge cases (intensity=0, delay=0). Ensure the crossfade in pitch shift is working (listen for smooth transitions).
