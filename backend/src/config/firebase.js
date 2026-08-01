'use strict';

const fs = require('fs');
const env = require('./env');
const logger = require('../utils/logger');
const { MemoryFirestore } = require('./memoryFirestore');

let db = null;
let backend = 'unknown';

const loadServiceAccount = () => {
  if (env.firebase.serviceAccountBase64) {
    const json = Buffer.from(env.firebase.serviceAccountBase64, 'base64').toString('utf8');
    return JSON.parse(json);
  }
  if (env.firebase.credentialsFile && fs.existsSync(env.firebase.credentialsFile)) {
    return JSON.parse(fs.readFileSync(env.firebase.credentialsFile, 'utf8'));
  }
  return null;
};

const init = () => {
  if (db) return db;

  let serviceAccount = null;
  try {
    serviceAccount = loadServiceAccount();
  } catch (error) {
    logger.error('Failed to parse Firebase service account', { error: error.message });
  }

  if (serviceAccount) {
    // eslint-disable-next-line global-require
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: env.firebase.projectId || serviceAccount.project_id,
      });
    }
    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    backend = 'firestore';
    logger.info('Firestore connected', { projectId: serviceAccount.project_id });
    return db;
  }

  if (env.isProd) {
    throw new Error(
      'No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT_BASE64 or GOOGLE_APPLICATION_CREDENTIALS.'
    );
  }

  db = new MemoryFirestore();
  backend = 'memory';
  logger.warn('No Firebase credentials found - using in-memory store (development only, data is not persisted)');
  return db;
};

module.exports = {
  getDb: () => db || init(),
  getBackend: () => backend,
  COLLECTIONS: {
    users: 'users',
    devices: 'devices',
    meetings: 'meetings',
    transcripts: 'transcripts',
    answers: 'answers',
    refreshTokens: 'refresh_tokens',
    pairingCodes: 'pairing_codes',
  },
};
