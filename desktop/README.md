# Clear desktop

Electron + React. Captures system audio, transcribes it, spots questions, asks
Gemini, and writes the answer to Firestore where your phone picks it up.

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
├── firebase/
│   ├── FirebaseAuth.js          sign-in + token refresh over REST
│   ├── FirestoreClient.js       typed-JSON REST reads and writes
│   ├── FirestoreSync.js         publishes answers, heartbeat, presence, queue
│   └── firestoreValues.js       JS ↔ Firestore value encoding
├── tray/TrayManager.js          system tray, status, quick controls
├── settings/
│   ├── SettingsStore.js         %APPDATA%\Clear\settings.json, DPAPI secrets
│   └── autoLaunch.js            start with Windows
├── core/
│   ├── Pipeline.js              wires the whole flow, owns app state
│   ├── logger.js                JSON logs + in-app ring buffer
│   └── ids.js
├── main/
│   ├── index.js                 Electron main, IPC, loopback handler
│   └── preload.js               allow-listed bridge
└── ui/                          React dashboard
    ├── App.jsx                  tabs, state subscription
    ├── capture/captureBridge.js the actual audio engine (renderer side)
    └── components/              status bar, live, phone, settings, logs
```

## Why REST instead of the Firebase SDK

The official JS SDK expects a browser — IndexedDB for auth persistence,
WebChannel for transport — and adds roughly a megabyte to the main process. The
desktop only ever *writes*, so sign-in, refresh and document writes are three
plain HTTPS calls with no dependency. The phone uses the real native SDK, where
realtime listeners and offline caching actually matter.

The desktop authenticates as the signed-in user, so the Firestore rules apply to
it exactly as they do to the phone — there is no elevated service account
anywhere in this app.

## Audio

| Mode | How | When |
|------|-----|------|
| System audio *(default)* | `getDisplayMedia` → Electron returns `audio: 'loopback'` | Meetings. Hears whatever plays on your default output — Bluetooth, USB, speakers |
| Specific device | `getUserMedia({ deviceId })` | A particular mic or Stereo Mix |
| FFmpeg | `ffmpeg -f dshow -i audio="…"` | Pinning one endpoint regardless of the Windows default |

The renderer resamples everything to 16 kHz mono 16-bit PCM before it reaches
the main process.

## Shortcuts

| Keys | Action |
|------|--------|
| `Ctrl+Shift+L` | Start / stop listening (works from any app) |
| `Ctrl+Shift+C` | Show / hide the dashboard |

Minimise behaves normally. **Closing** the window sends it to the tray so
capture keeps running; quit from the tray menu.

## Settings

`%APPDATA%\Clear\settings.json`. The Gemini key and the Firebase refresh token
are encrypted with Windows DPAPI under `_secrets`; everything else is plain JSON
you can edit by hand.

Bootstrap values can also come from the environment — see `.env.example`.

## Logs

`%APPDATA%\Clear\logs\clear.log` (rotates at 5 MB), or the **Logs** tab in the
app. `CLEAR_LOG_LEVEL=debug` for more detail, `CLEAR_DEVTOOLS=1` to open
DevTools on launch.
