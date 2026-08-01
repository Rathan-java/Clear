'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

/**
 * Optional third capture backend.
 *
 * Chromium's loopback follows the Windows *default* playback device. When you
 * need to pin a specific endpoint - a USB conference speaker while music plays
 * on the laptop speakers, or a "Stereo Mix" / virtual cable device - FFmpeg's
 * DirectShow input gives you that control.
 *
 * Emits: 'pcm' (Buffer, 16-bit LE mono @ sampleRate), 'error', 'exit'
 */

const resolveFfmpegPath = () => {
  if (process.env.CLEAR_FFMPEG_PATH) return process.env.CLEAR_FFMPEG_PATH;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) {
      // In a packaged app the binary is unpacked next to app.asar.
      return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
    }
  } catch {
    /* optional dependency not installed */
  }
  return 'ffmpeg'; // fall back to PATH
};

class FfmpegCapture extends EventEmitter {
  constructor({ logger, sampleRate = 16000 } = {}) {
    super();
    this.log = logger;
    this.sampleRate = sampleRate;
    this.process = null;
    this.ffmpegPath = resolveFfmpegPath();
  }

  get available() {
    return Boolean(this.ffmpegPath);
  }

  /** Parses `ffmpeg -list_devices true -f dshow -i dummy` (writes to stderr). */
  listDevices() {
    return new Promise((resolve) => {
      const child = spawn(this.ffmpegPath, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
        windowsHide: true,
      });

      let stderr = '';
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      const finish = () => {
        const devices = [];
        const lines = stderr.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          const match = lines[i].match(/"([^"]+)"\s*(?:\((audio|video)\))?/);
          if (!match) continue;
          const isAudio = /\(audio\)/.test(lines[i]) || /\(audio\)/.test(lines[i + 1] || '');
          if (!isAudio) continue;
          devices.push({
            id: `ffmpeg:${match[1]}`,
            label: match[1],
            kind: 'ffmpeg',
            mode: 'ffmpeg',
            description: 'DirectShow capture device (FFmpeg)',
          });
        }
        resolve(devices);
      };

      child.on('error', (error) => {
        this.log?.warn('FFmpeg not available for device enumeration', { error: error.message });
        resolve([]);
      });
      child.on('close', finish);
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }, 5000).unref?.();
    });
  }

  start(deviceName) {
    this.stop();

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'dshow',
      '-audio_buffer_size',
      '80',
      '-i',
      `audio=${deviceName}`,
      '-ac',
      '1',
      '-ar',
      String(this.sampleRate),
      '-acodec',
      'pcm_s16le',
      '-f',
      's16le',
      '-',
    ];

    this.log?.info('Starting FFmpeg capture', { device: deviceName, path: this.ffmpegPath });
    this.process = spawn(this.ffmpegPath, args, { windowsHide: true });

    this.process.stdout.on('data', (chunk) => this.emit('pcm', chunk));
    this.process.stderr.on('data', (data) => {
      const message = data.toString().trim();
      if (message) this.log?.warn('ffmpeg', { message: message.slice(0, 300) });
    });
    this.process.on('error', (error) => this.emit('error', error));
    this.process.on('close', (code) => {
      this.process = null;
      this.emit('exit', code);
    });

    return true;
  }

  stop() {
    if (!this.process) return;
    try {
      this.process.kill('SIGKILL');
    } catch {
      /* already dead */
    }
    this.process = null;
  }

  get running() {
    return Boolean(this.process);
  }
}

module.exports = { FfmpegCapture, resolveFfmpegPath };
