'use strict';

const express = require('express');
const authRoutes = require('./auth.routes');
const pairRoutes = require('./pair.routes');
const answerRoutes = require('./answer.routes');
const historyRoutes = require('./history.routes');
const { getBackend } = require('../config/firebase');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'clear-backend',
    version: require('../../package.json').version,
    db: getBackend(),
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

// Spec-level flat endpoints
router.use('/', authRoutes); // POST /login, POST /register
router.use('/auth', authRoutes); // POST /auth/refresh, /auth/logout, GET /auth/me
router.use('/pair', pairRoutes); // POST /pair, POST /pair/code
router.use('/answer', answerRoutes); // POST /answer
router.use('/history', historyRoutes); // GET /history

module.exports = router;
