'use strict';

require('dotenv').config();

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isProd = process.env.NODE_ENV === 'production';

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd,
  port: int(process.env.PORT, 8080),

  corsOrigins: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-do-not-use-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-do-not-use-in-production',
    accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
    refreshTtlDays: int(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
  },

  firebase: {
    serviceAccountBase64: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '',
    credentialsFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
  },

  allowAutoRegister: bool(process.env.ALLOW_AUTO_REGISTER, true),
  pairingCodeTtl: int(process.env.PAIRING_CODE_TTL, 300),
  heartbeatIntervalMs: int(process.env.HEARTBEAT_INTERVAL_MS, 15000),
  heartbeatTimeoutMs: int(process.env.HEARTBEAT_TIMEOUT_MS, 45000),
  historyPageSize: int(process.env.HISTORY_PAGE_SIZE, 50),
};

if (isProd) {
  const weak = [];
  if (env.jwt.accessSecret.startsWith('dev-') || env.jwt.accessSecret === 'change-me-access-secret') {
    weak.push('JWT_ACCESS_SECRET');
  }
  if (env.jwt.refreshSecret.startsWith('dev-') || env.jwt.refreshSecret === 'change-me-refresh-secret') {
    weak.push('JWT_REFRESH_SECRET');
  }
  if (weak.length) {
    throw new Error(`Refusing to start in production with default secrets: ${weak.join(', ')}`);
  }
}

module.exports = env;
