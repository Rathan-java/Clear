'use strict';

/**
 * Every prompt the app sends, in one place, so the two providers stay honest
 * about producing the same shape of answer.
 *
 * Output is a line-delimited format rather than JSON. Two reasons: it streams
 * (you can show the answer while it is still being written, which JSON cannot
 * do without a tolerant incremental parser), and it costs fewer tokens, which
 * is fewer milliseconds.
 */

const STYLES = {
  brief: {
    label: 'Brief',
    instruction: 'Two or three sentences. Just the answer, no wind-up.',
    points: '2 short talking points',
    maxOutputTokens: 350,
  },
  balanced: {
    label: 'Balanced',
    instruction: 'Four to six sentences. The answer, then the reason behind it.',
    points: '3 short talking points',
    maxOutputTokens: 700,
  },
  detailed: {
    label: 'Detailed',
    instruction:
      'Eight to twelve sentences. The answer, why, a concrete example, and any caveat worth saying out loud.',
    points: '4 to 5 short talking points',
    maxOutputTokens: 1400,
  },
};

const DEFAULT_STYLE = 'balanced';
const styleOf = (name) => STYLES[name] || STYLES[DEFAULT_STYLE];

/**
 * The single most important part of these prompts.
 *
 * Models default to written register - long balanced clauses, "utilize",
 * "furthermore", perfectly parallel lists. Read aloud, that sounds like
 * someone reading. Speech is shorter, messier, and uses contractions.
 */
const SPOKEN_RULES = `How it must sound:
- This will be READ ALOUD. It has to sound like you thought of it just now, not like you are reading.
- Short sentences. Vary the length. A very short one now and then.
- Use contractions everywhere: I've, we're, didn't, it's, that's, there's.
- Say numbers the way people say them out loud: "about forty percent", "a couple of months", "roughly ten thousand".
- Never use these words: utilize, leverage, furthermore, moreover, additionally, delve, robust, seamless, holistic, myriad, plethora, facilitate, endeavor, paramount.
- No semicolons. No em dashes. No parentheses. No bullet characters, numbering or markdown inside the answer.
- No lists inside the answer. If there are two things to say, say "there's two things here" and then say them in sentences.
- Do not repeat the question back before answering. Start with the answer.
- Do not open with "Great question", "Certainly", "Absolutely" or "As an AI".
- Every sentence must be speakable in one breath.`;

const FORMAT_RULES = `Reply in exactly this format and nothing else:

QUESTION: <the question that was asked, or NONE if nobody asked one>
ANSWER: <the spoken answer, plain sentences, can run over several lines>
POINT: <a short talking point>
POINT: <another one>`;

const MEETING_PROMPT = `You are helping someone in a live meeting. They will read your answer out loud.

Here is what was just said:

{{transcript}}

Work out whether a question was asked. If one was, answer it: {{styleInstruction}}
Then give {{pointsInstruction}}.

${SPOKEN_RULES}
- Be straight about uncertainty. "I'm not sure, but I think..." is fine. Inventing a fact is not.

${FORMAT_RULES}`;

const INTERVIEW_PROMPT = `You are helping a candidate in a live job interview. They will read your answer out loud, as their own answer.

{{profile}}

Here is what the interviewer just said:

{{transcript}}

Work out whether they asked a question. Treat "tell me about...", "walk me through...", and "describe a time when..." as questions.
Write the candidate's spoken answer: {{styleInstruction}}
Then give {{pointsInstruction}}.

${SPOKEN_RULES}

Interview rules:
- Write in the FIRST PERSON as the candidate. "I built", "we shipped", "in my last role".
- Use the real project names, technologies, employers and numbers from the background above. Specifics are what make an answer land.
- NEVER invent experience, employers, dates or numbers that are not in the background. If it does not cover the question, say honestly what you have done that is closest, and how you would approach the rest.
- For "tell me about a time" questions: what the situation was, what you did, how it turned out. Say it as a story, do not announce the structure.
- Sound confident and warm. No hedging like "I think maybe I possibly".

${FORMAT_RULES}`;

/** Fast path: the model hears the audio and answers in one round trip. */
const FAST_AUDIO_PROMPT = `You are listening to live {{contextWord}} audio. The person listening will read your answer out loud.

First transcribe what was said, exactly.
Then work out whether a question was asked of the listener.
If one was, answer it: {{styleInstruction}} Then give {{pointsInstruction}}.
If nobody asked a question, put NONE after QUESTION and leave ANSWER empty.

{{profile}}

${SPOKEN_RULES}

Reply in exactly this format and nothing else:

TRANSCRIPT: <exactly what was said>
QUESTION: <the question, or NONE>
ANSWER: <the spoken answer, or empty if there was no question>
POINT: <a short talking point>
POINT: <another one>`;

const buildProfileBlock = (profile = {}) => {
  const parts = [];

  if (profile.resumeText) {
    parts.push(`The candidate's CV:\n"""\n${String(profile.resumeText).slice(0, 12000)}\n"""`);
  }
  if (profile.jobTitle) parts.push(`Role being interviewed for: ${profile.jobTitle}`);
  if (profile.jobDescription) {
    parts.push(`Job description:\n"""\n${String(profile.jobDescription).slice(0, 4000)}\n"""`);
  }
  if (profile.notes) parts.push(`Extra notes from the candidate:\n${String(profile.notes).slice(0, 2000)}`);

  if (!parts.length) {
    return 'You have no CV for this candidate, so answer from general knowledge and stay honest about it.';
  }
  return parts.join('\n\n');
};

const buildAnswerPrompt = ({ transcript, context = '', style, mode = 'meeting', profile = {} }) => {
  const chosen = styleOf(style);
  const interview = mode === 'interview';

  const base = (interview ? INTERVIEW_PROMPT : MEETING_PROMPT)
    .replace('{{transcript}}', transcript)
    .replace('{{styleInstruction}}', chosen.instruction)
    .replace('{{pointsInstruction}}', chosen.points)
    .replace('{{profile}}', interview ? buildProfileBlock(profile) : '');

  const contextBlock = context
    ? `\n\nEarlier in this conversation, for context only - do not answer these:\n${context}`
    : '';

  return { prompt: `${base}${contextBlock}`, maxOutputTokens: chosen.maxOutputTokens };
};

const buildFastAudioPrompt = ({ context = '', style, mode = 'meeting', profile = {} }) => {
  const chosen = styleOf(style);
  const interview = mode === 'interview';

  const base = FAST_AUDIO_PROMPT.replace('{{contextWord}}', interview ? 'job interview' : 'meeting')
    .replace('{{styleInstruction}}', chosen.instruction)
    .replace('{{pointsInstruction}}', chosen.points)
    .replace(
      '{{profile}}',
      interview
        ? `${buildProfileBlock(profile)}\n\nAnswer in the FIRST PERSON as the candidate, using the real details above. Never invent experience.`
        : ''
    );

  const contextBlock = context ? `\n\nEarlier in this conversation, for context only:\n${context}` : '';

  return { prompt: `${base}${contextBlock}`, maxOutputTokens: chosen.maxOutputTokens + 300 };
};

/**
 * Parses the delimited reply. Tolerant on purpose: it runs on partial text
 * while the response is still streaming, and it must never throw.
 */
const parseDelimited = (text) => {
  const raw = String(text || '');
  const result = { transcript: '', question: '', answer: '', summary: [] };
  if (!raw.trim()) return result;

  let current = null;

  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*(TRANSCRIPT|QUESTION|ANSWER|POINT)\s*:\s*(.*)$/i);

    if (match) {
      const key = match[1].toUpperCase();
      const value = match[2];

      if (key === 'POINT') {
        if (value.trim()) result.summary.push(value.trim());
        current = 'POINT';
      } else {
        current = key;
        const field = key.toLowerCase();
        result[field] = value;
      }
      continue;
    }

    // A continuation of whatever field we are inside.
    if (current === 'ANSWER') result.answer += (result.answer ? '\n' : '') + line;
    else if (current === 'POINT' && line.trim() && result.summary.length) {
      result.summary[result.summary.length - 1] += ` ${line.trim()}`;
    } else if (current === 'TRANSCRIPT') {
      result.transcript += (result.transcript ? '\n' : '') + line;
    }
  }

  // The model ignored the format entirely - treat the whole thing as the answer.
  if (!result.answer.trim() && !result.question.trim() && !result.transcript.trim()) {
    result.answer = raw.trim();
  }

  result.transcript = result.transcript.trim();
  result.question = /^\s*none\s*$/i.test(result.question) ? '' : result.question.trim();
  result.answer = result.answer.trim();
  result.summary = result.summary.map((point) => point.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);

  return result;
};

const buildTranscriptionPrompt = (hint = '') =>
  [
    'Transcribe this meeting audio verbatim.',
    'Return only the spoken words as plain text - no speaker labels, no timestamps, no commentary.',
    'If the audio contains no intelligible speech, return exactly: [no speech]',
    hint ? `Recent context for spelling of names and jargon: ${hint}` : '',
  ]
    .filter(Boolean)
    .join('\n');

const RESUME_EXTRACTION_PROMPT = `Extract the full text of this CV/résumé.

Return plain text only: no commentary, no markdown, no headings you invented.
Keep the original section order, job titles, employers, dates, technologies and
any numbers or metrics exactly as written - those are what make an interview
answer credible.`;

module.exports = {
  STYLES,
  DEFAULT_STYLE,
  SPOKEN_RULES,
  buildAnswerPrompt,
  buildFastAudioPrompt,
  buildProfileBlock,
  buildTranscriptionPrompt,
  parseDelimited,
  RESUME_EXTRACTION_PROMPT,
};
