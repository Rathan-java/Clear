'use strict';

/**
 * Per-process presence registry.
 *
 * Single instance is enough for the free tier. To run more than one instance,
 * add @socket.io/redis-adapter and move this map into Redis - the rest of the
 * socket layer is written against rooms, so nothing else changes.
 */

const byUser = new Map(); // userId -> Map<socketId, entry>

const add = (userId, socketId, entry) => {
  if (!byUser.has(userId)) byUser.set(userId, new Map());
  byUser.get(userId).set(socketId, { ...entry, connectedAt: Date.now(), lastSeenAt: Date.now() });
};

const remove = (userId, socketId) => {
  const sockets = byUser.get(userId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (!sockets.size) byUser.delete(userId);
};

const touch = (userId, socketId) => {
  const entry = byUser.get(userId)?.get(socketId);
  if (entry) entry.lastSeenAt = Date.now();
};

const list = (userId) =>
  [...(byUser.get(userId) || new Map()).entries()].map(([socketId, entry]) => ({ socketId, ...entry }));

const summary = (userId) => {
  const entries = list(userId);
  return {
    desktop: entries.filter((e) => e.platform === 'desktop').map((e) => ({ deviceId: e.deviceId, name: e.name })),
    mobile: entries.filter((e) => e.platform === 'mobile').map((e) => ({ deviceId: e.deviceId, name: e.name })),
    total: entries.length,
  };
};

const stale = (timeoutMs) => {
  const cutoff = Date.now() - timeoutMs;
  const result = [];
  for (const [userId, sockets] of byUser.entries()) {
    for (const [socketId, entry] of sockets.entries()) {
      if (entry.lastSeenAt < cutoff) result.push({ userId, socketId, ...entry });
    }
  }
  return result;
};

const stats = () => ({
  users: byUser.size,
  sockets: [...byUser.values()].reduce((sum, m) => sum + m.size, 0),
});

module.exports = { add, remove, touch, list, summary, stale, stats };
