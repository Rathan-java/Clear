'use strict';

/**
 * Every prompt the app sends, in one place, so the two providers stay honest
 * about producing the same shape of answer.
 */

/** How long the spoken answer should be. */
const STYLES = {
  brief: {
    label: 'Brief',
    instruction: '1-2 sentences, under 45 words. Just the direct answer.',
    summary: '2-3 bullet points, each under 12 words',
    maxOutputTokens: 400,
  },
  balanced: {
    label: 'Balanced',
    instruction: '3-5 sentences, 60-110 words. The answer plus the key reason behind it.',
    summary: '3-4 bullet points, each under 15 words',
    maxOutputTokens: 800,
  },
  detailed: {
    label: 'Detailed',
    instruction:
      '6-10 sentences, 150-250 words. Cover the answer, the reasoning, a concrete example, ' +
      'and any important caveat. Written to be spoken out loud, not read.',
    summary: '4-6 bullet points, each under 18 words',
    maxOutputTokens: 1600,
  },
};

const DEFAULT_STYLE = 'balanced';

const styleOf = (name) => STYLES[name] || STYLES[DEFAULT_STYLE];

/** The JSON contract. Both providers must return exactly this. */
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    answer: { type: 'string' },
    summary: { type: 'array', items: { type: 'string' } },
  },
  required: ['question', 'answer', 'summary'],
};

const SHARED_RULES = `
Rules:
- "question" must be the exact question that was asked, rephrased only enough to stand alone. If the transcript contains no question, return an empty string for "question".
- "answer" must be something you can say out loud immediately. No preamble, no "great question", no markdown headings, no bullet characters inside the answer text.
- "summary" is the supporting bullet points, as separate array entries.
- If you do not know something, say so plainly rather than inventing facts.
- Return JSON only.`;

const MEETING_PROMPT = `You are an AI meeting assistant.

Given the meeting transcript:

{{transcript}}

Tasks:

1. Detect whether this is a question.
2. Generate an answer: {{styleInstruction}}
3. Generate {{summaryInstruction}}.
4. Return JSON.

Return:

{
  "question": "",
  "answer": "",
  "summary": []
}
{{sharedRules}}`;

/**
 * Interview mode. The answer is spoken by the candidate, in first person, and
 * has to be grounded in what is actually on their CV - a plausible-sounding
 * answer that invents experience is worse than useless in an interview.
 */
const INTERVIEW_PROMPT = `You are helping a candidate answer questions in a live job interview.

{{profile}}

Given what the interviewer just said:

{{transcript}}

Tasks:

1. Detect whether the interviewer asked a question. Treat "tell me about...", "walk me through...", and "describe a time when..." as questions.
2. Write the candidate's spoken answer: {{styleInstruction}}
3. Generate {{summaryInstruction}} - the talking points behind the answer.
4. Return JSON.

Return:

{
  "question": "",
  "answer": "",
  "summary": []
}

Interview rules:
- Write in the FIRST PERSON, as the candidate speaking ("I built...", "In my last role I...").
- Ground every claim in the background above. Use the real project names, technologies, companies and numbers from it.
- NEVER invent experience, employers, dates or metrics that are not in the background. If the background does not cover the question, answer honestly from general knowledge and say how you would approach it.
- For "tell me about a time" questions, use situation → action → result, but say it naturally rather than announcing the structure.
- Sound like a confident person talking, not like a document being read.
{{sharedRules}}`;

/** Formats the résumé and role into the block the interview prompt expects. */
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
    return 'You have no CV for this candidate, so answer from general knowledge and keep it honest.';
  }
  return parts.join('\n\n');
};

/**
 * @param {object} options
 * @param {string} options.transcript
 * @param {string} [options.context]   recent conversation, for pronouns
 * @param {string} [options.style]     brief | balanced | detailed
 * @param {string} [options.mode]      meeting | interview
 * @param {object} [options.profile]   { resumeText, jobTitle, jobDescription, notes }
 */
const buildAnswerPrompt = ({ transcript, context = '', style, mode = 'meeting', profile = {} }) => {
  const chosen = styleOf(style);
  const interview = mode === 'interview';

  const base = (interview ? INTERVIEW_PROMPT : MEETING_PROMPT)
    .replace('{{transcript}}', transcript)
    .replace('{{styleInstruction}}', chosen.instruction)
    .replace('{{summaryInstruction}}', chosen.summary)
    .replace('{{profile}}', interview ? buildProfileBlock(profile) : '')
    .replace('{{sharedRules}}', SHARED_RULES);

  const contextBlock = context
    ? `\n\nEarlier in this conversation (context only, do not answer these):\n${context}`
    : '';

  return { prompt: `${base}${contextBlock}`, maxOutputTokens: chosen.maxOutputTokens };
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

/** One-shot extraction used when a CV is uploaded as a PDF or image. */
const RESUME_EXTRACTION_PROMPT = `Extract the full text of this CV/résumé.

Return plain text only: no commentary, no markdown, no headings you invented.
Keep the original section order, job titles, employers, dates, technologies and
any numbers or metrics exactly as written - those are what make an interview
answer credible.`;

module.exports = {
  STYLES,
  DEFAULT_STYLE,
  ANSWER_SCHEMA,
  buildAnswerPrompt,
  buildProfileBlock,
  buildTranscriptionPrompt,
  RESUME_EXTRACTION_PROMPT,
};
