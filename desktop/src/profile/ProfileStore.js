'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { extractText, looksLikeProse, mimeFor, SUPPORTED } = require('./documentText');

/**
 * The candidate profile used by interview mode: CV text, the role being
 * interviewed for, and any extra notes.
 *
 * It lives in its own file rather than settings.json because a CV is several
 * kilobytes of personal data and does not belong in a config blob. It never
 * leaves this machine except as part of a prompt to the model you chose.
 */
class ProfileStore extends EventEmitter {
  constructor({ userDataPath, ai, logger }) {
    super();
    this.file = path.join(userDataPath, 'profile.json');
    this.ai = ai;
    this.log = logger;
    this.data = {
      resumeText: '',
      resumeFileName: null,
      resumeUpdatedAt: null,
      jobTitle: '',
      jobDescription: '',
      notes: '',
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
      }
    } catch (error) {
      this.log?.error('Could not read the profile, starting empty', { error: error.message });
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      this.emit('changed', this.public());
    } catch (error) {
      this.log?.error('Could not save the profile', { error: error.message });
    }
  }

  /** What interview prompts read. */
  get() {
    return {
      resumeText: this.data.resumeText,
      jobTitle: this.data.jobTitle,
      jobDescription: this.data.jobDescription,
      notes: this.data.notes,
    };
  }

  /** What the UI renders - the CV text is large, so send a preview by default. */
  public({ full = false } = {}) {
    const text = this.data.resumeText || '';
    return {
      ...this.data,
      resumeText: full ? text : text.slice(0, 4000),
      resumeChars: text.length,
      resumeWords: text ? text.split(/\s+/).filter(Boolean).length : 0,
      truncated: !full && text.length > 4000,
      hasResume: text.trim().length > 0,
      supportedTypes: SUPPORTED,
      profilePath: this.file,
    };
  }

  patch(partial = {}) {
    const allowed = ['resumeText', 'jobTitle', 'jobDescription', 'notes'];
    for (const key of allowed) {
      if (partial[key] !== undefined) this.data[key] = String(partial[key]);
    }
    if (partial.resumeText !== undefined) {
      this.data.resumeFileName = partial.resumeFileName || 'Pasted text';
      this.data.resumeUpdatedAt = new Date().toISOString();
    }
    this.save();
    return this.public();
  }

  /**
   * Reads a CV off disk. Text formats are parsed locally; a scanned PDF or an
   * image has no text layer, so it goes to the model instead - which only
   * works on a provider that can read documents (Gemini can, OpenAI cannot).
   */
  async importFile(filePath) {
    const buffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    if (buffer.length > 15 * 1024 * 1024) {
      throw new Error('That file is over 15 MB. Export a smaller PDF or paste the text instead.');
    }

    let { text, method, needsAi } = extractText(buffer, filename);

    if (needsAi) {
      if (!this.ai?.configured) {
        throw new Error('That PDF has no text layer (it is probably a scan). Add an API key first, or paste the text in.');
      }
      this.log?.info('No text layer found, asking the model to read the document', { filename });
      text = await this.ai.extractDocumentText(buffer, {
        mimeType: mimeFor(path.extname(filename).toLowerCase()),
      });
      method = `${method} via model`;
    }

    const clean = String(text || '').replace(/\r/g, '').trim();
    if (clean.length < 50) {
      throw new Error('Could not find readable text in that file. Try a different export, or paste the text in.');
    }

    // Last line of defence: never store something that is not readable prose,
    // whichever route produced it. Garbage here becomes garbage in the prompt.
    if (!looksLikeProse(clean)) {
      throw new Error(
        'That file did not decode into readable text. Try "Save as PDF" from Word, export as .docx, or paste the text in.'
      );
    }

    this.data.resumeText = clean;
    this.data.resumeFileName = filename;
    this.data.resumeUpdatedAt = new Date().toISOString();
    this.save();

    this.log?.info('CV imported', { filename, method, chars: clean.length });
    return { ...this.public(), method };
  }

  clearResume() {
    this.data.resumeText = '';
    this.data.resumeFileName = null;
    this.data.resumeUpdatedAt = null;
    this.save();
    return this.public();
  }
}

module.exports = { ProfileStore };
