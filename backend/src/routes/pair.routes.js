'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const v = require('../middleware/validate');
const deviceService = require('../services/deviceService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /pair/code  (desktop)
 * -> { code: "K7QF-2M9X", expiresAt, ttlSeconds }
 */
router.post(
  '/code',
  requireAuth,
  asyncHandler(async (req, res) => {
    const deviceId = v.str(req.body.deviceId || req.deviceId, 'deviceId', { max: 128 });
    const deviceName = v.str(req.body.deviceName, 'deviceName', { required: false, max: 80 });

    await deviceService.registerDevice({
      userId: req.user.id,
      deviceId,
      platform: 'desktop',
      name: deviceName,
    });

    const result = await deviceService.createPairingCode({
      userId: req.user.id,
      deviceId,
      deviceName,
    });

    logger.info('Pairing code issued', { userId: req.user.id, deviceId });
    res.status(201).json(result);
  })
);

/**
 * POST /pair  (mobile)
 * body: { code, deviceId, deviceName?, model? }
 */
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const code = v.str(req.body.code, 'code', { min: 4, max: 20 }).toUpperCase();
    const deviceId = v.str(req.body.deviceId || req.deviceId, 'deviceId', { max: 128 });
    const deviceName = v.str(req.body.deviceName, 'deviceName', { required: false, max: 80 });
    const model = v.str(req.body.model, 'model', { required: false, max: 80 });

    const result = await deviceService.claimPairingCode({
      userId: req.user.id,
      code,
      deviceId,
      deviceName,
      model,
    });

    logger.info('Devices paired', { userId: req.user.id, mobile: result.mobileDeviceId });

    // Tell any live sockets in the room that a phone joined.
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${req.user.id}`).emit('paired', {
        mobileDeviceId: result.mobileDeviceId,
        desktop: result.desktop,
        at: new Date().toISOString(),
      });
    }

    res.json(result);
  })
);

/** GET /pair/devices */
router.get(
  '/devices',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ devices: await deviceService.listDevices(req.user.id) });
  })
);

/** DELETE /pair/:deviceId */
router.delete(
  '/:deviceId',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await deviceService.unpair({ userId: req.user.id, deviceId: req.params.deviceId }));
  })
);

module.exports = router;
