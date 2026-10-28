// Unpacks the Tauri frontend out of the exe.
//
// Tauri stores each asset as: asset path (plain text) followed by a brotli
// stream. There is no index we can read without parsing Rust structures, so we
// take the paths as anchors and let the decompressor tell us where each stream
// starts and ends. Cheap and exact: a brotli stream either decodes or it does not.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Slack between the path string and its stream; empirical, small.
const MAX_SKIP = 48;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;

export function extractAssets({ exe, outDir, log = () => {} }) {
  const buffer = fs.readFileSync(exe);
  const text = buffer.toString('latin1'); // byte-preserving view for matching
  const pathPattern = /\/assets\/[A-Za-z0-9_\-/.@]+/g;

  const results = [];
  const seen = new Set();

  let match;
  while ((match = pathPattern.exec(text)) !== null) {
    const assetPath = match[0];
    if (seen.has(assetPath)) continue;
    seen.add(assetPath);

    const afterPath = match.index + assetPath.length;
    const found = findStream(buffer, afterPath);

    if (!found) {
      results.push({ path: assetPath, ok: false });
      continue;
    }

    const destination = path.join(outDir, assetPath.replace(/^\/+/, ''));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, found.data);

    results.push({
      path: assetPath,
      ok: true,
      bytes: found.data.length,
      skip: found.start - afterPath,
      file: destination,
    });
    log(`  ${String(found.data.length).padStart(9)}  ${assetPath}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '_index.json'), JSON.stringify(results, null, 1));
  return results;
}

function findStream(buffer, offset) {
  for (let skip = 0; skip <= MAX_SKIP; skip++) {
    const start = offset + skip;
    if (start >= buffer.length) break;
    const end = Math.min(start + MAX_ASSET_BYTES, buffer.length);
    try {
      const data = zlib.brotliDecompressSync(buffer.subarray(start, end));
      if (data.length > 0) return { start, data };
    } catch {
      // not the start of a stream; try the next byte
    }
  }
  return null;
}
