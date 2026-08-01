'use strict';

const { EventEmitter } = require('events');
const { io } = require('socket.io-client');

/**
 * SocketClient
 * ------------
 * Realtime link to the backend. Responsibilities:
 *  - connect with a JWT and re-auth silently when it expires
 *  - measure round-trip latency with the heartbeat
 *  - queue transcripts/answers while offline and replay them on reconnect
 *
 * Emits: 'status' ({state, latencyMs, ...}), 'presence', 'answer', 'paired',
 *        'meeting', 'error'
 */

const QUEUE_LIMIT = 200;

class SocketClient extends EventEmitter {
  constructor({ api, settings, logger }) {
    super();
    this.api = api;
    this.settings = settings;
    this.log = logger;

    this.socket = null;
    this.state = 'offline'; // offline | connecting | connected | error
    this.latencyMs = null;
    this.lastError = null;
    this.room = null;
    this.meetingId = null;
    this.presence = { desktop: [], mobile: [], total: 0 };
    this.queue = [];
    this.heartbeatTimer = null;
    this.reconnectAttempts = 0;
    this.stats = { sentTranscripts: 0, sentAnswers: 0, queued: 0, reconnects: 0 };
  }

  get connected() {
    return Boolean(this.socket?.connected);
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
      room: this.room,
      meetingId: this.meetingId,
      presence: this.presence,
      queued: this.queue.length,
      error: this.lastError,
      backendUrl: this.settings.get('backendUrl'),
      ...extra,
    };
  }

  async connect() {
    if (this.socket) this.disconnect({ silent: true });

    let token;
    try {
      token = await this.api.ensureToken();
    } catch (error) {
      this.lastError = 'Sign in to connect';
      this.setState('offline');
      throw error;
    }

    const url = String(this.settings.get('backendUrl') || '').replace(/\/+$/, '');
    this.lastError = null;
    this.setState('connecting');
    this.log?.info('Connecting to backend', { url });

    this.socket = io(url, {
      auth: {
        token,
        platform: 'desktop',
        deviceId: this.settings.get('device.id'),
        deviceName: this.settings.get('device.name'),
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15000,
      timeout: 12000,
      // https is upgraded to wss automatically; keep certificates strict.
      rejectUnauthorized: true,
    });

    this.bind();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timed out')), 15000);
      this.socket.once('connect', () => {
        clearTimeout(timer);
        resolve(this.status());
      });
      this.socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  bind() {
    const socket = this.socket;

    socket.on('connect', async () => {
      this.reconnectAttempts = 0;
      this.lastError = null;
      this.setState('connected');
      this.log?.info('Socket connected', { id: socket.id });

      try {
        const ack = await socket.emitWithAck('desktop_connect', {
          deviceId: this.settings.get('device.id'),
          deviceName: this.settings.get('device.name'),
        });
        if (ack?.ok) {
          this.room = ack.room;
          this.meetingId = ack.meeting?.id || null;
          this.presence = ack.presence || this.presence;
          this.emit('meeting', ack.meeting || null);
        } else {
          this.log?.warn('desktop_connect was rejected', { ack });
        }
      } catch (error) {
        this.log?.warn('desktop_connect failed', { error: error.message });
      }

      this.startHeartbeat();
      this.flushQueue();
      this.setState('connected');
    });

    socket.on('disconnect', (reason) => {
      this.stopHeartbeat();
      this.latencyMs = null;
      this.setState('offline', { reason });
      this.log?.warn('Socket disconnected', { reason });
    });

    socket.on('connect_error', async (error) => {
      this.reconnectAttempts += 1;
      this.lastError = error.message;

      // The access token expired while we were away - mint a new one and retry.
      const code = error?.data?.code;
      if (code === 'token_expired' || code === 'unauthorized') {
        try {
          const { accessToken } = await this.api.refresh();
          socket.auth = { ...socket.auth, token: accessToken };
          this.log?.info('Re-authenticated socket after token expiry');
        } catch (refreshError) {
          this.lastError = 'Session expired - sign in again';
          this.log?.error('Could not refresh token for socket', { error: refreshError.message });
        }
      }

      this.setState('error');
    });

    socket.io.on('reconnect', (attempt) => {
      this.stats.reconnects += 1;
      this.log?.info('Socket reconnected', { attempt });
    });

    socket.on('presence', (presence) => {
      this.presence = presence;
      this.emit('presence', presence);
      this.emit('status', this.status());
    });

    socket.on('paired', (payload) => this.emit('paired', payload));
    socket.on('answer', (payload) => this.emit('answer', payload));
    socket.on('meeting_started', (meeting) => {
      this.meetingId = meeting?.id || null;
      this.emit('meeting', meeting);
    });
    socket.on('meeting_ended', (meeting) => {
      this.meetingId = null;
      this.emit('meeting', null);
    });
    socket.on('heartbeat_ack', () => {});
  }

  startHeartbeat() {
    this.stopHeartbeat();
    const beat = async () => {
      if (!this.connected) return;
      const sentAt = Date.now();
      try {
        const ack = await this.socket.timeout(8000).emitWithAck('heartbeat', { t: sentAt });
        this.latencyMs = Date.now() - sentAt;
        if (ack?.presence) this.presence = ack.presence;
        this.emit('status', this.status());
      } catch (error) {
        this.log?.debug('Heartbeat missed', { error: error.message });
        this.latencyMs = null;
        this.emit('status', this.status());
      }
    };
    beat();
    this.heartbeatTimer = setInterval(beat, 15000);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /** Emits when connected, otherwise queues (bounded, newest wins). */
  async send(event, payload) {
    if (!this.connected) {
      this.queue.push({ event, payload, queuedAt: Date.now() });
      if (this.queue.length > QUEUE_LIMIT) this.queue.shift();
      this.stats.queued = this.queue.length;
      this.emit('status', this.status());
      return { queued: true };
    }

    try {
      const ack = await this.socket.timeout(10000).emitWithAck(event, payload);
      if (event === 'transcript') this.stats.sentTranscripts += 1;
      if (event === 'answer') this.stats.sentAnswers += 1;
      if (ack?.meetingId) this.meetingId = ack.meetingId;
      return ack;
    } catch (error) {
      this.log?.warn('Emit failed, queueing', { event, error: error.message });
      this.queue.push({ event, payload, queuedAt: Date.now() });
      if (this.queue.length > QUEUE_LIMIT) this.queue.shift();
      return { queued: true, error: error.message };
    }
  }

  async flushQueue() {
    if (!this.queue.length || !this.connected) return;
    const pending = this.queue.splice(0, this.queue.length);
    this.log?.info('Flushing offline queue', { count: pending.length });
    for (const item of pending) {
      try {
        await this.socket.timeout(10000).emitWithAck(item.event, { ...item.payload, replayed: true });
      } catch (error) {
        this.queue.push(item); // put it back and stop; we will try again later
        break;
      }
    }
    this.stats.queued = this.queue.length;
    this.emit('status', this.status());
  }

  sendTranscript(payload) {
    return this.send('transcript', { ...payload, meetingId: this.meetingId });
  }

  sendAnswer(payload) {
    return this.send('answer', { ...payload, meetingId: this.meetingId });
  }

  async startMeeting(title) {
    if (!this.connected) return null;
    const ack = await this.socket.emitWithAck('meeting_start', { title });
    this.meetingId = ack?.meeting?.id || null;
    this.emit('meeting', ack?.meeting || null);
    return ack?.meeting || null;
  }

  async endMeeting() {
    if (!this.connected || !this.meetingId) return null;
    const ack = await this.socket.emitWithAck('meeting_end', { meetingId: this.meetingId });
    this.meetingId = null;
    this.emit('meeting', null);
    return ack?.meeting || null;
  }

  disconnect({ silent = false } = {}) {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.latencyMs = null;
    if (!silent) this.setState('offline');
  }

  destroy() {
    this.disconnect({ silent: true });
    this.removeAllListeners();
  }
}

module.exports = { SocketClient };
