'use strict';

/**
 * End-to-end smoke test - no external services required.
 * Boots the server on a random port with the in-memory store and walks the
 * whole product flow: login -> pair -> desktop socket -> transcript -> answer
 * -> phone receives it -> GET /history.
 *
 *   npm run test:smoke
 */

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.JWT_ACCESS_SECRET = 'smoke-access';
process.env.JWT_REFRESH_SECRET = 'smoke-refresh';
process.env.LOG_LEVEL = 'warn';

const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { createApp } = require('../src/app');
const { attachSockets } = require('../src/sockets');

let passed = 0;
const check = (label, condition, detail) => {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? ` :: ${JSON.stringify(detail)}` : ''}`);
    process.exitCode = 1;
  }
};

const request = (base, method, path, { body, token } = {}) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      `${base}${path}`,
      {
        method,
        headers: {
          'content-type': 'application/json',
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          } catch (error) {
            reject(new Error(`Bad JSON from ${path}: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

const waitFor = (socket, event, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const connect = (base, auth) =>
  new Promise((resolve, reject) => {
    const socket = ioClient(base, { auth, transports: ['websocket'], reconnection: false });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 5000);
  });

(async () => {
  const app = createApp();
  const server = http.createServer(app);
  const socketServer = attachSockets(server);
  app.set('io', socketServer);

  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`\nClear backend smoke test @ ${base}\n`);

  // 1. health
  const health = await request(base, 'GET', '/health');
  check('GET /health', health.status === 200 && health.body.ok, health.body);

  // 2. login (auto-provision)
  const login = await request(base, 'POST', '/login', {
    body: {
      email: 'smoke@clear.app',
      password: 'supersecret123',
      platform: 'desktop',
      deviceId: 'desktop-smoke-1',
      deviceName: 'Smoke PC',
    },
  });
  check('POST /login returns tokens', login.status === 200 && !!login.body.accessToken, login.body);
  const desktopToken = login.body.accessToken;

  // 3. token refresh rotation
  const refreshed = await request(base, 'POST', '/auth/refresh', {
    body: { refreshToken: login.body.refreshToken },
  });
  check('POST /auth/refresh rotates', refreshed.status === 200 && !!refreshed.body.accessToken, refreshed.body);
  const replay = await request(base, 'POST', '/auth/refresh', { body: { refreshToken: login.body.refreshToken } });
  check('old refresh token is revoked', replay.status === 401, replay.body);

  // 4. pairing code
  const code = await request(base, 'POST', '/pair/code', {
    token: desktopToken,
    body: { deviceId: 'desktop-smoke-1', deviceName: 'Smoke PC' },
  });
  check('POST /pair/code issues a code', code.status === 201 && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code.body.code), code.body);

  // 5. phone logs in + claims the code
  const mobileLogin = await request(base, 'POST', '/login', {
    body: {
      email: 'smoke@clear.app',
      password: 'supersecret123',
      platform: 'mobile',
      deviceId: 'mobile-smoke-1',
      deviceName: 'Smoke Phone',
    },
  });
  const mobileToken = mobileLogin.body.accessToken;
  const paired = await request(base, 'POST', '/pair', {
    token: mobileToken,
    body: { code: code.body.code, deviceId: 'mobile-smoke-1', deviceName: 'Smoke Phone' },
  });
  check('POST /pair links the devices', paired.status === 200 && paired.body.desktop.deviceId === 'desktop-smoke-1', paired.body);

  const reused = await request(base, 'POST', '/pair', {
    token: mobileToken,
    body: { code: code.body.code, deviceId: 'mobile-smoke-1' },
  });
  check('pairing codes are single use', reused.status === 409, reused.body);

  // 6. sockets
  const desktop = await connect(base, { token: desktopToken, platform: 'desktop', deviceId: 'desktop-smoke-1' });
  const mobile = await connect(base, { token: mobileToken, platform: 'mobile', deviceId: 'mobile-smoke-1' });

  const desktopAck = await desktop.emitWithAck('desktop_connect', { deviceId: 'desktop-smoke-1' });
  check('desktop_connect starts a meeting', desktopAck.ok && !!desktopAck.meeting?.id, desktopAck);
  const meetingId = desktopAck.meeting.id;

  const mobileAck = await mobile.emitWithAck('mobile_connect', { deviceId: 'mobile-smoke-1' });
  check('mobile_connect joins the room', mobileAck.ok && mobileAck.presence.desktop.length === 1, mobileAck);

  // 7. transcript fan-out
  const transcriptOnPhone = waitFor(mobile, 'transcript');
  await desktop.emitWithAck('transcript', {
    text: 'How do we handle authentication on the mobile app?',
    isQuestion: true,
    meetingId,
  });
  const transcript = await transcriptOnPhone;
  check('transcript reaches the phone', transcript.text.startsWith('How do we handle'), transcript);

  // 8. answer fan-out
  const answerOnPhone = waitFor(mobile, 'answer');
  await desktop.emitWithAck('answer', {
    meetingId,
    question: 'How do we handle authentication on the mobile app?',
    answer: 'JWT access tokens with rotating refresh tokens, stored in the Android keystore.',
    summary: ['Short-lived access token', 'Rotating refresh token', 'Keystore-backed storage'],
    latencyMs: 812,
    model: 'gemini-2.5-flash',
  });
  const answer = await answerOnPhone;
  check('answer reaches the phone', answer.answer.includes('JWT') && answer.summary.length === 3, answer);

  // 9. heartbeat
  const beat = await desktop.emitWithAck('heartbeat', { t: Date.now() });
  check('heartbeat acks with server time', beat.ok && typeof beat.serverTime === 'number', beat);

  // 10. history + search
  const history = await request(base, 'GET', '/history?limit=10', { token: mobileToken });
  check('GET /history returns the answer', history.status === 200 && history.body.answers.length === 1, history.body);

  const search = await request(base, 'GET', '/history?search=keystore', { token: mobileToken });
  check('GET /history?search filters', search.body.answers.length === 1, search.body);

  const emptySearch = await request(base, 'GET', '/history?search=zzzznope', { token: mobileToken });
  check('search misses return nothing', emptySearch.body.answers.length === 0, emptySearch.body);

  // 11. auth is enforced
  const unauth = await request(base, 'GET', '/history');
  check('GET /history requires auth', unauth.status === 401, unauth.body);

  // 12. meeting detail
  const detail = await request(base, 'GET', `/history/meetings/${meetingId}`, { token: mobileToken });
  check('meeting detail has transcript + answers', detail.body.transcripts.length === 1 && detail.body.answers.length === 1, detail.body);

  desktop.close();
  mobile.close();
  socketServer.close();
  server.close();

  console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures)' : ''}\n`);
  setTimeout(() => process.exit(process.exitCode || 0), 300).unref();
})().catch((error) => {
  console.error('\nSmoke test crashed:', error);
  process.exit(1);
});
