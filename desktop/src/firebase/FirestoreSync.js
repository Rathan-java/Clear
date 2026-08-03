'use strict';

const { EventEmitter } = require('events');
const { id } = require('../core/ids');

/**
 * FirestoreSync
 * -------------
 * Publishes answers and transcripts to Firestore. The phone has a live listener
 * on the same documents, so an answer appears there the moment it is written.
 *
 * The desktop and the phone never talk to each other and never need to be on
 * the same network - they are both just clients of the same Google project.
 *
 * Layout, all scoped to the signed-in user so the rules are trivial:
 *   users/{uid}/answers/{id}      what the phone shows
 *   users/{uid}/transcripts/{id}  optional, off by default
 *   users/{uid}/meetings/{id}     one per listening session
 *   users/{uid}/devices/{id}      heartbeat, so each side can see the other
 *
 * Emits: 'status', 'meeting', 'presence'
 */

const QUEUE_LIMIT = 200;
const HEARTBEAT_MS = 30000;
const DEVICE_ONLINE_MS = 90000;

class FirestoreSync extends EventEmitter {
  constructor({ auth, firestore, settings, logger }) {
    super();
    this.auth = auth;
    this.db = firestore;
    this.settings = settings;
    this.log = logger;

    this.state = 'offline'; // offline | connecting | connected | error
    this.latencyMs = null;
    this.lastError = null;
    this.meetingId = null;
    this.presence = { desktop: [], mobile: [], total: 0 };
    this.queue = [];
    this.heartbeatTimer = null;
    this.stats = { answers: 0, transcripts: 0, queued: 0, writeErrors: 0 };
  }

  get uid() {
    return this.auth.uid;
  }

  get connected() {
    return this.state === 'connected';
  }

  get userPath() {
    return `users/${this.uid}`;
  }

  setState(state, extra = {}) {
    this.state = state;
    this.emit('status', this.status(extra));
  }

  status(extra = {}) {
    return {
      state: this.state,
      connected: this.connected,
      latencyMs: this.latencyMs,
      meetingId: this.meetingId,
      presence: this.presence,
      queued: this.queue.length,
      error: this.lastError,
      projectId: this.settings.get('firebase.projectId'),
      ...extra,
    };
  }

  /** "Connecting" here means: get a token, announce this device, start beating. */
  async connect() {
    if (!this.auth.configured) {
      this.lastError = 'Add your Firebase settings first';
      this.setState('offline');
      throw new Error(this.lastError);
    }
    if (!this.auth.signedIn) {
      this.lastError = 'Sign in to connect';
      this.setState('offline');
      throw new Error(this.lastError);
    }

    this.setState('connecting');
    this.lastError = null;

    try {
      const startedAt = Date.now();
      await this.auth.ensureToken();
      await this.announceDevice();
      this.latencyMs = Date.now() - startedAt;

      this.setState('connected');
      this.log?.info('Connected to Firestore', { projectId: this.settings.get('firebase.projectId') });

      this.startHeartbeat();
      this.flushQueue();
      return this.status();
    } catch (error) {
      this.lastError = error.message;
      this.setState('error');
      throw error;
    }
  }

  async announceDevice() {
    const deviceId = this.settings.get('device.id');
    await this.db.set(`${this.userPath}/devices/${deviceId}`, {
      platform: 'desktop',
      name: this.settings.get('device.name'),
      lastSeenAt: new Date(),
      listening: Boolean(this.meetingId),
      appVersion: '1.0.0',
    });
  }

  /**
   * Heartbeat doubles as presence and as a connectivity check: if the write
   * fails we know we are offline before the user asks for an answer.
   */
  startHeartbeat() {
    this.stopHeartbeat();

    const beat = async () => {
      const startedAt = Date.now();
      try {
        await this.announceDevice();
        this.latencyMs = Date.now() - startedAt;

        if (!this.connected) {
          this.setState('connected');
          this.flushQueue();
        }

        await this.readPresence();
        this.emit('status', this.status());
      } catch (error) {
        this.latencyMs = null;
        this.lastError = error.message;
        this.log?.debug('Heartbeat failed', { error: error.message });
        this.setState('error');
      }
    };

    this.heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
    beat();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /** Who else is signed into this account and has checked in recently. */
  async readPresence() {
    try {
      const devices = await this.db.list(`${this.userPath}/devices`, { pageSize: 20 });
      const cutoff = Date.now() - DEVICE_ONLINE_MS;
      const online = devices.filter((device) => {
        const seen = device.lastSeenAt instanceof Date ? device.lastSeenAt.getTime() : 0;
        return seen > cutoff;
      });

      this.presence = {
        desktop: online.filter((d) => d.platform === 'desktop').map((d) => ({ deviceId: d.id, name: d.name })),
        mobile: online.filter((d) => d.platform === 'mobile').map((d) => ({ deviceId: d.id, name: d.name })),
        total: online.length,
      };
      this.emit('presence', this.presence);
    } catch (error) {
      this.log?.debug('Could not read presence', { error: error.message });
    }
  }

  // ---- writes -------------------------------------------------------------

  async write(kind, payload) {
    if (!this.auth.signedIn) {
      this.enqueue(kind, payload);
      return { queued: true };
    }

    try {
      const startedAt = Date.now();
      const collection = kind === 'answer' ? 'answers' : 'transcripts';
      const saved = await this.db.create(`${this.userPath}/${collection}`, payload);
      this.latencyMs = Date.now() - startedAt;

      if (kind === 'answer') this.stats.answers += 1;
      else this.stats.transcripts += 1;

      if (!this.connected) {
        this.setState('connected');
        this.flushQueue();
      }
      return saved;
    } catch (error) {
      this.stats.writeErrors += 1;
      this.lastError = error.message;
      this.log?.warn('Firestore write failed, queueing', { kind, error: error.message });
      this.enqueue(kind, payload);
      this.setState('error');
      return { queued: true, error: error.message };
    }
  }

  enqueue(kind, payload) {
    this.queue.push({ kind, payload, queuedAt: Date.now() });
    if (this.queue.length > QUEUE_LIMIT) this.queue.shift();
    this.stats.queued = this.queue.length;
    this.emit('status', this.status());
  }

  async flushQueue() {
    if (!this.queue.length || !this.auth.signedIn) return;

    const pending = this.queue.splice(0, this.queue.length);
    this.log?.info('Flushing queued writes', { count: pending.length });

    for (const item of pending) {
      try {
        const collection = item.kind === 'answer' ? 'answers' : 'transcripts';
        await this.db.create(`${this.userPath}/${collection}`, item.payload);
      } catch (error) {
        // Put it back and stop; the next heartbeat will try again.
        this.queue.unshift(item);
        break;
      }
    }

    this.stats.queued = this.queue.length;
    this.emit('status', this.status());
  }

  sendAnswer(payload) {
    return this.write('answer', {
      question: payload.question || '',
      answer: payload.answer || '',
      summary: Array.isArray(payload.summary) ? payload.summary.map(String) : [],
      transcript: String(payload.transcript || '').slice(0, 4000),
      latencyMs: payload.latencyMs ?? null,
      model: payload.model || null,
      meetingId: payload.meetingId || this.meetingId || null,
      deviceId: this.settings.get('device.id'),
      createdAt: new Date(),
    });
  }

  sendTranscript(payload) {
    return this.write('transcript', {
      text: String(payload.text || '').slice(0, 4000),
      isQuestion: Boolean(payload.isQuestion),
      meetingId: payload.meetingId || this.meetingId || null,
      deviceId: this.settings.get('device.id'),
      createdAt: new Date(),
    });
  }

  // ---- meetings -----------------------------------------------------------

  async startMeeting(title) {
    if (!this.auth.signedIn) return null;
    const meetingId = id();
    const meeting = {
      title: title || `Meeting ${new Date().toLocaleString()}`,
      startedAt: new Date(),
      endedAt: null,
      status: 'live',
      deviceId: this.settings.get('device.id'),
    };

    try {
      await this.db.set(`${this.userPath}/meetings/${meetingId}`, meeting, { merge: false });
      this.meetingId = meetingId;
      this.emit('meeting', { id: meetingId, ...meeting });
      this.announceDevice().catch(() => {});
      return { id: meetingId, ...meeting };
    } catch (error) {
      this.log?.warn('Could not start the meeting record', { error: error.message });
      return null;
    }
  }

  async endMeeting() {
    if (!this.meetingId || !this.auth.signedIn) return null;
    const meetingId = this.meetingId;
    try {
      await this.db.set(`${this.userPath}/meetings/${meetingId}`, {
        endedAt: new Date(),
        status: 'ended',
      });
    } catch (error) {
      this.log?.debug('Could not close the meeting record', { error: error.message });
    }
    this.meetingId = null;
    this.emit('meeting', null);
    this.announceDevice().catch(() => {});
    return { id: meetingId };
  }

  /** Recent answers, for the desktop's own history view. */
  history({ limit = 30 } = {}) {
    return this.db.list(`${this.userPath}/answers`, { pageSize: limit });
  }

  disconnect({ silent = false } = {}) {
    this.stopHeartbeat();
    this.latencyMs = null;
    if (!silent) this.setState('offline');
  }

  destroy() {
    this.disconnect({ silent: true });
    this.removeAllListeners();
  }
}

module.exports = { FirestoreSync };
