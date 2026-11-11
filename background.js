/* TRUCKR — background: keeps the load book (your live DAT + Truckstop posts) ready so carrier replies are instant. */
importScripts('lib/truckr.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RULES_URL = 'https://raw.githubusercontent.com/ycmxrrow/truckr-updates/main/rules.json';
const GH_BUILD_URL = 'https://raw.githubusercontent.com/ycmxrrow/truckr-updates/main/build.json';

async function getStore() {
  const s = await chrome.storage.local.get(['settings', 'manual', 'edits', 'book', 'bookAt', 'bookStatus', 'rules', 'spotrId', 'customers', 'lastLive']);
  s.settings = Object.assign({}, TR.DEFAULTS, s.settings || {});
  s.manual = s.manual || {}; s.edits = s.edits || {}; s.book = s.book || []; s.customers = s.customers || [];
  return s;
}

// ---------- SPOTR is the bridge to DAT + Truckstop (it already has your sign-ins) ----------
async function spotrId(force) {
  const { spotrId: cached } = await chrome.storage.local.get('spotrId');
  if (cached && !force) return cached;
  try {
    const all = await chrome.management.getAll();
    const s = all.find(e => e.enabled && e.type === 'extension' && /^SPOTR$/i.test(e.name));
    if (s) { await chrome.storage.local.set({ spotrId: s.id }); return s.id; }
  } catch (e) { /* management not available */ }
  return null;
}
async function askSpotr(msg, timeout) {
  let id = await spotrId(false);
  for (let k = 0; k < 2; k++) {
    if (!id) return { ok: false, error: 'SPOTR not found. Load SPOTR in Chrome (chrome://extensions) and make sure it is turned on.' };
    try {
      const r = await Promise.race([chrome.runtime.sendMessage(id, Object.assign({ app: 'TRUCKR' }, msg)), sleep(timeout || 40000).then(() => ({ ok: false, error: 'SPOTR took too long' }))]);
      if (r) return r;
      return { ok: false, error: 'SPOTR needs v1.37.5 or newer (click Check for updates in SPOTR)' };
    } catch (e) { if (k === 0) { id = await spotrId(true); continue; } return { ok: false, error: /receiving end|not exist/i.test(e.message) ? 'SPOTR needs v1.37.5 or newer (click Check for updates in SPOTR)' : e.message }; }
  }
  return { ok: false, error: 'SPOTR did not answer' };
}

// ---------- Salesforce: your loads, straight from your normal Salesforce sign-in (read-only) ----------
const SF_API = 'v60.0';
async function sfSession() {
  const all = await chrome.cookies.getAll({ name: 'sid' }).catch(() => []);
  const c = all.filter(x => /\.my\.salesforce\.com$/i.test(x.domain) && x.value).sort((a, b) => (b.expirationDate || 0) - (a.expirationDate || 0));
  if (!c.length) return null;
  return { host: c[0].domain.replace(/^\./, ''), sid: c[0].value };
}
async function sfGet(sess, path) {
  const r = await fetch(`https://${sess.host}${path}`, { headers: { Authorization: 'Bearer ' + sess.sid, Accept: 'application/json' } });
  if (r.status === 401) { const e = new Error('Salesforce sign-in expired. Open Salesforce in a tab.'); e.code = 'login'; throw e; }
  if (!r.ok) throw new Error('Salesforce ' + r.status + ' ' + (await r.text()).slice(0, 160));
  return r.json();
}
const SF_FIELDS = 'Id, Name, rtms__Load_Status__c, Origin_City__c, Origin_State__c, Destination_City__c, Destination_State__c, rtms__Expected_Ship_Date2__c, rtms__Expected_Delivery_Date2__c, rtms__Total_Weight__c, Length__c, rtms__Linear_Feet__c, rtms__Cargo_Summary__c, rtms__Load_Posting_Description__c, rtms__Offer_Rate__c, rtms__Max_Pay_Amount__c, Equipment_Type_Read_Only__c, Partial_Load__c, rtms__Team__c, rtms__Hazardous_Materials__c, OD__c, rtms__Customer__r.Name, LastModifiedDate, (SELECT rtms__Number__c, rtms__City_Index__c, rtms__State_Index__c, rtms__Is_Pickup__c, rtms__Expected_Date__c, rtms__Shipping_Receiving_Hours__c, rtms__Appointment_Time__c FROM rtms__Stops__r ORDER BY rtms__Number__c)';
let sfMe = null;
async function sfLoads() {
  const sess = await sfSession();
  if (!sess) return { ok: false, error: 'Open Salesforce in a Chrome tab (signed in) so TRUCKR can read your loads' };
  try {
    if (!sfMe || sfMe.host !== sess.host) { const me = await sfGet(sess, `/services/data/${SF_API}/chatter/users/me`); sfMe = { host: sess.host, id: me.id }; }
    const id = sfMe.id;
    const who = ['CreatedById', 'rtms__Customer_Sales_Rep__c', 'Client_Operations_Rep__c', 'Assigned_Carrier_Sales__c', 'rtms__Carrier_Sales_Rep__c'].map(f => `${f} = '${id}'`).join(' OR ');
    const q = `SELECT ${SF_FIELDS} FROM rtms__Load__c WHERE rtms__Expected_Ship_Date2__c >= LAST_N_DAYS:4 AND (${who}) ORDER BY CreatedDate DESC LIMIT 200`;
    let j = await sfGet(sess, `/services/data/${SF_API}/query?q=${encodeURIComponent(q)}`); const loads = j.records || [];
    while (j.nextRecordsUrl && loads.length < 400) { j = await sfGet(sess, j.nextRecordsUrl); loads.push(...(j.records || [])); }
    return { ok: true, host: sess.host, loads };
  } catch (e) { return { ok: false, error: e.message }; }
}

let syncing = null, lastFull = 0;
async function sync(mode) {
  if (syncing) return syncing;
  syncing = (async () => {
    const t0 = Date.now();
    const [r0, sf] = await Promise.all([askSpotr({ type: 'TRUCKR_LOADS', live: mode === 'none' ? false : (mode || 'light') }, mode === 'full' ? 60000 : 30000), sfLoads()]);
    const r = r0 && r0.ok ? Object.assign({}, r0, { salesforce: sf }) : r0;
    const st = await getStore();
    const status = { at: new Date().toISOString(), ms: 0, spotr: r && r.ok ? r.version : null, error: r && !r.ok ? r.error : '', live: {}, sf: sf && sf.ok ? { ok: true, n: sf.loads.length } : { ok: false, error: (sf && sf.error) || '' } };
    if (r && r.ok) {
      Object.entries(r.live || {}).forEach(([k, v]) => { status.live[k] = v && v.ok ? { ok: true, n: (v.loads || []).length } : { ok: false, error: (v && v.error) || 'no answer' }; });
      // keep the last good board list when a quick ("light") check couldn't reach a board this time
      if (st.lastLive) Object.keys(st.lastLive).forEach(k => { if (!(r.live && r.live[k] && r.live[k].ok) && st.lastLive[k] && Date.now() - st.lastLive[k].at < 30 * 60000) { r.live = r.live || {}; r.live[k] = st.lastLive[k].v; status.live[k] = Object.assign({ cached: true }, status.live[k] || {}, { n: (st.lastLive[k].v.loads || []).length }); } });
      const keep = {}; Object.entries(r.live || {}).forEach(([k, v]) => { if (v && v.ok && !(status.live[k] && status.live[k].cached)) keep[k] = { at: Date.now(), v }; });
      if (Object.keys(keep).length) { const { lastLive = {} } = await chrome.storage.local.get('lastLive'); await chrome.storage.local.set({ lastLive: Object.assign(lastLive, keep) }); }
      const { lastLive: ll } = await chrome.storage.local.get('lastLive'); st.lastLive = ll;
      const book = TR.buildBook(r, st);
      const customers = [...new Set((r.posts || []).map(p => (p.senderEmail || '').toLowerCase()).concat(r.customers || []).filter(Boolean))]; // everyone SPOTR treats as a customer
      // a sample of what each board sent, for fixing field mapping if DAT / Truckstop change their data
      const sample = {}; Object.entries(r.live || {}).forEach(([k, v]) => { if (v && v.loads && v.loads[0]) sample[k] = JSON.stringify(v.loads[0]).slice(0, 6000); });
      status.ms = Date.now() - t0; status.n = book.length;
      await chrome.storage.local.set({ book, bookAt: Date.now(), bookStatus: status, customers, boardSample: sample });
      if (mode === 'full') { lastFull = Date.now(); chrome.storage.session.set({ lastFull }).catch(() => {}); }
      return { ok: true, n: book.length, status };
    }
    // SPOTR not reachable: Salesforce + the last book + your saved loads
    const book = TR.buildBook({ posts: [], live: {}, salesforce: sf }, st).concat((st.book || []).filter(b => b.src !== 'manual' && b.src !== 'salesforce'));
    status.ms = Date.now() - t0;
    await chrome.storage.local.set({ bookStatus: status, book: dedupe(book) });
    return { ok: false, error: status.error, status };
  })();
  try { return await syncing; } finally { syncing = null; }
}
const dedupe = list => list.filter((b, i) => list.findIndex(x => x.uid === b.uid) === i);

// ---------- rules + version from GitHub ----------
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
async function githubVersion() {
  try { const r = await fetch(GH_BUILD_URL + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return null; return (await r.json()).version || null; } catch (e) { return null; }
}

// ---------- updates: same as SPOTR — new files land in the TRUCKR folder, then "Check for updates" switches over ----------
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 4; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
async function diskBuild() { const r = await fetch(chrome.runtime.getURL('build.json') + '?t=' + Date.now(), { cache: 'no-store' }); return r.json(); }
async function diskReady(build) {
  const checks = await Promise.all(Object.entries(build.files).filter(([p]) => !/\.png$/i.test(p)).map(async ([path, size]) => {
    const r = await fetch(chrome.runtime.getURL(path) + '?t=' + Date.now(), { cache: 'no-store' }).catch(() => null);
    return !!r && r.ok && (await r.arrayBuffer()).byteLength === size;
  }));
  return checks.every(Boolean);
}
async function checkForUpdate() {
  const running = chrome.runtime.getManifest().version;
  const rules = await pullRules();
  const gh = await githubVersion();
  let build = null; try { build = await diskBuild(); } catch (e) { /* */ }
  if (build && cmpVer(build.version, running) > 0) {
    if (!(await diskReady(build))) return { status: 'syncing', version: build.version, rules: rules.ok };
    setTimeout(() => chrome.runtime.reload(), 250);
    return { status: 'update_available', version: build.version, rules: rules.ok };
  }
  if (gh && cmpVer(gh, running) > 0) return { status: 'github_newer', version: gh, rules: rules.ok };
  return { status: 'no_update', version: running, rules: rules.ok, rulesError: rules.ok ? '' : rules.error };
}

// ---------- messages from the Outlook bar + popup ----------
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  (async () => {
    if (msg.type === 'GET_BOOK') {
      let st = await getStore();
      const stale = !st.bookAt || Date.now() - st.bookAt > (msg.maxAge || 90000);
      if (stale) { const job = sync('light'); if (!st.bookAt) { await Promise.race([job, sleep(4000)]); st = await getStore(); } } // first time: wait a moment, never long (the bar fills in when the sync lands)
      return respond({ book: st.book, bookAt: st.bookAt, status: st.bookStatus, settings: st.settings, customers: st.customers, rules: st.rules || null });
    }
    if (msg.type === 'SYNC') { const r = await sync(msg.mode || 'full'); const st = await getStore(); return respond(Object.assign({ book: st.book, bookAt: st.bookAt, status: st.bookStatus }, r)); }
    if (msg.type === 'SAVE_LOAD') { // a load you typed in the bar (not on the boards / not from SPOTR)
      const { manual = {} } = await chrome.storage.local.get('manual');
      const L = msg.load; L.uid = TR.uidOf(L); L.savedAt = new Date().toISOString();
      manual[L.uid] = L;
      // forget loads you saved more than 14 days ago
      Object.keys(manual).forEach(k => { if (Date.now() - new Date(manual[k].savedAt || 0) > 14 * 864e5) delete manual[k]; });
      await chrome.storage.local.set({ manual });
      await addToBook(L);
      return respond({ ok: true, uid: L.uid });
    }
    if (msg.type === 'SAVE_EDIT') { // your changes to a posted load (rate, hours, commodity...)
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
    if (msg.type === 'SAVE_SETTINGS') { await chrome.storage.local.set({ settings: Object.assign({}, TR.DEFAULTS, msg.settings) }); return respond({ ok: true }); }
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

// keep the book fresh while Outlook is open (quick check: never loads a board page in the background)
chrome.alarms.create('truckr-sync', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== 'truckr-sync') return;
  const tabs = await chrome.tabs.query({ url: ['https://outlook.office.com/*', 'https://outlook.office365.com/*', 'https://outlook.cloud.microsoft/*', 'https://outlook.live.com/*'] });
  if (!tabs.length) return; // nothing to answer without Outlook open
  await sync(Date.now() - lastFull > 10 * 60000 ? 'full' : 'light');
});

chrome.runtime.onStartup.addListener(() => { sync('full'); });
chrome.storage.session.get('lastFull').then(r => { if (r && r.lastFull) lastFull = r.lastFull; }).catch(() => {});

// also sync on its own whenever Outlook, DAT One, Truckstop or Salesforce finishes loading in a tab,
// or you switch to your Outlook tab (a new post / new Salesforce load shows up without waiting for the minute)
const WATCH = /^https:\/\/(outlook\.(office|office365|live)\.com|outlook\.cloud\.microsoft|one\.dat\.com|(main|app)\.truckstop\.com|[^/]*\.(lightning\.force|my\.salesforce)\.com)\//i;
let tabT = null;
const soon = () => { clearTimeout(tabT); tabT = setTimeout(() => sync('light'), 1500); };
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (info.status === 'complete' && WATCH.test(tab.url || '')) soon(); });
chrome.tabs.onActivated.addListener(async ({ tabId }) => { try { const t = await chrome.tabs.get(tabId); if (/outlook/i.test(t.url || '')) soon(); } catch (e) { /* tab gone */ } });
chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason === 'update') await chrome.storage.local.set({ justUpdated: { from: details.previousVersion, to: chrome.runtime.getManifest().version, at: Date.now() } });
  const { rules } = await chrome.storage.local.get('rules'); if (rules) TR.setRules(rules);
  // put the new version into Outlook tabs that are already open (no refresh needed)
  for (const cs of chrome.runtime.getManifest().content_scripts) {
    const tabs = await chrome.tabs.query({ url: cs.matches });
    for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files: cs.js }).catch(() => {});
  }
  sync('full');
});
chrome.storage.local.get('rules').then(({ rules }) => { if (rules) TR.setRules(rules); });

// Alt+Shift+T: reply to the carrier email that's open
chrome.commands.onCommand.addListener(async cmd => {
  if (cmd !== 'truckr-reply') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'REPLY_OPEN' }).catch(() => {});
});
