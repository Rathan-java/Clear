# Installation

From nothing to a working setup in about 15 minutes. Everything here is free.

---

## 0. Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 18 or newer | `node -v` |
| Flutter | 3.27 or newer | `flutter --version` |
| Android SDK | 34+ | `flutter doctor` |
| JDK | 17 | `java -version` |

You also need two free API accounts:

- **Gemini API key** — <https://aistudio.google.com/apikey>
- **Firebase project** — <https://console.firebase.google.com> (Spark plan, no
  credit card)

---

## 1. Firebase — the only "server"

This replaces all self-hosting. Your phone and PC both talk to Google, never to
each other.

### 1.1 Create the project

1. <https://console.firebase.google.com> → **Add project**
2. Name it (e.g. `clear-meeting-assistant`), disable Google Analytics, create.

### 1.2 Turn on email sign-in

**Build → Authentication → Get started → Email/Password → Enable → Save**

Nothing else. No sign-in providers, no templates.

### 1.3 Create the database

**Build → Firestore Database → Create database**

- Location: whichever region is nearest you
- Mode: **Production** (the rules you deploy below replace the defaults)

### 1.4 Get the desktop config

**⚙ Project settings → General → Your apps → Web (`</>`)**

- Nickname `Clear desktop`, do **not** tick Firebase Hosting → Register
- From the snippet, copy two values:

```js
apiKey: "AIzaSy........................"     ← Firebase API key
projectId: "clear-meeting-assistant"          ← Firebase project ID
```

Neither is a secret. They identify the project; they grant nothing on their
own. Access is controlled by Authentication plus the rules in the next step.

### 1.5 Get the Android config

Same page → **Add app → Android**

- Package name: **`app.clear.mobile`** (must match exactly)
- Download **`google-services.json`**
- Save it to **`mobile/android/app/google-services.json`**

### 1.6 Publish the security rules

Without this, Firestore denies everything and the apps show a permission error.

```bash
npm install -g firebase-tools
firebase login
cd firebase
firebase deploy --only firestore --project your-project-id
```

The rules ([`firebase/firestore.rules`](../firebase/firestore.rules)) allow each
signed-in user to touch documents under their own `users/{uid}` and nothing
else.

---

## 2. Desktop app

```bash
cd desktop
npm install
npm run dev
```

In the app:

1. **First screen** asks for the Firebase **API key** and **project ID** from
   step 1.4, plus an email and password. Any email works — the first sign-in
   creates the account. Use something you will remember: you type the same
   details on the phone.
2. **Settings → Gemini → API key** → paste your key → **Save key** → **Test**.
   You want `Connected in ~400 ms`.
3. **Live → Start listening.** Windows asks you to share a screen — **that
   prompt is how Chromium hands over system audio.** Pick any screen and
   confirm; the video track is dropped immediately and only audio is kept.
4. Play a YouTube interview. Transcript fills in, the question is highlighted,
   and an answer appears.

**Audio sources.** The default *System audio* follows your Windows default
playback device, so it works with a Bluetooth headset, a USB headset or the
laptop speakers with no extra setup. To pin one specific endpoint regardless of
the Windows default, install FFmpeg and pick the DirectShow device from the
same dropdown.

### Building the installer

```bash
npm run build            # → release/ARA Meeting Assistant Setup.exe
```

> **Windows note.** electron-builder unpacks a bundle containing macOS symlinks,
> and creating symlinks on Windows needs a privilege a normal shell lacks.
> `npm run build` detects this and falls back to a build that skips metadata
> stamping — you still get a working installer. For a fully stamped binary,
> enable **Settings → System → For developers → Developer Mode**, or build from
> an Administrator terminal.

The installer is unsigned, so SmartScreen shows "Windows protected your PC" on
first run → **More info** → **Run anyway**.

---

## 3. Android app

Make sure `mobile/android/app/google-services.json` exists (step 1.5) — the
build fails without it.

```bash
cd mobile
flutter pub get
node tool/generate_launcher_icons.js     # once
flutter build apk --release
```

Output: `build/app/outputs/flutter-apk/app-release.apk`. Copy it to the phone
and install (allow "install from unknown sources").

To run against a plugged-in phone with hot reload instead:

```bash
flutter run
```

There is **no backend URL to configure** and no pairing screen. Sign in with the
same email and password as the desktop and you are done.

---

## 4. Check it end to end

1. Desktop → **Live → Start listening**
2. Phone → open the app → banner reads **Desktop is listening**
3. Play a question out loud or on video
4. The answer appears on the phone in about a second

Turn the phone's Wi-Fi off and repeat on mobile data — it still works. That is
the point of the design.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Phone: *permission-denied* | Rules not deployed | `cd firebase && firebase deploy --only firestore` |
| Phone: stuck on splash | `google-services.json` missing or wrong package | Re-download for package `app.clear.mobile` into `mobile/android/app/` |
| Desktop: "Email/password sign-in is not enabled" | Step 1.2 skipped | Enable it in Authentication |
| Desktop: "That Firebase API key is not valid" | Wrong key pasted | Recopy from Project settings → General |
| Phone shows *Desktop app is not running* | Desktop signed out, or a different account | Check the email matches exactly on both |
| "Windows did not return a system audio stream" | No active playback device, or the share prompt was cancelled | Play any sound first, start listening again, accept the prompt |
| Transcript stays empty while audio plays | VAD threshold too high for a quiet source | Settings → Audio → raise **Voice sensitivity** |
| "Add your Gemini API key in Settings" | Key missing | Settings → Gemini → paste → **Save key** → **Test** |
| Answers slower than ~3 s | Heavier model selected | Settings → Gemini → use `gemini-2.5-flash` |
| `flutter build apk` fails on desugaring | JDK 17 not selected | `flutter config --jdk-dir "C:\Program Files\Java\jdk-17"` |
| No notifications | Permission not granted (Android 13+) | Settings → toggle notifications off and on |

Desktop logs: **Settings → Open log folder** (`%APPDATA%\Clear\logs\clear.log`),
or the **Logs** tab in the app.
