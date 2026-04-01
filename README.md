# IceVox

Real-time voice effects and P2P voice chat for gaming and roleplay.

## Usage

1. Start the app
2. Select your microphone and output in the device selector (🎤 button)
3. Choose a voice preset or adjust sliders in Advanced mode
4. Create a room or join one with a room ID / invite link
5. Talk!

## Features

- **Voice Effects** — Pitch shift, echo, tremolo, vibrato, distortion, chorus, and reverb
- **10 Character Presets + 3 Custom Slots** — Human, Orc, Elf, Wizard, Demon, Goblin, Ghost, Whisp, Siren, Ice Elemental — plus 3 save slots for your own creations
- **P2P Voice Chat** — Up to 6 people, no server required (WebRTC mesh network)
- **Video Chat** — Opt-in video in a separate window with adaptive quality
- **Text Chat & File Sharing** — Built-in messaging and drag-and-drop P2P file sharing (up to 10 MB)
- **Loopback Monitoring** — Hear your own voice with effects applied in real time (100% by default — turn it down before joining a room to avoid echo)
- **Invite Links** — Share a link or Room ID to let friends join your room instantly
- **Flexible Layout** — Resize panels freely; narrow the window for a vertical/banner mode that stacks everything automatically
- **Tray Controls** — Mute mic/output and adjust per-participant volume directly from the system tray icon
- **Three Themes** — Midnight (deep blue-black), Arctic (icy blue-grey), and Slate (clean, minimal)
- **Low Latency** — AudioWorklet-based processing for real-time performance
- **Free & Open Source** — Donation-supported, MIT licensed

## Download

- **Website**: [icevox.net](https://icevox.net)
- **GitHub**: [Latest release](https://github.com/bjorehag/IceVox/releases)

## Build from Source

```bash
git clone https://github.com/bjorehag/IceVox.git
cd IceVox
npm install
npm start
```

## Build Installer

```bash
npm run build
```

## Power Users

### AGC vs. Mic Boost

IceVox has two ways to control microphone level:

- **Auto Gain Control (AGC)** — Enabled by default. Automatically normalizes your mic level. Best for most users, especially with consumer headsets.
- **Mic Boost knob** — Manual gain control (0–200%). If you use a professional audio interface with its own gain staging, you may want to disable AGC in Audio Settings and use the Mic Boost knob instead.

Both can be used together, but for the cleanest signal, pick one or the other.

### Using IceVox as a Voice Modifier in Other Apps

IceVox can act as a real-time voice changer for any application (Discord, games, etc.) by routing its processed audio through a virtual audio cable:

1. **Install [VB-Cable](https://vb-audio.com/Cable/)** (free virtual audio device for Windows)
2. In **IceVox**, select **CABLE Input (VB-Audio Virtual Cable)** as your output device (speaker icon)
3. In your **other app** (Discord, game, etc.), select **CABLE Output (VB-Audio Virtual Cable)** as the microphone input
4. Set IceVox loopback to **0%** (you'll monitor through the other app instead)
5. Apply your desired preset or effects — the other app now hears your modified voice

> **Tip:** Keep IceVox's Mic Boost at 100–125% and adjust input volume in the receiving app if needed.

## Tech Stack

- Electron (Chromium + Node.js)
- Web Audio API with AudioWorklet
- WebRTC for P2P audio and video
- PeerJS for signaling

## Support

If you enjoy IceVox, consider donating for better cat food: [ko-fi.com/icevox](https://ko-fi.com/icevox)

## License

MIT
