// Diagnostic HUD: shows live backend state in every window.
// Read-only by design — a safe thing to keep loaded while developing others.

mod.css(`
#wuwa-hud {
  position: fixed; left: 6px; top: 6px; z-index: 2147483647;
  pointer-events: none; white-space: pre;
  font: 12px/1.45 "Segoe UI", system-ui, sans-serif;
  color: #bfe; background: rgba(10, 14, 20, .85);
  border: 1px solid #2af; border-radius: 6px; padding: 5px 9px;
}
#wuwa-hud b { color: #7df; font-weight: 600; }
#wuwa-hud .route { color: #fd7; }`);

const hud = document.createElement('div');
hud.id = 'wuwa-hud';
document.body.appendChild(hud);

const [insets, elevated, keyPresses] = await Promise.all([
  mod.invoke('get_main_taskbar_insets').catch(() => null),
  mod.invoke('is_elevated_autostart_enabled').catch(() => null),
  mod.invoke('load_key_press_count', { environment: 'cn-cn-prod' }).catch(() => null),
]);

hud.innerHTML =
  `<b>wuwa-modkit v2</b>\n` +
  `<span class="route">${location.hash || '/'}</span>\n` +
  `taskbar  ${insets ? insets.bottom + 'px' : '?'}\n` +
  `autostart ${elevated}\n` +
  `keypress ` + `${keyPresses}`;

mod.log('HUD up on', location.hash || 'main');
// touched 1793096872

// hot reload probe
