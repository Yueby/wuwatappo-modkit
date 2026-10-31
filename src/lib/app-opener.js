// Gets the app's main script patched (see app-patch.js) in one window.
//
// The script is read by the page once, when the page loads, so it has to be changed on its way in: the window's
// requests for scripts are held at the response (CDP `Fetch`), the main script is handed back with what it was
// given, and the page is loaded again once so that it reads that one. Everything else goes on untouched. When the
// page already has what a mod needs (the loader was there from the start, or this window was loaded again by the
// app) nothing is reloaded.
//
// WebView2 does not run `Page.addScriptToEvaluateOnNewDocument`, but it does hold and answer requests.

import { PATCH_VERSION, RULES, mayHoldPet, patchScript } from './app-patch.js';

const SCRIPTS = { urlPattern: '*/assets/*.js', requestStage: 'Response' };
const LOADED_MS = 15_000;
const SETTLED_MS = 12_000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class AppOpener {
  #session;
  #log;
  #on = false;
  #stop = null;
  #reloaded = false;
  last = null;                 // { applied, missing } of the script it patched last

  constructor({ session, log = () => {} }) {
    this.#session = session;
    this.#log = log;
  }

  // Start holding the window's scripts. Safe to call again.
  async #hold() {
    if (this.#on) return;
    this.#on = true;
    this.#stop = this.#session.on(msg => {
      if (msg.method === 'Fetch.requestPaused') void this.#answer(msg.params);
    });
    await this.#session.send('Fetch.enable', { patterns: [SCRIPTS] });
  }

  // A script held at its response: patched if it is the app's main one, passed on otherwise. A held request is
  // never left held, whatever happens.
  async #answer(params) {
    const session = this.#session;
    const { requestId } = params;
    try {
      if (params.responseStatusCode !== 200) return await session.send('Fetch.continueRequest', { requestId });
      const { body, base64Encoded } = await session.send('Fetch.getResponseBody', { requestId });
      const script = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
      if (!mayHoldPet(script)) return await session.send('Fetch.continueRequest', { requestId });
      const { text, applied, missing, ambiguous } = patchScript(script);
      this.last = { applied, missing, ambiguous };
      this.#log(`main script: ${applied.length ? `opened ${applied.join(', ')}` : 'nothing could be opened'}${missing.length ? `; not found: ${missing.filter(name => !ambiguous.includes(name)).join(', ') || '-'}` : ''}${ambiguous.length ? `; found more than once, left alone: ${ambiguous.join(', ')}` : ''}`);
      if (!applied.length) return await session.send('Fetch.continueRequest', { requestId });
      const marker = `window.__wuwaAppPatch=${JSON.stringify({ applied, missing, ambiguous, version: PATCH_VERSION })};`;
      const headers = (params.responseHeaders ?? []).filter(h => !/^content-(length|encoding)$/i.test(h.name));
      await session.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: headers,
        body: Buffer.from(marker + text, 'utf8').toString('base64'),
      });
    } catch (err) {
      if (session.closed) return;
      this.#log(`main script: could not be answered (${err.message}); passed on as it was`);
      await session.send('Fetch.continueRequest', { requestId }).catch(() => {});
    }
  }

  // What the page has now.
  state() {
    return this.#session.evaluate('({ open: !!(window.__wuwaApp && window.__wuwaApp.pet), patch: window.__wuwaAppPatch ?? null })');
  }

  // Make sure the page has it: hold the scripts, and load the page again if it was loaded without.
  // Resolves with { open, patch }; `open` false means the app's script did not offer what was looked for.
  async open() {
    await this.#hold();
    let state = await this.state();
    // A page that was patched by an older loader (fewer pieces than there are now) is loaded again too, once.
    const complete = state.open && !!state.patch && state.patch.version === PATCH_VERSION && RULES.every(rule => state.patch.applied.includes(rule.name) || state.patch.missing.includes(rule.name));
    if (complete || this.#reloaded) return state;
    this.#reloaded = true;
    this.#log('main: loading the page again to open the app\'s state');
    await this.#session.send('Page.reload', { ignoreCache: true });
    await sleep(300);
    for (const end = Date.now() + LOADED_MS; Date.now() < end;) {
      const ready = await this.#session.evaluate('document.readyState').catch(() => null);
      if (ready === 'complete') break;
      await sleep(100);
    }
    for (const end = Date.now() + SETTLED_MS; Date.now() < end;) {
      state = await this.state().catch(() => ({ open: false, patch: null }));
      if (state.open || (state.patch && !state.patch.applied.includes('pet')) || (this.last && !this.last.applied.includes('pet'))) break;
      await sleep(150);
    }
    return state;
  }

  // Let go of the window's scripts; what was patched stays patched until the page is loaded again.
  async close() {
    if (!this.#on) return;
    this.#on = false;
    this.#stop?.();
    await this.#session.send('Fetch.disable').catch(() => {});
  }
}
