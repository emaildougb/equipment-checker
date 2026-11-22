/*! NCEMS sign-in (drop-in) v1.1.0
// v1.1.1: a wrong PIN always shows how many tries are left (it used to show only in the last two tries).
 * Microsoft once per app per device, then one 4-digit PIN for every NCEMS app. The same PIN screen as Open Shifts.
 *
 * WHAT IT DOES
 *   1. First time on a phone or computer: sends the person to Microsoft (authorization code + PKCE, no client
 *      secret, no Microsoft library), makes a device key that can't be copied off the device (non-extractable
 *      ECDSA P-256, kept in IndexedDB), and enrolls the PUBLIC half with the shared sign-in (ncems-id).
 *   2. Every day: the PIN pad. The device signs a one-time challenge, the PIN goes with it, and ncems-id answers
 *      with a 1-hour token made for THIS app only. Your app sends it as "Authorization: Bearer <token>" and your
 *      Worker checks it (ncems-id-verify.js).
 *
 * WHAT IT NEVER DOES
 *   The PIN is never stored, never put in an input box (nothing for a browser to remember), and never sent to
 *   your app. The Microsoft token is used once and dropped. The 1-hour token lives in memory only: a reload asks
 *   for the PIN again. This file holds no secrets.
 *
 * USE
 *   <script src="signin/ncems-signin.js"></script>
 *   NCEMSSignIn.init({ app: 'hub', clientId: '<Entra client id>', appName: 'NCEMS Hub',
 *                      onSignedIn: session => startApp(session) });
 *   const token = await NCEMSSignIn.getToken();     // asks for the PIN again if the hour is up
 *   See README.md for every option.
 *
 * v1.1.0 — SHARED DEVICES (init option shared: true, for apps Derek has marked shared in ncems-id). An agency phone or
 *   tablet is set up once by someone on the app's setup list (Microsoft, then signed out of Microsoft again). After
 *   that each person taps their name and enters their NCEMS PIN. Nothing about the person is kept on the device; the
 *   session ends after 5 idle minutes, when your app calls lock(), or after 30 minutes. On a shared device the PIN
 *   alone is enough, so the token says shared: true and your Worker must opt in to accept it (allowShared).
 */
(function () {
  'use strict';
  if (window.NCEMSSignIn) return;
  const VERSION = '1.1.0';
  const TENANT = '153dc089-095e-4a20-8d10-39321a0aca09';            // NCEMS — not a secret
  const AUTHORITY = 'https://login.microsoftonline.com/' + TENANT + '/oauth2/v2.0/';
  const DEFAULT_ID = 'https://ncems-id.d-langdon.workers.dev';
  const PENDING_KEY = 'ncems_signin_pending';
  const BASE = (() => { try { const s = document.currentScript && document.currentScript.src; return s ? s.slice(0, s.lastIndexOf('/') + 1) : ''; } catch (e) { return ''; } })();

  let cfg = null, dev = null, sess = null, flow = null, host = null, root = null, lockT = null;
  let waiters = [], pinWaiter = null, firstPin = '', curPin = '', lastSession = null;
  let who = null, people = null, peopleAt = 0, lastAct = Date.now();   // shared devices: who is at the pad (memory only)
  const AFTER_KEY = 'ncems_signin_after';

  // ---------------- small helpers ----------------
  const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const rnd = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
  const $ = sel => root.querySelector(sel);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const initials = n => String(n || '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  const first = n => String(n || '').trim().split(/\s+/)[0] || '';
  const isPhone = () => /iPhone|Android.*Mobile|Mobile/i.test(navigator.userAgent || '');
  const kind = () => { const u = navigator.userAgent || ''; if (/iPad|Tablet/i.test(u) || (/Android/i.test(u) && !/Mobile/i.test(u))) return 'tablet'; return isPhone() ? 'phone' : 'computer'; };
  function label() { const u = navigator.userAgent || '';
    const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? (/Mobile/.test(u) ? 'Android phone' : 'Android tablet') : /CrOS/.test(u) ? 'Chromebook' : /Windows/.test(u) ? 'Windows PC' : /Mac OS X/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux PC' : 'Device';
    const br = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
    return (os + (br ? ' · ' + br : '')).slice(0, 40); }
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  // a short buzz: Android vibrates; iPhones get the switch tick (iOS 17.4+)
  let hapSw = null;
  function haptic(k) {
    if (cfg && cfg.haptics === false) return;
    try { if (typeof navigator.vibrate === 'function') { navigator.vibrate(k === 'strong' ? [14, 60, 14] : k === 'confirm' ? 16 : 8); return; } } catch (e) {}
    try { if (!hapSw) { const l = document.createElement('label'); l.setAttribute('aria-hidden', 'true'); l.style.cssText = 'position:fixed;left:-200px;top:0;width:1px;height:1px;overflow:hidden;opacity:0';
        const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); i.tabIndex = -1; l.appendChild(i); document.body.appendChild(l); hapSw = l; }
      hapSw.click(); } catch (e) {}
  }

  // ---------------- this device's record (IndexedDB can hold a CryptoKey; localStorage can't) ----------------
  function idbOpen() { return new Promise((res, rej) => { const r = indexedDB.open('ncems-signin', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbDo(mode, fn) { const db = await idbOpen(); return new Promise((res, rej) => { const tx = db.transaction('kv', mode); const q = fn(tx.objectStore('kv')); tx.oncomplete = () => { db.close(); res(q && q.result); }; tx.onerror = tx.onabort = () => { db.close(); rej(tx.error); }; }); }
  const devKey = () => 'device:' + cfg.app;
  async function devLoad() { try { const d = await idbDo('readonly', s => s.get(devKey())); dev = (d && d.deviceId && d.keys && d.keys.privateKey) ? d : null; } catch (e) { dev = null; } return dev; }
  async function devSave() { if (dev) await idbDo('readwrite', s => s.put(dev, devKey())); }
  async function devForget() { dev = null; try { await idbDo('readwrite', s => s.delete(devKey())); } catch (e) {} }

  // ---------------- the shared sign-in (ncems-id) ----------------
  async function idPost(path, body) {
    try { const r = await fetch(cfg.idUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return { s: r.status, j: await r.json().catch(() => ({})) }; }
    catch (e) { return { s: 0, j: { error: 'Could not reach the server.' } }; }
  }
  // every device call: fetch a one-time challenge, sign it with this device's key, send both
  async function devCall(path, body) {
    if (!dev) return { s: 404, j: { state: 'gone' } };
    const c = await idPost('/challenge', { deviceId: dev.deviceId });
    if (c.s !== 200 || !c.j.challenge) return c;
    let sig; try { sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, dev.keys.privateKey, new TextEncoder().encode(c.j.challenge)); }
    catch (e) { return { s: 401, j: { error: 'device key unusable', state: 'gone' } }; }
    return idPost(path, Object.assign({ deviceId: dev.deviceId, challenge: c.j.challenge, sig: b64u(sig) }, body || {}));
  }

  // ---------------- Microsoft: out, and back ----------------
  async function msStart(mode) {
    showHero('busy');
    const n = await idPost('/nonce', { app: cfg.app });
    if (n.s !== 200 || !n.j.nonce) { showHero(dev ? 'checkin' : 'start', n.s === 403 ? 'This app is not set up for the NCEMS sign-in yet.' : 'Could not reach the server. Try again.'); return; }
    const verifier = rnd(32), state = rnd(16);
    const challenge = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ app: cfg.app, state, verifier, nonce: n.j.nonce, mode: mode || 'enroll', at: Date.now(), back: location.pathname + location.search })); }
    catch (e) { showHero('start', 'This browser is blocking storage, so sign-in can\'t work here.'); return; }
    const q = new URLSearchParams({ client_id: cfg.clientId, response_type: 'code', redirect_uri: cfg.redirectUri, response_mode: 'fragment',
      scope: 'openid profile', state, nonce: n.j.nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: mode === 'shared' ? 'login' : 'select_account' });   // a shared device never reuses a Microsoft session already on it
    location.assign(AUTHORITY + 'authorize?' + q.toString());
  }
  // true if this page load was OUR sign-in coming back (another script's #code= is left alone)
  async function msReturn() {
    const h = location.hash || '';
    if (!/[#&](code|error)=/.test(h)) return false;
    let p = null; try { p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch (e) {}
    const f = new URLSearchParams(h.slice(1));
    if (!p || p.app !== cfg.app || !p.state || f.get('state') !== p.state) return false;
    try { sessionStorage.removeItem(PENDING_KEY); } catch (e) {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}   // the one-time code leaves the address bar at once
    await devLoad();
    if (Date.now() - p.at > 15 * 60000) { showHero('start', 'That sign-in didn\'t finish. Try again.'); return true; }
    if (f.get('error')) { showHero('start', f.get('error') === 'access_denied' ? 'Sign-in cancelled.' : 'Microsoft sign-in failed. Try again.'); return true; }
    showHero('busy');
    let idToken = '';
    try { const r = await fetch(AUTHORITY + 'token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: cfg.clientId, grant_type: 'authorization_code', code: f.get('code') || '', redirect_uri: cfg.redirectUri, code_verifier: p.verifier, scope: 'openid profile' }).toString() });
      const j = await r.json().catch(() => ({})); idToken = j.id_token || ''; } catch (e) {}
    if (!idToken) { showHero('start', 'Microsoft sign-in failed. Try again.'); return true; }
    let keys, pub;   // a fresh device key for every enrollment; only the public half is sent
    try { keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']); pub = await crypto.subtle.exportKey('jwk', keys.publicKey); }
    catch (e) { showHero('start', 'This browser can\'t create a secure device key.'); return true; }
    const r = await idPost('/enroll', { app: cfg.app, idToken, pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }, label: label(), reset: p.mode === 'reset', prev: dev && dev.deviceId, shared: p.mode === 'shared' });
    idToken = '';
    if (p.mode === 'shared') {
      // Whoever just signed in with Microsoft on this shared device is signed out of Microsoft again, whatever happened:
      // otherwise the next person to pick it up could open that person's mail in the same browser.
      const okSet = r.s === 200 && r.j.deviceId && r.j.state === 'shared';
      if (okSet) { dev = { deviceId: r.j.deviceId, keys, shared: true, state: 'shared', name: '', email: '' };
        try { await devSave(); } catch (e) { dev = null; } }
      try { sessionStorage.setItem(AFTER_KEY, JSON.stringify({ app: cfg.app, msg: okSet && dev ? '' : (r.j.error || 'Could not set up this device. Try again.') })); } catch (e) {}
      location.assign(AUTHORITY + 'logout?post_logout_redirect_uri=' + encodeURIComponent(cfg.redirectUri));
      return true;
    }
    if (r.s !== 200 || !r.j.deviceId) { showHero('start', r.j.error || 'Sign-in failed. Try again.'); return true; }
    dev = { deviceId: r.j.deviceId, keys, name: r.j.name || '', email: r.j.email || '', state: r.j.state, fresh: r.j.state === 'active' };
    try { await devSave(); } catch (e) { dev = null; showHero('start', 'This browser won\'t keep a sign-in (private browsing?).'); return true; }
    // the sign-in came back to the registered address; if the person started somewhere else in the app, go back there
    if (p.back && p.back !== location.pathname + location.search && /^\/[^/\\]/.test(p.back + ' ')) { location.replace(p.back); return true; }
    route(r.j.state);
    return true;
  }
  function route(state, msg) {
    if (state === 'shared') showPicker(msg);
    else if (state === 'setpin') pinFlow('setpin', msg);
    else if (state === 'active') pinFlow('unlock', msg);
    else if (state === 'expired') showHero('checkin', msg);
    else if (state === 'locked') showHero('locked', msg);
    else showHero('start', msg);
  }
  // which screen should this device be on? (never spends a PIN try)
  async function devStatus() {
    const r = await devCall('/unlock', { status: true });
    if (r.s === 200 && r.j.state) { dev.state = r.j.state; if (r.j.name) dev.name = r.j.name; if (r.j.email) dev.email = r.j.email; try { await devSave(); } catch (e) {} route(r.j.state); return; }
    if (r.s === 0) { route(dev.state, 'Could not reach the server.'); return; }
    const st = r.j.state, wasShared = dev.shared; await devForget();
    if (wasShared) showHero('start', 'This shared device needs to be set up again.');
    else if (st === 'expired') showHero('checkin'); else showHero('start');
  }

  // ---------------- the look: Open Shifts 9.0 (Geist, pale-green LCD by day, black panel at night) ----------------
  const CSS = `
:host{all:initial;position:fixed;inset:0;z-index:2147483000;display:none;
  --ground:#f2f5f2;--surface:#fff;--raised:#eef1ee;--border:#e1e5e1;--text:#0a0a0a;--muted:#5f635f;--text2:#3a3e3a;
  --hue:#2d6a2d;--tint:#e4eee3;--pri:#141414;--on-pri:#fff;--negative:#b3261e;--neg-bg:#fbeeed;--amber:#7a5600;--amber-bg:#fdf1cf;
  --led-bg:#e4eee3;--led-line:#c9dcc6;--led-lb:#3c5a3c;--scrim:rgba(10,12,10,.16);
  --font:"NCEMS Geist","Geist",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
:host([data-open]){display:block}
:host([data-theme=dark]){--ground:#0e100e;--surface:#161916;--raised:#1d211d;--border:#2a2f2a;--text:#eef1ee;--muted:#a0a6a0;--text2:#c0c6c0;
  --hue:#3a8a3c;--tint:#1b2a1b;--pri:#eef1ee;--on-pri:#0e100e;--negative:#ff7b72;--neg-bg:#2e1a19;--amber:#f2c55a;--amber-bg:#3a2f10;
  --led-bg:#0b0c0b;--led-line:#0b0c0b;--led-lb:#5aa85a;--scrim:rgba(0,0,0,.5)}
*{box-sizing:border-box}
.scr{position:absolute;inset:0;overflow-y:auto;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:64px 20px 32px;
  background:var(--ground);color:var(--text);font-family:var(--font);font-size:17px;line-height:24px;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
button{font-family:inherit;-webkit-tap-highlight-color:transparent}
.hero{display:flex;flex-direction:column;align-items:center;text-align:center;width:100%;max-width:360px}
.logo{width:72px;height:72px;border-radius:50%;background:#fff;padding:3px;margin-bottom:18px;object-fit:contain}
.ico{width:68px;height:68px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-bottom:12px}
.ico svg{width:34px;height:34px}
.ico.ok{background:var(--tint);color:var(--hue)}.ico.bad{background:var(--neg-bg);color:var(--negative)}.ico.wait{background:var(--amber-bg);color:var(--amber)}
h1{margin:0;font-size:26px;line-height:32px;font-weight:700;letter-spacing:-.01em;color:var(--text)}
.p{color:var(--muted);margin:8px 0 24px;font-size:16px;line-height:23px;white-space:pre-line}
.err{font-size:14px;color:var(--negative);line-height:1.4;margin-bottom:16px}
.btn{width:100%;height:44px;border-radius:999px;border:0;background:var(--pri);color:var(--on-pri);font-weight:500;font-size:17px;line-height:1;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;flex-shrink:0;transition:background .15s,transform .08s}
.btn svg{width:18px;height:18px}
.hero .ms-btn{margin-top:10px}
.btn:active:not(:disabled){transform:scale(.97)}
.btn:disabled{opacity:.45}
.btn.busy,.btn.done{background:var(--hue);color:#fff;cursor:default}
.btn.sec{background:none;color:var(--text);border:1px solid var(--border);margin-top:10px}
.spin{width:18px;height:18px;border-radius:50%;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;display:inline-block;animation:sp .8s linear infinite}
.bigspin{width:34px;height:34px;border-radius:50%;border:3px solid var(--tint);border-top-color:var(--hue);animation:sp 1s linear infinite;margin:6px 0 14px}
@keyframes sp{to{transform:rotate(360deg)}}
.who{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:11px;text-align:left;margin:16px 0}
.who .av{width:40px;height:40px;font-size:14px;border-radius:50%;background:var(--tint);color:var(--hue);display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0}
.who .nm{font-size:15.5px;font-weight:600;color:var(--text)}.who .em{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis}
.links{display:flex;justify-content:center;gap:18px;width:100%;margin-top:18px}
.links:empty{display:none}
.lnk{background:none;border:0;color:var(--muted);font-size:15px;cursor:pointer;padding:9px;margin-top:4px;text-decoration:underline;text-underline-offset:3px}
.lnk:hover{color:var(--text)}
.find{width:100%;height:44px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);padding:0 14px;font-family:inherit;font-size:17px;margin:0 0 12px;-webkit-appearance:none;appearance:none}
.find:focus{outline:2px solid var(--text);outline-offset:-1px;border-color:transparent}
.find::placeholder{color:var(--muted)}
.ppl{width:100%;display:flex;flex-direction:column;gap:8px}
.per{width:100%;min-height:60px;border-radius:14px;border:1px solid var(--border);background:var(--surface);color:var(--text);display:flex;align-items:center;gap:12px;padding:8px 14px;text-align:left;font-size:18px;font-weight:500;cursor:pointer}
.per:active{background:var(--raised)}
.per .av{width:40px;height:40px;font-size:14px;border-radius:50%;background:var(--tint);color:var(--hue);display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0}
.none{color:var(--muted);font-size:16px;padding:14px 0}
.hint{color:var(--muted);font-size:15px;line-height:21px;margin-top:6px}
.pin{display:flex;flex-direction:column;align-items:center;gap:14px;width:100%;max-width:360px;padding-top:43px}
.name{font-size:20px;font-weight:700;color:var(--text);letter-spacing:-.01em;text-align:center}
.name img{width:46px;height:46px;display:block;margin:0 auto 8px;border-radius:50%;background:#fff}
.sub{font-size:14px;font-weight:400;color:var(--muted);margin-top:4px}
.panel{background:var(--led-bg);border:1.5px solid var(--led-line);border-radius:14px;padding:16px 0 18px;width:100%;display:flex;flex-direction:column;align-items:center;gap:8px}
.lbl{color:var(--led-lb);font-size:12px;letter-spacing:.24em;font-weight:500;text-transform:uppercase}
.row{display:flex;gap:12px;align-items:center}
.dg{width:36px;height:60px;flex-shrink:0}
.dg svg{width:36px;height:60px;transform-origin:50% 50%;display:block}
.dg path{transition:fill .08s,filter .08s}
.dg.fold svg{animation:fold .22s ease-in-out}
@keyframes fold{0%{transform:scaleY(1)}50%{transform:scaleY(.12)}100%{transform:scaleY(1)}}
.perr{font-size:15px;color:var(--negative);height:18px;text-align:center}
.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:100%}
.key{height:68px;border-radius:14px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:28px;font-weight:400;cursor:pointer;display:flex;align-items:center;justify-content:center;width:100%;transition:transform .08s}
.key svg{width:22px;height:22px}
.key:active:not(:disabled),.key.dn{background:var(--raised);transform:scale(.91)}
.key:disabled{background:transparent;border-color:transparent;cursor:default}
@media(prefers-reduced-motion:reduce){.dg.fold svg,.spin,.bigspin{animation:none}}
`;
  const SVG = {
    ms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M12 5v14M4 12h16"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-6-6 6-6z"/><path d="m12 10 4 4m0-4-4 4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    wait: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 7h11M6.5 17h11M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM6 4v2a6 6 0 1 0 12 0V4a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16m-10 5 1.5 1.5L15 14"/></svg>'
  };
  const SEG_PATHS = ['M8 2 L20 2 L22.5 4.5 L20 7 L8 7 L5.5 4.5 Z', 'M21 8 L23.5 5.5 L26 8 L26 20.5 L23.5 23 L21 20.5 Z', 'M21 27.5 L23.5 25 L26 27.5 L26 40 L23.5 42.5 L21 40 Z', 'M8 41 L20 41 L22.5 43.5 L20 46 L8 46 L5.5 43.5 Z', 'M2 27.5 L4.5 25 L7 27.5 L7 40 L4.5 42.5 L2 40 Z', 'M2 8 L4.5 5.5 L7 8 L7 20.5 L4.5 23 L2 20.5 Z', 'M8 21.5 L20 21.5 L22.5 24 L20 26.5 L8 26.5 L5.5 24 Z'];
  const SEG = { 0: [1, 1, 1, 1, 1, 1, 0], 1: [0, 1, 1, 0, 0, 0, 0], 2: [1, 1, 0, 1, 1, 0, 1], 3: [1, 1, 1, 1, 0, 0, 1], 4: [0, 1, 1, 0, 0, 1, 1], 5: [1, 0, 1, 1, 0, 1, 1], 6: [1, 0, 1, 1, 1, 1, 1], 7: [1, 1, 1, 0, 0, 0, 0], 8: [1, 1, 1, 1, 1, 1, 1], 9: [1, 1, 1, 1, 0, 1, 1],
    _: [0, 0, 0, 0, 0, 0, 0], A: [1, 1, 1, 0, 1, 1, 1], C: [1, 0, 0, 1, 1, 1, 0], E: [1, 0, 0, 1, 1, 1, 1], S: [1, 0, 1, 1, 0, 1, 1], '*': [0, 0, 0, 0, 0, 0, 1], L: [0, 0, 0, 1, 1, 1, 0], Y: [0, 1, 1, 1, 0, 1, 1], r: [0, 0, 0, 0, 1, 0, 1], U: [0, 1, 1, 1, 1, 1, 0], G: [1, 0, 1, 1, 1, 1, 0], H: [0, 1, 1, 0, 1, 1, 1] };
  const GREEN = '#39ff14', GLOW = '#20cc00', RED = '#e05a50', RGLOW = '#a02020';
  const DAY = { '#39ff14': '#141414', '#1d8a0c': '#6f8a6d', '#173f10': '#b7cbb4' };   // day: black digits on the pale-green LCD

  function dark() { const t = cfg.theme || 'auto'; return t === 'dark' || (t === 'auto' && !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)); }
  function applyTheme() { if (!host) return; if (dark()) host.setAttribute('data-theme', 'dark'); else host.removeAttribute('data-theme'); if (flow) updateDisplay(); }
  function mount() {
    if (host) return;
    host = document.createElement('div'); host.setAttribute('role', 'dialog'); host.setAttribute('aria-modal', 'true'); host.setAttribute('aria-label', 'NCEMS sign-in');
    root = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st);
    root.appendChild(el('div', 'scr'));
    (document.body || document.documentElement).appendChild(host);
    applyTheme();
    try { const mq = matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener('change', applyTheme) : mq.addListener(applyTheme)); } catch (e) {}
    // Geist, from the files next to this script (falls back to the system font if they aren't there)
    if (cfg.fonts !== false && window.FontFace && document.fonts) [400, 500, 700].forEach(w => { try {
      new FontFace('NCEMS Geist', 'url(' + JSON.stringify((cfg.fonts || BASE + 'fonts/') + 'geist-sans-latin-' + w + '-normal.woff2') + ') format("woff2")', { weight: String(w), display: 'swap' }).load().then(f => document.fonts.add(f)).catch(() => {}); } catch (e) {} });
  }
  function open() { mount(); host.setAttribute('data-open', ''); }
  function close() { flow = null; pinReset(); if (host) host.removeAttribute('data-open'); }
  function screen() { const s = $('.scr'); s.textContent = ''; s.scrollTop = 0; return s; }
  function msBtn() { const b = el('button', 'btn ms-btn'); b.type = 'button'; b.innerHTML = SVG.ms; b.appendChild(el('span', '', 'Sign in with Microsoft')); b.onclick = () => msStart('enroll'); return b; }
  function icon(k, cls) { const d = el('div', 'ico ' + cls); d.innerHTML = SVG[k]; return d; }

  // ---------------- the screens that aren't the PIN pad ----------------
  function showHero(kindOf, msg, extra) {
    open(); flow = null; pinReset();
    const s = screen(), h = el('div', 'hero'); s.appendChild(h);
    const days = cfg.days || 90;
    const logo = () => { if (cfg.logo === false) return; const i = el('img', 'logo'); i.alt = ''; i.src = cfg.logo || BASE + 'logo-ncems.png'; i.onerror = () => i.remove(); h.appendChild(i); };
    const err = () => { if (msg) h.appendChild(el('div', 'err', msg)); };
    if (kindOf === 'busy') { h.style.marginTop = '60px'; h.appendChild(el('div', 'bigspin')); h.appendChild(el('div', 'p', 'Signing in…')); }
    else if (kindOf === 'checkin') { h.appendChild(icon('cal', 'ok')); h.appendChild(el('h1', '', days + '-day check-in')); h.appendChild(el('div', 'p', 'Sign in with Microsoft to keep using your PIN.')); err(); h.appendChild(msBtn()); }
    else if (kindOf === 'locked') { h.appendChild(icon('lock', 'bad')); h.appendChild(el('h1', '', 'Too many wrong PINs')); h.appendChild(el('div', 'p', 'Sign in with Microsoft to continue.')); err(); h.appendChild(msBtn()); }
    else if (kindOf === 'signout') {
      h.appendChild(el('h1', '', 'Sign out of this ' + kind() + '?')); h.appendChild(el('div', 'p', 'Your PIN will stop working here.'));
      const b = el('button', 'btn', 'Sign out'); b.type = 'button'; b.onclick = () => doSignOut(); h.appendChild(b);
      const c = el('button', 'btn sec', 'Cancel'); c.type = 'button'; c.onclick = () => { if (extra && extra.back === 'app' && live()) close(); else route(dev ? dev.state : ''); }; h.appendChild(c);
    }
    else if (kindOf === 'pending') {   // the app says: signed in, but not allowed in yet
      const o = extra || {};
      h.appendChild(icon('wait', 'wait')); h.appendChild(el('h1', '', o.title || 'Almost there'));
      const w = el('div', 'who'); w.appendChild(el('div', 'av', initials(dev && dev.name)));
      const t = el('div'); t.style.minWidth = '0'; t.appendChild(el('div', 'nm', (dev && dev.name) || '')); t.appendChild(el('div', 'em', (dev && dev.email) || '')); w.appendChild(t); h.appendChild(w);
      h.appendChild(el('div', 'p', o.text || 'An officer needs to approve you.')); err();
      const b = el('button', 'btn', 'Check again'); b.type = 'button'; b.onclick = () => { showHero('busy'); enter(lastSession); }; h.appendChild(b);
      const l = el('div', 'links'); const so = el('button', 'lnk', 'Sign out'); so.type = 'button'; so.onclick = () => showHero('signout'); l.appendChild(so); h.appendChild(l);
    }
    else if (kindOf === 'sharedask') {
      h.appendChild(el('h1', '', 'Set up a shared ' + kind() + '?'));
      h.appendChild(el('div', 'p', 'For a ' + kind() + ' several people use.\n' + (cfg.sharedSetupBy || 'Someone allowed to set these up') + ' signs in with Microsoft once. After that, each person taps their name and enters their NCEMS PIN.'));
      const b = el('button', 'btn ms-btn'); b.type = 'button'; b.innerHTML = SVG.ms; b.appendChild(el('span', '', 'Sign in with Microsoft')); b.onclick = () => msStart('shared'); h.appendChild(b);
      const c = el('button', 'btn sec', 'Cancel'); c.type = 'button'; c.onclick = () => showHero('start'); h.appendChild(c);
    }
    else if (kindOf === 'sharedoff') {
      h.appendChild(el('h1', '', 'Remove the shared sign-in?')); h.appendChild(el('div', 'p', 'Nobody will be able to use this ' + kind() + ' until it is set up again with Microsoft.'));
      const b = el('button', 'btn', 'Remove'); b.type = 'button'; b.onclick = () => doSignOut(); h.appendChild(b);
      const c = el('button', 'btn sec', 'Cancel'); c.type = 'button'; c.onclick = () => showPicker(); h.appendChild(c);
    }
    else { logo(); h.appendChild(el('h1', '', cfg.appName || 'NCEMS')); h.appendChild(el('div', 'p', 'Sign in once with Microsoft.\nThen just your PIN for ' + days + ' days.')); err(); h.appendChild(msBtn());
      if (cfg.shared === true) { const l = el('div', 'links'); const sb = el('button', 'lnk', 'Set up as a shared ' + kind()); sb.type = 'button'; sb.onclick = () => showHero('sharedask'); l.appendChild(sb); h.appendChild(l); } }
  }

  // ---------------- a shared device: tap your name, then your PIN ----------------
  async function showPicker(msg) {
    open(); flow = null; pinReset(); who = null;
    const s = screen(), h = el('div', 'hero'); s.appendChild(h);
    if (cfg.logo !== false) { const i = el('img', 'logo'); i.alt = ''; i.src = cfg.logo || BASE + 'logo-ncems.png'; i.onerror = () => i.remove(); h.appendChild(i); }
    h.appendChild(el('h1', '', cfg.appName || 'NCEMS')); h.appendChild(el('div', 'p', 'Tap your name, then enter your NCEMS PIN.'));
    if (msg) h.appendChild(el('div', 'err', msg));
    const find = el('input', 'find'); find.type = 'search'; find.placeholder = 'Search names'; find.autocomplete = 'off'; find.setAttribute('autocorrect', 'off'); find.spellcheck = false; find.setAttribute('aria-label', 'Search names'); h.appendChild(find);
    const list = el('div', 'ppl'); h.appendChild(list);
    const foot = el('div', 'links'); h.appendChild(foot);
    const hint = el('div', 'hint'); hint.hidden = true; hint.textContent = cfg.sharedHelp || 'Not on the list? You need an NCEMS PIN first: sign in to an NCEMS app (like Open Shifts) on your own phone once.'; h.appendChild(hint);
    const nl = el('button', 'lnk', 'Not on the list?'); nl.type = 'button'; nl.onclick = () => { hint.hidden = !hint.hidden; }; foot.appendChild(nl);
    const rm = el('button', 'lnk', 'Remove shared sign-in'); rm.type = 'button'; rm.onclick = () => showHero('sharedoff'); foot.appendChild(rm);
    const draw = () => { const q = find.value.trim().toLowerCase(); list.textContent = '';
      const rows = (people || []).filter(x => !q || x.name.toLowerCase().includes(q));
      if (!rows.length) { list.appendChild(el('div', 'none', people ? (q ? 'No name matches.' : 'Nobody has an NCEMS PIN yet.') : 'Loading…')); return; }
      rows.forEach(x => { const b = el('button', 'per'); b.type = 'button'; b.appendChild(el('span', 'av', initials(x.name))); b.appendChild(el('span', '', x.name)); b.onclick = () => { who = { id: x.id, name: x.name }; pinFlow('sunlock'); }; list.appendChild(b); }); };
    find.oninput = draw; draw();
    if (!people || Date.now() - peopleAt > 5 * 60000) {
      const r = await devCall('/people', {});
      if (flow || who) return;   // they moved on while it loaded
      if (r.s === 200 && Array.isArray(r.j.people)) { people = r.j.people.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string'); peopleAt = Date.now(); draw(); }
      else if (r.s === 0) { list.textContent = ''; list.appendChild(el('div', 'none', 'Could not reach the server.')); const b = el('button', 'btn sec', 'Try again'); b.type = 'button'; b.onclick = () => showPicker(); list.appendChild(b); }
      else { people = null; await devForget(); showHero('start', 'This shared device needs to be set up again.'); }
    }
  }

  // ---------------- the PIN pad: digits fold into dashes, a light sweeps while it checks, ACCESS when you're in ----------------
  const SHOW_MS = 500, LAST_MS = 320;
  let entered = [], shownAt = [], foldT = [], busy = false, scanT = null, autoT = null, attempts = 0;
  function setDigit(i, v, color, glow) {
    color = color || GREEN; glow = glow || GLOW;
    const pat = SEG[v] || SEG._, dk = dark(), on = dk ? color : (DAY[color] || color), off = dk ? '#132413' : '#d3e3d1';
    const ps = root.querySelectorAll('.dg')[i]; if (!ps) return;
    ps.querySelectorAll('path').forEach((s, k) => { if (pat[k] === 1) { s.style.fill = on; s.style.filter = dk ? 'drop-shadow(0 0 3px ' + color + ') drop-shadow(0 0 7px ' + glow + ')' : 'none'; } else { s.style.fill = off; s.style.filter = 'none'; } });
  }
  function updateDisplay() { if (scanT || !flow) return; for (let i = 0; i < 6; i++) { let v = '_'; const k = i - 1; if (i >= 1 && i <= 4 && k < entered.length) v = shownAt[k] && Date.now() - shownAt[k] < SHOW_MS ? entered[k] : '*'; setDigit(i, v); } }
  function message(chars, color, glow) { for (let i = 0; i < 6; i++) setDigit(i, chars[i] || '_', color, glow); }
  function fold(k) {
    clearTimeout(foldT[k]); if (!shownAt[k]) return; shownAt[k] = 0;
    const w = root.querySelectorAll('.dg')[k + 1];
    if (!w || reduced()) { updateDisplay(); return; }
    w.classList.remove('fold'); void w.offsetWidth; w.classList.add('fold');
    setTimeout(updateDisplay, 110); setTimeout(() => w.classList.remove('fold'), 240);
  }
  function push(d) {
    if (busy || !flow || entered.length >= 4) return false;
    for (let k = 0; k < entered.length; k++) fold(k);
    const k = entered.length; entered.push(d); shownAt[k] = Date.now(); updateDisplay();
    foldT[k] = setTimeout(() => { if (entered.length > k) fold(k); }, SHOW_MS);
    clearTimeout(autoT);
    if (entered.length === 4) autoT = setTimeout(() => { if (entered.length === 4 && !busy) confirmPin(); }, LAST_MS);
    return true;
  }
  function pop() { if (busy || !entered.length) return false; clearTimeout(autoT); const k = entered.length - 1; clearTimeout(foldT[k]); shownAt[k] = 0; entered.pop(); updateDisplay(); return true; }
  function scan(on) {
    clearInterval(scanT); scanT = null; if (!on) return;
    let p = 0, dir = 1;
    const draw = () => { for (let i = 0; i < 6; i++) { const d = Math.abs(i - p); setDigit(i, '*', d === 0 ? GREEN : d === 1 ? '#1d8a0c' : '#173f10', d === 0 ? GLOW : '#0a2a05'); } if (p + dir > 5 || p + dir < 0) dir = -dir; p += dir; };
    scanT = setInterval(draw, 80); draw();
  }
  function goBtn(state) {
    const b = root && $('.go'); if (!b) return;
    if (state === 'busy') { if (!b.dataset.lbl) b.dataset.lbl = b.textContent; b.classList.remove('done'); b.classList.add('busy'); b.disabled = true; b.textContent = ''; b.appendChild(el('span', 'spin')); b.appendChild(el('span', '', 'Checking…')); }
    else if (state === 'ok') { b.classList.remove('busy'); b.classList.add('done'); b.disabled = true; b.innerHTML = SVG.check; b.appendChild(el('span', '', 'Welcome back')); }
    else { b.classList.remove('busy', 'done'); b.disabled = false; if (b.dataset.lbl) { b.textContent = b.dataset.lbl; delete b.dataset.lbl; } }
  }
  function pinReset() { clearTimeout(autoT); foldT.forEach(t => clearTimeout(t)); foldT = []; shownAt = []; entered = []; scan(false); busy = false; if (root) goBtn(''); }
  function welcome() { scan(false); goBtn('ok'); haptic('confirm'); message(['_', '_', '_', '_', '_', '_']); 'ACCESS'.split('').forEach((c, i) => setTimeout(() => setDigit(i, c), i * 50)); return new Promise(r => setTimeout(r, 360)); }
  function perr(t) { const e = root && $('.perr'); if (e) e.textContent = t || ''; }
  function flashError() {
    scan(false); attempts++; haptic('strong');
    const c = (attempts - 1) % 3;
    if (c === 0) { message(['*', '*', '*', '*', '*', '*'], RED, RGLOW); perr('Incorrect PIN'); }
    else if (c === 1) { message(['r', 'E', 'A', 'L', 'L', 'Y'], RED, RGLOW); perr('Really?'); }
    else { message(['_', 'U', 'G', 'H', '_', '_'], RED, RGLOW); perr('Ugh...'); }
    setTimeout(updateDisplay, 1000);
  }
  function shake() { const r = root && $('.row'); if (!r) return; r.style.transition = 'none'; r.style.transform = 'translateX(8px)'; setTimeout(() => { r.style.transition = 'transform .1s'; r.style.transform = 'translateX(-8px)'; setTimeout(() => { r.style.transform = 'translateX(0)'; }, 100); }, 50); }

  function tap(b) { b.classList.add('dn'); clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('dn'), 130); }
  function pinFlow(f, msg) {
    open(); pinReset(); flow = f; attempts = 0;
    const nm = (dev && dev.name) || '';
    const T = { setpin: ['Choose a PIN', nm, 'Choose a 4-digit PIN.', 'Next'], setpin2: ['Again', nm, 'Enter it once more.', 'Done'],
      unlock: ['Enter PIN', dev && dev.fresh ? 'Welcome, ' + first(nm) : nm, dev && dev.fresh ? 'Enter your NCEMS PIN. It\'s the same in every NCEMS app.' : '', 'Confirm'],
      sunlock: ['Enter PIN', (who && who.name) || '', '', 'Confirm'],
      cur: ['Current PIN', nm, 'Enter your current PIN.', 'Next'], 'new': ['New PIN', nm, 'Choose a new 4-digit PIN.', 'Next'], new2: ['Again', nm, 'Enter it once more.', 'Done'] }[f];
    const s = screen(), p = el('div', 'pin'); s.appendChild(p);
    const name = el('div', 'name'); if (cfg.logo !== false) { const i = el('img'); i.alt = ''; i.src = cfg.logo || BASE + 'logo-ncems.png'; i.onerror = () => i.remove(); name.appendChild(i); }
    name.appendChild(document.createTextNode(T[1] || '')); if (T[2]) name.appendChild(el('div', 'sub', T[2])); p.appendChild(name);
    const panel = el('div', 'panel'); panel.appendChild(el('div', 'lbl', T[0]));
    const row = el('div', 'row'); const ns = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < 6; i++) { const w = el('div', 'dg'); const sv = document.createElementNS(ns, 'svg'); sv.setAttribute('viewBox', '0 0 28 48'); SEG_PATHS.forEach(d => { const pa = document.createElementNS(ns, 'path'); pa.setAttribute('d', d); sv.appendChild(pa); }); w.appendChild(sv); row.appendChild(w); }
    panel.appendChild(row); p.appendChild(panel);
    p.appendChild(el('div', 'perr', msg || ''));
    const pad = el('div', 'pad');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'x'].forEach(k => { const b = el('button', 'key'); b.type = 'button';
      if (k === '') b.disabled = true;
      else if (k === 'x') { b.innerHTML = SVG.back; b.setAttribute('aria-label', 'Delete'); b.onclick = () => { if (pop()) { haptic('tap'); tap(b); } }; }
      else { b.textContent = k; b.onclick = () => { if (push(parseInt(k, 10))) { haptic('tap'); tap(b); } }; }
      pad.appendChild(b); });
    p.appendChild(pad);
    const go = el('button', 'btn go', T[3]); go.type = 'button'; go.onclick = () => confirmPin(); p.appendChild(go);
    const l = el('div', 'links');
    const link = (t, fn) => { const b = el('button', 'lnk', t); b.type = 'button'; b.onclick = fn; l.appendChild(b); };
    if (f === 'unlock') { link('Forgot PIN?', () => msStart('reset')); link('Sign out', () => showHero('signout')); }
    if (f === 'sunlock') link('Not you?', () => showPicker());
    if (f === 'cur' || f === 'new' || f === 'new2') link('Cancel', () => endChange(false));
    p.appendChild(l);
    updateDisplay();
  }
  async function confirmPin() {
    if (busy || !flow) return;
    clearTimeout(autoT);
    if (entered.length !== 4) { shake(); flashError(); return; }
    const pin = entered.join(''); entered = [];
    if (flow === 'setpin') { firstPin = pin; pinFlow('setpin2'); return; }
    if (flow === 'cur') { curPin = pin; pinFlow('new'); return; }
    if (flow === 'new') { firstPin = pin; pinFlow('new2'); return; }
    let body;
    if (flow === 'setpin2') { if (pin !== firstPin) { firstPin = ''; pinFlow('setpin', 'Those didn\'t match. Choose again.'); return; } body = { newPin: pin }; }
    else if (flow === 'new2') { if (pin !== firstPin) { firstPin = ''; pinFlow('new', 'Those didn\'t match. Choose again.'); return; } body = { pin: curPin, newPin: pin }; }
    else if (flow === 'sunlock') { if (!who) { showPicker(); return; } body = { who: who.id, pin }; }
    else body = { pin };
    const changing = flow === 'new2', sh = flow === 'sunlock';
    busy = true; goBtn('busy'); scan(true); haptic('tap');
    const r = await devCall('/unlock', body);
    scan(false);
    if (r.s === 200 && r.j.token) {
      firstPin = ''; curPin = '';
      if (!sh) { dev.state = 'active'; dev.fresh = false; if (r.j.name) dev.name = r.j.name; if (r.j.email) dev.email = r.j.email; try { await devSave(); } catch (e) {} }   // a shared device keeps nothing about the person
      await welcome(); busy = false;
      const s = makeSession(r.j);
      if (changing) { setSession(s); endChange(true); return; }
      await enter(s); return;
    }
    busy = false; goBtn(''); firstPin = '';
    if (r.s === 400) { if (changing) { pinFlow('new', r.j.error || 'Choose a different PIN.'); } else pinFlow('setpin', r.j.error || 'Choose a different PIN.'); return; }
    if (r.s === 401 && r.j.triesLeft !== undefined) {
      if (changing) { curPin = ''; pinFlow('cur', 'Current PIN is wrong · ' + r.j.triesLeft + ' tr' + (r.j.triesLeft === 1 ? 'y' : 'ies') + ' left'); return; }
      shake(); flashError();
      setTimeout(() => perr('Incorrect PIN · ' + r.j.triesLeft + ' tr' + (r.j.triesLeft === 1 ? 'y' : 'ies') + ' left'), 10);   // 1.1.1: every wrong PIN says so, not just the last two
      return;
    }
    if (r.s === 0) { updateDisplay(); perr('Could not reach the server.'); return; }
    if (r.s === 429) { const m = Math.max(1, Math.ceil((r.j.retryAfter || 900) / 60)); updateDisplay(); perr((r.j.scope === 'device' ? 'Too many wrong PINs on this ' + kind() + '. ' : 'Too many tries. ') + 'Wait ' + m + ' minute' + (m === 1 ? '' : 's') + '.'); return; }
    if (sh && (r.s === 404 || r.s === 410 || r.s === 403)) { await devForget(); people = null; dropSession('gone'); showHero('start', 'This shared device needs to be set up again.'); return; }
    const st = r.j.state;
    if (st === 'locked' || st === 'expired' || st === 'gone' || r.s === 404 || r.s === 410) {
      curPin = ''; await devForget(); dropSession(st === 'locked' ? 'locked' : st === 'expired' ? 'expired' : 'gone');
      if (st === 'locked') showHero('locked'); else if (st === 'expired') showHero('checkin'); else showHero('start'); return;
    }
    updateDisplay(); perr('Something went wrong. Try again.');
  }

  // ---------------- the session (memory only) ----------------
  function makeSession(j) { let exp = Date.now() + 3600000; try { exp = JSON.parse(atob(String(j.token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) {}
    return { token: j.token, name: j.name || (dev && dev.name) || '', email: j.email || (dev && dev.email) || '', expires: exp, microsoftAgainAt: j.expires || 0, shared: !!j.shared }; }
  const live = () => !!(sess && sess.expires > Date.now() + 10000);
  function setSession(s) {
    sess = s; clearTimeout(lockT);
    lockT = setTimeout(expire, Math.max(1000, s.expires - Date.now() - 5000));
    const w = waiters; waiters = []; w.forEach(f => f.res(s.token));
  }
  function expire() { if (sess && sess.expires - Date.now() > 6000) { lockT = setTimeout(expire, sess.expires - Date.now() - 5000); return; }
    if (!sess) return; sess = null; try { cfg.onLocked && cfg.onLocked(); } catch (e) {}
    if (dev && dev.shared) { if (who) pinFlow('sunlock'); else showPicker(); }   // the same person carries on with their PIN
    else if (cfg.autoLock !== false && dev) pinFlow('unlock'); }
  function dropSession(why) { const had = !!sess; sess = null; clearTimeout(lockT); if (had || why === 'signout') { try { cfg.onSignedOut && cfg.onSignedOut(why); } catch (e) {} } }
  // a token is in hand: let the app decide (it may say "not yet": {pending:true, title, text})
  async function enter(s) {
    if (!s || s.expires < Date.now() + 10000) { if (dev && dev.shared) showPicker(); else if (dev) pinFlow('unlock'); else showHero('start'); return; }
    lastSession = s; let out;
    try { out = cfg.onSignedIn ? await cfg.onSignedIn({ token: s.token, name: s.name, email: s.email, expires: s.expires, microsoftAgainAt: s.microsoftAgainAt, shared: s.shared }) : null; }
    catch (e) { if (dev && dev.shared) showPicker('Something went wrong. Try again.'); else pinFlow('unlock', 'Something went wrong. Try again.'); return; }
    if (s.shared && out && (out.pending || out.microsoft)) { showPicker(out.text || 'You can\'t use this app yet. Ask an admin.'); return; }   // nobody waits on a shared device
    lastAct = Date.now();
    if (out && out.pending) { showHero('pending', '', { title: out.title, text: out.text }); return; }
    if (out && out.microsoft) { showHero('checkin', out.text || ''); return; }   // the app wants a fresh Microsoft sign-in (e.g. admins every 30 days)
    setSession(s); close();
  }
  async function doSignOut() {
    showHero('busy');
    await devCall('/signout', {});   // if the server can't be reached the key is still destroyed here
    await devForget(); people = null; who = null; dropSession('signout');
    const w = waiters; waiters = []; w.forEach(f => f.rej(new Error('signed out')));
    showHero('start');
  }
  function endChange(ok) { const w = pinWaiter; pinWaiter = null; firstPin = ''; curPin = ''; if (live()) close(); else if (dev) pinFlow('unlock'); else showHero('start'); if (w) w(ok); }

  // keyboard entry — a document listener, not an input box: with no input there is nothing for a browser to remember
  document.addEventListener('keydown', e => {
    if (!flow || !host || !host.hasAttribute('data-open')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key >= '0' && e.key <= '9' && e.key.length === 1) { push(parseInt(e.key, 10)); e.preventDefault(); }
    else if (e.key === 'Backspace') { pop(); e.preventDefault(); }
    else if (e.key === 'Enter') { confirmPin(); e.preventDefault(); }
    else if (e.key === 'Escape' && (flow === 'cur' || flow === 'new' || flow === 'new2')) { endChange(false); e.preventDefault(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sess && sess.expires < Date.now() + 5000) expire(); });
  // a shared device goes back to the name list after 5 idle minutes (sharedIdleMinutes), so nobody is left signed in
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { lastAct = Date.now(); }, true));
  function sharedLock(tell) { sess = null; clearTimeout(lockT); who = null; if (tell) { try { cfg.onLocked && cfg.onLocked(); } catch (e) {} } showPicker(); }
  setInterval(() => { if (cfg && dev && dev.shared && sess && Date.now() - lastAct > (cfg.sharedIdleMinutes || 5) * 60000) sharedLock(true); }, 15000);

  async function begin() {
    if (await msReturn()) return;
    await devLoad();
    let after = null; try { after = JSON.parse(sessionStorage.getItem(AFTER_KEY) || 'null'); sessionStorage.removeItem(AFTER_KEY); } catch (e) {}   // back from signing out of Microsoft after a shared set-up
    if (after && after.app === cfg.app && after.msg) { if (dev && !dev.shared) await devStatus(); else showHero('start', String(after.msg).slice(0, 200)); return; }
    if (!dev) { showHero('start'); return; }
    showHero('busy'); await devStatus();
  }

  // ---------------- what your app calls ----------------
  window.NCEMSSignIn = {
    version: VERSION,
    /** Start. Shows the right screen straight away unless auto:false (then only when getToken() is called). */
    init(o) {
      if (cfg) throw new Error('NCEMSSignIn.init was already called');
      if (!o || !/^[a-z0-9-]{2,24}$/.test(String(o.app || ''))) throw new Error('NCEMSSignIn: "app" is the key Derek gave this app in ncems-id');
      if (!/^[0-9a-f-]{36}$/i.test(String(o.clientId || ''))) throw new Error('NCEMSSignIn: "clientId" is this app\'s Entra Application (client) ID');
      if (!(window.crypto && crypto.subtle && window.indexedDB)) throw new Error('NCEMSSignIn: this browser can\'t keep a secure device key (needs https)');
      cfg = Object.assign({}, o, { idUrl: String(o.idUrl || DEFAULT_ID).replace(/\/+$/, ''), redirectUri: o.redirectUri || location.origin + '/' });
      const go = () => { mount(); if (cfg.auto === false) msReturn(); else begin(); };
      if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
    },
    /** A token good for at least the next few seconds. Asks for the PIN (or Microsoft) if there isn't one. */
    getToken() {
      if (!cfg) return Promise.reject(new Error('call NCEMSSignIn.init first'));
      if (live()) return Promise.resolve(sess.token);
      return new Promise((res, rej) => { waiters.push({ res, rej }); if (!host || !host.hasAttribute('data-open')) begin(); });
    },
    /** {token, name, email, expires} while signed in, else null. */
    session() { return live() ? { token: sess.token, name: sess.name, email: sess.email, expires: sess.expires, microsoftAgainAt: sess.microsoftAgainAt, shared: !!sess.shared } : null; },
    /** true if this phone or tablet is set up as a shared device. */
    isShared() { return !!(dev && dev.shared); },
    /** Forget the token and show the PIN pad (e.g. a "Lock" button). */
    lock() { if (!cfg) return; if (dev && dev.shared) { sharedLock(false); return; } sess = null; clearTimeout(lockT); if (dev) pinFlow('unlock'); else showHero('start'); },
    /** "Sign out of this phone?" — the device forgets its key; next time is Microsoft again. */
    signOut() { if (!cfg || !dev) return; if (dev.shared) { sharedLock(false); return; } showHero('signout', '', { back: 'app' }); },   // on a shared device "sign out" means "I'm done": back to the names
    /** Current PIN, new PIN, again. Resolves true if it was changed. The new PIN works in every NCEMS app. */
    changePin() { if (!cfg || !dev || dev.shared) return Promise.resolve(false); return new Promise(res => { pinWaiter = res; pinFlow('cur'); }); },   // not on a shared device
    /** 'auto' (follows the device), 'light' or 'dark'. */
    setTheme(t) { if (!cfg) return; cfg.theme = t === 'dark' || t === 'light' ? t : 'auto'; applyTheme(); }
  };
})();
