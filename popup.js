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
      p.push(st.spotr ? `<span class="pill ok">SPOTR v${esc(st.spotr)}</span>` : `<span class="pill bad" title="${esc(st.error || '')}">SPOTR not connected (TRUCKR reads the boards itself)</span>`);
      [['dat', 'DAT'], ['truckstop', 'Truckstop']].forEach(([k, name]) => {
        const v = (st.live || {})[k];
        if (!v) return;
        if (v.ok) p.push(`<span class="pill ok" title="${esc(v.via ? 'read through ' + v.via : '')}">${name}: ${v.n} live${v.cached ? ' (recent)' : ''}</span>`);
        else if (st.mode !== 'full') p.push(`<span class="pill" title="${esc(v.error)}">${name}: signing back in…</span>`); // SPOTR's hidden page is taking care of it
        else p.push(`<a class="pill bad" href="#" data-open="${k}" title="${esc(v.error)}">${name}: sign in (click to open ${name})</a>`);
      });
      if (st.sf) p.push(st.sf.ok ? `<span class="pill ok">Salesforce: ${st.sf.n} loads${st.sfTeam ? ' + ' + st.sfTeam + ' teammates\'' : ''}</span>` : `<span class="pill bad" title="${esc(st.sf.error)}">Salesforce: ${esc(/open salesforce|sign-in/i.test(st.sf.error) ? 'open Salesforce in a tab' : st.sf.error)}</span>`);
      p.push(`<span class="pill">synced ${esc(new Date(st.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span>`);
    }
    $('stat').innerHTML = p.join('');
    $('stat').querySelectorAll('[data-open]').forEach(a => { a.onclick = e => { e.preventDefault(); chrome.tabs.create({ url: a.dataset.open === 'dat' ? 'https://one.dat.com/' : 'https://main.truckstop.com/' }); }; });
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
  const tab = name => { document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === name)); $('tAccounts').hidden = name !== 'accounts'; $('tReply').hidden = name !== 'reply'; if (name === 'accounts') loadAccounts(false); };
  document.querySelectorAll('.tab').forEach(b => { b.onclick = () => tab(b.dataset.tab); });
  $('gear').onclick = () => { fill(S); $('saved').textContent = ''; show(true); tab('reply'); };
  $('back').onclick = () => show(false);
  // ---------- Accounts: YOUR DAT One, Truckstop and Salesforce ----------
  const SIGNIN = { dat: 'https://one.dat.com/', truckstop: 'https://main.truckstop.com/', salesforce: '' };
  const NAMES = { dat: 'DAT One', truckstop: 'Truckstop', salesforce: 'Salesforce' };
  let A = { accounts: {}, settings: S, spotr: null };
  const same = (who) => {
    const me = String(S.myEmail || '').toLowerCase(), myName = String(S.myName || '').toLowerCase().trim();
    if (!who || (!who.email && !who.name)) return null;
    if (me && who.email) return who.email.toLowerCase() === me || who.email.split('@')[0].toLowerCase() === me.split('@')[0];
    if (myName && who.name) return who.name.toLowerCase().includes(myName.split(' ')[0]) && who.name.toLowerCase().includes(myName.split(' ').slice(-1)[0]);
    return null;
  };
  function card(k) {
    const a = A.accounts[k] || {}, st = A.settings, use = k === 'dat' ? st.useDat !== false : k === 'truckstop' ? st.useTruckstop !== false : st.useSalesforce !== false;
    const who = a.who || {}, mine = same(who);
    const dot = !use ? '' : a.ok ? (mine === false ? 'mid' : 'ok') : a.error ? 'bad' : '';
    const whoTxt = a.ok ? `Signed in${who.name || who.email ? ' as <b>' + esc(who.name || '') + '</b>' + (who.email ? ' · ' + esc(who.email) : '') : ''}${k === 'salesforce' && a.host ? ' · ' + esc(a.host) : ''}${a.at ? ' <span class="muted">(checked ' + esc(new Date(a.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + ')</span>' : ''}`
      : a.error === 'signed out' ? 'Signed out. Sign in again.' : a.error ? 'Not signed in yet.' : 'Not checked yet.';
    const warn = a.ok && mine === false ? (k === 'truckstop' ? `<div class="warn">Signed in with ${esc(who.name || who.email)}'s login. Fine if that's the shared company account: TRUCKR still reads every post on it (yours and posts made "Post As" you). Otherwise switch to your own login.</div>`
      : `<div class="warn">This is not your account. Sign out of ${NAMES[k]} in Chrome and sign in as yourself, or TRUCKR will answer from someone else's loads.</div>`) : '';
    const extra = k === 'truckstop' ? `<label class="chk"><input type="checkbox" data-opt="tsOnlyMine" ${st.tsOnlyMine !== false ? 'checked' : ''}> Only loads I posted (off: teammates' posts on the shared Truckstop account count too, yours win a tie)</label>`
      : k === 'salesforce' ? `<label class="chk" style="flex-direction:column;align-items:stretch;gap:3px;color:var(--muted);font-size:11px">Salesforce address (only if you use more than one)<input type="text" data-opt="sfHost" value="${esc(st.sfHost || '')}" placeholder="yourcompany.my.salesforce.com"></label>` : '';
    return `<div class="acct" data-k="${k}">
      <div class="h"><span class="dot ${dot}"></span><b>${NAMES[k]}</b><span class="sp"></span><label class="chk"><input type="checkbox" data-use="${k}" ${use ? 'checked' : ''}> Use</label></div>
      <div class="who">${use ? whoTxt : '<span class="muted">Not used.</span>'}</div>${use ? warn : ''}
      ${use ? `<div class="btns"><button class="ghost" data-signin="${k}">${a.ok ? 'Switch account' : 'Sign in'}</button><button class="ghost" data-recheck="${k}">Check again</button></div>${extra}` : ''}
    </div>`;
  }
  function renderAccounts() {
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#accts')) return; // don't redraw under your cursor
    const sp = A.spotr ? `<div class="acct"><div class="h"><span class="dot ok"></span><b>${esc(A.spotr.name)} v${esc(A.spotr.version)}</b></div><div class="who muted">Connected: its posting records add the customer's email details.</div></div>`
      : `<div class="acct"><div class="h"><span class="dot bad"></span><b>SPOTR</b></div><div class="who muted">Not found: turn SPOTR on in chrome://extensions. TRUCKR keeps answering from its own DAT, Truckstop and Salesforce reads meanwhile.</div></div>`;
    $('accts').innerHTML = ['dat', 'truckstop', 'salesforce'].map(card).join('') + sp;
    $('accts').querySelectorAll('[data-signin]').forEach(b => { b.onclick = () => {
      const k = b.dataset.signin; const host = String(A.settings.sfHost || (A.accounts.salesforce || {}).host || '').replace(/^https?:\/\//, '');
      const url = k === 'salesforce' ? (host ? `https://${host}/` : 'https://login.salesforce.com/') : SIGNIN[k];
      chrome.tabs.create({ url });
      $('acctMsg').textContent = `${NAMES[k]} opened in a new tab. ${(A.accounts[k] || {}).ok ? 'Sign out there, sign in as yourself, then' : 'Sign in there, then'} come back: TRUCKR picks it up on its own.`;
    }; });
    $('accts').querySelectorAll('[data-recheck]').forEach(b => { b.onclick = () => loadAccounts(true, b.dataset.recheck); });
    $('accts').querySelectorAll('[data-use]').forEach(c => { c.onchange = async () => { const k = c.dataset.use; const key = k === 'dat' ? 'useDat' : k === 'truckstop' ? 'useTruckstop' : 'useSalesforce'; await saveAcct({ [key]: c.checked }); renderAccounts(); }; });
    $('accts').querySelectorAll('[data-opt]').forEach(c => { c.onchange = () => saveAcct({ [c.dataset.opt]: c.type === 'checkbox' ? c.checked : c.value.trim() }, true); });
  }
  async function saveAcct(part, resync) {
    A.settings = Object.assign({}, A.settings, part); S = Object.assign({}, S, part);
    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: part, resync: !!resync });
    $('acctMsg').textContent = 'Saved';
  }
  async function loadAccounts(check, forget) {
    if (check) $('acctMsg').textContent = 'Checking your sign-ins…';
    const r = await chrome.runtime.sendMessage({ type: 'ACCOUNTS', check: !!check, forget: forget || '' }).catch(() => null);
    if (r) { A = r; S = Object.assign({}, S, r.settings); $('sfTeam').checked = S.sfTeam !== false; $('hiddenPage').checked = S.hiddenPage !== false; }
    renderAccounts();
    if (check) $('acctMsg').textContent = 'Checked.';
  }
  $('checkAll').onclick = () => loadAccounts(true);
  $('hiddenPage').onchange = () => saveAcct({ hiddenPage: $('hiddenPage').checked });
  chrome.storage.onChanged.addListener(async ch => {
    if (ch.accounts) { A.accounts = ch.accounts.newValue || {}; const { settings } = await chrome.storage.local.get('settings'); if (settings) A.settings = Object.assign({}, A.settings, settings); if (!$('tAccounts').hidden) renderAccounts(); }
  });

  $('sfTeam').onchange = () => saveAcct({ sfTeam: $('sfTeam').checked }, true);


  // fresh numbers every time the popup opens (no button): sync in the background, the list updates when it lands
  { const bad = r0 && r0.status && Object.values(r0.status.live || {}).some(v => !v.ok); chrome.runtime.sendMessage({ type: 'SYNC', mode: bad ? 'full' : 'light' }).catch(() => {}); }
  chrome.storage.onChanged.addListener(async ch => {
    if (!ch.book && !ch.bookStatus) return;
    const { book = [], bookStatus } = await chrome.storage.local.get(['book', 'bookStatus']);
    showStatus(bookStatus, book.length);
  });
  $('save').onclick = async () => {
    const s = { greeting: $('greeting').value, puHours: TR.hoursRange($('puHours').value) || TR.DEFAULTS.puHours, delHours: TR.hoursRange($('delHours').value) || TR.DEFAULTS.delHours,
      coveredText: $('coveredText').value.trim() || TR.DEFAULTS.coveredText,
      showDates: $('showDates').checked, datesOn: true, noTarpLine: $('noTarpLine').checked, replyAll: $('replyAll').checked };
    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: s });
    S = Object.assign({}, TR.DEFAULTS, s); fill(S);
    $('saved').textContent = 'Saved'; setTimeout(() => { $('saved').textContent = ''; }, 2000);
  };
  $('reset').onclick = () => { fill(TR.DEFAULTS); $('saved').textContent = 'Defaults filled in. Click Save to keep them.'; };
})();
