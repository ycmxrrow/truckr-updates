/* TRUCKR — Outlook on the web: when a carrier emails about one of your posted loads, a TRUCKR bar shows above
   the message with the reply already written from that load (PU / DEL / Weight / Length / Commodity / Rate + accessorials).
   One click on Reply opens Outlook's reply with it typed in. */
(function () {
  'use strict';
  if (window.__truckrOutlook) { try { window.__truckrOutlook.stop(); } catch (e) { /* old copy */ } }
  document.querySelectorAll('truckr-bar').forEach(e => e.remove());
  const alive = () => { try { return !!chrome.runtime.id; } catch (e) { return false; } };
  const EMAIL_RE = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/;
  const BODY_SEL = 'div[aria-label="Message body"], div[aria-label="Message Body"], div[id^="UniqueMessageBody"]';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let BOOK = [], SETTINGS = Object.assign({}, TR.DEFAULTS), CUSTOMERS = [], STATUS = null, bookGen = 0;
  // the book is read straight from TRUCKR's storage (instant); the background keeps it fresh and this page hears every change
  async function loadBook(nudge) {
    try {
      const r = await chrome.storage.local.get(['book', 'bookAt', 'bookStatus', 'settings', 'customers', 'rules']);
      BOOK = r.book || []; SETTINGS = Object.assign({}, TR.DEFAULTS, r.settings || {}); CUSTOMERS = r.customers || []; STATUS = r.bookStatus || null; if (r.rules) TR.setRules(r.rules); bookGen++;
      if (nudge !== false && (!r.bookAt || Date.now() - r.bookAt > 90000)) chrome.runtime.sendMessage({ type: 'GET_BOOK' }).catch(() => {}); // stale: background syncs, the change arrives here
    } catch (e) { /* extension reloading */ }
  }
  let lastBookSig = '';
  const onStore = ch => {
    if (!(ch.book || ch.settings || ch.rules || ch.customers)) return;
    if (ch.book && !ch.settings && !ch.rules && !ch.customers) { const sig = JSON.stringify(ch.book.newValue || []); if (sig === lastBookSig) return; lastBookSig = sig; } // same loads as before: leave the bars alone
    loadBook(false).then(() => { document.querySelectorAll('truckr-bar').forEach(b => { b.dataset.k = ''; }); kick(); });
  };
  chrome.storage.onChanged.addListener(onStore);

  // ---------- reading the open message ----------
  function bodies() {
    const els = [...document.querySelectorAll(BODY_SEL)];
    const reading = els.filter(e => !e.isContentEditable && !e.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]'));
    return reading.filter(e => !reading.some(o => o !== e && o.contains(e))).filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.bottom > -innerHeight && r.top < innerHeight * 2; });
  }
  function senderFor(body) {
    const isRecipient = c => { let a = c; for (let k = 0; k < 5 && a; k++, a = a.parentElement) { const t = (a.textContent || '').trim(); if (t.length < 800 && /^(to|cc|bcc)\s*:/i.test(t)) return true; } return false; };
    let n = body;
    for (let i = 0; i < 14 && n; i++) {
      n = n.parentElement; if (!n) break;
      const cands = [...n.querySelectorAll('[title*="@"], [aria-label*="@"], span, button, a')]
        .filter(c => !body.contains(c) && !c.closest(BODY_SEL) && (c.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING)).reverse();
      for (const c of cands) {
        const tc = c.textContent || '';
        const t = (c.getAttribute('title') || '') + ' ' + (c.getAttribute('aria-label') || '') + ' ' + (!c.children.length || (tc.length < 120 && /<[^<>@\s]+@[^<>\s]+>/.test(tc)) ? tc : '');
        const m = t.match(EMAIL_RE);
        if (!m || isRecipient(c)) continue;
        const nm = (c.getAttribute('aria-label') || c.textContent || '').replace(/<.*?>|\[.*?\]/g, '').replace(EMAIL_RE, '').replace(/^(from)\s*:?/i, '').trim();
        return { email: m[0].toLowerCase(), name: nm.length < 60 ? nm : '' };
      }
    }
    return { email: '', name: '' };
  }
  function subjectFor(body) {
    let n = body;
    for (let i = 0; i < 14 && n; i++) {
      n = n.parentElement; if (!n) break;
      const hs = [...n.querySelectorAll('[role="heading"], [id*="subject" i], [class*="subject" i]')]
        .filter(h => !body.contains(h) && (h.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING) && (h.textContent || '').trim().length && (h.textContent || '').length < 200 && !/@/.test(h.textContent));
      if (hs.length) return hs[hs.length - 1].textContent.trim();
    }
    return '';
  }

  // ---------- Outlook reply ----------
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const editors = () => [...document.querySelectorAll('[contenteditable="true"][aria-label*="essage body" i], div[contenteditable="true"][role="textbox"], div.editable[contenteditable="true"]')].filter(vis);
  async function replyWith(body, text, all) {
    const before = new Set(editors());
    const lab = b => (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim();
    const btns = [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')].filter(vis);
    const pick = re => { const bs = btns.filter(b => re.test(lab(b))); if (!bs.length) return null; const above = bs.filter(b => b.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING); return above[above.length - 1] || bs[0]; };
    const btn = all ? (pick(/^reply[\s-]*all$/i) || pick(/^reply$/i)) : (pick(/^reply$/i) || pick(/^reply[\s-]*all$/i));
    if (!btn) return false;
    btn.click();
    let ed = null;
    for (let i = 0; i < 40 && !ed; i++) { await sleep(120); ed = editors().find(e => !before.has(e)) || null; }
    if (!ed) return false;
    ed.focus();
    const sel = window.getSelection(), range = document.createRange();
    range.setStart(ed, 0); range.collapse(true); sel.removeAllRanges(); sel.addRange(range);
    const html = text.split('\n').map(l => '<div>' + (l ? esc(l) : '<br>') + '</div>').join('');
    let ok = false;
    try { ok = document.execCommand('insertHTML', false, html); } catch (e) { ok = false; }
    if (!ok) { try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; } }
    return ok;
  }

  // ---------- the bar ----------
  const CSS = `
  :host{all:initial;display:block;margin:6px 0 10px}
  .bar{font:13px "Segoe UI",system-ui,Arial,sans-serif;color:#f3f1ec;background:#1f1f1e;border:1px solid #3b3a37;border-left:3px solid #ff5e14;border-radius:10px;padding:8px 10px}
  .top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .logo{font-weight:800;letter-spacing:1px;font-size:13px;margin-right:4px}.logo span{color:#ff5e14}
  .chip{background:#2a2927;border:1px solid #3b3a37;border-radius:999px;padding:1px 8px;font-size:12px;color:#d8d5ce;white-space:nowrap}
  .chip.src{border-color:#ff5e14;color:#ff8a4c;font-weight:600}
  .chip.warn{border-color:#d9a400;color:#ffd257;white-space:normal}.chip.ok{border-color:#2f7d46;color:#7fdc98}.chip.bad{border-color:#8a2f2f;color:#ff6b6b}
  .chip a{color:inherit}
  .sp{flex:1}
  .row{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}
  .muted{color:#a9a69e;font-size:12px}
  select,input,textarea{font:13px "Segoe UI",Arial;background:#171716;color:#f3f1ec;border:1px solid #3b3a37;border-radius:7px;padding:4px 6px}
  select{max-width:520px}
  textarea{width:100%;box-sizing:border-box;font-family:Consolas,"Cascadia Mono",monospace;font-size:12.5px;line-height:1.35;resize:vertical}
  input:focus,select:focus,textarea:focus{outline:none;border-color:#ff5e14}
  input.need{border-color:#ff6b6b}
  button{cursor:pointer;border-radius:8px;border:1px solid #ff5e14;background:#ff5e14;color:#fff;font-weight:600;font-size:12.5px;padding:5px 14px}
  button:hover{background:#ff8a4c;border-color:#ff8a4c}
  button.ghost{background:transparent;color:#ff8a4c}
  button.x{background:transparent;border-color:#3b3a37;color:#a9a69e;padding:3px 8px}
  .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:6px}
  .grid label{display:flex;flex-direction:column;gap:2px;font-size:11px;color:#a9a69e}
  .grid label.w2{grid-column:span 2}.grid label.w4{grid-column:span 4}
  .msg{font-size:12px;color:#7fdc98}.msg.bad{color:#ff6b6b}
  .hide{display:none}`;

  function summary(l) {
    const bits = [l.equipmentName || l.equipment, l.length ? Math.round(l.length) + "'" : '', l.weight ? Math.round(l.weight).toLocaleString() + ' lbs' : '', l.rate ? TR.money(l.rate) : 'no rate', l.pickupDate ? 'PU ' + TR.md(l.pickupDate) : ''].filter(Boolean);
    const src = l.src === 'manual' ? 'saved by you' : l.customer ? l.customer : l.src === 'spotr' ? 'SPOTR' : l.src;
    return `${l.covered ? '[COVERED] ' : l.cancelled ? '[CANCELLED] ' : ''}${TR.laneText(l.origin, l.dest)}${l.picks && l.picks.length + l.drops.length > 2 ? ` (${l.picks.length} PU ${l.drops.length} DEL)` : ''} · ${bits.join(' · ')} · ${src}${l.sf ? ' · ' + l.sf.name : ''}${l.boards && l.boards.length ? ' · on ' + l.boards.map(b => b === 'dat' ? 'DAT' : 'Truckstop').join(' + ') : ''}${l.down ? ' · not on the boards now' : ''}`;
  }
  const SRC_NAME = { dat: 'DAT', truckstop: 'Truckstop', loadlink: 'Loadlink', '123loadboard': '123Loadboard' };

  function mount(host, ctx) {
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    const { inq, m, body } = ctx;
    let load = ctx.load;
    const srcName = SRC_NAME[TR.sourceOf(inq, load)] || 'Email';
    const chips = [`<span class="chip src">${esc(srcName)} inquiry</span>`];
    if (inq.lane) chips.push(`<span class="chip">${esc(TR.laneText(inq.lane.o, inq.lane.d))}</span>`);
    if (inq.date) chips.push(`<span class="chip">${esc(TR.md(inq.date))}</span>`);
    if (inq.mc) chips.push(`<span class="chip">MC ${esc(inq.mc)}</span>`);
    if (inq.offer) chips.push(`<span class="chip warn">${inq.offer === 'posted' ? 'takes posted rate' : 'offer ' + esc(TR.money(inq.offer))}</span>`);
    if (inq.ask) chips.push(`<span class="chip">${esc(inq.ask)}</span>`);
    if (inq.replied) chips.push(`<span class="chip ok">you already answered in this thread</span>`);
    const opts = m.ranked.map((r, i) => `<option value="${i}">${esc(summary(r.load))}</option>`).join('');
    root.innerHTML = `<style>${CSS}</style><div class="bar">
      <div class="top"><span class="logo">TRUCK<span>R</span></span>${chips.join('')}<span class="sp"></span><button class="x" data-x title="Hide for this email">✕</button></div>
      <div class="row" data-pickrow>${m.ranked.length ? `<select data-pick>${opts}${''}<option value="new">+ Not listed: enter this load's details</option></select>` : `<span class="muted">No posted load matches${inq.lane ? ' ' + esc(TR.laneText(inq.lane.o, inq.lane.d)) : ''}.</span><button class="ghost" data-new>Enter details</button>`}<button class="ghost" data-sync title="Pull your live posts from DAT + Truckstop now">Sync</button><span class="muted" data-st></span></div>
      <div data-main>
        <div class="row" data-sfrow></div>
        <div class="row" data-needrow></div>
        <div class="row"><textarea data-txt rows="9" spellcheck="false"></textarea></div>
        <div class="row"><button data-reply>Reply</button><button class="ghost" data-copy>Copy</button><button class="ghost" data-edit>Edit load</button><span class="msg" data-msg></span></div>
      </div>
      <div class="hide" data-ed>
        <div class="grid">
          <label>PU hours<input data-f="pu" placeholder="07:00-15:00"></label><label>DEL hours<input data-f="del" placeholder="07:00-15:00"></label>
          <label>Weight (lbs)<input data-f="weight"></label><label>Length (ft)<input data-f="length"></label>
          <label class="w2">Commodity<input data-f="commodity"></label><label>Rate ($)<input data-f="rate"></label><label>Equipment<input data-f="equipmentName" placeholder="Flatbed"></label>
          <label class="w4">Accessorials / notes (tarps, coil racks, edge protectors...)<input data-f="notes"></label>
        </div>
        <div class="row"><button data-save>Save</button><button class="ghost" data-cancel>Cancel</button><span class="muted">Saved for this load, so the next carrier on this lane gets it too.</span></div>
      </div></div>`;
    const $ = s => root.querySelector(s);
    const txt = $('[data-txt]'), msg = (t, bad) => { const e = $('[data-msg]'); e.textContent = t; e.className = 'msg' + (bad ? ' bad' : ''); };
    let dirty = false;
    txt.oninput = () => { dirty = true; host._busy = true; };
    root.addEventListener('focusin', () => { host._busy = true; });
    root.addEventListener('focusout', () => { setTimeout(() => { if (!dirty && !root.activeElement && $('[data-ed]').classList.contains('hide')) host._busy = false; }, 0); });
    const render = () => {
      if (!load) { $('[data-main]').classList.add('hide'); return; }
      $('[data-main]').classList.remove('hide');
      // Salesforce cross-check: which load it is, whether it's covered, and anything that differs from the post
      const sf = load.sf, ch = (load.checks || []).filter(c => c.k !== 'status');
      $('[data-sfrow]').innerHTML = sf ? `<span class="chip ${load.covered || load.cancelled ? 'bad' : 'ok'}">${sf.url ? `<a href="${esc(sf.url)}" target="_blank">${esc(sf.name)}</a>` : esc(sf.name)} · ${esc(sf.status || '?')}</span>${load.covered ? '<span class="chip bad">covered in Salesforce: take the post down</span>' : load.cancelled ? '<span class="chip bad">cancelled in Salesforce: take the post down</span>' : ''}${sf.max ? `<span class="chip">max pay ${esc(TR.money(sf.max))}</span>` : ''}${ch.length ? `<span class="chip warn" title="${esc(ch.map(c => c.k + ': post ' + c.post + ' / Salesforce ' + c.sf).join('\n'))}">check: ${esc(ch.map(c => `${c.k} ${c.post} vs SF ${c.sf}`).join(' · '))}</span><button class="ghost" data-usesf>Use Salesforce details</button>` : ''}`
        : (load.src !== 'salesforce' && STATUS && STATUS.sf && STATUS.sf.ok ? '<span class="chip warn">not built in Salesforce yet</span>' : '');
      const us = $('[data-usesf]'); if (us) us.onclick = () => { load = TR.useSf(load); host._load = load; render(); };
      const miss = (load.covered || load.cancelled) ? [] : TR.missing(load);
      $('[data-needrow]').innerHTML = miss.includes('rate') ? `<span class="muted">No rate on this post:</span> Rate $<input data-rate class="need" size="7" placeholder="1,600"><span class="muted">${inq.offer && inq.offer !== 'posted' ? 'carrier offered ' + esc(TR.money(inq.offer)) : ''}</span>` : '';
      const ri = $('[data-rate]');
      if (ri) ri.oninput = () => { const v = Number(ri.value.replace(/[$,\s]/g, '')); load = Object.assign({}, load, { rate: v > 0 ? v : null }); txt.value = TR.buildReply(load, inq, SETTINGS); };
      txt.value = TR.buildReply(load, inq, SETTINGS); dirty = false;
      txt.rows = Math.min(16, txt.value.split('\n').length + 1);
    };
    render();
    const pick = $('[data-pick]');
    if (pick) {
      const bi = m.best ? m.ranked.findIndex(r => r.load === m.best) : -1;
      if (bi >= 0) pick.value = String(bi); else { pick.insertAdjacentHTML('afterbegin', '<option value="" selected>Which load is this? (no sure match)</option>'); pick.value = ''; load = null; render(); }
      pick.onchange = () => { if (pick.value === 'new') { load = null; render(); openEditor(true); return; } load = pick.value === '' ? null : m.ranked[Number(pick.value)].load; host._load = load; render(); };
    }
    const nb = $('[data-new]'); if (nb) nb.onclick = () => openEditor(true);
    $('[data-sync]').onclick = async () => {
      const st = $('[data-st]'); st.textContent = 'Syncing DAT + Truckstop…';
      const r = await chrome.runtime.sendMessage({ type: 'SYNC', mode: 'full' }).catch(() => null);
      st.textContent = r && r.ok ? `${r.n} loads up` : 'Sync failed: ' + ((r && (r.error || (r.status && r.status.error))) || 'no answer');
    };
    $('[data-x]').onclick = () => { host._dismissed = true; host.style.display = 'none'; };
    $('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(txt.value); msg('Copied'); } catch (e) { msg("Couldn't copy", true); } };
    const doReply = async () => {
      if (!load) { msg('Pick the load first', true); return false; }
      if (!load.covered && !load.cancelled && !load.rate && !/Rate - \$\d/.test(txt.value)) { msg('Add the rate first', true); const ri = $('[data-rate]'); if (ri) ri.focus(); return false; }
      const ok = await replyWith(body, txt.value, !!SETTINGS.replyAll);
      if (ok) msg('Reply opened. Review it and hit Send.');
      else { try { await navigator.clipboard.writeText(txt.value); } catch (e) { /* */ } msg("Couldn't open the reply box, so it's copied. Click Reply and paste.", true); }
      if (ok && load.rate && (!ctx.load || ctx.load.rate !== load.rate) && load.uid && load.src !== 'manual') chrome.runtime.sendMessage({ type: 'SAVE_EDIT', uid: load.uid, edit: { rate: load.rate } }).catch(() => {});
      chrome.runtime.sendMessage({ type: 'LOG_REPLY', entry: { lane: inq.lane ? TR.laneText(inq.lane.o, inq.lane.d) : inq.subject, to: inq.from, mc: inq.mc, source: TR.sourceOf(inq, load), load: load.uid, edited: dirty, ok } }).catch(() => {});
      return ok;
    };
    $('[data-reply]').onclick = doReply;
    host._reply = doReply;

    // ---- edit / enter a load ----
    const F = k => root.querySelector(`[data-f="${k}"]`);
    function openEditor(isNew) {
      $('[data-ed]').classList.remove('hide');
      const l = load || {};
      const src = TR.sourceOf(inq, l);
      const H = l.hours ? ((src === 'truckstop' ? [l.hours.ts, l.hours.dat] : [l.hours.dat, l.hours.ts]).find(h => h && (h.pu || h.del)) || {}) : {};
      F('pu').value = H.pu || ''; F('del').value = H.del || '';
      F('weight').value = l.weight || ''; F('length').value = l.length || ''; F('commodity').value = l.commodity || ''; F('rate').value = l.rate || '';
      F('equipmentName').value = l.equipmentName || (inq.equipment || ''); F('notes').value = [l.notes, (l.options || []).join(', ')].filter(Boolean).join(', ');
      $('[data-ed]').dataset.isNew = isNew ? '1' : '';
      F(isNew ? 'pu' : 'rate').focus();
    }
    $('[data-edit]').onclick = () => openEditor(false);
    $('[data-cancel]').onclick = () => $('[data-ed]').classList.add('hide');
    $('[data-save]').onclick = async () => {
      const n = v => { const x = Number(String(v).replace(/[$,\s]/g, '')); return x > 0 ? x : null; };
      const pu = TR.hoursRange(F('pu').value) || F('pu').value.trim(), del = TR.hoursRange(F('del').value) || F('del').value.trim();
      const eqn = F('equipmentName').value.trim();
      const edit = { weight: n(F('weight').value), length: n(F('length').value), commodity: F('commodity').value.trim(), rate: n(F('rate').value), equipmentName: eqn,
        equipment: /van/i.test(eqn) ? 'van' : /hot/i.test(eqn) ? 'hotshot' : /step/i.test(eqn) ? 'stepdeck' : /flat/i.test(eqn) ? 'flatbed' : (load && load.equipment) || '',
        notes: F('notes').value.trim(), options: [], hours: { dat: { pu, del }, ts: { pu, del } } };
      if ($('[data-ed]').dataset.isNew || !load) {
        if (!inq.lane) { msg('No lane in this email to save it under', true); return; }
        const L = Object.assign({ origin: inq.lane.o, dest: inq.lane.d, pickupDate: inq.date || '', picks: [], drops: [], boards: inq.source === 'dat' || inq.source === 'truckstop' ? [inq.source] : [] }, edit);
        const r = await chrome.runtime.sendMessage({ type: 'SAVE_LOAD', load: L }).catch(() => null);
        if (r && r.ok) { load = Object.assign(L, { uid: r.uid, src: 'manual' }); }
      } else {
        await chrome.runtime.sendMessage({ type: 'SAVE_EDIT', uid: load.uid, edit }).catch(() => null);
        load = Object.assign({}, load, edit);
      }
      $('[data-ed]').classList.add('hide');
      host._load = load; render(); msg('Saved');
    };
  }

  // ---------- watching Outlook ----------
  const hashOf = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
  let busy = false;
  async function scan() {
    if (!alive()) { stop(); return; }
    for (const body of bodies()) {
      const text = body.innerText || '';
      if (text.length < 3) continue;
      const subject = subjectFor(body), from = senderFor(body);
      const k = hashOf(subject + '|' + from.email + '|' + text.slice(0, 600)) + ':' + bookGen;
      const existing = body.previousElementSibling && body.previousElementSibling.nodeName === 'TRUCKR-BAR' ? body.previousElementSibling : null;
      if (existing && (existing.dataset.k === k || existing._dismissed || existing._busy)) continue; // never redraw while you're typing in it
      if (!from.email && !existing) { setTimeout(kick, 600); } // the From line may still be loading
      const inq = TR.parseInquiry({ subject, from, body: text }, { customers: CUSTOMERS });
      inq.body = text;
      if (inq.skip) { if (existing) existing.remove(); continue; }
      const m = TR.match(inq, BOOK);
      if (!inq.lane && !m.ranked.length) { if (existing) existing.remove(); continue; } // not about a load
      const host = existing || document.createElement('truckr-bar');
      host.dataset.k = k;
      if (!existing) body.parentElement.insertBefore(host, body);
      mount(host, { inq, m, body, load: m.best });
      // nothing matched yet: your posts may have changed since the last sync — pull them once and look again
      if (!m.best && !host._synced) { host._synced = true; chrome.runtime.sendMessage({ type: 'SYNC', mode: 'full' }).catch(() => {}); }
    }
  }
  let t = null;
  const kick = () => { clearTimeout(t); t = setTimeout(async () => { if (document.hidden) return; if (busy) { kick(); return; } busy = true; try { await scan(); } catch (e) { /* never break Outlook */ } busy = false; }, 120); };
  const obs = new MutationObserver(recs => {
    for (const r of recs) {
      const tg = r.target;
      if (tg.nodeName === 'TRUCKR-BAR' || tg.isContentEditable) continue;
      if ([...r.addedNodes].some(n => n.nodeName === 'TRUCKR-BAR')) continue;
      if (r.addedNodes.length || r.removedNodes.length) { kick(); return; }
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  function stop() { obs.disconnect(); try { chrome.storage.onChanged.removeListener(onStore); } catch (e) { /* */ } }
  window.__truckrOutlook = { stop };

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === 'REPLY_OPEN') {
      const bars = [...document.querySelectorAll('truckr-bar')].filter(b => b.style.display !== 'none' && vis(b));
      const b = bars.sort((a, c) => Math.abs(a.getBoundingClientRect().top) - Math.abs(c.getBoundingClientRect().top))[0];
      if (b && b._reply) { b._reply().then(ok => respond({ ok })); return true; }
      respond({ ok: false });
    }
  });
  loadBook().then(kick);
})();
