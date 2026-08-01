'use strict';

const { verifyAccessToken } = require('../services/tokenService');

const extractToken = (req) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.query && typeof req.query.token === 'string') return req.query.token;
  return null;
};

const requireAuth = (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing bearer token' });
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email };
    req.deviceId = req.headers['x-device-id'] || payload.deviceId || null;
    return next();
  } catch (error) {
    const expired = error.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'token_expired' : 'unauthorized',
      message: expired ? 'Access token expired, use /auth/refresh' : 'Invalid access token',
    });
  }
};

module.exports = { requireAuth, extractToken };
