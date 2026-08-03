'use strict';

const crypto = require('crypto');

/** Short, url-safe, sortable-enough document id. */
const id = (bytes = 12) => `${Date.now().toString(36)}-${crypto.randomBytes(bytes).toString('base64url')}`;

module.exports = { id };
