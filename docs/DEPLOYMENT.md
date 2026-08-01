# Deployment

The backend is the only thing that needs hosting. It fits comfortably in the
free tier of every provider below.

---

## Option A - Render (recommended, free)

`backend/render.yaml` is a ready-made blueprint.

1. Push this repository to GitHub.
2. <https://dashboard.render.com> → **New → Blueprint** → pick the repo.
3. Render reads `render.yaml`, creates a free web service, and generates both
   JWT secrets for you.
4. Fill the two secrets it cannot generate:
   - `FIREBASE_SERVICE_ACCOUNT_BASE64`
   - `FIREBASE_PROJECT_ID`
5. Deploy. Your URL is `https://clear-backend.onrender.com`.

Verify:

```bash
curl https://clear-backend.onrender.com/health
# {"ok":true,"db":"firestore",...}
```

> **Free tier caveat.** Render spins the instance down after 15 minutes idle;
> the next request takes ~30 s to wake it. The desktop app queues transcripts
> and answers while the backend is asleep and replays them on reconnect, so
> nothing is lost - the phone just gets them a moment late. A cron ping every
> 10 minutes (e.g. cron-job.org hitting `/health`) keeps it warm.

---

## Option B - Railway / Fly.io / Koyeb

All three read the included `Dockerfile`.

```bash
# Railway
railway init && railway up

# Fly.io
fly launch --dockerfile backend/Dockerfile
fly secrets set JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... \
                FIREBASE_SERVICE_ACCOUNT_BASE64=... FIREBASE_PROJECT_ID=...
fly deploy
```

Every provider passes `$PORT`; the server already respects it.

---

## Option C - Your own VPS

```bash
git clone <repo> && cd Clear/backend
npm ci --omit=dev
cp .env.example .env      # fill it in

sudo npm install -g pm2
pm2 start src/server.js --name clear-backend
pm2 save && pm2 startup
```

Put nginx in front for TLS - **required**, because WebSockets need `wss://` and
Android blocks cleartext to anything that is not a private address:

```nginx
server {
    listen 443 ssl http2;
    server_name clear.example.com;

    ssl_certificate     /etc/letsencrypt/live/clear.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/clear.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # Socket.IO needs these three
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`certbot --nginx -d clear.example.com` for the certificate.

---

## Production environment

```bash
NODE_ENV=production
PORT=8080

# Refuses to start if these are still the defaults
JWT_ACCESS_SECRET=<64 hex chars>
JWT_REFRESH_SECRET=<different 64 hex chars>
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30

FIREBASE_SERVICE_ACCOUNT_BASE64=<base64 of service-account.json>
FIREBASE_PROJECT_ID=<project id>

# Lock this down once you know your clients
CORS_ORIGINS=*

# Set false to require explicit /register instead of auto-provisioning on login
ALLOW_AUTO_REGISTER=true
```

In production the server **refuses to boot** without Firebase credentials or
with default JWT secrets. That is deliberate.

---

## Firestore

Deploy the rules and indexes once:

```bash
cd backend
firebase deploy --only firestore:rules,firestore:indexes --project <project-id>
```

`firestore.rules` denies every direct client read and write. Only the backend,
using the Admin SDK, can reach the data - so a leaked client config is worthless.

`firestore.indexes.json` contains the composite indexes for the history queries
(`userId + createdAtMs desc`, and so on). Without them Firestore returns
`FAILED_PRECONDITION` on the first `/history` call.

**Staying inside the free tier.** Spark gives 50k reads and 20k writes a day. A
one-hour meeting writes roughly one document per spoken segment plus one per
answer - a few hundred documents. If you are close to the limit, turn off
**Sync transcript to the cloud** on the desktop: answers still sync, transcript
lines stay local.

---

## Scaling past one instance

Presence is tracked in-process (`backend/src/sockets/presence.js`), so two
instances would not see each other's sockets. To scale horizontally:

```bash
npm install @socket.io/redis-adapter redis
```

```js
// backend/src/sockets/index.js, after creating `io`
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const pub = createClient({ url: process.env.REDIS_URL });
const sub = pub.duplicate();
await Promise.all([pub.connect(), sub.connect()]);
io.adapter(createAdapter(pub, sub));
```

Everything else is already written against rooms (`user:<id>`,
`meeting:<id>`), so no other change is needed.

---

## Desktop distribution

```bash
cd desktop
npm run build     # → release/ARA Meeting Assistant Setup.exe
```

The installer is per-user (no admin needed), lets the user choose the install
directory, and creates Start Menu and desktop shortcuts.

**Code signing.** Unsigned installers trigger SmartScreen. With an OV/EV
certificate:

```bash
set CSC_LINK=C:\path\to\certificate.pfx
set CSC_KEY_PASSWORD=...
npm run build
```

**Auto-update** is not wired up. To add it, install `electron-updater`, publish
releases to GitHub, and add a `publish` block to the `build` section of
`desktop/package.json`.

---

## Android distribution

```bash
cd mobile
flutter build apk --release --dart-define=CLEAR_BACKEND_URL=https://clear.example.com
```

Bake the production URL in with `--dart-define` so users never see a server
field. For the Play Store, build an App Bundle instead:

```bash
flutter build appbundle --release --dart-define=CLEAR_BACKEND_URL=https://clear.example.com
```

Signing: create `android/key.properties` as described in
[`mobile/README.md`](../mobile/README.md). Without it the release build falls
back to the debug key, which is fine for sideloading but rejected by Play.

Once the backend is HTTPS-only, delete the `domain-config` block from
`android/app/src/main/res/xml/network_security_config.xml` to forbid cleartext
entirely.

---

## Post-deploy checklist

- [ ] `GET /health` returns `"db":"firestore"`
- [ ] `npm run test:smoke` passes against production (use a throwaway account)
- [ ] Desktop signs in and the status pill reads *Online* with sane latency
- [ ] Pairing code from desktop works on the phone
- [ ] An answer generated on the desktop appears on the phone within ~2 s
- [ ] Killing the backend queues events on the desktop; restarting replays them
- [ ] Firestore rules are deployed (a direct client read must fail)
- [ ] The Gemini key exists only on the desktop, never in backend env vars
