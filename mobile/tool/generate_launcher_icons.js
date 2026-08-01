'use strict';

/**
 * Writes the Android launcher icons (all densities) with no image tooling and
 * no binary assets checked into the repo - the same generator the desktop app
 * uses for its tray icons.
 *
 *   node tool/generate_launcher_icons.js
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

const png = (size, rgba) => {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
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
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Same mark as the desktop app: gradient tile, open ring, centre dot. */
const icon = (x, y, s) => {
  const cx = (x + 0.5) / s;
  const cy = (y + 0.5) / s;

  const r = 0.22;
  const dx = Math.max(Math.abs(cx - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(cy - 0.5) - (0.5 - r), 0);
  const cornerDist = Math.sqrt(dx * dx + dy * dy);
  const tileAlpha = cornerDist > r ? 0 : Math.min(1, (r - cornerDist) * s * 0.9 + 0.5);
  if (tileAlpha <= 0) return [0, 0, 0, 0];

  const bg = mix([59, 130, 246], [124, 58, 237], (cx + cy) / 2);

  const rx = cx - 0.5;
  const ry = cy - 0.5;
  const dist = Math.sqrt(rx * rx + ry * ry);
  const inGap = Math.abs(Math.atan2(ry, rx)) < 0.5;
  const onRing = dist < 0.33 && dist > 0.21 && !inGap;
  const onDot = dist < 0.1;

  if (onRing || onDot) {
    const edge = Math.min(1, Math.min(Math.abs(dist - 0.33), Math.abs(dist - 0.21)) * s * 0.8 + 0.4);
    return [255, 255, 255, Math.round(255 * tileAlpha * (onDot ? 1 : edge))];
  }

  return [bg[0], bg[1], bg[2], Math.round(255 * tileAlpha)];
};

const DENSITIES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

const resDir = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

for (const [folder, size] of Object.entries(DENSITIES)) {
  const dir = path.join(resDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), png(size, icon));
  console.log(`wrote ${folder}/ic_launcher.png (${size}x${size})`);
}
