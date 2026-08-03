'use strict';

const { EventEmitter } = require('events');
const { encodeWav, rms, durationMs } = require('../audio/wav');

/**
 * SpeechService
 * -------------
 * Continuous speech-to-text over a raw PCM stream.
 *
 *   streamAudio(chunk)   feed 16 kHz mono 16-bit PCM; segments it on silence
 *   transcribe(pcm)      turn one segment into text (Gemini audio input)
 *   detectQuestion(text) pull the question out of a line of transcript
 *
 * Emits 'result' with exactly the shape the spec asks for:
 *   { "transcript": "", "question": "" }
 *
 * Voice activity detection is energy based with an adaptive noise floor, so it
 * copes with the very different levels you get from a Bluetooth headset versus
 * a loopback capture of laptop speakers.
 */

const QUESTION_WORDS = [
  'what', 'why', 'how', 'when', 'where', 'who', 'whom', 'whose', 'which',
];

const AUXILIARIES = [
  'is', 'are', 'was', 'were', 'am', 'do', 'does', 'did', 'can', 'could', 'will',
  'would', 'should', 'shall', 'have', 'has', 'had', 'may', 'might', 'must',
];

const SOFT_ASKS = [
  'any thoughts', 'thoughts on', 'what do you think', 'tell me about', 'walk me through',
  'talk us through', 'explain', 'your take on', 'curious about', 'wondering if',
  'let me know', 'give us', 'help me understand', 'any idea', 'over to you',
];

class SpeechService extends EventEmitter {
  constructor({ ai, settings, logger }) {
    super();
    this.ai = ai;
    this.settings = settings;
    this.log = logger;

    this.buffer = [];
    this.bufferBytes = 0;
    this.speaking = false;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.noiseFloor = 0.004;
    this.queue = Promise.resolve();
    this.pendingSegments = 0;
    this.history = []; // recent final transcripts, used as Gemini context
    this.stats = { segments: 0, transcribed: 0, empty: 0, errors: 0, words: 0 };
    this.enabled = true;
  }

  get config() {
    const audio = this.settings.get('audio') || {};
    return {
      sampleRate: audio.sampleRate || 16000,
      silenceMs: audio.silenceMs ?? 900,
      minSpeechMs: audio.minSpeechMs ?? 600,
      maxSegmentMs: audio.maxSegmentMs ?? 14000,
      sensitivity: audio.vadSensitivity ?? 0.55,
    };
  }

  /**
   * streamAudio(chunk) - the hot path. Cheap arithmetic only; anything that
   * touches the network is deferred to the segment queue.
   */
  streamAudio(chunk) {
    if (!this.enabled || !chunk?.length) return;

    const { sampleRate, silenceMs, minSpeechMs, maxSegmentMs, sensitivity } = this.config;
    const chunkMs = durationMs(chunk.length, sampleRate);
    const level = rms(chunk);

    // Adaptive noise floor: falls fast toward quiet, rises slowly.
    this.noiseFloor =
      level < this.noiseFloor ? this.noiseFloor * 0.9 + level * 0.1 : this.noiseFloor * 0.995 + level * 0.005;

    // sensitivity 0..1 -> multiplier ~4.5x (deaf) down to ~1.8x (twitchy)
    const multiplier = 4.5 - sensitivity * 2.7;
    const threshold = Math.max(this.noiseFloor * multiplier, 0.0045);
    const isSpeech = level > threshold;

    if (isSpeech) {
      if (!this.speaking) {
        this.speaking = true;
        this.emit('speech-start', { level });
      }
      this.speechMs += chunkMs;
      this.silenceMs = 0;
      this.push(chunk);
    } else if (this.speaking) {
      this.silenceMs += chunkMs;
      this.push(chunk); // keep trailing silence, it helps the model hear the end
      if (this.silenceMs >= silenceMs) {
        const spoken = this.speechMs;
        const segment = this.flushBuffer();
        this.speaking = false;
        this.speechMs = 0;
        this.silenceMs = 0;
        if (spoken >= minSpeechMs) this.enqueue(segment, spoken);
        else this.log?.debug('Dropped a sub-threshold blip', { spokenMs: Math.round(spoken) });
      }
    } else {
      // Keep ~300 ms of pre-roll so the first syllable is not clipped.
      this.push(chunk);
      const preRollBytes = Math.floor((300 / 1000) * sampleRate * 2);
      while (this.bufferBytes > preRollBytes && this.buffer.length > 1) {
        this.bufferBytes -= this.buffer.shift().length;
      }
    }

    // Hard cut for someone who never pauses.
    if (this.speaking && durationMs(this.bufferBytes, sampleRate) >= maxSegmentMs) {
      const spoken = this.speechMs;
      const segment = this.flushBuffer();
      this.speechMs = 0;
      this.silenceMs = 0;
      this.enqueue(segment, spoken, { truncated: true });
    }
  }

  push(chunk) {
    this.buffer.push(chunk);
    this.bufferBytes += chunk.length;
  }

  flushBuffer() {
    const segment = Buffer.concat(this.buffer, this.bufferBytes);
    this.buffer = [];
    this.bufferBytes = 0;
    return segment;
  }

  /** Segments are transcribed one at a time so their order is preserved. */
  enqueue(pcm, spokenMs, meta = {}) {
    this.stats.segments += 1;
    this.pendingSegments += 1;
    this.emit('segment', { bytes: pcm.length, spokenMs: Math.round(spokenMs), ...meta });

    this.queue = this.queue
      .then(async () => {
        const startedAt = Date.now();
        try {
          const transcript = await this.transcribe(pcm);
          if (!transcript) {
            this.stats.empty += 1;
            return;
          }

          this.stats.transcribed += 1;
          this.stats.words += transcript.split(/\s+/).filter(Boolean).length;

          const question = this.detectQuestion(transcript);
          const result = { transcript, question };

          this.history.push(transcript);
          if (this.history.length > 12) this.history.shift();

          this.log?.info('Transcribed segment', {
            chars: transcript.length,
            ms: Date.now() - startedAt,
            question: Boolean(question),
          });

          this.emit('result', {
            ...result,
            isQuestion: Boolean(question),
            durationMs: Math.round(spokenMs),
            transcribeMs: Date.now() - startedAt,
            at: new Date().toISOString(),
          });
        } catch (error) {
          this.stats.errors += 1;
          this.log?.error('Transcription failed', { error: error.message });
          this.emit('error', error);
        } finally {
          this.pendingSegments -= 1;
        }
      })
      .catch(() => {
        this.pendingSegments = Math.max(0, this.pendingSegments - 1);
      });
  }

  /** transcribe(pcmBuffer) -> string */
  async transcribe(pcm) {
    const { sampleRate } = this.config;
    const wav = encodeWav(pcm, { sampleRate, channels: 1 });
    const hint = this.history.slice(-2).join(' ').slice(-300);
    const text = await this.ai.transcribeAudio(wav, { mimeType: 'audio/wav', hint });
    return cleanTranscript(text);
  }

  /**
   * detectQuestion(text) -> the question, or '' when there isn't one.
   * Runs locally on every line so we only pay for a Gemini answer when a
   * question was actually asked.
   */
  detectQuestion(text) {
    const clean = String(text || '').trim();
    if (!clean) return '';

    // Split into sentences, keeping their terminators.
    const sentences = clean.match(/[^.!?]+[.!?]*/g) || [clean];

    for (let i = sentences.length - 1; i >= 0; i -= 1) {
      const sentence = sentences[i].trim();
      if (sentence.length < 6) continue;

      const lower = sentence.toLowerCase();
      const words = lower.replace(/[^a-z0-9'\s]/g, '').split(/\s+/).filter(Boolean);
      if (words.length < 3) continue;

      const endsWithMark = /\?\s*$/.test(sentence);
      const startsInterrogative = QUESTION_WORDS.includes(words[0]) || AUXILIARIES.includes(words[0]);
      const embeddedWh = words.slice(0, 6).some((w, idx) => idx > 0 && QUESTION_WORDS.includes(w));
      const soft = SOFT_ASKS.some((phrase) => lower.includes(phrase));
      const tag = /(right|correct|okay|ok|yeah|no)\s*\?$/.test(lower);

      // Statements that merely contain "how" ("that's how we did it") should not
      // fire. Contractions count: "that's", "they're", "it'll".
      const declarative =
        /^(that|this|it|we|i|they|he|she|there)(?:'\w+)?\s/.test(lower) && !endsWithMark && !soft;

      if (endsWithMark || tag || (startsInterrogative && !declarative) || soft || (embeddedWh && !declarative)) {
        return sentence.replace(/\s+/g, ' ').trim();
      }
    }

    return '';
  }

  /** The recent conversation, given to Gemini as context for pronouns. */
  context({ lines = 6 } = {}) {
    return this.history.slice(-lines).join('\n');
  }

  reset() {
    this.buffer = [];
    this.bufferBytes = 0;
    this.speaking = false;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.history = [];
  }

  metrics() {
    return { ...this.stats, pendingSegments: this.pendingSegments, noiseFloor: Number(this.noiseFloor.toFixed(5)) };
  }
}

/** Strips the little artefacts models add around raw transcription. */
const cleanTranscript = (text) => {
  if (!text) return '';
  let out = String(text).trim();
  out = out.replace(/^(transcript|transcription)\s*:\s*/i, '');
  out = out.replace(/^\[(silence|inaudible|no speech|music|background noise)\]$/i, '');
  out = out.replace(/\[(inaudible|unintelligible|crosstalk)\]/gi, '').trim();
  out = out.replace(/\s+/g, ' ');
  if (/^[^a-z0-9]*$/i.test(out)) return '';
  return out;
};

module.exports = { SpeechService, cleanTranscript };
