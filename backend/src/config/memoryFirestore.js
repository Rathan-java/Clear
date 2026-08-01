'use strict';

/**
 * Tiny in-memory stand-in for the subset of the Firestore API this backend uses.
 * It exists so the server (and the desktop/mobile apps against it) can run before
 * Firebase credentials are wired up. Data is lost on restart - never use in prod.
 *
 * Supported: collection().doc().get/set/update/delete, collection().add(),
 * where(), orderBy(), limit(), offset(), get() with .docs/.empty/.size/.forEach.
 */

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const getPath = (obj, path) =>
  path.split('.').reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);

const compare = (a, b) => {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : 1;
};

const matches = (data, [field, op, value]) => {
  const actual = getPath(data, field);
  switch (op) {
    case '==':
      return actual === value;
    case '!=':
      return actual !== value;
    case '>':
      return compare(actual, value) > 0;
    case '>=':
      return compare(actual, value) >= 0;
    case '<':
      return compare(actual, value) < 0;
    case '<=':
      return compare(actual, value) <= 0;
    case 'in':
      return Array.isArray(value) && value.includes(actual);
    case 'array-contains':
      return Array.isArray(actual) && actual.includes(value);
    default:
      throw new Error(`memoryFirestore: unsupported operator "${op}"`);
  }
};

class Snapshot {
  constructor(idValue, data) {
    this.id = idValue;
    this._data = data;
    this.exists = data !== undefined;
  }

  data() {
    return clone(this._data);
  }
}

class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }

  forEach(fn) {
    this.docs.forEach(fn);
  }
}

class Query {
  constructor(store, filters = [], orders = [], limitValue = null, offsetValue = 0) {
    this._store = store;
    this._filters = filters;
    this._orders = orders;
    this._limit = limitValue;
    this._offset = offsetValue;
  }

  where(field, op, value) {
    return new Query(this._store, [...this._filters, [field, op, value]], this._orders, this._limit, this._offset);
  }

  orderBy(field, direction = 'asc') {
    return new Query(this._store, this._filters, [...this._orders, [field, direction]], this._limit, this._offset);
  }

  limit(n) {
    return new Query(this._store, this._filters, this._orders, n, this._offset);
  }

  offset(n) {
    return new Query(this._store, this._filters, this._orders, this._limit, n);
  }

  async get() {
    let rows = [...this._store.entries()].map(([docId, data]) => ({ id: docId, data }));
    rows = rows.filter((row) => this._filters.every((f) => matches(row.data, f)));

    for (const [field, direction] of [...this._orders].reverse()) {
      rows.sort((a, b) => {
        const result = compare(getPath(a.data, field), getPath(b.data, field));
        return direction === 'desc' ? -result : result;
      });
    }

    if (this._offset) rows = rows.slice(this._offset);
    if (this._limit !== null) rows = rows.slice(0, this._limit);

    return new QuerySnapshot(rows.map((row) => new Snapshot(row.id, row.data)));
  }
}

class DocumentRef {
  constructor(store, idValue) {
    this._store = store;
    this.id = idValue;
  }

  async get() {
    return new Snapshot(this.id, this._store.get(this.id));
  }

  async set(data, options = {}) {
    const next = options.merge ? { ...(this._store.get(this.id) || {}), ...clone(data) } : clone(data);
    this._store.set(this.id, next);
    return { writeTime: new Date() };
  }

  async update(data) {
    if (!this._store.has(this.id)) {
      const error = new Error(`No document to update: ${this.id}`);
      error.code = 5;
      throw error;
    }
    this._store.set(this.id, { ...this._store.get(this.id), ...clone(data) });
    return { writeTime: new Date() };
  }

  async delete() {
    this._store.delete(this.id);
    return { writeTime: new Date() };
  }
}

class CollectionRef extends Query {
  constructor(store, name, counter) {
    super(store);
    this._name = name;
    this._counter = counter;
  }

  doc(idValue) {
    const key = idValue || `auto_${this._counter.next()}`;
    return new DocumentRef(this._store, key);
  }

  async add(data) {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

class MemoryFirestore {
  constructor() {
    this._collections = new Map();
    let seq = 0;
    this._counter = { next: () => `${Date.now().toString(36)}${(seq += 1).toString(36)}` };
  }

  collection(name) {
    if (!this._collections.has(name)) this._collections.set(name, new Map());
    return new CollectionRef(this._collections.get(name), name, this._counter);
  }

  /** Firestore has batch(); we only need a trivial sequential version. */
  batch() {
    const ops = [];
    return {
      set: (ref, data, options) => ops.push(() => ref.set(data, options)),
      update: (ref, data) => ops.push(() => ref.update(data)),
      delete: (ref) => ops.push(() => ref.delete()),
      commit: async () => {
        for (const op of ops) await op();
      },
    };
  }
}

module.exports = { MemoryFirestore };
