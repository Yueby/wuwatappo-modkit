// Minimal CDP (Chrome DevTools Protocol) client for WebView2.
// Node 22+ has a global WebSocket, so there are no dependencies.

import { targetList } from './targets.js';

const EVAL_TIMEOUT_MS = 20_000;

export class CDPError extends Error {
  constructor(message, { method, cause } = {}) {
    super(message);
    this.name = 'CDPError';
    this.method = method;
    this.cause = cause;
  }
}

export class CDPSession {
  #ws;
  #nextId = 0;
  #pending = new Map();
  #listeners = new Set();
  #closed = false;

  constructor(wsUrl) {
    this.url = wsUrl;
  }

  static async connect(target) {
    const wsUrl = typeof target === 'string' ? target : target.webSocketDebuggerUrl;
    if (!wsUrl) throw new CDPError(`target has no WebSocket URL: ${JSON.stringify(target)}`);
    const session = new CDPSession(wsUrl);
    await session.#open();
    return session;
  }

  get closed() { return this.#closed; }

  #open() {
    return new Promise((resolve, reject) => {
      this.#ws = new WebSocket(this.url);

      const onFail = () => reject(new CDPError(`could not connect to ${this.url}`));
      this.#ws.addEventListener('error', onFail, { once: true });

      this.#ws.addEventListener('open', () => {
        this.#ws.removeEventListener('error', onFail);
        resolve();
      }, { once: true });

      this.#ws.addEventListener('close', () => {
        this.#closed = true;
        for (const { reject: rej } of this.#pending.values()) {
          rej(new CDPError('connection closed during call'));
        }
        this.#pending.clear();
        for (const fn of this.#listeners) fn({ method: 'session.closed' });
      });

      this.#ws.addEventListener('message', event => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.id !== undefined) {
          const pending = this.#pending.get(msg.id);
          if (!pending) return;
          this.#pending.delete(msg.id);
          if (msg.error) {
            pending.reject(new CDPError(msg.error.message ?? 'protocol error', {
              method: pending.method,
              cause: msg.error,
            }));
          } else {
            pending.resolve(msg.result);
          }
          return;
        }

        if (msg.method) {
          for (const fn of this.#listeners) {
            try { fn(msg); } catch { /* a listener must not break the stream */ }
          }
        }
      });
    });
  }

  send(method, params = {}) {
    if (this.#closed) return Promise.reject(new CDPError('session is closed', { method }));
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.#pending.delete(id)) reject(new CDPError(`timeout after ${EVAL_TIMEOUT_MS}ms`, { method }));
      }, EVAL_TIMEOUT_MS);

      this.#pending.set(id, {
        method,
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: err => { clearTimeout(timer); reject(err); },
      });

      try {
        this.#ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(new CDPError('failed to write to socket', { method, cause: err }));
      }
    });
  }

  // Subscribe to raw protocol events (Page.loadEventFired, session.closed, ...).
  on(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  // Evaluate in the page's main world. By-value results only; the returned
  // promise settles with the value the expression evaluates to.
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      allowUnsafeEvalBlockedByCSP: false,
    });
    if (result.exceptionDetails) {
      const d = result.exceptionDetails;
      throw new CDPError(
        d.exception?.description ?? d.text ?? 'evaluation threw',
        { method: 'Runtime.evaluate', cause: d },
      );
    }
    return result.result.value;
  }

  async enable(domains = ['Page', 'Runtime']) {
    for (const domain of domains) {
      await this.send(`${domain}.enable`);
    }
  }

  close() {
    if (this.#closed) return;
    try { this.#ws.close(); } catch { /* already gone */ }
    this.#closed = true;
  }
}

// Connect to every open app window. Caller owns the returned sessions.
export async function openAppSessions({ port, log = () => {} } = {}) {
  const windows = await targetList({ port });
  const sessions = [];
  for (const target of windows) {
    try {
      const session = await CDPSession.connect(target);
      await session.enable();
      sessions.push({ target, session });
    } catch (err) {
      log(`could not attach to ${target.url}: ${err.message}`);
    }
  }
  return sessions;
}