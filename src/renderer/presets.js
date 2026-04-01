// Character presets for IceVox

export const PRESETS = [
  {
    name: 'Human',
    emoji: '🧑',
    description: 'No effects — your natural voice',
    params: {
      pitchShift: 1.0,
      echoDelay: 0.0,
      echoFeedback: 0.0,
      tremoloFrequency: 5.0,
      tremoloIntensity: 0.0,
      vibratoFrequency: 5.0,
      vibratoIntensity: 0.0,
      distortionAmount: 0.0,
      chorusDepth: 0.0,
      chorusMix: 0.0,
      reverbDecay: 0.0,
      reverbMix: 0.0,
    }
  },
  {
    name: 'Orc',
    emoji: '🧌',
    description: 'Deep, earthy, menacing',
    params: {
      pitchShift: 0.75,
      echoDelay: 0.04,
      echoFeedback: 0.06,
      tremoloFrequency: 3.0,
      tremoloIntensity: 0.05,
      vibratoFrequency: 4.0,
      vibratoIntensity: 0.02,
      distortionAmount: 0.01,   // minimal grit — just enough warmth without resonance
      chorusDepth: 0.0,
      chorusMix: 0.0,
      reverbDecay: 0.25,
      reverbMix: 0.15,
    }
  },
  {
    name: 'Elf',
    emoji: '🧝',
    description: 'Light, ethereal, multi-voiced',
    params: {
      pitchShift: 1.18,         // reduced from 1.25 — less metallic artifact
      echoDelay: 0.0,
      echoFeedback: 0.0,
      tremoloFrequency: 6.0,
      tremoloIntensity: 0.03,
      vibratoFrequency: 5.0,
      vibratoIntensity: 0.05,
      distortionAmount: 0.0,
      chorusDepth: 0.5,         // ethereal chorus thickness
      chorusMix: 0.30,
      reverbDecay: 0.40,
      reverbMix: 0.28,
    }
  },
  {
    name: 'Wizard',
    emoji: '🧙',
    description: 'Old, mystical, reverberant',
    params: {
      pitchShift: 0.88,
      echoDelay: 0.0,           // removed echo — was too muddy
      echoFeedback: 0.0,
      tremoloFrequency: 2.0,
      tremoloIntensity: 0.08,
      vibratoFrequency: 3.5,
      vibratoIntensity: 0.14,   // wavering, aged voice
      distortionAmount: 0.0,
      chorusDepth: 0.0,
      chorusMix: 0.0,
      reverbDecay: 0.75,        // long mystical reverb tail
      reverbMix: 0.50,
    }
  },
  {
    name: 'Demon',
    emoji: '👹',
    description: 'Deep, distorted, terrifying',
    params: {
      pitchShift: 0.70,         // deeper than before (was 0.76) — dark, menacing
      echoDelay: 0.100,          // shortened from 0.190 — fewer feedback cycles
      echoFeedback: 0.05,        // reduced from 0.09 — faster decay
      tremoloFrequency: 7.5,
      tremoloIntensity: 0.31,
      vibratoFrequency: 4.0,
      vibratoIntensity: 0.02,
      distortionAmount: 0.02,   // barely there — preserves growl character without resonance buildup
      chorusDepth: 0.70,
      chorusMix: 0.50,          // reduced from 0.75 — fewer doubled frequency peaks
      reverbDecay: 0.40,
      reverbMix: 0.30,          // cave-like presence
      masterGain: 0.65,         // compensates ~5-6dB RMS boost from heavy tanh saturation
    }
  },
  {
    name: 'Goblin',
    emoji: '👺',
    description: 'Nasally, mischievous, gritty',
    params: {
      pitchShift: 1.28,         // reduced from 1.40 — less shrieky
      echoDelay: 0.04,
      echoFeedback: 0.12,
      tremoloFrequency: 8.0,
      tremoloIntensity: 0.10,
      vibratoFrequency: 7.0,
      vibratoIntensity: 0.07,
      distortionAmount: 0.0,    // removed — nasally character comes from pitch+tremolo, not distortion
      chorusDepth: 0.0,
      chorusMix: 0.0,
      reverbDecay: 0.20,
      reverbMix: 0.20,
      masterGain: 1.0,          // no compensation needed with zero distortion
    }
  },
  {
    name: 'Ghost',
    emoji: '👻',
    description: 'Dark, haunting, echoing',
    params: {
      pitchShift: 0.88,         // flipped to NEGATIVE pitch — was 1.10 (siren-like)
      echoDelay: 0.35,
      echoFeedback: 0.35,
      tremoloFrequency: 2.0,
      tremoloIntensity: 0.12,
      vibratoFrequency: 3.0,
      vibratoIntensity: 0.10,
      distortionAmount: 0.0,
      chorusDepth: 0.60,        // multiple ghostly voices
      chorusMix: 0.35,
      reverbDecay: 0.65,
      reverbMix: 0.40,
    }
  },
  {
    name: 'Whisp',
    emoji: '✨',
    description: 'Ethereal, flickering, otherworldly',
    params: {
      pitchShift: 1.20,
      echoDelay: 0.12,
      echoFeedback: 0.15,
      tremoloFrequency: 5.0,
      tremoloIntensity: 0.20,   // rapid flicker
      vibratoFrequency: 4.0,
      vibratoIntensity: 0.08,
      distortionAmount: 0.0,
      chorusDepth: 0.80,        // thick multi-voice shimmer
      chorusMix: 0.50,
      reverbDecay: 0.80,
      reverbMix: 0.55,
    }
  },
  {
    name: 'Siren',
    emoji: '🧜',
    description: 'Shrieking, distorted, multi-voiced',
    params: {
      pitchShift: 1.70,
      echoDelay: 0.0,
      echoFeedback: 0.0,
      tremoloFrequency: 11.5,
      tremoloIntensity: 0.50,
      vibratoFrequency: 5.0,
      vibratoIntensity: 0.0,
      distortionAmount: 0.01,   // trace amount — keeps harmonic edge without feedback issues
      chorusDepth: 0.80,
      chorusMix: 0.35,          // reduced from 0.50 — thinner, less comb-filter resonance
      reverbDecay: 0.80,
      reverbMix: 0.55,
    }
  },
  {
    name: 'Ice Elemental',
    emoji: '❄️',
    description: 'Crystalline, crackling, frozen resonance',
    params: {
      pitchShift: 0.85,         // cold, weighted depth — not as low as Orc/Demon but clearly dark
      echoDelay: 0.050,
      echoFeedback: 0.50,
      tremoloFrequency: 13.3,
      tremoloIntensity: 0.56,
      vibratoFrequency: 10.3,
      vibratoIntensity: 0.51,
      distortionAmount: 0.01,   // minimal — crystalline character from chorus/tremolo, not distortion
      chorusDepth: 0.45,
      chorusMix: 0.80,
      reverbDecay: 0.72,        // deep ice cave
      reverbMix: 0.52,
      masterGain: 0.92,         // slight compensation for remaining chorus/reverb energy
    }
  },
];

export const DEFAULT_PARAMS = {
  pitchShift: 1.0,
  echoDelay: 0.0,
  echoFeedback: 0.0,
  tremoloFrequency: 5.0,
  tremoloIntensity: 0.0,
  vibratoFrequency: 5.0,
  vibratoIntensity: 0.0,
  distortionAmount: 0.0,
  chorusDepth: 0.0,
  chorusMix: 0.0,
  reverbDecay: 0.0,
  reverbMix: 0.0,
  masterGain: 1.0,
};
