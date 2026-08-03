'use strict';

const { EventEmitter } = require('events');

/**
 * Firebase Authentication over its REST API.
 *
 * Why REST instead of the firebase JS SDK: the SDK expects a browser (IndexedDB
 * for token persistence, WebChannel for transport) and drags ~1 MB into the
 * Electron main process. The desktop only needs sign-in and a bearer token, so
 * three HTTP calls do the job with no dependency at all. The phone uses the
 * real native SDK, where realtime listeners and offline caching actually matter.
 *
 * The refresh token is stored through SettingsStore, i.e. encrypted with
 * Windows DPAPI.
 */

const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';
const SECURE_TOKEN = 'https://securetoken.googleapis.com/v1/token';

/** Firebase error codes are SHOUTY_SNAKE; make them human. */
const FRIENDLY = {
  EMAIL_EXISTS: 'That email already has an account - sign in instead.',
  EMAIL_NOT_FOUND: 'No account with that email.',
  INVALID_PASSWORD: 'Wrong password.',
  INVALID_LOGIN_CREDENTIALS: 'Wrong email or password.',
  USER_DISABLED: 'That account has been disabled.',
  WEAK_PASSWORD: 'Password must be at least 6 characters.',
  INVALID_EMAIL: 'That email address is not valid.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Wait a few minutes and try again.',
  OPERATION_NOT_ALLOWED: 'Email/password sign-in is not enabled in your Firebase project.',
  MISSING_PASSWORD: 'Enter a password.',
  API_KEY_INVALID: 'That Firebase API key is not valid - check Settings.',
};

class AuthError extends Error {
  constructor(code, message) {
    super(message || FRIENDLY[code] || code || 'Sign-in failed');
    this.name = 'AuthError';
    this.code = code;
  }
}

class FirebaseAuth extends EventEmitter {
  constructor({ settings, logger }) {
    super();
    this.settings = settings;
    this.log = logger;

    this.idToken = null;
    this.expiresAt = 0;
    this.uid = settings.get('auth.userId') || null;
    this.email = settings.get('auth.email') || null;
    this.refreshing = null;
  }

  get apiKey() {
    return this.settings.get('firebase.apiKey');
  }

  get configured() {
    return Boolean(this.apiKey && this.settings.get('firebase.projectId'));
  }

  get refreshToken() {
    return this.settings.getSecret('refreshToken');
  }

  get signedIn() {
    return Boolean(this.refreshToken && this.uid);
  }

  async post(url, body, { timeoutMs = 15000 } = {}) {
    if (!this.apiKey) throw new AuthError('NO_CONFIG', 'Add your Firebase settings first.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${url}?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        const raw = json?.error?.message || `HTTP ${response.status}`;
        // Firebase appends detail after a colon: "WEAK_PASSWORD : Password should be..."
        const code = String(raw).split(':')[0].trim();
        throw new AuthError(code);
      }

      return json;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new AuthError('TIMEOUT', 'Firebase did not respond. Check your internet connection.');
      }
      if (error instanceof AuthError) throw error;
      throw new AuthError('NETWORK', `Cannot reach Firebase: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  applySession({ idToken, refreshToken, expiresIn, localId, email }) {
    this.idToken = idToken;
    this.expiresAt = Date.now() + (Number(expiresIn) || 3600) * 1000;
    if (localId) this.uid = localId;
    if (email) this.email = email;

    this.settings.patch({
      refreshToken,
      auth: { email: this.email, userId: this.uid },
    });

    this.emit('signed-in', { uid: this.uid, email: this.email });
  }

  /** Signs in, creating the account automatically the first time. */
  async signIn({ email, password }) {
    try {
      const result = await this.post(`${IDENTITY}:signInWithPassword`, {
        email,
        password,
        returnSecureToken: true,
      });
      this.applySession(result);
      this.log?.info('Signed in to Firebase', { uid: this.uid });
      return { uid: this.uid, email: this.email, created: false };
    } catch (error) {
      const unknownAccount = ['EMAIL_NOT_FOUND', 'INVALID_LOGIN_CREDENTIALS'].includes(error.code);
      if (!unknownAccount) throw error;

      // No account yet - create it, but keep the original error if the address
      // exists with a different password.
      try {
        const created = await this.post(`${IDENTITY}:signUp`, { email, password, returnSecureToken: true });
        this.applySession(created);
        this.log?.info('Created a Firebase account', { uid: this.uid });
        return { uid: this.uid, email: this.email, created: true };
      } catch (signUpError) {
        if (signUpError.code === 'EMAIL_EXISTS') throw new AuthError('INVALID_PASSWORD');
        throw signUpError;
      }
    }
  }

  /** Exchanges the refresh token for a new id token; callers share one request. */
  async refresh() {
    if (this.refreshing) return this.refreshing;

    const token = this.refreshToken;
    if (!token) throw new AuthError('SIGNED_OUT', 'Not signed in.');

    this.refreshing = (async () => {
      try {
        const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token });
        const response = await fetch(`${SECURE_TOKEN}?key=${encodeURIComponent(this.apiKey)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });

        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          const code = String(json?.error?.message || 'REFRESH_FAILED').split(':')[0].trim();
          if (['TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN'].includes(code)) {
            this.signOutLocal();
          }
          throw new AuthError(code, 'Session expired - sign in again.');
        }

        this.applySession({
          idToken: json.id_token,
          refreshToken: json.refresh_token,
          expiresIn: json.expires_in,
          localId: json.user_id,
          email: this.email,
        });

        this.log?.debug('Firebase token refreshed');
        return this.idToken;
      } finally {
        this.refreshing = null;
      }
    })();

    return this.refreshing;
  }

  /** A valid id token, refreshed when it is within 5 minutes of expiry. */
  async ensureToken() {
    if (this.idToken && Date.now() < this.expiresAt - 5 * 60 * 1000) return this.idToken;
    return this.refresh();
  }

  signOutLocal() {
    this.idToken = null;
    this.expiresAt = 0;
    this.uid = null;
    this.settings.patch({ refreshToken: null, auth: { email: null, userId: null } });
    this.emit('signed-out');
  }

  async signOut() {
    this.email = null;
    this.signOutLocal();
  }
}

module.exports = { FirebaseAuth, AuthError };
