# Phase 3 — Voice Effects

## Goal
Implement all 7 real-time DSP effects inside the AudioWorklet processor, create the UI sliders for manual control, and wire up character presets with custom save slots.

## What the app should do after this phase
- 7 real-time voice effects: Pitch Shift, Tremolo, Vibrato, Distortion, Chorus, Echo, Reverb
- Basic mode: 10 character presets (click to activate, click again to deactivate) + single pitch slider
- Advanced mode: individual sliders for all effect parameters + reset button
- 3 custom save slots: left-click empty to save, left-click filled to load, right-click to clear
- Effects apply in real time — both to the local monitor (what you hear) and the send path (what WebRTC will transmit)
- Master gain with tanh soft limiting prevents clipping

## Effect Chain Order
```
Input → Pitch Shift → Tremolo → Vibrato → Distortion → Chorus → Echo → Reverb → Master Gain → Output
```

## Files to work through (in order)
1. `01_effect_architecture.md` — Processor class structure, buffers, the process() method
2. `02_pitch_shift.md` — Crossfaded granular synthesis (most complex effect)
3. `03_tremolo_vibrato.md` — Amplitude LFO and pitch LFO effects
4. `04_distortion_chorus.md` — Waveshaper and 3-voice modulated delay
5. `05_echo_reverb.md` — Feedback delay line and Freeverb
6. `06_sliders_and_presets.md` — UI controls, presets, custom save slots
7. `07_CHECKPOINT.md` — Human verification

## Rules for Claude Code
- ALL buffer allocation happens in the constructor — NEVER allocate in `process()` (this blocks the audio thread and causes glitches)
- Test each effect individually with hardcoded values before moving to the next
- After implementing all effects, test with extreme parameter values — no crashes, no NaN, no infinite loops
- The effect chain order MUST be: Pitch → Tremolo → Vibrato → Distortion → Chorus → Echo → Reverb → Master Gain
