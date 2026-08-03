'use strict';

const { EventEmitter } = require('events');
const { GeminiProvider, ProviderError } = require('./GeminiProvider');
const { OpenAIProvider } = require('./OpenAIProvider');
const { STYLES, DEFAULT_STYLE, parseDelimited } = require('./prompts');

const PROVIDERS = { gemini: GeminiProvider, openai: OpenAIProvider };

/**
 * AiService
 * ---------
 * One façade over whichever provider is selected. Everything downstream -
 * SpeechService, Pipeline - talks to this and never knows which model is
 * behind it.
 *
 * Two paths to an answer:
 *   standard  transcribe, then answer from the text. Two round trips, but the
 *             transcript is checked locally for a question first, so a model
 *             call only happens when someone actually asked something.
 *   fast      hand the audio straight to the answer model and get the
 *             transcript and the answer back together. One round trip, so
 *             roughly half the latency, at the cost of a call per segment.
 */
class AiService extends EventEmitter {
  constructor({ getApiKey, getConfig, getProfile, logger }) {
    super();
    this.getApiKey = getApiKey;
    this.getConfig = getConfig || (() => ({}));
    this.getProfile = getProfile || (() => ({}));
    this.log = logger;
    this.stats = { calls: 0, failures: 0, totalLatencyMs: 0, lastLatencyMs: null, firstTokenMs: null };
  }

  get providerId() {
    const id = this.getConfig().provider;
    return PROVIDERS[id] ? id : 'gemini';
  }

  get ProviderClass() {
    return PROVIDERS[this.providerId];
  }

  /** Built fresh each call so a settings change takes effect immediately. */
  get provider() {
    const id = this.providerId;
    return new this.ProviderClass({
      getApiKey: () => this.getApiKey(id),
      getConfig: () => this.getConfig()[id] || {},
      logger: this.log,
    });
  }

  get configured() {
    return Boolean(this.getApiKey(this.providerId));
  }

  /** Fast mode needs a provider that accepts audio; OpenAI chat does not. */
  get fastModeAvailable() {
    return this.ProviderClass.canAnswerFromAudio;
  }

  get fastMode() {
    return this.getConfig().fastMode !== false && this.fastModeAvailable;
  }

  get streaming() {
    return this.getConfig().streaming !== false;
  }

  promptOptions() {
    const config = this.getConfig();
    return {
      style: config.answerStyle || DEFAULT_STYLE,
      mode: config.mode || 'meeting',
      profile: config.mode === 'interview' ? this.getProfile() : {},
    };
  }

  /**
   * Shared tail for both paths: run the request, stream partials out, and
   * shape the delimited reply into the result object Pipeline expects.
   */
  async run(request, { onPartial, startedAt }) {
    let firstTokenMs = null;

    const wrapped = onPartial
      ? (full) => {
          if (firstTokenMs === null) {
            firstTokenMs = Date.now() - startedAt;
            this.stats.firstTokenMs = firstTokenMs;
          }
          const partial = parseDelimited(full);
          // Only worth surfacing once the answer itself has started.
          if (partial.answer) onPartial(partial);
        }
      : undefined;

    const { text, model } = await request(wrapped);
    const parsed = parseDelimited(text);

    if (!parsed.answer && !parsed.question && !parsed.transcript) {
      throw new ProviderError('The model returned an empty response', { retryable: true });
    }

    const latencyMs = Date.now() - startedAt;
    this.stats.calls += 1;
    this.stats.lastLatencyMs = latencyMs;
    this.stats.totalLatencyMs += latencyMs;

    return {
      transcript: parsed.transcript,
      question: parsed.question,
      answer: parsed.answer,
      summary: parsed.summary,
      latencyMs,
      firstTokenMs,
      model: `${this.providerId}/${model}`,
    };
  }

  /** Answer from an already-transcribed line. */
  async generateAnswer(transcript, { context = '', onPartial } = {}) {
    const startedAt = Date.now();
    const options = this.promptOptions();

    try {
      const result = await this.run(
        (wrapped) =>
          this.provider.generateAnswer(transcript, {
            ...options,
            context,
            onPartial: this.streaming ? wrapped : undefined,
          }),
        { onPartial: this.streaming ? onPartial : null, startedAt }
      );

      this.log?.info('Answer generated', {
        provider: this.providerId,
        mode: options.mode,
        style: options.style,
        latencyMs: result.latencyMs,
        firstTokenMs: result.firstTokenMs,
      });

      return { ...result, transcript: result.transcript || transcript };
    } catch (error) {
      this.stats.failures += 1;
      throw error;
    }
  }

  /**
   * Fast path: audio in, transcript and answer out, one round trip.
   * Falls back automatically when the provider cannot take audio.
   */
  async answerFromAudio(buffer, { mimeType = 'audio/wav', context = '', hint = '', onPartial } = {}) {
    if (!this.fastModeAvailable) {
      const transcript = await this.transcribeAudio(buffer, { mimeType, hint });
      if (!transcript) return null;
      return this.generateAnswer(transcript, { context, onPartial });
    }

    const startedAt = Date.now();
    const options = this.promptOptions();

    try {
      const result = await this.run(
        (wrapped) =>
          this.provider.answerFromAudio(buffer, {
            ...options,
            mimeType,
            context,
            onPartial: this.streaming ? wrapped : undefined,
          }),
        { onPartial: this.streaming ? onPartial : null, startedAt }
      );

      this.log?.info('Fast answer generated', {
        provider: this.providerId,
        latencyMs: result.latencyMs,
        firstTokenMs: result.firstTokenMs,
        hasQuestion: Boolean(result.question),
      });

      return result;
    } catch (error) {
      this.stats.failures += 1;
      throw error;
    }
  }

  transcribeAudio(buffer, options) {
    return this.provider.transcribeAudio(buffer, options);
  }

  extractDocumentText(buffer, options) {
    return this.provider.extractDocumentText(buffer, options);
  }

  testConnection() {
    return this.provider.testConnection();
  }

  /** Everything the Settings screen needs to render its pickers. */
  describe() {
    return {
      active: this.providerId,
      fastMode: this.fastMode,
      fastModeAvailable: this.fastModeAvailable,
      streaming: this.streaming,
      styles: Object.entries(STYLES).map(([id, style]) => ({
        id,
        label: style.label,
        hint: style.instruction,
      })),
      providers: Object.values(PROVIDERS).map((Provider) => ({
        id: Provider.id,
        label: Provider.label,
        keyUrl: Provider.keyUrl,
        keyHint: Provider.keyHint,
        answerModels: Provider.answerModels,
        transcribeModels: Provider.transcribeModels,
        canReadDocuments: Provider.canReadDocuments,
        canAnswerFromAudio: Provider.canAnswerFromAudio,
        configured: Boolean(this.getApiKey(Provider.id)),
      })),
    };
  }

  metrics() {
    return {
      ...this.stats,
      avgLatencyMs: this.stats.calls ? Math.round(this.stats.totalLatencyMs / this.stats.calls) : null,
      configured: this.configured,
      provider: this.providerId,
      mode: this.getConfig().mode || 'meeting',
      fastMode: this.fastMode,
    };
  }
}

module.exports = { AiService, ProviderError, PROVIDERS };
