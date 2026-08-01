'use strict';

const bcrypt = require('bcryptjs');
const { getDb, COLLECTIONS } = require('../config/firebase');
const { id, now } = require('../utils/ids');

const normaliseEmail = (email) => String(email || '').trim().toLowerCase();

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName || user.email.split('@')[0],
  createdAt: user.createdAt,
});

const findByEmail = async (email) => {
  const db = getDb();
  const snap = await db.collection(COLLECTIONS.users).where('email', '==', normaliseEmail(email)).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
};

const findById = async (userId) => {
  const db = getDb();
  const snap = await db.collection(COLLECTIONS.users).doc(userId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
};

const createUser = async ({ email, password, displayName }) => {
  const db = getDb();
  const clean = normaliseEmail(email);

  const existing = await findByEmail(clean);
  if (existing) {
    const error = new Error('An account with that email already exists');
    error.status = 409;
    throw error;
  }

  const userId = id();
  const user = {
    email: clean,
    displayName: displayName || clean.split('@')[0],
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: now(),
    updatedAt: now(),
    lastLoginAt: null,
  };

  await db.collection(COLLECTIONS.users).doc(userId).set(user);
  return { id: userId, ...user };
};

const verifyPassword = async (user, password) => {
  if (!user || !user.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
};

const touchLogin = async (userId) => {
  const db = getDb();
  await db.collection(COLLECTIONS.users).doc(userId).update({ lastLoginAt: now(), updatedAt: now() });
};

module.exports = { findByEmail, findById, createUser, verifyPassword, touchLogin, publicUser, normaliseEmail };
