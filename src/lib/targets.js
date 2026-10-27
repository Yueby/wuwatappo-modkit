// Discovery of the app's WebView2 windows over the CDP HTTP endpoint.

import http from 'node:http';

export const DEFAULT_PORT = 9222;

// Tauri serves the frontend from tauri.localhost; matching on that keeps us
// away from unrelated Chrome/Edge debugging endpoints on the same port.
const APP_ORIGIN = 'http://tauri.localhost';

export class DebugPortUnavailable extends Error {
  constructor(port) {
    super(
      `no DevTools endpoint on 127.0.0.1:${port}.\n` +
      `Start the patched copy first:  node src/cli.js lab  (see docs/LAUNCHING.md)`,
    );
    this.name = 'DebugPortUnavailable';
    this.port = port;
  }
}

function getJSON(path, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(new Error(`unexpected reply from ${path}: ${body.slice(0, 120)}`)); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`timed out talking to port ${port}`)); });
    req.on('error', () => reject(new DebugPortUnavailable(port)));
  });
}

export async function targetList({ port = DEFAULT_PORT, timeoutMs = 3000 } = {}) {
  const list = await getJSON('/json/list', port, timeoutMs);
  return list.filter(t => t.type === 'page' && t.url?.startsWith(APP_ORIGIN));
}

export async function browserVersion({ port = DEFAULT_PORT } = {}) {
  return getJSON('/json/version', port, 3000);
}

// "#/panel" out of "http://tauri.localhost/index.html#/panel".
export function windowLabel(target) {
  const hash = target.url.split('#')[1] ?? '';
  return hash.replace(/^\//, '') || 'main';
}