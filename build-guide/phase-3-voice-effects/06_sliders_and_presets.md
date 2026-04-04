# Step 6: Sliders and Presets

## Task
Wire UI sliders to effect parameters, implement 10 character presets, and create 3 custom save slots with localStorage persistence.

## Instructions

### 6.1 Create the effect slider configuration

In `renderer.js`, define a mapping from slider element IDs to effect parameters:

```javascript
const effectSliders = {
  'pitch-slider':        { param: 'pitchShift',       min: 0.5, max: 2.0, default: 1.0, display: (v) => `×${v.toFixed(2)}` },
  'tremolo-freq':        { param: 'tremoloFrequency',  min: 0.5, max: 20,  default: 5.0, display: (v) => `${v.toFixed(1)}Hz` },
  'tremolo-intensity':   { param: 'tremoloIntensity',  min: 0,   max: 1.0, default: 0.0, display: (v) => `${(v*100).toFixed(0)}%` },
  'vibrato-freq':        { param: 'vibratoFrequency',  min: 0.5, max: 20,  default: 5.0, display: (v) => `${v.toFixed(1)}Hz` },
  'vibrato-intensity':   { param: 'vibratoIntensity',  min: 0,   max: 1.0, default: 0.0, display: (v) => `${(v*100).toFixed(0)}%` },
  'echo-delay':          { param: 'echoDelay',         min: 0,   max: 1.0, default: 0.0, display: (v) => `${(v*1000).toFixed(0)}ms` },
  'echo-feedback':       { param: 'echoFeedback',      min: 0,   max: 0.85,default: 0.0, display: (v) => `${(v*100).toFixed(0)}%` },
  'distortion-amount':   { param: 'distortionAmount',  min: 0,   max: 1.0, default: 0.0, display: (v) => `${(v*100).toFixed(0)}%` },
  'chorus-depth':        { param: 'chorusDepth',       min: 0,   max: 1.0, default: 0.0, display: (v) => `${(v*100).toFixed(0)}%` },
  'chorus-mix':          { param: 'chorusMix',         min: 0,   max: 1.0, default: 0.0, display: (v) => `${(v*100).toFixed(0)}%` },
  'reverb-decay':        { param: 'reverbDecay',       min: 0,   max: 1.0, default: 0.0, display: (v) => `${(v*100).toFixed(0)}%` },
  'reverb-mix':          { param: 'reverbMix',         min: 0,   max: 1.0, default: 0.0, display: (v) => `${(v*100).toFixed(0)}%` },
  'master-gain':         { param: 'masterGain',        min: 0.5, max: 2.0, default: 1.0, display: (v) => `×${v.toFixed(2)}` },
};
```

### 6.2 Wire sliders to effect parameters

For each slider, attach an `input` listener that sends the value to the AudioManager:

```javascript
let currentParams = { ...DEFAULT_PARAMS }; // Track current state

function initSliders() {
  for (const [sliderId, config] of Object.entries(effectSliders)) {
    const slider = document.getElementById(sliderId);
    if (!slider) continue;

    const valueDisplay = document.getElementById(`${sliderId}-value`);

    slider.addEventListener('input', () => {
      const rawValue = parseFloat(slider.value);
      const value = config.min + (rawValue / 100) * (config.max - config.min);
      currentParams[config.param] = value;

      if (valueDisplay) valueDisplay.textContent = config.display(value);

      audioManager.setEffectParams({ [config.param]: value });

      // If a preset was active and the user manually adjusts a slider, deactivate the preset
      if (activePreset !== null) {
        deactivatePreset();
      }
    });
  }
}
```

### 6.3 Create the pitch slider sync

Basic mode has a standalone pitch slider. It must stay in sync with the Advanced mode pitch slider:

```javascript
const basicPitchSlider = document.getElementById('basic-pitch-slider');
const advancedPitchSlider = document.getElementById('pitch-slider');

function syncPitchSliders(source, target) {
  if (source && target) {
    source.addEventListener('input', () => {
      target.value = source.value;
      target.dispatchEvent(new Event('input'));
    });
  }
}

syncPitchSliders(basicPitchSlider, advancedPitchSlider);
syncPitchSliders(advancedPitchSlider, basicPitchSlider);
```

### 6.4 Create `src/renderer/presets.js`

Define the character presets as an ES module:

```javascript
export const PRESETS = [
  {
    name: 'Human',
    emoji: '🧑',
    description: 'No effects — your natural voice',
    params: {
      pitchShift: 1.0, echoDelay: 0.0, echoFeedback: 0.0,
      tremoloFrequency: 5.0, tremoloIntensity: 0.0,
      vibratoFrequency: 5.0, vibratoIntensity: 0.0,
      distortionAmount: 0.0, chorusDepth: 0.0, chorusMix: 0.0,
      reverbDecay: 0.0, reverbMix: 0.0,
    }
  },
  // Add your character presets here. Each should have:
  // - name: Display name
  // - emoji: Fallback emoji for minimal theme
  // - description: Short description of the voice character
  // - params: Object with all effect parameter values
  //
  // Recommended characters to create (tune the params to taste):
  // - A deep, growling voice (low pitch, slight distortion, reverb)
  // - A light, ethereal voice (high pitch, chorus, reverb)
  // - A mystical/aged voice (slight pitch down, vibrato, heavy reverb)
  // - A menacing/dark voice (low pitch, tremolo, echo, distortion)
  // - A mischievous/nasally voice (high pitch, fast tremolo, some echo)
  // - A ghostly/haunting voice (pitch down, long echo, chorus, reverb)
  // - Additional character voices of your choice
  //
  // Aim for 10 total presets including Human.
  // Tip: Start conservative, then push parameters further.
  // Use masterGain < 1.0 for presets with heavy effects to compensate for gain stacking.
];

export const DEFAULT_PARAMS = {
  pitchShift: 1.0, echoDelay: 0.0, echoFeedback: 0.0,
  tremoloFrequency: 5.0, tremoloIntensity: 0.0,
  vibratoFrequency: 5.0, vibratoIntensity: 0.0,
  distortionAmount: 0.0, chorusDepth: 0.0, chorusMix: 0.0,
  reverbDecay: 0.0, reverbMix: 0.0, masterGain: 1.0,
};
```

### 6.5 Implement preset activation

```javascript
import { PRESETS, DEFAULT_PARAMS } from './presets.js';

let activePreset = null;

function activatePreset(index) {
  const preset = PRESETS[index];
  if (!preset) return;

  if (activePreset === index) {
    // Click active preset = deactivate (return to defaults)
    deactivatePreset();
    return;
  }

  activePreset = index;
  currentParams = { ...preset.params, masterGain: preset.params.masterGain ?? 1.0 };

  // Send all params to audio worklets
  audioManager.setEffectParams(currentParams);

  // Update all slider positions to reflect preset values
  updateSlidersFromParams(currentParams);

  // Update preset button visual states
  updatePresetButtonStates();
}

function deactivatePreset() {
  activePreset = null;
  currentParams = { ...DEFAULT_PARAMS };
  audioManager.setEffectParams(currentParams);
  updateSlidersFromParams(currentParams);
  updatePresetButtonStates();
}

function updateSlidersFromParams(params) {
  for (const [sliderId, config] of Object.entries(effectSliders)) {
    const slider = document.getElementById(sliderId);
    if (!slider) continue;
    const value = params[config.param] ?? config.default;
    const rawValue = ((value - config.min) / (config.max - config.min)) * 100;
    slider.value = rawValue;

    const valueDisplay = document.getElementById(`${sliderId}-value`);
    if (valueDisplay) valueDisplay.textContent = config.display(value);
  }
}

function updatePresetButtonStates() {
  document.querySelectorAll('.preset-btn').forEach((btn, index) => {
    btn.classList.toggle('active', index === activePreset);
  });
}
```

### 6.6 Wire preset buttons

```javascript
document.querySelectorAll('.preset-btn').forEach((btn, index) => {
  btn.addEventListener('click', () => activatePreset(index));
});
```

### 6.7 Implement reset button

```javascript
const resetBtn = document.getElementById('reset-effects');
if (resetBtn) {
  resetBtn.addEventListener('click', deactivatePreset);
}
```

### 6.8 Implement custom save slots

3 save slots stored in localStorage. Each slot can hold a full set of effect parameters.

```javascript
const CUSTOM_SLOTS_KEY = 'custom-presets';

function loadSavedSlots() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_SLOTS_KEY)) || [null, null, null];
  } catch {
    return [null, null, null];
  }
}

function persistSavedSlots(slots) {
  localStorage.setItem(CUSTOM_SLOTS_KEY, JSON.stringify(slots));
}

function initCustomSlots() {
  const slots = loadSavedSlots();

  document.querySelectorAll('.custom-slot-btn').forEach((btn, index) => {
    // Render initial state
    renderSavedSlot(btn, slots[index], index);

    // Left-click: save current params (if empty) or load (if filled)
    btn.addEventListener('click', () => {
      const currentSlots = loadSavedSlots();
      if (currentSlots[index]) {
        // Load
        currentParams = { ...currentSlots[index] };
        audioManager.setEffectParams(currentParams);
        updateSlidersFromParams(currentParams);
        activePreset = null;
        updatePresetButtonStates();
      } else {
        // Save
        currentSlots[index] = { ...currentParams };
        persistSavedSlots(currentSlots);
        renderSavedSlot(btn, currentSlots[index], index);
      }
    });

    // Right-click: clear
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const currentSlots = loadSavedSlots();
      currentSlots[index] = null;
      persistSavedSlots(currentSlots);
      renderSavedSlot(btn, null, index);
    });
  });
}

function renderSavedSlot(btn, data, slotNum) {
  if (data) {
    btn.classList.add('filled');
    btn.title = `Custom ${slotNum + 1} (right-click to clear)`;
    // Update icon to "filled" variant if you have themed save-slot icons
  } else {
    btn.classList.remove('filled');
    btn.title = `Empty — click to save current settings`;
  }
}
```

### 6.9 Initialize everything

In `DOMContentLoaded`:

```javascript
initSliders();
initCustomSlots();
```

## Verification
- [ ] Moving any slider changes the effect in real time
- [ ] Clicking a preset activates it — voice changes to match the character
- [ ] Clicking the active preset deactivates it — voice returns to normal
- [ ] Sliders update to reflect preset values when a preset is activated
- [ ] Manually adjusting a slider while a preset is active deactivates the preset
- [ ] Reset button returns all effects to defaults
- [ ] Basic pitch slider syncs with Advanced pitch slider
- [ ] Custom slot: click empty slot → saves current settings (button changes appearance)
- [ ] Custom slot: click filled slot → loads saved settings
- [ ] Custom slot: right-click filled slot → clears it
- [ ] Custom slots persist across app restarts (localStorage)
- [ ] No console errors
