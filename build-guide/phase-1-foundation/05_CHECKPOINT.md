# Step 5: HUMAN CHECKPOINT

## STOP — This file requires human verification

Claude Code: You CANNOT complete this step yourself. Notify the user that Phase 1 is complete and human verification is needed.

---

## Checklist for the user

Start the app with `npm start` and check the following:

### Basics
- [ ] The app opens a window without crashing
- [ ] The window has your chosen app title (not "Electron")
- [ ] The background is dark (not white)
- [ ] No default Electron menu bar visible

### Layout
- [ ] You see the chat panel on the left with an empty state placeholder
- [ ] You see the users panel on the right with create/join buttons
- [ ] You see the controls panel at the bottom-left
- [ ] You see the DJ area (presets + sliders) at the bottom-right
- [ ] Dragging the panel divider resizes chat and users panels
- [ ] Dragging the strip divider resizes top and bottom strips

### Basic/Advanced Toggle
- [ ] Basic mode: you see preset buttons but NOT individual effect sliders
- [ ] Click Advanced: effect sliders appear
- [ ] Click Basic again: sliders disappear

### Themes
- [ ] Theme 1 (default): custom icons visible, decorative font
- [ ] Click theme toggle → Theme 2: different colors, different icon set
- [ ] Click again → Minimal: system icons (Phosphor), system font, text-only presets
- [ ] Click again → back to Theme 1
- [ ] Close and reopen the app → the last chosen theme persists

### Resize
- [ ] Make the window larger — layout scales reasonably
- [ ] Make the window smaller — it stops at minimum size, nothing overlaps

### Feel
- [ ] Does it look reasonable? No elements overlapping or missing?
- [ ] Hover effects on buttons?

---

## Result

**If everything is OK:** Phase 1 is complete. Proceed to Phase 2.

**If something doesn't work:** Describe what's wrong to Claude Code, and ask it to fix it before Phase 2.

**If the layout works but looks ugly:** That's OK — visual polish can be refined at any time. Proceed to Phase 2 if the structure is correct.
