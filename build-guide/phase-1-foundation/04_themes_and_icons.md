# Step 4: Themes and Icons

## Task
Implement three switchable themes and the icon system that swaps icons per theme. Two themes use custom `.ico` files; one minimal theme uses Phosphor system icons.

## Instructions

### 4.1 Theme architecture

Themes are controlled by a `data-theme` attribute on the `<html>` element. CSS variables change per theme, and the JavaScript icon-swap function updates `<img>` sources.

**Three themes:**
1. **Theme 1** (default) — Your primary dark theme with custom icons. Uses a decorative font for headings.
2. **Theme 2** — An alternate dark theme with different color accents and its own icon variants. Same decorative font.
3. **Minimal theme** — A clean, minimal theme. Uses Phosphor system icons (CDN), `system-ui` font, flat panel styling, text-only preset buttons (no icon images), smaller logo.

### 4.2 Inline theme initialization

In the `<head>` of `index.html`, add this inline script BEFORE any stylesheet links. This prevents a flash of the wrong theme on startup:

```html
<script>
  (function() {
    const saved = localStorage.getItem('app-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    else document.documentElement.setAttribute('data-theme', 'theme1');
  })();
</script>
```

### 4.3 CSS theme variables

In `styles.css`, define CSS variables per theme using attribute selectors:

```css
/* ── Theme 1 (Default) ── */
[data-theme="theme1"] {
  --bg-primary: /* your dark background */;
  --bg-panel: /* slightly lighter panel background */;
  --bg-panel-hover: /* panel hover/active state */;
  --text-main: /* primary text color */;
  --text-dim: /* dimmed/secondary text */;
  --text-bright: /* bright/highlighted text */;
  --accent: /* primary accent color */;
  --accent-hover: /* accent hover state */;
  --danger: /* red for errors/disconnect */;
  --success: /* green for connected/active */;
  --font-heading: 'YourDecorativeFont', serif;
  --font-ui: system-ui, -apple-system, sans-serif;
  /* Add more variables as needed: borders, shadows, etc. */
}

/* ── Theme 2 ── */
[data-theme="theme2"] {
  --bg-primary: /* different dark shade */;
  --bg-panel: /* ... */;
  /* ... same variables, different values */
  --font-heading: 'YourDecorativeFont', serif;
  --font-ui: system-ui, -apple-system, sans-serif;
}

/* ── Minimal theme ── */
[data-theme="minimal"] {
  --bg-primary: /* neutral dark gray */;
  --bg-panel: /* ... */;
  /* ... flatter, more muted colors */
  --font-heading: system-ui, -apple-system, sans-serif;
  --font-ui: system-ui, -apple-system, sans-serif;
}
```

All other styles reference these variables: `color: var(--text-main)`, `background: var(--bg-panel)`, etc.

### 4.4 Minimal theme overrides

The minimal theme has specific CSS overrides:

```css
/* Hide custom icons, show system icons */
[data-theme="minimal"] .themed-icon {
  display: none !important;
}
[data-theme="minimal"] .slate-icon {
  display: inline-block !important;
}

/* Default: show custom icons, hide system icons */
.slate-icon {
  display: none !important;
}
.themed-icon {
  display: inline-block;
}

/* Minimal theme: text-only presets (no icon images) */
[data-theme="minimal"] .preset-icon-img {
  display: none;
}

/* Minimal theme: smaller logo */
[data-theme="minimal"] .logo-img {
  transform: scale(0.5);
}

/* Minimal theme: flat panels (no texture/gradient) */
[data-theme="minimal"] .panel {
  background: var(--bg-panel);
  border: 1px solid var(--text-dim);
  box-shadow: none;
}
```

### 4.5 Icon HTML pattern

Every icon in the HTML follows this dual pattern — a custom `<img>` for the themed versions, and a Phosphor `<i>` for the minimal theme:

```html
<!-- Example: Create Room button -->
<button id="create-room-btn" class="action-btn">
  <img data-icon="create_room" src="../../assets/icons/create_room_1.ico" class="themed-icon action-icon">
  <i class="ph ph-plus-circle slate-icon"></i>
  <span>Create</span>
</button>

<!-- Example: Preset button -->
<button class="preset-btn" data-preset="orc">
  <img data-icon="orc" src="../../assets/icons/orc_1.ico" class="themed-icon preset-icon-img">
  <i class="ph ph-skull slate-icon"></i>
  <span>Orc</span>
</button>
```

The `data-icon` attribute stores the icon name. The `src` defaults to Theme 1. The `slate-icon` elements use Phosphor icon classes.

### 4.6 Implement `updateIconsForTheme()` in `renderer.js`

This function runs whenever the theme changes. It updates all `<img>` elements that have a `data-icon` attribute:

```javascript
function updateIconsForTheme(theme) {
  // Map theme name to icon suffix
  const iconSuffix = theme === 'theme2' ? '2' : '1';

  // Update all .ico icons
  document.querySelectorAll('img[data-icon]').forEach(img => {
    const iconName = img.getAttribute('data-icon');
    if (iconName) {
      img.src = `../../assets/icons/${iconName}_${iconSuffix}.ico`;
    }
  });

  // Update all .png icons (if you have generated_icons with theme variants)
  document.querySelectorAll('img[data-icon-png]').forEach(img => {
    const iconName = img.getAttribute('data-icon-png');
    if (iconName) {
      img.src = `../../assets/generated_icons/${iconName}_${iconSuffix}.png`;
    }
  });
}
```

### 4.7 Implement theme rotation

Add a theme toggle function that cycles through the three themes:

```javascript
const THEMES = ['theme1', 'theme2', 'minimal'];

function cycleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'theme1';
  const currentIndex = THEMES.indexOf(current);
  const next = THEMES[(currentIndex + 1) % THEMES.length];

  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('app-theme', next);
  updateIconsForTheme(next);
}
```

Wire this to the theme toggle button:

```javascript
const themeBtn = document.getElementById('theme-toggle');
if (themeBtn) {
  themeBtn.addEventListener('click', cycleTheme);
}
```

### 4.8 Set theme on load

When the page loads (in `DOMContentLoaded`), apply the saved theme's icons:

```javascript
const savedTheme = document.documentElement.getAttribute('data-theme') || 'theme1';
updateIconsForTheme(savedTheme);
```

### 4.9 Create your icon files

Create `.ico` files in `assets/icons/` following the naming convention:

- `{iconname}_1.ico` — Theme 1 variant
- `{iconname}_2.ico` — Theme 2 variant

**Minimum icon set needed:**
- `logo_1.ico` / `logo_2.ico` — App logo
- `create_room_1.ico` / `create_room_2.ico` — Create room button
- `join_room_1.ico` / `join_room_2.ico` — Join room button
- `microphone_1.ico` / `microphone_2.ico` — Mic device selector
- `speakers_1.ico` / `speakers_2.ico` — Speaker device selector
- One icon per character preset (e.g., `orc_1.ico`, `orc_2.ico`, etc.)

If you don't have custom art yet, create simple colored placeholder icons. The icon system must work end-to-end; you can replace the art later.

### 4.10 Create generated PNG icons (optional)

If your design uses PNG images for things like chat panel titles, host/guest banners, or decorative elements, place them in `assets/generated_icons/`. Use the same `_1` / `_2` suffix convention and `data-icon-png` attribute.

## Verification
- [ ] Theme 1 loads by default on first launch
- [ ] Clicking the theme toggle cycles: Theme 1 → Theme 2 → Minimal → Theme 1
- [ ] Theme 1 and 2 show custom `.ico` icons; Minimal shows Phosphor icons
- [ ] Theme preference persists across app restarts (saved in localStorage)
- [ ] No flash of wrong theme on startup (inline script applies before render)
- [ ] Minimal theme: preset buttons show text only (no icon images)
- [ ] Minimal theme: uses system-ui font instead of decorative font
- [ ] All icon images load without 404 errors (check DevTools network tab)
- [ ] No console errors
