(async function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ver = chrome.runtime.getManifest().version;
  const inTab = location.hash === '#setup' || location.hash === '#accounts';
  if (inTab) document.body.style.margin = '0 auto';
  $('ver').textContent = 'v' + ver;
  const updMsg = (t, html) => { $('updMsg').style.display = 'block'; if (html) $('updMsg').innerHTML = t; else $('updMsg').textContent = t; };
  const { justUpdated } = await chrome.storage.local.get('justUpdated');
  if (justUpdated && Date.now() - justUpdated.at < 3 * 864e5) updMsg(`Updated to v${justUpdated.to} (was v${justUpdated.from}).`);
  const openUpdater = () => chrome.tabs.create({ url: chrome.runtime.getURL('update.html') });

  // ---------- updates: from GitHub, written into your TRUCKR CoWork folder, one click ----------
  $('upd').onclick = async () => {
    $('upd').disabled = true; updMsg('Checking for updates…');
    const r = await chrome.runtime.sendMessage({ type: 'CHECK_UPDATE' }).catch(() => null);
    $('upd').disabled = false;
    const rules = r && r.rules ? ' Reply rules refreshed.' : '';
    if (!r) updMsg('Could not check right now.');
    else if (r.status === 'update_available') updMsg(`Switching to v${r.version}… reopen this window in a second.`);
    else if (r.status === 'github_newer') { updMsg(`v${esc(r.version)} is ready. <button id="go">Update now</button>${esc(rules)}`, true); $('go').onclick = openUpdater; }
    else updMsg(`You're up to date (v${ver}).${rules}`);
  };
  chrome.runtime.sendMessage({ type: 'GH_VERSION' }).then(r => {
    if (!r || !r.version) return;
    const a = r.version.split('.').map(Number), b = ver.split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) { if ((a[i] || 0) > (b[i] || 0)) { updMsg(`TRUCKR CoWork v${esc(r.version)} is ready. <button id="go">Update now</button>`, true); $('go').onclick = openUpdater; } return; } }
  }).catch(() => {});

  // ---------- connected status ----------
  function showStatus(st) {
    const p = [];
    if (!st) p.push('<span class="pill">Not synced yet</span>');
    else {
      [['dat', 'DAT'], ['truckstop', 'Truckstop']].forEach(([k, name]) => {
        const v = (st.live || {})[k];
        if (!v) return;
        p.push(v.ok ? `<span class="pill ok">${name}: ${v.n} posted${v.cached ? ' (recent)' : ''}</span>` : `<span class="pill bad" title="${esc(v.error)}">${name}: ${esc(/sign|not checked|stale/i.test(v.error) ? 'sign in (Settings → Accounts)' : v.error)}</span>`);
      });
      if (st.sf) p.push(st.sf.ok ? `<span class="pill ok">Salesforce: ${st.sf.n} loads</span>` : `<span class="pill bad" title="${esc(st.sf.error)}">Salesforce: ${esc(/open salesforce|sign-in/i.test(st.sf.error) ? 'sign in (Settings → Accounts)' : st.sf.error)}</span>`);
      if (st.spotr) p.push(`<span class="pill ok">SPOTR v${esc(st.spotr)}</span>`);
      p.push(`<span class="pill">synced ${esc(new Date(st.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span>`);
    }
    $('stat').innerHTML = p.join('');
  }
  const r0 = await chrome.runtime.sendMessage({ type: 'GET_BOOK', maxAge: 60000 }).catch(() => null);
  if (r0) showStatus(r0.status);
  let S = Object.assign({}, TR.DEFAULTS, (r0 && r0.settings) || {});

  // ---------- views + tabs ----------
  const show = settings => { $('vMain').hidden = settings; $('vSettings').hidden = !settings; $('gear').style.visibility = settings ? 'hidden' : 'visible'; };
  const tab = name => { document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === name)); $('tAccounts').hidden = name !== 'accounts'; $('tReply').hidden = name !== 'reply'; if (name === 'accounts') loadAccounts(false); };
  document.querySelectorAll('.tab').forEach(b => { b.onclick = () => tab(b.dataset.tab); });
  $('gear').onclick = () => { fill(S); $('saved').textContent = ''; show(true); tab(S.myEmail ? 'reply' : 'accounts'); };
  $('back').onclick = () => { if (inTab) window.close(); show(false); };

  // ---------- Reply settings ----------
  const fill = v => {
    $('greeting').value = v.greeting; $('puHours').value = v.puHours; $('delHours').value = v.delHours; $('coveredText').value = v.coveredText || '';
    ['showDates', 'noTarpLine', 'replyAll', 'showEquipment', 'showTemp', 'showPieces', 'showRef'].forEach(k => { $(k).checked = !!v[k]; });
  };
  fill(S);
  $('save').onclick = async () => {
    const s = { greeting: $('greeting').value, puHours: TR.hoursRange($('puHours').value) || TR.DEFAULTS.puHours, delHours: TR.hoursRange($('delHours').value) || TR.DEFAULTS.delHours,
      coveredText: $('coveredText').value.trim() || TR.DEFAULTS.coveredText, datesOn: true };
    ['showDates', 'noTarpLine', 'replyAll', 'showEquipment', 'showTemp', 'showPieces', 'showRef'].forEach(k => { s[k] = $(k).checked; });
    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: s });
    S = Object.assign({}, S, s); fill(S);
    $('saved').textContent = 'Saved'; setTimeout(() => { $('saved').textContent = ''; }, 2000);
  };
  $('reset').onclick = () => { fill(Object.assign({}, TR.DEFAULTS, { myName: S.myName, myEmail: S.myEmail })); $('saved').textContent = 'Defaults filled in. Click Save to keep them.'; };

  // ---------- Accounts: YOUR DAT One, Truckstop and Salesforce ----------
  const SIGNIN = { dat: 'https://one.dat.com/', truckstop: 'https://main.truckstop.com/', salesforce: '' };
  const NAMES = { dat: 'DAT One', truckstop: 'Truckstop', salesforce: 'Salesforce' };
  let A = { accounts: {}, settings: S, spotr: null };
  const same = (who) => {
    const me = String($('myEmail').value || S.myEmail || '').toLowerCase(), myName = String($('myName').value || S.myName || '').toLowerCase().trim();
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
    const warn = a.ok && mine === false ? `<div class="warn">This is not your account. Sign out of ${NAMES[k]} in Chrome and sign in as yourself, or TRUCKR CoWork will answer from someone else's loads.</div>` : '';
    const extra = k === 'truckstop' ? `<label class="chk"><input type="checkbox" data-opt="tsOnlyMine" ${st.tsOnlyMine !== false ? 'checked' : ''}> Only loads I posted (for a shared company Truckstop account)</label>`
      : k === 'salesforce' ? `<label class="chk" style="flex-direction:column;align-items:stretch;gap:3px;color:var(--muted);font-size:11px">Salesforce address (only if you use more than one)<input type="text" data-opt="sfHost" value="${esc(st.sfHost || '')}" placeholder="yourcompany.my.salesforce.com"></label>` : '';
    return `<div class="acct" data-k="${k}">
      <div class="h"><span class="dot ${dot}"></span><b>${NAMES[k]}</b><span class="sp"></span><label class="chk"><input type="checkbox" data-use="${k}" ${use ? 'checked' : ''}> Use</label></div>
      <div class="who">${use ? whoTxt : '<span class="muted">Not used.</span>'}</div>${use ? warn : ''}
      ${use ? `<div class="btns"><button class="ghost" data-signin="${k}">${a.ok ? 'Switch account' : 'Sign in'}</button><button class="ghost" data-recheck="${k}">Check again</button></div>${extra}` : ''}
    </div>`;
  }
  function renderAccounts() {
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#accts')) return; // don't redraw under your cursor
    const sp = A.spotr ? `<div class="acct"><div class="h"><span class="dot ok"></span><b>${esc(A.spotr.name)} v${esc(A.spotr.version)}</b></div><div class="who muted">Connected: loads it posted for you add the details from the customer's email.</div></div>`
      : `<div class="acct"><div class="h"><span class="dot"></span><b>SPOTR CoWork</b><span class="sp"></span><span class="muted">optional</span></div><div class="who muted">Not installed. Not needed: TRUCKR CoWork reads DAT, Truckstop and Salesforce on its own.</div></div>`;
    $('accts').innerHTML = ['dat', 'truckstop', 'salesforce'].map(card).join('') + sp;
    $('accts').querySelectorAll('[data-signin]').forEach(b => { b.onclick = () => {
      const k = b.dataset.signin; const host = String(A.settings.sfHost || (A.accounts.salesforce || {}).host || '').replace(/^https?:\/\//, '');
      const url = k === 'salesforce' ? (host ? `https://${host}/` : 'https://login.salesforce.com/') : SIGNIN[k];
      chrome.tabs.create({ url });
      $('acctMsg').textContent = `${NAMES[k]} opened in a new tab. ${(A.accounts[k] || {}).ok ? 'Sign out there, sign in as yourself, then' : 'Sign in there, then'} come back: TRUCKR CoWork picks it up on its own.`;
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
    if (r) { A = r; S = Object.assign({}, S, r.settings); if (!$('myName').matches(':focus')) $('myName').value = S.myName || ''; if (!$('myEmail').matches(':focus')) $('myEmail').value = S.myEmail || ''; $('hiddenPage').checked = S.hiddenPage !== false; }
    renderAccounts();
    if (check) $('acctMsg').textContent = 'Checked.';
  }
  $('checkAll').onclick = () => loadAccounts(true);
  $('saveAcct').onclick = async () => { await saveAcct({ myName: $('myName').value.trim(), myEmail: $('myEmail').value.trim().toLowerCase(), hiddenPage: $('hiddenPage').checked }); renderAccounts(); };
  $('hiddenPage').onchange = () => saveAcct({ hiddenPage: $('hiddenPage').checked });
  chrome.storage.onChanged.addListener(async ch => {
    if (ch.accounts) { A.accounts = ch.accounts.newValue || {}; const { settings } = await chrome.storage.local.get('settings'); if (settings) { A.settings = Object.assign({}, A.settings, settings); if (!$('myEmail').value && settings.myEmail) { $('myEmail').value = settings.myEmail; $('myName').value = settings.myName || ''; } } if (!$('tAccounts').hidden) renderAccounts(); }
    if (ch.book || ch.bookStatus) { const { bookStatus } = await chrome.storage.local.get('bookStatus'); showStatus(bookStatus); }
  });

  // first run (or no name yet): straight to Accounts
  if (inTab || !S.myEmail) { show(true); tab('accounts'); if (location.hash === '#setup' || !S.myEmail) { $('setupNote').style.display = 'block'; loadAccounts(true); } }
  chrome.runtime.sendMessage({ type: 'SYNC', mode: 'light' }).catch(() => {});
})();
