/* TRUCKR CoWork — the coworker edition of TRUCKR (Fide Freight)
   Same brain as TRUCKR, but it answers in YOUR name, and it reads more kinds of load details
   (every trailer type, reefer temps, hazmat class, pallets / pieces, dims, partials, drop trailers, appointments, reference #s, ZIP-only lanes).
   Shared brain: reads a carrier's email about one of your posted loads, finds that load, and writes the reply.
   Used by the Outlook bar, the popup and the background. No network calls in here. */
const TR = (() => {
  'use strict';

  const STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC AB BC MB NB NL NS ON PE QC SK'.split(' '));
  const STATE_NAMES = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', ontario: 'ON', quebec: 'QC', alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB' };

  const DEFAULTS = {
    greeting: 'Hi there,',
    showDates: true, datesOn: true,          // "PU 11/17 07:00-15:00" instead of "PU 07:00-15:00"
    noTarpLine: true,          // open deck with no tarps -> "No tarps - strap n go"
    puHours: '07:00-15:00',    // used only when the load has no hours of its own
    delHours: '07:00-15:00',
    replyAll: false,           // carriers: plain Reply (only the person who asked)
    coveredText: 'This one has been covered. Thank you!',
    showEquipment: true,       // "Equipment - 53' Reefer" (coworkers post every kind of trailer)
    showTemp: true,            // reefers: "Temp - 34°F (continuous)"
    showPieces: true,          // "Pallets - 22" / "Pieces - 6 bundles" / dims when the post has them
    showRef: false,            // "Ref # 131015" at the bottom of the reply
    myName: '', myEmail: ''    // whose TRUCKR CoWork this is (filled in from Salesforce, editable in settings)
  };
  // ---------- who you are (so your own replies in a thread are recognized) ----------
  let ME = { name: '', email: '', domain: 'fidefreight.com' };
  const reEsc = s => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function setMe(m) {
    const email = String((m && m.email) || '').trim().toLowerCase(), name = String((m && m.name) || '').trim();
    ME = { name, email, domain: (email.split('@')[1] || (m && m.domain) || 'fidefreight.com').toLowerCase() };
  }
  // "From: Pat Smith" / "Pat Smith <pat@fidefreight.com> wrote:" / "On Tue ... Pat Smith wrote:"
  function repliedRe() {
    const alts = [];
    if (ME.name) alts.push(`From:\\s*${reEsc(ME.name)}`, `On .{4,80}${reEsc(ME.name)}.{0,60}wrote:`, `${reEsc(ME.name)}\\s*<?${ME.email ? reEsc(ME.email) : '[^>\\s]+'}>?\\s*wrote:`);
    if (ME.email) alts.push(`${reEsc(ME.email)}>?\\s*(?:\\n|.){0,40}?wrote:`);
    return alts.length ? new RegExp(alts.join('|'), 'i') : /$^/;
  }
  const isOurs = email => !!email && String(email).toLowerCase().endsWith('@' + ME.domain);

  let RULES = { skipSubject: [], skipSenders: [], accessorials: [] }; // extra rules pulled from GitHub (Check for updates)
  function setRules(r) { if (r && typeof r === 'object') RULES = Object.assign({ skipSubject: [], skipSenders: [], accessorials: [] }, r); }

  // ---------- small helpers ----------
  const txtOf = v => v == null ? '' : typeof v === 'string' || typeof v === 'number' ? String(v) : Array.isArray(v) ? v.map(txtOf).filter(Boolean).join(' ') : typeof v === 'object' ? txtOf(v.comment || v.comments || v.text || v.value || v.description || v.name || v.note || Object.values(v).filter(z => typeof z === 'string').join(' ')) : '';
  const clean = s => txtOf(s).replace(/\[object Object\],?/g, ' ').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const titleCase = s => clean(s).toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase()).replace(/\b(Ft|Mt|St|Pt)\b\.?/g, '$1');
  const num = v => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[$,\s]/g, '')); return isFinite(n) && n > 0 ? n : null; };
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const pad = n => String(n).padStart(2, '0');
  const ABBR = { ft: 'fort', mt: 'mount', st: 'saint', ste: 'sainte', pt: 'port', w: 'west', e: 'east', n: 'north', s: 'south', no: 'north', so: 'south', hts: 'heights', spgs: 'springs', jct: 'junction', ctr: 'center', vlg: 'village', twp: 'township' };
  const cityKey = c => String(c || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean).map(w => ABBR[w] || w).join(' ');
  const stateKey = s => { const t = String(s || '').trim(); return t.length === 2 ? t.toUpperCase() : (STATE_NAMES[t.toLowerCase()] || t.toUpperCase()); };
  const samePlace = (a, b) => !!(a && b && cityKey(a.city) && cityKey(a.city) === cityKey(b.city) && (!a.state || !b.state || stateKey(a.state) === stateKey(b.state)));
  const placeText = p => p ? `${titleCase(p.city)}, ${stateKey(p.state)}` : '';
  const laneText = (o, d) => `${placeText(o)} → ${placeText(d)}`;
  const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const md = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${Number(m[2])}/${Number(m[3])}` : ''; };

  // "0700-1500", "7:00 AM - 3:00 PM", "07:00" ... -> "07:00"
  function hhmm(t) {
    const m = String(t || '').trim().match(/^(\d{1,2})(?::?(\d{2}))?\s*([ap])?\.?m?\.?$/i);
    if (!m) return '';
    let h = Number(m[1]); const mi = Number(m[2] || 0);
    if (m[3]) { if (/p/i.test(m[3]) && h < 12) h += 12; if (/a/i.test(m[3]) && h === 12) h = 0; }
    if (h > 23 || mi > 59) return '';
    return `${pad(h)}:${pad(mi)}`;
  }
  function hoursRange(v) {
    if (!v) return '';
    const parts = String(v).split(/\s*(?:-|–|—|to)\s*/i);
    if (parts.length < 2) { const one = hhmm(parts[0]); return one ? one : ''; }
    const a = hhmm(parts[0]), b = hhmm(parts[1]);
    return a && b ? `${a}-${b}` : '';
  }
  const timeOf = iso => { const m = String(iso || '').match(/T(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : ''; };
  // a DAT time like 2026-11-17T16:00:00.000Z is noon in Pennsylvania: read it as the local day, not the UTC one
  const localDay = iso => { if (!iso) return ''; if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(iso))) return dayOf(iso); const d = new Date(iso); if (isNaN(d)) return dayOf(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const dayOf = iso => { const m = String(iso || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ''; };

  // find a value anywhere inside a board's load object (DAT and Truckstop nest things differently and move them around)
  function deep(obj, keyRe, test, depth = 0, seen = new Set()) {
    if (!obj || typeof obj !== 'object' || depth > 6 || seen.has(obj)) return undefined;
    seen.add(obj);
    for (const [k, v] of Object.entries(obj)) if (keyRe.test(k) && test(v)) return v;
    for (const v of Object.values(obj)) { if (v && typeof v === 'object') { const r = deep(v, keyRe, test, depth + 1, seen); if (r !== undefined) return r; } }
    return undefined;
  }
  const isNum = v => typeof v === 'number' && v > 0 || (typeof v === 'string' && /^\d[\d,.]*$/.test(v) && Number(v.replace(/,/g, '')) > 0);
  const isStr = v => typeof v === 'string' && v.trim().length > 1;

  // ---------- accessorials ----------
  const OPT_TEXT = {
    tarps: 'Tarps required', chains: 'Chains required', straps: 'Straps required', coilracks: 'Coil racks required',
    dunnage: 'Dunnage required', team: 'Team required', hazmat: 'Hazmat', oversize: 'Over-dimensional (permits)',
    sides: 'Sides required', ramps: 'Ramps required'
  };
  const NOTE_ACC = [
    [/\b(\d{1,2})\s*(?:'|ft|foot|feet)?\s*(?:drop\s+)?tarps?\b/i, m => `Tarps required (${m[1]}')`, 'tarps'],
    [/\bsmoke\s+tarps?\b/i, () => 'Smoke tarps required', 'tarps'],
    [/\blumber\s+tarps?\b/i, () => 'Lumber tarps required', 'tarps'],
    [/\btarps?\s+(?:required|needed|req'?d)\b|\bmust\s+tarp\b|\bneeds?\s+tarps?\b/i, () => 'Tarps required', 'tarps'],
    [/\bno\s+tarps?\b|\btarps?\s*(?:not\s+(?:needed|required)|:\s*no)\b/i, () => 'No tarps', 'notarps'],
    [/\bedge\s*protect(?:ors?|ion)\b|\bedge\s*guards?\b/i, () => 'Edge protectors required', 'edge'],
    [/\bcorner\s*protect(?:ors?|ion)\b/i, () => 'Corner protectors required', 'corner'],
    [/\bcoil\s*racks?\b/i, () => 'Coil racks required', 'coilracks'],
    [/\bchains?\b(?!\s*(?:not|no))/i, () => 'Chains required', 'chains'],
    [/\bdunnage\b/i, () => 'Dunnage required', 'dunnage'],
    [/\bload\s*(?:locks?|bars?)\b/i, () => 'Load locks required', 'loadlocks'],
    [/\bload\s*levell?ers?\b/i, () => 'Load levelers required', 'levelers'],
    [/\bramps?\b/i, () => 'Ramps required', 'ramps'],
    [/\btwic\b/i, () => 'TWIC card required', 'twic'],
    [/\blift\s*gate\b/i, () => 'Liftgate required', 'liftgate'],
    [/\bpallet\s*jack\b/i, () => 'Pallet jack required', 'palletjack'],
    [/\bdriver\s*assist\b/i, () => 'Driver assist', 'assist'],
    [/\bhand\s*unload\b/i, () => 'Hand unload', 'handunload'],
    [/\bhaz\s*mat\b|\bhazardous\b/i, () => 'Hazmat', 'hazmat'],
    [/\bteam\b(?!\s*(?:not|no))/i, () => 'Team required', 'team'],
    [/\bpermits?\b|\boversized?\b|\bover[\s-]*dimensional\b/i, () => 'Over-dimensional (permits)', 'oversize'],
    [/\bstraps?\b(?!\s*n)/i, () => 'Straps required', 'straps'],
    // more of what coworkers' loads carry
    [/\bdrop\s*(?:trailer|&\s*hook|and\s*hook|n\s*hook)\b|\bpre[\s-]*loaded\s+trailer\b/i, () => 'Drop trailer', 'droptrailer'],
    [/\blive\s*(?:load\s*(?:\/|&|and)\s*)?unload\b/i, () => 'Live unload', 'liveunload'],
    [/\blive\s*load\b/i, () => 'Live load', 'liveload'],
    [/\bf\.?c\.?f\.?s\.?\b|\bfirst\s*come\s*,?\s*first\s*serve/i, () => 'FCFS', 'fcfs'],
    [/\bappt\.?\b|\bappointment\b/i, () => 'Appointment', 'appt'],
    [/\bpallet\s*exchange\b/i, () => 'Pallet exchange', 'palletx'],
    [/\bfood\s*grade\b/i, () => 'Food grade trailer', 'foodgrade'],
    [/\bwash\s*out\b|\bwashout\b|\bclean\s*(?:and\s*dry\s*)?trailer\b/i, () => 'Clean trailer / washout', 'washout'],
    [/\btsa\b/i, () => 'TSA required', 'tsa'],
    [/\btanker\s*endorse/i, () => 'Tanker endorsement required', 'tankend'],
    [/\b(?:moving\s*)?blankets?\b/i, () => 'Blankets required', 'blankets'],
    [/\be[\s-]*track\b|\blogistic\s*posts?\b/i, () => 'E-track / load bars', 'etrack'],
    [/\blumper\b/i, () => 'Lumper', 'lumper'],
    [/\bscale\s*ticket\b/i, () => 'Scale ticket required', 'scale'],
    [/\bno\s*touch\b/i, () => 'No touch freight', 'notouch'],
    [/\bprotect\s*from\s*freez|keep\s*from\s*freez/i, () => 'Protect from freezing', 'pff'],
    [/\bexpedited?\b|\bhot\s*load\b/i, () => 'Expedited', 'expedite'],
    [/\bstackable\b/i, () => 'Stackable', 'stack'],
    [/\bnon[\s-]*stackable\b|\bdo\s*not\s*stack\b/i, () => 'Do not stack', 'nostack'],
    [/\bescorts?\b|\bpilot\s*cars?\b/i, () => 'Escorts required', 'escort']
  ];
  // Truckstop / DAT option lists ("Tarps", "Hazardous", "Team") -> TRUCKR's option keys
  const optKeys = t => { const o = []; const s = String(t || '');
    [['tarps', /tarp/i], ['chains', /chain/i], ['straps', /strap/i], ['coilracks', /coil/i], ['dunnage', /dunnage/i], ['team', /team/i], ['hazmat', /haz/i], ['oversize', /over\s*(?:size|dim)|oversized|permit/i], ['sides', /sides/i], ['ramps', /ramp/i]].forEach(([k, re]) => { if (re.test(s)) o.push(k); });
    return o; };

  // ---------- the extra load details coworkers' loads have (reefer temps, hazmat class, pallets, dims, partials) ----------
  const TEMP_RE = /(?:\btemp(?:erature)?\b|\bset\s*(?:at|to|point)\b|\brun(?:ning)?\s*at\b|\breefer\s*(?:at|@)|\bkeep\s*at\b)\s*[:\-]?\s*(?:at\s*)?(-?\d{1,2})\s*(?:°|º|deg(?:rees?)?)?\s*F?\b|(-?\d{1,2})\s*(?:°|º)\s*F?\b|(-?\d{1,2})\s*deg(?:rees?)?\s*F?\b/i;
  const PIECES_RE = /\b(\d{1,4})\s*(pallets?|plts?|skids?|pcs|pieces?|bundles?|crates?|totes?|drums?|coils?|rolls?|boxes|cartons?|ctns|bags?|super\s*sacks?|gaylords?|units?|reels?|spools?)\b/i;
  const DIMS_RE = /\b(\d{1,3}(?:\.\d+)?)\s*(?:"|''|in\b|')?\s*[x×X*]\s*(\d{1,3}(?:\.\d+)?)\s*(?:"|''|in\b|')?(?:\s*[x×X*]\s*(\d{1,3}(?:\.\d+)?)\s*(?:"|''|in\b|'|ft\b)?)?/;
  function details(load) {
    const text = [load.notes, load.special, load.sfNotes, load.commodity, load.tempText].filter(v => typeof v === 'string' && v).join(' \n ');
    const d = {};
    // reefer temperature
    const reefer = /^(reefer|vanreefer|boxreefer)$/.test(load.equipment || '') || !!load.tempControlled || /reefer/i.test(load.equipmentName || '');
    let t = load.temp != null && load.temp !== '' ? { v: Number(load.temp) } : null;
    if (!t) { const m = text.match(TEMP_RE); if (m && (reefer || /temp|°|º|deg/i.test(m[0]))) { const v = Number(m[1] || m[2] || m[3]); if (v >= -30 && v <= 75) t = { v }; } }
    const mode = /\bcontinuous\b|\bcont\.?\s*run/i.test(text) ? 'continuous' : /\bcycl(?:e|ing)\b|start[\s/-]*stop/i.test(text) ? 'cycle' : '';
    if (t) d.temp = `${t.v}°F${mode ? ' (' + mode + ')' : ''}`;
    else if (reefer && /\bfrozen\b/i.test(text)) d.temp = 'Frozen' + (mode ? ' (' + mode + ')' : '');
    else if (reefer && /\bprotect\s*from\s*freez|keep\s*from\s*freez/i.test(text)) d.temp = 'Protect from freezing';
    if (d.temp && /\bpre[\s-]*cool/i.test(text)) d.temp += ' · pre-cool';
    if (d.temp && /\bpulp(?:ing)?\b/i.test(text)) d.temp += ' · will be pulped';
    // hazmat class / UN #
    const hz = (load.options || []).includes('hazmat') || /\bhaz\s*mat\b|\bhazardous\b/i.test(text);
    const cls = text.match(/\bclass\s*(\d(?:\.\d)?)\b/i), un = text.match(/\b(?:UN|NA)\s*-?\s*(\d{4})\b/);
    if (hz && (cls || un)) d.hazmat = 'Hazmat (' + [cls ? 'Class ' + cls[1] : '', un ? 'UN' + un[1] : ''].filter(Boolean).join(', ') + ')';
    // pallets / pieces
    const pc = num(load.pieces) ? { n: num(load.pieces), u: load.pieceUnit || 'pallets' } : (() => { const m = text.match(PIECES_RE); return m ? { n: Number(m[1]), u: m[2].toLowerCase() } : null; })();
    if (pc && pc.n > 0 && pc.n < 2000) d.pieces = /^(pallets?|plts?|skids?)$/.test(pc.u) ? `Pallets - ${pc.n}` : `Pieces - ${pc.n} ${pc.u.replace(/^pcs$|^pieces?$/, 'pcs')}`;
    // dims (never a date like 11/12)
    const dm = String(load.dims || '').trim() || (() => { const m = text.match(DIMS_RE); return m && !/\d\/\d/.test(m[0]) && Number(m[1]) >= 4 && Number(m[2]) >= 4 ? [m[1], m[2], m[3]].filter(Boolean).join('x') : ''; })();
    if (dm) d.dims = dm;
    d.partial = !!load.partial || /\bpartial\b|\bLTL\b/i.test(text);
    d.team = (load.options || []).includes('team');
    return d;
  }
  const OPEN_DECK = /flat|step|hot\s*shot|hotshot|conestoga|deck|rgn|lowboy|double\s*drop|doubledrop|landoll|maxi/i;

  // ---------- every kind of trailer (board names "Reefer - R", codes "SD", Salesforce names, what carriers write) ----------
  const EQ = [
    ['flatstep', /flat\s*(?:bed)?\s*(?:or|\/|&)\s*step|\bf\/sd\b/i, 'Flatbed or Step Deck'],
    ['vanreefer', /van\s*(?:or|\/|&)\s*reefer/i, 'Van or Reefer'],
    ['doubledrop', /double\s*drop/i, 'Double Drop'],
    ['rgn', /\brgn\b|low\s*boy|removable\s*goose/i, 'RGN / Lowboy'],
    ['conestoga', /conestoga|rolling\s*tarp|curtain\s*side/i, 'Conestoga'],
    ['stepdeck', /step\s*deck|drop\s*deck|single\s*drop/i, 'Step Deck'],
    ['hotshot', /hot\s*shot/i, 'Hotshot'],
    ['poweronly', /power\s*only/i, 'Power Only'],
    ['sprinter', /sprinter|cargo\s*van/i, 'Sprinter Van'],
    ['boxreefer', /(?:straight|box)\s*truck\s*[-–]?\s*reefer|reefer\s*(?:straight|box)\s*truck/i, 'Reefer Box Truck'],
    ['boxtruck', /box\s*truck|straight\s*(?:box\s*)?truck|\bbox\b/i, 'Box Truck'],
    ['reefer', /reefer|refrigerat|temp(?:erature)?[\s-]*control/i, 'Reefer'],
    ['container', /container|drayage|chassis/i, 'Container'],
    ['tanker', /\btank(?:er)?s?\b/i, 'Tanker'],
    ['dump', /dump|hopper/i, 'Dump / Hopper'],
    ['auto', /auto\s*carrier|car\s*hauler/i, 'Auto Carrier'],
    ['flatbed', /flat\s*bed|\bflat\b|maxi|landoll/i, 'Flatbed'],
    ['van', /\bvans?\b/i, 'Dry Van']
  ];
  const EQ_CODE = { F: 'flatbed', FD: 'flatbed', FT: 'flatbed', FS: 'flatstep', FSD: 'flatstep', SD: 'stepdeck', DD: 'doubledrop', RG: 'rgn', RGN: 'rgn', LB: 'rgn', CN: 'conestoga', CONG: 'conestoga',
    HS: 'hotshot', PO: 'poweronly', SB: 'boxtruck', R: 'reefer', RZ: 'reefer', V: 'van', VZ: 'van', VR: 'vanreefer', C: 'container', T: 'tanker', DT: 'dump', AC: 'auto' };
  const EQ_NAME = Object.fromEntries(EQ.map(e => [e[0], e[2]]));
  function eqKey(t) {
    const s = clean(t); if (!s) return '';
    if (EQ_NAME[s.toLowerCase()]) return s.toLowerCase(); // already a key
    const hit = EQ.find(([, re]) => re.test(s)); if (hit) return hit[0];
    const code = (s.match(/(?:^|\s[-–]\s*)([A-Za-z]{1,4})$/) || [])[1];
    return code ? (EQ_CODE[code.toUpperCase()] || '') : '';
  }
  const eqName = l => EQ_NAME[l.equipment] || clean(l.equipmentName || '').replace(/\s+-\s+[A-Z]{1,4}$/, '') || '';

  function accessorials(load) {
    const out = [], keys = new Set();
    const push = (t, k) => { if (k && keys.has(k)) return; if (out.some(x => x.toLowerCase() === t.toLowerCase())) return; if (k) keys.add(k); out.push(t); };
    const notes = [load.notes, load.special].filter(Boolean).join(' \n ');
    // remote rules first (Check for updates can add phrases without a new version)
    (RULES.accessorials || []).forEach(r => { try { if (new RegExp(r.re, 'i').test(notes)) push(r.text, r.key || r.text); } catch (e) { /* bad rule */ } });
    NOTE_ACC.forEach(([re, f, k]) => { const m = notes.match(re); if (m && !(k === 'tarps' && keys.has('notarps'))) push(f(m), k); });
    (load.options || []).forEach(k => { if (k === 'tarps' && keys.has('notarps')) return; if (OPT_TEXT[k]) push(OPT_TEXT[k], k); });
    const ORDER = ['tarp', 'no tarp', 'coil', 'chain', 'strap', 'edge', 'corner', 'dunnage', 'load lock', 'load level', 'ramp', 'side'];
    const rank = t => { const i = ORDER.findIndex(w => t.toLowerCase().startsWith(w) || t.toLowerCase().includes(' ' + w)); return i < 0 ? 99 : i; };
    out.sort((a, b) => rank(a) - rank(b));
    return { lines: out, keys };
  }

  // ---------- normalize loads from SPOTR / DAT / Truckstop into one shape ----------
  function blank() {
    return { uid: '', src: '', boards: [], customer: '', ref: '', origin: null, dest: null, picks: [], drops: [], pickupDate: '', deliveryDate: '',
      hours: { dat: null, ts: null, any: null }, weight: null, length: null, commodity: '', rate: null, equipment: '', equipmentName: '', options: [], notes: '', postedAt: '', ids: {} };
  }
  const uidOf = l => [cityKey(l.origin && l.origin.city), stateKey(l.origin && l.origin.state), cityKey(l.dest && l.dest.city), stateKey(l.dest && l.dest.state), l.pickupDate || ''].join('|');

  function fromSpotr(p, eqNames, optNames) {
    const L = p.load || {}, x = blank();
    x.src = 'spotr'; x.boards = (p.sites || []).slice(); x.ids = p.ids || {};
    x.customer = (L.sender && (L.sender.name || L.sender.email)) || p.sender || '';
    x.ref = L.ref || p.ref || '';
    x.origin = L.origin; x.dest = L.dest;
    if (L.stops && (L.stops.picks || L.stops.drops)) { x.picks = (L.stops.picks || []).filter(Boolean); x.drops = (L.stops.drops || []).filter(Boolean); }
    x.pickupDate = L.pickupDate || ''; x.deliveryDate = L.deliveryDate || '';
    const d = L.dat || {}, t = L.ts || {};
    x.hours.dat = { pu: hoursRange(d.pickupHours), del: hoursRange(d.dropHours) };
    x.hours.ts = { pu: hoursRange(t.pickupStart && t.pickupEnd ? `${t.pickupStart}-${t.pickupEnd}` : t.pickupStart), del: hoursRange(t.dropStart && t.dropEnd ? `${t.dropStart}-${t.dropEnd}` : t.dropEnd) };
    x.weight = num(L.weight); x.length = num(L.length);
    x.commodity = clean(L.datCommodity || L.tsCommodity || '');
    x.rate = num(p.rate != null ? p.rate : L.rate);
    x.equipment = L.equipment || ''; x.equipmentName = p.equipment || (eqNames[L.equipment] || L.equipment || '');
    x.options = (L.options || []).slice();
    x.notes = clean(L.special || L.note || '');
    x.postedAt = p.at || '';
    x.partial = !!L.partial;
    if (L.pieces) x.pieces = num(L.pieces);
    if (L.handling) x.notes = [x.notes, clean(L.handling)].filter(Boolean).join(' · ');
    if (L.temp != null) x.temp = L.temp;
    x.uid = uidOf(x);
    return x;
  }

  function fromTruckstop(l) {
    const x = blank(); x.src = 'truckstop'; x.boards = ['truckstop'];
    const stops = (l.loadStops || l.stops || []).slice().sort((a, b) => (a.eventSeqNumber || a.sequence || 0) - (b.eventSeqNumber || b.sequence || 0));
    const loc = s => { const c = (s && (s.location || s)) || {}; return c.city ? { city: c.city, state: c.state || c.stateCode || c.stateProv || '' } : null; };
    const isPick = s => /pick|origin|^1$/i.test(String(s.type || s.stopType || s.loadStopType || ''));
    const picks = stops.filter(isPick), drops = stops.filter(s => !isPick(s));
    const first = picks[0] || stops[0], last = drops[drops.length - 1] || stops[stops.length - 1];
    x.origin = loc(first); x.dest = loc(last);
    if (stops.length > 2) { x.picks = (picks.length ? picks : [first]).map(loc).filter(Boolean); x.drops = (drops.length ? drops : [last]).map(loc).filter(Boolean); }
    const e = s => s && (s.earlyDateTime || s.EarlyDateTime || s.earlyDate || ''), lt = s => s && (s.lateDateTime || s.LateDateTime || s.lateDate || '');
    x.pickupDate = dayOf(e(first)); x.deliveryDate = dayOf(e(last)) || dayOf(lt(last));
    const rng = s => { const a = timeOf(e(s)), b = timeOf(lt(s)); return a && b && a !== b ? `${a}-${b}` : (a && a !== '00:00' ? a : ''); };
    x.hours.ts = { pu: rng(first), del: rng(last) };
    x.weight = num((l.dimensional && l.dimensional.weight) || deep(l, /^weight$/i, isNum));
    x.length = num((l.dimensional && l.dimensional.length) || deep(l, /^length$/i, isNum));
    const ra = l.rateAttributes || {};
    x.rate = num((ra.postedAllInRate && (ra.postedAllInRate.amount || ra.postedAllInRate)) || deep(l, /postedAllInRate|allInRate|postedRate/i, v => isNum(v) || (v && isNum(v.amount)))) ;
    if (!x.rate) { const v = deep(l, /postedAllInRate|allInRate/i, v => v && typeof v === 'object' && isNum(v.amount)); if (v) x.rate = num(v.amount); }
    const com = l.commodity || deep(l, /commodity/i, v => isStr(v) || (v && isStr(v.description)));
    x.commodity = clean(typeof com === 'string' ? com : (com && (com.description || com.name)) || '');
    x.notes = clean(l.specialInformation || l.specialInfo || deep(l, /special/i, isStr) || '');
    const eqd = deep(l, /equipment.*(description|name)$|^equipmentType$/i, isStr);
    x.equipmentName = clean(eqd || ''); x.equipment = eqKey(x.equipmentName);
    const opts = deep(l, /equipmentOptions|loadOptions|options/i, v => Array.isArray(v) && v.length);
    if (opts) { x.optionText = opts.map(o => typeof o === 'string' ? o : (o.description || o.name || '')).filter(Boolean).join(', '); x.options = optKeys(x.optionText); }
    { const tv = deep(l, /temperature|^temp$|minTemp|maxTemp/i, v => typeof v === 'number' || (typeof v === 'string' && /^-?\d{1,2}$/.test(v))); if (tv != null) x.temp = Number(tv); }
    { const pv = deep(l, /^(?:pieces|pieceCount|palletCount|pallets|quantity)$/i, isNum); if (pv) x.pieces = num(pv); }
    if (l.isPartial || l.partial || /partial|ltl/i.test(String(deep(l, /loadSize|fullPartial|ltl/i, isStr) || ''))) x.partial = true;
    x.ids = { truckstop: l.loadId || l.id || '' };
    x.ref = l.loadNumber || l.referenceNumber || '';
    x.postedAt = l.createDateTime ? l.createDateTime + 'Z' : '';
    x.uid = uidOf(x);
    return x.origin && x.dest ? x : null;
  }

  function fromDat(it) {
    const x = blank(); x.src = 'dat'; x.boards = ['dat'];
    const src = Object.assign({}, it, it.full ? { full: it.full } : {});
    let o = null, d = null;
    (function walk(v, depth) { if (!v || typeof v !== 'object' || depth > 5 || (o && d)) return; if (v.origin && v.destination && (v.origin.city || (v.origin.place && v.origin.place.city))) { o = v.origin.place || v.origin; d = v.destination.place || v.destination; return; } Object.values(v).forEach(z => walk(z, depth + 1)); })(src, 0);
    if (!o || !d) return null;
    x.origin = { city: o.city, state: o.stateProv || o.state || '' }; x.dest = { city: d.city, state: d.stateProv || d.state || '' };
    // DAT's dates and hours live on the stops (waypoints), never on 'exposure' (that's when the POST went up, not the pickup):
    //  list item: waypoints.origin / waypoints.destination  ·  full shipment: routeSegments[].waypoints[] { type: PICKUP | DROPOFF, exposedAddress }
    const wps = [];
    (function walk(v, depth) {
      if (!v || typeof v !== 'object' || depth > 6) return;
      if (v.waypoints) {
        const w = v.waypoints;
        if (Array.isArray(w)) w.forEach(p => wps.push({ type: /drop|deliver|dest/i.test(p.type || p.stopType || '') ? 'del' : 'pu', a: (p.exposedAddress || p.address || p).appointment || p.appointment || {} }));
        else { if (w.origin) wps.push({ type: 'pu', a: w.origin.appointment || {} }); if (w.destination) wps.push({ type: 'del', a: w.destination.appointment || {} }); }
      }
      Object.entries(v).forEach(([k, z]) => { if (k !== 'waypoints' && k !== 'exposure') walk(z, depth + 1); });
    })(src, 0);
    const puA = (wps.find(w => w.type === 'pu' && w.a.startWhen) || wps.find(w => w.type === 'pu') || {}).a || {};
    const delA = (wps.slice().reverse().find(w => w.type === 'del' && w.a.startWhen) || wps.slice().reverse().find(w => w.type === 'del') || {}).a || {};
    x.pickupDate = localDay(puA.startWhen);
    x.deliveryDate = localDay(delA.startWhen); // DAT usually has no drop date: SPOTR / Salesforce fill it in, else it's estimated
    x.hours.dat = { pu: hoursRange(puA.deliveryHours || '') || '', del: hoursRange(delA.deliveryHours || '') || '' };
    x.weight = num(deep(src, /weight/i, isNum)); x.length = num(deep(src, /length/i, isNum));
    { const mv = deep(src, /tripLength|tripMiles|^miles$|distance/i, v => isNum(v) || (v && typeof v === 'object' && isNum(v.miles))); x.miles = num(mv && typeof mv === 'object' ? mv.miles : mv); }
    const rate = deep(src, /rateUsd|^rate$|amount|allIn/i, v => isNum(v) || (v && typeof v === 'object' && isNum(v.rateUsd || v.amount)));
    x.rate = num(rate && typeof rate === 'object' ? (rate.rateUsd || rate.amount) : rate);
    // DAT keeps the commodity as { details: 'Printed Materials' } (the way SPOTR posts it), sometimes as plain text
    { const cv = deep(src, /commodity/i, v => isStr(v) || (v && typeof v === 'object' && isStr(v.details || v.description || v.name || v.commodity))); x.commodity = clean(cv && typeof cv === 'object' ? (cv.details || cv.description || cv.name || cv.commodity) : (cv || '')); }
    const com = deep(src, /^comments?$|comment1|comment2/i, v => isStr(v) || (Array.isArray(v) && v.length));
    // DAT sends comments as a list of objects ({ comment: '…' }), not text: pull the words out of each one
    const words = v => v == null ? '' : typeof v === 'string' || typeof v === 'number' ? String(v) : Array.isArray(v) ? v.map(words).filter(Boolean).join(' ') : typeof v === 'object' ? words(v.comment || v.comments || v.text || v.value || v.description || v.note || Object.values(v).filter(z => typeof z === 'string').join(' ')) : '';
    x.notes = Array.isArray(com) ? com.map(c => clean(words(c))).filter(Boolean).join(' · ') : clean(words(com));
    x.equipmentName = clean(deep(src, /equipmentType|equipment$/i, isStr) || '');
    x.equipment = eqKey(x.equipmentName);
    { const cap = deep(src, /capabilities|loadOptions|equipmentOptions|^options$/i, v => Array.isArray(v) && v.length); if (cap) x.options = optKeys(cap.map(c => typeof c === 'string' ? c : (c.description || c.name || c.code || '')).join(' ')); }
    { const tv = deep(src, /temperature|^temp$/i, v => typeof v === 'number' || (typeof v === 'string' && /^-?\d{1,2}$/.test(v)) || (v && typeof v === 'object' && isNum(Math.abs(v.min || v.value || v.fahrenheit || 0)))); if (tv != null) x.temp = typeof tv === 'object' ? Number(tv.min != null ? tv.min : tv.value != null ? tv.value : tv.fahrenheit) : Number(tv); }
    if (/partial|ltl/i.test(String(deep(src, /fullPartial|loadSize|capacity/i, isStr) || ''))) x.partial = true;
    x.ids = { dat: (it.postingId || '') + (it.shipmentId ? '@' + it.shipmentId : '') };
    x.ref = deep(src, /referenceId|reference/i, isStr) || '';
    x.postedAt = (it.history && it.history.created && it.history.created.when) || '';
    x.uid = uidOf(x);
    return x;
  }

  // fill the gaps of a with b (SPOTR's own record wins; the live board fills in what SPOTR didn't keep)
  function merge(a, b) {
    a.boards = [...new Set([...a.boards, ...b.boards])];
    a.ids = Object.assign({}, b.ids, a.ids);
    ['weight', 'length', 'rate', 'commodity', 'equipment', 'equipmentName', 'notes', 'deliveryDate', 'ref', 'optionText', 'pieces', 'dims', 'miles'].forEach(k => { if (!a[k] && b[k]) a[k] = b[k]; });
    if ((a.temp == null || a.temp === '') && b.temp != null) a.temp = b.temp;
    if (b.partial) a.partial = true;
    if ((b.options || []).length) a.options = [...new Set([...(a.options || []), ...b.options])];
    a.refs = [...new Set([...(a.refs || []), a.ref, b.ref, ...(b.refs || [])].filter(Boolean))];
    ['dat', 'ts'].forEach(k => { if (!(a.hours[k] && a.hours[k].pu) && b.hours[k] && b.hours[k].pu) a.hours[k] = b.hours[k]; });
    if (!a.picks.length && b.picks.length) { a.picks = b.picks; a.drops = b.drops; }
    a.live = true;
    return a;
  }
  // same lane AND same pickup day (DAT and SPOTR dates now agree exactly; Truckstop can read a day off, so it gets one day of slack)
  const near = (a, b) => samePlace(a.origin, b.origin) && samePlace(a.dest, b.dest) && (!a.pickupDate || !b.pickupDate || Math.abs(new Date(a.pickupDate) - new Date(b.pickupDate)) <= ((a.boards || []).concat(b.boards || []).includes('truckstop') && a.src !== b.src ? 864e5 : 0));

  // ---------- Salesforce (Revenova TMS rtms__Load__c): the loads you build ----------
  const SF_COVERED = /^(dispatched|in transit|at pickup|at delivery|loaded|delivered|completed|invoiced|paid|closed)$/i;
  const SF_DEAD = /^(cancel+ed|void|deleted|declined)$/i;
  function fromSalesforce(r, host) {
    const x = blank(); x.src = 'salesforce'; x.boards = [];
    const stops = ((r.rtms__Stops__r && r.rtms__Stops__r.records) || []).slice().sort((a, b) => (a.rtms__Number__c || 0) - (b.rtms__Number__c || 0));
    const place = st => { const v = String(st.rtms__City_Index__c || '').split(','); return v[0] ? { city: titleCase(v[0]), state: stateKey((v[1] || st.rtms__State_Index__c || '').trim()) } : null; };
    const picks = stops.filter(st => st.rtms__Is_Pickup__c), drops = stops.filter(st => !st.rtms__Is_Pickup__c);
    x.origin = (picks[0] && place(picks[0])) || (r.Origin_City__c ? { city: titleCase(r.Origin_City__c), state: stateKey(r.Origin_State__c) } : null);
    x.dest = (drops.length && place(drops[drops.length - 1])) || (r.Destination_City__c ? { city: titleCase(r.Destination_City__c), state: stateKey(r.Destination_State__c) } : null);
    if (stops.length > 2) { x.picks = picks.map(place).filter(Boolean); x.drops = drops.map(place).filter(Boolean); }
    x.pickupDate = r.rtms__Expected_Ship_Date2__c || (picks[0] && picks[0].rtms__Expected_Date__c) || '';
    x.deliveryDate = r.rtms__Expected_Delivery_Date2__c || (drops.length && drops[drops.length - 1].rtms__Expected_Date__c) || '';
    const hrs = st => st ? (hoursRange(st.rtms__Appointment_Time__c) || hoursRange(st.rtms__Shipping_Receiving_Hours__c)) : '';
    const h = { pu: hrs(picks[0]), del: hrs(drops[drops.length - 1]) };
    x.hours = { dat: h, ts: h, any: h };
    x.weight = num(r.rtms__Total_Weight__c);
    x.length = num(r.Length__c) || num(r.rtms__Linear_Feet__c);
    // "Steel Beams, 4743 lbs\nSteel Beams, 665 lbs" / "20   ABRASIVE GRINDING WHEELS, 30060 lbs" -> "Steel Beams" / "Abrasive Grinding Wheels"
    const coms = [...new Set(String(r.rtms__Cargo_Summary__c || '').split('\n').map(l => clean(l.replace(/,\s*[\d,.]+\s*lbs?\b.*$/i, '').replace(/^\d+\s+/, '').replace(/\([^)]*\)/g, ''))).filter(Boolean))];
    const empty = /\bempty\b/i.test(r.rtms__Load_Posting_Description__c || '');
    x.commodity = coms.map(c => { const k = c.match(/^(\d{2})\s*'?\s*(HC|HQ|GP|DV|ST|RF|OT|FR)$/i); if (k) return `${empty ? 'Empty ' : ''}${k[1]}' ${/hc|hq/i.test(k[2]) ? 'High Cube ' : ''}Container`; return c === c.toUpperCase() && c.length > 4 ? titleCase(c) : c; }).join(', ');
    x.rate = num(r.rtms__Offer_Rate__c);
    x.equipmentName = clean(r.Equipment_Type_Read_Only__c || '');
    const e = x.equipmentName.toLowerCase();
    x.equipment = eqKey(x.equipmentName);
    x.options = [].concat(/tarp/.test(e) ? ['tarps'] : [], r.rtms__Team__c || /\bteam\b/.test(e) ? ['team'] : [], r.rtms__Hazardous_Materials__c ? ['hazmat'] : [], r.OD__c ? ['oversize'] : []);
    // reefers: Salesforce's temperature fields
    if (r.rtms__Temperature_Setting_Minimum__c != null) x.temp = r.rtms__Temperature_Setting_Minimum__c;
    else if (r.Temperature__c) { const tm = String(r.Temperature__c).match(/-?\d{1,2}/); if (tm) x.temp = Number(tm[0]); else x.tempText = 'temp ' + r.Temperature__c; }
    if (r.rtms__Temperature_Run_Type__c) x.tempText = [x.tempText, r.rtms__Temperature_Run_Type__c].filter(Boolean).join(' ');
    if (r.rtms__Temperature_Controlled__c && x.equipment !== 'reefer' && x.equipment !== 'boxreefer') x.tempControlled = true;
    x.refs = [r.Name, String(r.Name || '').replace(/^Load-/i, ''), r.rtms__PO_Number__c].filter(Boolean);
    x.notes = clean(r.rtms__Load_Posting_Description__c || ''); // the carrier-facing posting text (never the rate-con instructions)
    x.customer = (r.rtms__Customer__r && r.rtms__Customer__r.Name) || '';
    x.ref = r.Name;
    x.partial = !!r.Partial_Load__c;
    x.postedAt = r.LastModifiedDate || '';
    x.sf = { id: r.Id, name: r.Name, status: r.rtms__Load_Status__c || '', url: host ? `https://${host}/lightning/r/rtms__Load__c/${r.Id}/view` : '', offer: num(r.rtms__Offer_Rate__c), max: num(r.rtms__Max_Pay_Amount__c), customer: x.customer, stops: stops.length };
    x.covered = SF_COVERED.test(x.sf.status); x.cancelled = SF_DEAD.test(x.sf.status);
    x.uid = uidOf(x);
    return x.origin && x.dest ? x : null;
  }
  // the same freight? origin matches, and the delivery matches the other's delivery or one of its drops (a post can show only the first drop)
  function sfSame(a, s) {
    if (!samePlace(a.origin, s.origin) && !(s.picks || []).some(p => samePlace(a.origin, p))) return false;
    const aDrops = [a.dest].concat(a.drops || []), sDrops = [s.dest].concat(s.drops || []);
    if (!aDrops.some(d => sDrops.some(e => samePlace(d, e)))) return false;
    return !a.pickupDate || !s.pickupDate || Math.abs(new Date(a.pickupDate) - new Date(s.pickupDate)) <= 3 * 864e5;
  }
  // what differs between what carriers saw (the post) and Salesforce
  function sfCheck(a, s) {
    const out = [];
    if (a.weight && s.weight && Math.abs(a.weight - s.weight) > Math.max(50, s.weight * 0.02)) out.push({ k: 'weight', post: Math.round(a.weight).toLocaleString('en-US') + ' lbs', sf: Math.round(s.weight).toLocaleString('en-US') + ' lbs' });
    if (a.rate && s.rate && Math.abs(a.rate - s.rate) >= 1) out.push({ k: 'rate', post: money(a.rate), sf: money(s.rate) });
    if (a.pickupDate && s.pickupDate && a.pickupDate !== s.pickupDate) out.push({ k: 'pickup date', post: md(a.pickupDate), sf: md(s.pickupDate) });
    const stopsA = (a.picks.length + a.drops.length) || 2, stopsS = (s.picks.length + s.drops.length) || 2;
    if (stopsS > stopsA) out.push({ k: 'stops', post: `${stopsA} stops`, sf: `${stopsS} stops (${[].concat(s.picks, s.drops).map(placeText).join(' / ')})` });
    if (a.length && s.length && Math.abs(a.length - s.length) >= 1) out.push({ k: 'length', post: Math.round(a.length) + "'", sf: Math.round(s.length) + "'" });
    const flat = e => /^(flatbed|stepdeck|flatstep|conestoga)$/.test(e);
    if (a.equipment && s.equipment && a.equipment !== s.equipment && !(flat(a.equipment) && flat(s.equipment))) out.push({ k: 'equipment', post: a.equipmentName || a.equipment, sf: s.equipmentName || s.equipment });
    const ha = (a.hours.dat && a.hours.dat.pu) || (a.hours.ts && a.hours.ts.pu), hs = s.hours.any && s.hours.any.pu;
    if (ha && hs && ha !== hs) out.push({ k: 'PU hours', post: ha, sf: hs });
    if (s.covered) out.push({ k: 'status', post: 'still posted', sf: s.sf.status });
    if (s.cancelled) out.push({ k: 'status', post: 'still posted', sf: 'Cancelled' });
    return out;
  }
  function attachSf(a, s) {
    a.sf = s.sf; a.covered = s.covered; a.cancelled = s.cancelled; a.sfLoad = s;
    a.checks = sfCheck(a, s);
    // gaps on the post are filled from Salesforce; Salesforce's full stop list wins (carriers need every drop)
    ['weight', 'length', 'commodity', 'rate', 'equipment', 'equipmentName', 'deliveryDate', 'customer'].forEach(k => { if (!a[k] && s[k]) a[k] = s[k]; });
    if (!(a.hours.dat && a.hours.dat.pu) && !(a.hours.ts && a.hours.ts.pu)) a.hours = s.hours;
    if ((s.picks.length + s.drops.length) > (a.picks.length + a.drops.length)) { a.picks = s.picks; a.drops = s.drops; if (!a.origin) a.origin = s.origin; }
    if (s.notes && !String(a.notes || '').includes(s.notes)) a.sfNotes = s.notes;
  }
  // use Salesforce's values for everything (button on the bar when they differ)
  function useSf(a) { const s = a.sfLoad; if (!s) return a; return Object.assign({}, a, { weight: s.weight || a.weight, length: s.length || a.length, commodity: s.commodity || a.commodity, rate: s.rate || a.rate, pickupDate: s.pickupDate || a.pickupDate, deliveryDate: s.deliveryDate || a.deliveryDate, hours: s.hours, picks: s.picks, drops: s.drops, equipment: s.equipment || a.equipment, equipmentName: s.equipmentName || a.equipmentName, options: [...new Set([].concat(a.options || [], s.options || []))], notes: [a.notes, s.notes].filter(Boolean).join(' · '), checks: [] }); }

  // SPOTR's answer + your own saved loads/edits -> the load book TRUCKR answers from
  function buildBook(resp, store) {
    const eqNames = {}, optNames = {};
    ((resp && resp.equipment) || []).forEach(e => { eqNames[e.key] = e.name; });
    ((resp && resp.options) || []).forEach(o => { optNames[o.key] = o.name; });
    const book = [];
    // SPOTR posts: newest first; a load re-posted after an update replaces the older record of the same load
    ((resp && resp.posts) || []).filter(p => !p.twin).forEach(p => { const x = fromSpotr(p, eqNames, optNames); if (x.origin && x.dest && !book.some(b => b.uid === x.uid)) book.push(x); });
    const live = (resp && resp.live) || {};
    const liveOk = { dat: !!(live.dat && live.dat.ok), truckstop: !!(live.truckstop && live.truckstop.ok) };
    const add = x => { if (!x) return; const dd = b => (b.pickupDate && x.pickupDate) ? Math.abs(new Date(b.pickupDate) - new Date(x.pickupDate)) : 1e12; const hit = book.filter(b => near(b, x) && !(b.boards.includes(x.boards[0]) && b.live && b.src === x.src)).sort((p, q) => dd(p) - dd(q))[0]; /* same lane: the post with the same pickup day first */ if (hit) merge(hit, x); else { x.live = true; book.push(x); } };
    if (liveOk.truckstop) (live.truckstop.loads || []).forEach(l => { try { add(fromTruckstop(l)); } catch (e) { /* skip odd item */ } });
    if (liveOk.dat) (live.dat.loads || []).forEach(l => { try { add(fromDat(l)); } catch (e) { /* skip odd item */ } });
    // when both boards answered, a SPOTR record that's on neither board any more has been taken down
    // a SPOTR record missing from every board it went to (and that board answered with your other posts) has been taken down
    const liveN = { dat: liveOk.dat ? (live.dat.loads || []).length : 0, truckstop: liveOk.truckstop ? (live.truckstop.loads || []).length : 0 };
    book.forEach(b => { if (b.src === 'spotr' && !b.live && b.boards.length && b.boards.every(s => liveOk[s] && liveN[s] > 0)) b.down = true; });
    // Salesforce: verify each post against the load you built, and add Salesforce loads that aren't on the boards / in SPOTR
    const sfr = resp && resp.salesforce;
    if (sfr && sfr.ok) {
      (sfr.loads || []).map(r => { try { return fromSalesforce(r, sfr.host); } catch (e) { return null; } }).filter(Boolean).forEach(s => {
        const hits = book.filter(b => !b.sf && sfSame(b, s));
        if (hits.length) hits.forEach(b => attachSf(b, s));
        else if (!s.cancelled && (!s.covered || Date.now() - new Date(s.pickupDate || 0) < 2 * 864e5)) book.push(s);
      });
    }
    // your own loads (saved from the bar) and your edits
    const st = store || {};
    Object.values(st.manual || {}).forEach(m => { const x = Object.assign(blank(), m, { src: 'manual' }); x.uid = uidOf(x); if (!book.some(b => b.uid === x.uid)) book.push(x); });
    Object.entries(st.edits || {}).forEach(([uid, e]) => { const b = book.find(x => x.uid === uid); if (b) Object.assign(b, e, { edited: true }); });
    return smartDedupe(book.filter(b => !b.down || Date.now() - new Date(b.postedAt || 0) < 3 * 864e5));
  }

  // ---------- Smart Thinking: the same load seen more than once is ONE load ----------
  // The same freight shows up several times: posted twice on DAT, on DAT + Truckstop, in SPOTR, built in Salesforce,
  // or saved by you. Same lane + same pickup day + same kind of truck + same weight/length = one load; its copies
  // are folded into it (boards, ids, details) and counted, so the list and the reply never repeat a load.
  const SRC_RANK = { spotr: 4, salesforce: 3, manual: 2, dat: 1, truckstop: 1 };
  const eqClass = l => { const e = l.equipment || eqKey(l.equipmentName); return /^(flatbed|flatstep|stepdeck|hotshot|conestoga|rgn|doubledrop)$/.test(e) ? 'open' : e === 'reefer' ? 'reefer' : /^(boxtruck|boxreefer|sprinter)$/.test(e) ? 'box' : /^(van|vanreefer)$/.test(e) ? 'van' : e || ''; };
  const close = (a, b, tol) => !a || !b || Math.abs(a - b) <= Math.max(tol, Math.max(a, b) * 0.02);
  function sameLoad(a, b) {
    if (!samePlace(a.origin, b.origin) || !samePlace(a.dest, b.dest)) return false;
    if ((a.pickupDate || '') !== (b.pickupDate || '') && a.pickupDate && b.pickupDate) return false;
    const ea = eqClass(a), eb = eqClass(b); if (ea && eb && ea !== eb) return false;
    if (!close(a.weight, b.weight, 50) || !close(a.length, b.length, 1)) return false;
    if ((a.picks.length + a.drops.length > 2 || b.picks.length + b.drops.length > 2) && (a.picks.length !== b.picks.length || a.drops.length !== b.drops.length)) return false;
    if (!!a.covered !== !!b.covered || !!a.cancelled !== !!b.cancelled) return false;
    return true;
  }
  function smartDedupe(book) {
    const out = [];
    book.slice().sort((p, q) => (SRC_RANK[q.src] || 0) - (SRC_RANK[p.src] || 0)).forEach(l => {
      const keep = out.find(k => sameLoad(k, l));
      if (!keep) { l.copies = 1; out.push(l); return; }
      merge(keep, l);
      if (!keep.sf && l.sf) { keep.sf = l.sf; keep.sfLoad = l.sfLoad; keep.checks = l.checks; }
      if (!keep.pickupDate && l.pickupDate) keep.pickupDate = l.pickupDate;
      ['dat', 'ts'].forEach(k => { if (!(keep.hours[k] && keep.hours[k].del) && l.hours[k] && l.hours[k].del) keep.hours[k] = Object.assign({}, keep.hours[k], { del: l.hours[k].del }); });
      keep.copies = (keep.copies || 1) + 1;
      // two posts of it on the SAME board = you put up more than one truck of it (or posted it twice)
      if (l.src === keep.src || (l.boards || []).some(b => (keep.seenBoards || keep.boards || []).includes(b) && l.live && (l.src === 'dat' || l.src === 'truckstop'))) keep.sameBoardTwice = true;
      keep.seenBoards = [...new Set([...(keep.seenBoards || keep.boards || []), ...(l.boards || [])])];
    });
    return out;
  }

  // ---------- reading the carrier's email ----------
  const STOP_WORDS = new Set('load loads from to inquiry about re fw fwd the a mi miles for on available truck trucks pick up drop off origin destination lane need needs details detail hello hi is this still please info more rate and by at of in your posted dat truckstop via'.split(' '));
  const CS_RE = /([A-Za-z][A-Za-z.'’-]*(?:[ \t]+[A-Za-z][A-Za-z.'’-]*){0,3})(?:[ \t]*,[ \t]*([A-Za-z]{2})|[ \t]+([A-Z]{2}))(?![A-Za-z])/g;
  function cityStates(line) {
    const out = []; let m; CS_RE.lastIndex = 0;
    while ((m = CS_RE.exec(line))) {
      const st = (m[2] || m[3] || '').toUpperCase();
      if (!STATES.has(st)) continue;
      const words = m[1].split(/\s+/);
      while (words.length && STOP_WORDS.has(words[0].toLowerCase().replace(/[^a-z]/g, ''))) words.shift();
      if (!words.length || STOP_WORDS.has(words[words.length - 1].toLowerCase())) continue;
      if (words.length === 1 && words[0].length < 2) continue;
      if (/^(mc|dot|usdot|ph|fx|cell|main|direct|ext)$/i.test(words[0])) continue;
      out.push({ city: titleCase(words.join(' ')), state: st, at: m.index + m[0].indexOf(words[0]) });
    }
    return out;
  }

  function newPart(body) {
    let t = String(body || '').replace(/\r/g, '');
    // stop at the quoted thread / forwarded header / the external-sender banner
    const cut = t.search(/\n\s*On .{4,120}?wrote:|\n-{2,}\s*Original Message|\n_{5,}\s*\nFrom:|\nFrom:\s.*\n(?:Sent|Date):|\nCAUTION: This email originated/i);
    if (cut > 0) t = t.slice(0, cut);
    return t.trim();
  }

  function parseDate(s, now) {
    const base = now || new Date();
    let m = String(s || '').match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    let mo, da;
    if (m) { mo = Number(m[1]); da = Number(m[2]); }
    else { m = String(s || '').match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i); if (m) { mo = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[1].toLowerCase()) / 3 + 1; da = Number(m[2]); } }
    if (!mo || mo > 12 || !da || da > 31) return '';
    let y = base.getFullYear(); const d = new Date(y, mo - 1, da);
    if (d - base > 200 * 864e5) y--; else if (base - d > 200 * 864e5) y++;
    return `${y}-${pad(mo)}-${pad(da)}`;
  }

  const SKIP_SUBJECT = /\b(truck\s*list|available\s+trucks?|capacity\s+list|accepted\s+by|rate\s*con|confirmation|invoice|pod\b|bol\b|tracking|check\s*call|onboard|packet|rfq|rfp|request\s+for\s+bids?|quote\s+request|delivered|unload(?:ed)?\b|empty\s+at)\b/i;
  const BOOKED_SUBJECT = /\bload[\s-]*#?\s*\d{5,}\b/i; // "Load #131015" updates on a booked load (unless the carrier is asking about it)
  const SKIP_SENDER = /@(fidefreight\.com|highway\.com|.*salesforce\.com|.*dat\.com|.*truckstop\.com|t-insight\.com)$|^(no-?reply|noreply|donotreply|notifications?)@/i;
  // reference numbers a carrier quotes back ("Ref# 131015", "Load ID: 88213", "DAT reference ID 1QX7…", "PO 4500123")
  const REF_RE = /\b(?:ref(?:erence)?(?:\s*id)?|load(?:\s*(?:id|number|no\.?))|order|pro|po|shipment(?:\s*id)?|bol)\s*(?:#|no\.?|number|id)?\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9-]{3,15})\b|\bload[\s-]*#\s*([A-Z0-9-]{4,15})\b/gi;
  function refsIn(t) { const out = new Set(); let m; REF_RE.lastIndex = 0; while ((m = REF_RE.exec(t))) { const v = (m[1] || m[2] || '').toUpperCase().replace(/^LOAD-/, ''); if (/\d/.test(v) && !/^(19|20)\d\d$/.test(v)) out.add(v); } return [...out]; }
  const refKey = v => String(v || '').toUpperCase().replace(/^LOAD-?/, '').replace(/[^A-Z0-9]/g, '');
  // ZIP-only lanes ("60468 to 46514"): SPOTR's ZIP list, when it's loaded (lib/zips.js)
  let ZIPMAP = null;
  function zipPlace(z) {
    const raw = (typeof globalThis !== 'undefined' ? globalThis : self).SP_ZIPS; if (!raw) return null;
    if (!ZIPMAP) { ZIPMAP = new Map(); raw.split(';').forEach(rec => { const i = rec.indexOf(':'); if (i < 0) return; const [st, city] = rec.slice(0, i).split('|'); const zs = rec.slice(i + 1); for (let k = 0; k + 5 <= zs.length; k += 5) ZIPMAP.set(zs.slice(k, k + 5), { city: titleCase(city), state: st }); }); }
    return ZIPMAP.get(String(z)) || null;
  }

  function detectSource(subject, text) {
    const all = subject + '\n' + text;
    if (/truckstop/i.test(all)) return 'truckstop';
    if (/posted on dat|load-details-email-template|\bDAT\s*(?:one|board|load)?\b/.test(all)) return 'dat';
    if (/loadlink/i.test(all)) return 'loadlink';
    if (/123\s*loadboard/i.test(all)) return '123loadboard';
    // DAT One's "email the poster" subject: "Winchester, VA to Mechanicsville, VA for 11/17"
    if (/,\s*[A-Z]{2}\s+to\s+.+,\s*[A-Z]{2}\s+for\s+\d{1,2}\/\d{1,2}/.test(subject)) return 'dat';
    if (/^Pick Up:/m.test(text) && /Trip Miles:/i.test(text)) return 'dat';
    return '';
  }
  function equipmentHint(s) {
    { const m = s.match(/\bequipment\s*(?:type)?\s*:\s*([A-Za-z /&-]{1,30})/i); if (m) { const k = eqKey(m[1]); if (k) return k; } }
    { const m = s.match(/\b(rgn|low\s*boy|double\s*drop|conestoga|power\s*only|curtain\s*side|container|tanker|dump|auto\s*carrier|flat\s*(?:bed)?\s*(?:or|\/)\s*step\s*deck|reefer\s*box\s*truck|straight\s*truck\s*-?\s*reefer)\b/i); if (m) { const k = eqKey(m[1]); if (k) return k; } }
    const m = s.match(/\bequipment\s*:\s*([A-Za-z ]{1,20})/i);
    const t = (m ? m[1] : s);
    if (m) { const c = m[1].trim().toUpperCase(); if (/^(F|FD|FLAT)/.test(c)) return 'flatbed'; if (/^(V|VAN)/.test(c)) return 'van'; if (/^R/.test(c)) return 'reefer'; if (/^(SD|STEP)/.test(c)) return 'stepdeck'; if (/^HS|HOT/.test(c)) return 'hotshot'; }
    if (/\bhot\s*shot\b/i.test(t)) return 'hotshot';
    if (/\bstep\s*deck\b/i.test(t)) return 'stepdeck';
    if (/\bflat\s*bed\b|\bconestoga\b/i.test(t)) return 'flatbed';
    if (/\breefer\b/i.test(t)) return 'reefer';
    if (/\bdry\s*van\b|\b53'?\s*(?:ft)?\s*(?:dry\s*)?van\b|\btandem trailer\b/i.test(t)) return 'van';
    if (/\bbox\s*truck\b|\bstraight\s*truck\b/i.test(t)) return 'boxtruck';
    if (/\bsprinter\b|\bcargo\s*van\b/i.test(t)) return 'sprinter';
    return '';
  }

  // subject + body of the open email -> what the carrier is asking about
  function parseInquiry(mail, store, now) {
    const subject = clean(mail.subject || '').replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '');
    const from = (mail.from && mail.from.email || '').toLowerCase();
    const full = String(mail.body || '');
    const text = newPart(full);
    const res = { subject, from, fromName: (mail.from && mail.from.name) || '', source: '', lane: null, stops: [], date: '', mc: '', dot: '', offer: null, postedRate: null, equipment: '', miles: null, ask: '', replied: false, skip: '' };
    if (SKIP_SENDER.test(from) || isOurs(from)) { res.skip = 'not a carrier'; return res; }
    const custs = (store && store.customers) || [], dom = from.split('@')[1] || '';
    if (custs.includes(from) || (dom && custs.includes('@' + dom))) { res.skip = 'customer'; return res; } // SPOTR's customers: SPOTR handles their emails, never TRUCKR
    try { if ((RULES.skipSenders || []).some(r => new RegExp(r, 'i').test(from))) { res.skip = 'rule'; return res; } } catch (e) { /* bad rule */ }
    if (SKIP_SUBJECT.test(subject)) { res.skip = 'not a load inquiry'; return res; }
    try { if ((RULES.skipSubject || []).some(r => new RegExp(r, 'i').test(subject))) { res.skip = 'rule'; return res; } } catch (e) { /* bad rule */ }

    res.source = detectSource(subject, text);
    res.replied = repliedRe().test(full);
    res.refs = refsIn(subject + '\n' + text.slice(0, 2000));
    // the lane: subject first, then labeled lines (Origin / Pick Up ...), then one line naming two places
    let places = cityStates(subject.replace(/\([^)]*\)/g, ' '));
    if (places.length < 2) {
      const o = text.match(/(?:origin|pick\s*-?\s*up|from)\s*:\s*([^\n]+)/i), d = text.match(/(?:destination|drop\s*-?\s*off|deliver(?:y)?(?:\s*to)?|to)\s*:\s*([^\n]+)/i);
      const po = o && cityStates(o[1])[0], pd = d && cityStates(d[1])[0];
      if (po && pd) places = [po, pd];
    }
    if (places.length < 2) {
      const line = text.split('\n').slice(0, 12).find(l => cityStates(l).length >= 2 && !/\b\d{5}\b/.test(l));
      if (line) places = cityStates(line);
    }
    if (places.length < 2) { // ZIPs only: "60468 to 46514", "Origin: 60468"
      const zs = ((subject + '\n' + text.slice(0, 600)).match(/\b\d{5}\b/g) || []).filter(z => !/^(19|20)\d{3}$/.test(z) || zipPlace(z)).map(zipPlace).filter(Boolean);
      if (zs.length >= 2) places = [zs[0], zs[zs.length - 1]];
    }
    if (places.length >= 2) { res.lane = { o: places[0], d: places[places.length - 1] }; res.stops = places; }
    const head = subject + '\n' + text.slice(0, 1500);
    res.date = parseDate((head.match(/(?:pickup\s*date\s*:|for|by|on|pickup)\s*(?:[A-Za-z]{3,9}\.?\s+)?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|[A-Za-z]{3,9}\.?\s+\d{1,2})/i) || [])[1] || (subject.match(/\b\d{1,2}\/\d{1,2}\b/) || [])[0] || (text.slice(0, 400).match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/) || [])[0] || '', now);
    const mc = full.match(/\bMC\s*(?:#|No\.?|number)?\s*[:\-]?\s*#?\s*(\d{4,8})\b/i); if (mc) res.mc = mc[1];
    const dot = full.match(/\b(?:US\s*)?DOT\s*(?:#|No\.?|number)?\s*[:\-]?\s*#?\s*(\d{5,8})\b/i); if (dot) res.dot = dot[1];
    const pr = head.match(/posted\s*rate\s*:?\s*\$\s?([\d,]{3,7})/i); if (pr) res.postedRate = num(pr[1]);
    const offerTxt = text.replace(/posted\s*rate\s*:?\s*\$\s?[\d,]+/ig, ' ');
    const of = offerTxt.match(/\$\s?([\d,]{3,6})(?![\d,])|\b([\d,]{3,6})\s*\$/);
    if (of) res.offer = num(of[1] || of[2]);
    else if (/\b(?:for|at)\s+(?:the\s+)?posted\s+rate\b/i.test(text)) res.offer = 'posted';
    res.equipment = equipmentHint(head);
    const mi = head.match(/(?:trip\s*miles\s*:?\s*)(\d[\d,]{1,4})|\b(\d[\d,]{1,4})\s*mi\b/i); if (mi) res.miles = num(mi[1] || mi[2]);
    const asks = [];
    if (/straight\s*th?(?:ro)?u/i.test(text)) asks.push('deliver straight thru?');
    if (/flexible\s+rate|best\s+rate|max(?:imum)?\s+rate|rate\s*\?/i.test(text)) asks.push('asking about rate');
    if (/commodity/i.test(text)) asks.push('asking commodity');
    if (/dimension|dims?\b/i.test(text)) asks.push('asking dims');
    if (/tarp/i.test(text)) asks.push('asking about tarps');
    if (/\btemp(?:erature)?\b|\bdegrees?\b|°/i.test(text)) asks.push('asking temp');
    if (/\bhaz\s*mat\b|\bhazardous\b/i.test(text)) asks.push('asking hazmat');
    if (/\bteam\b/i.test(text)) asks.push('asking team?');
    if (/\bpallets?\b|\bpieces\b|\bpcs\b|\bskids?\b/i.test(text)) asks.push('asking pallets');
    if (/\bappt|appointment|fcfs/i.test(text)) asks.push('asking appointment');
    if (/\bdrop\s*(?:trailer|&\s*hook)|\blive\s*(?:load|unload)/i.test(text)) asks.push('asking live/drop');
    if (/\bpartial\b|\bltl\b/i.test(text)) asks.push('asking partial?');
    if (/\bmiles?\b\s*\?/i.test(text)) asks.push('asking miles');
    res.ask = asks.join(' · ');
    // TRUCKR is only for carriers asking about your posts. A customer's load / quote email (SPOTR's job) never gets a bar.
    const top = (subject + '\n' + text.slice(0, 900));
    const boardSrc = /^(dat|truckstop|loadlink|123loadboard)$/.test(res.source);
    const carrierWords = /\b(still\s+available|is\s+(?:this|it)\s+(?:load\s+)?available|need\s+(?:more\s+)?details|any\s+details|the\s+details|details\s*\?|what\s+are\s+the\s+details|load\s+details|details\s+(?:please|pls)|more\s+(?:info|details)|info\s+please|send\s+(?:over|the\s+details)|interested\s+in\s+(?:this|the|your)\s+load|saw\s+your\s+(?:load|post)|we\s+can\s+cover|i\s+can\s+(?:take|cover)|can\s+(?:we|i)\s+(?:get|have)\s+(?:more\s+)?(?:info|details)|truck\s+available|posted\s+rate|flexible\s+rate|dispatch(?:er)?|my\s+mc|carrier|do\s+you\s+still\s+have|still\s+(?:open|need\s+(?:a\s+)?truck|covered\s*\?)|can\s+haul|book\s+(?:it|this)|ref(?:erence)?\s*(?:#|id)|load\s*id)\b/i.test(top);
    const customerWords = /\b(please\s+quote|quote\s+(?:request|this|the\s+following)|need\s+(?:a\s+)?(?:rate|quote|pricing)|rate\s+request|looking\s+to\s+ship|we\s+have\s+(?:a\s+)?(?:load|shipment)|ready\s+to\s+ship|please\s+(?:book|send\s+a\s+truck)|need\s+a\s+truck|spot\s+(?:load|quote)|freight\s+rate)\b/i.test(top);
    if (!(boardSrc || res.mc || res.dot || carrierWords) || (customerWords && !boardSrc && !res.mc && !res.dot)) res.skip = 'not a carrier inquiry';
    if (!res.skip && BOOKED_SUBJECT.test(subject) && !/\b(still\s+available|is\s+(?:this|it)\s+(?:load\s+)?available|details|rate|interested|can\s+(?:take|cover|haul)|do\s+you\s+still\s+have)\b/i.test(top)) res.skip = 'update on a booked load';
    return res;
  }

  // ---------- which of your loads is it? ----------
  function wordIn(text, phrase) {
    const k = cityKey(phrase); if (!k) return false;
    return (' ' + cityKey(text) + ' ').includes(' ' + k + ' ');
  }
  function scoreLoad(inq, load, text) {
    let s = 0; const why = [];
    const picks = load.picks.length ? load.picks : [load.origin], drops = load.drops.length ? load.drops : [load.dest];
    if (inq.lane) {
      if (samePlace(inq.lane.o, load.origin)) { s += 50; why.push('pickup'); }
      else if (picks.some(p => samePlace(inq.lane.o, p))) { s += 45; why.push('pickup stop'); }
      else if (stateKey(inq.lane.o.state) === stateKey(load.origin.state)) s += 6;
      if (samePlace(inq.lane.d, load.dest)) { s += 50; why.push('delivery'); }
      else if (drops.some(p => samePlace(inq.lane.d, p)) || picks.some(p => samePlace(inq.lane.d, p))) { s += 45; why.push('delivery stop'); }
      else if (stateKey(inq.lane.d.state) === stateKey(load.dest.state)) s += 6;
    } else {
      // no clean lane in the email ("TROUTDALE TO OROVILLE", "OR to CA"): look for the load's cities / states in it
      const oc = wordIn(text, load.origin.city), dc = wordIn(text, load.dest.city);
      if (oc) { s += 40; why.push('pickup city'); }
      if (dc) { s += 40; why.push('delivery city'); }
      const st = new Set((text.match(/\b[A-Z]{2}\b/g) || []).filter(x => STATES.has(x)));
      if (!oc && st.has(stateKey(load.origin.state))) s += 12;
      if (!dc && st.has(stateKey(load.dest.state))) s += 12;
    }
    if (inq.date && load.pickupDate) { if (inq.date === load.pickupDate) { s += 10; why.push('date'); } else s -= Math.min(10, Math.abs(new Date(inq.date) - new Date(load.pickupDate)) / 864e5 * 2); }
    if (inq.source === 'truckstop' && load.boards.length && !load.boards.includes('truckstop')) s -= 15;
    if (inq.source === 'dat' && load.boards.length && !load.boards.includes('dat')) s -= 15;
    if (inq.equipment && load.equipment) { const ci = eqClass({ equipment: inq.equipment }), cl = eqClass(load); if (inq.equipment === load.equipment) s += 5; else if (ci && cl && ci !== cl && !(ci === 'van' && cl === 'reefer' && inq.equipment === 'vanreefer')) s -= 10; }
    // the carrier quoted the load's reference # (Salesforce load #, PO, DAT / Truckstop reference): that's the load
    if (inq.refs && inq.refs.length) { const mine = new Set([load.ref, ...(load.refs || []), load.sf && load.sf.name, ...Object.values(load.ids || {}).map(v => String(v).split('@')[0])].filter(Boolean).map(refKey).filter(k => k.length >= 4)); if (inq.refs.some(r => mine.has(refKey(r)))) { s += 90; why.push('ref #'); } }
    if (inq.postedRate && load.rate && Math.abs(inq.postedRate - load.rate) < 1) { s += 10; why.push('rate'); }
    if (inq.miles && load.miles && Math.abs(inq.miles - load.miles) <= Math.max(10, load.miles * 0.05)) s += 5;
    if (load.down) s -= 20;
    if (load.covered || load.cancelled) s -= 5; // an open load on the same lane wins over a covered one
    // newer posts first when everything else is equal
    s += Math.max(0, 3 - (Date.now() - new Date(load.postedAt || 0)) / 864e5);
    return { s: Math.round(s), why };
  }
  function match(inq, book) {
    const text = [inq.subject, newPart(inq.body || '')].join('\n');
    const ranked = (book || []).map(load => Object.assign({ load }, scoreLoad(inq, load, text))).filter(r => r.s > 15).sort((a, b) => b.s - a.s);
    const top = ranked[0];
    let sure = !!top && (top.s >= 85 || (top.s >= 60 && (!ranked[1] || top.s - ranked[1].s >= 20)));
    // no lane in the email: only pick a load when BOTH its cities are named (a city in a signature or address isn't enough)
    if (sure && !inq.lane && !(top.why.includes('pickup city') && top.why.includes('delivery city')) && !top.why.includes('ref #')) sure = false;
    if (top && top.why.includes('ref #') && (!ranked[1] || !ranked[1].why.includes('ref #'))) sure = true;
    // "OR to CA" in the subject: the only load you have up between those two states
    if (!sure && top && !inq.lane && /\b[A-Z]{2}\s+to\s+[A-Z]{2}\b/.test(inq.subject || '') && top.s >= 24 && ranked.filter(r => r.s >= 24).length === 1) sure = true;
    return { ranked: ranked.slice(0, 8), best: sure ? top.load : null, sure };
  }

  // ---------- the reply (TRUCKR's format, plus the extra lines coworkers' loads need) ----------
  function sourceOf(inq, load) {
    if (inq && inq.source) return inq.source;
    if (load) {
      if (/van|reefer|box|sprinter/i.test(load.equipment || load.equipmentName)) return 'dat'; // dry van / box truck posts go to DAT only
      if (load.boards.length === 1) return load.boards[0];
    }
    return '';
  }
  // DAT posts often carry no delivery date: estimate it from the trip (about 500 mi a day; short runs deliver the same day)
  function estDelivery(puIso, miles, load) {
    const m = String(puIso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return '';
    let days = 1;
    if (miles > 0) days = miles <= 250 ? 0 : Math.ceil((miles - 250) / 500);
    else if (load && load.origin && load.dest && stateKey(load.origin.state) === stateKey(load.dest.state)) days = 0;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function buildReply(load, inq, settings) {
    const S = Object.assign({}, DEFAULTS, settings || {});
    if (load.covered || load.cancelled) return [S.greeting, '', S.coveredText].filter((x, i) => x || i === 1).join('\n');
    const src = sourceOf(inq, load);
    const H = (src === 'truckstop' ? [load.hours.ts, load.hours.dat] : [load.hours.dat, load.hours.ts]).find(h => h && (h.pu || h.del)) || {};
    const one = h => String(h || '').replace(/^(\d{1,2}:\d{2})\s*-\s*\1$/, '$1'); // an appointment ("20:00-20:00") reads as one time
    const pu = one(H.pu || S.puHours), del = one(H.del || S.delHours);
    const dt = iso => S.showDates && iso ? md(iso) + ' ' : '';
    const puDate = load.pickupDate || (inq && inq.date) || '';
    const delDate = load.deliveryDate || estDelivery(puDate, load.miles || (inq && inq.miles), load);
    const D = details(load);
    const L = [];
    if (S.greeting) L.push(S.greeting, '');
    const picks = load.picks.length ? load.picks : [load.origin], drops = load.drops.length ? load.drops : [load.dest];
    const multi = picks.length + drops.length > 2;
    if (multi) L.push(`${picks.length} PU ${drops.length} DEL`);
    L.push(`PU ${dt(puDate)}${pu}`);
    L.push(`DEL ${dt(delDate)}${del}`);
    const eq = eqName(load);
    if (S.showEquipment && eq) L.push(`Equipment - ${eq}${D.team ? ' (team)' : ''}${D.partial ? ' (partial)' : ''}`);
    if (S.showTemp && D.temp) L.push(`Temp - ${D.temp}`);
    L.push(`Weight - ${load.weight ? Math.round(load.weight).toLocaleString('en-US') + ' lbs' : ''}`);
    L.push(`Length - ${load.length ? Math.round(load.length) + "'" : ''}${!S.showEquipment && D.partial ? ' (partial)' : ''}`);
    if (S.showPieces && D.pieces) L.push(D.pieces);
    if (S.showPieces && D.dims) L.push(`Dims - ${D.dims}`);
    if (load.commodity) L.push(`Commodity - ${load.commodity}`); // no commodity: leave the line out
    L.push(load.rate ? `Rate - ${money(load.rate)}` : 'Please advise your best rate'); // no target rate: ask the carrier
    const acc = accessorials(load);
    let lines = acc.lines.slice();
    if (D.hazmat) lines = lines.map(x => x === 'Hazmat' ? D.hazmat : x);
    if (S.showEquipment && D.team) lines = lines.filter(x => x !== 'Team required');
    if (S.showTemp && D.temp) lines = lines.filter(x => x !== 'Protect from freezing');
    const openDeck = OPEN_DECK.test(load.equipment + ' ' + load.equipmentName);
    if (S.noTarpLine && openDeck && !acc.keys.has('tarps') && !acc.keys.has('notarps')) lines.push('No tarps - strap n go');
    if (acc.keys.has('notarps')) { const i = lines.indexOf('No tarps'); if (i >= 0) lines[i] = 'No tarps - strap n go'; }
    lines.forEach(x => L.push(x));
    // handling notes posted with the load ("Sheets on Skids – Forklift Side Unload"), minus anything already said above
    const said = new Set(lines.map(x => x.toLowerCase()));
    const usedRe = [D.temp && TEMP_RE, D.temp && /\b(?:continuous|cycle|frozen|pre[\s-]*cool|pulp)/i, D.pieces && PIECES_RE, D.dims && DIMS_RE, D.hazmat && /\bclass\s*\d|\b(?:UN|NA)\s*-?\s*\d{4}\b/i].filter(Boolean);
    const extra = clean(String([load.notes, load.sfNotes].filter(v => typeof v === 'string' && v).join(' · ')).replace(/\[object Object\]/g, ' ').split(/\n|·|;|,(?!\d)|\s[-–]\s/).map(s => clean(s)).filter(s => s && s.length < 160 && !/^\d+\s*(?:pu|del)\b/i.test(s) && !/^\d+\s*drops?$/i.test(s) && !(s.length < 40 && NOTE_ACC.some(([re]) => re.test(s))) && !(s.length < 40 && usedRe.some(re => re.test(s))) && !said.has(s.toLowerCase())).join(' · '));
    if (extra) L.push(extra);
    if (multi) {
      L.push('');
      picks.forEach((p, i) => L.push(`${i + 1} PU ${placeText(p)}`));
      drops.forEach((p, i) => L.push(`${i + 1} DEL ${placeText(p)}`));
    }
    if (S.showRef) { const r = load.ref || (load.sf && load.sf.name) || ''; if (r) L.push('', `Ref # ${String(r).replace(/^Load-/i, '')}`); }
    return L.join('\n').replace(/\[object Object\],?\s*/g, '').replace(/\n{3,}/g, '\n\n');
  }
  // what's still blank in the reply (the bar asks for these before sending)
  function missing(load) { return ['weight', 'length', 'commodity'].filter(k => !load[k]); }

  return { setMe, repliedRe, isOurs, eqKey, eqName, details, smartDedupe, sameLoad, useSf, fromSalesforce, sfSame, DEFAULTS, setRules, parseInquiry, match, buildReply, buildBook, missing, laneText, placeText, uidOf, cityStates, newPart, hoursRange, fromSpotr, fromTruckstop, fromDat, sourceOf, md, money, accessorials, titleCase, samePlace };
})();
if (typeof module !== 'undefined') module.exports = TR;
