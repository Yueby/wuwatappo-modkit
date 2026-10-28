// Generates the MOD tab icons: one per tab state, the way the app's own icons work.
//
// The app ships two images per tab and swaps them with CSS. Measured from the
// running app (every stock tab agrees to within a pixel or two):
//
//                image    glyph     colour
//   unselected   48x48    ~26x25    240,206,169  light cream   (reads on the dark sidebar)
//   selected     54x54    ~29x27    142, 94, 67  dark brown    (reads on the bright pill)
//
// Using one dark image for both states is what made an unselected MOD tab disappear
// into the sidebar, and a 36px glyph made it look oversized next to ~26px stock ones.
// So: two images, same drawing, sized and coloured per state.
//
// Hand-rolled PNG writer (zlib is in Node's standard library) to avoid an image
// dependency for two tiny assets.
//
// The framework generates these when it loads (see discoverCore in mods.js), so there
// is no checked-in image to keep in step with the numbers above. To look at them:
//   node scripts/make-mod-icon.js <dir>      writes <dir>/mod-icon-{inactive,active}.png

import zlib from 'node:zlib';

export const STATES = {
  inactive: { size: 48, glyph: 26, ink: [240, 206, 169] },
  active:   { size: 54, glyph: 29, ink: [142, 94, 67] },
};

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

// Antialiased filled rounded rectangle, composited over what is already in `px`.
// Coverage is sampled SAMPLES x SAMPLES inside each pixel and averaged, which smooths
// the corner arcs; the stock icons were exported from Figma with antialiasing.
const SAMPLES = 4;

function inside(fx, fy, x0, y0, w, h, r) {
  if (fx < x0 || fx > x0 + w || fy < y0 || fy > y0 + h) return false;
  const cx = Math.min(Math.max(fx, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(fy, y0 + r), y0 + h - r);
  const dx = fx - cx, dy = fy - cy;
  return dx * dx + dy * dy <= r * r;
}

function roundRect(canvas, x0, y0, w, h, r) {
  const { px, size, ink } = canvas;
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (inside(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES, x0, y0, w, h, r)) hits++;
        }
      }
      if (!hits) continue;

      const alpha = hits / (SAMPLES * SAMPLES);
      const i = (y * size + x) * 4;
      const prevA = px[i + 3] / 255;
      const outA = alpha + prevA * (1 - alpha);
      for (let c = 0; c < 3; c++) {
        px[i + c] = Math.round((ink[c] * alpha + px[i + c] * prevA * (1 - alpha)) / outA);
      }
      px[i + 3] = Math.round(outA * 255);
    }
  }
}

// Four rounded squares with a plus in the lower-right one, scaled to `glyph` pixels
// across. Proportions (cell : gap : radius) are fixed; only the scale changes.
function drawGlyph(canvas, glyph) {
  const gap = glyph * 0.14;
  const cell = (glyph - gap) / 2;
  const radius = cell * 0.30;
  const ox = (canvas.size - glyph) / 2;
  const oy = (canvas.size - glyph) / 2;

  roundRect(canvas, ox, oy, cell, cell, radius);
  roundRect(canvas, ox + cell + gap, oy, cell, cell, radius);
  roundRect(canvas, ox, oy + cell + gap, cell, cell, radius);

  // The plus is two bars; they overlap in the middle, which compositing handles.
  const bar = Math.max(2, cell * 0.26);
  const px0 = ox + cell + gap;
  const py0 = oy + cell + gap;
  roundRect(canvas, px0 + (cell - bar) / 2, py0, bar, cell, bar / 2);
  roundRect(canvas, px0, py0 + (cell - bar) / 2, cell, bar, bar / 2);
}

export function buildIcon({ size, glyph, ink }) {
  const canvas = { size, ink, px: Buffer.alloc(size * size * 4) }; // transparent
  drawGlyph(canvas, glyph);

  // PNG rows need a filter byte (0 = none) in front of each scanline.
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    canvas.px.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const toDataUrl = png => `data:image/png;base64,${png.toString('base64')}`;

// Both states as data URLs, ready to drop into CSS. The output depends on nothing but
// the constants above, and `watch` asks on every poll, so draw them once per process.
let cached = null;
export function iconDataUrls() {
  if (!cached) {
    cached = {};
    for (const [state, spec] of Object.entries(STATES)) cached[state] = toDataUrl(buildIcon(spec));
  }
  return cached;
}
