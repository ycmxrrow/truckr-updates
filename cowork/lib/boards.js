/* TRUCKR CoWork — reads the loads YOU have posted on DAT One and Truckstop, straight through their own systems,
   with the sign-in borrowed from your DAT / Truckstop page. Read-only: never posts, edits or removes anything. */
const BOARDS = (() => {
  'use strict';
  const TS_API = 'https://api.truckstop.com', DAT_API = 'https://freight.api.dat.com';
  const b64 = s => { try { return JSON.parse(atob(String(s).replace(/^bearer\s+/i, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return null; } };
  const stale = () => { const e = new Error('stale'); e.code = 'stale'; return e; };

  // who a sign-in belongs to: any name / email the board put in its token
  function whoIn(obj) {
    const out = { name: '', email: '' }, names = {};
    (function walk(v, depth, key) {
      if (v == null || depth > 5) return;
      if (typeof v === 'string') {
        if (!out.email && /^[\w.+'-]+@[\w-]+(\.[\w-]+)+$/.test(v) && !/noreply|no-reply/i.test(v)) out.email = v.toLowerCase();
        const k = String(key || '').toLowerCase();
        if (/^(first_?name|given_?name)$/.test(k)) names.first = v;
        else if (/^(last_?name|family_?name|surname)$/.test(k)) names.last = v;
        else if (/^(name|full_?name|display_?name|username|user_?name|nickname)$/.test(k) && !/@/.test(v) && /\s/.test(v)) names.full = names.full || v;
        if (/^eyJ/.test(v) && v.split('.').length === 3) walk(b64(v), depth + 1, '');
        return;
      }
      if (typeof v === 'object') Object.entries(v).forEach(([k, z]) => walk(z, depth + 1, /\/(\w+)$/.test(k) ? k.match(/\/(\w+)$/)[1] : k));
    })(obj, 0, '');
    out.name = names.full || [names.first, names.last].filter(Boolean).join(' ');
    return out;
  }

  // ---------- Truckstop ----------
  function tsParts(jwt) {
    const p = b64(jwt); if (!p || !p.accessToken) return null;
    return { token: p.accessToken, exp: (p.exp || 0) * 1000, claims: p.claims || {}, payload: p };
  }
  async function tsApi(path, body, tok) {
    const r = await fetch(TS_API + path, { method: body ? 'POST' : 'GET', headers: Object.assign({ Authorization: 'Bearer ' + tok }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 || r.status === 403) throw stale();
    if (!r.ok) throw new Error('Truckstop ' + r.status);
    return r.json();
  }
  // onlyMine: just the loads posted by (or "Post As") the person signed in — a shared company account shows everyone's
  async function tsList(jwt, onlyMine) {
    const t = tsParts(jwt); if (!t || t.exp < Date.now() + 5000) return { ok: false, error: 'stale' };
    const me = String(t.claims.v5AccountUserId || '').toLowerCase(); const out = [];
    try {
      for (let pg = 1; pg <= 5; pg++) {
        const j = await tsApi('/loadmanagement/v2/load/nonpublic/search?shouldpreferprimary=false', { searchCriteria: [{ name: 'DeletedState', operator: 'eq', value: '0' }], sortCriteria: [], pagination: { pageSize: 100, pageNumber: pg } }, t.token);
        (j.data || []).forEach(l => {
          const mine = !onlyMine || !me || String(l.createdBy || '').toLowerCase() === me || String(l.postAsUserId || '').toLowerCase() === me;
          if (mine && /posted/i.test((l.loadState || {}).loadStateDescription || '')) out.push(l);
        });
        if (!j.pagination || pg >= j.pagination.totalPages) break;
      }
    } catch (e) { return { ok: false, error: e.code === 'stale' ? 'stale' : e.message }; }
    return { ok: true, loads: out };
  }
  function tsWho(jwt) { const t = tsParts(jwt); if (!t) return null; const w = whoIn(t.payload); w.id = String(t.claims.v5AccountUserId || ''); w.account = String(t.claims.accountName || t.claims.companyName || t.claims.v5AccountName || ''); return w; }

  // ---------- DAT One ----------
  async function datApi(tok, path) {
    const r = await fetch(DAT_API + path, { headers: { Authorization: tok, Accept: 'application/json' } });
    if (r.status === 401) throw stale();
    if (!r.ok) throw new Error('DAT ' + r.status);
    const t = await r.text(); try { return JSON.parse(t); } catch (e) { return t; }
  }
  async function datList(tok) {
    const out = [];
    try {
      for (let pg = 1; pg <= 3; pg++) {
        const list = await datApi(tok, `/shipment/v1/shipmentListingItems?pageSize=50&page=${pg}&orderBy=desc(history.serviced.when)`);
        const arr = Array.isArray(list) ? list : (list && (list.data || list.items)) || [];
        arr.forEach(it => { if (it.postingId && /^POSTED/i.test(it.status || '')) out.push(it); });
        if (arr.length < 50) break;
      }
      // the full shipment (hours, weight, length, commodity, comments) when DAT gives it; the list item alone otherwise
      await Promise.all(out.slice(0, 40).map(async it => {
        if (!it.shipmentId) return;
        try { const full = await datApi(tok, `/shipment/v1/shipments/${it.shipmentId}`); if (full && typeof full === 'object') it.full = full; } catch (e) { if (e.code === 'stale') throw e; }
      }));
    } catch (e) { return { ok: false, error: e.code === 'stale' ? 'stale' : e.message }; }
    return { ok: true, loads: out };
  }
  async function datWho(tok, user) {
    const w = whoIn(b64(tok) || {});
    if (user && (!w.email || !w.name)) {
      try {
        const r = await fetch(`https://identity.api.dat.com/account/v1/users/${user}`, { headers: { Authorization: tok, Accept: 'application/json' } });
        if (r.ok) { const j = whoIn(await r.json()); w.email = w.email || j.email; w.name = w.name || j.name; }
      } catch (e) { /* name stays blank */ }
    }
    w.id = user || '';
    return w;
  }
  return { tsList, tsWho, datList, datWho, whoIn, b64 };
})();
if (typeof module !== 'undefined') module.exports = BOARDS;
