'use strict';

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 - readable when typed by hand

/** Random url-safe id, used for document ids. */
const id = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');

/** Human friendly pairing code, e.g. "K7QF-2M9X". */
const pairingCode = (length = 8) => {
  const chars = Array.from(crypto.randomBytes(length))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
};

/** Constant-time-ish hash used to store refresh tokens / pairing codes at rest. */
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const now = () => new Date().toISOString();

module.exports = { id, pairingCode, sha256, now };
