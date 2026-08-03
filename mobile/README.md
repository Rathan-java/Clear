# Clear - Android app

Flutter client. Signs into Firebase and shows AI answers the moment the desktop
writes them. No backend URL, no pairing screen, no connection to the PC.

## Requirements

- Flutter 3.27 or newer (`flutter --version`)
- Android SDK 34+, JDK 17
- `android/app/google-services.json` from your Firebase project
  (**Add app → Android**, package name `app.clear.mobile`)

## First run

```bash
cd mobile
flutter pub get
flutter run
```

Sign in with the same email and password you used on the desktop. That is the
entire setup.

## Release APK

```bash
node tool/generate_launcher_icons.js        # only needed once
flutter build apk --release
```

Output: `build/app/outputs/flutter-apk/app-release.apk`

### Signing

Debug-signed by default so the build always works. For a real release key:

```bash
keytool -genkey -v -keystore clear-release.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias clear
```

Then `android/key.properties`:

```properties
storeFile=../clear-release.jks
storePassword=...
keyAlias=clear
keyPassword=...
```

`android/app/build.gradle` picks it up automatically.

## Structure

```
lib/
├── main.dart              bootstrap: Firebase, storage, notifications
├── app.dart               MaterialApp, routes, bottom-nav shell
├── core/
│   ├── config.dart        constants + preference keys
│   ├── theme.dart         Material 3 light/dark
│   ├── storage.dart       preferences only - Firebase owns the session
│   └── notifications.dart answer notifications
├── data/
│   ├── models.dart        Answer, TranscriptLine, DeviceInfo, Presence
│   └── firebase_service.dart  auth, snapshot streams, presence heartbeat
├── state/                 Riverpod controllers
└── ui/
    ├── pages/             splash, login, dashboard, history, settings
    └── widgets/           answer card, status banner, empty state
```

## How data arrives

One `snapshots()` listener on `users/{uid}/answers` ordered by `createdAt`.
Firestore pushes changes and caches them offline, so the feed keeps working with
no signal and catches up when you reconnect.

Presence comes from `users/{uid}/devices`: the desktop writes a heartbeat every
30 s, this app every 45 s, and either side treats a device as online if it has
checked in within 95 s. That is how the banner can say *Desktop is listening*
without the two devices ever talking to each other.

Search runs locally over the loaded window — no index, no extra reads, works
offline.

## Tests

```bash
flutter test
```
