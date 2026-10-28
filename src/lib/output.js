// Small output helpers so every command reports the same way.

import fs from 'node:fs';
import path from 'node:path';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const paint = (code, text) => useColor ? `\x1b[${code}m${text}\x1b[0m` : text;

export const style = {
  dim: t => paint('2', t),
  bold: t => paint('1', t),
  red: t => paint('31', t),
  green: t => paint('32', t),
  yellow: t => paint('33', t),
  cyan: t => paint('36', t),
};

// A loader that runs with no window (started at logon) has nowhere to be read: what it says also
// goes to a file, with the time. See teeToFile().
let sink = null;
const ANSI = /\x1b\[[0-9;]*m/g;

function toFile(text) {
  if (!sink) return;
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    for (const line of text.replace(ANSI, '').split('\n')) if (line.trim()) fs.appendFileSync(sink, `${stamp}  ${line}\n`);
  } catch { /* a log that cannot be written must not stop what it is logging */ }
}

// From now on every line is also appended to `file`. A file over maxBytes is moved to `file.1`
// first (one generation kept), so it cannot grow without bound over weeks of running.
export function teeToFile(file, { maxBytes = 1_000_000 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size > maxBytes) fs.renameSync(file, `${file}.1`);
  } catch { /* none yet */ }
  sink = file;
  return file;
}

export function stopTee() {
  sink = null;
}

export function log(message) {
  try {
    process.stdout.write(`${message}\n`);
  } catch { /* no console to write to */ }
  toFile(String(message));
}

export function section(title) {
  log(`\n${style.bold(title)}`);
}

// Aligned "key: value" lines.
export function field(key, value) {
  const width = 14;
  log(`  ${style.dim(key.padEnd(width))} ${value}`);
}

export function statusWord(status) {
  switch (status) {
    case 'ok': return style.green('ok');
    case 'already-installed': return style.dim('already');
    case 'removed': return style.yellow('removed');
    case 'off': return style.dim('off (switched off)');
    case 'not-ready': return style.yellow('waiting for app');
    case 'error': return style.red('error');
    default: return status;
  }
}

export function fail(message) {
  try {
    process.stderr.write(`${style.red('error')} ${message}\n`);
  } catch { /* no console to write to */ }
  toFile(`error ${message}`);
}