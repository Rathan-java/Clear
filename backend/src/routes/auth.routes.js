'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const v = require('../middleware/validate');
const userService = require('../services/userService');
const tokenService = require('../services/tokenService');
const deviceService = require('../services/deviceService');
const logger = require('../utils/logger');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many attempts, try again in a few minutes' },
});

const authPayload = async (user, meta) => {
  const accessToken = tokenService.signAccessToken(user, { deviceId: meta.deviceId || null });
  const refresh = await tokenService.issueRefreshToken(user, meta);
  return {
    user: userService.publicUser(user),
    accessToken,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
    room: `user:${user.id}`,
  };
};

/**
 * POST /register
 * body: { email, password, displayName? }
 */
router.post(
  '/register',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email = v.email(req.body.email);
    const password = v.password(req.body.password);
    const displayName = v.str(req.body.displayName, 'displayName', { required: false, max: 80 });

    const user = await userService.createUser({ email, password, displayName });
    logger.info('User registered', { userId: user.id });

    res.status(201).json(
      await authPayload(user, {
        platform: v.str(req.body.platform, 'platform', { required: false }) || 'unknown',
        deviceId: req.body.deviceId || null,
      })
    );
  })
);

/**
 * POST /login
 * body: { email, password, platform?, deviceId?, deviceName?, model? }
 * Registers/updates the calling device in the same round-trip.
 */
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email = v.email(req.body.email);
    const password = v.password(req.body.password);
    const platform = v.str(req.body.platform, 'platform', { required: false }) || 'unknown';

    let user = await userService.findByEmail(email);

    if (!user) {
      if (!env.allowAutoRegister) {
        const error = new Error('Invalid email or password');
        error.status = 401;
        error.code = 'invalid_credentials';
        throw error;
      }
      user = await userService.createUser({ email, password });
      logger.info('User auto-provisioned on first login', { userId: user.id });
    } else if (!(await userService.verifyPassword(user, password))) {
      const error = new Error('Invalid email or password');
      error.status = 401;
      error.code = 'invalid_credentials';
      throw error;
    }

    await userService.touchLogin(user.id);

    let device = null;
    if (req.body.deviceId || req.body.deviceName) {
      device = await deviceService.registerDevice({
        userId: user.id,
        deviceId: req.body.deviceId,
        platform: platform === 'unknown' ? 'desktop' : platform,
        name: req.body.deviceName,
        model: req.body.model,
      });
    }

    const payload = await authPayload(user, { platform, deviceId: device ? device.id : null });
    res.json({ ...payload, device: device ? { id: device.id, name: device.name, platform: device.platform } : null });
  })
);

/**
 * POST /auth/refresh
 * body: { refreshToken }
 * Rotates: the presented token is revoked and a new pair returned.
 */
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = v.str(req.body.refreshToken, 'refreshToken', { max: 2000 });

    let verified;
    try {
      verified = await tokenService.verifyRefreshToken(token);
    } catch (error) {
      const rejected = new Error('Refresh token is invalid or expired, please sign in again');
      rejected.status = 401;
      rejected.code = 'invalid_refresh_token';
      throw rejected;
    }

    const user = await userService.findById(verified.payload.sub);
    if (!user) {
      const error = new Error('Account no longer exists');
      error.status = 401;
      throw error;
    }

    await tokenService.revokeRefreshToken(verified.payload.jti);
    res.json(
      await authPayload(user, {
        platform: verified.record.platform,
        deviceId: verified.record.deviceId,
      })
    );
  })
);

/** POST /auth/logout - revokes one refresh token (or all with { all: true }). */
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.body.all) {
      await tokenService.revokeAllForUser(req.user.id);
      return res.json({ ok: true, revoked: 'all' });
    }
    if (req.body.refreshToken) {
      try {
        const { payload } = await tokenService.verifyRefreshToken(req.body.refreshToken);
        await tokenService.revokeRefreshToken(payload.jti);
      } catch {
        /* already invalid - nothing to revoke */
      }
    }
    return res.json({ ok: true });
  })
);

/** GET /auth/me */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await userService.findById(req.user.id);
    if (!user) {
      const error = new Error('Account no longer exists');
      error.status = 404;
      throw error;
    }
    const devices = await deviceService.listDevices(user.id);
    res.json({ user: userService.publicUser(user), devices, room: `user:${user.id}` });
  })
);

module.exports = router;
