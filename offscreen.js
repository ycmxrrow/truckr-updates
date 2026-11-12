/* TRUCKR CoWork — hidden page: loads DAT One / Truckstop in an invisible frame just long enough to read your sign-in.
   No tabs, no windows. The frame is dropped right after. */
const frames = {};
function frameFor(site, url) {
  let fr = frames[site];
  if (fr && fr.url === url) return fr;
  if (fr) fr.el.remove();
  const el = document.createElement('iframe');
  el.style.cssText = 'width:1366px;height:1000px;border:0';
  fr = frames[site] = { el, url, ready: false, waiters: [], pending: {} };
  el.src = url; document.body.appendChild(el);
  return fr;
}
window.addEventListener('message', e => {
  const d = e.data || {};
  for (const fr of Object.values(frames)) {
    if (e.source !== fr.el.contentWindow) continue;
    if (d.truckrc === 'ready') { fr.ready = true; fr.waiters.splice(0).forEach(w => w(true)); }
    if (d.truckrc === 'result' && fr.pending[d.id]) { const p = fr.pending[d.id]; delete fr.pending[d.id]; p(d.result); }
  }
});
let seq = 0;
async function token({ site, url, timeout }) {
  const fr = frameFor(site, url);
  if (!fr.ready) { const ok = await new Promise(res => { fr.waiters.push(res); setTimeout(() => res(false), 40000); }); if (!ok) return { ok: false, error: 'notready' }; }
  const id = ++seq;
  return new Promise(res => { fr.pending[id] = res; fr.el.contentWindow.postMessage({ truckrc: 'job', id }, '*'); setTimeout(() => { if (fr.pending[id]) { delete fr.pending[id]; res({ ok: false, error: 'timeout' }); } }, timeout || 30000); });
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.target !== 'truckrc-offscreen') return;
  if (msg.type === 'DROP') { const fr = frames[msg.site]; if (fr) { fr.el.remove(); delete frames[msg.site]; } respond({ ok: true }); return; }
  if (msg.type === 'TOKEN') { token(msg).then(respond); return true; }
});
