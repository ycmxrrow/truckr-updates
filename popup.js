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
    $('n').textContent = n;
  }
  function showBook(book) {
    $('rows').innerHTML = (book || []).map(l => `<tr><td>${esc(TR.laneText(l.origin, l.dest))}${l.picks && l.picks.length + l.drops.length > 2 ? ` <span class="muted">(${l.picks.length}PU ${l.drops.length}DEL)</span>` : ''}<div class="muted">${esc(l.customer || (l.src === 'manual' ? 'saved by you' : ''))}${l.sf ? ` · <span style="color:${l.covered || l.cancelled ? '#ff6b6b' : '#7fdc98'}">${esc(l.sf.name)} ${esc(l.sf.status)}</span>` : ''}${(l.checks || []).filter(c => c.k !== 'status').length ? ' · <span style="color:#ffd257">check ' + esc(l.checks.filter(c => c.k !== 'status').map(c => c.k).join(', ')) + '</span>' : ''}${l.down ? ' · not on the boards now' : ''}</div></td>
      <td>${esc(TR.md(l.pickupDate))}</td><td>${esc(l.equipmentName || l.equipment || '')}</td>
      <td>${l.weight ? Math.round(l.weight).toLocaleString() : '—'} / ${l.length ? Math.round(l.length) + "'" : '—'}</td><td>${l.rate ? esc(TR.money(l.rate)) : '<span style="color:#ff6b6b">none</span>'}</td>
      <td>${esc((l.boards || []).map(b => b === 'dat' ? 'DAT' : 'TS').join('+') || (l.src === 'salesforce' ? 'SF only' : '—'))}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No loads yet. Post with SPOTR, or click Sync with DAT / Truckstop open in a tab.</td></tr>';
  }

  const r0 = await chrome.runtime.sendMessage({ type: 'GET_BOOK', maxAge: 60000 });
  if (r0) { showStatus(r0.status, (r0.book || []).length); showBook(r0.book); }
  const S = Object.assign({}, TR.DEFAULTS, (r0 && r0.settings) || {});
  $('greeting').value = S.greeting; $('puHours').value = S.puHours; $('delHours').value = S.delHours;
  $('showDates').checked = !!S.showDates; $('noTarpLine').checked = !!S.noTarpLine; $('replyAll').checked = !!S.replyAll;

  $('sync').onclick = async () => {
    $('sync').disabled = true; $('syncMsg').textContent = 'Pulling your posts from DAT + Truckstop…';
    const r = await chrome.runtime.sendMessage({ type: 'SYNC', mode: 'full' });
    $('sync').disabled = false;
    $('syncMsg').textContent = r && r.ok ? `Done in ${(r.status.ms / 1000).toFixed(1)}s` : 'Sync failed: ' + ((r && r.error) || 'no answer');
    if (r) { showStatus(r.status, (r.book || []).length); showBook(r.book); }
  };
  $('save').onclick = async () => {
    const s = { greeting: $('greeting').value, puHours: TR.hoursRange($('puHours').value) || TR.DEFAULTS.puHours, delHours: TR.hoursRange($('delHours').value) || TR.DEFAULTS.delHours,
      showDates: $('showDates').checked, noTarpLine: $('noTarpLine').checked, replyAll: $('replyAll').checked };
    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: s });
    $('saved').textContent = 'Saved'; setTimeout(() => { $('saved').textContent = ''; }, 2000);
  };
  const { replies = [] } = await chrome.storage.local.get('replies');
  $('recent').innerHTML = replies.slice(0, 8).map(r => `<div>${esc(new Date(r.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} · ${esc(r.lane)} · ${esc(r.to)}${r.mc ? ' · MC ' + esc(r.mc) : ''}${r.ok ? '' : ' · (copied)'}</div>`).join('') || 'None yet.';
})();
