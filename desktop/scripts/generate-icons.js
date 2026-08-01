'use strict';

/**
 * Generates the app + tray icons with zero binary assets in the repo.
 * Writes:
 *   build/icon.png        256x256 - electron-builder turns this into the .ico
 *   src/tray/icons.js     base64 16/32px trays (idle, live, offline)
 *
 * Run automatically by `npm run build`, or on demand: npm run icons
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
};

/** rgba: (x, y, size) => [r, g, b, a] */
const png = (size, rgba) => {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = rgba(x, y, size);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/**
 * The mark: a soft-cornered gradient tile with a "sound ring" cut out of it -
 * an open circle with a gap on the right, reading as both a C and a signal.
 */
const makeIcon = (accentA, accentB) => (x, y, size) => {
  const s = size;
  const cx = (x + 0.5) / s;
  const cy = (y + 0.5) / s;

  // rounded square mask
  const r = 0.22;
  const dx = Math.max(Math.abs(cx - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(cy - 0.5) - (0.5 - r), 0);
  const cornerDist = Math.sqrt(dx * dx + dy * dy);
  const tileAlpha = cornerDist > r ? 0 : Math.min(1, (r - cornerDist) * s * 0.9 + 0.5);
  if (tileAlpha <= 0) return [0, 0, 0, 0];

  const bg = mix(accentA, accentB, (cx + cy) / 2);

  // ring
  const rx = cx - 0.5;
  const ry = cy - 0.5;
  const dist = Math.sqrt(rx * rx + ry * ry);
  const angle = Math.atan2(ry, rx); // -pi..pi, 0 = right
  const inGap = Math.abs(angle) < 0.5;
  const ringOuter = 0.33;
  const ringInner = 0.21;
  const onRing = dist < ringOuter && dist > ringInner && !inGap;

  // inner dot
  const onDot = dist < 0.1;

  if (onRing || onDot) {
    const edge = Math.min(
      1,
      Math.min(Math.abs(dist - ringOuter), Math.abs(dist - ringInner)) * s * 0.8 + 0.4
    );
    const alpha = Math.round(255 * tileAlpha * (onDot ? 1 : edge));
    return [255, 255, 255, alpha];
  }

  return [bg[0], bg[1], bg[2], Math.round(255 * tileAlpha)];
};

const PALETTES = {
  app: [[59, 130, 246], [124, 58, 237]], // blue -> violet
  idle: [[148, 163, 184], [100, 116, 139]], // slate (not capturing)
  live: [[34, 197, 94], [16, 185, 129]], // green (capturing)
  offline: [[239, 68, 68], [220, 38, 38]], // red (backend down)
};

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build');
const trayDir = path.join(root, 'src', 'tray');

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(trayDir, { recursive: true });

fs.writeFileSync(path.join(buildDir, 'icon.png'), png(256, makeIcon(...PALETTES.app)));

const trays = {};
for (const [name, palette] of Object.entries(PALETTES)) {
  if (name === 'app') continue;
  trays[name] = {
    x16: png(16, makeIcon(...palette)).toString('base64'),
    x32: png(32, makeIcon(...palette)).toString('base64'),
  };
}

const banner = `'use strict';
// GENERATED FILE - run \`npm run icons\` to regenerate. Do not edit by hand.
`;

fs.writeFileSync(
  path.join(trayDir, 'icons.js'),
  `${banner}module.exports = ${JSON.stringify(trays, null, 2)};\n`
);

console.log('icons: wrote build/icon.png and src/tray/icons.js');
