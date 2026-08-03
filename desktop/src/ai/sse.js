'use strict';

/**
 * Reads a server-sent-events response and hands each `data:` payload to the
 * caller. Both providers stream in this format; only the shape of the JSON
 * inside differs.
 */
const readSse = async (response, onEvent) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line, but providers also send plain
      // newline-delimited data lines, so split on newlines and filter.
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          onEvent(JSON.parse(payload));
        } catch {
          // A chunk split mid-JSON; the next read will complete it.
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
};

module.exports = { readSse };
