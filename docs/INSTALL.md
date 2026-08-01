# Installation

Everything below assumes a fresh machine. Total time: about 15 minutes.

---

## 0. Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 18 or newer | `node -v` |
| npm | 9 or newer | `npm -v` |
| Flutter | 3.27 or newer | `flutter --version` |
| Android SDK | 34 | `flutter doctor` |
| JDK | 17 | `java -version` |

Get a **Gemini API key** at <https://aistudio.google.com/apikey>. The free tier
is enough for normal meeting use.

---

## 1. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Open `.env` and set two secrets (leave the rest for now):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_REFRESH_SECRET
```

Start it:

```bash
npm start
```

```
{"level":"info","msg":"Clear backend listening","port":8080,"db":"memory"}
```

`db: memory` means no Firebase yet - fine for a first run, data resets when the
process restarts. Wiring Firestore is step 5.

Sanity check in another terminal:

```bash
curl http://localhost:8080/health
npm run test:smoke        # 17 checks, exercises the entire product flow
```

---

## 2. Desktop app

```bash
cd desktop
npm install
npm run dev
```

Two processes start: Vite on `:5173` and Electron pointing at it.

Inside the app:

1. **Sign in.** Backend URL `http://localhost:8080`, any email, a password of
   8+ characters. The first sign-in creates the account.
2. **Settings → Gemini → API key.** Paste the key, hit **Save key**, then
   **Test** - you should see `Connected in ~400 ms`.
3. **Live → Start listening.** Windows will ask to share your screen: that
   prompt is how Chromium hands over the system audio loopback. Pick any
   screen and confirm - the video track is dropped immediately, only audio is
   kept.
4. Play a YouTube video with someone asking a question. Within a couple of
   seconds you should see the transcript, the detected question, and an answer.

**Audio sources.** The default *System audio* follows your Windows default
playback device, so it works with a Bluetooth headset, a USB headset or the
laptop speakers with no extra setup. To pin one specific endpoint regardless of
the Windows default, install FFmpeg (`npm i ffmpeg-static` is already an
optional dependency) and pick the DirectShow device from the same dropdown.

### Building the installer

```bash
npm run build
```

Produces `release/ARA Meeting Assistant Setup.exe`.

> **Windows note.** electron-builder unpacks a bundle containing macOS symlinks,
> and creating symlinks on Windows needs a privilege a normal shell does not
> have. `npm run build` detects this and automatically falls back to a build
> that skips the metadata-stamping step - you still get a working installer.
> For a fully stamped binary, turn on **Settings → System → For developers →
> Developer Mode**, or run the build from an Administrator terminal.

The installer is unsigned, so SmartScreen will show "Windows protected your PC"
on first run → **More info** → **Run anyway**. Signing instructions are in
[DEPLOYMENT.md](DEPLOYMENT.md).

---

## 3. Android app

```bash
cd mobile
flutter pub get
```

**Emulator** (`10.0.2.2` is the host machine as seen from inside the emulator):

```bash
flutter run --dart-define=CLEAR_BACKEND_URL=http://10.0.2.2:8080
```

**Physical phone** on the same Wi-Fi - use your PC's LAN address:

```bash
ipconfig                  # find the IPv4 address, e.g. 192.168.1.20
flutter run --dart-define=CLEAR_BACKEND_URL=http://192.168.1.20:8080
```

Plain HTTP to `10.0.2.2`, `localhost` and `192.168.x.x` is allowed by
`android/app/src/main/res/xml/network_security_config.xml`. Everything else
requires HTTPS. You can also change the backend URL at runtime from the login
screen (**Server settings**) or **Settings → Backend URL**.

### Release APK

```bash
node tool/generate_launcher_icons.js      # once, generates the mipmaps
flutter build apk --release --dart-define=CLEAR_BACKEND_URL=https://your-backend
```

Output: `build/app/outputs/flutter-apk/app-release.apk`. Copy it to the phone
and install (allow "install from unknown sources").

---

## 4. Pairing

1. Desktop → **Pair phone** → **Generate pairing code** → a code like `K7QF-2M9X`.
2. Phone → sign in with **the same account** → **Pair with desktop** → type the
   code.
3. The desktop shows the phone under *Connected devices*; the phone's banner
   turns green: *Desktop connected*.

Codes are single use and expire after five minutes.

---

## 5. Firebase (persistence)

Without this, everything works but restarts wipe the data.

1. <https://console.firebase.google.com> → **Add project** (free Spark plan).
2. **Build → Firestore Database → Create database →** production mode.
3. **Project settings → Service accounts → Generate new private key** →
   downloads a JSON file.
4. Encode it and paste into `backend/.env`:

```bash
node -e "console.log(Buffer.from(require('fs').readFileSync('service-account.json')).toString('base64'))"
```

```bash
FIREBASE_SERVICE_ACCOUNT_BASE64=ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIs...
FIREBASE_PROJECT_ID=your-project-id
```

5. Restart. The log line should now read `"db":"firestore"`.

6. Push the rules and indexes (the rules deny all direct client access - only
   the backend's Admin SDK can touch the data):

```bash
npm install -g firebase-tools
firebase login
cd backend
firebase deploy --only firestore:rules,firestore:indexes --project your-project-id
```

Collections created on demand: `users`, `devices`, `meetings`, `transcripts`,
`answers`, plus `refresh_tokens` and `pairing_codes`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Windows did not return a system audio stream" | No active playback device, or the share prompt was cancelled | Play any sound first, then start listening again and accept the prompt |
| Transcript stays empty while audio plays | VAD threshold too high for a quiet source | Settings → Audio → raise **Voice sensitivity** |
| "Add your Gemini API key in Settings" | Key missing or not saved | Settings → Gemini → paste → **Save key** → **Test** |
| Desktop shows *Offline* | Backend not running or wrong URL | Check `curl <backend>/health`, fix Settings → Backend URL |
| Phone connects but sees no answers | Signed into a different account | Both devices must use the same email; re-pair |
| Answers arrive slowly (>3 s) | Using a heavier model | Settings → Gemini → answer model `gemini-2.5-flash` |
| `flutter build apk` fails on desugaring | JDK 17 not selected | `flutter config --jdk-dir "C:\Program Files\Java\jdk-17"` |
| Notifications never appear | Permission not granted (Android 13+) | Settings → toggle notifications off and on to re-prompt |

Desktop logs: **Settings → Open log folder**
(`%APPDATA%\Clear\logs\clear.log`), or the **Logs** tab in the app.
