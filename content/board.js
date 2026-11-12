/* TRUCKR CoWork: on DAT One / Truckstop pages, hands TRUCKR CoWork YOUR sign-in so it can read the loads you have posted.
   Read-only: it never posts, edits or removes anything on the boards. */
(function () {
  'use strict';
  if (window.__truckrcBoard) return; window.__truckrcBoard = 1;
  const SITE = /dat\.com$/i.test(location.hostname) ? 'dat' : 'truckstop';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const b64 = s => JSON.parse(atob(String(s).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  let datTok = '', datUser = '';
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data) return;
    if (e.data.truckrcDatToken) datTok = e.data.truckrcDatToken;
    if (e.data.truckrcDatUser) datUser = e.data.truckrcDatUser;
  });
  const onLogin = () => /login|sign-?in|auth0|okta/i.test(location.pathname + location.hostname) && !!document.querySelector('input[type="password"]');
  async function tokenHere() {
    if (onLogin()) return { ok: false, error: 'login' };
    if (SITE === 'truckstop') {
      for (let i = 0; i < 75; i++) { // up to 15s while Truckstop finishes signing in
        try { const t = localStorage.getItem('token'); if (t) { const p = b64(t); if (p.accessToken && (p.exp || 0) * 1000 > Date.now() + 60000) return { ok: true, jwt: t, exp: p.exp * 1000 }; } } catch (e) { /* not yet */ }
        if (onLogin()) return { ok: false, error: 'login' };
        await sleep(200);
      }
      return { ok: false, error: 'stale' };
    }
    for (let i = 0; i < 60 && !datTok; i++) { window.postMessage({ truckrcDatAsk: 1 }, location.origin); await sleep(250); if (onLogin()) return { ok: false, error: 'login' }; }
    if (!datTok) return { ok: false, error: 'stale' };
    let exp = 0; try { exp = b64(datTok.replace(/^bearer\s+/i, '')).exp * 1000; } catch (e) { /* unknown */ }
    return { ok: true, tok: datTok, user: datUser, exp };
  }
  // inside TRUCKR CoWork's hidden page (no tab, no window): answer sign-in requests from it
  const parentOrigin = (location.ancestorOrigins && location.ancestorOrigins[0]) || '';
  if (window.top !== window) {
    if (!/^chrome-extension:\/\//.test(parentOrigin) || parentOrigin !== 'chrome-extension://' + chrome.runtime.id) return;
    window.addEventListener('message', async e => {
      if (e.source !== window.parent || !e.data || e.data.truckrc !== 'job') return;
      let result; try { result = await tokenHere(); } catch (err) { result = { ok: false, error: err.message }; }
      window.parent.postMessage({ truckrc: 'result', id: e.data.id, result }, parentOrigin);
    });
    const hello = () => window.parent.postMessage({ truckrc: 'ready' }, parentOrigin);
    if (document.readyState === 'complete') setTimeout(hello, 800); else window.addEventListener('load', () => setTimeout(hello, 800));
    return;
  }
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === 'TRC_TOKEN' && msg.site === SITE) { tokenHere().then(respond, e => respond({ ok: false, error: e.message })); return true; }
  });
  // you just signed in on this tab: let TRUCKR CoWork pick it up right away
  setTimeout(() => { try { chrome.runtime.sendMessage({ type: 'BOARD_OPEN', site: SITE }).catch(() => {}); } catch (e) { /* reloading */ } }, 4000);
})();
