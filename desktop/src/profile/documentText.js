'use strict';

const zlib = require('zlib');
const path = require('path');

/**
 * Pulls plain text out of a CV without pulling in a parsing library.
 *
 * Both formats are simpler than their reputation:
 *   .docx  a ZIP whose word/document.xml holds the text
 *   .pdf   content streams, usually Flate-compressed, with the text sitting
 *          inside Tj / TJ show operators
 *
 * Scanned/image PDFs have no text layer at all - those fall back to the AI
 * provider, which can read them as images (see ProfileStore).
 */

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

const findEndOfCentralDirectory = (buffer) => {
  // The EOCD is at the end, after a comment of unknown length. Scan backwards.
  const start = Math.max(0, buffer.length - 66000);
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
};

const readZipEntry = (buffer, name) => {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw new Error('Not a valid .docx file (no zip directory found)');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    // The spec says forward slashes, but some writers (PowerShell's
    // Compress-Archive among them) emit backslashes. Accept both.
    const entryName = buffer.toString('utf8', offset + 46, offset + 46 + nameLength).replace(/\\/g, '/');

    if (entryName === name) {
      // The local header repeats the name/extra with its own lengths.
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`"${name}" not found inside the .docx`);
};

const decodeXmlEntities = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');

const docxText = (buffer) => {
  const xml = readZipEntry(buffer, 'word/document.xml').toString('utf8');

  return decodeXmlEntities(
    xml
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** Inflates every stream in the file that will inflate. */
const pdfStreams = (buffer) => {
  const streams = [];
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');

  let index = buffer.indexOf(marker);
  while (index !== -1) {
    let start = index + marker.length;
    if (buffer[start] === 0x0d) start += 1;
    if (buffer[start] === 0x0a) start += 1;

    const end = buffer.indexOf(endMarker, start);
    if (end === -1) break;

    const raw = buffer.subarray(start, end);
    try {
      streams.push(zlib.inflateSync(raw));
    } catch {
      // Not Flate (or not compressed at all) - keep it if it looks like text.
      if (raw.includes(Buffer.from('Tj')) || raw.includes(Buffer.from('TJ'))) streams.push(raw);
    }

    index = buffer.indexOf(marker, end + endMarker.length);
  }

  return streams;
};

/** Unescapes a PDF literal string: \( \) \\ \n \t and \ddd octal. */
const decodePdfString = (raw) =>
  raw.replace(/\\(n|r|t|b|f|\(|\)|\\|[0-7]{1,3})/g, (match, code) => {
    switch (code) {
      case 'n':
        return '\n';
      case 'r':
        return '';
      case 't':
        return '\t';
      case 'b':
      case 'f':
        return '';
      case '(':
        return '(';
      case ')':
        return ')';
      case '\\':
        return '\\';
      default:
        return String.fromCharCode(parseInt(code, 8));
    }
  });

const pdfText = (buffer) => {
  const pieces = [];

  for (const stream of pdfStreams(buffer)) {
    const content = stream.toString('latin1');
    if (!/\b(Tj|TJ)\b/.test(content)) continue;

    // Text-positioning operators mean a new line on the page.
    const tokens = content.match(/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bT[dDm*]\b|\bTJ\b|\bTj\b|\bET\b/g) || [];

    let line = '';
    for (const token of tokens) {
      if (token.startsWith('(')) {
        line += decodePdfString(token.slice(1, -1));
      } else if (token.startsWith('<')) {
        // Hex string, usually UTF-16BE from an embedded font subset.
        const hex = token.slice(1, -1).replace(/\s+/g, '');
        let decoded = '';
        for (let i = 0; i + 3 < hex.length; i += 4) {
          const code = parseInt(hex.slice(i, i + 4), 16);
          if (code >= 32) decoded += String.fromCharCode(code);
        }
        line += decoded;
      } else if (/^T[dDm*]$/.test(token) || token === 'ET') {
        if (line.trim()) pieces.push(line.trim());
        line = '';
      }
    }
    if (line.trim()) pieces.push(line.trim());
  }

  return pieces
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// ---------------------------------------------------------------------------

const SUPPORTED = ['.txt', '.md', '.markdown', '.docx', '.pdf'];

const mimeFor = (extension) =>
  ({
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  })[extension] || 'application/octet-stream';

/**
 * @returns {{ text: string, method: string, needsAi: boolean }}
 * `needsAi` means the file has no usable text layer and should be handed to a
 * vision-capable model instead.
 */
const extractText = (buffer, filename) => {
  const extension = path.extname(filename || '').toLowerCase();

  if (['.txt', '.md', '.markdown'].includes(extension)) {
    return { text: buffer.toString('utf8').trim(), method: 'plain text', needsAi: false };
  }

  if (extension === '.docx') {
    return { text: docxText(buffer), method: 'docx', needsAi: false };
  }

  if (extension === '.pdf') {
    let text = '';
    try {
      text = pdfText(buffer);
    } catch {
      text = '';
    }
    // A scanned CV has no text layer and yields essentially nothing, so only
    // then is it worth paying a model to read the pixels. The bar has to be
    // low: a short-but-real CV must not be thrown away just for being terse.
    const usable = text.replace(/\s+/g, ' ').trim().length >= 80;
    return { text, method: 'pdf', needsAi: !usable };
  }

  if (['.png', '.jpg', '.jpeg'].includes(extension)) {
    return { text: '', method: 'image', needsAi: true };
  }

  throw new Error(`Unsupported file type "${extension || filename}". Use PDF, DOCX, TXT or MD.`);
};

module.exports = { extractText, docxText, pdfText, mimeFor, SUPPORTED };
