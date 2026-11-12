/* TRUCKR CoWork — background: keeps YOUR load book (your live DAT + Truckstop posts and your Salesforce loads) ready,
   so carrier replies are instant. Every person's copy reads their own DAT, Truckstop and Salesforce sign-ins. */
importScripts('lib/truckr.js', 'lib/boards.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const GH = 'https://raw.githubusercontent.com/ycmxrrow/truckr-updates/main/cowork/';
const RULES_URL = GH + 'rules.json', GH_BUILD_URL = GH + 'build.json';
const SITES = { dat: { label: 'DAT One', url: 'https://one.dat.com/my-shipments', host: /^https:\/\/one\.dat\.com\//i }, truckstop: { label: 'Truckstop', url: 'https://main.truckstop.com/app/loads/my-loads', host: /^https:\/\/(main|app)\.truckstop\.com\//i } };

async function getStore() {
  const s = await chrome.storage.local.get(['settings', 'manual', 'edits', 'book', 'bookAt', 'bookStatus', 'rules', 'spotrId', 'customers', 'lastLive', 'accounts']);
  s.settings = Object.assign({}, TR.DEFAULTS, ACCOUNT_DEFAULTS, s.settings || {});
  s.manual = s.manual || {}; s.edits = s.edits || {}; s.book = s.book || []; s.customers = s.customers || []; s.accounts = s.accounts || {};
  TR.setMe({ name: s.settings.myName, email: s.settings.myEmail });
  return s;
}
// account settings (Settings → Accounts)
const ACCOUNT_DEFAULTS = { useDat: true, useTruckstop: true, useSalesforce: true, tsOnlyMine: true, hiddenPage: true, sfHost: '', useSpotr: true };
async function setAccount(k, v) {
  const { accounts = {} } = await chrome.storage.local.get('accounts');
  accounts[k] = Object.assign({}, accounts[k], v, { at: Date.now() });
  await chrome.storage.local.set({ accounts });
  return accounts;
}

// ---------- DAT One + Truckstop: YOUR sign-in, borrowed from a board tab (or a hidden page for a moment) ----------
const tokWait = {};
async function cachedTok(site) { const { tok = {} } = await chrome.storage.session.get('tok'); const t = tok[site]; return t && (!t.exp || t.exp > Date.now() + 60000) ? t : null; }
async function saveTok(site, v) { const { tok = {} } = await chrome.storage.session.get('tok'); tok[site] = v; await chrome.storage.session.set({ tok }); }
async function forgetToken(site) { const { tok = {} } = await chrome.storage.session.get('tok'); delete tok[site]; await chrome.storage.session.set({ tok }); }
async function fromTabs(site) {
  for (const tb of (await chrome.tabs.query({})).filter(x => SITES[site].host.test(x.url || '') && !x.discarded)) {
    let r = null; try { r = await Promise.race([chrome.tabs.sendMessage(tb.id, { type: 'TRC_TOKEN', site }), sleep(16000).then(() => null)]); } catch (e) { r = null; }
    if (r && r.ok) return r;
    if (r && r.error === 'login') return r;
  }
  return null;
}
async function ensureOffscreen() {
  if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return;
  try { await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['DOM_SCRAPING'], justification: 'Read your DAT / Truckstop sign-in to list your posted loads, without opening tabs' }); }
  catch (e) { if (!/single offscreen|already/i.test(e.message)) throw e; }
  // let DAT / Truckstop load inside that hidden frame (only frames that aren't in any tab)
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [911], addRules: [{ id: 911, priority: 1,
    action: { type: 'modifyHeaders', responseHeaders: ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only'].map(h => ({ header: h, operation: 'remove' })) },
    condition: { resourceTypes: ['sub_frame'], requestDomains: ['truckstop.com', 'dat.com'], tabIds: [-1] } }] });
}
let offClose = null;
function closeOffscreenSoon() { clearTimeout(offClose); offClose = setTimeout(async () => { if (Object.keys(tokWait).length) return closeOffscreenSoon(); try { if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument(); } catch (e) { /* closed */ } }, 10000); }
async function offMsg(m) { for (let k = 0; k < 4; k++) { try { return await chrome.runtime.sendMessage(m); } catch (e) { if (!/receiving end|establish connection/i.test(e.message) || k === 3) throw e; await sleep(300); } } }

// mode 'light' = a sign-in already borrowed or a board tab you have open; 'full' may also load the board in the hidden page
async function boardToken(site, mode, force) {
  if (!force) { const c = await cachedTok(site); if (c) return c; }
  if (tokWait[site]) return tokWait[site];
  tokWait[site] = (async () => {
    const S = (await getStore()).settings;
    let r = await fromTabs(site);
    if (!(r && r.ok) && mode === 'full' && S.hiddenPage !== false && !(r && r.error === 'login')) {
      try { await ensureOffscreen(); r = await offMsg({ target: 'truckrc-offscreen', type: 'TOKEN', site, url: SITES[site].url, timeout: 30000 }); }
      catch (e) { r = { ok: false, error: e.message }; }
      offMsg({ target: 'truckrc-offscreen', type: 'DROP', site }).catch(() => {});
      closeOffscreenSoon();
    }
    if (!(r && r.ok)) {
      const meanwhile = await cachedTok(site); if (meanwhile) return meanwhile; // you signed in on a tab while this was checking
      const err = r && r.error === 'login' ? 'signed out' : mode === 'full' ? 'not signed in' : 'not checked yet';
      if (mode === 'full' || (r && r.error === 'login')) await setAccount(site, { ok: false, error: err });
      return { ok: false, error: err };
    }
    return adopt(site, r);
  })();
  try { return await tokWait[site]; } finally { delete tokWait[site]; }
}
async function adopt(site, r) {
  const v = { ok: true, jwt: r.jwt, tok: r.tok, user: r.user, exp: r.exp || 0, at: Date.now() };
  await saveTok(site, v);
  // whose account this is (shown in Settings → Accounts so everyone can check it's their own)
  try { const who = site === 'dat' ? await BOARDS.datWho(v.tok, v.user) : BOARDS.tsWho(v.jwt); await setAccount(site, { ok: true, error: '', who }); } catch (e) { await setAccount(site, { ok: true, error: '' }); }
  return v;
}
async function boardLive(site, mode) {
  const S = (await getStore()).settings;
  if (site === 'dat' && S.useDat === false) return null;
  if (site === 'truckstop' && S.useTruckstop === false) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await boardToken(site, mode, attempt > 0);
    if (!t.ok) return { ok: false, error: t.error };
    const r = await Promise.race([site === 'dat' ? BOARDS.datList(t.tok) : BOARDS.tsList(t.jwt, S.tsOnlyMine !== false), sleep(25000).then(() => ({ ok: false, error: 'timeout' }))]);
    if (r && r.error === 'stale') { await forgetToken(site); if (mode !== 'full') return { ok: false, error: 'sign-in expired' }; continue; }
    return r;
  }
  return { ok: false, error: 'sign-in' };
}

// ---------- SPOTR CoWork / SPOTR (optional): its posting records add full details from the customer's email ----------
async function spotrId(force) {
  const { spotrId: cached } = await chrome.storage.local.get('spotrId');
  if (cached && !force) return cached;
  try {
    const all = await chrome.management.getAll();
    const s = all.find(e => e.enabled && e.type === 'extension' && /^SPOTR CoWork$/i.test(e.name)) || all.find(e => e.enabled && e.type === 'extension' && /^SPOTR$/i.test(e.name));
    await chrome.storage.local.set({ spotrId: s ? s.id : '' });
    return s ? s.id : null;
  } catch (e) { return null; }
}
async function askSpotr(msg, timeout) {
  let id = await spotrId(false);
  for (let k = 0; k < 2; k++) {
    if (!id) { if (k === 0) { id = await spotrId(true); if (id) continue; } return { ok: false, error: 'none' }; }
    try {
      const r = await Promise.race([chrome.runtime.sendMessage(id, Object.assign({ app: 'TRUCKR' }, msg)), sleep(timeout || 15000).then(() => ({ ok: false, error: 'SPOTR took too long' }))]);
      return r || { ok: false, error: 'SPOTR needs an update' };
    } catch (e) { if (k === 0) { id = await spotrId(true); continue; } return { ok: false, error: e.message }; }
  }
  return { ok: false, error: 'SPOTR did not answer' };
}

// ---------- Salesforce: YOUR loads, with your normal Salesforce sign-in (read-only) ----------
const SF_API = 'v60.0';
async function sfSession() {
  const S = (await getStore()).settings;
  const all = await chrome.cookies.getAll({ name: 'sid' }).catch(() => []);
  let c = all.filter(x => /\.my\.salesforce\.com$/i.test(x.domain) && x.value);
  const want = String(S.sfHost || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (want) c = c.filter(x => x.domain.replace(/^\./, '').toLowerCase() === want);
  else { const prod = c.filter(x => !/--/.test(x.domain)); if (prod.length) c = prod; } // a sandbox only when you pick it
  c.sort((a, b) => (b.expirationDate || 0) - (a.expirationDate || 0));
  if (!c.length) return null;
  return { host: c[0].domain.replace(/^\./, ''), sid: c[0].value };
}
async function sfGet(sess, path) {
  const r = await fetch(`https://${sess.host}${path}`, { headers: { Authorization: 'Bearer ' + sess.sid, Accept: 'application/json' } });
  if (r.status === 401) { const e = new Error('Salesforce sign-in expired. Open Salesforce in a tab.'); e.code = 'login'; throw e; }
  if (!r.ok) throw new Error('Salesforce ' + r.status + ' ' + (await r.text()).slice(0, 160));
  return r.json();
}
const SF_FIELDS = 'Id, Name, rtms__Load_Status__c, Origin_City__c, Origin_State__c, Destination_City__c, Destination_State__c, rtms__Expected_Ship_Date2__c, rtms__Expected_Delivery_Date2__c, rtms__Total_Weight__c, Length__c, rtms__Linear_Feet__c, rtms__Cargo_Summary__c, rtms__Load_Posting_Description__c, rtms__Offer_Rate__c, rtms__Max_Pay_Amount__c, Equipment_Type_Read_Only__c, Partial_Load__c, rtms__Team__c, rtms__Hazardous_Materials__c, OD__c, rtms__PO_Number__c, Temperature__c, rtms__Temperature_Controlled__c, rtms__Temperature_Run_Type__c, rtms__Temperature_Setting_Minimum__c, rtms__Customer__r.Name, LastModifiedDate, (SELECT rtms__Number__c, rtms__City_Index__c, rtms__State_Index__c, rtms__Is_Pickup__c, rtms__Expected_Date__c, rtms__Shipping_Receiving_Hours__c, rtms__Appointment_Time__c FROM rtms__Stops__r ORDER BY rtms__Number__c)';
let sfMe = null;
async function sfLoads() {
  const S = (await getStore()).settings;
  if (S.useSalesforce === false) return null;
  const sess = await sfSession();
  if (!sess) { await setAccount('salesforce', { ok: false, error: 'not signed in' }); return { ok: false, error: 'Open Salesforce in a Chrome tab (signed in) so TRUCKR CoWork can read your loads' }; }
  try {
    if (!sfMe || sfMe.host !== sess.host || sfMe.sid !== sess.sid) {
      const me = await sfGet(sess, `/services/data/${SF_API}/chatter/users/me`);
      let email = me.email || '';
      if (!email) { try { const u = await sfGet(sess, `/services/data/${SF_API}/query?q=${encodeURIComponent(`SELECT Email FROM User WHERE Id = '${me.id}'`)}`); email = (u.records && u.records[0] && u.records[0].Email) || ''; } catch (e) { /* */ } }
      sfMe = { host: sess.host, sid: sess.sid, id: me.id, name: me.name || me.displayName || '', email: String(email).toLowerCase() };
      await setAccount('salesforce', { ok: true, error: '', who: { name: sfMe.name, email: sfMe.email, id: sfMe.id }, host: sess.host });
      // first time: TRUCKR CoWork takes your name and email from Salesforce (you can change them in Settings)
      const { settings = {} } = await chrome.storage.local.get('settings');
      if (!settings.myEmail && sfMe.email) await chrome.storage.local.set({ settings: Object.assign({}, TR.DEFAULTS, ACCOUNT_DEFAULTS, settings, { myEmail: sfMe.email, myName: settings.myName || sfMe.name }) });
    }
    const id = sfMe.id;
    const who = ['CreatedById', 'rtms__Customer_Sales_Rep__c', 'Client_Operations_Rep__c', 'Assigned_Carrier_Sales__c', 'rtms__Carrier_Sales_Rep__c'].map(f => `${f} = '${id}'`).join(' OR ');
    const q = `SELECT ${SF_FIELDS} FROM rtms__Load__c WHERE rtms__Expected_Ship_Date2__c >= LAST_N_DAYS:4 AND (${who}) ORDER BY CreatedDate DESC LIMIT 200`;
    let j = await sfGet(sess, `/services/data/${SF_API}/query?q=${encodeURIComponent(q)}`); const loads = j.records || [];
    while (j.nextRecordsUrl && loads.length < 400) { j = await sfGet(sess, j.nextRecordsUrl); loads.push(...(j.records || [])); }
    return { ok: true, host: sess.host, loads };
  } catch (e) {
    if (e.code === 'login') { sfMe = null; await setAccount('salesforce', { ok: false, error: 'signed out' }); }
    return { ok: false, error: e.message };
  }
}

// ---------- one sync: your boards + Salesforce (+ SPOTR's records if you use it) -> the load book ----------
let syncing = null, lastFull = 0;
async function sync(mode) {
  if (syncing) return syncing;
  syncing = (async () => {
    const t0 = Date.now();
    const st0 = await getStore();
    const live = mode === 'none' ? null : (mode || 'light');
    const [sp, dat, ts, sf] = await Promise.all([
      st0.settings.useSpotr !== false ? askSpotr({ type: 'TRUCKR_LOADS', live: false }) : Promise.resolve({ ok: false, error: 'off' }),
      live ? boardLive('dat', live) : null, live ? boardLive('truckstop', live) : null, sfLoads()]);
    const st = await getStore();
    const r = { ok: true, posts: sp && sp.ok ? sp.posts || [] : [], equipment: (sp && sp.equipment) || [], options: (sp && sp.options) || [], customers: (sp && sp.customers) || [], live: {}, salesforce: sf };
    if (dat) r.live.dat = dat; if (ts) r.live.truckstop = ts;
    const status = { at: new Date().toISOString(), ms: 0, spotr: sp && sp.ok ? sp.version : null, spotrError: sp && !sp.ok ? sp.error : '', live: {}, sf: sf ? (sf.ok ? { ok: true, n: sf.loads.length } : { ok: false, error: sf.error || '' }) : null };
    Object.entries(r.live).forEach(([k, v]) => { status.live[k] = v && v.ok ? { ok: true, n: (v.loads || []).length } : { ok: false, error: (v && v.error) || 'no answer' }; });
    // keep the last good board list when a quick check couldn't reach a board this time
    if (st.lastLive) Object.keys(st.lastLive).forEach(k => { if (r.live[k] && !r.live[k].ok && st.lastLive[k] && Date.now() - st.lastLive[k].at < 30 * 60000) { r.live[k] = st.lastLive[k].v; status.live[k] = Object.assign({ cached: true }, status.live[k], { n: (st.lastLive[k].v.loads || []).length }); } });
    const keep = {}; Object.entries(r.live).forEach(([k, v]) => { if (v && v.ok && !(status.live[k] && status.live[k].cached)) keep[k] = { at: Date.now(), v }; });
    if (Object.keys(keep).length) { const { lastLive = {} } = await chrome.storage.local.get('lastLive'); await chrome.storage.local.set({ lastLive: Object.assign(lastLive, keep) }); }
    const book = TR.buildBook(r, st);
    const customers = [...new Set((r.posts || []).map(p => (p.senderEmail || '').toLowerCase()).concat(r.customers || []).filter(Boolean))];
    const sample = {}; Object.entries(r.live).forEach(([k, v]) => { if (v && v.loads && v.loads[0]) sample[k] = JSON.stringify(v.loads[0]).slice(0, 6000); });
    status.ms = Date.now() - t0; status.n = book.length;
    await chrome.storage.local.set({ book, bookAt: Date.now(), bookStatus: status, customers, boardSample: sample });
    if (mode === 'full') { lastFull = Date.now(); chrome.storage.session.set({ lastFull }).catch(() => {}); }
    return { ok: true, n: book.length, status };
  })();
  try { return await syncing; } finally { syncing = null; }
}

// ---------- reply rules + updates from GitHub (ycmxrrow/truckr-updates, folder cowork/) ----------
async function pullRules() {
  try {
    const r = await fetch(RULES_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return { ok: false, error: 'GitHub ' + r.status };
    const rules = await r.json();
    await chrome.storage.local.set({ rules, rulesAt: Date.now() });
    TR.setRules(rules);
    return { ok: true, rules };
  } catch (e) { return { ok: false, error: e.message }; }
}
async function githubVersion() { try { const r = await fetch(GH_BUILD_URL + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return null; return (await r.json()).version || null; } catch (e) { return null; } }
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 4; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
async function diskBuild() { const r = await fetch(chrome.runtime.getURL('build.json') + '?t=' + Date.now(), { cache: 'no-store' }); return r.json(); }
async function checkForUpdate() {
  const running = chrome.runtime.getManifest().version;
  const rules = await pullRules();
  // files already in your folder are newer (an update was just written, or you unzipped a new copy): switch over
  let build = null; try { build = await diskBuild(); } catch (e) { /* */ }
  if (build && cmpVer(build.version, running) > 0) { setTimeout(() => chrome.runtime.reload(), 250); return { status: 'update_available', version: build.version, rules: rules.ok }; }
  const gh = await githubVersion();
  if (gh && cmpVer(gh, running) > 0) return { status: 'github_newer', version: gh, rules: rules.ok };
  return { status: 'no_update', version: running, rules: rules.ok, rulesError: rules.ok ? '' : rules.error };
}

// ---------- messages from the Outlook bar, the popup, the board pages ----------
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg && msg.target === 'truckrc-offscreen') return; // for the hidden page
  (async () => {
    if (msg.type === 'GET_BOOK') {
      let st = await getStore();
      const stale = !st.bookAt || Date.now() - st.bookAt > (msg.maxAge || 90000);
      if (stale) { const job = sync('light'); if (!st.bookAt) { await Promise.race([job, sleep(4000)]); st = await getStore(); } }
      return respond({ book: st.book, bookAt: st.bookAt, status: st.bookStatus, settings: st.settings, customers: st.customers, rules: st.rules || null, accounts: st.accounts });
    }
    if (msg.type === 'SYNC') { const r = await sync(msg.mode || 'full'); const st = await getStore(); return respond(Object.assign({ book: st.book, bookAt: st.bookAt, status: st.bookStatus }, r)); }
    if (msg.type === 'ACCOUNTS') { // Settings → Accounts: check every sign-in now
      const st = await getStore();
      if (msg.check) {
        if (msg.forget) await forgetToken(msg.forget);
        if (msg.forget === 'salesforce') sfMe = null;
        await Promise.all([st.settings.useDat !== false ? boardToken('dat', 'full', !!msg.forget) : null, st.settings.useTruckstop !== false ? boardToken('truckstop', 'full', !!msg.forget) : null, sfLoads(), spotrId(true)]);
        sync('light');
      }
      const s2 = await getStore(); const sid = await spotrId(false);
      let spotr = null; if (sid) { try { const e = await chrome.management.get(sid); spotr = { name: e.name, version: e.version }; } catch (e) { /* */ } }
      return respond({ accounts: s2.accounts, settings: s2.settings, spotr });
    }
    if (msg.type === 'BOARD_OPEN') { // you opened / signed in to DAT or Truckstop in a tab: take that sign-in right away
      const site = msg.site, r = await fromTabs(site);
      if (r && r.ok) { await adopt(site, r); sync('light'); } else if (r && r.error === 'login') await setAccount(site, { ok: false, error: 'signed out' });
      return respond({ ok: true });
    }
    if (msg.type === 'SAVE_LOAD') {
      const { manual = {} } = await chrome.storage.local.get('manual');
      const L = msg.load; L.uid = TR.uidOf(L); L.savedAt = new Date().toISOString();
      manual[L.uid] = L;
      Object.keys(manual).forEach(k => { if (Date.now() - new Date(manual[k].savedAt || 0) > 14 * 864e5) delete manual[k]; });
      await chrome.storage.local.set({ manual });
      await addToBook(L);
      return respond({ ok: true, uid: L.uid });
    }
    if (msg.type === 'SAVE_EDIT') {
      const { edits = {} } = await chrome.storage.local.get('edits');
      edits[msg.uid] = Object.assign({}, edits[msg.uid], msg.edit, { at: Date.now() });
      Object.keys(edits).forEach(k => { if (Date.now() - (edits[k].at || 0) > 14 * 864e5) delete edits[k]; });
      await chrome.storage.local.set({ edits });
      const { book = [] } = await chrome.storage.local.get('book');
      const b = book.find(x => x.uid === msg.uid); if (b) { Object.assign(b, msg.edit, { edited: true }); await chrome.storage.local.set({ book }); }
      return respond({ ok: true });
    }
    if (msg.type === 'LOG_REPLY') {
      const { replies = [] } = await chrome.storage.local.get('replies');
      replies.unshift(Object.assign({ at: new Date().toISOString() }, msg.entry));
      await chrome.storage.local.set({ replies: replies.slice(0, 150) });
      return respond({ ok: true });
    }
    if (msg.type === 'CHECK_UPDATE') return respond(await checkForUpdate());
    if (msg.type === 'GH_VERSION') return respond({ version: await githubVersion(), running: chrome.runtime.getManifest().version });
    if (msg.type === 'SAVE_SETTINGS') {
      const { settings = {} } = await chrome.storage.local.get('settings');
      const next = Object.assign({}, TR.DEFAULTS, ACCOUNT_DEFAULTS, settings, msg.settings);
      await chrome.storage.local.set({ settings: next });
      TR.setMe({ name: next.myName, email: next.myEmail });
      if (msg.resync) { await chrome.storage.session.remove('tok'); sfMe = null; sync('full'); }
      return respond({ ok: true });
    }
    respond(null);
  })().catch(e => respond({ ok: false, error: e.message }));
  return true;
});
async function addToBook(L) {
  const { book = [] } = await chrome.storage.local.get('book');
  const x = Object.assign({ boards: [], picks: [], drops: [], options: [], hours: { dat: null, ts: null } }, L, { src: 'manual' });
  const i = book.findIndex(b => b.uid === x.uid);
  if (i >= 0) book[i] = Object.assign(book[i], x); else book.unshift(x);
  await chrome.storage.local.set({ book });
}

// keep the book fresh while Outlook is open (quick check every minute, a full board pull every 10 minutes)
chrome.alarms.create('truckrc-sync', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== 'truckrc-sync') return;
  const tabs = await chrome.tabs.query({ url: ['https://outlook.office.com/*', 'https://outlook.office365.com/*', 'https://outlook.cloud.microsoft/*', 'https://outlook.live.com/*'] });
  if (!tabs.length) return;
  await sync(Date.now() - lastFull > 10 * 60000 ? 'full' : 'light');
});
chrome.runtime.onStartup.addListener(() => { sync('full'); });
chrome.storage.session.get('lastFull').then(r => { if (r && r.lastFull) lastFull = r.lastFull; }).catch(() => {});

const WATCH = /^https:\/\/(outlook\.(office|office365|live)\.com|outlook\.cloud\.microsoft|one\.dat\.com|(main|app)\.truckstop\.com|[^/]*\.(lightning\.force|my\.salesforce)\.com)\//i;
let tabT = null;
const soon = () => { clearTimeout(tabT); tabT = setTimeout(() => sync('light'), 1500); };
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (info.status === 'complete' && WATCH.test(tab.url || '')) soon(); });
chrome.tabs.onActivated.addListener(async ({ tabId }) => { try { const t = await chrome.tabs.get(tabId); if (/outlook/i.test(t.url || '')) soon(); } catch (e) { /* tab gone */ } });
chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason === 'update') await chrome.storage.local.set({ justUpdated: { from: details.previousVersion, to: chrome.runtime.getManifest().version, at: Date.now() } });
  const { rules } = await chrome.storage.local.get('rules'); if (rules) TR.setRules(rules);
  for (const cs of chrome.runtime.getManifest().content_scripts) {
    if (cs.world === 'MAIN') continue;
    const tabs = await chrome.tabs.query({ url: cs.matches });
    for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files: cs.js }).catch(() => {});
  }
  // first install: the setup screen (your name, and your DAT / Truckstop / Salesforce sign-ins)
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('popup.html#setup') });
  sync('full');
});
chrome.storage.local.get('rules').then(({ rules }) => { if (rules) TR.setRules(rules); });

chrome.commands.onCommand.addListener(async cmd => {
  if (cmd !== 'truckr-reply') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'REPLY_OPEN' }).catch(() => {});
});
