'use strict';

const {
  buildAnswerPrompt,
  buildFastAudioPrompt,
  buildTranscriptionPrompt,
  RESUME_EXTRACTION_PROMPT,
} = require('./prompts');
const { readSse } = require('./sse');

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

class ProviderError extends Error {
  constructor(message, { status, retryable, body } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status || null;
    this.retryable = Boolean(retryable);
    this.body = body || null;
  }
}

/**
 * Google Gemini. Handles both jobs on one API key: audio transcription via
 * inline audio, and answers - either from text, or straight from the audio in
 * a single round trip when fast mode is on.
 */
class GeminiProvider {
  static id = 'gemini';
  static label = 'Google Gemini';
  static keyUrl = 'https://aistudio.google.com/apikey';
  static keyHint = 'Starts with AIza…';
  static answerModels = [
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash (fast, recommended)' },
    { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite (fastest)' },
    { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro (smarter, slower)' },
    { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
  ];
  static transcribeModels = [
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite (fastest)' },
    { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
  ];

  static get canReadDocuments() {
    return true;
  }

  static get canAnswerFromAudio() {
    return true;
  }

  constructor({ getApiKey, getConfig, logger }) {
    this.getApiKey = getApiKey;
    this.getConfig = getConfig || (() => ({}));
    this.log = logger;
  }

  get configured() {
    return Boolean(this.getApiKey());
  }

  requireKey() {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new ProviderError('No Gemini API key configured', { retryable: false });
    return apiKey;
  }

  async call(model, body, { timeoutMs = 30000, attempt = 0 } = {}) {
    const apiKey = this.requireKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 2) {
          clearTimeout(timer);
          await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
          return this.call(model, body, { timeoutMs, attempt: attempt + 1 });
        }
        throw new ProviderError(`Gemini returned ${response.status}`, {
          status: response.status,
          retryable,
          body: text.slice(0, 500),
        });
      }

      return JSON.parse(text);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ProviderError(`Gemini timed out after ${timeoutMs}ms`, { retryable: true });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Streams a generation, calling onPartial with the text so far. */
  async stream(model, body, { timeoutMs = 45000, onPartial } = {}) {
    const apiKey = this.requireKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${ENDPOINT}/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new ProviderError(`Gemini returned ${response.status}`, {
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
          body: text.slice(0, 500),
        });
      }

      let full = '';
      await readSse(response, (event) => {
        const parts = event?.candidates?.[0]?.content?.parts || [];
        const delta = parts.map((part) => part.text || '').join('');
        if (!delta) return;
        full += delta;
        onPartial?.(full, delta);
      });

      return full;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ProviderError(`Gemini timed out after ${timeoutMs}ms`, { retryable: true });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  static extractText(response) {
    const parts = response?.candidates?.[0]?.content?.parts || [];
    return parts.map((part) => part.text || '').join('').trim();
  }

  async generateAnswer(transcript, { context = '', style, mode, profile, onPartial } = {}) {
    const config = this.getConfig();
    const model = config.model || 'gemini-2.5-flash';
    const { prompt, maxOutputTokens } = buildAnswerPrompt({ transcript, context, style, mode, profile });

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: config.temperature ?? 0.3, maxOutputTokens },
    };

    if (onPartial) return { text: await this.stream(model, body, { onPartial }), model };

    const response = await this.call(model, body, { timeoutMs: 45000 });
    return { text: GeminiProvider.extractText(response), model };
  }

  /** Fast path: transcript and answer in one call, straight from the audio. */
  async answerFromAudio(buffer, { mimeType = 'audio/wav', context = '', style, mode, profile, onPartial } = {}) {
    const config = this.getConfig();
    const model = config.model || 'gemini-2.5-flash';
    const { prompt, maxOutputTokens } = buildFastAudioPrompt({ context, style, mode, profile });

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
          ],
        },
      ],
      generationConfig: { temperature: config.temperature ?? 0.3, maxOutputTokens },
    };

    if (onPartial) return { text: await this.stream(model, body, { onPartial, timeoutMs: 60000 }), model };

    const response = await this.call(model, body, { timeoutMs: 60000 });
    return { text: GeminiProvider.extractText(response), model };
  }

  async transcribeAudio(buffer, { mimeType = 'audio/wav', hint = '' } = {}) {
    const config = this.getConfig();
    const model = config.transcribeModel || config.model || 'gemini-2.5-flash';

    const response = await this.call(
      model,
      {
        contents: [
          {
            role: 'user',
            parts: [
              { text: buildTranscriptionPrompt(hint) },
              { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      },
      { timeoutMs: 45000 }
    );

    return GeminiProvider.extractText(response);
  }

  async extractDocumentText(buffer, { mimeType }) {
    const config = this.getConfig();
    const model = config.model || 'gemini-2.5-flash';

    const response = await this.call(
      model,
      {
        contents: [
          {
            role: 'user',
            parts: [
              { text: RESUME_EXTRACTION_PROMPT },
              { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 },
      },
      { timeoutMs: 90000 }
    );

    return GeminiProvider.extractText(response);
  }

  async testConnection() {
    const model = this.getConfig().model || 'gemini-2.5-flash';
    const startedAt = Date.now();
    const response = await this.call(
      model,
      {
        contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }],
        generationConfig: { maxOutputTokens: 10, temperature: 0 },
      },
      { timeoutMs: 15000 }
    );
    return { ok: true, model, latencyMs: Date.now() - startedAt, reply: GeminiProvider.extractText(response) };
  }
}

module.exports = { GeminiProvider, ProviderError };
