/* TRUCKR CoWork: runs in DAT One's own page so TRUCKR CoWork can read YOUR posted loads with the sign-in DAT already has.
   Only hands the sign-in to TRUCKR CoWork's own script on this same page. Never changes anything on DAT. */
(function () {
  if (window.__truckrcDat) return; window.__truckrcDat = 1;
  let tok = '', user = '';
  const isApi = u => /^https:\/\/([a-z0-9\-]+\.)*dat\.com\//i.test(u || '') && !/^https:\/\/one\.dat\.com\/(?!api)/i.test(u || '');
  const jwtExp = v => { try { return JSON.parse(atob(String(v).replace(/^bearer\s+/i, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000 || 0; } catch (e) { return 0; } };
  const keep = v => { if (v && /^bearer\s/i.test(v) && v !== tok) { const e = jwtExp(v); if (e && e < Date.now()) return; tok = v; window.postMessage({ truckrcDatToken: v }, location.origin); } };
  const fromStorage = () => {
    let best = '', bestExp = 0;
    const look = s => { if (!s || s.length > 200000) return; (s.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []).forEach(t => { const e = jwtExp(t); let aud = ''; try { aud = JSON.stringify(JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aud || ''); } catch (x) { /* */ } if (e > Date.now() + 60000 && e > bestExp && /dat/i.test(aud + s.slice(0, 80))) { best = t; bestExp = e; } }); };
    for (const st of [window.localStorage, window.sessionStorage]) { try { for (let i = 0; i < st.length; i++) { const k = st.key(i); look(k + ' ' + st.getItem(k)); } } catch (e) { /* */ } }
    if (best) keep('Bearer ' + best);
  };
  const who = u => { const m = String(u || '').match(/identity\.api\.dat\.com\/account\/v1\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i); if (m) { user = m[1]; window.postMessage({ truckrcDatUser: m[1] }, location.origin); } };
  const oo = XMLHttpRequest.prototype.open, oh = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { this.__truckrcU = String(u); if (isApi(this.__truckrcU)) who(u); return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (/^authorization$/i.test(k) && isApi(this.__truckrcU)) keep(v); return oh.apply(this, arguments); };
  const of = window.fetch;
  window.fetch = function (u, o) {
    try {
      const url = String((u && u.url) || u); const h = (o && o.headers) || (u && u.headers);
      const a = h && (typeof h.get === 'function' ? h.get('Authorization') : (Array.isArray(h) ? (h.find(x => /^authorization$/i.test(x[0])) || [])[1] : (h.Authorization || h.authorization)));
      if (isApi(url)) { keep(a); who(url); }
    } catch (e) { /* never break DAT */ }
    return of.apply(this, arguments);
  };
  window.addEventListener('message', e => {
    if (e.source === window && e.data && e.data.truckrcDatAsk) {
      if (!tok || (jwtExp(tok) && jwtExp(tok) < Date.now() + 60000)) { tok = ''; fromStorage(); }
      if (tok) window.postMessage({ truckrcDatToken: tok }, location.origin);
      if (user) window.postMessage({ truckrcDatUser: user }, location.origin);
    }
  });
})();
