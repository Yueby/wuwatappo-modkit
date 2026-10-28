// Framework: the registry that mods add UI to. Present in every window.
//
// Not a mod: the loader injects it before any mod runs (see discoverCore in src/lib/mods.js),
// so `mod.entry(...)` can always rely on `window.modkit` existing. It sorts ahead of the
// scripts that draw things (panel-tab.js) by file name; keep it that way.
//
// It holds the list of entries and nothing else. What an entry looks like on screen is the
// concern of whatever draws them — currently only the settings panel, in panel-tab.js, which
// sets `onChange` to redraw. The registry outlives a reload of that script (`??=`), so entries
// that mods have already added are not lost when the drawing code is hot-reloaded.

const kit = (window.modkit ??= { entries: [], onChange: null });

kit.addEntry = entry => {
  kit.entries.push(entry);
  kit.changed();
};

kit.removeEntry = entry => {
  const i = kit.entries.indexOf(entry);
  if (i >= 0) kit.entries.splice(i, 1);
  kit.changed();
};

// Called when entries change, and when a mod finishes installing (its status in
// window.__wuwaMods only becomes final after it returns). A throwing listener must not
// break the mod that triggered the change.
kit.changed = () => {
  try {
    kit.onChange?.();
  } catch (err) {
    console.warn('[modkit]', err);
  }
};
