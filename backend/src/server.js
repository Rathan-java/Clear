'use strict';

const http = require('http');
const env = require('./config/env');
const { createApp } = require('./app');
const { attachSockets } = require('./sockets');
const { getDb, getBackend } = require('./config/firebase');
const logger = require('./utils/logger');

getDb(); // fail fast if Firebase credentials are broken

const app = createApp();
const server = http.createServer(app);
const io = attachSockets(server);
app.set('io', io);

server.listen(env.port, () => {
  logger.info('Clear backend listening', {
    port: env.port,
    env: env.nodeEnv,
    db: getBackend(),
  });
});

const shutdown = (signal) => {
  logger.info('Shutting down', { signal });
  io.close(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', { reason: String(reason) }));
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});

module.exports = { app, server, io };
