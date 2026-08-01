'use strict';

const { EventEmitter } = require('events');
const { FfmpegCapture } = require('./FfmpegCapture');
const { peak, durationMs } = require('./wav');

/**
 * AudioCaptureService
 * -------------------
 * Owns "what are we listening to and is it running". Three backends:
 *
 *  loopback  WASAPI loopback of the current Windows playback device, via
 *            Chromium's getDisplayMedia + session.setDisplayMediaRequestHandler
 *            ({ audio: 'loopback' }). This is what you want for meetings: it
 *            hears everyone else in the call, through whatever you are wearing -
 *            Bluetooth headset, USB headset or the laptop speakers.
 *  device    A specific capture endpoint by deviceId (headset mic, USB mic,
 *            Stereo Mix), via getUserMedia in the renderer.
 *  ffmpeg    DirectShow capture in the main process, for pinning one endpoint
 *            regardless of the Windows default. See FfmpegCapture.
 *
 * The renderer does the actual Web Audio work (it is the only side with an
 * AudioContext) and streams 16 kHz mono 16-bit PCM back over IPC. Everything
 * downstream - SpeechService, Gemini, sockets - only ever sees Buffers.
 *
 * Events: 'pcm' (Buffer), 'level' ({level}), 'state' ({...}), 'error' (Error)
 */

const SYSTEM_LOOPBACK = {
  id: 'system-loopback',
  label: 'System audio (default playback device)',
  kind: 'loopback',
  mode: 'loopback',
  description: 'Hears everything you hear - Bluetooth, USB or laptop speakers',
  recommended: true,
};

class AudioCaptureService extends EventEmitter {
  constructor({ getWindow, settings, logger }) {
    super();
    this.getWindow = getWindow;
    this.settings = settings;
    this.log = logger;

    this.pending = new Map();
    this.requestSeq = 0;
    this.rendererReady = false;
    this._readyResolvers = [];

    this.devices = [SYSTEM_LOOPBACK];
    this.capturing = false;
    this.startedAt = null;
    this.bytesCaptured = 0;
    this.lastLevel = 0;
    this.lastError = null;

    const audio = settings.get('audio');
    this.selected = {
      mode: audio.mode || 'loopback',
      deviceId: audio.deviceId || SYSTEM_LOOPBACK.id,
      label: audio.deviceLabel || SYSTEM_LOOPBACK.label,
    };

    this.ffmpeg = new FfmpegCapture({ logger, sampleRate: audio.sampleRate || 16000 });
    this.ffmpeg.on('pcm', (chunk) => this.handlePcm(chunk));
    this.ffmpeg.on('error', (error) => this.fail(error));
    this.ffmpeg.on('exit', (code) => {
      if (this.capturing && this.selected.mode === 'ffmpeg') {
        this.fail(new Error(`FFmpeg capture stopped unexpectedly (exit ${code})`));
      }
    });
  }

  // ---- renderer plumbing --------------------------------------------------

  sendToRenderer(command, payload = {}, { expectReply = false, timeoutMs = 20000 } = {}) {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      return Promise.reject(new Error('Audio engine window is not ready yet'));
    }

    this.requestSeq += 1;
    const requestId = `req-${this.requestSeq}`;
    window.webContents.send('capture:command', { command, requestId, payload });

    if (!expectReply) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Audio engine did not respond to "${command}" in time`));
      }, timeoutMs);

      this.pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          this.pending.delete(requestId);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          this.pending.delete(requestId);
          reject(error);
        },
      });
    });
  }

  /**
   * Resolves once the renderer's capture bridge has attached its listener, so
   * we never fire a command into a window that cannot answer it yet.
   */
  whenReady({ timeoutMs = 15000 } = {}) {
    if (this.rendererReady) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this._readyResolvers.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** Called by the ipcMain bridge for every message the renderer sends up. */
  handleRendererMessage(message = {}) {
    switch (message.type) {
      case 'ready': {
        this.rendererReady = true;
        this.log?.debug('Audio engine ready');
        this._readyResolvers.splice(0).forEach((resolve) => resolve());
        this.emit('ready');
        return;
      }
      case 'reply': {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.result);
        return;
      }
      case 'pcm':
        this.handlePcm(Buffer.from(message.chunk));
        return;
      case 'level':
        this.lastLevel = message.level || 0;
        this.emit('level', { level: this.lastLevel });
        return;
      case 'started':
        this.capturing = true;
        this.startedAt = Date.now();
        this.lastError = null;
        if (message.label) this.selected.label = message.label;
        this.log?.info('Capture started', { ...this.selected });
        this.emitState();
        return;
      case 'stopped':
        this.capturing = false;
        this.log?.info('Capture stopped', { reason: message.reason || 'requested' });
        this.emitState();
        return;
      case 'error':
        this.fail(new Error(message.error || 'Unknown audio error'));
        return;
      default:
        this.log?.debug('Unhandled renderer audio message', { type: message.type });
    }
  }

  handlePcm(chunk) {
    if (!chunk?.length) return;
    this.bytesCaptured += chunk.length;
    if (this.selected.mode === 'ffmpeg') {
      // The renderer computes levels for the other backends; do it here for FFmpeg.
      this.lastLevel = peak(chunk);
      this.emit('level', { level: this.lastLevel });
    }
    this.emit('pcm', chunk);
  }

  fail(error) {
    this.lastError = error.message;
    this.capturing = false;
    this.log?.error('Audio capture error', { error: error.message });
    this.emit('error', error);
    this.emitState();
  }

  emitState() {
    this.emit('state', this.state());
  }

  // ---- public API ---------------------------------------------------------

  /**
   * listAudioDevices() -> [{ id, label, kind, mode, description }]
   * Always includes the system-loopback pseudo device first.
   */
  async listAudioDevices({ includeFfmpeg = true } = {}) {
    let rendererDevices = [];
    try {
      const result = await this.sendToRenderer('enumerate', {}, { expectReply: true, timeoutMs: 8000 });
      rendererDevices = (result?.devices || []).map((device) => ({
        id: device.deviceId,
        label: device.label || 'Audio input',
        kind: device.kind,
        mode: 'device',
        description: describeDevice(device.label),
        isDefault: device.deviceId === 'default',
      }));
    } catch (error) {
      this.log?.warn('Could not enumerate renderer devices', { error: error.message });
    }

    let ffmpegDevices = [];
    if (includeFfmpeg) {
      try {
        ffmpegDevices = await this.ffmpeg.listDevices();
      } catch (error) {
        this.log?.debug('FFmpeg enumeration skipped', { error: error.message });
      }
    }

    // De-dupe: FFmpeg and Chromium expose the same hardware under the same name.
    const seen = new Set(rendererDevices.map((d) => d.label.toLowerCase()));
    ffmpegDevices = ffmpegDevices.filter((d) => !seen.has(d.label.toLowerCase()));

    this.devices = [SYSTEM_LOOPBACK, ...rendererDevices, ...ffmpegDevices];
    this.emit('devices', this.devices);
    return this.devices;
  }

  /** selectDevice(deviceId) - persists the choice and restarts if we were live. */
  async selectDevice(deviceId) {
    const device =
      this.devices.find((d) => d.id === deviceId) ||
      (deviceId === SYSTEM_LOOPBACK.id ? SYSTEM_LOOPBACK : null);

    if (!device) throw new Error(`Unknown audio device: ${deviceId}`);

    const wasCapturing = this.capturing;
    if (wasCapturing) await this.stopCapture();

    this.selected = { mode: device.mode, deviceId: device.id, label: device.label };
    this.settings.patch({
      audio: {
        mode: device.mode,
        deviceId: device.id,
        deviceLabel: device.label,
        ffmpegDevice: device.mode === 'ffmpeg' ? device.label : this.settings.get('audio.ffmpegDevice'),
      },
    });

    this.log?.info('Audio device selected', { ...this.selected });
    this.emitState();

    if (wasCapturing) await this.startCapture();
    return this.selected;
  }

  async startCapture() {
    if (this.capturing) return this.state();

    const audio = this.settings.get('audio');
    this.bytesCaptured = 0;
    this.lastError = null;

    if (this.selected.mode === 'ffmpeg') {
      const deviceName = this.selected.label || audio.ffmpegDevice;
      if (!deviceName) throw new Error('No FFmpeg capture device selected');
      this.ffmpeg.start(deviceName);
      this.capturing = true;
      this.startedAt = Date.now();
      this.emitState();
      return this.state();
    }

    await this.sendToRenderer(
      'start',
      {
        mode: this.selected.mode,
        deviceId: this.selected.deviceId,
        sampleRate: audio.sampleRate || 16000,
      },
      { expectReply: true, timeoutMs: 20000 }
    );

    this.capturing = true;
    this.startedAt = Date.now();
    this.emitState();
    return this.state();
  }

  async stopCapture() {
    if (this.selected.mode === 'ffmpeg') {
      this.ffmpeg.stop();
    } else {
      try {
        await this.sendToRenderer('stop', {}, { expectReply: true, timeoutMs: 5000 });
      } catch (error) {
        this.log?.warn('Renderer did not confirm stop', { error: error.message });
      }
    }

    this.capturing = false;
    this.lastLevel = 0;
    this.emitState();
    return this.state();
  }

  state() {
    return {
      capturing: this.capturing,
      mode: this.selected.mode,
      deviceId: this.selected.deviceId,
      deviceLabel: this.selected.label,
      level: this.lastLevel,
      error: this.lastError,
      startedAt: this.startedAt,
      capturedMs: Math.round(durationMs(this.bytesCaptured, this.settings.get('audio.sampleRate') || 16000)),
      devices: this.devices,
    };
  }

  destroy() {
    this.ffmpeg.stop();
    this.pending.forEach((pending) => pending.reject(new Error('Shutting down')));
    this.pending.clear();
    this.removeAllListeners();
  }
}

const describeDevice = (label = '') => {
  const value = label.toLowerCase();
  if (/stereo mix|what u hear|loopback|virtual|cable/.test(value)) return 'Loopback-style device - hears system audio';
  if (/bluetooth|airpods|buds|wh-|wf-|jabra|hands-free/.test(value)) return 'Bluetooth headset';
  if (/usb|yeti|snowball|rode|shure|conference/.test(value)) return 'USB audio device';
  if (/array|internal|built-in|realtek|laptop/.test(value)) return 'Built-in laptop device';
  return 'Audio input device';
};

module.exports = { AudioCaptureService, SYSTEM_LOOPBACK };
