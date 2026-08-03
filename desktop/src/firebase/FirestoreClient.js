'use strict';

const { toFields, fromFields } = require('./firestoreValues');

/**
 * Minimal Firestore REST client: create, patch, list, delete.
 * Authenticated as the signed-in user, so the security rules apply exactly as
 * they would for the phone - the desktop has no elevated access.
 */

const BASE = 'https://firestore.googleapis.com/v1';

class FirestoreError extends Error {
  constructor(message, { status, retryable } = {}) {
    super(message);
    this.name = 'FirestoreError';
    this.status = status || 0;
    this.retryable = Boolean(retryable);
  }
}

class FirestoreClient {
  constructor({ auth, settings, logger }) {
    this.auth = auth;
    this.settings = settings;
    this.log = logger;
  }

  get projectId() {
    return this.settings.get('firebase.projectId');
  }

  get root() {
    return `${BASE}/projects/${this.projectId}/databases/(default)/documents`;
  }

  async request(method, path, { body, query, timeoutMs = 15000, attempt = 0 } = {}) {
    if (!this.projectId) throw new FirestoreError('No Firebase project configured');

    const token = await this.auth.ensureToken();
    const url = new URL(`${this.root}/${path}`.replace(/\/+$/, ''));
    Object.entries(query || {}).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
      else if (value !== undefined) url.searchParams.set(key, value);
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (response.status === 401 && attempt === 0) {
        // Token aged out between ensureToken() and the request landing.
        await this.auth.refresh();
        clearTimeout(timer);
        return this.request(method, path, { body, query, timeoutMs, attempt: 1 });
      }

      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = json?.error?.message || `Firestore returned ${response.status}`;
        const retryable = response.status === 429 || response.status >= 500;

        if (retryable && attempt < 2) {
          clearTimeout(timer);
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          return this.request(method, path, { body, query, timeoutMs, attempt: attempt + 1 });
        }

        throw new FirestoreError(message, { status: response.status, retryable });
      }

      return json;
    } catch (error) {
      if (error.name === 'AbortError') throw new FirestoreError('Firestore timed out', { retryable: true });
      if (error instanceof FirestoreError) throw error;
      throw new FirestoreError(error.message, { retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  /** POST a new document. `documentId` is optional - Firestore generates one. */
  async create(collectionPath, data, { documentId } = {}) {
    const result = await this.request('POST', collectionPath, {
      body: { fields: toFields(data) },
      query: documentId ? { documentId } : undefined,
    });
    return { id: result.name?.split('/').pop(), ...fromFields(result.fields) };
  }

  /** PATCH (upsert). Without a mask Firestore replaces the whole document. */
  async set(documentPath, data, { merge = true } = {}) {
    const query = merge
      ? { 'updateMask.fieldPaths': Object.keys(data).filter((key) => data[key] !== undefined) }
      : undefined;

    const result = await this.request('PATCH', documentPath, {
      body: { fields: toFields(data) },
      query,
    });
    return { id: result.name?.split('/').pop(), ...fromFields(result.fields) };
  }

  async get(documentPath) {
    try {
      const result = await this.request('GET', documentPath);
      return { id: result.name?.split('/').pop(), ...fromFields(result.fields) };
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async list(collectionPath, { pageSize = 50, orderBy } = {}) {
    const result = await this.request('GET', collectionPath, {
      query: { pageSize, ...(orderBy ? { orderBy } : {}) },
    });
    return (result.documents || []).map((doc) => ({
      id: doc.name?.split('/').pop(),
      ...fromFields(doc.fields),
    }));
  }

  delete(documentPath) {
    return this.request('DELETE', documentPath);
  }
}

module.exports = { FirestoreClient, FirestoreError };
