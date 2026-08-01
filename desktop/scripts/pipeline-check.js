'use strict';

/**
 * Verifies the parts of the desktop pipeline that do not need Electron:
 * WAV encoding, voice activity segmentation, question detection and the
 * Gemini response parsing. Runs in plain Node.
 *
 *   npm run test:pipeline
 */

const { SpeechService } = require('../src/speech/SpeechService');
const { GeminiService } = require('../src/gemini/GeminiService');
const { encodeWav, rms, durationMs } = require('../src/audio/wav');

let passed = 0;
const check = (label, condition, detail) => {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
    process.exitCode = 1;
  }
};

const SAMPLE_RATE = 16000;

const settings = {
  get: (path) => {
    const audio = {
      sampleRate: SAMPLE_RATE,
      silenceMs: 500,
      minSpeechMs: 300,
      maxSegmentMs: 5000,
      vadSensitivity: 0.55,
    };
    if (path === 'audio') return audio;
    return audio[path?.split('.').pop()];
  },
};

/** Synthetic 16-bit mono PCM: a 200 Hz tone at `amplitude`, or silence. */
const makePcm = (ms, amplitude) => {
  const samples = Math.round((ms / 1000) * SAMPLE_RATE);
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const value = amplitude === 0 ? 0 : Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE) * amplitude * 32767;
    buffer.writeInt16LE(Math.round(value), i * 2);
  }
  return buffer;
};

const feed = (service, pcm, chunkMs = 64) => {
  const chunkBytes = Math.round((chunkMs / 1000) * SAMPLE_RATE) * 2;
  for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
    service.streamAudio(pcm.subarray(offset, Math.min(offset + chunkBytes, pcm.length)));
  }
};

(async () => {
  console.log('\nClear desktop pipeline check\n');

  // ---- WAV -----------------------------------------------------------------
  const pcm = makePcm(1000, 0.5);
  const wav = encodeWav(pcm, { sampleRate: SAMPLE_RATE });
  check('WAV starts with RIFF/WAVE', wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE');
  check('WAV header declares 16 kHz mono 16-bit', wav.readUInt32LE(24) === SAMPLE_RATE && wav.readUInt16LE(22) === 1 && wav.readUInt16LE(34) === 16);
  check('WAV data size matches the PCM payload', wav.readUInt32LE(40) === pcm.length && wav.length === pcm.length + 44);
  check('durationMs maths', Math.round(durationMs(pcm.length, SAMPLE_RATE)) === 1000);
  check('rms of a 0.5 tone is ~0.35', Math.abs(rms(pcm) - 0.354) < 0.02, rms(pcm));
  check('rms of silence is 0', rms(makePcm(200, 0)) === 0);

  // ---- Question detection --------------------------------------------------
  const speech = new SpeechService({ gemini: { transcribeAudio: async () => '' }, settings, logger: null });

  const questions = [
    'How do we handle authentication on the mobile app?',
    'what is the timeline for the migration',
    'Can you walk me through the deployment process',
    'So the retry logic is idempotent, right?',
    'Any thoughts on moving the database to Firestore',
    'Tell me about the pricing model',
  ];
  questions.forEach((text) => check(`question: "${text.slice(0, 42)}…"`, Boolean(speech.detectQuestion(text)), speech.detectQuestion(text)));

  const statements = [
    'We shipped the new build this morning.',
    "That's how we did the migration last year.",
    'The latency dropped to about 200 milliseconds.',
    'Okay.',
    'It works well now that caching is on.',
  ];
  statements.forEach((text) => check(`statement: "${text.slice(0, 42)}…"`, speech.detectQuestion(text) === '', speech.detectQuestion(text)));

  check(
    'pulls the question out of a mixed paragraph',
    speech.detectQuestion('We finished the API work yesterday. How should we handle offline mode?') ===
      'How should we handle offline mode?',
    speech.detectQuestion('We finished the API work yesterday. How should we handle offline mode?')
  );

  // ---- VAD segmentation ----------------------------------------------------
  const transcribed = [];
  const vadService = new SpeechService({
    gemini: {
      transcribeAudio: async (wavBuffer) => {
        transcribed.push(wavBuffer);
        return 'How long does the migration take?';
      },
    },
    settings,
    logger: null,
  });

  const results = [];
  vadService.on('result', (result) => results.push(result));

  feed(vadService, makePcm(600, 0)); // room tone
  feed(vadService, makePcm(1200, 0.4)); // someone speaks
  feed(vadService, makePcm(900, 0)); // they stop

  await new Promise((resolve) => setTimeout(resolve, 60));
  await vadService.queue;

  check('one segment closed after the silence', transcribed.length === 1, transcribed.length);
  check('the segment was handed over as a WAV', transcribed[0]?.toString('ascii', 0, 4) === 'RIFF');
  check(
    'segment length covers the speech',
    transcribed[0] && durationMs(transcribed[0].length - 44, SAMPLE_RATE) > 1000,
    transcribed[0] && Math.round(durationMs(transcribed[0].length - 44, SAMPLE_RATE))
  );
  check('emitted { transcript, question }', results.length === 1 && Boolean(results[0].transcript) && Boolean(results[0].question), results[0]);
  check('flagged as a question', results[0]?.isQuestion === true);

  // Silence alone must not cost a Gemini call.
  const quiet = new SpeechService({
    gemini: {
      transcribeAudio: async () => {
        throw new Error('should not be called for silence');
      },
    },
    settings,
    logger: null,
  });
  feed(quiet, makePcm(2500, 0));
  await new Promise((resolve) => setTimeout(resolve, 30));
  check('silence never reaches Gemini', quiet.metrics().segments === 0, quiet.metrics());

  // A 200 ms blip is below minSpeechMs and should be dropped.
  const blip = new SpeechService({
    gemini: {
      transcribeAudio: async () => {
        throw new Error('should not be called for a blip');
      },
    },
    settings,
    logger: null,
  });
  feed(blip, makePcm(300, 0));
  feed(blip, makePcm(150, 0.5));
  feed(blip, makePcm(900, 0));
  await new Promise((resolve) => setTimeout(resolve, 30));
  check('sub-threshold blips are dropped', blip.metrics().segments === 0, blip.metrics());

  // ---- Gemini response handling -------------------------------------------
  check(
    'parses plain JSON',
    GeminiService.parseJson('{"question":"a","answer":"b","summary":[]}')?.question === 'a'
  );
  check(
    'parses fenced JSON',
    GeminiService.parseJson('```json\n{"question":"a","answer":"b","summary":["c"]}\n```')?.summary[0] === 'c'
  );
  check(
    'parses JSON wrapped in prose',
    GeminiService.parseJson('Sure! {"question":"a","answer":"b","summary":[]} hope that helps')?.answer === 'b'
  );
  check('returns null for garbage', GeminiService.parseJson('not json at all') === null);
  check(
    'extracts candidate text',
    GeminiService.extractText({ candidates: [{ content: { parts: [{ text: 'hello ' }, { text: 'world' }] } }] }) ===
      'hello world'
  );
  check('extractText survives an empty response', GeminiService.extractText({}) === '');

  const unconfigured = new GeminiService({ getApiKey: () => null, getConfig: () => ({}) });
  check('reports itself unconfigured without a key', unconfigured.configured === false);
  await unconfigured
    .generateAnswer('test')
    .then(() => check('refuses to call without a key', false))
    .catch((error) => check('refuses to call without a key', /No Gemini API key/.test(error.message)));

  console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures)' : ''}\n`);
})().catch((error) => {
  console.error('\nPipeline check crashed:', error);
  process.exit(1);
});
