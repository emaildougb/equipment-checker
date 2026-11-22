// ncems-id-verify.js v1.1.0 — check an NCEMS sign-in token in a Cloudflare Worker (or any JS runtime with WebCrypto).
//
//   import { ncemsUser } from './ncems-id-verify.js';
//   const who = await ncemsUser(request, { app: 'hub' });     // throws if the token isn't good for THIS app
//   // who = { oid, name, email, authTime, expires, app }
//
// RULES FOR YOUR WORKER
//   * Pass YOUR app's key as `app`. A token made for another NCEMS app is refused.
//   * Know people by `oid` (their permanent Microsoft account id), never by name or email.
//   * This only says WHO it is. Whether they may use your app, and as what, is your own list.
//   * Check it on EVERY request. Trust nothing else the page says about who someone is.
//   * No secrets are needed: the key below is ncems-id's PUBLIC key. Your Worker can check tokens but can't make them.
//   * SHARED DEVICES (v1.1): a token from a shared phone or tablet says shared: true. There the PIN alone was enough
//     (no personal device behind it), so such a token is REFUSED unless you pass { allowShared: true }. Pass it only on
//     the routes crews use from shared devices. Never on admin routes, and never for anything about pay or schedules.
//
// If ncems-id ever changes its key, an unknown key id is looked up at KEYS_URL (at most every 5 minutes). A Worker in
// the SAME Cloudflare account as ncems-id can't fetch its workers.dev address: pass a service binding as
// opts.fetcher (e.g. { fetcher: (u) => env.ID.fetch(u) }) or get the new copy of this file from Derek.
const PINNED = [{ kty: 'EC', crv: 'P-256', kid: 'e3464ee6832284cd', x: 'aDcWmgqqXPu43D036vYAiAvXDsem_oQCYTtxEx0RhNQ', y: 'rNfzG5BljrgMtjY1C6QdUlu0ZWrDkAi5RA1PFaFrTtM' }];
const KEYS_URL = 'https://ncems-id.d-langdon.workers.dev/keys';
const ISSUER = 'ncems-id';
let fetched = { at: 0, keys: [] };

function fail(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
function b64uBytes(s) { s = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
const b64uJson = s => JSON.parse(new TextDecoder().decode(b64uBytes(s)));

async function findKey(kid, opts) {
  const known = (opts.keys || PINNED).concat(fetched.keys);
  let k = known.find(x => x.kid === kid);
  if (!k && !opts.keys && Date.now() - fetched.at > 300000) {
    fetched.at = Date.now();
    try { const r = await (opts.fetcher || fetch)(KEYS_URL); if (r.ok) { const j = await r.json(); fetched.keys = Array.isArray(j.keys) ? j.keys : []; k = fetched.keys.find(x => x.kid === kid); } } catch (e) {}
  }
  return k && k.kty === 'EC' && k.crv === 'P-256' && !k.d ? k : null;
}

/** Check a token string. opts: { app (required), allowShared, maxAuthAgeDays, keys, fetcher }. Returns who it is, or throws (err.code). */
export async function verifyNcemsId(token, opts) {
  if (!opts || typeof opts.app !== 'string' || !opts.app) throw fail('config', 'verifyNcemsId needs { app }');
  if (typeof token !== 'string' || !token || token.length > 4000) throw fail('no-token', 'sign-in required');
  const parts = token.split('.'); if (parts.length !== 3) throw fail('bad-token');
  let h, p; try { h = b64uJson(parts[0]); p = b64uJson(parts[1]); } catch (e) { throw fail('bad-token'); }
  if (!h || h.alg !== 'ES256' || typeof h.kid !== 'string' || !p || typeof p !== 'object') throw fail('bad-token');   // never "none", never HS256
  const k = await findKey(h.kid, opts); if (!k) throw fail('unknown-key');
  let ok = false;
  try { const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: k.x, y: k.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1])); } catch (e) { ok = false; }
  if (!ok) throw fail('bad-signature');
  const now = Math.floor(Date.now() / 1000);
  if (p.iss !== ISSUER) throw fail('bad-token');
  if (p.aud !== opts.app) throw fail('wrong-app', 'this sign-in is for another app');
  if (!(typeof p.exp === 'number' && p.exp > now)) throw fail('expired', 'sign in again');
  if (typeof p.iat === 'number' && p.iat > now + 60) throw fail('bad-token');
  if (typeof p.sub !== 'string' || !p.sub) throw fail('bad-token');
  const shared = p.shared === true;
  if (p.shared !== undefined && !shared) throw fail('bad-token');
  if (shared && opts.allowShared !== true) throw fail('shared-not-allowed', 'not from a shared device');
  const authTime = (Number(p.auth_time) || 0) * 1000;
  // e.g. { maxAuthAgeDays: 30 } for admins: their device must have signed in with Microsoft in the last 30 days
  // (on a shared token auth_time is when the DEVICE was set up, not the person: don't combine maxAuthAgeDays with allowShared)
  if (opts.maxAuthAgeDays && (shared || !(authTime + opts.maxAuthAgeDays * 864e5 > Date.now()))) throw fail('microsoft-needed', 'Microsoft sign-in needed');
  return { oid: p.sub, name: String(p.name || '').slice(0, 80), email: String(p.email || '').slice(0, 120).toLowerCase(), authTime, expires: p.exp * 1000, app: p.aud, shared };
}

/** Reads "Authorization: Bearer <token>" from a Request and checks it. */
export async function ncemsUser(request, opts) {
  const h = (request && request.headers && request.headers.get('Authorization')) || '';
  if (!h.startsWith('Bearer ')) throw fail('no-token', 'sign-in required');
  return verifyNcemsId(h.slice(7), opts);
}
