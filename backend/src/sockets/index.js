'use strict';

const { Server } = require('socket.io');
const env = require('../config/env');
const logger = require('../utils/logger');
const presence = require('./presence');
const { verifyAccessToken } = require('../services/tokenService');
const deviceService = require('../services/deviceService');
const meetingService = require('../services/meetingService');

const roomFor = (userId) => `user:${userId}`;

const ack = (callback, payload) => {
  if (typeof callback === 'function') callback(payload);
};

const attachSockets = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
      credentials: true,
    },
    pingInterval: env.heartbeatIntervalMs,
    pingTimeout: env.heartbeatTimeoutMs,
    maxHttpBufferSize: 1e6,
    transports: ['websocket', 'polling'],
  });

  // ---- Authentication: JWT in handshake.auth.token ------------------------
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer /i, '') ||
      socket.handshake.query?.token;

    if (!token) return next(Object.assign(new Error('Missing auth token'), { data: { code: 'unauthorized' } }));

    try {
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      socket.data.email = payload.email;
      socket.data.platform = socket.handshake.auth?.platform || 'unknown';
      socket.data.deviceId = socket.handshake.auth?.deviceId || payload.deviceId || null;
      socket.data.deviceName = socket.handshake.auth?.deviceName || null;
      return next();
    } catch (error) {
      const expired = error.name === 'TokenExpiredError';
      return next(
        Object.assign(new Error(expired ? 'Access token expired' : 'Invalid access token'), {
          data: { code: expired ? 'token_expired' : 'unauthorized' },
        })
      );
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    const room = roomFor(userId);
    socket.join(room);

    presence.add(userId, socket.id, {
      platform: socket.data.platform,
      deviceId: socket.data.deviceId,
      name: socket.data.deviceName,
    });

    logger.info('Socket connected', { userId, socketId: socket.id, platform: socket.data.platform });

    socket.emit('connected', {
      socketId: socket.id,
      room,
      serverTime: Date.now(),
      presence: presence.summary(userId),
    });
    io.to(room).emit('presence', presence.summary(userId));

    const registerDevice = async (payload, platform) => {
      socket.data.platform = platform;
      socket.data.deviceId = payload?.deviceId || socket.data.deviceId;
      socket.data.deviceName = payload?.deviceName || socket.data.deviceName;

      presence.add(userId, socket.id, {
        platform,
        deviceId: socket.data.deviceId,
        name: socket.data.deviceName,
      });

      if (socket.data.deviceId) {
        await deviceService.registerDevice({
          userId,
          deviceId: socket.data.deviceId,
          platform,
          name: socket.data.deviceName,
          model: payload?.model,
        });
      }
    };

    // ---- desktop_connect --------------------------------------------------
    socket.on('desktop_connect', async (payload = {}, callback) => {
      try {
        await registerDevice(payload, 'desktop');

        let meeting = null;
        if (payload.startMeeting !== false) {
          meeting = await meetingService.ensureMeeting({
            userId,
            deviceId: socket.data.deviceId,
            meetingId: payload.meetingId,
          });
          socket.data.meetingId = meeting.id;
          socket.join(`meeting:${meeting.id}`);
        }

        io.to(room).emit('presence', presence.summary(userId));
        io.to(room).emit('desktop_status', { online: true, deviceId: socket.data.deviceId, meeting });

        ack(callback, { ok: true, room, meeting, presence: presence.summary(userId) });
      } catch (error) {
        logger.error('desktop_connect failed', { userId, error: error.message });
        ack(callback, { ok: false, error: error.message });
      }
    });

    // ---- mobile_connect ---------------------------------------------------
    socket.on('mobile_connect', async (payload = {}, callback) => {
      try {
        await registerDevice(payload, 'mobile');

        const active = await meetingService.getActiveMeeting(userId);
        if (active) socket.join(`meeting:${active.id}`);

        const recent = await meetingService.listAnswers({ userId, limit: payload.backlog || 20 });

        io.to(room).emit('presence', presence.summary(userId));
        ack(callback, {
          ok: true,
          room,
          meeting: active,
          presence: presence.summary(userId),
          recentAnswers: recent,
        });

        // Send the backlog as events too, so a phone that just woke up catches up.
        recent
          .slice()
          .reverse()
          .forEach((answer) => socket.emit('answer', { ...answer, replay: true }));
      } catch (error) {
        logger.error('mobile_connect failed', { userId, error: error.message });
        ack(callback, { ok: false, error: error.message });
      }
    });

    // ---- transcript (desktop -> everyone) ---------------------------------
    socket.on('transcript', async (payload = {}, callback) => {
      presence.touch(userId, socket.id);
      try {
        const text = String(payload.text || payload.transcript || '').trim();
        if (!text) return ack(callback, { ok: false, error: 'empty transcript' });

        // Interim results are broadcast but never stored.
        if (payload.interim) {
          socket.to(room).emit('transcript', { ...payload, text, interim: true, userId });
          return ack(callback, { ok: true, stored: false });
        }

        const meeting = await meetingService.ensureMeeting({
          userId,
          deviceId: socket.data.deviceId,
          meetingId: payload.meetingId || socket.data.meetingId,
        });
        socket.data.meetingId = meeting.id;

        const saved = await meetingService.saveTranscript({
          userId,
          meetingId: meeting.id,
          deviceId: socket.data.deviceId,
          text,
          isQuestion: Boolean(payload.isQuestion || payload.question),
          startedAt: payload.startedAt,
          endedAt: payload.endedAt,
        });

        io.to(room).emit('transcript', { ...saved, interim: false });
        return ack(callback, { ok: true, stored: true, id: saved?.id, meetingId: meeting.id });
      } catch (error) {
        logger.error('transcript failed', { userId, error: error.message });
        return ack(callback, { ok: false, error: error.message });
      }
    });

    // ---- answer (desktop -> phone) ----------------------------------------
    socket.on('answer', async (payload = {}, callback) => {
      presence.touch(userId, socket.id);
      try {
        // Streaming chunks are relayed verbatim, not persisted.
        if (payload.streaming && !payload.final) {
          socket.to(room).emit('answer_chunk', { ...payload, userId });
          return ack(callback, { ok: true, stored: false });
        }

        const meeting = await meetingService.ensureMeeting({
          userId,
          deviceId: socket.data.deviceId,
          meetingId: payload.meetingId || socket.data.meetingId,
        });

        const saved = await meetingService.saveAnswer({
          userId,
          meetingId: meeting.id,
          deviceId: socket.data.deviceId,
          question: payload.question,
          answer: payload.answer,
          summary: payload.summary,
          transcript: payload.transcript,
          latencyMs: payload.latencyMs,
          model: payload.model,
        });

        io.to(room).emit('answer', saved);
        return ack(callback, { ok: true, stored: true, id: saved.id, meetingId: meeting.id });
      } catch (error) {
        logger.error('answer failed', { userId, error: error.message });
        return ack(callback, { ok: false, error: error.message });
      }
    });

    // ---- meeting lifecycle -------------------------------------------------
    socket.on('meeting_start', async (payload = {}, callback) => {
      const meeting = await meetingService.startMeeting({
        userId,
        deviceId: socket.data.deviceId,
        title: payload.title,
      });
      socket.data.meetingId = meeting.id;
      socket.join(`meeting:${meeting.id}`);
      io.to(room).emit('meeting_started', meeting);
      ack(callback, { ok: true, meeting });
    });

    socket.on('meeting_end', async (payload = {}, callback) => {
      const meetingId = payload.meetingId || socket.data.meetingId;
      if (!meetingId) return ack(callback, { ok: false, error: 'no active meeting' });
      const meeting = await meetingService.endMeeting({ userId, meetingId });
      socket.data.meetingId = null;
      io.to(room).emit('meeting_ended', meeting || { id: meetingId });
      return ack(callback, { ok: true, meeting });
    });

    // ---- heartbeat ---------------------------------------------------------
    socket.on('heartbeat', async (payload = {}, callback) => {
      presence.touch(userId, socket.id);
      deviceService.touchDevice(socket.data.deviceId).catch(() => {});
      const response = {
        ok: true,
        serverTime: Date.now(),
        clientTime: payload.t || null,
        presence: presence.summary(userId),
      };
      ack(callback, response);
      socket.emit('heartbeat_ack', response);
    });

    // ---- disconnect --------------------------------------------------------
    socket.on('disconnect', (reason) => {
      presence.remove(userId, socket.id);
      logger.info('Socket disconnected', { userId, socketId: socket.id, reason });
      io.to(room).emit('presence', presence.summary(userId));
      if (socket.data.platform === 'desktop') {
        io.to(room).emit('desktop_status', { online: false, deviceId: socket.data.deviceId, reason });
      }
    });

    socket.on('error', (error) => {
      logger.warn('Socket error', { userId, socketId: socket.id, error: error?.message });
    });
  });

  // ---- server-side liveness sweep -----------------------------------------
  const sweep = setInterval(() => {
    const dead = presence.stale(env.heartbeatTimeoutMs * 2);
    dead.forEach(({ userId, socketId }) => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        logger.warn('Dropping stale socket', { userId, socketId });
        socket.disconnect(true);
      } else {
        presence.remove(userId, socketId);
      }
    });
  }, env.heartbeatIntervalMs);
  sweep.unref?.();

  io.engine.on('connection_error', (error) => {
    logger.warn('Socket handshake rejected', { code: error.code, message: error.message });
  });

  return io;
};

module.exports = { attachSockets, roomFor };
