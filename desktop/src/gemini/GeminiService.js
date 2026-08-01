'use strict';

const { EventEmitter } = require('events');

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Exactly the contract the mobile app and backend expect back. */
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    answer: { type: 'string' },
    summary: { type: 'array', items: { type: 'string' } },
  },
  required: ['question', 'answer', 'summary'],
};

const SYSTEM_PROMPT = `You are an AI meeting assistant.

Given the meeting transcript:

{{transcript}}

Tasks:

1. Detect whether this is a question.
2. Generate a short answer.
3. Generate bullet points.
4. Return JSON.

Return:

{
  "question": "",
  "answer": "",
  "summary": []
}

Rules:
- "question" must be the exact question that was asked, rephrased only enough to stand alone. If the transcript contains no question, return an empty string for "question".
- "answer" must be something the speaker can say out loud immediately: {{style}}. No preamble, no "great question", no markdown headings.
- "summary" is 2-4 short supporting bullet points, each under 15 words.
- If you do not know something, say so plainly in the answer instead of inventing facts.
- Return JSON only.`;

const STYLES = {
  concise: '1-2 sentences, under 45 words',
  detailed: '3-5 sentences with the key reasoning, under 110 words',
};

class GeminiError extends Error {
  constructor(message, { status, retryable, body } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status || null;
    this.retryable = Boolean(retryable);
    this.body = body || null;
  }
}

class GeminiService extends EventEmitter {
  /**
   * @param {object} options
   * @param {() => string|null} options.getApiKey  read lazily so the key can change at runtime
   * @param {() => object} options.getConfig       { model, transcribeModel, temperature, maxOutputTokens, answerStyle }
   */
  constructor({ getApiKey, getConfig, logger }) {
    super();
    this.getApiKey = getApiKey;
    this.getConfig = getConfig || (() => ({}));
    this.log = logger;
    this.stats = { calls: 0, failures: 0, totalLatencyMs: 0, lastLatencyMs: null };
  }

  get configured() {
    return Boolean(this.getApiKey());
  }

  async call(model, body, { timeoutMs = 30000, attempt = 0 } = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new GeminiError('No Gemini API key configured', { retryable: false });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const error = new GeminiError(`Gemini returned ${response.status}`, {
          status: response.status,
          retryable,
          body: text.slice(0, 500),
        });

        if (retryable && attempt < 2) {
          const backoff = 600 * 2 ** attempt;
          this.log?.warn('Gemini call failed, retrying', { status: response.status, backoff });
          clearTimeout(timer);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          return this.call(model, body, { timeoutMs, attempt: attempt + 1 });
        }
        throw error;
      }

      const json = JSON.parse(text);
      this.stats.calls += 1;
      this.stats.lastLatencyMs = Date.now() - startedAt;
      this.stats.totalLatencyMs += this.stats.lastLatencyMs;
      return json;
    } catch (error) {
      this.stats.failures += 1;
      if (error.name === 'AbortError') {
        throw new GeminiError(`Gemini timed out after ${timeoutMs}ms`, { retryable: true });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  static extractText(response) {
    const parts = response?.candidates?.[0]?.content?.parts || [];
    return parts
      .map((part) => part.text || '')
      .join('')
      .trim();
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
   * `context` is the recent conversation, used only to disambiguate pronouns.
   */
  async generateAnswer(transcript, { context = '', signal } = {}) {
    const config = this.getConfig();
    const model = config.model || 'gemini-2.5-flash';
    const style = STYLES[config.answerStyle] || STYLES.concise;
    const startedAt = Date.now();

    const prompt = SYSTEM_PROMPT.replace('{{transcript}}', transcript).replace('{{style}}', style);
    const contextBlock = context ? `\n\nEarlier in this meeting (context only, do not answer these):\n${context}` : '';

    const response = await this.call(model, {
      contents: [{ role: 'user', parts: [{ text: `${prompt}${contextBlock}` }] }],
      generationConfig: {
        temperature: config.temperature ?? 0.3,
        maxOutputTokens: config.maxOutputTokens ?? 700,
        responseMimeType: 'application/json',
        responseSchema: ANSWER_SCHEMA,
      },
      safetySettings: [],
    });

    const parsed = GeminiService.parseJson(GeminiService.extractText(response));
    const latencyMs = Date.now() - startedAt;

    if (!parsed) {
      throw new GeminiError('Gemini returned a response that was not valid JSON', { retryable: false });
    }

    const result = {
      question: String(parsed.question || '').trim(),
      answer: String(parsed.answer || '').trim(),
      summary: Array.isArray(parsed.summary) ? parsed.summary.map((s) => String(s).trim()).filter(Boolean) : [],
      latencyMs,
      model,
      transcript,
    };

    this.emit('answer', result);
    this.log?.info('Gemini answer generated', {
      latencyMs,
      hasQuestion: Boolean(result.question),
      answerChars: result.answer.length,
    });

    return result;
  }

  /**
   * Speech-to-text for one audio segment. Gemini accepts inline audio, which
   * keeps the whole pipeline on a single free-tier API key.
   */
  async transcribeAudio(buffer, { mimeType = 'audio/wav', hint = '', signal } = {}) {
    const config = this.getConfig();
    const model = config.transcribeModel || config.model || 'gemini-2.5-flash';

    const instruction = [
      'Transcribe this meeting audio verbatim.',
      'Return only the spoken words as plain text - no speaker labels, no timestamps, no commentary.',
      'If the audio contains no intelligible speech, return exactly: [no speech]',
      hint ? `Recent context for spelling of names and jargon: ${hint}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const response = await this.call(
      model,
      {
        contents: [
          {
            role: 'user',
            parts: [
              { text: instruction },
              { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      },
      { timeoutMs: 45000 }
    );

    const text = GeminiService.extractText(response);
    if (!text || /^\[no speech\]$/i.test(text.trim())) return '';
    return text.replace(/^["']|["']$/g, '').trim();
  }

  /** Cheap connectivity + key check used by the Settings panel. */
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
    return {
      ok: true,
      model,
      latencyMs: Date.now() - startedAt,
      reply: GeminiService.extractText(response),
    };
  }

  metrics() {
    return {
      ...this.stats,
      avgLatencyMs: this.stats.calls ? Math.round(this.stats.totalLatencyMs / this.stats.calls) : null,
      configured: this.configured,
    };
  }
}

module.exports = { GeminiService, GeminiError, ANSWER_SCHEMA, SYSTEM_PROMPT };
