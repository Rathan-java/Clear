# Architecture

## The flow

```
  Bluetooth / USB / laptop speakers  (Teams, Meet, Zoom - anything you hear)
              │  WASAPI loopback
              ▼
  ┌───────────────────────────────────────────────┐
  │ DESKTOP (Electron)                            │
  │                                               │
  │  renderer            main process             │
  │  ─────────           ────────────             │
  │  getDisplayMedia ──► AudioCaptureService      │
  │  AudioWorklet        (16 kHz mono PCM)        │
  │      │                    │                   │
  │      └── IPC ────────────►│                   │
  │                           ▼                   │
  │                     SpeechService             │
  │                     · energy VAD              │
  │                     · segment on silence      │
  │                     · Gemini transcription    │
  │                     · detectQuestion()        │
  │                           │                   │
  │                     { transcript, question }  │
  │                           ▼                   │
  │                     GeminiService             │
  │                     { question, answer,       │
  │                       summary[] }             │
  │                           ▼                   │
  │                     FirestoreSync ────────────┼──┐
  └───────────────────────────────────────────────┘  │ HTTPS
                                                     │
              ┌──────────────────────────────────────▼──┐
              │ FIREBASE (Google)                       │
              │   Auth: one account, both devices       │
              │   users/{uid}/answers      ← written    │
              │   users/{uid}/transcripts               │
              │   users/{uid}/devices  (presence)       │
              └──────────────────────────────────────┬──┘
                                                     │ live listener
  ┌──────────────────────────────────────────────────▼──┐
  │ MOBILE (Flutter)                                    │
  │  snapshots() → AnswersController → AnswerCard       │
  │               └► notification when backgrounded     │
  └─────────────────────────────────────────────────────┘
```

**There is no server in this diagram and no link between the two devices.** The
desktop is a Firestore *writer*, the phone is a Firestore *reader*. They can be
on different networks, different countries, and neither needs to know the other
exists.

End-to-end latency from the last word spoken to the answer on the phone:
**1.5–3 s**, almost entirely the two Gemini calls. The Firestore hop is ~100 ms.

---

## Why Firebase instead of a backend

The earlier design had a Node + Socket.IO server. It worked, but it forced a
choice nobody wants: pay for hosting, tolerate free-tier cold starts, or keep
both devices on the same Wi-Fi. Firestore removes the question:

- **Free.** Spark plan, no card. 50k reads and 20k writes a day; a heavy meeting
  day is a few hundred.
- **Nothing to deploy.** No cold start, no uptime pinger, no laptop left on.
- **Realtime is native.** `snapshots()` is a push stream with an offline cache,
  which is exactly what a socket was being used for.
- **Auth for free.** Same account on both devices replaces pairing codes,
  device registration, JWT issuing, refresh-token rotation and revocation.

The cost is a hard dependency on Google, and answers passing through Firestore
rather than staying on your machine. For a product that already sends the
meeting audio to Gemini, that is not a new exposure.

---

## Desktop

### Why the renderer captures the audio

Only the renderer has an `AudioContext`. So the renderer runs
`getDisplayMedia`, and the main process answers that request with
`{ video: screenSource, audio: 'loopback' }` — Electron's hook into WASAPI
loopback. The video track is dropped the instant the stream arrives.

An `AudioWorklet` (compiled from an inline blob, so there is no extra file to
ship) buffers 1024 samples at a time and posts them to the main thread, which
converts float32 → int16 and forwards them over IPC. The `AudioContext` runs at
16 kHz, so Chromium resamples from whatever the device uses.

### Three capture backends

| Mode | Path | Use it for |
|------|------|-----------|
| `loopback` | renderer, `getDisplayMedia` | Default. Hears whatever you hear |
| `device` | renderer, `getUserMedia` | A specific mic or Stereo Mix endpoint |
| `ffmpeg` | main, `ffmpeg -f dshow` | Pinning one endpoint regardless of the Windows default |

### Segmenting speech

`SpeechService.streamAudio()` runs on every chunk and does only cheap
arithmetic. It tracks an adaptive noise floor (falls fast, rises slowly) and
opens a segment when RMS crosses `noiseFloor × multiplier`, the multiplier
coming from the sensitivity slider. A segment closes after ~900 ms of silence,
or hard-cuts at 14 s. Segments with under 600 ms of speech are dropped, and
~300 ms of pre-roll is kept so the first syllable is not clipped.

Closed segments go onto a serial queue, so transcripts stay in order even when
one call is slow.

### Question detection is local

Every transcript line is scanned on the machine before anything reaches the
answer model: interrogative openers, auxiliary-verb openers, tag questions
("…, right?"), soft asks ("any thoughts on…") and question marks — with a
declarative guard so "that's how we did it" does not fire. Only lines that pass
cost a Gemini answer call.

### Firebase without the SDK

The desktop talks to Firebase over plain REST:

- **Auth** — `identitytoolkit.googleapis.com` for sign-in, `securetoken` for
  refresh. The refresh token is stored via `safeStorage` (Windows DPAPI).
- **Firestore** — typed-JSON REST writes, authenticated as the signed-in user,
  so the same rules apply to the desktop as to the phone.

The official JS SDK expects a browser (IndexedDB, WebChannel) and adds about a
megabyte to the main process. The desktop only writes, so three HTTP calls do
the job with no dependency at all. The phone uses the real native SDK, where
listeners and offline caching genuinely matter.

### Offline behaviour

Writes that fail are queued in memory (bounded at 200) and retried on the next
30-second heartbeat. Answers still appear on the desktop immediately; they reach
the phone when the connection returns.

---

## Data model

Everything lives under one document path, which makes the security rules
almost trivial:

| Path | Contents |
|------|----------|
| `users/{uid}/answers/{id}` | question, answer, summary[], transcript, latencyMs, model, createdAt |
| `users/{uid}/transcripts/{id}` | text, isQuestion, createdAt (opt-out in settings) |
| `users/{uid}/meetings/{id}` | title, startedAt, endedAt, status |
| `users/{uid}/devices/{id}` | platform, name, lastSeenAt, listening |

`devices` is the presence mechanism: each side writes a heartbeat (desktop every
30 s, phone every 45 s) and reads the other's. A device is "online" if it has
checked in within 95 seconds. That is how the phone can say *Desktop is
listening* without any direct connection.

---

## Mobile

Riverpod, one controller per concern:

- `AuthController` — wraps `authStateChanges()`; Firebase restores the session
  from disk, so there is no token handling in app code at all.
- `AnswersController` — one `snapshots()` listener drives the whole feed. New
  documents fire notifications; `hasPendingWrites` is checked so the local cache
  echoing a write never double-fires. Older pages load on demand via
  `startAfter`.
- `SettingsController` — theme and notifications.

Search runs locally over the loaded window: no composite index, no extra reads,
and it works offline against the Firestore cache.

---

## Failure behaviour

| Failure | What happens |
|---------|--------------|
| Phone offline | Firestore serves the cached answers; new ones arrive on reconnect |
| Desktop offline | Writes queue in memory and flush on the next heartbeat |
| Firebase token expires | Refreshed transparently on both sides |
| Rules not deployed | Both apps surface a clear "rules are blocking this account" message |
| Gemini 429 / 5xx | Two retries with exponential backoff, then a surfaced error — capture keeps running |
| Gemini returns non-JSON | Parser recovers from fenced blocks and prose-wrapped JSON |
| Audio device unplugged | The track's `ended` event stops capture and surfaces an error |
| `ready-to-show` never fires | A 5 s fallback shows the window anyway |

---

## Deliberate trade-offs

**Gemini for transcription instead of a streaming STT service.** One API key for
the whole product, no second vendor, no local model download. The cost is
latency: transcription happens per segment rather than word by word.
`SpeechService.transcribe()` is one method — swap it for Whisper, Deepgram or
Azure without touching anything else.

**Loopback follows the Windows default playback device.** That is what
Chromium's loopback gives you, and it is what people want. When it isn't, the
FFmpeg backend pins a specific endpoint.

**Local search rather than a search index.** Firestore has no full-text search;
adding Algolia or a Cloud Function would mean a bill. Searching the loaded
window covers the real use case — "what was that answer earlier today".

**No auto-update on the desktop.** Out of scope for a first release; the hook
point is documented in DEPLOYMENT.md.
