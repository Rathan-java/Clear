'use strict';

const { EventEmitter } = require('events');

/**
 * Pipeline
 * --------
 * The one place that knows the whole flow:
 *
 *   speaker audio -> AudioCaptureService -> SpeechService (STT + question
 *   detection) -> AiService (Gemini or OpenAI) -> Firestore -> phone
 *
 * The phone is never contacted directly. The answer is written to Firestore and
 * the phone's live listener picks it up, wherever it happens to be.
 *
 * It also owns the single app-state object the dashboard and tray render from.
 */

const MAX_TRANSCRIPT_LINES = 60;
const MAX_ANSWERS = 30;

class Pipeline extends EventEmitter {
  constructor({ audio, speech, ai, sync, auth, settings, logger }) {
    super();
    this.audio = audio;
    this.speech = speech;
    this.ai = ai;
    this.sync = sync;
    this.auth = auth;
    this.settings = settings;
    this.log = logger;

    this.running = false;
    this.thinking = false;
    this.lastAnswerAt = 0;
    this.answerLatencies = [];

    this.state = {
      running: false,
      thinking: false,
      auth: { signedIn: false, email: null },
      capture: audio.state(),
      connection: sync.status(),
      ai: ai.metrics(),
      speech: speech.metrics(),
      transcript: { live: '', lines: [] },
      question: null,
      answer: null,
      answers: [],
      stats: { questions: 0, answers: 0, avgAnswerMs: null, lastAnswerMs: null, errors: 0 },
      notice: null,
    };

    this.wire();
  }

  wire() {
    // --- audio -> speech ---------------------------------------------------
    this.audio.on('pcm', (chunk) => this.speech.streamAudio(chunk));
    this.audio.on('level', ({ level }) => {
      this.state.capture.level = level;
      this.emitState({ quiet: true });
    });
    this.audio.on('state', (state) => {
      this.state.capture = state;
      this.emitState();
    });
    this.audio.on('error', (error) => {
      this.state.notice = { type: 'error', message: `Audio: ${error.message}` };
      this.state.running = false;
      this.running = false;
      this.emitState();
    });
    this.audio.on('devices', () => this.emitState());

    this.speech.on('speech-start', () => {
      this.state.transcript.live = 'Listening...';
      this.emitState({ quiet: true });
    });

    // --- speech -> gemini --------------------------------------------------
    this.speech.on('result', (result) => this.handleTranscript(result));
    this.speech.on('error', (error) => {
      this.state.stats.errors += 1;
      this.state.notice = { type: 'warn', message: `Transcription: ${error.message}` };
      this.emitState();
    });

    // --- cloud sync --------------------------------------------------------
    this.sync.on('status', (status) => {
      this.state.connection = status;
      this.emitState({ quiet: true });
    });
    this.sync.on('presence', () => this.emitState({ quiet: true }));
  }

  emitState({ quiet = false } = {}) {
    this.state.running = this.running;
    this.state.thinking = this.thinking;
    this.state.ai = this.ai.metrics();
    this.state.speech = this.speech.metrics();
    this.state.auth = {
      signedIn: this.auth.signedIn,
      email: this.settings.get('auth.email'),
      userId: this.settings.get('auth.userId'),
      configured: this.auth.configured,
    };
    this.emit('state', this.state, { quiet });
  }

  // ---- the flow -----------------------------------------------------------

  async handleTranscript({ transcript, question, durationMs, transcribeMs, at }) {
    const line = {
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: transcript,
      isQuestion: Boolean(question),
      at: at || new Date().toISOString(),
      durationMs,
      transcribeMs,
    };

    this.state.transcript.live = transcript;
    this.state.transcript.lines.push(line);
    if (this.state.transcript.lines.length > MAX_TRANSCRIPT_LINES) this.state.transcript.lines.shift();
    if (question) {
      this.state.question = { text: question, at: line.at };
      this.state.stats.questions += 1;
    }
    this.emitState();

    // Publish the transcript too (opt-out for the privacy conscious).
    if (this.settings.get('behaviour.sendTranscriptToCloud')) {
      this.sync
        .sendTranscript({ text: transcript, isQuestion: Boolean(question) })
        .catch((error) => this.log?.debug('transcript write failed', { error: error.message }));
    }

    const onlyQuestions = this.settings.get('behaviour.answerOnlyQuestions');
    if (onlyQuestions && !question) return;

    // Do not stack answers on top of each other; the last question wins.
    if (this.thinking) {
      this.log?.debug('Skipping answer - one is already in flight');
      return;
    }

    await this.answer({ transcript, question });
  }

  /** Runs the model and ships the result. Also used by "Ask manually" in the UI. */
  async answer({ transcript, question = '', manual = false }) {
    if (!this.ai.configured) {
      const provider = this.ai.providerId === 'openai' ? 'OpenAI' : 'Gemini';
      this.state.notice = { type: 'error', message: `Add your ${provider} API key in Settings` };
      this.emitState();
      return null;
    }

    this.thinking = true;
    this.emitState();
    const startedAt = Date.now();

    try {
      const result = await this.ai.generateAnswer(question || transcript, {
        context: this.speech.context({ lines: 5 }),
      });

      // The model decided this was not a question after all.
      if (!result.answer || (!result.question && !manual && this.settings.get('behaviour.answerOnlyQuestions'))) {
        this.log?.debug('No question found to answer');
        return null;
      }

      const latencyMs = Date.now() - startedAt;
      const answer = {
        id: `a-${Date.now()}`,
        question: result.question || question || '',
        answer: result.answer,
        summary: result.summary,
        transcript,
        latencyMs,
        model: result.model,
        at: new Date().toISOString(),
        manual,
      };

      this.state.answer = answer;
      this.state.answers.unshift(answer);
      if (this.state.answers.length > MAX_ANSWERS) this.state.answers.pop();
      this.state.stats.answers += 1;
      this.state.stats.lastAnswerMs = latencyMs;
      this.answerLatencies.push(latencyMs);
      if (this.answerLatencies.length > 20) this.answerLatencies.shift();
      this.state.stats.avgAnswerMs = Math.round(
        this.answerLatencies.reduce((a, b) => a + b, 0) / this.answerLatencies.length
      );
      this.lastAnswerAt = Date.now();

      this.emit('answer', answer);

      // Straight to Firestore; the phone's listener does the rest. If the write
      // fails it is queued and retried on the next heartbeat, so nothing is lost.
      const delivery = await this.sync.sendAnswer({
        question: answer.question,
        answer: answer.answer,
        summary: answer.summary,
        transcript: answer.transcript,
        latencyMs,
        model: answer.model,
      });

      if (delivery?.queued) {
        this.log?.warn('Answer queued until Firestore is reachable again');
        this.state.notice = { type: 'warn', message: 'Offline - answers will sync when reconnected' };
      }

      return answer;
    } catch (error) {
      this.state.stats.errors += 1;
      this.state.notice = { type: 'error', message: `${this.ai.providerId}: ${error.message}` };
      this.log?.error('Answer generation failed', { error: error.message });
      return null;
    } finally {
      this.thinking = false;
      this.emitState();
    }
  }

  // ---- lifecycle ----------------------------------------------------------

  async start() {
    if (this.running) return this.state;

    if (!this.ai.configured) {
      const provider = this.ai.providerId === 'openai' ? 'OpenAI' : 'Gemini';
      throw new Error(`Add your ${provider} API key in Settings before starting`);
    }

    this.speech.reset();
    this.speech.enabled = true;
    await this.audio.startCapture();

    this.running = true;
    this.state.notice = { type: 'info', message: 'Listening' };
    this.log?.info('Pipeline started');
    this.emitState();

    if (this.auth.signedIn && !this.sync.meetingId) {
      this.sync.startMeeting().catch(() => {});
    }

    return this.state;
  }

  async stop({ endMeeting = false } = {}) {
    if (!this.running) return this.state;

    this.speech.enabled = false;
    await this.audio.stopCapture();
    this.running = false;
    this.state.transcript.live = '';
    this.state.notice = { type: 'info', message: 'Stopped' };
    this.log?.info('Pipeline stopped');

    if (endMeeting) await this.sync.endMeeting().catch(() => {});

    this.emitState();
    return this.state;
  }

  async toggle() {
    return this.running ? this.stop() : this.start();
  }

  clearTranscript() {
    this.state.transcript = { live: '', lines: [] };
    this.state.question = null;
    this.speech.reset();
    this.emitState();
  }

  snapshot() {
    this.state.running = this.running;
    this.state.thinking = this.thinking;
    this.state.capture = this.audio.state();
    this.state.connection = this.sync.status();
    this.state.ai = this.ai.metrics();
    this.state.speech = this.speech.metrics();
    this.state.auth = {
      signedIn: this.auth.signedIn,
      email: this.settings.get('auth.email'),
      userId: this.settings.get('auth.userId'),
      configured: this.auth.configured,
    };
    return this.state;
  }

  destroy() {
    this.removeAllListeners();
  }
}

module.exports = { Pipeline };
