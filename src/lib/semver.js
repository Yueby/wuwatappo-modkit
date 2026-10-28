// The part of semver ranges a mod needs to say which version of another mod, or of Node, it works
// with. Not the whole of npm's grammar: a range is one or more alternatives separated by ||, each
// a list of comparators separated by spaces, each one of
//
//   *   1.2.3   =1.2.3   >=1.2.3   >1.2.3   <=1.2.3   <1.2.3   ^1.2.3   ~1.2.3   1.x   1.2.x
//
// Prerelease tags are not ordered (1.2.3-beta counts as 1.2.3), which is enough to ask "at least".

const VERSION = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/;

export function parse(text) {
  const match = VERSION.exec(String(text).trim());
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

// One comparator as a test on a parsed version, or null if it is not one.
function comparator(text) {
  if (text === '*' || text === 'x' || text === '') return () => true;

  const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:[-+].*)?$/.exec(text);
  if (!match) return null;
  const [, operator = '=', major, minor, patch] = match;
  const wild = part => part === undefined || part === 'x' || part === '*';
  if (wild(major)) return () => true;

  const base = [Number(major), wild(minor) ? 0 : Number(minor), wild(patch) ? 0 : Number(patch)];
  switch (operator) {
    case '>=': return v => compare(v, base) >= 0;
    case '>': return v => compare(v, base) > 0;
    case '<=': return v => compare(v, wild(patch) ? [base[0], wild(minor) ? Infinity : base[1], Infinity] : base) <= 0;
    case '<': return v => compare(v, base) < 0;
    case '^': {
      // Compatible: nothing changes the left-most non-zero part.
      const upper = base[0] > 0 ? [base[0] + 1, 0, 0] : base[1] > 0 ? [0, base[1] + 1, 0] : [0, 0, base[2] + 1];
      return v => compare(v, base) >= 0 && compare(v, upper) < 0;
    }
    case '~': {
      const upper = wild(minor) ? [base[0] + 1, 0, 0] : [base[0], base[1] + 1, 0];
      return v => compare(v, base) >= 0 && compare(v, upper) < 0;
    }
    default: {                           // exact, or a partial like 1.2 / 1.x
      if (!wild(patch)) return v => compare(v, base) === 0;
      const upper = wild(minor) ? [base[0] + 1, 0, 0] : [base[0], base[1] + 1, 0];
      return v => compare(v, base) >= 0 && compare(v, upper) < 0;
    }
  }
}

// A function that says whether a version satisfies the range, or null when the range is not one.
function compile(range) {
  const alternatives = [];
  for (const alternative of String(range).split('||')) {
    const tests = [];
    for (const part of alternative.trim().split(/\s+/)) {
      const test = comparator(part);
      if (!test) return null;
      tests.push(test);
    }
    alternatives.push(tests);
  }
  return version => alternatives.some(tests => tests.every(test => test(version)));
}

export const validRange = range => compile(range) !== null;

// satisfies('1.4.2', '^1.2.0') -> true. A version that is not one never satisfies, except `*`.
export function satisfies(version, range) {
  const test = compile(range);
  if (!test) return false;
  const parsed = parse(version ?? '');
  if (!parsed) return String(range).trim() === '*';
  return test(parsed);
}
