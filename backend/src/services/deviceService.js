'use strict';

const env = require('../config/env');
const { getDb, COLLECTIONS } = require('../config/firebase');
const { id, pairingCode, sha256, now } = require('../utils/ids');

/**
 * Devices belong to a user. A desktop generates a short-lived pairing code; the
 * phone claims it. Claiming links both devices to the same "room" (the user room)
 * and returns the desktop identity so the phone can show what it is bound to.
 */

const registerDevice = async ({ userId, deviceId, platform, name, model }) => {
  const db = getDb();
  const docId = deviceId || id();
  const ref = db.collection(COLLECTIONS.devices).doc(docId);
  const snap = await ref.get();

  const payload = {
    userId,
    platform, // 'desktop' | 'mobile'
    name: name || (platform === 'desktop' ? 'Windows PC' : 'Android phone'),
    model: model || null,
    pairedWith: snap.exists ? snap.data().pairedWith || [] : [],
    lastSeenAt: now(),
    updatedAt: now(),
    ...(snap.exists ? {} : { createdAt: now() }),
  };

  await ref.set(payload, { merge: true });
  return { id: docId, ...(snap.exists ? snap.data() : {}), ...payload };
};

const listDevices = async (userId) => {
  const db = getDb();
  const snap = await db.collection(COLLECTIONS.devices).where('userId', '==', userId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

const touchDevice = async (deviceId) => {
  if (!deviceId) return;
  const db = getDb();
  const ref = db.collection(COLLECTIONS.devices).doc(deviceId);
  const snap = await ref.get();
  if (snap.exists) await ref.update({ lastSeenAt: now() });
};

/** Desktop calls this to get a code the phone can type in. */
const createPairingCode = async ({ userId, deviceId, deviceName }) => {
  const db = getDb();
  const code = pairingCode();
  const codeId = sha256(code);
  const expiresAt = new Date(Date.now() + env.pairingCodeTtl * 1000).toISOString();

  await db.collection(COLLECTIONS.pairingCodes).doc(codeId).set({
    userId,
    deviceId,
    deviceName: deviceName || 'Windows PC',
    createdAt: now(),
    expiresAt,
    claimedAt: null,
    claimedBy: null,
  });

  return { code, expiresAt, ttlSeconds: env.pairingCodeTtl };
};

/** Phone calls this with the code shown on the desktop. */
const claimPairingCode = async ({ userId, code, deviceId, deviceName, model }) => {
  const db = getDb();
  const codeId = sha256(String(code || '').trim().toUpperCase());
  const ref = db.collection(COLLECTIONS.pairingCodes).doc(codeId);
  const snap = await ref.get();

  const reject = (message, status = 400) => {
    const error = new Error(message);
    error.status = status;
    throw error;
  };

  if (!snap.exists) reject('Invalid pairing code', 404);
  const record = snap.data();

  if (record.claimedAt) reject('That pairing code has already been used', 409);
  if (new Date(record.expiresAt).getTime() < Date.now()) reject('That pairing code has expired', 410);
  if (record.userId !== userId) reject('That pairing code belongs to a different account', 403);

  const mobile = await registerDevice({
    userId,
    deviceId,
    platform: 'mobile',
    name: deviceName,
    model,
  });

  await ref.update({ claimedAt: now(), claimedBy: mobile.id });

  // Link both directions.
  const desktopRef = db.collection(COLLECTIONS.devices).doc(record.deviceId);
  const desktopSnap = await desktopRef.get();
  if (desktopSnap.exists) {
    const pairedWith = new Set(desktopSnap.data().pairedWith || []);
    pairedWith.add(mobile.id);
    await desktopRef.update({ pairedWith: [...pairedWith], updatedAt: now() });
  }

  const mobileRef = db.collection(COLLECTIONS.devices).doc(mobile.id);
  const pairedWith = new Set(mobile.pairedWith || []);
  pairedWith.add(record.deviceId);
  await mobileRef.update({ pairedWith: [...pairedWith], updatedAt: now() });

  return {
    room: `user:${userId}`,
    mobileDeviceId: mobile.id,
    desktop: {
      deviceId: record.deviceId,
      name: record.deviceName,
    },
  };
};

const unpair = async ({ userId, deviceId }) => {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.devices).doc(deviceId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().userId !== userId) {
    const error = new Error('Device not found');
    error.status = 404;
    throw error;
  }
  await ref.update({ pairedWith: [], updatedAt: now() });
  return { ok: true };
};

module.exports = {
  registerDevice,
  listDevices,
  touchDevice,
  createPairingCode,
  claimPairingCode,
  unpair,
};
