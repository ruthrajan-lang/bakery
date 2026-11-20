// Bingsu's Bakery Worker: serves site/ as static assets, the focus-state relay, accounts and Todoist sign-in.
// POST /api/state/<code> {state}  (Mac tracker)  ->  GET /api/state/<code>  (phone / any browser)
import { DurableObject } from 'cloudflare:workers';

const STATES = new Set(['focused', 'distracted', 'idle']);
const KINDS = ['claude', 'writing', 'research', 'coding'];   // kinds of work: which apps count as on task (none = anything)
const kinds = v => typeof v === 'string' ? KINDS.filter(k => v.split(',').includes(k)).join(',') : null;
const WHYS = new Set(['', 'claude', 'other']);   // why a tracker reports idle while you're still at the computer
const DEFAULT_SITES = ['YouTube', 'Reddit', 'Twitter', ' / X', 'Instagram', 'Facebook', 'TikTok', 'Netflix', 'Twitch', 'Hulu', 'Disney+', 'Discord', 'Steam'];
const str = (v, n) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type, authorization' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

// one tiny Durable Object per pairing code holds the latest state
export class Relay extends DurableObject {
  async fetch(req) {
    const path = new URL(req.url).pathname;
    // the task you're on (from the bakery page or Ritual) and Ritual's focus block, shared by every device
    if (path.startsWith('/api/task/') || path.startsWith('/api/block/')) {
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      let d; try { d = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (path.startsWith('/api/task/') && kinds(d.kind) !== null) await this.ctx.storage.put('kind', kinds(d.kind));   // Ritual sends no kind, so it keeps yours
      if (path.startsWith('/api/task/')) await this.ctx.storage.put('task', { text: str(d.text, 200), id: str(d.id, 80), src: str(d.src, 20), from: str(d.from, 20), t: Date.now() });
      else await this.ctx.storage.put('block', d.start ? { start: +d.start || 0, end: +d.end || 0, dur: +d.dur || 0, done: !!d.done, t: Date.now() } : null);
      return json({ ok: true });
    }
    if (path.startsWith('/api/ritual-sites/')) {   // Ritual's distracting sites, added to the trackers' list
      if (req.method !== 'POST') return json({ error: 'method' }, 405);
      let d; try { d = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      await this.ctx.storage.put('rsites', Array.isArray(d.sites) ? d.sites.filter(x => typeof x === 'string' && x.trim()).map(x => x.slice(0, 60)).slice(0, 200) : []);
      return json({ ok: true });
    }
    if (path.startsWith('/api/config/')) {   // distracting-sites list
      if (req.method === 'POST') {
        let d; try { d = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
        const list = Array.isArray(d.distracting) ? d.distracting.filter(x => typeof x === 'string' && x.trim() && x.length <= 60).slice(0, 100) : null;
        if (!list) return json({ error: 'distracting must be a list of words' }, 400);
        await this.ctx.storage.put('cfg', { distracting: list });
        return json({ ok: true });
      }
      const cfg = (await this.ctx.storage.get('cfg')) || { distracting: null }, rs = (await this.ctx.storage.get('rsites')) || [];
      // trackers read "distracting": your picks (or the defaults) plus Ritual's sites; the page still sees your own picks in "own"
      const base = cfg.distracting || DEFAULT_SITES, seen = new Set(base.map(x => x.toLowerCase()));
      const list = base.concat(rs.filter(x => !seen.has(x.toLowerCase())));
      // window titles often leave out the site name (Reddit posts read "Title : r/sub"), so add those title patterns too
      const ALIAS = { reddit: [' : r/', ' - r/', '| r/'], youtube: ['- YouTube'], twitter: [' / X'], x: [' / X'], tiktok: ['| TikTok'], netflix: ['Netflix'] };
      // a web address like "amazon.com" also matches the site's name ("Amazon"), since tab titles and other country sites (amazon.co.uk) rarely contain the full address
      const site = w => { const m = w.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').match(/^([a-z0-9-]{3,})\.[a-z.]{2,}(\/|$)/); return m ? [m[1]] : []; };
      const extra = list.flatMap(w => (ALIAS[w.trim().toLowerCase()] || []).concat(site(w))).filter(x => !list.map(y => y.toLowerCase()).includes(x.toLowerCase()));
      return json({ distracting: list.concat([...new Set(extra)]), own: cfg.distracting, ritual: rs, kind: (await this.ctx.storage.get('kind')) || '' });
    }
    // several computers can report for one code: each keeps its own state, and they're combined on read
    const devs = (await this.ctx.storage.get('devs')) || {};
    if (req.method === 'POST') {
      let d; try { d = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (!STATES.has(d.state)) return json({ error: 'state must be focused|distracted|idle' }, 400);
      const dev = String(d.dev || 'default').replace(/[^\w .-]/g, '').slice(0, 40) || 'default';
      devs[dev] = { state: d.state, t: Date.now(), why: WHYS.has(d.why) ? d.why : '', weak: !!d.weak };   // weak: a browser that isn't in front (only counts if nothing else reports)
      for (const k of Object.keys(devs)) if (Date.now() - devs[k].t > 864e5) delete devs[k];   // forget devices silent for a day
      await this.ctx.storage.put('devs', devs);
      return json({ ok: true });
    }
    const extra = { task: (await this.ctx.storage.get('task')) || null, block: (await this.ctx.storage.get('block')) || null, kind: (await this.ctx.storage.get('kind')) || '' };
    const fresh = Object.values(devs).filter(v => Date.now() - v.t < 90e3), strong = fresh.filter(v => !v.weak);   // reported in the last 90s
    const live = strong.length ? strong : fresh;
    if (!live.length) { const all = Object.values(devs); const t = all.reduce((m, v) => Math.max(m, v.t), 0); return json({ state: t ? 'idle' : null, t, devices: 0, ...extra }); }
    const pick = ['distracted', 'focused', 'idle'].find(st => live.some(v => v.state === st));   // any distracted computer wins; idle never overrides active use
    const why = pick === 'idle' ? (live.find(v => v.state === 'idle' && v.why) || {}).why || '' : '';
    return json({ state: pick, why, t: Math.max(...live.map(v => v.t)), devices: live.length, ...extra });
  }
}

// ---- accounts: email + password, sessions, and saved bakery progress (one Durable Object for all users) ----
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const rand = n => { const a = 'abcdefghjkmnpqrstuvwxyz23456789', b = crypto.getRandomValues(new Uint8Array(n)); return Array.from(b, x => a[x % a.length]).join(''); };
async function hashPw(pw, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256));
}
// the admin (sign-ups page) is identified by a fingerprint of their email, so the address isn't in the code
const ADMIN_SHA256 = ['9441d2a1518d724196d78695c5a190be7ae181dc41b637b244ee4b03cf73bfde'];
const sha256 = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
const okEmail = e => typeof e === 'string' && e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export class Accounts extends DurableObject {
  async user(token) {
    if (!token) return null;
    const t = await this.ctx.storage.get('tok:' + token);
    if (!t || t.exp < Date.now()) return null;
    const u = await this.ctx.storage.get('u:' + t.email);
    return u ? { ...u, email: t.email } : null;
  }
  async session(email) {
    const token = rand(40);
    await this.ctx.storage.put('tok:' + token, { email, exp: Date.now() + 365 * 864e5 });
    return token;
  }
  async fetch(req) {
    const url = new URL(req.url), path = url.pathname, token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    let d = {}; if (req.method === 'POST' || req.method === 'PUT') { try { d = await req.json(); } catch { return json({ error: 'bad json' }, 400); } }
    if (path === '/api/auth/signup') {
      const email = String(d.email || '').trim().toLowerCase(), pw = String(d.password || '');
      if (!okEmail(email)) return json({ error: 'Please enter a valid email address.' }, 400);
      if (pw.length < 8) return json({ error: 'Use a password with at least 8 characters.' }, 400);
      if (await this.ctx.storage.get('u:' + email)) return json({ error: 'There is already an account with that email. Log in instead.' }, 409);
      const code = /^[A-Za-z0-9_-]{8,64}$/.test(d.code || '') ? d.code : rand(12);   // keep this device's bakery (and its trackers)
      const salt = rand(16), u = { id: rand(16), salt, hash: await hashPw(pw, salt), code, created: Date.now() };
      await this.ctx.storage.put('u:' + email, u);
      return json({ token: await this.session(email), email, code });
    }
    if (path === '/api/auth/login') {
      const email = String(d.email || '').trim().toLowerCase(), u = await this.ctx.storage.get('u:' + email);
      if (!u || u.hash !== await hashPw(String(d.password || ''), u.salt)) return json({ error: 'That email and password don’t match.' }, 401);
      return json({ token: await this.session(email), email, code: u.code });
    }
    if (path === '/api/admin/reset-link') {   // only callable by the Worker itself after checking ADMIN_KEY
      const email = String(d.email || '').trim().toLowerCase();
      if (!(await this.ctx.storage.get('u:' + email))) return json({ error: 'No account with that email.' }, 404);
      const t = rand(32); await this.ctx.storage.put('reset:' + t, { email, exp: Date.now() + 30 * 60e3 });
      return json({ token: t });
    }
    if (path === '/api/auth/reset') {   // set a new password with a one-time link; the account and its saved progress are kept
      const r = await this.ctx.storage.get('reset:' + String(d.token || ''));
      if (!r || r.exp < Date.now()) return json({ error: 'This reset link has expired. Ask for a new one.' }, 400);
      const pw = String(d.password || ''); if (pw.length < 8) return json({ error: 'Use a password with at least 8 characters.' }, 400);
      const u = await this.ctx.storage.get('u:' + r.email), salt = rand(16);
      await this.ctx.storage.put('u:' + r.email, { ...u, salt, hash: await hashPw(pw, salt) });
      await this.ctx.storage.delete('reset:' + String(d.token)); await this.ctx.storage.delete('fail:' + r.email);
      return json({ token: await this.session(r.email), email: r.email, code: u.code });
    }
    const u = await this.user(token);
    if (!u) return json({ error: 'Please log in again.' }, 401);
    if (path === '/api/auth/logout') { await this.ctx.storage.delete('tok:' + token); return json({ ok: true }); }
    if (path === '/api/me') return json({ email: u.email, code: u.code, admin: ADMIN_SHA256.includes(await sha256(u.email)) });
    if (path === '/api/admin/users') {   // sign-ups, for the admin page only
      if (!ADMIN_SHA256.includes(await sha256(u.email))) return json({ error: 'not allowed' }, 403);
      const users = [];
      for (const [k, v] of await this.ctx.storage.list({ prefix: 'u:' })) {
        const sv = (await this.ctx.storage.get('save:' + v.id)) || {}, S = sv.data || {}, days = Object.values(S.daylog || {});
        let tracker = null;
        try { const r = await this.env.RELAY.get(this.env.RELAY.idFromName(v.code)).fetch(new Request('https://relay/api/state/' + v.code)); const d = await r.json(); tracker = d.t || null; } catch {}
        users.push({ email: k.slice(2), created: v.created || null, lastSave: sv.t || null, tracker,
          focusMin: Math.round((S.life || 0)/60), coins: S.coins || 0, level: S.lvlSeen || 1, bakes: (S.hist || []).length,
          daysActive: days.filter(d => (d.focus || 0) > 60 || d.bakes).length, goalDays: days.filter(d => d.goalMet).length,
          friends: Object.values(S.friends || {}).reduce((a, b) => a + b, 0), todoist: !!S.tdTok });
      }
      users.sort((a, b) => (b.created || 0) - (a.created || 0));
      return json({ users, now: Date.now() });
    }
    if (path === '/api/save') {
      if (req.method === 'PUT') {
        const body = JSON.stringify(d.data || null);
        if (body.length > 400000) return json({ error: 'save too large' }, 413);
        const cur = await this.ctx.storage.get('save:' + u.id);
        if (cur && cur.t > (+d.t || 0)) return json({ ok: false, stale: true, t: cur.t });   // a newer save already exists
        await this.ctx.storage.put('save:' + u.id, { data: d.data, t: +d.t || Date.now() });
        return json({ ok: true });
      }
      return json((await this.ctx.storage.get('save:' + u.id)) || { data: null, t: 0 });
    }
    return json({ error: 'not found' }, 404);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/admin/reset-link') {   // https://…/api/admin/reset-link?email=…&key=ADMIN_KEY  ->  a one-time link to set a new password
      const key = url.searchParams.get('key') || '';
      if (!env.ADMIN_KEY || key.length < 16 || key !== env.ADMIN_KEY) return json({ error: 'not allowed' }, 403);
      const r = await env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts')).fetch(new Request(new URL('/api/admin/reset-link', url), { method: 'POST', body: JSON.stringify({ email: url.searchParams.get('email') }) }));
      const d = await r.json(); if (!d.token) return json(d, r.status);
      const link = new URL('/bakery/#reset=' + d.token, url).toString();
      return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:30px;background:#fdf0df;color:#5d5049"><p>Reset link (works once, for 30 minutes):</p><p><a href="${link}">Set a new password</a></p>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (/^\/api\/(auth\/(signup|login|logout|reset)|me|save|admin\/users)$/.test(url.pathname)) {
      if (req.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS' } });
      return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts')).fetch(req);
    }
    const m = url.pathname.match(/^\/api\/(?:state|config|task|block|ritual-sites)\/([A-Za-z0-9_-]{8,64})$/);
    if (m) {
      if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
      if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method' }, 405);
      return env.RELAY.get(env.RELAY.idFromName(m[1])).fetch(req);
    }
    // ---- "Log in with Todoist" (OAuth). Needs TODOIST_CLIENT_ID + TODOIST_CLIENT_SECRET set on the Worker. ----
    if (url.pathname === '/api/todoist/start') {
      if (!env.TODOIST_CLIENT_ID) return new Response('Todoist login is not set up yet.', { status: 503 });
      const state = crypto.randomUUID();
      const to = `https://todoist.com/oauth/authorize?client_id=${encodeURIComponent(env.TODOIST_CLIENT_ID)}&scope=data:read_write&state=${state}`;
      return new Response(null, { status: 302, headers: { location: to, 'set-cookie': `td_state=${state}; Path=/api/todoist; Max-Age=600; HttpOnly; Secure; SameSite=Lax` } });
    }
    if (url.pathname === '/api/todoist/callback') {
      const back = (h) => new Response(null, { status: 302, headers: { location: '/bakery/#' + h, 'set-cookie': 'td_state=; Path=/api/todoist; Max-Age=0' } });
      const cookie = (req.headers.get('cookie') || '').match(/td_state=([\w-]+)/);
      if (!cookie || cookie[1] !== url.searchParams.get('state')) return back('todoist_error=state');
      if (!url.searchParams.get('code')) return back('todoist_error=' + encodeURIComponent(url.searchParams.get('error') || 'denied'));
      const r = await fetch('https://todoist.com/oauth/access_token', { method: 'POST', body: new URLSearchParams({ client_id: env.TODOIST_CLIENT_ID, client_secret: env.TODOIST_CLIENT_SECRET, code: url.searchParams.get('code') }) });
      const d = await r.json().catch(() => ({}));
      return d.access_token ? back('todoist_token=' + encodeURIComponent(d.access_token)) : back('todoist_error=exchange');
    }
    if (url.pathname === '/api/todoist/available') return json({ ok: !!(env.TODOIST_CLIENT_ID && env.TODOIST_CLIENT_SECRET) });
    if (url.pathname === '/bakery/manifest.webmanifest') {   // home-screen app, keeps your pairing code in the start URL
      const code = (url.searchParams.get('code') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
      return new Response(JSON.stringify({
        name: "Bingsu's Bakery", short_name: "Bingsu's Bakery", display: 'standalone', orientation: 'any',
        background_color: '#fdf0df', theme_color: '#fdf0df', scope: '/bakery/',
        ...(code ? { start_url: '/bakery/?code=' + code } : {}), id: '/bakery/',   // no code: start from the page you added (keeps ?code=)
        icons: [{ src: '/bakery/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/bakery/icon-192.png', sizes: '192x192', type: 'image/png' }]
      }), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' } });
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    if (url.pathname === '/bakery/version') {   // fingerprint of the bakery page, so open apps can tell they're out of date
      const r = await env.ASSETS.fetch(new Request(new URL('/bakery/', url), { headers: { 'cache-control': 'no-cache' } }));
      const h = await crypto.subtle.digest('SHA-1', await r.arrayBuffer());
      const v = [...new Uint8Array(h)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
      return json({ v });
    }
    return env.ASSETS.fetch(req);
  }
};
