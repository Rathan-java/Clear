# Deployment

There is no server to deploy. The only cloud piece is Firebase, and the only
thing that gets "deployed" is the security rules file. The rest is distributing
two apps.

---

## Firebase

### Rules — deploy once, redeploy when they change

```bash
npm install -g firebase-tools
firebase login
cd firebase
firebase deploy --only firestore --project your-project-id
```

[`firebase/firestore.rules`](../firebase/firestore.rules) restricts every
document to its owner:

```
match /users/{userId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

Anonymous access is denied everywhere. Verify in the console under
**Firestore → Rules → Playground**: an unauthenticated read of
`users/anything/answers/x` must fail.

### Staying inside the free tier

Spark gives **50k reads / 20k writes / 1 GiB stored per day**. Clear's usage per
hour of meeting:

| Action | Writes | Reads |
|--------|--------|-------|
| Answers | ~10–40 | — |
| Transcript lines (optional) | ~100–300 | — |
| Desktop heartbeat | 120 | 120 |
| Phone heartbeat | 80 | — |
| Phone listener | — | 1 per changed doc |

A full working day lands in the low thousands. If you get close to the limit,
turn off **Sync transcript to the cloud** on the desktop — answers still sync,
transcript lines stay local, and writes drop by an order of magnitude.

### Housekeeping

Firestore has no TTL on the Spark plan, so old answers accumulate. Either delete
them from the console occasionally, or — if you later move to Blaze — add a
scheduled function. 1 GiB is a very large number of text documents; this is a
"once a year" concern.

---

## Desktop distribution

```bash
cd desktop
npm run build            # → release/ARA Meeting Assistant Setup.exe
```

The installer is per-user (no admin needed), lets the user pick the install
directory, and creates Start Menu and desktop shortcuts.

**Configuration travels with the user, not the build.** The Firebase API key and
project ID are entered on the sign-in screen and stored in
`%APPDATA%\Clear\settings.json`. To preconfigure a machine, set environment
variables before first launch:

```powershell
$env:CLEAR_FIREBASE_API_KEY   = "AIzaSy..."
$env:CLEAR_FIREBASE_PROJECT_ID = "your-project-id"
```

**Code signing.** Unsigned installers trigger SmartScreen. With an OV/EV
certificate:

```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD = "..."
npm run build
```

**Auto-update** is not wired up. To add it: install `electron-updater`, publish
releases to GitHub, and add a `publish` block to the `build` section of
`desktop/package.json`.

---

## Android distribution

```bash
cd mobile
flutter build apk --release
```

`android/app/google-services.json` must be present — it is what points the app
at your Firebase project. **Do not commit it to a public repository**; it is not
a credential, but it does identify your project and invites noise.

For the Play Store, build an App Bundle instead:

```bash
flutter build appbundle --release
```

### Signing

Debug-signed by default so the build always works. For a real release key:

```bash
keytool -genkey -v -keystore clear-release.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias clear
```

Then create `android/key.properties`:

```properties
storeFile=../clear-release.jks
storePassword=...
keyAlias=clear
keyPassword=...
```

`android/app/build.gradle` picks it up automatically. Without it, release builds
fall back to the debug key — fine for sideloading, rejected by Play.

---

## Multiple users

Each person needs:

1. Their own Firebase account **within the same project** — just a different
   email at the sign-in screen. Rules keep their data separate.
2. Their own Gemini API key on their own desktop.

If you would rather each person had their own project, they each do the setup in
[INSTALL.md](INSTALL.md) step 1 and enter their own API key and project ID.

---

## Post-setup checklist

- [ ] Email/password sign-in enabled in Firebase Authentication
- [ ] Firestore database created
- [ ] Rules deployed (`firebase deploy --only firestore`)
- [ ] Desktop signs in and the status pill reads **Online**
- [ ] `google-services.json` in `mobile/android/app/`
- [ ] Phone signs in with the same account and shows **Desktop is listening**
- [ ] An answer generated on the desktop appears on the phone within ~2 s
- [ ] Phone works with Wi-Fi **off**, on mobile data
- [ ] Anonymous read denied in the Rules Playground
- [ ] The Gemini key exists only on the desktop
