'use strict';

const logger = require('../utils/logger');

const notFound = (req, res) => {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.originalUrl}` });
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    logger.error('Unhandled request error', { path: req.originalUrl, error: err.message, stack: err.stack });
  } else {
    logger.warn('Request rejected', { path: req.originalUrl, status, error: err.message });
  }
  res.status(status).json({
    error: err.code || (status >= 500 ? 'internal_error' : 'bad_request'),
    message: status >= 500 ? 'Something went wrong on our side' : err.message,
  });
};

/** Wraps async handlers so rejected promises reach errorHandler. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { notFound, errorHandler, asyncHandler };
