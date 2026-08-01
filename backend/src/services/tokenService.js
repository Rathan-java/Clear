'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { getDb, COLLECTIONS } = require('../config/firebase');
const { id, sha256, now } = require('../utils/ids');

const signAccessToken = (user, extra = {}) =>
  jwt.sign({ sub: user.id, email: user.email, typ: 'access', ...extra }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessTtl,
  });

const verifyAccessToken = (token) => {
  const payload = jwt.verify(token, env.jwt.accessSecret);
  if (payload.typ !== 'access') throw new Error('Wrong token type');
  return payload;
};

/**
 * Refresh tokens are opaque-ish: a JWT whose jti is stored (hashed) in Firestore so
 * it can be revoked. Rotation invalidates the previous token on every refresh.
 */
const issueRefreshToken = async (user, meta = {}) => {
  const db = getDb();
  const jti = id(24);
  const expiresAt = new Date(Date.now() + env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000);

  const token = jwt.sign({ sub: user.id, jti, typ: 'refresh' }, env.jwt.refreshSecret, {
    expiresIn: `${env.jwt.refreshTtlDays}d`,
  });

  await db.collection(COLLECTIONS.refreshTokens).doc(jti).set({
    userId: user.id,
    tokenHash: sha256(token),
    createdAt: now(),
    expiresAt: expiresAt.toISOString(),
    revokedAt: null,
    platform: meta.platform || 'unknown',
    deviceId: meta.deviceId || null,
  });

  return { token, jti, expiresAt: expiresAt.toISOString() };
};

const verifyRefreshToken = async (token) => {
  const payload = jwt.verify(token, env.jwt.refreshSecret);
  if (payload.typ !== 'refresh') throw new Error('Wrong token type');

  const db = getDb();
  const snap = await db.collection(COLLECTIONS.refreshTokens).doc(payload.jti).get();
  if (!snap.exists) throw new Error('Refresh token not recognised');

  const record = snap.data();
  if (record.revokedAt) throw new Error('Refresh token revoked');
  if (record.tokenHash !== sha256(token)) throw new Error('Refresh token mismatch');
  if (new Date(record.expiresAt).getTime() < Date.now()) throw new Error('Refresh token expired');

  return { payload, record };
};

const revokeRefreshToken = async (jti) => {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.refreshTokens).doc(jti);
  const snap = await ref.get();
  if (snap.exists) await ref.update({ revokedAt: now() });
};

const revokeAllForUser = async (userId) => {
  const db = getDb();
  const snap = await db.collection(COLLECTIONS.refreshTokens).where('userId', '==', userId).get();
  await Promise.all(
    snap.docs
      .filter((doc) => !doc.data().revokedAt)
      .map((doc) => db.collection(COLLECTIONS.refreshTokens).doc(doc.id).update({ revokedAt: now() }))
  );
};

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
};
