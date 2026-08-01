# Architecture

## The flow

```
  Bluetooth / USB / laptop speakers
              │  (WASAPI loopback)
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
  │                     · WAV encode              │
  │                     · Gemini transcription    │
  │                     · detectQuestion()        │
  │                           │                   │
  │                     { transcript, question }  │
  │                           ▼                   │
  │                     GeminiService             │
  │                     { question, answer,       │
  │                       summary[] }             │
  │                           ▼                   │
  │                     SocketClient ─────────────┼──┐
  └───────────────────────────────────────────────┘  │
                                                     │ wss
  ┌──────────────────────────────────────────────────▼──┐
  │ BACKEND (Express + Socket.IO)                       │
  │  JWT handshake → room user:<id>                     │
  │  persist to Firestore → broadcast to the room       │
  └──────────────────────────────────────────────────┬──┘
                                                     │ wss
  ┌──────────────────────────────────────────────────▼──┐
  │ MOBILE (Flutter)                                    │
  │  SocketService → AnswersController → AnswerCard     │
  │                  └► notification when backgrounded  │
  └─────────────────────────────────────────────────────┘
```

Typical end-to-end latency, from the last word spoken to the answer on the
phone: **1.5-3 s**, dominated by the two Gemini calls.

---

## Desktop

### Why the renderer captures the audio

Only the renderer has an `AudioContext`. So the renderer runs
`getDisplayMedia`, and the main process answers that request with
`{ video: screenSource, audio: 'loopback' }` - Electron's hook into WASAPI
loopback. The video track is dropped the instant the stream arrives; only audio
is kept.

An `AudioWorklet` (compiled from an inline blob, so there is no extra file to
ship) buffers 1024 samples at a time and posts them to the main thread, which
converts float32 → int16 and forwards them over IPC. `AudioContext` is created
at 16 kHz, so Chromium does the resampling from whatever the device runs at.

Everything downstream sees plain `Buffer`s of 16 kHz mono 16-bit PCM.

### Three capture backends

| Mode | Path | Use it for |
|------|------|-----------|
| `loopback` | renderer, `getDisplayMedia` | Default. Hears whatever you hear |
| `device` | renderer, `getUserMedia` | A specific mic or Stereo Mix endpoint |
| `ffmpeg` | main, `ffmpeg -f dshow` | Pinning one endpoint regardless of the Windows default |

### Segmenting speech

`SpeechService.streamAudio()` runs on every chunk and does only cheap
arithmetic. It tracks an adaptive noise floor (falls fast, rises slowly) and
opens a segment when RMS crosses `noiseFloor × multiplier`, where the
multiplier comes from the sensitivity slider. A segment closes after ~900 ms of
silence, or hard-cuts at 14 s for someone who never pauses. Segments shorter
than 600 ms of actual speech are dropped, and ~300 ms of pre-roll is kept so
the first syllable is not clipped.

Closed segments go onto a serial queue, so transcripts stay in order even when
one call is slow.

### Question detection is local

Every transcript line is scanned locally before anything reaches the answer
model: interrogative openers, auxiliary-verb openers, tag questions
("…, right?"), soft asks ("any thoughts on…"), and question marks - with a
declarative guard so "that's how we did it" does not fire. Only lines that pass
cost a Gemini answer call. `answerOnlyQuestions` in settings turns the filter
off if you want an answer for everything.

### State

`Pipeline` owns one state object and emits it on every change. The dashboard
and the tray both render from it. Level updates (10/s) are marked `quiet` and
throttled to 5/s before crossing IPC.

### Security

- `contextIsolation: true`, `nodeIntegration: false`, an allow-list preload.
- The Gemini key is encrypted with `safeStorage` (Windows DPAPI, scoped to the
  user account) and only ever read inside the main process.
- Refresh tokens are stored the same way.
- A CSP in `index.html` limits the renderer to its own assets.

---

## Backend

### Rooms

One room per user: `user:<userId>`. Both the desktop and the phone join it at
handshake time, so fan-out is a single `io.to(room).emit(...)`. Meetings get
their own room (`meeting:<id>`) for future per-meeting filtering.

### Auth

- Access token: JWT, 15 minutes, carries `sub`, `email`, `deviceId`.
- Refresh token: JWT with a `jti` whose SHA-256 hash is stored in Firestore, so
  it can be revoked. **Every refresh rotates it** - presenting an old refresh
  token fails (the smoke test asserts this).
- The Socket.IO handshake carries the access token. When it expires mid-session
  the client refreshes and re-authenticates without dropping the meeting.

### Pairing

The desktop asks for a code; the backend stores it hashed with a five-minute
expiry. The phone claims it while authenticated, which proves both devices
belong to the same account. Claiming links the two device documents and
notifies the room. Codes are single use.

### Persistence

| Collection | Contents |
|------------|----------|
| `users` | email, bcrypt hash, display name, timestamps |
| `devices` | platform, name, `pairedWith[]`, `lastSeenAt` |
| `meetings` | one per listening session, with counters |
| `transcripts` | one per spoken segment, `isQuestion` flag |
| `answers` | question, answer, summary[], latency, model |
| `refresh_tokens` | hashed, revocable |
| `pairing_codes` | hashed, single use, TTL |

`config/memoryFirestore.js` implements the same API subset in memory, so the
backend runs with zero configuration during development. Both paths store
timestamps as ISO strings plus `createdAtMs`, so query behaviour is identical.

### Heartbeat

The client emits `heartbeat` every 15 s and measures the round trip from the
ack - that is the latency shown in both UIs. The server tracks `lastSeenAt` per
socket and disconnects anything silent for twice the timeout.

---

## Mobile

Riverpod, one controller per concern:

- `AuthController` - restore session, sign in, pair, sign out.
- `AnswersController` - merges live socket pushes with paginated history,
  de-duplicating by id (the server replays the last 20 answers on connect).
- `SettingsController` - theme, notifications, backend URL.
- `SocketService` - connection, heartbeat, presence; exposes broadcast streams.

Tokens live in the Android keystore via `flutter_secure_storage`; preferences in
`SharedPreferences`. A 401 triggers one transparent refresh and a single retry.

---

## Failure behaviour

| Failure | What happens |
|---------|--------------|
| Backend unreachable | Desktop queues up to 200 events and replays on reconnect; answers still show locally |
| Socket emit times out | Falls back to `POST /answer`; if that fails too, the event stays queued |
| Access token expires | Refreshed transparently, socket re-authenticates in place |
| Refresh token rejected | Both apps sign out cleanly rather than looping |
| Gemini 429 / 5xx | Two retries with exponential backoff, then a surfaced error - capture keeps running |
| Gemini returns non-JSON | Parser recovers from fenced blocks and prose-wrapped JSON |
| Audio device unplugged | The track's `ended` event stops capture and surfaces an error |
| Renderer not ready | Main waits for the bridge's `ready` message before enumerating devices |

---

## Deliberate trade-offs

**Gemini for transcription instead of a streaming STT service.** One API key
for the whole product, no second vendor, no local model download. The cost is
latency: transcription happens per segment rather than word by word, so the
transcript arrives in ~1 s chunks. `SpeechService.transcribe()` is one method -
swap it for Whisper, Deepgram or Azure without touching anything else.

**Loopback follows the Windows default playback device.** That is what
Chromium's loopback gives you, and it is what people actually want. When it is
not, the FFmpeg backend pins a specific endpoint.

**In-process presence.** One free-tier instance does not need Redis. The socket
layer is written against rooms, so adding the Redis adapter is a five-line
change (see DEPLOYMENT.md).

**No auto-update on the desktop.** Out of scope for a first release; the hook
point is documented.
