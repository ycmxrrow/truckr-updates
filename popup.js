(async function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ver = chrome.runtime.getManifest().version;
  $('ver').textContent = 'v' + ver;
  const updMsg = t => { $('updMsg').style.display = 'block'; $('updMsg').textContent = t; };
  const { justUpdated } = await chrome.storage.local.get('justUpdated');
  if (justUpdated && Date.now() - justUpdated.at < 3 * 864e5) updMsg(`Updated to v${justUpdated.to} (was v${justUpdated.from}).`);

  $('upd').onclick = async () => {
    $('upd').disabled = true; updMsg('Checking for updates…');
    let r = await chrome.runtime.sendMessage({ type: 'CHECK_UPDATE' });
    for (let i = 0; i < 20 && r && r.status === 'syncing'; i++) { updMsg(`Getting v${r.version} ready…`); await new Promise(res => setTimeout(res, 1000)); r = await chrome.runtime.sendMessage({ type: 'CHECK_UPDATE' }); }
    $('upd').disabled = false;
    const rules = r && r.rules ? ' Reply rules refreshed from GitHub.' : '';
    if (!r) updMsg('Could not check right now.');
    else if (r.status === 'update_available') updMsg(`Installing v${r.version}… done in a second. Reopen this window to see it.`);
    else if (r.status === 'github_newer') updMsg(`v${r.version} is on GitHub but not in your TRUCKR folder yet. Ask Claude to install it, then click again.${rules}`);
    else if (r.status === 'syncing') updMsg(`v${r.version} isn't fully copied yet. Click again in a moment.`);
    else updMsg(`You're up to date (v${ver}).${rules}`);
  };

  function showStatus(st, n) {
    const p = [];
    if (!st) p.push('<span class="pill">Not synced yet</span>');
    else {
      p.push(st.spotr ? `<span class="pill ok">SPOTR v${esc(st.spotr)}</span>` : `<span class="pill bad">${esc(st.error || 'SPOTR not connected')}</span>`);
      [['dat', 'DAT'], ['truckstop', 'Truckstop']].forEach(([k, name]) => {
        const v = (st.live || {})[k];
        if (!v) return;
        p.push(v.ok ? `<span class="pill ok">${name}: ${v.n} live${v.cached ? ' (recent)' : ''}</span>` : `<span class="pill bad" title="${esc(v.error)}">${name}: ${esc(/sign/i.test(v.error) ? 'open ' + name + ' in a tab to sign in' : v.error)}</span>`);
      });
      if (st.sf) p.push(st.sf.ok ? `<span class="pill ok">Salesforce: ${st.sf.n} loads</span>` : `<span class="pill bad" title="${esc(st.sf.error)}">Salesforce: ${esc(/open salesforce|sign-in/i.test(st.sf.error) ? 'open Salesforce in a tab' : st.sf.error)}</span>`);
      p.push(`<span class="pill">synced ${esc(new Date(st.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span>`);
    }
    $('stat').innerHTML = p.join('');
      }


  const r0 = await chrome.runtime.sendMessage({ type: 'GET_BOOK', maxAge: 60000 });
  if (r0) { showStatus(r0.status, (r0.book || []).length); }
  let S = Object.assign({}, TR.DEFAULTS, (r0 && r0.settings) || {});
  const fill = v => {
    $('greeting').value = v.greeting; $('puHours').value = v.puHours; $('delHours').value = v.delHours; $('coveredText').value = v.coveredText || '';
    $('showDates').checked = !!v.showDates; $('noTarpLine').checked = !!v.noTarpLine; $('replyAll').checked = !!v.replyAll;
  };
  fill(S);
  const show = settings => { $('vMain').hidden = settings; $('vSettings').hidden = !settings; $('gear').style.visibility = settings ? 'hidden' : 'visible'; };
  $('gear').onclick = () => { fill(S); $('saved').textContent = ''; show(true); };
  $('back').onclick = () => show(false);

  // fresh numbers every time the popup opens (no button): sync in the background, the list updates when it lands
  chrome.runtime.sendMessage({ type: 'SYNC', mode: 'light' }).catch(() => {});
  chrome.storage.onChanged.addListener(async ch => {
    if (!ch.book && !ch.bookStatus) return;
    const { book = [], bookStatus } = await chrome.storage.local.get(['book', 'bookStatus']);
    showStatus(bookStatus, book.length);
  });
  $('save').onclick = async () => {
    const s = { greeting: $('greeting').value, puHours: TR.hoursRange($('puHours').value) || TR.DEFAULTS.puHours, delHours: TR.hoursRange($('delHours').value) || TR.DEFAULTS.delHours,
      coveredText: $('coveredText').value.trim() || TR.DEFAULTS.coveredText,
      showDates: $('showDates').checked, noTarpLine: $('noTarpLine').checked, replyAll: $('replyAll').checked };
    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: s });
    S = Object.assign({}, TR.DEFAULTS, s); fill(S);
    $('saved').textContent = 'Saved'; setTimeout(() => { $('saved').textContent = ''; }, 2000);
  };
  $('reset').onclick = () => { fill(TR.DEFAULTS); $('saved').textContent = 'Defaults filled in. Click Save to keep them.'; };
  const { replies = [] } = await chrome.storage.local.get('replies');
  $('recent').innerHTML = replies.slice(0, 8).map(r => `<div>${esc(new Date(r.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} · ${esc(r.lane)} · ${esc(r.to)}${r.mc ? ' · MC ' + esc(r.mc) : ''}${r.ok ? '' : ' · (copied)'}</div>`).join('') || 'None yet.';
})();
