# Clear desktop

Electron + React. Captures system audio, transcribes it, spots questions, asks
Gemini, and ships the answer to your phone.

```bash
npm install
npm run dev            # Vite (:5173) + Electron with hot reload
npm run build          # → release/ARA Meeting Assistant Setup.exe
npm run test:pipeline  # 33 checks: WAV, VAD, question detection, Gemini parsing
npm run icons          # regenerate build/icon.png + tray icons
```

## Layout

```
src/
├── audio/
│   ├── AudioCaptureService.js   device list, selection, start/stop
│   ├── FfmpegCapture.js         DirectShow backend (optional)
│   └── wav.js                   WAV encoding, RMS, peak
├── speech/
│   └── SpeechService.js         VAD, segmenting, transcribe(), detectQuestion()
├── gemini/
│   └── GeminiService.js         generateAnswer(), transcribeAudio()
├── websocket/
│   ├── ApiClient.js             REST + token refresh
│   └── SocketClient.js          realtime, heartbeat, offline queue
├── tray/TrayManager.js          system tray, status, quick controls
├── settings/
│   ├── SettingsStore.js         %APPDATA%\Clear\settings.json, DPAPI secrets
│   └── autoLaunch.js            start with Windows
├── core/
│   ├── Pipeline.js              wires the whole flow, owns app state
│   └── logger.js                JSON logs + in-app ring buffer
├── main/
│   ├── index.js                 Electron main, IPC, loopback handler
│   └── preload.js               allow-listed bridge
└── ui/                          React dashboard
    ├── App.jsx                  tabs, state subscription
    ├── capture/captureBridge.js the actual audio engine (renderer side)
    └── components/              status bar, live, pairing, settings, logs
```

## Audio

| Mode | How | When |
|------|-----|------|
| System audio *(default)* | `getDisplayMedia` → Electron returns `audio: 'loopback'` | Meetings. Hears whatever plays on your default output - Bluetooth, USB, speakers |
| Specific device | `getUserMedia({ deviceId })` | A particular mic or Stereo Mix |
| FFmpeg | `ffmpeg -f dshow -i audio="…"` | Pinning one endpoint regardless of the Windows default |

The renderer resamples everything to 16 kHz mono 16-bit PCM before it reaches
the main process.

## Shortcuts

| Keys | Action |
|------|--------|
| `Ctrl+Shift+L` | Start / stop listening (works from any app) |
| `Ctrl+Shift+C` | Show / hide the dashboard |

Closing the window keeps it listening in the tray. Quit from the tray menu.

## Settings

`%APPDATA%\Clear\settings.json`. The Gemini key and refresh token are encrypted
with Windows DPAPI and stored under `_secrets`; everything else is plain JSON
you can edit by hand.

Bootstrap values can also come from the environment (see `.env.example`):
`CLEAR_BACKEND_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`.

## Logs

`%APPDATA%\Clear\logs\clear.log` (rotates at 5 MB), or the **Logs** tab in the
app. `CLEAR_LOG_LEVEL=debug` for more detail.
