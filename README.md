# Clear

**AI meeting assistant.** Your Windows PC listens to the Teams or Meet call,
transcribes it, notices when someone asks a question, gets a short answer from
Gemini, and puts that answer on your phone — wherever your phone happens to be.

```
Teams / Meet audio → Desktop → Gemini → Firestore → Phone
                                            ▲
                        the phone reads from here, on 5G, anywhere
```

**The phone never connects to the PC.** There is no pairing over Wi-Fi, no
hotspot, no cable, no server of your own to run or pay for. Both apps sign into
the same Firebase account and talk only to Google.

| Part | Stack | What it does |
|------|-------|--------------|
| [`desktop/`](desktop/) | Electron · React · Node | Captures system audio, transcribes, detects questions, calls Gemini, writes answers to Firestore |
| [`mobile/`](mobile/) | Flutter · Riverpod · Firebase | Live listener on Firestore: answers, notifications, history, search, dark mode |
| [`firebase/`](firebase/) | Firestore | Auth + database. Free Spark plan, no credit card |

---

## What it actually does

**On the desktop**

- Captures **whatever you hear** — Bluetooth headset, USB headset, laptop
  speakers — through WASAPI loopback. No virtual audio cable to install.
- Chops the stream on silence with an energy-based voice activity detector, so
  only real speech costs an API call.
- Transcribes each segment with Gemini and detects questions *locally*
  (interrogatives, tag questions, soft asks like "any thoughts on…").
- Writes the answer to your private Firestore collection.
- Lives in the system tray, starts with Windows, driven by `Ctrl+Shift+L`.

**On the phone**

- Answers appear in about a second, from a live Firestore listener.
- Heads-up notification when the app is in the background.
- Full history with search, copy and share. Dark, light or system theme.
- Works on mobile data, on hotel Wi-Fi, on another continent.

**Security**

- Firebase Auth email/password. Same account on both devices = same data.
- Firestore rules restrict every document to its owner; nothing is readable
  anonymously.
- Your **Gemini API key never leaves the desktop** — encrypted at rest with
  Windows DPAPI and used only from the desktop process.

---

## Setup (about 15 minutes, all free)

### 1. Firebase — one project, no card

1. <https://console.firebase.google.com> → **Add project** (disable Analytics)
2. **Build → Authentication → Get started → Email/Password → Enable**
3. **Build → Firestore Database → Create database → Production mode**
4. **Project settings → General → Your apps → Web (`</>`)** → register → copy
   the `apiKey` and `projectId`
5. Same page → **Add app → Android**, package name `app.clear.mobile` →
   download `google-services.json` → save to `mobile/android/app/`
6. Publish the rules:

```bash
npm install -g firebase-tools
firebase login
cd firebase && firebase deploy --only firestore --project your-project-id
```

### 2. Desktop

```bash
cd desktop
npm install
npm run dev              # or install the built .exe
```

Sign in with the `apiKey` + `projectId` from step 4 and any email/password —
the first sign-in creates the account. Then **Settings → Gemini → API key**
(free at <https://aistudio.google.com/apikey>) → **Test**.

Build the installer:

```bash
npm run build            # → release/ARA Meeting Assistant Setup.exe
```

### 3. Mobile

```bash
cd mobile
flutter pub get
flutter build apk --release
# → build/app/outputs/flutter-apk/app-release.apk
```

Install it, sign in with **the same email and password**. That's the entire
pairing process.

Full walkthrough: [docs/INSTALL.md](docs/INSTALL.md) ·
How it fits together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
Shipping it: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## Repository layout

```
Clear/
├── desktop/
│   ├── src/
│   │   ├── audio/        AudioCaptureService, FFmpeg backend, WAV helpers
│   │   ├── speech/       SpeechService (VAD, transcription, question detection)
│   │   ├── gemini/       GeminiService
│   │   ├── firebase/     Auth + Firestore REST, FirestoreSync
│   │   ├── tray/         TrayManager
│   │   ├── settings/     SettingsStore (DPAPI), auto-launch
│   │   ├── core/         Pipeline (the flow), logger
│   │   ├── main/         Electron main process + preload
│   │   └── ui/           React dashboard + renderer capture bridge
│   └── scripts/          icon generator, build wrapper, pipeline checks
│
├── mobile/
│   ├── lib/
│   │   ├── core/         config, theme, storage, notifications
│   │   ├── data/         models + FirebaseService (auth, streams, presence)
│   │   ├── state/        Riverpod controllers
│   │   └── ui/           pages + widgets
│   ├── android/          Gradle project, manifest, signing
│   └── tool/             launcher icon generator
│
└── firebase/             firestore.rules, indexes, firebase.json
```

## Tests

| Where | Command | Covers |
|-------|---------|--------|
| desktop | `npm run test:pipeline` | 33 checks: WAV encoding, VAD segmentation, question detection, Gemini parsing |
| mobile | `flutter test` | 11 checks: document parsing, search, presence, device staleness |

## Requirements

- Windows 10/11 for the desktop app (WASAPI loopback)
- Node.js 18+
- Flutter 3.27+, Android SDK, JDK 17
- A Gemini API key and a Firebase project — both free
