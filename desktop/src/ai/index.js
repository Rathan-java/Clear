'use strict';

const { EventEmitter } = require('events');
const { GeminiProvider, ProviderError } = require('./GeminiProvider');
const { OpenAIProvider } = require('./OpenAIProvider');
const { STYLES, DEFAULT_STYLE } = require('./prompts');

const PROVIDERS = { gemini: GeminiProvider, openai: OpenAIProvider };

/**
 * AiService
 * ---------
 * One façade over whichever provider is selected. Everything downstream -
 * SpeechService, Pipeline - talks to this and never knows which model is
 * behind it, so switching provider at runtime changes nothing else.
 *
 * Keeps the same surface the old GeminiService had: generateAnswer(),
 * transcribeAudio(), testConnection(), metrics().
 */
class AiService extends EventEmitter {
  /**
   * @param {object} options
   * @param {(provider: string) => string|null} options.getApiKey  key for a given provider id
   * @param {() => object} options.getConfig    the whole `ai` settings block
   * @param {() => object} options.getProfile   { resumeText, jobTitle, ... }
   */
  constructor({ getApiKey, getConfig, getProfile, logger }) {
    super();
    this.getApiKey = getApiKey;
    this.getConfig = getConfig || (() => ({}));
    this.getProfile = getProfile || (() => ({}));
    this.log = logger;
    this.stats = { calls: 0, failures: 0, totalLatencyMs: 0, lastLatencyMs: null };
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

  static parseJson(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // Models occasionally wrap JSON in prose or a fenced block.
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const candidate = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
  }

  /**
   * generateAnswer(transcript) -> { question, answer, summary[] }
   * `mode` is meeting | interview; interview answers are written in the first
   * person and grounded in the stored CV.
   */
  async generateAnswer(transcript, { context = '' } = {}) {
    const config = this.getConfig();
    const startedAt = Date.now();

    try {
      const { text, model } = await this.provider.generateAnswer(transcript, {
        context,
        style: config.answerStyle || DEFAULT_STYLE,
        mode: config.mode || 'meeting',
        profile: config.mode === 'interview' ? this.getProfile() : {},
      });

      const parsed = AiService.parseJson(text);
      if (!parsed) {
        throw new ProviderError('The model returned a response that was not valid JSON', { retryable: false });
      }

      const latencyMs = Date.now() - startedAt;
      this.stats.calls += 1;
      this.stats.lastLatencyMs = latencyMs;
      this.stats.totalLatencyMs += latencyMs;

      const result = {
        question: String(parsed.question || '').trim(),
        answer: String(parsed.answer || '').trim(),
        summary: Array.isArray(parsed.summary) ? parsed.summary.map((s) => String(s).trim()).filter(Boolean) : [],
        latencyMs,
        model: `${this.providerId}/${model}`,
        transcript,
      };

      this.emit('answer', result);
      this.log?.info('Answer generated', {
        provider: this.providerId,
        mode: config.mode,
        style: config.answerStyle,
        latencyMs,
        answerChars: result.answer.length,
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

  /** Everything the Settings screen needs to render the provider pickers. */
  describe() {
    return {
      active: this.providerId,
      styles: Object.entries(STYLES).map(([id, style]) => ({ id, label: style.label, hint: style.instruction })),
      providers: Object.values(PROVIDERS).map((Provider) => ({
        id: Provider.id,
        label: Provider.label,
        keyUrl: Provider.keyUrl,
        keyHint: Provider.keyHint,
        answerModels: Provider.answerModels,
        transcribeModels: Provider.transcribeModels,
        canReadDocuments: Provider.canReadDocuments,
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
    };
  }
}

module.exports = { AiService, ProviderError, PROVIDERS };
