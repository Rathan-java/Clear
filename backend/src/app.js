'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const createApp = () => {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
      credentials: true,
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'rate_limited', message: 'Slow down a little' },
    })
  );

  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      logger.debug('request', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - startedAt,
      });
    });
    next();
  });

  app.use('/', routes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
