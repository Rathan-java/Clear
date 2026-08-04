/**
 * Audio engine (renderer side).
 *
 * The renderer is the only process with an AudioContext, so it does the actual
 * capture and resampling; the main process only ever sees 16 kHz mono 16-bit
 * PCM Buffers. Commands arrive on "capture:command", results go back through
 * window.clear.sendCapture().
 *
 * Three modes:
 *   loopback  getDisplayMedia -> main returns { audio: 'loopback' } = WASAPI
 *             loopback of the Windows default playback device. This is what
 *             hears the other people in the meeting, whether you are on a
 *             Bluetooth headset, a USB headset or the laptop speakers.
 *   device    getUserMedia on a specific capture endpoint.
 *   ffmpeg    handled entirely in the main process (not here).
 */

const WORKLET_SOURCE = `
class ClearCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frameSize = (options.processorOptions && options.processorOptions.frameSize) || 1024;
    this.buffer = new Float32Array(this.frameSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];

    for (let i = 0; i < channel.length; i += 1) {
      this.buffer[this.offset] = channel[i];
      this.offset += 1;
      if (this.offset === this.frameSize) {
        this.port.postMessage(this.buffer.slice(0));
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('clear-capture', ClearCaptureProcessor);
`;

const FRAME_SIZE = 1024; // 64 ms at 16 kHz

const floatToInt16 = (input) => {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
};

const peakOf = (input) => {
  let max = 0;
  for (let i = 0; i < input.length; i += 1) {
    const value = Math.abs(input[i]);
    if (value > max) max = value;
  }
  return max;
};

class CaptureEngine {
  constructor() {
    this.stream = null;
    this.context = null;
    this.source = null;
    this.node = null;
    this.workletUrl = null;
    this.running = false;
    this.label = null;
    this.lastLevelSentAt = 0;
    this.onLevel = null;
  }

  send(message) {
    window.clear?.sendCapture(message);
  }

  /** Device labels are only exposed after a permission grant. */
  async enumerate() {
    let granted = false;
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((track) => track.stop());
      granted = true;
    } catch {
      /* no mic permission - we can still list ids, just without labels */
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      permissionGranted: granted,
      devices: devices
        .filter((device) => device.kind === 'audioinput')
        .map((device) => ({
          deviceId: device.deviceId,
          label: device.label || `Audio input ${device.deviceId.slice(0, 6)}`,
          kind: device.kind,
          groupId: device.groupId,
        })),
    };
  }

  async getStream({ mode, deviceId }) {
    if (mode === 'loopback') {
      // The main process answers this with { video: screen, audio: 'loopback' }.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // We only want the audio; drop the video track immediately.
      stream.getVideoTracks().forEach((track) => {
        track.stop();
        stream.removeTrack(track);
      });

      if (!stream.getAudioTracks().length) {
        throw new Error(
          'Windows did not return a system audio stream. Check that a playback device is active and try again.'
        );
      }

      this.label = stream.getAudioTracks()[0].label || 'System audio';
      return stream;
    }

    const constraints = {
      audio: {
        ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.label = stream.getAudioTracks()[0]?.label || 'Audio input';
    return stream;
  }

  async start({ mode = 'loopback', deviceId, sampleRate = 16000 }) {
    await this.stop();

    this.stream = await this.getStream({ mode, deviceId });

    // Asking for a 16 kHz context makes Chromium resample for us, whatever the
    // device is actually running at (Bluetooth 16k, USB 48k, loopback 48k...).
    this.context = new AudioContext({ sampleRate, latencyHint: 'interactive' });
    if (this.context.state === 'suspended') await this.context.resume();

    this.source = this.context.createMediaStreamSource(this.stream);

    const handleFrame = (float32) => {
      const pcm = floatToInt16(float32);
      this.send({ type: 'pcm', chunk: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength) });

      const now = performance.now();
      if (now - this.lastLevelSentAt > 100) {
        this.lastLevelSentAt = now;
        const level = peakOf(float32);
        this.send({ type: 'level', level });
        this.onLevel?.(level);
      }
    };

    try {
      const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
      this.workletUrl = URL.createObjectURL(blob);
      await this.context.audioWorklet.addModule(this.workletUrl);

      this.node = new AudioWorkletNode(this.context, 'clear-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { frameSize: FRAME_SIZE },
      });
      this.node.port.onmessage = (event) => handleFrame(event.data);
      this.source.connect(this.node);
    } catch (error) {
      // Very old Chromium or a blocked blob URL: fall back to ScriptProcessor.
      // eslint-disable-next-line no-console
      console.warn('AudioWorklet unavailable, falling back to ScriptProcessor', error);
      this.node = this.context.createScriptProcessor(4096, 1, 1);
      this.node.onaudioprocess = (event) => handleFrame(event.inputBuffer.getChannelData(0));
      this.source.connect(this.node);
      // ScriptProcessor only ticks when connected to a destination; a muted gain
      // node keeps it running without playing the meeting back through the speakers.
      const mute = this.context.createGain();
      mute.gain.value = 0;
      this.node.connect(mute);
      mute.connect(this.context.destination);
      this.muteNode = mute;
    }

    // If the user revokes the share (or unplugs the device) we must not sit silent.
    this.stream.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        this.send({ type: 'stopped', reason: 'track-ended' });
        this.send({ type: 'error', error: 'The audio source stopped (device changed or sharing was revoked)' });
        this.stop();
      });
    });

    this.running = true;
    this.send({ type: 'started', label: this.label, mode, sampleRate: this.context.sampleRate });
    return { label: this.label, sampleRate: this.context.sampleRate };
  }

  async stop() {
    if (this.node) {
      try {
        this.node.port ? (this.node.port.onmessage = null) : (this.node.onaudioprocess = null);
        this.node.disconnect();
      } catch {
        /* already torn down */
      }
      this.node = null;
    }
    if (this.muteNode) {
      try {
        this.muteNode.disconnect();
      } catch {
        /* ignore */
      }
      this.muteNode = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        /* ignore */
      }
      this.context = null;
    }
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }

    if (this.running) {
      this.running = false;
      this.send({ type: 'stopped' });
    }
    return true;
  }
}

/**
 * Only ever one engine per window.
 *
 * React StrictMode runs effects twice in development, which installed two
 * engines: both answered every "start" command, both opened their own capture
 * stream, and both pushed PCM into the same buffer in the main process. The
 * result was interleaved frames from two streams - audio that no longer
 * decodes as speech. The give-away was "Capture started" appearing twice in
 * the log.
 */
let installed = null;

/** Installs the command listener. Safe to call more than once. */
export const installCaptureBridge = ({ onLevel } = {}) => {
  if (installed) {
    if (onLevel) installed.onLevel = onLevel;
    return installed;
  }

  const engine = new CaptureEngine();
  engine.onLevel = onLevel;
  installed = engine;

  const reply = (requestId, result, error) => {
    if (!requestId) return;
    window.clear.sendCapture({ type: 'reply', requestId, result, error: error ? String(error.message || error) : null });
  };

  const unsubscribe = window.clear.on('capture:command', async ({ command, requestId, payload }) => {
    try {
      switch (command) {
        case 'enumerate':
          reply(requestId, await engine.enumerate());
          break;
        case 'start':
          reply(requestId, await engine.start(payload || {}));
          break;
        case 'stop':
          reply(requestId, await engine.stop());
          break;
        default:
          reply(requestId, null, new Error(`Unknown capture command: ${command}`));
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('capture command failed', command, error);
      reply(requestId, null, error);
      window.clear.sendCapture({ type: 'error', error: String(error.message || error) });
    }
  });

  // Tell the main process the listener is attached; it holds its first
  // enumerate call until it sees this.
  window.clear.sendCapture({ type: 'ready' });

  window.addEventListener('beforeunload', () => {
    engine.stop();
    unsubscribe();
    installed = null;
  });

  return engine;
};

export default installCaptureBridge;
