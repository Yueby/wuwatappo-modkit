// What is added to the app's main script (src/lib/app-patch.js), and the holding and answering of it in a window
// (src/lib/app-opener.js). The script here is a small one in the shape the app's minified one has; when the
// extracted real ones are at hand (work/assets, work/assets-1.0.2: `extract-assets`) they are patched too.
//
//   node --test tests/app-patch.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PATCH_VERSION, RULES, patchScript, mayHoldPet } from '../src/lib/app-patch.js';
import { AppOpener } from '../src/lib/app-opener.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The shapes, with the names the minifier gave (and a few it did not: the properties).
const SCRIPT = `
const W=v=>({value:v});
let Pt=W(null),Mt=new Set(),de=W([]),Ln=0,Bn=0,Pr=0,Tr=0;
function Mr(a,b){return{left:Math.min(a,1000),top:Math.min(b,500)}}
function tn(m){return m.fixed!==true}
const Lm=new Map();
function Li(e){if(!Lm.has(e.id))Lm.set(e.id,W({left:e.left,top:e.top}));return Lm.get(e.id)}
function en(e){return Li(e).value}function vt(e,t){const o=Li(e);o.value={...o.value,...t}}
function Hd(){const e=Pt.value;if(e===null)return;const t=Pr+Ln,o=Tr+Bn;(Math.abs(Ln)>.5||Math.abs(Bn)>.5)&&Mt.delete(e);const l=Mr(t,o),f=de.value.find(ee=>ee.id===e);f&&tn(f)&&(f.left=l.left,f.top=l.top,vt(f,l));Pt.value=null}
const syncs=[];const{syncMainHitRegion:Me,scheduleHitRegionAfterRoomCatsDomUpdate:on,scheduleSyncHitRegionAfterPaint:mn}={syncMainHitRegion:()=>syncs.push('sync'),scheduleHitRegionAfterRoomCatsDomUpdate:()=>syncs.push('dom'),scheduleSyncHitRegionAfterPaint:()=>syncs.push('paint')};
function make(){const C=W(100),F=W(200),N=W(true),U=W(true),ae=0;function st(){}
async function Ge(){if(!N.value){st();return}const J=U.value,ve=ae;N.value=false}
function Jt(){}return{dockLeft:C,dockTop:F,draggingDock:N,movedDuringDrag:U,onWindowResize:Jt,finishDockPointerGesture:Ge}}
const api={make,Hd,Pt,Mt,de,vt,en,Li,W,syncs};
window.__test=api;
`;
const withText = 'data-room-cat-id dockLeft:';

function run(script) {
  const window = new EventTarget();
  new Function('window', 'CustomEvent', 'setTimeout', script)(window, CustomEvent, setTimeout);
  return window;
}

test('the four things are added to a script of the shape the app has, and it still runs', async () => {
  const { text, applied, missing } = patchScript(SCRIPT);
  assert.deepEqual(applied.sort(), ['hit-region', 'member-dragged', 'members', 'pet', 'pet-dragged']);
  assert.deepEqual(missing, []);
  const window = run(text);
  const t = window.__test;

  // the person's own pet: the refs the page is drawn from
  assert.equal(window.__wuwaApp.pet, undefined, 'the pet is not handed out before the app makes it');
  const own = t.make();
  assert.equal(window.__wuwaApp.pet.left, own.dockLeft);
  assert.equal(window.__wuwaApp.pet.held, own.draggingDock, 'whether it is held');
  assert.equal(window.__wuwaApp.pet.moved, own.movedDuringDrag, 'and whether it has moved while held');
  window.__wuwaApp.pet.left.value = 321;
  assert.equal(own.dockLeft.value, 321, 'they are the app\'s own refs');

  // the other players' pets
  t.de.value = [{ id: 7, left: 10, top: 20 }, { id: 8, left: 30, top: 40, fixed: true }];
  const members = window.__wuwaApp.members;
  t.Mt.add(7);
  assert.deepEqual(members.where(t.de.value[0]), { left: 10, top: 20 });
  assert.equal(members.place('7', 55, 66), true, 'by id, a number or its text');
  assert.deepEqual(members.where(t.de.value[0]), { left: 55, top: 66 }, 'the place the page is drawn from');
  assert.deepEqual([t.de.value[0].left, t.de.value[0].top], [55, 66], 'and the member itself');
  assert.equal(t.Mt.has(7), false, 'and it is no longer one the app puts by itself');
  assert.equal(members.place(8, 1, 1), false, 'one that cannot be dragged is not moved');
  assert.equal(members.place(99, 1, 1), false, 'nor one that is not there');
  assert.deepEqual(members.clamp(5000, 5000), { left: 1000, top: 500 }, 'the app\'s own clamping');
  assert.deepEqual(members.list().map(m => m.id), [7, 8]);
  assert.equal(members.held(), null, 'no pet of a player is held');
  t.Pt.value = 8;
  assert.equal(members.held(), 8, 'and which one is, when one is');
  t.Pt.value = null;

  // the window is cut to where the pets are: the native side can be told again
  window.__wuwaApp.hit.afterPaint();
  window.__wuwaApp.hit.sync();
  assert.deepEqual(t.syncs, ['paint', 'sync']);
});

test('letting go of a pet after dragging it is told, a moment later: the person\'s own, and a player\'s', async () => {
  const { text } = patchScript(SCRIPT);
  const window = run(text);
  const t = window.__test;
  const events = [];
  window.addEventListener('wuwa-pet-dragged', () => events.push('pet'));
  window.addEventListener('wuwa-member-dragged', e => events.push(`member ${e.detail.id}`));

  const pet = window.__test.make();
  void pet;
  // the gesture ends: the app's own function runs
  const finish = [...text.matchAll(/finishDockPointerGesture:(\w+)/g)][0][1];
  assert.ok(finish);
  // the drag-end of a member: the id is read from the ref
  t.de.value = [{ id: 7, left: 10, top: 20 }];
  t.Pt.value = 7;
  t.Hd();
  assert.deepEqual(events, [], 'not before the app has put the pet down');
  await sleep(450);
  assert.deepEqual(events, ['member 7']);
});

test('what it does not find, it leaves alone, and says so; the script is then the one it was', () => {
  const none = 'const a=1;function b(){return{x:1}}';
  assert.deepEqual(patchScript(none), { text: none, applied: [], missing: ['pet', 'hit-region', 'pet-dragged', 'members', 'member-dragged'], ambiguous: [] });
});

test('a shape that is found twice is left alone, and named: which of the two is the one of the app is not known', () => {
  const twice = SCRIPT + SCRIPT.slice(SCRIPT.indexOf('function Hd()'), SCRIPT.indexOf('function make()'));
  const { text, applied, missing, ambiguous } = patchScript(twice);
  assert.deepEqual(ambiguous.sort(), ['hit-region', 'member-dragged', 'members']);
  assert.ok(missing.includes('members') && missing.includes('member-dragged'));
  assert.deepEqual(applied.sort(), ['pet', 'pet-dragged']);
  assert.ok(!text.includes('.members='), 'nothing was added for the ambiguous ones');
  assert.ok(!text.includes('wuwa-member-dragged'));
});

test('a script that is not the app\'s main one is not looked at', () => {
  assert.equal(mayHoldPet('function a(){}'), false);
  assert.equal(mayHoldPet(withText), true);
});

const real = [
  ['1.0.3', path.join(import.meta.dirname, '..', 'work', 'assets', 'assets')],
  ['1.0.2', path.join(import.meta.dirname, '..', 'work', 'assets-1.0.2', 'assets')],
];
for (const [version, dir] of real) {
  const main = fs.existsSync(dir) ? fs.readdirSync(dir).find(name => /^index-.*\.js$/.test(name) && mayHoldPet(fs.readFileSync(path.join(dir, name), 'utf8'))) : null;
  test(`the app's own ${version} main script: all five are found, and the result is still a script`, { skip: main ? false : `${dir} is not extracted` }, () => {
    const script = fs.readFileSync(path.join(dir, main), 'utf8');
    const { text, applied, missing } = patchScript(script);
    assert.deepEqual(missing, []);
    assert.equal(applied.length, 5);
    assert.ok(text.length > script.length && text.length - script.length < 2000, 'a few hundred characters, not more');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'patch-')), 'main.mjs');
    fs.writeFileSync(file, text);
    execFileSync(process.execPath, ['--check', file]);         // throws on a syntax error
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
}

// --- holding and answering the script in a window ---------------------------------------------------------------

// A window as the opener sees it: it sends commands and hears events; the page answers what is evaluated.
function fakeSession({ scripts = {}, open = false, patchedByReload = true, applied = RULES.map(rule => rule.name), version = PATCH_VERSION } = {}) {
  const sent = [];
  const listeners = new Set();
  const page = { open, patch: open ? { applied, missing: [], version } : null, readyState: 'complete' };
  const session = {
    closed: false,
    sent,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async send(method, params = {}) {
      sent.push({ method, params });
      if (method === 'Fetch.getResponseBody') {
        const script = scripts[params.requestId];
        return { body: Buffer.from(script, 'utf8').toString('base64'), base64Encoded: true };
      }
      if (method === 'Page.reload') {
        // the page loads again: its scripts are asked for, and the answer decides what it has
        page.open = false;
        page.readyState = 'loading';
        setTimeout(async () => {
          for (const requestId of Object.keys(scripts)) {
            for (const fn of listeners) fn({ method: 'Fetch.requestPaused', params: { requestId, responseStatusCode: 200, responseHeaders: [{ name: 'content-length', value: '1' }, { name: 'content-type', value: 'text/javascript' }] } });
          }
          await sleep(20);
          const fulfilled = sent.filter(s => s.method === 'Fetch.fulfillRequest').at(-1);
          if (fulfilled && patchedByReload) {
            const text = Buffer.from(fulfilled.params.body, 'base64').toString('utf8');
            page.patch = JSON.parse(/__wuwaAppPatch=(\{.*?\});/.exec(text)[1]);
            page.open = page.patch.applied.includes('pet');
          }
          page.readyState = 'complete';
        }, 20);
      }
      return {};
    },
    async evaluate(expression) {
      if (expression === 'document.readyState') return page.readyState;
      return { open: page.open, patch: page.patch };
    },
  };
  return { session, listeners, page, sent };
}

const paused = (requestId, extra = {}) => ({ method: 'Fetch.requestPaused', params: { requestId, responseStatusCode: 200, responseHeaders: [], ...extra } });

test('a window that was loaded without it is loaded again once, with its scripts held, and gets the main one patched', async () => {
  const { session, page, sent } = fakeSession({ scripts: { main: SCRIPT + withText, other: 'const x=1;' } });
  const opener = new AppOpener({ session });
  const state = await opener.open();
  assert.equal(state.open, true);
  assert.deepEqual(state.patch.applied, ['pet', 'hit-region', 'pet-dragged', 'members', 'member-dragged']);
  const methods = sent.map(s => s.method);
  assert.equal(methods[0], 'Fetch.enable');
  assert.equal(methods.filter(m => m === 'Page.reload').length, 1, 'once');
  assert.ok(methods.indexOf('Fetch.enable') < methods.indexOf('Page.reload'), 'held before the page asks again');
  assert.equal(sent.filter(s => s.method === 'Fetch.fulfillRequest').length, 1, 'only the main script is answered with something else');
  assert.ok(sent.some(s => s.method === 'Fetch.continueRequest' && s.params.requestId === 'other'), 'the others go on as they were');
  const fulfilled = sent.find(s => s.method === 'Fetch.fulfillRequest');
  assert.equal(fulfilled.params.responseCode, 200);
  assert.ok(!fulfilled.params.responseHeaders.some(h => /content-length/i.test(h.name)), 'the length is the page\'s to work out');
  assert.ok(fulfilled.params.responseHeaders.some(h => h.name === 'content-type'));
  assert.equal(page.readyState, 'complete');
  await opener.open();
  assert.equal(sent.filter(s => s.method === 'Page.reload').length, 1, 'asking again does not load it again');
});

test('a window that has it already is not loaded again', async () => {
  const { session, sent } = fakeSession({ open: true, scripts: { main: SCRIPT + withText } });
  const opener = new AppOpener({ session });
  const state = await opener.open();
  assert.equal(state.open, true);
  assert.equal(sent.some(s => s.method === 'Page.reload'), false);
});

test('a page patched by an older version of the rules (the same pieces, different content) is loaded again once', async () => {
  const { session, sent } = fakeSession({ open: true, version: PATCH_VERSION - 1, scripts: { main: SCRIPT + withText } });
  const opener = new AppOpener({ session });
  const state = await opener.open();
  assert.equal(sent.filter(s => s.method === 'Page.reload').length, 1);
  assert.equal(state.patch.version, PATCH_VERSION);
});

test('a page that an older loader patched with fewer pieces is loaded again once', async () => {
  const { session, sent } = fakeSession({ open: true, applied: ['pet', 'members'], scripts: { main: SCRIPT + withText } });
  const opener = new AppOpener({ session });
  const state = await opener.open();
  assert.equal(sent.filter(s => s.method === 'Page.reload').length, 1);
  assert.equal(state.patch.applied.length, RULES.length);
});

test('a script that is not what it looked for is let through as it was, and the window is loaded again only once', async () => {
  const odd = 'const a=1; /* ' + withText + ' */';
  const { session, sent } = fakeSession({ scripts: { main: odd } });
  const opener = new AppOpener({ session });
  const state = await opener.open();
  assert.equal(state.open, false);
  assert.equal(sent.some(s => s.method === 'Fetch.fulfillRequest'), false);
  assert.ok(sent.some(s => s.method === 'Fetch.continueRequest' && s.params.requestId === 'main'));
  await opener.open();
  assert.equal(sent.filter(s => s.method === 'Page.reload').length, 1);
  assert.equal(opener.last.applied.length, 0);
  assert.deepEqual(opener.last.missing.length, 5);
});

test('whatever goes wrong while a script is held, it is never left held', async () => {
  const { session, listeners, sent } = fakeSession({ open: true });
  const opener = new AppOpener({ session });
  await opener.open();
  const failing = { ...session, send: async (method, params) => { if (method === 'Fetch.getResponseBody') throw new Error('gone'); return session.send(method, params); } };
  void failing;
  for (const fn of listeners) fn(paused('x1', { responseStatusCode: 404 }));
  await sleep(20);
  assert.ok(sent.some(s => s.method === 'Fetch.continueRequest' && s.params.requestId === 'x1'), 'an answer that is not a script goes on');
  // the body cannot be read
  session.send = async (method, params) => {
    sent.push({ method, params });
    if (method === 'Fetch.getResponseBody') throw new Error('gone');
    return {};
  };
  for (const fn of listeners) fn(paused('x2'));
  await sleep(20);
  assert.ok(sent.some(s => s.method === 'Fetch.continueRequest' && s.params.requestId === 'x2'), 'one whose body cannot be read goes on');
});

test('letting go stops holding the scripts', async () => {
  const { session, listeners, sent } = fakeSession({ open: true });
  const opener = new AppOpener({ session });
  await opener.open();
  assert.equal(listeners.size, 1);
  await opener.close();
  assert.equal(listeners.size, 0);
  assert.equal(sent.at(-1).method, 'Fetch.disable');
  await opener.close();
  assert.equal(sent.filter(s => s.method === 'Fetch.disable').length, 1);
});
