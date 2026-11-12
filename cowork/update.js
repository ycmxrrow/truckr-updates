/* TRUCKR CoWork — one-click updates from GitHub (ycmxrrow/truckr-updates, folder cowork/).
   The first time, you point it at your TRUCKR CoWork folder once; after that "Update now" downloads the new files
   straight into that folder and restarts TRUCKR CoWork. Your settings and saved loads are kept. */
(async function () {
  const $ = id => document.getElementById(id);
  const REPO = 'ycmxrrow/truckr-updates', DIR = 'cowork/';
  const running = chrome.runtime.getManifest().version;
  const log = t => { $('log').textContent += t + '\n'; };
  const msg = (t, cls) => { $('msg').innerHTML = t; $('msg').className = cls || ''; };
  const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 4; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

  // the folder handle is kept in this extension's own database, so you only pick the folder once
  const db = () => new Promise((res, rej) => { const r = indexedDB.open('truckrc', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const kv = async (k, v) => { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('kv', v === undefined ? 'readonly' : 'readwrite'); const st = tx.objectStore('kv'); const q = v === undefined ? st.get(k) : st.put(v, k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };

  // the exact commit, so every file comes from the same version (no half-updated mix while GitHub refreshes)
  async function latest() {
    let sha = 'main';
    try { const r = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, { headers: { Accept: 'application/vnd.github.sha' }, cache: 'no-store' }); if (r.ok) sha = (await r.text()).trim(); } catch (e) { /* fall back to main */ }
    const base = `https://raw.githubusercontent.com/${REPO}/${sha}/${DIR}`;
    const b = await fetch(base + 'build.json' + (sha === 'main' ? '?t=' + Date.now() : ''), { cache: 'no-store' });
    if (!b.ok) throw new Error('GitHub ' + b.status);
    return { base, sha, build: await b.json() };
  }
  async function folderOk(dir) {
    try {
      const m = JSON.parse(await (await (await dir.getFileHandle('manifest.json')).getFile()).text());
      return m.name === 'TRUCKR CoWork';
    } catch (e) { return false; }
  }
  async function permitted(dir, ask) {
    const o = { mode: 'readwrite' };
    if ((await dir.queryPermission(o)) === 'granted') return true;
    return ask ? (await dir.requestPermission(o)) === 'granted' : false;
  }
  async function writeFile(dir, path, buf) {
    const parts = path.split('/'); let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable(); await w.write(buf); await w.close();
    const back = await (await fh.getFile()).arrayBuffer();
    if (back.byteLength !== buf.byteLength) throw new Error(path + ' did not save completely');
  }

  let L = null;
  try { L = await latest(); } catch (e) { msg('Could not reach GitHub right now: ' + e.message, 'bad'); return; }
  $('vers').textContent = `You have v${running}. GitHub has v${L.build.version}.`;
  if (cmpVer(L.build.version, running) <= 0) { msg(`You're up to date (v${running}).`, 'ok'); return; }

  let dir = await kv('dir').catch(() => null);
  const ready = async () => {
    if (!dir) { msg(`v${L.build.version} is ready. First, show TRUCKR CoWork where its folder is (one time only).`); $('link').hidden = false; $('go').hidden = true;
      $('hint').innerHTML = 'Pick the folder you loaded in chrome://extensions, e.g. <code>Documents\\TRUCKR CoWork</code>. When Chrome asks, choose <b>Allow on every visit</b> / <b>Edit files</b>.'; return; }
    $('link').hidden = true; $('go').hidden = false;
    msg(`v${L.build.version} is ready to install.`); $('hint').textContent = `Folder: ${dir.name}. Your settings and saved loads are kept.`;
  };
  $('link').onclick = async () => {
    try {
      const d = await window.showDirectoryPicker({ id: 'truckr-cowork', mode: 'readwrite' });
      if (!(await folderOk(d))) { msg('That folder isn\'t TRUCKR CoWork (no TRUCKR CoWork manifest.json in it). Pick the folder you loaded in Chrome.', 'bad'); return; }
      dir = d; await kv('dir', d); await ready();
    } catch (e) { if (e.name !== 'AbortError') msg('Could not use that folder: ' + e.message, 'bad'); }
  };
  $('go').onclick = async () => {
    $('go').disabled = true;
    try {
      if (!(await permitted(dir, true))) { msg('Chrome needs your OK to update the files in that folder. Click Update now again and choose Allow.', 'bad'); $('go').disabled = false; return; }
      if (!(await folderOk(dir))) { dir = null; await kv('dir', null); await ready(); return; }
      const files = Object.keys(L.build.files || {});
      const order = files.filter(f => f !== 'manifest.json').concat(['build.json', 'manifest.json']).filter((f, i, a) => a.indexOf(f) === i);
      const got = {};
      msg(`Downloading v${L.build.version}…`);
      for (const f of order) {
        const r = await fetch(L.base + f.split('/').map(encodeURIComponent).join('/'), { cache: 'no-store' });
        if (!r.ok) throw new Error(`${f}: GitHub ${r.status}`);
        const buf = await r.arrayBuffer();
        const want = L.build.files[f];
        if (want && buf.byteLength !== want) throw new Error(`${f} came down incomplete (${buf.byteLength} of ${want} bytes). Try again in a minute.`);
        got[f] = buf; log(`✓ ${f}`);
      }
      msg('Saving into your folder…');
      for (const f of order) await writeFile(dir, f, got[f]);
      await chrome.storage.local.set({ justUpdated: { from: running, to: L.build.version, at: Date.now() } });
      msg(`Installed v${L.build.version}. Restarting TRUCKR CoWork… (this tab closes)`, 'ok');
      setTimeout(() => chrome.runtime.reload(), 600);
    } catch (e) { msg('Update stopped: ' + e.message + ' Nothing is broken: your current version keeps running.', 'bad'); $('go').disabled = false; }
  };
  await ready();
  if (dir && (await permitted(dir, false))) $('hint').textContent = `Folder: ${dir.name}. Click Update now.`;
})();
