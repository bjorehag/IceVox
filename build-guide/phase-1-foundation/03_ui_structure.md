# Step 3: UI Structure

## Task
Build the complete HTML layout with all panels, modals, and structural elements. This is the visual skeleton that all functionality will be wired into.

## Instructions

### 3.1 Design the layout

The app window is divided into a **top strip** (main content) and a **bottom strip** (controls + effects). Each strip is split into two resizable panels with a draggable divider.

```
┌──────────────────────────────────────────────────┐
│  TOP STRIP                                        │
│  ┌──────────┬─────────┬──────────┐               │
│  │  CHAT    │  LOGO / │  USERS   │               │
│  │  PANEL   │  ABOUT  │  PANEL   │               │
│  │          │         │          │               │
│  └──────────┴─────────┴──────────┘               │
│──────────────── strip divider ───────────────────│
│  BOTTOM STRIP                                     │
│  ┌──────────┬──────────────────────┐             │
│  │ CONTROLS │     DJ AREA          │             │
│  │ (knobs)  │  (presets + sliders) │             │
│  └──────────┴──────────────────────┘             │
└──────────────────────────────────────────────────┘
```

### 3.2 Replace `index.html` with the full layout

Replace the placeholder `index.html` from Step 2 with the complete UI structure. The HTML should include:

**Head section:**
- CSP meta tag (same as Step 2)
- Link to `styles.css`
- Link to Phosphor Icons CDN (for the minimal theme): `https://unpkg.com/@phosphor-icons/web`
- Optionally, a Google Fonts or CDN link for your decorative heading font
- Inline `<script>` that reads theme from localStorage and sets `data-theme` attribute on `<html>` BEFORE render (prevents flash of wrong theme)

**Top strip — Chat panel (left):**
- Chat header with panel title (icon + text)
- Chat messages container (scrollable `div`)
- Empty state placeholder text: "Join a room to chat"
- Chat input area: text input + send button (both disabled initially)
- File drop zone overlay (hidden, shown on drag-over)

**Top strip — Center divider / Logo area:**
- App logo (as `<img data-icon="logo">` for themed icon)
- About button (opens about dialog)
- A draggable divider handle (`panel-divider`) between chat and users panel

**Top strip — Users panel (right):**
- **Connection zone:**
  - Disconnected view: "Create" button, "Join" button + room ID input + password input
  - Waiting view (host, hidden by default): room ID display, invite/lock/video/leave buttons
  - Connected view (hidden by default): room info, role badge, action buttons
- **Participants zone:**
  - Header: participant count + display name input
  - Participant list container (scrollable)
  - Empty state: "No connections"

**Bottom strip — Controls panel (left):**
- Loopback volume knob/slider (0–200%)
- Mic boost knob/slider (0–200%)
- Mute send button
- Device selection icons (microphone + speakers) — each is a clickable icon that reveals a dropdown
- Audio settings button (opens settings modal)
- Theme toggle button

**Bottom strip — DJ area (right):**
- Mode toggle: Basic / Advanced button
- **Basic mode** (visible by default):
  - A single pitch slider (quick access)
  - Preset grid: 10 character preset buttons (each with `<img data-icon="presetname">` for themed icons + `<i class="ph-... slate-icon">` for minimal theme + text label)
  - 3 custom save slot buttons
- **Advanced mode** (hidden by default):
  - Effect panels for each of the 7 effects (Pitch, Echo, Tremolo, Vibrato, Distortion, Chorus, Reverb)
  - Each panel has a label + slider + value display
  - Master gain slider
  - Reset All Effects button

**A draggable strip-divider** between the top and bottom strips.

**Modals (hidden by default):**
- **About dialog**: app name, version (filled dynamically), description, links
- **Audio settings modal**: toggles for Noise Suppression, Echo Cancellation, Auto Gain Control (all default ON)
- **Password modal**: input field + apply button
- **File viewer modal**: content area + save button + close button

### 3.3 Create `src/renderer/styles.css`

Create the main stylesheet with:

**Base layout:**
- `html, body` — full height, no margin, overflow hidden
- Flexbox or grid for the main container
- Top strip and bottom strip with configurable heights
- Panel dividers that are draggable (cursor: col-resize / row-resize)

**Panel styles:**
- Each panel: dark background, rounded corners or beveled edges (your artistic choice)
- Panel headers with title text
- Scrollable content areas with custom scrollbar styling

**Chat panel:**
- Message list with auto-scroll
- Each message: sender name (colored), timestamp, text
- System messages: dimmed, italic
- File cards: inline with preview thumbnails
- Input area: text field + send button

**Users panel:**
- Connection zone with button groups
- Room ID display with copy functionality
- Participant list items: name + volume slider + mute button + status icon

**Controls panel:**
- Vertical layout with labeled controls
- Slider/knob styling

**DJ area:**
- Preset grid (CSS grid or flexbox, wrapping)
- Preset buttons: icon + label, hover effects, active state highlight
- Effect sliders with labeled panels
- Custom save slot buttons with distinct styling

**Responsive behavior:**
- Below ~500px width: panels stack vertically
- Minimum sizes for panels to prevent collapse

**Modal styles:**
- Overlay background (semi-transparent dark)
- Centered modal box with padding and rounded corners
- Close button or click-outside-to-close

### 3.4 Create `src/renderer/renderer.js`

Create a basic renderer script that handles the structural interactions (no audio/network yet):

```javascript
// renderer.js — UI logic

document.addEventListener('DOMContentLoaded', () => {
  // ── Basic / Advanced mode toggle ──
  const modeToggle = document.getElementById('mode-toggle');
  const advancedPanel = document.getElementById('advanced-panel');

  if (modeToggle && advancedPanel) {
    modeToggle.addEventListener('click', () => {
      const isAdvanced = advancedPanel.style.display !== 'none';
      advancedPanel.style.display = isAdvanced ? 'none' : '';
      modeToggle.textContent = isAdvanced ? 'Advanced' : 'Basic';
    });
  }

  // ── Panel divider drag (top strip: chat ↔ users) ──
  setupDividerDrag('panel-divider', 'chat-panel', 'users-panel', 'horizontal');

  // ── Strip divider drag (top strip ↔ bottom strip) ──
  setupDividerDrag('strip-divider', 'top-strip', 'bottom-strip', 'vertical');

  // ── About dialog ──
  const aboutBtn = document.getElementById('about-btn');
  const aboutDialog = document.getElementById('about-dialog');
  if (aboutBtn && aboutDialog) {
    aboutBtn.addEventListener('click', () => {
      aboutDialog.style.display = aboutDialog.style.display === 'none' ? '' : 'none';
    });
  }

  // ── Fill version from Electron ──
  if (window.ipcAPI) {
    window.ipcAPI.getAppVersion().then(v => {
      const el = document.getElementById('app-version');
      if (el) el.textContent = `v${v}`;
    });
  }
});

// ── Divider drag helper ──
function setupDividerDrag(dividerId, panelAId, panelBId, direction) {
  const divider = document.getElementById(dividerId);
  const panelA = document.getElementById(panelAId);
  const panelB = document.getElementById(panelBId);
  if (!divider || !panelA || !panelB) return;

  let isDragging = false;

  divider.addEventListener('mousedown', (e) => {
    isDragging = true;
    e.preventDefault();
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const container = panelA.parentElement;
    const rect = container.getBoundingClientRect();

    if (direction === 'horizontal') {
      const x = e.clientX - rect.left;
      const percent = (x / rect.width) * 100;
      const clamped = Math.max(15, Math.min(85, percent));
      panelA.style.flex = `0 0 ${clamped}%`;
      panelB.style.flex = '1';
    } else {
      const y = e.clientY - rect.top;
      const percent = (y / rect.height) * 100;
      const clamped = Math.max(20, Math.min(80, percent));
      panelA.style.flex = `0 0 ${clamped}%`;
      panelB.style.flex = '1';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}
```

### 3.5 Wire up the scripts in `index.html`

At the bottom of `<body>`:

```html
<!-- PeerJS (global — loaded first, used in Phase 4) -->
<script src="peerjs.min.js"></script>

<!-- App modules -->
<script src="renderer.js" type="module"></script>
```

Note: `renderer.js` is loaded as a module so it can import from `audio.js`, `connection.js`, and `presets.js` later.

## Verification
- [ ] `npm start` opens the app with the full layout visible
- [ ] Chat panel is on the left, users panel on the right
- [ ] Preset buttons are visible in the DJ area
- [ ] Basic/Advanced toggle shows/hides the effect sliders
- [ ] Dragging the panel divider resizes chat and users panels
- [ ] Dragging the strip divider resizes top and bottom strips
- [ ] All modals are hidden by default
- [ ] About button opens the about dialog
- [ ] No console errors
