'use strict';

/**
 * Firestore's REST API speaks a typed JSON dialect:
 *   "hello"  ->  { stringValue: "hello" }
 *   [1, 2]   ->  { arrayValue: { values: [{ integerValue: "1" }, ...] } }
 *
 * These two functions convert between that and ordinary JavaScript objects.
 */

const toValue = (value) => {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };

  switch (typeof value) {
    case 'string':
      return { stringValue: value };
    case 'boolean':
      return { booleanValue: value };
    case 'number':
      if (!Number.isFinite(value)) return { nullValue: null };
      // Firestore integers travel as strings; anything fractional is a double.
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    case 'object':
      if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
      return { mapValue: { fields: toFields(value) } };
    default:
      return { stringValue: String(value) };
  }
};

/** Undefined properties are dropped rather than written as null. */
const toFields = (object = {}) =>
  Object.fromEntries(
    Object.entries(object)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, toValue(value)])
  );

const fromValue = (value = {}) => {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromValue);
  if ('mapValue' in value) return fromFields(value.mapValue.fields);
  return null;
};

const fromFields = (fields = {}) =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fromValue(value)]));

module.exports = { toValue, toFields, fromValue, fromFields };
