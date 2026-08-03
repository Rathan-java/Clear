'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * Settings live in %APPDATA%/Clear/settings.json.
 *
 * Secrets (Gemini key, refresh token) are encrypted with Electron safeStorage,
 * which on Windows is DPAPI scoped to the current user account - so the file is
 * useless if copied to another machine. If safeStorage is unavailable we refuse
 * to write the secret in plaintext and keep it in memory for the session only.
 */

const DEFAULTS = {
  // Firebase web config. Neither value is a secret - they identify the project,
  // they do not grant access. Security comes from Auth plus the Firestore rules.
  firebase: {
    apiKey: '',
    projectId: '',
  },
  gemini: {
    model: 'gemini-2.5-flash',
    transcribeModel: 'gemini-2.5-flash',
    temperature: 0.3,
    maxOutputTokens: 700,
    answerStyle: 'concise', // concise | detailed
  },
  audio: {
    mode: 'loopback', // loopback | device | ffmpeg
    deviceId: 'system-loopback',
    deviceLabel: 'System audio (default playback device)',
    ffmpegDevice: '',
    sampleRate: 16000,
    silenceMs: 900,
    minSpeechMs: 600,
    maxSegmentMs: 14000,
    vadSensitivity: 0.55, // 0..1, higher = picks up quieter speech
  },
  behaviour: {
    autoStartCapture: false,
    answerOnlyQuestions: true,
    startMinimised: false,
    minimiseToTray: true,
    autoLaunch: false,
    sendTranscriptToCloud: true,
    notifyOnAnswer: true,
  },
  ui: {
    theme: 'dark',
    alwaysOnTop: false,
  },
  device: {
    id: null,
    name: null,
  },
  auth: {
    email: null,
    userId: null,
  },
};

const SECRET_KEYS = ['geminiApiKey', 'refreshToken'];

const deepMerge = (base, override) => {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out;
};

class SettingsStore extends EventEmitter {
  constructor({ userDataPath, safeStorage, logger }) {
    super();
    this.file = path.join(userDataPath, 'settings.json');
    this.safeStorage = safeStorage;
    this.log = logger;
    this.data = { ...DEFAULTS };
    this.secrets = {}; // decrypted, in memory only
    this.load();
  }

  get encryptionAvailable() {
    try {
      return Boolean(this.safeStorage?.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        const { _secrets, ...rest } = raw;
        this.data = deepMerge(DEFAULTS, rest);
        this.decryptSecrets(_secrets || {});
      }
    } catch (error) {
      this.log?.error('Failed to read settings, falling back to defaults', { error: error.message });
      this.data = { ...DEFAULTS };
    }

    // Environment variables bootstrap a fresh install (useful in dev / CI).
    if (process.env.CLEAR_FIREBASE_API_KEY) this.data.firebase.apiKey = process.env.CLEAR_FIREBASE_API_KEY;
    if (process.env.CLEAR_FIREBASE_PROJECT_ID) this.data.firebase.projectId = process.env.CLEAR_FIREBASE_PROJECT_ID;
    if (process.env.GEMINI_API_KEY && !this.secrets.geminiApiKey) {
      this.secrets.geminiApiKey = process.env.GEMINI_API_KEY;
    }
    if (process.env.GEMINI_MODEL) this.data.gemini.model = process.env.GEMINI_MODEL;
    if (process.env.GEMINI_TRANSCRIBE_MODEL) this.data.gemini.transcribeModel = process.env.GEMINI_TRANSCRIBE_MODEL;

    if (!this.data.device.id) {
      this.data.device.id = `desktop-${require('crypto').randomBytes(8).toString('hex')}`;
    }
    if (!this.data.device.name) {
      this.data.device.name = `${require('os').hostname()}`;
    }
  }

  decryptSecrets(encrypted) {
    for (const key of SECRET_KEYS) {
      const value = encrypted[key];
      if (!value) continue;
      try {
        if (value.startsWith('enc:') && this.encryptionAvailable) {
          this.secrets[key] = this.safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
        } else if (value.startsWith('plain:')) {
          this.secrets[key] = value.slice(6);
        }
      } catch (error) {
        this.log?.warn('Could not decrypt a stored secret - it will need re-entering', { key });
      }
    }
  }

  encryptSecrets() {
    const out = {};
    for (const key of SECRET_KEYS) {
      const value = this.secrets[key];
      if (!value) continue;
      if (this.encryptionAvailable) {
        out[key] = `enc:${this.safeStorage.encryptString(value).toString('base64')}`;
      } else {
        this.log?.warn('safeStorage unavailable - secret kept in memory only', { key });
      }
    }
    return out;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const payload = { ...this.data, _secrets: this.encryptSecrets() };
      fs.writeFileSync(this.file, JSON.stringify(payload, null, 2), { mode: 0o600 });
    } catch (error) {
      this.log?.error('Failed to persist settings', { error: error.message });
    }
  }

  get(pathString) {
    if (!pathString) return this.data;
    return pathString.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), this.data);
  }

  /** Merge a partial settings object, persist, and notify listeners. */
  patch(partial = {}) {
    const { geminiApiKey, refreshToken, ...rest } = partial;

    if (geminiApiKey !== undefined) this.setSecret('geminiApiKey', geminiApiKey);
    if (refreshToken !== undefined) this.setSecret('refreshToken', refreshToken);

    this.data = deepMerge(this.data, rest);
    this.save();
    this.emit('changed', this.data);
    return this.public();
  }

  setSecret(key, value) {
    if (value === null || value === '') delete this.secrets[key];
    else this.secrets[key] = String(value);
    this.save();
  }

  getSecret(key) {
    return this.secrets[key] || null;
  }

  /** Everything the renderer is allowed to see - secrets reduced to a boolean. */
  public() {
    return {
      ...this.data,
      hasGeminiKey: Boolean(this.secrets.geminiApiKey),
      geminiKeyPreview: this.secrets.geminiApiKey
        ? `${this.secrets.geminiApiKey.slice(0, 4)}...${this.secrets.geminiApiKey.slice(-4)}`
        : null,
      encryptionAvailable: this.encryptionAvailable,
      settingsPath: this.file,
    };
  }

  reset() {
    this.data = { ...DEFAULTS };
    this.secrets = {};
    this.save();
    this.emit('changed', this.data);
  }
}

module.exports = { SettingsStore, DEFAULTS };
