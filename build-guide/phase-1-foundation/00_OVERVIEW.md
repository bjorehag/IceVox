# Phase 1 — Foundation

## Goal
An Electron app that opens a window with the complete UI layout, three switchable themes, and the icon system in place. No functionality — just that the project builds, starts, and shows the correct structure with polished visuals.

## What the app should show after this phase
- A dark window (~960x640) with your app title
- A chat panel (left) with disabled message input and empty state placeholder
- A users/connection panel (right) with create/join buttons and participant area
- A center logo/divider area between the panels
- A controls panel (bottom-left) with placeholder knobs/sliders for mic boost, loopback volume
- A DJ/effects area (bottom-right) with preset buttons and effect sliders (hidden in Basic mode)
- A Basic/Advanced toggle that shows/hides the effect sliders
- Three themes that cycle with a button click
- Custom icons for two themes, system icons for the third (minimal) theme
- Responsive layout — panels resize with the window; narrow window stacks panels vertically

## Files to work through (in order)
1. `01_project_init.md` — Create project and install dependencies
2. `02_electron_main.md` — Electron main process and window configuration
3. `03_ui_structure.md` — HTML/CSS layout with all panels
4. `04_themes_and_icons.md` — Theme system and icon management
5. `05_CHECKPOINT.md` — Human verification

## Rules for Claude Code
- ALWAYS run `npm start` after each step to verify the app still starts
- If something breaks — debug and fix BEFORE moving to the next step
- Create NO files outside the project folder
- Do not commit to git without being told to
