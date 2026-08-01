# Clear

**AI meeting assistant.** Your Windows PC listens to the meeting, transcribes it,
notices when someone asks a question, gets a short answer from Gemini, and puts
that answer on your phone before the room has finished nodding.

```
speaker audio → desktop app → speech-to-text → Gemini → Socket.IO → phone
```

Three parts, all JavaScript/Dart, no TypeScript anywhere:

| Part | Stack | What it does |
|------|-------|--------------|
| [`desktop/`](desktop/) | Electron · React · Node · Socket.IO | Captures system audio, transcribes, detects questions, calls Gemini, ships answers |
| [`backend/`](backend/) | Node · Express · Socket.IO · Firestore | Auth, device pairing, rooms, realtime relay, history |
| [`mobile/`](mobile/) | Flutter · Riverpod · Socket.IO | Receives answers live, notifications, history, search, dark mode |

---

## What it actually does

**On the desktop**

- Captures **whatever you hear** - Bluetooth headset, USB headset, laptop
  speakers - through WASAPI loopback. No "install a virtual cable" step.
- Chops the stream on silence with an energy-based voice activity detector, so
  only real speech costs you an API call.
- Transcribes each segment with Gemini and detects questions locally
  (interrogatives, tag questions, soft asks like "any thoughts on…").
- Sends the transcript and the answer to the backend, which fans them out to
  every device signed into your account.
- Lives in the system tray, starts with Windows, and can be driven entirely
  from `Ctrl+Shift+L`.

**On the phone**

- Answers arrive in under a second, with a heads-up notification when the app
  is in the background.
- Full history with search, copy and share.
- Dark mode, light mode, or follow the system.

**In between**

- JWT access tokens (15 min) with rotating refresh tokens (30 days, revocable).
- Pairing codes that are single use and expire in five minutes.
- Your Gemini API key never leaves the desktop machine - it is encrypted at
  rest with Windows DPAPI and used only from the desktop process.

---

## Quick start (about 10 minutes)

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env      # works as-is for local development
npm start                 # http://localhost:8080
```

Runs immediately against an in-memory store. Add Firebase when you want data to
survive a restart - see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Verify the whole product flow without a phone or a PC:

```bash
npm run test:smoke        # login → pair → socket → transcript → answer → history
```

### 2. Desktop

```bash
cd desktop
npm install
npm run dev               # Vite + Electron with hot reload
```

Then in the app: sign in (first sign-in creates the account) → **Settings** →
paste your [Gemini API key](https://aistudio.google.com/apikey) → **Live** →
**Start listening**.

Build the installer:

```bash
npm run build             # → release/ARA Meeting Assistant Setup.exe
```

### 3. Mobile

```bash
cd mobile
flutter pub get
flutter run --dart-define=CLEAR_BACKEND_URL=http://10.0.2.2:8080
```

Sign in with the same account → **Pair with desktop** → type the code from the
desktop's **Pair phone** tab.

Build the APK:

```bash
flutter build apk --release --dart-define=CLEAR_BACKEND_URL=https://your-backend
# → build/app/outputs/flutter-apk/app-release.apk
```

Full step-by-step: [docs/INSTALL.md](docs/INSTALL.md) ·
Deploying for real: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) ·
How it fits together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Repository layout

```
Clear/
├── backend/
│   ├── src/
│   │   ├── config/       env, Firebase, in-memory Firestore fallback
│   │   ├── middleware/   auth, validation, error handling
│   │   ├── routes/       /login /pair /answer /history
│   │   ├── services/     tokens, users, devices, meetings
│   │   ├── sockets/      Socket.IO server, presence, heartbeat
│   │   ├── app.js        Express app
│   │   └── server.js     entry point
│   ├── scripts/smoke.js  end-to-end test, no external services
│   ├── firestore.rules   locked down: Admin SDK only
│   └── render.yaml       one-click free deploy
│
├── desktop/
│   ├── src/
│   │   ├── audio/        AudioCaptureService, FFmpeg backend, WAV helpers
│   │   ├── speech/       SpeechService (VAD, transcription, question detection)
│   │   ├── gemini/       GeminiService
│   │   ├── websocket/    ApiClient + SocketClient
│   │   ├── tray/         TrayManager
│   │   ├── settings/     SettingsStore (DPAPI), auto-launch
│   │   ├── core/         Pipeline (the flow), logger
│   │   ├── main/         Electron main process + preload
│   │   └── ui/           React dashboard + renderer capture bridge
│   └── scripts/          icon generator, build wrapper, pipeline checks
│
└── mobile/
    ├── lib/
    │   ├── core/         config, theme, storage, notifications
    │   ├── data/         models, REST client, socket service
    │   ├── state/        Riverpod controllers
    │   └── ui/           pages + widgets
    ├── android/          Gradle project, manifest, signing
    └── tool/             launcher icon generator
```

## Tests

| Where | Command | Covers |
|-------|---------|--------|
| backend | `npm run test:smoke` | 17 checks: auth, refresh rotation, pairing, sockets, fan-out, history, search, authorization |
| desktop | `npm run test:pipeline` | 33 checks: WAV encoding, VAD segmentation, question detection, Gemini parsing |
| mobile | `flutter test` | model parsing, search matching, presence, session |

## Requirements

- Windows 10/11 for the desktop app (WASAPI loopback)
- Node.js 18+
- Flutter 3.27+, Android SDK 34, JDK 17
- A Gemini API key (the free tier is enough)
- Optionally a Firebase project (free Spark plan)
