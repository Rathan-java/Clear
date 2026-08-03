'use strict';

const { EventEmitter } = require('events');

/**
 * Pipeline
 * --------
 * The one place that knows the whole flow:
 *
 *   speaker audio -> AudioCaptureService -> SpeechService (VAD + segmenting)
 *     -> AiService (Gemini or OpenAI) -> Firestore -> phone
 *
 * Two routes through the middle:
 *   fast      the audio goes straight to the answer model, which returns the
 *             transcript and the answer together. One round trip.
 *   standard  transcribe first, check locally for a question, and only then
 *             pay for an answer. Two round trips, fewer model calls.
 *
 * Answers stream. Partial text is pushed to the dashboard as it arrives and
 * written to Firestore periodically, so the phone fills in live rather than
 * waiting for the last token.
 */

const MAX_TRANSCRIPT_LINES = 60;
const MAX_ANSWERS = 30;
const PHONE_UPDATE_MS = 700; // how often a growing answer is pushed to Firestore

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
      stats: {
        questions: 0,
        answers: 0,
        avgAnswerMs: null,
        lastAnswerMs: null,
        lastFirstTokenMs: null,
        errors: 0,
      },
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

    // --- speech -> model ---------------------------------------------------
    this.speech.fastHandler = (payload) => this.handleAudioSegment(payload);
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

  // ---- shared bits --------------------------------------------------------

  recordTranscriptLine(text, isQuestion) {
    if (!text) return null;

    const line = {
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      isQuestion: Boolean(isQuestion),
      at: new Date().toISOString(),
    };

    this.state.transcript.live = text;
    this.state.transcript.lines.push(line);
    if (this.state.transcript.lines.length > MAX_TRANSCRIPT_LINES) this.state.transcript.lines.shift();

    if (isQuestion) {
      this.state.question = { text: isQuestion === true ? text : isQuestion, at: line.at };
      this.state.stats.questions += 1;
    }

    if (this.settings.get('behaviour.sendTranscriptToCloud')) {
      this.sync
        .sendTranscript({ text, isQuestion: Boolean(isQuestion) })
        .catch((error) => this.log?.debug('transcript write failed', { error: error.message }));
    }

    this.emitState();
    return line;
  }

  notConfigured() {
    const provider = this.ai.providerId === 'openai' ? 'OpenAI' : 'Gemini';
    this.state.notice = { type: 'error', message: `Add your ${provider} API key in Settings` };
    this.emitState();
  }

  /**
   * Shows a partially written answer on the dashboard, and pushes it to the
   * phone at most a couple of times a second.
   */
  makePartialHandler(draft) {
    return (partial) => {
      draft.answer = partial.answer;
      draft.summary = partial.summary;
      if (partial.question && !draft.question) draft.question = partial.question;

      this.state.answer = { ...draft, streaming: true };
      this.emitState({ quiet: true });

      if (!this.settings.get('behaviour.streamToPhone')) return;

      const now = Date.now();
      if (now - draft.lastPhoneWrite < PHONE_UPDATE_MS) return;
      draft.lastPhoneWrite = now;

      const payload = {
        question: draft.question || '',
        answer: partial.answer,
        summary: partial.summary,
        transcript: draft.transcript,
        model: draft.model,
        streaming: true,
      };

      // First write creates the document; later ones patch it in place, so the
      // phone's listener sees the answer grow.
      if (draft.docId) {
        this.sync.updateAnswer(draft.docId, payload).catch(() => {});
      } else if (!draft.creating) {
        draft.creating = true;
        this.sync
          .sendAnswer(payload)
          .then((saved) => {
            if (saved?.id) draft.docId = saved.id;
          })
          .catch(() => {})
          .finally(() => {
            draft.creating = false;
          });
      }
    };
  }

  /** Puts a finished answer into state and makes sure the phone has it. */
  async publishAnswer(result, { transcript, manual = false, draft }) {
    const answer = {
      id: draft?.id || `a-${Date.now()}`,
      question: result.question || draft?.question || '',
      answer: result.answer,
      summary: result.summary,
      transcript: transcript || result.transcript || '',
      latencyMs: result.latencyMs,
      firstTokenMs: result.firstTokenMs ?? null,
      model: result.model,
      at: new Date().toISOString(),
      manual,
      streaming: false,
    };

    this.state.answer = answer;
    this.state.answers.unshift(answer);
    if (this.state.answers.length > MAX_ANSWERS) this.state.answers.pop();

    this.state.stats.answers += 1;
    this.state.stats.lastAnswerMs = answer.latencyMs;
    this.state.stats.lastFirstTokenMs = answer.firstTokenMs;
    this.answerLatencies.push(answer.latencyMs);
    if (this.answerLatencies.length > 20) this.answerLatencies.shift();
    this.state.stats.avgAnswerMs = Math.round(
      this.answerLatencies.reduce((a, b) => a + b, 0) / this.answerLatencies.length
    );

    this.emit('answer', answer);

    const payload = {
      question: answer.question,
      answer: answer.answer,
      summary: answer.summary,
      transcript: answer.transcript,
      latencyMs: answer.latencyMs,
      model: answer.model,
      streaming: false,
    };

    // If streaming already created the document, finish it in place.
    const delivery = draft?.docId
      ? await this.sync.updateAnswer(draft.docId, payload).catch((error) => ({ queued: true, error }))
      : await this.sync.sendAnswer(payload);

    if (delivery?.queued) {
      this.log?.warn('Answer queued until Firestore is reachable again');
      this.state.notice = { type: 'warn', message: 'Offline - answers will sync when reconnected' };
    }

    return answer;
  }

  // ---- fast path: audio in, answer out ------------------------------------

  async handleAudioSegment({ wav, context }) {
    if (!this.ai.configured) {
      this.notConfigured();
      return { transcript: '' };
    }

    this.thinking = true;
    this.emitState();

    const draft = {
      id: `a-${Date.now()}`,
      question: '',
      answer: '',
      summary: [],
      transcript: '',
      model: this.ai.providerId,
      docId: null,
      creating: false,
      lastPhoneWrite: 0,
    };

    try {
      const result = await this.ai.answerFromAudio(wav, {
        context,
        onPartial: this.makePartialHandler(draft),
      });

      if (!result) return { transcript: '' };

      if (result.transcript) {
        draft.transcript = result.transcript;
        this.recordTranscriptLine(result.transcript, result.question || false);
      }

      if (!result.answer) {
        this.state.answer = null;
        return { transcript: result.transcript };
      }

      await this.publishAnswer(result, { transcript: result.transcript, draft });
      return { transcript: result.transcript };
    } catch (error) {
      this.state.stats.errors += 1;
      this.state.notice = { type: 'error', message: `${this.ai.providerId}: ${error.message}` };
      this.log?.error('Fast answer failed', { error: error.message });
      return { transcript: '' };
    } finally {
      this.thinking = false;
      this.emitState();
    }
  }

  // ---- standard path: transcript in, answer out ---------------------------

  async handleTranscript({ transcript, question }) {
    this.recordTranscriptLine(transcript, question || false);

    if (this.settings.get('behaviour.answerOnlyQuestions') && !question) return;

    // Do not stack answers on top of each other; the last question wins.
    if (this.thinking) {
      this.log?.debug('Skipping answer - one is already in flight');
      return;
    }

    await this.answer({ transcript, question });
  }

  /** Also used by "Ask manually" in the dashboard. */
  async answer({ transcript, question = '', manual = false }) {
    if (!this.ai.configured) {
      this.notConfigured();
      return null;
    }

    this.thinking = true;
    this.emitState();

    const draft = {
      id: `a-${Date.now()}`,
      question,
      answer: '',
      summary: [],
      transcript,
      model: this.ai.providerId,
      docId: null,
      creating: false,
      lastPhoneWrite: 0,
    };

    try {
      const result = await this.ai.generateAnswer(question || transcript, {
        context: this.speech.context({ lines: 5 }),
        onPartial: this.makePartialHandler(draft),
      });

      const onlyQuestions = this.settings.get('behaviour.answerOnlyQuestions');
      if (!result.answer || (!result.question && !manual && onlyQuestions)) {
        this.log?.debug('No question found to answer');
        this.state.answer = null;
        return null;
      }

      return await this.publishAnswer(result, { transcript, manual, draft });
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
    this.log?.info('Pipeline started', { fastMode: this.ai.fastMode, provider: this.ai.providerId });
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
    this.speech.fastHandler = null;
    this.removeAllListeners();
  }
}

module.exports = { Pipeline };
