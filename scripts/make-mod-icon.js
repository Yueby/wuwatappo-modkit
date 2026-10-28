// Generates the MOD tab icon as a 54x54 PNG, matching the stock icons' size and
// colour so it sits in the strip without looking bolted on.
//
// Hand-rolled PNG writer (zlib is in Node's standard library) to avoid pulling in
// an image dependency for one 1 KB asset.

import zlib from 'node:zlib';
import fs from 'node:fs';

const SIZE = 54;

// The stock icons are drawn in a warm brown that reads against the dark panel
// strip. Sampled from the setting icon's body.
const INK = [138, 106, 79, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Draw a filled rounded rectangle into an RGBA pixel buffer, antialiased.
//
// Coverage is sampled 4x4 inside each pixel and averaged, which smooths the
// corner arcs. Without this the arcs come out visibly jagged next to the stock
// icons, which were exported from Figma with antialiasing.
const SAMPLES = 4;

function roundRect(px, x0, y0, w, h, r) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const fx = x + (sx + 0.5) / SAMPLES;
          const fy = y + (sy + 0.5) / SAMPLES;
          if (insideRoundRect(fx, fy, x0, y0, w, h, r)) hits++;
        }
      }
      if (!hits) continue;

      const alpha = hits / (SAMPLES * SAMPLES);
      const i = (y * SIZE + x) * 4;
      const prevA = px[i + 3] / 255;
      // Composite over whatever is already there (the plus overlaps a cell edge).
      const outA = alpha + prevA * (1 - alpha);
      if (outA <= 0) continue;
      for (let c = 0; c < 3; c++) {
        px[i + c] = Math.round((INK[c] * alpha + px[i + c] * prevA * (1 - alpha)) / outA);
      }
      px[i + 3] = Math.round(outA * 255);
    }
  }
}

function insideRoundRect(px_, py_, x0, y0, w, h, r) {
  if (px_ < x0 || px_ > x0 + w || py_ < y0 || py_ > y0 + h) return false;
  // Clamp to the inner rectangle, then check the corner radius.
  const cx = Math.min(Math.max(px_, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(py_, y0 + r), y0 + h - r);
  const dx = px_ - cx, dy = py_ - cy;
  return dx * dx + dy * dy <= r * r;
}

// A four-square grid with a plus in the bottom-right quadrant, drawn from filled
// rectangles so there is no font or stroke-width dependency.
function drawGrid(px, ox, oy, cell, gap, radius) {
  roundRect(px, ox, oy, cell, cell, radius);
  roundRect(px, ox + cell + gap, oy, cell, cell, radius);
  roundRect(px, ox, oy + cell + gap, cell, cell, radius);

  // plus
  const px0 = ox + cell + gap;
  const py0 = oy + cell + gap;
  const bar = Math.max(2, Math.round(cell / 4));
  const len = cell;
  roundRect(px, px0 + Math.round((cell - bar) / 2), py0, bar, len, 1);
  roundRect(px, px0, py0 + Math.round((cell - bar) / 2), len, bar, 1);
}

function buildIcon() {
  const px = Buffer.alloc(SIZE * SIZE * 4); // transparent
  // The stock icons are chunky filled shapes with generous corner rounding.
  // Match that weight: bigger cells, fewer pixels of gap, more rounding.
  const cell = 16, gap = 4, radius = 5;
  const total = cell * 2 + gap;
  const ox = Math.round((SIZE - total) / 2);
  const oy = Math.round((SIZE - total) / 2);
  drawGrid(px, ox, oy, cell, gap, radius);

  // PNG rows need a filter byte (0 = none) in front of each scanline.
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = buildIcon();
const out = process.argv[2] ?? 'work/mod-icon.png';
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
console.log(`data:image/png;base64,${png.toString('base64')}`);