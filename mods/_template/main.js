// Template for a mod with settings. Folders starting with "_" are not loaded: copy this folder,
// drop the underscore, and edit mod.json (what the MOD page shows) and this file (what runs).
// "scripts" in mod.json says which window runs which file; this one runs in main only.

function greet() {
  if (!mod.config.get('greet')) return;
  for (let i = 0; i < mod.config.get('times'); i++) mod.log('hello');
  mod.live('last', new Date().toLocaleTimeString());   // fills the "last" row on the MOD page
}

// Called whichever window changed the value, so the MOD page's switch and this stay in step.
mod.config.onChange('greet', greet);

greet();
