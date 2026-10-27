// _scratch.js — template for quick experiments.
// Files starting with "_" are not loaded; rename to try it.

if (!location.hash.includes('/panel')) return;

mod.log('attached to', location.hash);
return { ok: true };