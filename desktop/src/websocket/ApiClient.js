'use strict';

/**
 * Thin REST client for the Clear backend.
 * Holds the access token in memory, keeps the refresh token in SettingsStore
 * (encrypted at rest), and transparently refreshes on 401.
 */

class ApiError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status || 0;
    this.code = code || 'request_failed';
    this.body = body;
  }
}

class ApiClient {
  constructor({ settings, logger }) {
    this.settings = settings;
    this.log = logger;
    this.accessToken = null;
    this.user = null;
    this.refreshing = null;
  }

  get baseUrl() {
    return String(this.settings.get('backendUrl') || '').replace(/\/+$/, '');
  }

  get refreshToken() {
    return this.settings.getSecret('refreshToken');
  }

  get signedIn() {
    return Boolean(this.refreshToken || this.accessToken);
  }

  async request(path, { method = 'GET', body, auth = true, retryOn401 = true, timeoutMs = 15000 } = {}) {
    if (!this.baseUrl) throw new ApiError('No backend URL configured', { code: 'no_backend' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(auth && this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
          ...(this.settings.get('device.id') ? { 'x-device-id': this.settings.get('device.id') } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const json = text ? safeParse(text) : null;

      if (response.status === 401 && auth && retryOn401 && this.refreshToken) {
        await this.refresh();
        return this.request(path, { method, body, auth, retryOn401: false, timeoutMs });
      }

      if (!response.ok) {
        throw new ApiError(json?.message || `Request failed (${response.status})`, {
          status: response.status,
          code: json?.error,
          body: json,
        });
      }

      return json;
    } catch (error) {
      if (error.name === 'AbortError') throw new ApiError('The backend did not respond in time', { code: 'timeout' });
      if (error instanceof ApiError) throw error;
      throw new ApiError(error.message || 'Network error', { code: 'network' });
    } finally {
      clearTimeout(timer);
    }
  }

  async login({ email, password }) {
    const result = await this.request('/login', {
      method: 'POST',
      auth: false,
      body: {
        email,
        password,
        platform: 'desktop',
        deviceId: this.settings.get('device.id'),
        deviceName: this.settings.get('device.name'),
      },
    });

    this.accessToken = result.accessToken;
    this.user = result.user;
    this.settings.patch({
      refreshToken: result.refreshToken,
      auth: { email: result.user.email, userId: result.user.id },
    });

    this.log?.info('Signed in', { userId: result.user.id });
    return result;
  }

  /** Rotates the refresh token; concurrent callers share one in-flight request. */
  async refresh() {
    if (this.refreshing) return this.refreshing;

    const token = this.refreshToken;
    if (!token) throw new ApiError('Not signed in', { status: 401, code: 'no_refresh_token' });

    this.refreshing = (async () => {
      try {
        const result = await this.request('/auth/refresh', {
          method: 'POST',
          auth: false,
          body: { refreshToken: token },
        });
        this.accessToken = result.accessToken;
        this.user = result.user;
        this.settings.patch({
          refreshToken: result.refreshToken,
          auth: { email: result.user.email, userId: result.user.id },
        });
        this.log?.debug('Access token refreshed');
        return result;
      } catch (error) {
        if (error.status === 401) {
          this.log?.warn('Refresh token rejected - signing out');
          this.signOutLocal();
        }
        throw error;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  /** Ensures a usable access token, refreshing if we only have the long-lived one. */
  async ensureToken() {
    if (this.accessToken) return this.accessToken;
    if (!this.refreshToken) throw new ApiError('Not signed in', { status: 401, code: 'signed_out' });
    const result = await this.refresh();
    return result.accessToken;
  }

  async logout() {
    try {
      if (this.accessToken) {
        await this.request('/auth/logout', { method: 'POST', body: { refreshToken: this.refreshToken } });
      }
    } catch (error) {
      this.log?.debug('Logout call failed (ignoring)', { error: error.message });
    }
    this.signOutLocal();
  }

  signOutLocal() {
    this.accessToken = null;
    this.user = null;
    this.settings.patch({ refreshToken: null, auth: { email: null, userId: null } });
  }

  createPairingCode() {
    return this.request('/pair/code', {
      method: 'POST',
      body: {
        deviceId: this.settings.get('device.id'),
        deviceName: this.settings.get('device.name'),
      },
    });
  }

  listDevices() {
    return this.request('/pair/devices');
  }

  history({ limit = 30, search } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (search) params.set('search', search);
    return this.request(`/history?${params.toString()}`);
  }

  postAnswer(payload) {
    return this.request('/answer', { method: 'POST', body: payload });
  }

  health() {
    return this.request('/health', { auth: false, timeoutMs: 6000 });
  }
}

const safeParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
};

module.exports = { ApiClient, ApiError };
