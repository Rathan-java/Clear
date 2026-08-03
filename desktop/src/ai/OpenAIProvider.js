'use strict';

const { buildAnswerPrompt, buildTranscriptionPrompt } = require('./prompts');
const { ProviderError } = require('./GeminiProvider');

const BASE = 'https://api.openai.com/v1';

/**
 * OpenAI. Two different endpoints do the two jobs:
 *   answers      /chat/completions with response_format json_object
 *   transcription /audio/transcriptions (Whisper), multipart upload
 *
 * Unlike Gemini it cannot read a PDF directly, so CV uploads fall back to the
 * local pdf/docx parsers - see ProfileStore.
 */
class OpenAIProvider {
  static id = 'openai';
  static label = 'OpenAI';
  static keyUrl = 'https://platform.openai.com/api-keys';
  static keyHint = 'Starts with sk-…';
  static answerModels = [
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini (fast, cheap)' },
    { id: 'gpt-4o', label: 'gpt-4o (smarter)' },
    { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
    { id: 'gpt-4.1', label: 'gpt-4.1' },
  ];
  static transcribeModels = [
    { id: 'whisper-1', label: 'whisper-1 (reliable)' },
    { id: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe (faster)' },
    { id: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe (most accurate)' },
  ];

  static get canReadDocuments() {
    return false;
  }

  constructor({ getApiKey, getConfig, logger }) {
    this.getApiKey = getApiKey;
    this.getConfig = getConfig || (() => ({}));
    this.log = logger;
  }

  get configured() {
    return Boolean(this.getApiKey());
  }

  async request(path, { body, formData, timeoutMs = 45000, attempt = 0 } = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new ProviderError('No OpenAI API key configured', { retryable: false });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          ...(formData ? {} : { 'content-type': 'application/json' }),
        },
        body: formData || JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 2) {
          clearTimeout(timer);
          await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt));
          return this.request(path, { body, formData, timeoutMs, attempt: attempt + 1 });
        }

        let message = `OpenAI returned ${response.status}`;
        try {
          const parsed = JSON.parse(text);
          if (parsed?.error?.message) message = parsed.error.message;
        } catch {
          /* keep the status-code message */
        }
        throw new ProviderError(message, { status: response.status, retryable, body: text.slice(0, 500) });
      }

      return JSON.parse(text);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ProviderError(`OpenAI timed out after ${timeoutMs}ms`, { retryable: true });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async generateAnswer(transcript, { context = '', style, mode, profile } = {}) {
    const config = this.getConfig();
    const model = config.model || 'gpt-4o-mini';
    const { prompt, maxOutputTokens } = buildAnswerPrompt({ transcript, context, style, mode, profile });

    const response = await this.request('/chat/completions', {
      body: {
        model,
        messages: [
          {
            role: 'system',
            content:
              'You return only valid JSON matching the requested shape. Never wrap it in markdown fences.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: config.temperature ?? 0.3,
        max_tokens: maxOutputTokens,
        response_format: { type: 'json_object' },
      },
    });

    return { text: response?.choices?.[0]?.message?.content || '', model };
  }

  async transcribeAudio(buffer, { mimeType = 'audio/wav', hint = '' } = {}) {
    const config = this.getConfig();
    const model = config.transcribeModel || 'whisper-1';

    // Node 18+/Electron give us FormData and Blob natively.
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), 'audio.wav');
    form.append('model', model);
    form.append('response_format', 'text');
    if (hint) form.append('prompt', buildTranscriptionPrompt(hint).slice(0, 800));

    const apiKey = this.getApiKey();
    if (!apiKey) throw new ProviderError('No OpenAI API key configured', { retryable: false });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${BASE}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new ProviderError(`Whisper returned ${response.status}`, {
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
          body: text.slice(0, 300),
        });
      }
      // response_format=text returns the transcript as the raw body.
      return text.trim();
    } catch (error) {
      if (error.name === 'AbortError') throw new ProviderError('Whisper timed out', { retryable: true });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** OpenAI chat cannot take a raw PDF; ProfileStore parses locally instead. */
  async extractDocumentText() {
    throw new ProviderError(
      'OpenAI cannot read PDFs directly. Upload a .txt or .docx CV, or paste the text in.',
      { retryable: false }
    );
  }

  async testConnection() {
    const model = this.getConfig().model || 'gpt-4o-mini';
    const startedAt = Date.now();
    const response = await this.request('/chat/completions', {
      body: {
        model,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 10,
        temperature: 0,
      },
      timeoutMs: 20000,
    });

    return {
      ok: true,
      model,
      latencyMs: Date.now() - startedAt,
      reply: response?.choices?.[0]?.message?.content || '',
    };
  }
}

module.exports = { OpenAIProvider };
