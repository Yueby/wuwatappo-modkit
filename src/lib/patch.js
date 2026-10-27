// Test-only copy of the app: same bytes except two length-preserving edits.
//
// Why this exists: the installed exe's manifest demands administrator, and the
// app is single-instance keyed on its bundle identifier. Running the original
// means (a) no CDP launch pointer from a normal shell, and (b) the copy would be
// forwarded to the already-running original and exit. Renaming the identifier
// gives the copy its own mutex and its own WebView2 data folder, so it can run
// side by side with a real install.
//
// Both replacements keep the original byte length, so every PE offset, checksum
// table entry and signature blob stays where it was.

import fs from 'node:fs/promises';
import path from 'node:path';

export const ORIGINAL_EXE = 'E:\\Programs\\WuwaTappo\\WuwaTappo.exe';

const EDITS = [
  {
    label: 'manifest: requireAdministrator -> asInvoker',
    from: Buffer.from('<requestedExecutionLevel level="requireAdministrator" uiAccess="false" />', 'utf8'),
    to: Buffer.from('<requestedExecutionLevel level="asInvoker" uiAccess="false" />', 'utf8'),
    exactly: 1,
  },
  {
    label: 'bundle identifier: com.kuro.wuwatappo.cn -> lab.kuro.wuwatappo.cn',
    from: Buffer.from('com.kuro.wuwatappo.cn', 'utf8'),
    to: Buffer.from('lab.kuro.wuwatappo.cn', 'utf8'),
    exactly: 1,
  },
];

export async function buildLabCopy({ source = ORIGINAL_EXE, destination }) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);

  const original = await fs.readFile(destination);
  const patched = Buffer.from(original);
  const applied = [];

  for (const edit of EDITS) {
    if (edit.to.length > edit.from.length) {
      throw new Error(`${edit.label}: replacement is longer than the original`);
    }
    const padded = Buffer.concat([edit.to, Buffer.alloc(edit.from.length - edit.to.length, 0x20)]);

    let count = 0;
    let at = patched.indexOf(edit.from, 0);
    while (at !== -1) {
      padded.copy(patched, at);
      count++;
      at = patched.indexOf(edit.from, at + edit.from.length);
    }
    if (count !== edit.exactly) {
      throw new Error(`${edit.label}: expected ${edit.exactly} occurrence(s), found ${count}`);
    }
    applied.push({ label: edit.label, count });
  }

  if (patched.length !== original.length) {
    throw new Error('length changed; refusing to write a file with shifted offsets');
  }

  await fs.writeFile(destination, patched);
  return { destination, applied, bytes: patched.length };
}

// The lab copy must never be signed-and-trusted; verify we did in fact change it.
export async function describeEdits(file) {
  const data = await fs.readFile(file);
  return EDITS.map(edit => ({
    label: edit.label,
    replacements: data.includes(edit.to),
    untouched: data.includes(edit.from),
  }));
}