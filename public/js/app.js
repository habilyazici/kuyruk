// Kuyruk Kronometresi: durum, ekran, ayarlar, dışa aktarma ve hesap eşitlemesi.

import { makeXlsx } from './excel.js';
import { firebaseConfig } from './config.js';
import { connectFirebase } from './firebase.js';

var KEY = 'kuyruk-kronometresi-v2', OLD_KEY = 'kuyruk-kronometresi-v1', MAX_STAGE = 3, MAX_TYPE = 4;
var $ = function (id) { return document.getElementById(id); };
var IC_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
var IC_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
var IC_X ='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function rid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* ---------- durum ----------
   müşteri: { id, n, a: geliş, t: tip|null, p: [{ g: aşama, q: sıraya giriş, s: başlama, e: bitiş }], x: silindi }
   ayar:    { stages: [{ id, name, auto, k: görevli }], types: [{ id, name, skip: [geçmediği aşamalar] }], cols: { anahtar: ad } }
   geri al: her işlem bir adım listesi ([{ o: add|s|e|p|x, id }]); geri alınırken tersten çözülür. */
/* m: bu cihazdaki son değişiklik anı; sy: hesaba en son yazılan sürümün anı; su: o hesabın kimliği. */
function fresh() { return { c: [], u: [], m: 0, sy: 0, su: '', cfg: { stages: [{ id: 's1', name: '', auto: true, k: 1 }], types: [], cols: {}, vis: {} } }; }
function okRecords(list) { return (Array.isArray(list) ? list : []).filter(function (c) { return c && Array.isArray(c.p) && c.p.length; }); }
function readCfg(src, cfg) {
  if (!src || !Array.isArray(src.stages) || !src.stages.length) return;
  cfg.stages = src.stages.slice(0, MAX_STAGE);
  cfg.types = (Array.isArray(src.types) ? src.types : []).slice(0, MAX_TYPE);
  cfg.types.forEach(function (t) { if (!Array.isArray(t.skip)) t.skip = []; });
  cfg.cols = src.cols && typeof src.cols === 'object' ? src.cols : {};
  cfg.vis = src.vis && typeof src.vis === 'object' ? src.vis : {};
}
function load() {
  var s = fresh();
  try {
    var j = JSON.parse(localStorage.getItem(KEY));
    if (j && Array.isArray(j.c)) {
      s.c = okRecords(j.c);
      s.u = (Array.isArray(j.u) ? j.u : []).filter(Array.isArray);
      s.m = j.m || 0; s.sy = j.sy || 0; s.su = j.su || '';
      readCfg(j.cfg, s.cfg);
      return s;
    }
    var o = JSON.parse(localStorage.getItem(OLD_KEY));
    if (o && Array.isArray(o.c)) {
      s.c = o.c.map(function (c) { return { id: c.id, n: c.n, a: c.a, t: null, p: [{ g: 's1', q: c.a, s: c.s || null, e: c.e || null }], x: !!c.x }; });
    }
  } catch (e) {}
  return s;
}
var st = load();
function persist() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
function save() { st.m = Date.now(); persist(); queuePush(); }

function pad(n) { return (n < 10 ? '0' : '') + n; }
function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function find(id) { for (var i = 0; i < st.c.length; i++) if (st.c[i].id === id) return st.c[i]; return null; }
function pushUndo(ops) { st.u.push(ops); if (st.u.length > 80) st.u.shift(); }
function cur(c) { return c.p[c.p.length - 1]; }
function stageName(i) { return (st.cfg.stages[i].name || '').trim() || ('Aşama ' + (i + 1)); }
function typeName(i) { return (st.cfg.types[i].name || '').trim() || ('Tip ' + (i + 1)); }
function typeIndex(id) { for (var i = 0; i < st.cfg.types.length; i++) if (st.cfg.types[i].id === id) return i; return -1; }
function routeOf(typeId) {
  var i = typeIndex(typeId), t = i < 0 ? null : st.cfg.types[i];
  return st.cfg.stages.filter(function (s) { return !t || t.skip.indexOf(s.id) < 0; });
}

/* Bir aşamadaki durum: hizmetteki sayısı ve sıra kuralına göre dizilmiş bekleyenler (ilk eleman sıradaki).
   Sıra kuralı d: 'f' FIFO (varsayılan), 'l' LIFO, 'x' serbest. */
function lineOf(s) {
  var busy = 0, q = [];
  st.c.forEach(function (c) {
    if (c.x) return;
    var k = cur(c); if (k.g !== s.id || k.e) return;
    if (k.s) busy++; else q.push(c);
  });
  q.sort(function (a, b) { return cur(a).q - cur(b).q; });
  if (s.d === 'l') q.reverse();
  return { busy: busy, q: q };
}
/* Otomatik aşamalarda görevli boşsa sıradaki müşterinin hizmetini başlatır. Serbest sırada aday tek değilse seçim kullanıcıdadır. */
function settle(now, ops) {
  st.cfg.stages.forEach(function (s) {
    if (s.auto === false) return;
    var cap = Math.max(1, s.k || 1), ln = lineOf(s), busy = ln.busy, q = ln.q;
    if (s.d === 'x' && q.length > 1) return;
    while (busy < cap && q.length) { var c = q.shift(); cur(c).s = now; ops.push({ o: 's', id: c.id }); busy++; }
  });
}
/* Bekleyen bir karta dokunuldu: kurala uymuyorsa nedenini döndürür, uyuyorsa boş metin. */
function startIssue(c) {
  var k = cur(c), s = null;
  st.cfg.stages.forEach(function (g) { if (g.id === k.g) s = g; });
  if (!s) return '';
  var ln = lineOf(s);
  if (s.auto !== false && ln.busy >= Math.max(1, s.k || 1)) return 'Görevli dolu. ' + c.n + ' numara yine de başlasın mı?';
  if (s.d === 'x' || !ln.q.length || ln.q[0].id === c.id) return '';
  return 'Sıra ' + (s.d === 'l' ? 'LIFO' : 'FIFO') + ', önce ' + ln.q[0].n + ' numara. ' + c.n + ' numara öne geçsin mi?';
}
function tapChip(id) {
  var c = find(id); if (!c || c.x) return;
  var k = cur(c); if (k.e) return;
  var why = k.s ? '' : startIssue(c);
  if (why) ask(why, function () { advance(id); }); else advance(id);
}
function addCustomer(typeId) {
  var r = routeOf(typeId); if (!r.length) return;
  var now = Date.now(), k = dayKey(now), n = 0;
  st.c.forEach(function (c) { if (dayKey(c.a) === k && c.n > n) n = c.n; });
  var c = { id: rid('c'), n: n + 1, a: now, t: typeId || null, p: [{ g: r[0].id, q: now, s: null, e: null }], x: false };
  var ops = [{ o: 'add', id: c.id }];
  st.c.push(c); settle(now, ops); pushUndo(ops); commit();
}
function advance(id) {
  var c = find(id); if (!c || c.x) return;
  var k = cur(c); if (k.e) return;
  var now = Date.now(), ops;
  if (!k.s) { k.s = now; ops = [{ o: 's', id: id }]; }
  else {
    k.e = now; ops = [{ o: 'e', id: id }];
    var r = routeOf(c.t), nx = null;
    for (var i = 0; i < r.length - 1; i++) if (r[i].id === k.g) nx = r[i + 1];
    if (nx) { c.p.push({ g: nx.id, q: now, s: null, e: null }); ops.push({ o: 'p', id: id }); }
    settle(now, ops);
  }
  pushUndo(ops); commit();
}
function removeCustomer(id) {
  var c = find(id); if (!c || c.x) return;
  var ops = [{ o: 'x', id: id }];
  c.x = true; settle(Date.now(), ops); pushUndo(ops);
  buzz(18); commit();
}
function undo() {
  var ops = st.u.pop(); if (!ops) return;
  for (var i = ops.length - 1; i >= 0; i--) {
    var u = ops[i], c = find(u.id); if (!c) continue;
    if (u.o === 'add') st.c = st.c.filter(function (q) { return q.id !== u.id; });
    else if (u.o === 's') cur(c).s = null;
    else if (u.o === 'e') cur(c).e = null;
    else if (u.o === 'p') { if (c.p.length > 1) c.p.pop(); }
    else if (u.o === 'x') c.x = false;
  }
  commit();
}
function wipe() { st.c = []; st.u = []; commit(); }
function commit() { save(); render(); }

/* ---------- çizim ---------- */
var boxes = [], tags = {}, firstPaint = true, doneVal = 0;
var EASE = 'cubic-bezier(.2, .8, .2, 1)';
var motionOK = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) && typeof document.body.animate === 'function';
function mmss(ms) { var s = Math.max(0, Math.floor(ms / 1000)); return pad(Math.floor(s / 60)) + ':' + pad(s % 60); }
function shortTags() {
  var names = st.cfg.types.map(function (t, i) { return typeName(i).toLocaleUpperCase('tr'); }), out = {};
  st.cfg.types.forEach(function (t, i) {
    var len = 1;
    while (len < 3 && names.some(function (n, j) { return j !== i && n.slice(0, len) === names[i].slice(0, len); })) len++;
    out[t.id] = names[i].slice(0, len);
  });
  return out;
}
function zone(cls, label) {
  var sec = el('section', 'zone ' + cls), h = el('h2'), n = el('b', '', '0'), box = el('div', 'chips');
  sec.setAttribute('aria-label', label);
  h.appendChild(el('span', '', label)); h.appendChild(n); sec.appendChild(h); sec.appendChild(box);
  return { sec: sec, n: n, box: box };
}
function addButton(typeId, label) {
  var b = el('button', 'add' + (typeId ? ' pill' : '')); b.type = 'button'; b.dataset.type = typeId || '';
  b.innerHTML = IC_PLUS;
  if (typeId) b.appendChild(el('span', '', label));
  b.setAttribute('aria-label', typeId ? label + ' müşterisi geldi' : 'Müşteri geldi');
  return b;
}
function buildFrame() {
  var z = $('zones'), stages = st.cfg.stages, multi = stages.length > 1;
  z.textContent = ''; boxes = []; tags = shortTags();
  z.classList.toggle('tight', stages.length >= 3);
  if (!multi) {
    var a = zone('serve', 'Hizmette'), b = zone('wait', 'Sırada');
    z.appendChild(a.sec); z.appendChild(b.sec);
    boxes.push({ serve: a.box, wait: b.box, nS: a.n, nW: b.n });
  } else {
    stages.forEach(function (s, i) {
      var sec = el('section', 'zone'), h = el('h2'), nS = el('b', '', '0'), nW = el('b', '', '0'), box = el('div', 'chips');
      var d1 = el('i', 'dot on'), d2 = el('i', 'dot');
      sec.setAttribute('aria-label', stageName(i));
      d1.setAttribute('role', 'img'); d1.setAttribute('aria-label', 'hizmette'); d2.setAttribute('role', 'img'); d2.setAttribute('aria-label', 'sırada');
      h.appendChild(el('span', '', stageName(i))); h.appendChild(d1); h.appendChild(nS); h.appendChild(d2); h.appendChild(nW);
      sec.appendChild(h); sec.appendChild(box); z.appendChild(sec);
      boxes.push({ serve: box, wait: box, nS: nS, nW: nW });
    });
  }
  var d = $('dock'); d.textContent = '';
  if (!st.cfg.types.length) d.appendChild(addButton(null, ''));
  else st.cfg.types.forEach(function (t, i) { d.appendChild(addButton(t.id, typeName(i))); });
}
function chip(c, on) {
  var k = cur(c), b = el('button', 'chip' + (on ? ' on' : '')), tg = c.t ? tags[c.t] : '', ti = typeIndex(c.t);
  b.type = 'button'; b.dataset.id = c.id; b.dataset.from = on ? k.s : k.q;
  b.setAttribute('aria-label', c.n + ' numaralı müşteri' + (ti < 0 ? '' : ', ' + typeName(ti)) + (on ? ', hizmette. Dokun: hizmet bitti.' : ', sırada. Dokun: hizmet başladı.'));
  if (tg) b.appendChild(el('span', 'tag', tg));
  b.appendChild(el('span', 'no', c.n));
  b.appendChild(el('span', 't', mmss(Date.now() - Number(b.dataset.from))));
  return b;
}
function ghost(box) { var g = el('div', 'ghost'); g.setAttribute('aria-hidden', 'true'); box.appendChild(g); }

/* Geçişler: kart eski yerinden yenisine kayar; biten kart sayaca uçar. */
function snapshot() {
  var m = {}, cs = document.querySelectorAll('#zones .chip');
  for (var i = 0; i < cs.length; i++) m[cs[i].dataset.id] = { r: cs[i].getBoundingClientRect(), n: cs[i], box: cs[i].parentNode };
  return m;
}
function floater(node, r) {
  var g = node.cloneNode(true); g.classList.add('fly'); g.removeAttribute('data-id'); g.setAttribute('aria-hidden', 'true'); g.tabIndex = -1;
  g.style.left = r.left + 'px'; g.style.top = r.top + 'px'; g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
  document.body.appendChild(g); return g;
}
function bumpDone() {
  $('doneN').textContent = doneVal;
  $('doneBox').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.45)', color: 'var(--go)' }, { transform: 'scale(1)' }], { duration: 340, easing: 'ease-out' });
}
function animate(prev) {
  var seen = {}, flying = 0, cs = document.querySelectorAll('#zones .chip');
  for (var i = 0; i < cs.length; i++) (function (b) {
    var id = b.dataset.id, p = prev[id], r1 = b.getBoundingClientRect(); seen[id] = 1;
    if (!p) { b.animate([{ transform: 'translateY(28px) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: EASE }); return; }
    var dx = p.r.left - r1.left, dy = p.r.top - r1.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    var move = [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }];
    if (p.box === b.parentNode) { b.animate(move, { duration: 240, easing: EASE }); return; }
    var g = floater(b, r1), a = g.animate(move, { duration: 320, easing: EASE });
    b.style.visibility = 'hidden';
    a.onfinish = a.oncancel = function () { g.remove(); b.style.visibility = ''; };
  })(cs[i]);
  Object.keys(prev).forEach(function (id) {
    if (seen[id]) return;
    var p = prev[id], c = find(id), g = floater(p.n, p.r), a;
    if (c && !c.x && cur(c).e) {
      var t = $('doneBox').getBoundingClientRect();
      var dx = t.left + t.width / 2 - (p.r.left + p.r.width / 2), dy = t.top + t.height / 2 - (p.r.top + p.r.height / 2);
      flying++;
      a = g.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.18)', opacity: .25 }], { duration: 440, easing: 'cubic-bezier(.5, 0, .3, 1)' });
      a.onfinish = a.oncancel = function () { g.remove(); bumpDone(); };
    } else {
      a = g.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }], { duration: 170, easing: 'ease-in' });
      a.onfinish = a.oncancel = function () { g.remove(); };
    }
  });
  return flying;
}
function render(noAnim) {
  var prev = (noAnim || firstPaint || !motionOK) ? null : snapshot();
  var today = dayKey(Date.now()), done = 0, idx = {};
  var per = st.cfg.stages.map(function (s, i) { idx[s.id] = i; return { w: [], s: [] }; });
  st.c.forEach(function (c) {
    if (c.x) return;
    var k = cur(c);
    if (k.e) { if (dayKey(c.a) === today) done++; return; }
    var i = idx[k.g]; if (i === undefined) return;
    (k.s ? per[i].s : per[i].w).push(c);
  });
  per.forEach(function (p, i) {
    var bx = boxes[i]; if (!bx) return;
    p.w.sort(function (a, b) { return cur(a).q - cur(b).q; });
    p.s.sort(function (a, b) { return cur(a).s - cur(b).s; });
    bx.serve.textContent = ''; bx.wait.textContent = '';
    p.s.forEach(function (c) { bx.serve.appendChild(chip(c, true)); });
    p.w.forEach(function (c) { bx.wait.appendChild(chip(c, false)); });
    if (bx.serve === bx.wait) { if (!p.s.length && !p.w.length) ghost(bx.serve); }
    else { if (!p.s.length) ghost(bx.serve); if (!p.w.length) ghost(bx.wait); }
    bx.nS.textContent = p.s.length; bx.nW.textContent = p.w.length;
  });
  doneVal = done; firstPaint = false;
  if (!(prev && animate(prev))) $('doneN').textContent = done;
  $('btnUndo').disabled = !st.u.length;
  $('doneBox').classList.toggle('empty', !st.c.some(function (c) { return !c.x; }));
}
function tick() {
  var d = new Date(), now = d.getTime();
  $('clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  var cs = document.querySelectorAll('.chip');
  for (var i = 0; i < cs.length; i++) cs[i].lastChild.textContent = mmss(now - Number(cs[i].dataset.from));
}

/* ---------- sütunlar ve dışa aktarma ---------- */
function columns() {
  var stages = st.cfg.stages, multi = stages.length > 1, out = [['date', 'Tarih', 12], ['no', 'Sıra No', 8]];
  if (st.cfg.types.length) out.push(['type', 'Tip', 12]);
  out.push(['arr', 'Geliş Saati', 12], ['ia', 'Gelişler Arası Süre (dk)', 15]);
  stages.forEach(function (s, i) { var n = stageName(i); out.push(['w:' + s.id, multi ? n + ' Bekleme (dk)' : 'Kuyrukta Bekleme (dk)', 15], ['d:' + s.id, multi ? n + ' Süresi (dk)' : 'Hizmet Süresi (dk)', 14]); });
  stages.forEach(function (s, i) { var n = stageName(i); out.push(['b:' + s.id, multi ? n + ' Başlama' : 'Hizmete Başlama', 14], ['f:' + s.id, multi ? n + ' Bitiş' : 'Hizmet Bitiş', 12]); });
  return out;
}
function headText(col) { return (st.cfg.cols[col[0]] || '').trim() || col[1]; }
/* Varsayılan: ham başlama ve bitiş saatleri kapalı, diğer sütunlar açık. */
function colOn(col) { var v = st.cfg.vis[col[0]]; return v === undefined ? !/^[bf]:/.test(col[0]) : !!v; }
function r2(x) { return Math.round(x * 100) / 100; }
function buildTable(list) {
  var stages = st.cfg.stages, hasT = st.cfg.types.length > 0;
  var cols = columns(), keep = cols.map(colOn);
  var head = cols.filter(function (c, i) { return keep[i]; }).map(function (c) { return [headText(c), c[2]]; });
  var live = list.filter(function (c) { return !c.x; }).sort(function (a, b) { return a.a - b.a; });
  var rows = [], prevDay = null, prevA = null, no = 0;
  live.forEach(function (c) {
    var k = dayKey(c.a);
    if (k !== prevDay) { prevDay = k; prevA = null; no = 0; }
    no++;
    var cells = [{ k: 'd', v: c.a }, { k: 'i', v: no }], by = {};
    if (hasT) { var ti = typeIndex(c.t); cells.push(ti < 0 ? null : { k: 's', v: typeName(ti) }); }
    cells.push({ k: 't', v: c.a }, prevA === null ? null : { k: 'n', v: r2((c.a - prevA) / 60000) });
    c.p.forEach(function (p) { by[p.g] = p; });
    stages.forEach(function (s) { var p = by[s.id]; cells.push(p && p.s ? { k: 'n', v: r2((p.s - p.q) / 60000) } : null, p && p.s && p.e ? { k: 'n', v: r2((p.e - p.s) / 60000) } : null); });
    stages.forEach(function (s) { var p = by[s.id]; cells.push(p && p.s ? { k: 't', v: p.s } : null, p && p.e ? { k: 't', v: p.e } : null); });
    rows.push(cells.filter(function (x, i) { return keep[i]; })); prevA = c.a;
  });
  return { head: head, rows: rows };
}
function hms(ts) { var d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function buildTsv(tb) {
  var out = [tb.head.map(function (h) { return h[0]; }).join('\t')];
  tb.rows.forEach(function (cells) {
    out.push(cells.map(function (c) {
      if (!c) return '';
      if (c.k === 'd') { var d = dayKey(c.v).split('-'); return d[2] + '.' + d[1] + '.' + d[0]; }
      if (c.k === 't') return hms(c.v);
      if (c.k === 'n') return c.v.toFixed(2).replace('.', ',');
      return String(c.v).replace(/[\t\n]/g, ' ');
    }).join('\t'));
  });
  return out.join('\n');
}


function exportData() {
  var tb = buildTable(st.c);
  if (!tb.rows.length) { toast('Kayıt yok'); return; }
  var blob = makeXlsx(tb), filename = 'kuyruk-verisi-' + dayKey(Date.now()) + '.xlsx';
  /* Telefonda paylaşım penceresi, bilgisayarda doğrudan indirme; ikisi de olmazsa kopyalanacak tablo. */
  try {
    var file = null, touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.share && typeof File === 'function') {
      file = new File([blob], filename, { type: blob.type });
      if (!navigator.canShare({ files: [file] })) file = null;
    }
    if (!file) { download(blob, filename); return; }
    navigator.share({ files: [file] }).then(function () { toast('Paylaşıldı'); }, function (err) {
      if (err && err.name === 'AbortError') return;
      try { download(blob, filename); } catch (e) { showCopy(tb); }
    });
  } catch (e) { showCopy(tb); }
}
function download(blob, filename) {
  var url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  toast('İndirildi');
}

/* ---------- ayarlar ---------- */
function field(value, placeholder, label) {
  var i = el('input', 'inp'); i.type = 'text'; i.value = value || ''; i.placeholder = placeholder; i.maxLength = 30;
  i.setAttribute('aria-label', label); i.autocomplete = 'off';
  i.addEventListener('keydown', function (e) { if (e.key === 'Enter') i.blur(); });
  return i;
}
function xButton(label, fn) { var b = el('button', 'x'); b.type = 'button'; b.innerHTML = IC_X; b.setAttribute('aria-label', label); b.addEventListener('click', fn); return b; }
function refreshNames() {
  var t = document.querySelectorAll('#typeList .tog'), i;
  for (i = 0; i < t.length; i++) t[i].textContent = stageName(Number(t[i].dataset.si));
  var cols = columns(), c = document.querySelectorAll('#colList .inp');
  for (i = 0; i < c.length && i < cols.length; i++) c[i].placeholder = cols[i][1];
}
function drawSettings() {
  var sl = $('stageList'), tl = $('typeList'), cl = $('colList'), stages = st.cfg.stages, types = st.cfg.types, multi = stages.length > 1, lk = st.c.length > 0;
  sl.textContent = ''; tl.textContent = ''; cl.textContent = '';
  stages.forEach(function (s, i) {
    var wrap = el('div', 'item'), row = el('div', 'row'), inp = field(s.name, 'Aşama ' + (i + 1), 'Aşama adı');
    inp.maxLength = 14;
    inp.addEventListener('input', function () { s.name = inp.value; save(); refreshNames(); });
    row.appendChild(inp);
    if (multi && !lk) row.appendChild(xButton('Aşamayı sil', function () {
      st.cfg.stages.splice(i, 1);
      st.cfg.types.forEach(function (t) { t.skip = t.skip.filter(function (g) { return g !== s.id; }); if (t.skip.length >= st.cfg.stages.length) t.skip = []; });
      ['w:', 'd:', 'b:', 'f:'].forEach(function (p) { delete st.cfg.cols[p + s.id]; delete st.cfg.vis[p + s.id]; });
      save(); drawSettings();
    }));
    var opts = el('div', 'togs'), auto = s.auto !== false, tg = el('button', 'tog', 'Otomatik');
    tg.type = 'button'; tg.setAttribute('aria-pressed', auto ? 'true' : 'false');
    tg.addEventListener('click', function () { s.auto = !auto; save(); drawSettings(); });
    opts.appendChild(tg);
    if (auto) {
      var lab = el('label', 'kl'), num = el('input', 'inp num');
      num.type = 'number'; num.min = 1; num.max = 99; num.inputMode = 'numeric'; num.value = s.k || 1;
      num.addEventListener('input', function () { var v = parseInt(num.value, 10); if (v >= 1) { s.k = Math.min(99, v); save(); } });
      num.addEventListener('blur', function () { num.value = s.k || 1; });
      lab.appendChild(el('span', '', 'Görevli sayısı')); lab.appendChild(num); opts.appendChild(lab);
    }
    var seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Sıra kuralı');
    [['f', 'FIFO'], ['l', 'LIFO'], ['x', 'Serbest']].forEach(function (o) {
      var b = el('button', 'segb', o[1]); b.type = 'button'; b.setAttribute('aria-pressed', (s.d || 'f') === o[0] ? 'true' : 'false');
      b.addEventListener('click', function () { s.d = o[0]; save(); drawSettings(); });
      seg.appendChild(b);
    });
    opts.appendChild(seg);
    wrap.appendChild(row); wrap.appendChild(opts); sl.appendChild(wrap);
  });
  types.forEach(function (t, i) {
    var wrap = el('div', 'item'), row = el('div', 'row'), inp = field(t.name, 'Tip ' + (i + 1), 'Tip adı');
    inp.maxLength = 14;
    inp.addEventListener('input', function () { t.name = inp.value; save(); });
    row.appendChild(inp);
    if (!lk) row.appendChild(xButton('Tipi sil', function () { st.cfg.types.splice(i, 1); save(); drawSettings(); }));
    wrap.appendChild(row);
    if (multi) {
      var togs = el('div', 'togs'); togs.setAttribute('role', 'group'); togs.setAttribute('aria-label', 'Bu tipin geçtiği aşamalar');
      stages.forEach(function (s, j) {
        var on = t.skip.indexOf(s.id) < 0, b = el('button', 'tog', stageName(j));
        b.type = 'button'; b.disabled = lk; b.dataset.si = j; b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.addEventListener('click', function () {
          if (on) { if (t.skip.length >= st.cfg.stages.length - 1) return; t.skip.push(s.id); }
          else t.skip = t.skip.filter(function (g) { return g !== s.id; });
          save(); drawSettings();
        });
        togs.appendChild(b);
      });
      wrap.appendChild(togs);
    }
    tl.appendChild(wrap);
  });
  columns().forEach(function (c) {
    var row = el('div', 'row'), ck = el('button', 'ck'), inp = field(st.cfg.cols[c[0]], c[1], 'Sütun adı');
    ck.type = 'button'; ck.innerHTML = IC_CHECK; ck.setAttribute('aria-label', c[1] + ' sütunu Excel\'de olsun');
    ck.setAttribute('aria-pressed', colOn(c) ? 'true' : 'false'); inp.classList.toggle('off', !colOn(c));
    ck.addEventListener('click', function () {
      var on = colOn(c);
      if (on && columns().filter(colOn).length <= 1) return;
      st.cfg.vis[c[0]] = !on; save();
      ck.setAttribute('aria-pressed', on ? 'false' : 'true'); inp.classList.toggle('off', on);
    });
    inp.addEventListener('input', function () { if (inp.value.trim()) st.cfg.cols[c[0]] = inp.value; else delete st.cfg.cols[c[0]]; save(); });
    row.appendChild(ck); row.appendChild(inp); cl.appendChild(row);
  });
  $('addStage').hidden = stages.length >= MAX_STAGE;
  $('addType').hidden = types.length >= MAX_TYPE;
  $('addStage').setAttribute('aria-disabled', lk ? 'true' : 'false');
  $('addType').setAttribute('aria-disabled', lk ? 'true' : 'false');
  $('lockNote').hidden = !lk;
}
function focusLast(listId) { var i = $(listId).querySelectorAll('input[type="text"]'); if (i.length) i[i.length - 1].focus(); }

/* ---------- menü, panel, bildirim ---------- */
var wipeTimer = null;
function resetWipe() { clearTimeout(wipeTimer); $('miWipe').classList.remove('sure'); $('wipeLabel').textContent = 'Kayıtları sil'; }
function openMenu() { $('menu').hidden = false; $('btnMenu').setAttribute('aria-expanded', 'true'); if (FBC && !fb) loadFb().catch(function () {}); }
function closeMenu() { $('menu').hidden = true; $('btnMenu').setAttribute('aria-expanded', 'false'); resetWipe(); }
function wipeTap() {
  if (!st.c.length) { closeMenu(); toast('Kayıt yok'); return; }
  if ($('miWipe').classList.contains('sure')) { wipe(); closeMenu(); toast('Silindi'); return; }
  $('miWipe').classList.add('sure'); $('wipeLabel').textContent = 'Geri alınamaz. Sil';
  wipeTimer = setTimeout(resetWipe, 4000);
}
var LABELS = { info: 'Bilgi ve varsayımlar', set: 'Ayarlar', copy: 'Tabloyu kopyala' };
function openSheet(which) {
  $('paneInfo').hidden = which !== 'info'; $('paneSet').hidden = which !== 'set'; $('paneCopy').hidden = which !== 'copy';
  $('sheet').setAttribute('aria-label', LABELS[which]);
  if (which === 'set') drawSettings();
  $('scrim').hidden = false; $('btnClose').focus();
}
function closeSheet() {
  if ($('scrim').hidden) return;
  var wasSet = !$('paneSet').hidden;
  $('scrim').hidden = true;
  if (!wasSet) return;
  var ops = []; settle(Date.now(), ops); if (ops.length) pushUndo(ops);
  save(); buildFrame(); render(true);
}
function showCopy(tb) { $('copyBox').value = buildTsv(tb); openSheet('copy'); }
function copyNow() {
  var box = $('copyBox');
  function manual() { box.focus(); box.select(); toast('Seçildi, kopyala'); }
  try { navigator.clipboard.writeText(box.value).then(function () { toast('Kopyalandı'); }, manual); } catch (e) { manual(); }
}
/* Kısa onay penceresi (tarayıcının kendi penceresi yerine sayfa içi). */
var askFn = null, askNoFn = null;
function ask(text, fn, opt) {
  askFn = fn; askNoFn = (opt && opt.noFn) || null;
  $('askText').textContent = text; $('askYes').textContent = (opt && opt.yes) || 'Evet'; $('askNo').textContent = (opt && opt.no) || 'Vazgeç';
  $('ask').hidden = false; $('askYes').focus();
}
/* which: 'yes' | 'no' (düğme) | 'x' (dışına dokunma ya da Esc: hiçbir şey yapılmaz) */
function closeAsk(which) {
  var f = askFn, n = askNoFn; askFn = askNoFn = null; $('ask').hidden = true;
  if (which === 'yes' && f) f(); else if (which === 'no' && n) n();
}

/* ---------- hesap ve eşitleme (config.js boşsa hiç çalışmaz) ----------
   Hesapta tek bir veri kümesi durur: users/{uid}/apps/kuyruk belgesi { t, json }. En son kaydeden geçerlidir.
   Giriş yapılmadıysa ya da Firebase'e ulaşılamazsa uygulama cihazdaki kayıtlarla aynen çalışır. */
var FBC = firebaseConfig && firebaseConfig.apiKey ? firebaseConfig : null, AUTH_KEY = 'kuyruk-kronometresi-giris';
var fb = null, fbLoading = null, user = null, syncState = '', pushTimer = null, lastPull = 0;
function loadFb() {
  if (fbLoading) return fbLoading;
  fbLoading = connectFirebase(FBC).then(function (api) { fb = api; fb.onUser(onUser); return fb; });
  fbLoading.catch(function () { fbLoading = null; });
  return fbLoading;
}
function onUser(u) {
  user = u ? { uid: u.uid, email: u.email || u.displayName || '' } : null;
  try { if (user) localStorage.setItem(AUTH_KEY, '1'); else localStorage.removeItem(AUTH_KEY); } catch (e) {}
  if (user && st.su !== user.uid) { st.su = user.uid; st.sy = 0; persist(); }
  syncState = ''; paintAccount();
  if (user) pull(true);
}
function setSync(s) { syncState = s; paintAccount(); }
function paintAccount() {
  $('miLogin').hidden = !FBC || !!user; $('miAccount').hidden = !user;
  if (user) $('accInfo').textContent = user.email + ({ ok: ' · eşitlendi', busy: ' · eşitleniyor', err: ' · eşitlenemedi' }[syncState] || '');
  /* menü düğmesi: giriş yapıldıysa yeşil çerçeve, eşitlenemediyse kırmızı */
  var mb = $('btnMenu');
  mb.classList.toggle('on', !!user); mb.classList.toggle('err', !!user && syncState === 'err');
  mb.setAttribute('aria-label', user ? 'Menü, giriş yapıldı' : 'Menü');
}
function queuePush() {
  if (!user) return;
  clearTimeout(pushTimer); setSync('busy'); pushTimer = setTimeout(push, 1500);
}
function push() {
  clearTimeout(pushTimer); if (!user || !fb) return;
  /* Yazılan sürüm hesaptakinden hep yeni görünmeli; cihaz saatleri birbirini tutmasa da öteki cihaz bunu yeni sayar. */
  st.m = Math.max(st.m || Date.now(), st.sy + 1);
  var t = st.m, body = JSON.stringify({ c: st.c, cfg: st.cfg });
  if (body.length > 900000) { setSync('err'); toast('Hesap doldu: aktar, kayıtları sil'); return; }
  setSync('busy');
  fb.save(user.uid, { t: t, json: body, n: st.c.length }).then(function () {
    if (t > st.sy) { st.sy = t; persist(); }
    if (st.m > t) queuePush(); else setSync('ok');
  }, function () { setSync('err'); });
}
function adopt(d, j) {
  st.c = okRecords(j.c); st.u = []; readCfg(j.cfg, st.cfg);
  st.m = st.sy = d.t;
  persist(); buildFrame(); render(true); setSync('ok'); toast('Hesaptan yüklendi');
}
function pull(force) {
  if (!user || !fb) return;
  var now = Date.now(); if (!force && now - lastPull < 15000) return;
  lastPull = now; setSync('busy');
  fb.load(user.uid).then(function (d) {
    if (!user) return;
    var j = null; try { j = d && d.json ? JSON.parse(d.json) : null; } catch (e) {}
    if (!j || !Array.isArray(j.c)) { push(); return; }                     /* hesap boş: bu cihazdakini yaz */
    var changed = st.m > st.sy;
    if ((d.t || 0) <= st.sy) { if (changed) push(); else setSync('ok'); return; }   /* hesapta yenisi yok */
    if (!changed || !st.c.length) { adopt(d, j); return; }                 /* bu cihazda kaybedilecek kayıt yok */
    if (!j.c.length) { push(); return; }
    setSync('err');
    ask('Hesabında başka kayıtlar var. Hangisi kalsın?', function () { adopt(d, j); },
      { yes: 'Hesaptaki', no: 'Bu cihazdaki', noFn: function () { st.sy = d.t || 0; push(); } });
  }, function () { setSync('err'); });
}
function signInTap() {
  if (fb) { closeMenu(); fb.signIn().then(null, function (e) { if (!e || !/popup-closed|cancelled/.test(e.code || '')) toast('Giriş yapılamadı'); }); return; }
  toast('Hazırlanıyor');
  loadFb().then(function () { toast('Hazır, tekrar dokun'); }, function () { toast('Bağlantı kurulamadı'); });
}
function signOutTap() { closeMenu(); if (fb) fb.signOut().then(function () { toast('Çıkış yapıldı'); }, function () {}); }
var toastTimer = null;
function toast(msg) { var t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 1700); }
function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

var wl = null;
function keepAwake() {
  try {
    if (!('wakeLock' in navigator) || wl) return;
    navigator.wakeLock.request('screen').then(function (l) { wl = l; l.addEventListener('release', function () { wl = null; }); }, function () {});
  } catch (e) {}
}

/* ---------- olaylar ---------- */
$('dock').addEventListener('click', function (e) {
  var b = e.target.closest('.add'); if (!b) return;
  addCustomer(b.dataset.type || null); buzz(8); keepAwake();
});
$('btnUndo').addEventListener('click', undo);
$('btnMenu').addEventListener('click', function () { if ($('menu').hidden) openMenu(); else closeMenu(); });
$('btnExport').addEventListener('click', function () { closeMenu(); exportData(); });
$('miSet').addEventListener('click', function () { closeMenu(); openSheet('set'); });
$('miInfo').addEventListener('click', function () { closeMenu(); openSheet('info'); });
$('miWipe').addEventListener('click', wipeTap);
$('btnClose').addEventListener('click', closeSheet);
$('btnCopy').addEventListener('click', copyNow);
$('addStage').addEventListener('click', function () {
  if (st.c.length) { toast('Önce kayıtları sil'); return; }
  if (st.cfg.stages.length >= MAX_STAGE) return;
  st.cfg.stages.push({ id: rid('s'), name: '', auto: true, k: 1, d: 'f' }); save(); drawSettings(); focusLast('stageList');
});
$('addType').addEventListener('click', function () {
  if (st.c.length) { toast('Önce kayıtları sil'); return; }
  if (st.cfg.types.length >= MAX_TYPE) return;
  st.cfg.types.push({ id: rid('t'), name: '', skip: [] }); save(); drawSettings(); focusLast('typeList');
});
$('scrim').addEventListener('click', function (e) { if (e.target === $('scrim')) closeSheet(); });
document.addEventListener('pointerdown', function (e) {
  if (!$('menu').hidden && !e.target.closest('#menu') && !e.target.closest('#btnMenu')) closeMenu();
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (!$('ask').hidden) closeAsk('x');
  else if (!$('menu').hidden) { closeMenu(); $('btnMenu').focus(); } else closeSheet();
});
$('askNo').addEventListener('click', function () { closeAsk('no'); });
$('askYes').addEventListener('click', function () { closeAsk('yes'); });
$('ask').addEventListener('click', function (e) { if (e.target === $('ask')) closeAsk('x'); });
$('miLogin').addEventListener('click', signInTap);
$('miAccount').addEventListener('click', signOutTap);
window.addEventListener('online', function () { if (user && st.m > st.sy) push(); });

var zones = $('zones'), holdTimer = null, held = false, px = 0, py = 0;
zones.addEventListener('pointerdown', function (e) {
  var b = e.target.closest('.chip'); if (!b) return;
  held = false; px = e.clientX; py = e.clientY; clearTimeout(holdTimer);
  holdTimer = setTimeout(function () { held = true; removeCustomer(b.dataset.id); }, 600);
});
zones.addEventListener('pointermove', function (e) {
  if (Math.abs(e.clientX - px) > 10 || Math.abs(e.clientY - py) > 10) clearTimeout(holdTimer);
});
['pointerup', 'pointercancel'].forEach(function (ev) {
  window.addEventListener(ev, function () { clearTimeout(holdTimer); if (held) setTimeout(function () { held = false; }, 120); });
});
zones.addEventListener('scroll', function () { clearTimeout(holdTimer); }, true);
zones.addEventListener('click', function (e) {
  var b = e.target.closest('.chip');
  if (held) { held = false; return; }
  if (b) { tapChip(b.dataset.id); buzz(8); }
});
zones.addEventListener('contextmenu', function (e) { if (e.target.closest('.chip')) e.preventDefault(); });
zones.addEventListener('keydown', function (e) {
  var b = e.target.closest('.chip');
  if (b && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeCustomer(b.dataset.id); }
});
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') { tick(); pull(); if (st.c.some(function (c) { return !c.x && !cur(c).e; })) keepAwake(); }
});

buildFrame(); render(); tick(); setInterval(tick, 1000);
paintAccount();
if (FBC) {
  $('storeNote').textContent = 'Kayıtlar otomatik kaydedilir. Giriş yaparsan hesabına da yazılır, başka cihazda geri gelir.';
  var wasIn = null; try { wasIn = localStorage.getItem(AUTH_KEY); } catch (e) {}
  if (wasIn) loadFb().catch(function () {});
}
