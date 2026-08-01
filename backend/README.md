# Clear backend

Express + Socket.IO + Firestore. Auth, device pairing, realtime relay, history.

```bash
npm install
cp .env.example .env
npm start          # http://localhost:8080
npm run dev        # with --watch
npm run test:smoke # 17 end-to-end checks, no external services needed
```

Runs against an in-memory Firestore stand-in until you supply credentials, so
there is nothing to configure for a first run. In production it refuses to start
without Firebase credentials or with default JWT secrets.

## REST

| Method | Path | Auth | Body / query |
|--------|------|------|--------------|
| `GET` | `/health` | – | – |
| `POST` | `/register` | – | `{ email, password, displayName? }` |
| `POST` | `/login` | – | `{ email, password, platform?, deviceId?, deviceName? }` |
| `POST` | `/auth/refresh` | – | `{ refreshToken }` → rotates |
| `POST` | `/auth/logout` | bearer | `{ refreshToken? , all? }` |
| `GET` | `/auth/me` | bearer | – |
| `POST` | `/pair/code` | bearer | `{ deviceId, deviceName? }` → `{ code, expiresAt }` |
| `POST` | `/pair` | bearer | `{ code, deviceId, deviceName? }` |
| `GET` | `/pair/devices` | bearer | – |
| `DELETE` | `/pair/:deviceId` | bearer | – |
| `POST` | `/answer` | bearer | `{ question, answer, summary[], transcript?, latencyMs? }` |
| `POST` | `/answer/transcript` | bearer | `{ text, isQuestion? }` |
| `GET` | `/history` | bearer | `?limit=&before=&search=&meetingId=` |
| `GET` | `/history/meetings` | bearer | `?limit=` |
| `GET` | `/history/meetings/:id` | bearer | – |

`Authorization: Bearer <accessToken>`. On 401 with `error: "token_expired"`,
call `/auth/refresh` and retry.

## Socket.IO

Handshake: `auth: { token, platform, deviceId, deviceName }`. Every socket
joins `user:<userId>`.

**Client → server** (all take an ack callback)

| Event | Payload | Effect |
|-------|---------|--------|
| `desktop_connect` | `{ deviceId, deviceName }` | Registers the device, ensures a live meeting |
| `mobile_connect` | `{ deviceId, backlog? }` | Joins the room, replays recent answers |
| `transcript` | `{ text, isQuestion, interim? }` | Persists (unless interim) and broadcasts |
| `answer` | `{ question, answer, summary[], latencyMs }` | Persists and broadcasts |
| `meeting_start` / `meeting_end` | `{ title? }` / `{ meetingId }` | Meeting lifecycle |
| `heartbeat` | `{ t }` | Acks with server time and presence |

**Server → client**

`connected`, `presence`, `transcript`, `answer`, `answer_chunk`, `paired`,
`desktop_status`, `meeting_started`, `meeting_ended`, `heartbeat_ack`

## Firestore

`users`, `devices`, `meetings`, `transcripts`, `answers`, `refresh_tokens`,
`pairing_codes`.

Deploy rules and indexes:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project <id>
```

The rules deny all direct client access - only the Admin SDK reaches the data.

## Layout

```
src/
├── config/      env, Firebase, memoryFirestore fallback
├── middleware/  auth (JWT), validation, error handling
├── routes/      auth, pair, answer, history
├── services/    tokens, users, devices, meetings
├── sockets/     server, presence registry
├── utils/       logger, ids
├── app.js       Express app (helmet, CORS, rate limits)
└── server.js    HTTP + Socket.IO, graceful shutdown
```
