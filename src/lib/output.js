// Small output helpers so every command reports the same way.

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

export function log(message) {
  process.stdout.write(`${message}\n`);
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
  process.stderr.write(`${style.red('error')} ${message}\n`);
}