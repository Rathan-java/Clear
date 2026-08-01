'use strict';

/** 16-bit PCM helpers. No dependencies - a WAV header is 44 bytes. */

const encodeWav = (pcm, { sampleRate = 16000, channels = 1 } = {}) => {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bytesPerSample * 8, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
};

/** Root-mean-square level of an Int16 buffer, normalised to 0..1. */
const rms = (buffer) => {
  const samples = Math.floor(buffer.length / 2);
  if (!samples) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i += 1) {
    const value = buffer.readInt16LE(i * 2) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / samples);
};

/** Peak absolute level, useful for the UI meter (reacts faster than RMS). */
const peak = (buffer) => {
  const samples = Math.floor(buffer.length / 2);
  let max = 0;
  for (let i = 0; i < samples; i += 1) {
    const value = Math.abs(buffer.readInt16LE(i * 2)) / 32768;
    if (value > max) max = value;
  }
  return max;
};

const durationMs = (byteLength, sampleRate = 16000) => (byteLength / 2 / sampleRate) * 1000;

module.exports = { encodeWav, rms, peak, durationMs };
