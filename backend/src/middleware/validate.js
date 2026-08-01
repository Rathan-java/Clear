'use strict';

/** Minimal request-body validation - no schema library, no surprises. */

const fail = (message) => {
  const error = new Error(message);
  error.status = 400;
  error.code = 'invalid_request';
  throw error;
};

const str = (value, name, { min = 1, max = 4000, required = true } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) fail(`"${name}" is required`);
    return '';
  }
  if (typeof value !== 'string') fail(`"${name}" must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min) fail(`"${name}" must be at least ${min} characters`);
  if (trimmed.length > max) fail(`"${name}" must be at most ${max} characters`);
  return trimmed;
};

const email = (value) => {
  const v = str(value, 'email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail('"email" is not a valid address');
  return v;
};

const password = (value) => str(value, 'password', { min: 8, max: 128 });

const strArray = (value, name, { max = 20 } = {}) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`"${name}" must be an array`);
  return value.slice(0, max).map((v) => String(v));
};

module.exports = { str, email, password, strArray, fail };
