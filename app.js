/* Mis Finanzas · app.js
 * Una sola fuente de verdad: tu hoja de Google (vía Apps Script).
 * La app guarda una copia local para trabajar sin internet y una cola de cambios
 * que se envían solos cuando vuelve la conexión.
 */
'use strict';
const VERSION = '2.0.3';
const LS = 'misfinanzas.v1';
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MSHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const WEEK = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const NEEDS = ['Vivienda', 'Servicios básicos', 'Alimentación', 'Transporte', 'Auto', 'Salud', 'Educación', 'Finanzas y deudas', 'Impuestos y trámites', 'Familia y hogar'];
const ADJ = 'Ajuste de saldo';
const UNK = 'Sin identificar';
const ENV_SUB = 'Gasto de la semana';

/* ---------------- Catálogo por defecto (solo si empiezas sin hoja) ---------------- */
const DEFAULT_CATS = {
  Gasto: {
    'Vivienda': ['Alquiler / cuota de casa', 'Mantenimiento del hogar', 'Artículos de limpieza'],
    'Servicios básicos': ['Energía eléctrica', 'Agua', 'Internet', 'Teléfono / celular', 'Gas propano'],
    'Alimentación': ['Supermercado', 'Restaurantes', 'Comida rápida / delivery', 'Café y snacks', 'Almuerzos (trabajo / universidad)'],
    'Transporte': ['Combustible', 'Bus / transporte público', 'Uber / taxi', 'Parqueo'],
    'Salud': ['Consultas médicas', 'Medicamentos'], 'Educación': ['Cuotas universitarias', 'Libros y materiales', 'Cursos en línea'],
    'Entretenimiento': ['Suscripciones (streaming, música)', 'Salidas y eventos'], 'Tecnología': ['Software y apps', 'Equipos y accesorios'],
    'Finanzas y deudas': ['Cuota de préstamo', 'Intereses y comisiones bancarias'], 'Trabajo / negocio': ['Insumos de trabajo', 'Herramientas', 'Publicidad'],
    'Otros gastos': ['Imprevistos', 'Varios', ADJ]
  },
  Ingreso: {
    'Ingresos laborales': ['Salario', 'Horas extra', 'Aguinaldo'], 'Ingresos independientes': ['Trabajos freelance', 'Servicios profesionales', 'Ventas'],
    'Ingresos pasivos': ['Intereses ganados', 'Inversiones / dividendos'], 'Otros ingresos': ['Reembolsos', 'Regalos recibidos', 'Otros ingresos']
  }
};
function emptyData() {
  const cats = [];
  Object.entries(DEFAULT_CATS).forEach(([type, g]) => Object.entries(g).forEach(([cat, subs]) => subs.forEach(sub => cats.push({ sub, cat, type }))));
  return {
    accounts: [{ name: 'Efectivo', type: 'Efectivo', initial: 0 }, { name: 'Cuenta bancaria principal', type: 'Banco', initial: 0 }],
    goals: [{ name: 'Fondo de emergencias', purpose: '3 a 6 meses de gastos', target: 0, initial: 0, due: '', acc: '' }],
    debts: [], fixed: [], budgets: Object.keys(DEFAULT_CATS.Gasto).map(cat => ({ cat, amount: 0 })), cats, notes: [], movs: [],
    lists: {
      expenseCats: Object.keys(DEFAULT_CATS.Gasto), incomeCats: Object.keys(DEFAULT_CATS.Ingreso),
      types: ['Ingreso', 'Gasto', 'Transferencia', 'Aporte a meta', 'Retiro de meta'],
      methods: ['Efectivo', 'Tarjeta de débito', 'Tarjeta de crédito', 'Transferencia bancaria', 'Billetera digital'],
      scopes: ['Personal', 'Compartido', 'Negocio'], accTypes: ['Efectivo', 'Banco', 'Ahorro', 'Tarjeta de crédito', 'Billetera digital', 'Fondo', 'Inversión']
    }
  };
}

/* ---------------- Utilidades ---------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
/* Calculadora: acepta 10+5, 20-3.5, 3*2.25, 100/4 y paréntesis en cualquier monto */
function calc(expr) {
  if (expr == null) return NaN;
  const s = String(expr).replace(/\s+/g, '').replace(/,/g, '.').replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\$/g, '');
  if (!s || !/^[0-9.+\-*/()]+$/.test(s)) return NaN;
  let i = 0;
  const num = () => { const m = s.slice(i).match(/^\d*\.?\d+|^\d+\./); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); };
  const factor = () => { if (s[i] === '-') { i++; return -factor(); } if (s[i] === '+') { i++; return factor(); } if (s[i] === '(') { i++; const v = expr2(); if (s[i] === ')') i++; return v; } return num(); };
  const term = () => { let v = factor(); while (s[i] === '*' || s[i] === '/') { const o = s[i++]; const w = factor(); v = o === '*' ? v * w : v / w; } return v; };
  const expr2 = () => { let v = term(); while (s[i] === '+' || s[i] === '-') { const o = s[i++]; const w = term(); v = o === '+' ? v + w : v - w; } return v; };
  try { const v = expr2(); return i === s.length && isFinite(v) ? v : NaN; } catch (e) { return NaN; }
}
const isExpr = s => /[+\-*/×÷()]/.test(String(s || '').replace(/^-/, ''));
const calcVal = sel => { const v = calc($(sel)?.value); return isFinite(v) ? r2(v) : 0; };
const money = (n, sign) => { n = r2(n); const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < 0 ? '−' : sign && n > 0 ? '+' : '') + '$' + s; };
const pct = n => (n == null || !isFinite(n)) ? '—' : Math.round(n * 100) + '%';
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ymOf = d => (d || '').slice(0, 7);
const addM = (ym, k) => { let [y, m] = ym.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${pad(m)}`; };
const ymLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const dLabel = d => { if (!d) return ''; const [y, m, dd] = d.split('-').map(Number); return `${dd} ${MSHORT[m - 1]} ${y}`; };
const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 12);
const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
const ICON = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  movimientos: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
  cuentas: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/>',
  presupuesto: '<path d="M12 3v9l6 6"/><circle cx="12" cy="12" r="9"/>',
  metas: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  pagos: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 15l2 2 4-4"/>',
  deudas: '<path d="M4 20V10l8-6 8 6v10M9 20v-6h6v6"/>',
  estadisticas: '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-7"/>',
  bloc: '<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h12M9 8h6M9 11h4"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M7 14h4M7 17h7"/>',
  notas: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/>',
  revision: '<path d="M12 3l9 16H3zM12 10v4M12 17v.5"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  estados: '<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h3"/>',
  mas: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
};
const svgI = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

/* ---------------- Estado ---------------- */
const S = {
  data: null, outbox: [],
  cfg: { url: '', token: '', name: '', lastCount: 0, envelope: { on: false, amount: 0, acc: '' }, design: 'a', theme: 'auto', lastSync: 0, needs: NEEDS.slice(), scope: 'Todos', emergencyMonths: 6 },
  ui: { view: 'inicio', ym: ymOf(today()), q: '', fType: '', fAcc: '', fCat: '', fPeriod: 'mes', stPeriod: 'mes', mTab: 'dia', calDay: '', homeDay: '' },
  syncing: false, syncErr: '', installEvt: null
};
function load() {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) { const j = JSON.parse(raw); S.data = j.data; S.outbox = j.outbox || []; Object.assign(S.cfg, j.cfg || {}); S.noteMeta = j.noteMeta || {}; }
  } catch (e) { /* almacenamiento bloqueado: se trabaja en memoria */ }
  if (!S.data) S.data = window.__SEED__ ? JSON.parse(JSON.stringify(window.__SEED__)) : emptyData();
  normalize(S.data);
}
function save() { try { const st = Object.assign({}, (S.data && S.data.store) || {}); delete st.img; localStorage.setItem(LS, JSON.stringify({ data: S.data ? Object.assign({}, S.data, { store: st }) : S.data, outbox: S.outbox, cfg: S.cfg, noteMeta: S.noteMeta || {} })); } catch (e) { console.warn('No se pudo guardar en el equipo', e); } }
function normalize(d) {
  ['accounts', 'goals', 'debts', 'fixed', 'budgets', 'cats', 'notes', 'movs'].forEach(k => d[k] = d[k] || []);
  if (!d.store || typeof d.store !== 'object') d.store = {};
  d.lists = Object.assign(emptyData().lists, d.lists || {});
  if (!d.lists.scopes.includes('Negocio')) d.lists.scopes.push('Negocio');
  if (!d.lists.accTypes.includes('Inversión')) d.lists.accTypes.push('Inversión');
  const str = v => v == null ? '' : String(v);
  d.movs = d.movs.filter(m => m && (m.date || m.amount));
  d.movs.forEach(m => { m.amount = Number(m.amount) || 0; if (!m.id) m.id = uid(); ['date', 'type', 'acc', 'sub', 'cat', 'desc', 'to', 'goal', 'debt', 'tag', 'scope', 'method', 'notes'].forEach(k => m[k] = str(m[k])); m.date = /^\d{4}-\d{2}-\d{2}/.test(m.date) ? m.date.slice(0, 10) : ''; });
  d.movs = d.movs.filter(m => m.date);
  d.accounts.forEach(x => { x.name = str(x.name); x.type = str(x.type); x.initial = Number(x.initial) || 0; });
  d.goals.forEach(x => { x.name = str(x.name); x.purpose = str(x.purpose); x.acc = str(x.acc); x.due = /^\d{4}-\d{2}-\d{2}/.test(str(x.due)) ? str(x.due).slice(0, 10) : ''; x.target = Number(x.target) || 0; x.initial = Number(x.initial) || 0; });
  d.debts.forEach(x => { x.name = str(x.name); x.creditor = str(x.creditor); });
  d.fixed.forEach(x => { x.name = str(x.name); x.sub = str(x.sub); x.acc = str(x.acc); x.freq = str(x.freq) || 'Mensual'; x.amount = Number(x.amount) || 0; x.day = Number(x.day) || 1; if (!Array.isArray(x.paid)) x.paid = Array(12).fill(false); });
  d.budgets.forEach(x => { x.cat = str(x.cat); x.amount = Number(x.amount) || 0; });
  d.cats.forEach(x => { x.sub = str(x.sub); x.cat = str(x.cat); x.type = str(x.type); });
  d.notes.forEach(x => { ['date', 'tag', 'text', 'action', 'due', 'status', 'kind', 'time', 'color'].forEach(k => x[k] = str(x[k])); x.pinned = !!x.pinned; const m = (S.noteMeta || {})[x.id]; if (m && !x.kind) Object.assign(x, { kind: m.kind || '', time: x.time || m.time || '', color: x.color || m.color || '', pinned: x.pinned || !!m.pinned }); x.due = /^\d{4}-\d{2}-\d{2}/.test(x.due) ? x.due.slice(0, 10) : ''; });
  Object.keys(d.lists).forEach(k => { d.lists[k] = (d.lists[k] || []).map(str).filter(Boolean); });
  return d;
}

/* ---------------- Cambios: se aplican local y se encolan para la hoja ---------------- */
function op(type, data) {
  const o = { opId: uid(), type, data, t: Date.now() };
  applyLocal(o);
  S.outbox.push(o);
  save(); render(); scheduleSync();
}
function applyLocal({ type, data: d }) {
  const D = S.data;
  const byName = (arr, n) => arr.findIndex(x => x.name === n);
  const upsertNamed = (arr, rec, oldName) => { const i = byName(arr, oldName || rec.name); if (i >= 0) arr[i] = Object.assign({}, arr[i], rec); else arr.push(rec); };
  const rename = (from, to, fields) => { if (!from || from === to) return; D.movs.forEach(m => fields.forEach(f => { if (m[f] === from) m[f] = to; })); };
  switch (type) {
    case 'mov.upsert': {
      const rec = Object.assign({}, d, { cat: catOf(d.sub), tag: d.goal || d.debt || '' });
      const i = D.movs.findIndex(m => m.id === d.id);
      if (i >= 0) D.movs[i] = Object.assign({}, D.movs[i], rec); else { rec.row = (Math.max(0, ...D.movs.map(m => m.row || 0)) || 4) + 1; D.movs.push(rec); }
      break;
    }
    case 'mov.delete': D.movs = D.movs.filter(m => m.id !== d.id); break;
    case 'acc.upsert': upsertNamed(D.accounts, { name: d.name, type: d.type, initial: r2(d.initial) }, d.oldName); rename(d.oldName, d.name, ['acc', 'to']); D.goals.forEach(g => { if (g.acc === d.oldName) g.acc = d.name; }); break;
    case 'acc.delete': D.accounts = D.accounts.filter(a => a.name !== d.name); break;
    case 'goal.upsert': upsertNamed(D.goals, { name: d.name, purpose: d.purpose, target: r2(d.target), initial: r2(d.initial), due: d.due, acc: d.acc }, d.oldName); rename(d.oldName, d.name, ['goal', 'tag']); break;
    case 'goal.delete': D.goals = D.goals.filter(g => g.name !== d.name); break;
    case 'debt.upsert': upsertNamed(D.debts, { name: d.name, creditor: d.creditor, original: r2(d.original), rate: Number(d.rate) || 0, payment: r2(d.payment), day: d.day }, d.oldName); rename(d.oldName, d.name, ['debt', 'tag']); break;
    case 'debt.delete': D.debts = D.debts.filter(x => x.name !== d.name); break;
    case 'fixed.upsert': { const i = byName(D.fixed, d.oldName || d.name); const rec = { name: d.name, sub: d.sub, amount: r2(d.amount), day: Number(d.day) || 1, acc: d.acc, freq: d.freq }; if (i >= 0) D.fixed[i] = Object.assign({}, D.fixed[i], rec); else D.fixed.push(Object.assign(rec, { paid: Array(12).fill(false) })); break; }
    case 'fixed.delete': D.fixed = D.fixed.filter(f => f.name !== d.name); break;
    case 'fixed.mark': { const f = D.fixed.find(x => x.name === d.name); if (f) { f.paid = f.paid || Array(12).fill(false); f.paid[d.month - 1] = !!d.paid; } break; }
    case 'budget.set': { const b = D.budgets.find(x => x.cat === d.cat); if (b) b.amount = r2(d.amount); else D.budgets.push({ cat: d.cat, amount: r2(d.amount) }); break; }
    case 'cat.add': if (!D.cats.some(c => c.sub === d.sub)) { D.cats.push({ sub: d.sub, cat: d.cat, type: d.type }); const L = d.type === 'Ingreso' ? D.lists.incomeCats : D.lists.expenseCats; if (!L.includes(d.cat)) L.push(d.cat); if (d.type === 'Gasto' && !D.budgets.some(b => b.cat === d.cat)) D.budgets.push({ cat: d.cat, amount: 0 }); } break;
    case 'note.upsert': { const i = D.notes.findIndex(n => n.id === d.id); if (i >= 0) D.notes[i] = d; else D.notes.push(d); break; }
    case 'note.delete': D.notes = D.notes.filter(n => n.id !== d.id); break;
    case 'rec.upsert': D.store = D.store || {}; (D.store[d.coll] = D.store[d.coll] || {})[d.id] = d.data; break;
    case 'rec.delete': if (D.store && D.store[d.coll]) delete D.store[d.coll][d.id]; break;
  }
}

/* ---------------- Ajustes compartidos entre dispositivos (hoja AppData) ---------------- */
const SHARED = ['name', 'emergencyMonths', 'needs', 'envelope', 'design'];
function pushSettings() {
  if (!S.cfg.url || !(S.cfg.serverV >= 3)) { save(); return; }
  const data = { stamp: Date.now() }; SHARED.forEach(k => data[k] = S.cfg[k]);
  S.cfg.setStamp = data.stamp;
  op('rec.upsert', { coll: 'settings', id: 'app', data });
}
function pullSettings() {
  const s = ((S.data.store || {}).settings || {}).app;
  if (!s || !s.stamp || s.stamp <= (S.cfg.setStamp || 0)) return;
  if (S.outbox.some(o => o.type === 'rec.upsert' && o.data.coll === 'settings')) return;
  SHARED.forEach(k => { if (s[k] !== undefined) S.cfg[k] = s[k]; });
  S.cfg.setStamp = s.stamp;
}
/* ---------------- Sincronización con la hoja ---------------- */
let syncTimer = null, again = false;
function scheduleSync(ms = 1500) { if (!S.cfg.url) return updatePill(); clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms); updatePill(); }
async function sync(manual) {
  if (!S.cfg.url || !S.cfg.token) { if (manual === true) go('ajustes'); updatePill(); return; }
  if (S.syncing) { again = true; return; }
  if (!navigator.onLine) { S.syncErr = ''; updatePill(); return; }
  S.syncing = true; updatePill();
  const sent = S.outbox.slice();
  try {
    const ctrl = new AbortController(), tm = setTimeout(() => ctrl.abort(), 45000);
    let j;
    try {
      const res = await fetch(S.cfg.url, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: S.cfg.token, ops: sent.map(({ opId, type, data }) => ({ opId, type, data })) }) });
      const txt = await res.text();
      try { j = JSON.parse(txt); } catch (e) { throw new Error('La hoja respondió algo que no es la app (¿la URL termina en /exec?)'); }
    } catch (e) { if (e.name === 'AbortError') throw new Error('La hoja tardó demasiado en responder'); throw e; }
    finally { clearTimeout(tm); }
    if (!j.ok) throw new Error(j.error || 'La hoja no respondió');
    if (!j.data || !Array.isArray(j.data.movs)) throw new Error('La hoja respondió sin datos');
    S.outbox = S.outbox.slice(sent.length);
    S.agendaV1 = !(j.v >= 2) && S.data.notes.some(n => n.kind && n.kind !== 'nota');
    S.cfg.serverV = j.v || 1;
    S.data = normalize(j.data);
    pullSettings();
    try { absorbImages(); } catch (e) { }
    S.outbox.forEach(applyLocal);
    S.cfg.lastSync = Date.now(); S.syncErr = '';
    if (S.cfg.serverV >= 3 && !((S.data.store || {}).settings || {}).app && S.cfg.name !== undefined) pushSettings();
    const bad = (j.results || []).filter(r => !r.ok);
    if (bad.length) toast(`La hoja rechazó ${bad.length} cambio(s): ${bad[0].error}`);
    else if (manual === true) toast('Hoja sincronizada');
    save(); render();
  } catch (e) {
    S.syncErr = e.message === 'Failed to fetch' ? 'Sin conexión con la hoja' : e.message; console.error('sync', e);
    if (manual === true) toast(S.syncErr);
  } finally {
    S.syncing = false; updatePill();
    if (again) { again = false; scheduleSync(300); }
  }
}
function updatePill() {
  const p = $('#syncPill'); if (!p) return;
  const n = S.outbox.length;
  let cls = 'ok', txt;
  if (!S.cfg.url) { cls = n ? 'pending' : ''; txt = window.__SEED__ && !S.cfg.url ? 'Vista previa' : 'Solo en este equipo'; }
  else if (S.syncing) { cls = 'busy'; txt = 'Sincronizando…'; }
  else if (!navigator.onLine) { cls = 'pending'; txt = n ? `Sin internet · ${n} pendiente${n > 1 ? 's' : ''}` : 'Sin internet'; }
  else if (S.syncErr) { cls = 'err'; txt = S.syncErr; }
  else if (n) { cls = 'pending'; txt = `${n} cambio${n > 1 ? 's' : ''} por enviar`; }
  else txt = S.cfg.lastSync ? 'Hoja al día · ' + ago(S.cfg.lastSync) : 'Conectado';
  p.className = 'sync ' + cls; p.querySelector('span').textContent = txt;
}
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'ahora' : s < 3600 ? `hace ${Math.floor(s / 60)} min` : s < 86400 ? `hace ${Math.floor(s / 3600)} h` : `hace ${Math.floor(s / 86400)} d`; };

/* ---------------- Cálculos (mismas reglas que tu hoja) ---------------- */
let CM = null;
function catOf(sub) { if (!sub) return ''; return (catMap()[sub] || {}).cat || 'Sin categoría'; }
function catMap() { if (CM && CM.src === S.data.cats && CM.n === S.data.cats.length) return CM.map; const map = {}; S.data.cats.forEach(c => map[c.sub] = c); CM = { src: S.data.cats, n: S.data.cats.length, map }; return map; }
const scopeOk = m => S.cfg.scope === 'Todos' || (m.scope || 'Personal') === S.cfg.scope;
const mcat = m => m.cat || catOf(m.sub);

function agg(filterFn) {
  const r = { inc: 0, exp: 0, ap: 0, ret: 0, n: 0, byCat: {}, bySub: {}, incByCat: {} };
  S.data.movs.forEach(m => {
    if (!filterFn(m) || !scopeOk(m)) return;
    r.n++;
    if (m.type === 'Ingreso') { r.inc += m.amount; const c = mcat(m); r.incByCat[c] = (r.incByCat[c] || 0) + m.amount; }
    else if (m.type === 'Gasto') { r.exp += m.amount; const c = mcat(m); r.byCat[c] = (r.byCat[c] || 0) + m.amount; r.bySub[m.sub] = (r.bySub[m.sub] || 0) + m.amount; }
    else if (m.type === 'Aporte a meta') r.ap += m.amount;
    else if (m.type === 'Retiro de meta') r.ret += m.amount;
  });
  r.bal = r.inc - r.exp; r.rate = r.inc ? r.bal / r.inc : null;
  return r;
}
const month = ym => agg(m => ymOf(m.date) === ym);

function balances(until) {
  const b = {}; S.data.accounts.forEach(a => b[a.name] = Number(a.initial) || 0);
  S.data.movs.forEach(m => {
    if (until && m.date > until) return;
    const A = m.amount;
    if (m.type === 'Ingreso') b[m.acc] = (b[m.acc] || 0) + A;
    else if (m.type === 'Gasto') b[m.acc] = (b[m.acc] || 0) - A;
    else if (m.type === 'Transferencia') { b[m.acc] = (b[m.acc] || 0) - A; if (m.to) b[m.to] = (b[m.to] || 0) + A; }
    else if (m.type === 'Aporte a meta') b[m.acc] = (b[m.acc] || 0) - A;
    else if (m.type === 'Retiro de meta') b[m.acc] = (b[m.acc] || 0) + A;
  });
  return b;
}
function goalSaved(g, until, bal) {
  if (g.acc) return (bal || balances(until))[g.acc] || 0;
  let s = Number(g.initial) || 0;
  S.data.movs.forEach(m => { if (until && m.date > until) return; if (m.tag !== g.name && m.goal !== g.name) return; if (m.type === 'Aporte a meta') s += m.amount; if (m.type === 'Retiro de meta') s -= m.amount; });
  return s;
}
function debtPaid(d, until) { return sum(S.data.movs.filter(m => m.type === 'Gasto' && (m.debt === d.name || m.tag === d.name) && (!until || m.date <= until)), m => m.amount); }
function debtInfo(d) {
  const paid = debtPaid(d), pending = Math.max((d.original || 0) - paid, 0);
  const r = (d.rate || 0) / 1200, P = d.payment || 0;
  let months = null, interest = null, warn = '';
  if (P > 0 && pending > 0) {
    if (r > 0) { if (r * pending >= P) warn = 'La cuota no cubre los intereses'; else { months = Math.ceil(-Math.log(1 - r * pending / P) / Math.log(1 + r)); interest = months * P - pending; } }
    else months = Math.ceil(pending / P);
  }
  return { paid, pending, months, interest, warn, pctPaid: d.original ? paid / d.original : null };
}
function worth(until) {
  const bal = balances(until);
  const linked = new Set(S.data.goals.filter(g => g.acc).map(g => g.acc));
  const inAcc = sum(Object.values(bal));
  const inGoals = sum(S.data.goals.filter(g => !g.acc), g => goalSaved(g, until, bal));
  const debts = sum(S.data.debts, d => Math.max((d.original || 0) - debtPaid(d, until), 0));
  return { bal, inAcc, inGoals, debts, net: inAcc + inGoals - debts, linked };
}
function avgExpense(ym, n = 3) {
  const vals = [];
  const typical = k2 => { const x = month(k2); const big = S.data.movs.filter(m => m.type === 'Gasto' && ymOf(m.date) === k2 && scopeOk(m) && m.amount > 200 && m.amount > x.exp * .35); return { x, exp: x.exp - sum(big, m => m.amount) }; };
  for (let k = 1; k <= 12 && vals.length < n; k++) { const t = typical(addM(ym, -k)); if (t.exp > 0 && t.x.n >= 5) vals.push(t.exp); }
  if (!vals.length) return typical(ym).exp;
  return sum(vals) / vals.length;
}
function fixedStatus(f, ym) {
  const mi = Number(ym.slice(5)) - 1;
  const marked = !!(f.paid && f.paid[mi]);
  const found = S.data.movs.filter(m => m.type === 'Gasto' && ymOf(m.date) === ym && m.sub === f.sub);
  const due = `${ym}-${pad(Math.min(f.day || 1, daysIn(ym)))}`;
  const late = !marked && f.freq === 'Mensual' && today() > due;
  return { marked, found, due, late };
}

/* ---------------- Revisión de calidad de datos ---------------- */
function checks() {
  const D = S.data, out = [], cm = catMap(), t = today();
  const movs = D.movs.slice().sort((a, b) => (a.row || 0) - (b.row || 0));
  const accNames = new Set(D.accounts.map(a => a.name));
  movs.forEach((m, i) => {
    const y = Number(m.date.slice(0, 4));
    const near = movs.slice(Math.max(0, i - 5), i + 6).filter(x => x !== m).map(x => Number(x.date.slice(0, 4))).sort();
    const med = near.length ? near[Math.floor(near.length / 2)] : y;
    if (near.length >= 3 && y !== med) out.push({ sev: 'bad', id: m.id, title: `Fecha con año ${y} entre movimientos de ${med}`, detail: `${m.desc || m.sub || m.type} · ${money(m.amount)} · ${dLabel(m.date)}. Por esto no aparece en las estadísticas de ${med}.`, acts: [['Cambiar a ' + med, () => op('mov.upsert', Object.assign({}, m, { date: med + m.date.slice(4) }))], ['Ver', () => editMov(m)]] });
    else if (m.date > addM(ymOf(t), 1) + '-31') out.push({ sev: 'mid', id: m.id, title: 'Movimiento con fecha futura', detail: `${m.desc} · ${dLabel(m.date)}`, acts: [['Ver', () => editMov(m)]] });
    if (m.type === 'Transferencia' && !m.to) out.push({ sev: 'bad', title: 'Transferencia sin cuenta destino', detail: `${m.desc} · ${money(m.amount)} · ${dLabel(m.date)}. El dinero sale de ${m.acc} pero no llega a ninguna cuenta.`, acts: [['Corregir', () => editMov(m)]] });
    if (m.type === 'Transferencia' && m.to && m.to === m.acc) out.push({ sev: 'mid', title: 'Transferencia a la misma cuenta', detail: `${m.desc} · ${dLabel(m.date)}`, acts: [['Corregir', () => editMov(m)]] });
    if (m.type === 'Transferencia' && m.tag) out.push({ sev: 'mid', title: `Transferencia marcada con la meta “${m.tag}”`, detail: `${m.desc} · ${money(m.amount)} · ${dLabel(m.date)}. Tu hoja solo suma a una meta los movimientos de tipo “Aporte a meta”, así que esta meta no avanza. Si el fondo destino es donde guardas esa meta, vincula la meta a la cuenta en Metas.`, acts: [['Vincular meta a ' + m.to, () => { const g = D.goals.find(x => x.name === m.tag); if (g) op('goal.upsert', Object.assign({}, g, { acc: m.to, oldName: g.name })); }], ['Ver', () => editMov(m)]] });
    if ((m.type === 'Gasto' || m.type === 'Ingreso') && m.sub && cm[m.sub] && cm[m.sub].type !== m.type) out.push({ sev: 'mid', title: `“${m.sub}” es una subcategoría de ${cm[m.sub].type.toLowerCase()}`, detail: `Está usada en un ${m.type.toLowerCase()}: ${m.desc} · ${money(m.amount)}.`, acts: [['Corregir', () => editMov(m)]] });
    if ((m.type === 'Gasto' || m.type === 'Ingreso') && !m.sub) out.push({ sev: 'mid', title: `${m.type} sin subcategoría`, detail: `${m.desc} · ${money(m.amount)} · ${dLabel(m.date)}`, acts: [['Corregir', () => editMov(m)]] });
    if (m.sub && !cm[m.sub]) out.push({ sev: 'mid', title: `Subcategoría “${m.sub}” no existe en Categorías`, detail: `${m.desc} · ${dLabel(m.date)}`, acts: [['Corregir', () => editMov(m)]] });
    if (m.type === 'Gasto' && /ajuste/i.test(m.desc) && m.sub !== ADJ && m.sub !== UNK) out.push({ sev: 'info', title: 'Ajuste registrado como gasto normal', detail: `${m.desc} · ${money(m.amount)} quedó en “${m.sub}”. Ponerlo en “${ADJ}” separa la plata que no cuadró de tus gastos reales.`, acts: [['No recuerdo: ' + UNK, () => { ensureUnk(); op('mov.upsert', Object.assign({}, m, { sub: UNK })); }], ['Error: ' + ADJ, () => { ensureAdj(); op('mov.upsert', Object.assign({}, m, { sub: ADJ })); }]] });
    if ((m.acc && !accNames.has(m.acc)) || (m.to && !accNames.has(m.to))) out.push({ sev: 'bad', title: 'Cuenta que no existe', detail: `${m.desc} usa “${!accNames.has(m.acc) ? m.acc : m.to}”.`, acts: [['Corregir', () => editMov(m)]] });
  });
  // Subcategorías de gasto cuya categoría no está en la lista de gastos (no salen en Presupuesto ni en Estadísticas)
  const orphan = {};
  D.cats.forEach(c => { const L = c.type === 'Ingreso' ? D.lists.incomeCats : D.lists.expenseCats; if (!L.includes(c.cat)) (orphan[c.cat + '|' + c.type] = orphan[c.cat + '|' + c.type] || []).push(c.sub); });
  Object.entries(orphan).forEach(([k, subs]) => { const [cat, type] = k.split('|'); const spent = sum(D.movs.filter(m => subs.includes(m.sub) && m.type === type), m => m.amount); out.push({ sev: spent ? 'mid' : 'info', title: `“${cat}” no está en tu lista de categorías de ${type.toLowerCase()}`, detail: `Subcategorías: ${subs.join(', ')}. ${spent ? money(spent) + ' registrados que no aparecen en Presupuesto ni en Estadísticas.' : ''}` }); });
  D.fixed.forEach(f => {
    if (cm[f.sub] && cm[f.sub].type === 'Ingreso') out.push({ sev: 'mid', title: `Pago fijo “${f.name}” usa una subcategoría de ingreso`, detail: `Tiene “${f.sub}”. Cuando lo registres como gasto quedará mal clasificado.`, acts: [['Editar', () => editFixed(f)]] });
    const cur = Number(ymOf(t).slice(5));
    const ahead = (f.paid || []).map((p, i) => p && i + 1 > cur ? MSHORT[i] : '').filter(Boolean);
    if (ahead.length && ymOf(t).slice(0, 4) === S.ui.ym.slice(0, 4)) out.push({ sev: 'info', title: `“${f.name}” marcado como pagado en meses que no han llegado`, detail: `${ahead.join(', ')}. Si ya terminaste de pagarlo, elimínalo de pagos fijos para que no infle tu total mensual.`, acts: [['Editar', () => editFixed(f)]] });
  });
  D.goals.forEach(g => { if (!g.target && g.name !== 'Personal') out.push({ sev: 'info', title: `La meta “${g.name}” no tiene monto objetivo`, detail: g.name === 'Fondo de emergencias' ? `Con tus gastos promedio, ${S.cfg.emergencyMonths} meses serían ${money(avgExpense(ymOf(t)) * S.cfg.emergencyMonths)}.` : 'Sin monto no se puede calcular avance ni aporte mensual.', acts: [['Definir', () => editGoal(g)]] }); });
  const bal = balances();
  Object.entries(bal).forEach(([a, v]) => { const acc = D.accounts.find(x => x.name === a); if (v < -0.005 && acc && acc.type !== 'Tarjeta de crédito') out.push({ sev: 'bad', title: `Saldo negativo en ${a}`, detail: `${money(v)}. Falta registrar un ingreso o una transferencia hacia esta cuenta.` }); });
  const order = { bad: 0, mid: 1, info: 2 };
  return out.sort((a, b) => order[a.sev] - order[b.sev]);
}
function ensureUnk() { if (!catMap()[UNK]) op('cat.add', { sub: UNK, cat: 'Otros gastos', type: 'Gasto' }); }
function ensureAdj() { if (!catMap()[ADJ]) op('cat.add', { sub: ADJ, cat: 'Otros gastos', type: 'Gasto' }); }

/* ---------------- Gráficas SVG ---------------- */
function nice(max) { if (max <= 0) return 10; const p = Math.pow(10, Math.floor(Math.log10(max))); const n = max / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const short$ = v => Math.abs(v) >= 1000 ? '$' + (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : '$' + Math.round(v);
function barChart(rows, series, W = 640) {
  const H = 230, L = 46, B = 26, T = 10, R = 8;
  const max = nice(Math.max(1, ...rows.flatMap(r => series.map(s => r[s.k]))));
  const iw = W - L - R, ih = H - T - B, gw = iw / rows.length, bw = Math.min(16, (gw - 8) / series.length);
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = T + ih - ih * i / 4; g += `<line class="grid-l" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${short$(max * i / 4)}</text>`; }
  rows.forEach((r, i) => {
    const x0 = L + gw * i + (gw - bw * series.length) / 2;
    series.forEach((s, j) => { const h = ih * (r[s.k] / max); if (h > 0) g += `<rect x="${x0 + j * bw}" y="${T + ih - h}" width="${bw - 2}" height="${h}" rx="2" style="fill:${s.c}"><title>${r.label} · ${s.n}: ${money(r[s.k])}</title></rect>`; });
    g += `<text x="${L + gw * i + gw / 2}" y="${H - 8}" text-anchor="middle" ${r.on ? 'style="fill:var(--fg);font-weight:700"' : ''}>${r.label}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfica de barras">${g}</svg>`;
}
function lineChart(pts, opt = {}) {
  const W = opt.w || 520, H = 200, L = 52, B = 26, T = 12, R = 12;
  const vals = pts.map(p => p.v).concat(opt.ref ? pts.map(p => p.ref) : []);
  let lo = Math.min(0, ...vals), hi = nice(Math.max(1, ...vals));
  const iw = W - L - R, ih = H - T - B;
  const X = i => L + (pts.length === 1 ? iw / 2 : iw * i / (pts.length - 1)), Y = v => T + ih - ih * (v - lo) / (hi - lo);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = lo + (hi - lo) * i / 4; g += `<line class="grid-l" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${short$(v)}</text>`; }
  const path = k => pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p[k]).toFixed(1)}`).join('');
  if (opt.ref) g += `<path d="${path('ref')}" fill="none" style="stroke:var(--muted)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  const area = path('v') + `L${X(pts.length - 1)},${Y(Math.max(lo, 0))}L${X(0)},${Y(Math.max(lo, 0))}Z`;
  g += `<path d="${area}" style="fill:var(--accent);opacity:.12"/><path d="${path('v')}" fill="none" style="stroke:var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>`;
  const last = pts.length - 1;
  g += `<circle cx="${X(last)}" cy="${Y(pts[last].v)}" r="4" style="fill:var(--accent)"/>`;
  const step = Math.ceil(pts.length / 8);
  pts.forEach((p, i) => { if (i % step === 0 || i === last) g += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${p.label}</text>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfica de línea">${g}</svg>`;
}
function hbars(entries, total, ref) {
  if (!entries.length) return '<p class="muted">Sin datos en este periodo.</p>';
  const max = Math.max(...entries.map(e => e[1]));
  return entries.map(([k, v]) => { const a = ref && ref[k]; return `<div class="hbar"><span>${esc(k)}${a ? ` <small class="muted">prom. ${money(a)}</small>` : ''}</span><b>${money(v)}${total ? ` <small class="muted">${pct(v / total)}</small>` : ''}</b><div class="bar ${a && v > a * 1.25 ? 'near' : ''}"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div></div>`; }).join('');
}

/* ---------------- Navegación ---------------- */
const VIEWS = [
  ['inicio', 'Inicio', 'Día a día'], ['movimientos', 'Movimientos'], ['agenda', 'Agenda'], ['bloc', 'Bloc de notas'], ['estados', 'Estados'], ['cuentas', 'Cuentas'], ['metas', 'Metas'],
  ['presupuesto', 'Presupuesto', 'Planear'], ['pagos', 'Pagos fijos'], ['deudas', 'Deudas'],
  ['estadisticas', 'Estadísticas', 'Analizar'], ['revision', 'Revisión'], ['ajustes', 'Ajustes', 'App']
];
const PRIMARY = ['inicio', 'movimientos', 'agenda', 'metas'];
function renderNav() {
  const html = ['<div class="navbrand"><span class="mark">$</span><span>Mis Finanzas</span></div>'];
  VIEWS.forEach(([k, name, grp], i) => {
    if (grp) html.push(`<div class="grp">${grp}</div>`);
    if (k === 'agenda') html.push('<span class="slot" aria-hidden="true"></span>');
    const n = k === 'revision' && S.data ? checks().filter(c => c.sev !== 'info').length : 0;
    html.push(`<a href="#${k}" data-v="${k}" class="${PRIMARY.includes(k) ? '' : 'sec'} ${S.ui.view === k ? 'on' : ''}">${svgI(k)}<span>${name}${n ? ` <span class="pill bad">${n}</span>` : ''}</span></a>`);
  });
  html.push(`<a href="#" class="more" data-act="more">${svgI('mas')}<span>Más</span></a>`);
  $('#nav').innerHTML = html.join('');
}
function go(v) { if (location.hash !== '#' + v) location.hash = v; else route(); }
function route() {
  if (typeof edTimer !== 'undefined' && edTimer) pgSaveNow();
  const v = (location.hash || '#inicio').slice(1);
  S.ui.view = v === 'notas' ? 'agenda' : VIEWS.some(x => x[0] === v) ? v : 'inicio';
  render(); window.scrollTo(0, 0);
}

/* ---------------- Render principal ---------------- */
function render() {
  document.body.dataset.design = S.cfg.design;
  if (S.cfg.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = S.cfg.theme;
  const tc = { a: '#14171a', b: '#0b2239', c: '#0f141b' }[S.cfg.design]; document.querySelector('meta[name=theme-color]')?.setAttribute('content', tc);
  { const [yy, mm] = S.ui.ym.split('-').map(Number); $('#mLabel').textContent = window.innerWidth < 600 ? `${MSHORT[mm - 1]} ${yy}` : ymLabel(S.ui.ym); }
  renderNav(); updatePill(); try { renderBell(); renderAgBtn(); } catch (e) { console.error(e); }
  const ae = document.activeElement;
  if (S.ui.view === 'bloc' && $('#pgEditor') && ae && ($('#pgEditor').contains(ae) || ae.id === 'pgTitle' || ae.closest('#edBar')) && $('#pgEditor').dataset.pg === S.ui.pg) return;
  if (typeof edTimer !== 'undefined' && edTimer) pgSaveNow();
  const fn = { inicio: vInicio, estados: vEstados, movimientos: vMovs, cuentas: vCuentas, metas: vMetas, presupuesto: vPresupuesto, pagos: vPagos, deudas: vDeudas, estadisticas: vStats, revision: vRevision, notas: vAgenda, agenda: vAgenda, bloc: vBloc, ajustes: vAjustes }[S.ui.view];
  try { $('#view').innerHTML = `<div class="wrap">${fn()}</div>`; S.lastError = ''; if (S.ui.view === 'bloc') { const ed = $('#pgEditor'); if (ed) { ed.dataset.pg = S.ui.pg; edBind(); } } }
  catch (e) {
    console.error(e); S.lastError = (e && e.message) || String(e);
    $('#view').innerHTML = `<div class="wrap"><div class="card" style="display:grid;gap:12px;max-width:620px"><h2>No pude mostrar esta sección</h2><p class="muted" style="margin:0">Algún dato de tu hoja tiene un formato que la app no esperaba. Mándale una captura de este mensaje a quien te ayuda con la app.</p><code style="font-family:var(--f-num);font-size:.8rem;background:var(--surface-2);padding:10px;border-radius:8px;white-space:pre-wrap;word-break:break-word">v${VERSION} · ${esc(S.ui.view)} · ${esc(S.lastError)}\n${esc(((e && e.stack) || '').split('\n').slice(1, 3).join('\n'))}</code><div class="btns"><button class="btn pri" data-act="reloadSheet">Volver a cargar desde mi hoja</button><button class="btn" data-act="go" data-v="movimientos">Ir a Movimientos</button></div></div></div>`;
  }
  const top = $('#top'); if (top) document.body.style.setProperty('--topH', top.offsetHeight + 'px');
}
function head(title, sub, actions = '') { return `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${actions ? `<div class="btns">${actions}</div>` : ''}</div>`; }
function scopeSeg() { return `<div class="seg" style="max-width:420px">${['Todos', ...S.data.lists.scopes].map(s => `<button type="button" data-act="scope" data-v="${esc(s)}" class="${S.cfg.scope === s ? 'on' : ''}">${esc(s)}</button>`).join('')}</div>`; }
function welcome() {
  return `<div class="wrap"><div class="card" style="max-width:560px;margin:8vh auto 0;display:grid;gap:14px">
  <h1>Mis Finanzas</h1><p class="muted" style="margin:0">Tus movimientos se guardan en tu hoja de Google. Esta app funciona sin internet y envía los cambios cuando vuelve la señal.</p>
  <div class="btns"><button class="btn pri" data-act="go" data-v="ajustes">Conectar mi hoja</button><button class="btn" data-act="startLocal">Probar sin hoja</button></div></div></div>`;
}

/* ---- Inicio (Pulso + etapas + resumen) ---- */
function spendToday(ym) {
  const cur = month(ym), isNow = ym === ymOf(today());
  const day = isNow ? Number(today().slice(8)) : daysIn(ym), dim = daysIn(ym), left = dim - day + 1;
  const buds = S.data.budgets.filter(b => b.amount > 0);
  const budTotal = sum(buds, b => b.amount), budSpent = sum(buds, b => cur.byCat[b.cat] || 0);
  if (isNow && budTotal > 0) { const rem = budTotal - budSpent; return { mode: 'budget', perDay: Math.max(rem, 0) / left, rem, left, used: budSpent / budTotal, dayPct: day / dim, budTotal }; }
  if (isNow && cur.inc > 0) { const rem = cur.inc - cur.exp; return { mode: 'income', perDay: Math.max(rem, 0) / left, rem, left, used: cur.exp / cur.inc, dayPct: day / dim }; }
  return { mode: 'closed', bal: cur.bal, used: cur.inc ? cur.exp / cur.inc : null, dayPct: 1 };
}
function stages() {
  const ym = ymOf(today()), W = worth(), avg = avgExpense(ym);
  const liquid = sum(S.data.accounts.filter(a => a.type !== 'Tarjeta de crédito' && a.type !== 'Inversión'), a => Math.max(W.bal[a.name] || 0, 0)) + W.inGoals;
  const months = avg > 0 ? liquid / avg : 0, target = S.cfg.emergencyMonths;
  let streak = 0; for (let k = 1; k <= 12; k++) { const m = month(addM(ym, -k)); if (m.inc > 0 && m.rate >= .2) streak++; else break; }
  const invested = sum(S.data.accounts.filter(a => a.type === 'Inversión'), a => Math.max(W.bal[a.name] || 0, 0));
  let passive = 0; for (let k = 1; k <= 3; k++) passive += (month(addM(ym, -k)).incByCat['Ingresos pasivos'] || 0) / 3;
  const freedom = avg * 12 * 25;
  const S5 = [
    { k: 'Colchón de ' + target + ' meses', p: Math.min(months / target, 1), v: `${months.toFixed(1)} de ${target} meses`, done: months >= target },
    { k: 'Cero deudas', p: W.debts ? 0 : 1, v: W.debts ? money(W.debts) + ' pendiente' : 'Logrado', done: !W.debts },
    { k: 'Ahorrar 20% al mes', p: Math.min(streak / 3, 1), v: `${Math.min(streak, 3)} de 3 meses seguidos`, done: streak >= 3 },
    { k: 'Invertir cada mes', p: invested > 0 ? 1 : 0, v: invested > 0 ? money(invested) + ' invertido' : '$0 invertido', done: invested > 0 },
    { k: 'Ingreso pasivo = gastos', p: avg ? Math.min(passive / avg, 1) : 0, v: `${avg ? pct(passive / avg) : '0%'} cubierto`, done: avg > 0 && passive >= avg }
  ];
  const now = S5.findIndex(s => !s.done);
  let next = '';
  if (now === 0) {
    const falta = Math.max(target * avg - liquid, 0), q = Math.max(25, Math.ceil(falta / 24 / 5) * 5), n = Math.ceil(falta / (q * 2));
    next = falta ? `Aparta <b>${money(q)}</b> cada quincena y completas tu colchón en <b>${ymLabel(addM(ym, n)).toLowerCase()}</b>.` : 'Registra tus gastos un mes completo para calcular tu colchón.';
  } else if (now === 1) { const d = S.data.debts.map(x => ({ x, i: debtInfo(x) })).filter(y => y.i.pending > 0).sort((a, b) => (b.x.rate || 0) - (a.x.rate || 0))[0]; next = d ? `Abona extra a <b>${esc(d.x.name)}</b>: es la deuda con la tasa más alta.` : ''; }
  else if (now === 2) next = `Este mes guarda al menos <b>${money(month(ym).inc * .2 || avg * .25)}</b> antes de gastar.`;
  else if (now === 3) next = 'Crea una cuenta de tipo <b>Inversión</b> y aporta una cantidad fija cada mes.';
  else if (now === 4) next = `Tus inversiones deben generar <b>${money(avg)}</b> al mes. Vas en ${money(passive)}.`;
  return { list: S5, now, next, freedom, net: W.net };
}
function stagesCard(compact) {
  const st = stages();
  return `<section class="card side-card"><header style="margin:0"><h2>Etapas hacia tu libertad</h2><a href="#metas">Metas</a></header>
  <div class="stages">${st.list.map((s, i) => { const cls = s.done ? 'done' : i === st.now ? 'now' : 'later'; return `<div class="stage ${cls}"><span class="dot">${s.done ? '✓' : i + 1}</span><span>${s.k}</span><small>${s.v}</small>${i === st.now && !compact ? `<div class="bar stage-bar"><i style="width:${(s.p * 100).toFixed(0)}%"></i></div>` : ''}</div>`; }).join('')}</div>
  ${st.next ? `<div class="next-step">${st.next}</div>` : ''}
  <p class="note">Tu número de libertad es ${money(st.freedom)} (25 años de tus gastos). Llevas ${pct(st.freedom ? Math.max(st.net, 0) / st.freedom : 0)}.</p></section>`;
}
function vInicio() {
  const ym = S.ui.ym, cur = month(ym), sp = spendToday(ym), isNow = ym === ymOf(today());
  const [y, m, d] = (isNow ? today() : `${ym}-${pad(daysIn(ym))}`).split('-').map(Number);
  const wd = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][new Date(y, m - 1, d).getDay()];
  const h = new Date().getHours(), greet = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const name = S.cfg.name ? ', ' + esc(S.cfg.name) : '';
  const pend = S.data.fixed.filter(f => f.freq === 'Mensual').map(f => ({ f, s: fixedStatus(f, ym) })).filter(x => !x.s.marked);
  const buds = S.data.budgets.filter(b => b.amount > 0).map(b => ({ b, sp: cur.byCat[b.cat] || 0 })).sort((a, b) => b.sp / b.b.amount - a.sp / a.b.amount);
  const issues = checks().filter(c => c.sev !== 'info');
  const big = S.data.movs.filter(x => x.type === 'Gasto' && ymOf(x.date) === ym && scopeOk(x)).sort((a, b) => b.amount - a.amount)[0];
  const goals = S.data.goals.filter(g => g.target > 0).slice(0, 2), bal = balances();

  const chips = [];
  pend.filter(x => x.s.late || x.s.due === today()).forEach(({ f, s }) => chips.push(`<a class="achip bad" href="#pagos"><i></i>${esc(f.name)} ${s.late ? 'vencido' : 'vence hoy'} · <b>${money(f.amount)}</b></a>`));
  buds.filter(x => x.sp > x.b.amount).forEach(x => chips.push(`<a class="achip bad" href="#presupuesto"><i></i>${esc(x.b.cat)} pasó el límite</a>`));
  if (issues.length) chips.push(`<a class="achip" href="#revision"><i></i>${issues.length} dato${issues.length > 1 ? 's' : ''} por revisar</a>`);
  if (!S.cfg.url && !window.__SEED__) chips.unshift(`<a class="achip info" href="#ajustes"><i></i>Conecta tu hoja de Google</a>`);
  if (S.installEvt) chips.push(`<button type="button" class="achip info" data-act="install"><i></i>Instalar la app</button>`);

  const feed = S.data.movs.filter(x => scopeOk(x) && x.date <= (isNow ? today() : `${ym}-31`)).sort((a, b) => b.date.localeCompare(a.date) || (b.row || 0) - (a.row || 0)).slice(0, 9);
  const groups = {}; feed.forEach(x => (groups[x.date] = groups[x.date] || []).push(x));

  let hero;
  if (sp.mode === 'closed') hero = `<div class="lead"><span>Balance de ${MONTHS[m - 1].toLowerCase()}</span><span class="big ${sp.bal < 0 ? 'neg' : ''}">${money(sp.bal, true)}</span><span>Entraron <b>${money(cur.inc)}</b> y salieron <b>${money(cur.exp)}</b>.</span></div>`;
  else hero = `<div class="lead"><span>Puedes gastar hoy</span><span class="big ${sp.rem < 0 ? 'neg' : ''}">${money(sp.perDay)}</span><span>${sp.rem >= 0 ? `Te quedan <b>${money(sp.rem)}</b> ${sp.mode === 'budget' ? 'del presupuesto' : 'de lo que entró'} para ${sp.left} día${sp.left > 1 ? 's' : ''}.` : `Ya pasaste ${sp.mode === 'budget' ? 'el presupuesto' : 'lo que entró'} por <b>${money(-sp.rem)}</b>.`}</span></div>`;
  const meters = `<div class="meters"><div class="meter"><div><span>${sp.mode === 'budget' ? 'Presupuesto usado' : 'Gastado de lo que entró'}</span><b>${pct(sp.used)}</b></div><div class="track"><i class="${sp.used > 1 ? 'over' : ''}" style="width:${Math.min(100, (sp.used || 0) * 100)}%"></i></div></div><div class="meter"><div><span>Días del mes</span><b>${isNow ? d : daysIn(ym)} / ${daysIn(ym)}</b></div><div class="track"><i class="dim" style="width:${sp.dayPct * 100}%"></i></div></div></div>`;

  const hd = S.ui.homeDay && ymOf(S.ui.homeDay) === ym ? S.ui.homeDay : '';
  const dayMovs = hd ? S.data.movs.filter(x => scopeOk(x) && x.date === hd) : feed;
  return `
  ${window.__SEED__ && !S.cfg.url ? `<div class="preview-note">Vista previa con los datos de tu archivo. Los cambios aquí no llegan a tu hoja.</div>` : ''}
  <div class="home">
    <div class="home-main">
      <div class="hello"><div><p>${isNow ? `${wd[0].toUpperCase() + wd.slice(1)} ${d} de ${MONTHS[m - 1].toLowerCase()}` : ymLabel(ym)}</p><h1>${isNow ? greet + name : 'Resumen de ' + MONTHS[m - 1].toLowerCase()}</h1></div>${scopeSeg()}</div>
      ${walletCard(sp, isNow)}
      <div class="home-cards">
        ${todayCard()}
        ${pinnedPagesCard()}
        ${envelopeCard()}
        ${stagesCard(false)}
        <section class="card side-card"><header style="margin:0"><h2>Presupuesto</h2><a href="#presupuesto">Detalle</a></header>
          ${buds.slice(0, 5).map(({ b, sp: s }) => { const p = s / b.amount; return `<div class="mini"><div class="row2"><span>${esc(b.cat)}</span><span class="num ${p > 1 ? 'neg' : ''}">${money(s).replace('.00', '')} / ${money(b.amount).replace('.00', '')}</span></div><div class="bar ${p > 1 ? 'over' : p >= .85 ? 'near' : 'good'}"><i style="width:${Math.min(100, p * 100)}%"></i></div></div>`; }).join('') || '<p class="note">Define montos en Presupuesto para saber cuánto puedes gastar cada día.</p>'}
        </section>
        ${goals.map(g => { const s = goalSaved(g, null, bal), p = s / g.target; let ml = null; if (g.due) { const [gy, gm] = g.due.split('-').map(Number); ml = Math.max((gy - y) * 12 + gm - m, 0); } return `<section class="card side-card"><header style="margin:0"><h2>${esc(g.name)}</h2><span class="pill ${p >= 1 ? 'ok' : 'acc'}">${pct(p)}</span></header><div class="row2"><span class="num" style="font-size:1.35rem">${money(s)}</span><span class="muted" style="font-size:.84rem">de ${money(g.target)}${g.due ? ' · ' + dLabel(g.due).replace(/ \d{4}$/, '') : ''}</span></div><div class="bar ${p >= 1 ? 'good' : ''}"><i style="width:${Math.min(100, Math.max(p, 0) * 100)}%"></i></div>${ml != null && p < 1 ? `<p class="note">Aparta ${money((g.target - s) / Math.max(ml, 1))} al mes para llegar a tiempo.</p>` : ''}</section>`; }).join('')}
        ${pend.length ? `<section class="card side-card"><header style="margin:0"><h2>Por pagar</h2><a href="#pagos">Pagos fijos</a></header>${pend.slice(0, 4).map(({ f, s }) => `<div class="row2"><span>${esc(f.name)} <small class="${s.late ? 'neg' : 'muted'}">${s.late ? 'vencido' : 'día ' + f.day}</small></span><span class="btns"><span class="num">${money(f.amount)}</span>${s.found.length ? `<button class="btn sm" data-act="fixMark" data-n="${esc(f.name)}">Marcar</button>` : `<button class="btn sm" data-act="fixPay" data-n="${esc(f.name)}">Pagar</button>`}</span></div>`).join('')}</section>` : ''}
      </div>
    </div>
    <aside class="home-side">
      <section class="card side-card"><header style="margin:0"><h2>${MONTHS[m - 1]}</h2><a href="#estados">Estados</a></header>
        ${miniCal(ym, hd)}
        <div class="row2 small3"><span>Entró <b class="num pos">${money(cur.inc)}</b></span><span>Salió <b class="num neg">${money(cur.exp)}</b></span><span>Balance <b class="num ${cur.bal < 0 ? 'neg' : 'pos'}">${money(cur.bal, true)}</b></span></div>
        ${(() => { const u = sum(S.data.movs.filter(z => z.type === 'Gasto' && z.sub === UNK && ymOf(z.date) === ym && scopeOk(z)), z => z.amount); return u && cur.exp ? `<p class="note ${u / cur.exp > .05 ? 'neg' : ''}">Sin identificar: ${money(u)} (${pct(u / cur.exp)} de tus gastos). ${u / cur.exp > .05 ? 'Se te están escapando gastos: cuadra más seguido.' : 'Bajo control.'}</p>` : ''; })()}
        ${big && cur.exp && big.amount / cur.exp > .35 ? `<p class="note">${esc(big.desc || big.sub)} (${money(big.amount)}) es el ${pct(big.amount / cur.exp)} del mes. Sin ese gasto saliste con ${money(cur.exp - big.amount)}.</p>` : ''}
      </section>
      <section class="card side-card feed-card"><header style="margin:0"><h2>${hd ? dLabel(hd) : 'Movimientos'}</h2>${hd ? `<button type="button" class="linkbtn" data-act="homeDay" data-v="">Ver los últimos</button>` : `<a href="#movimientos">Ver todo</a>`}</header>
        ${dayMovs.length ? dayList(dayMovs) : `<div class="empty"><p>${hd ? 'Sin movimientos ese día.' : 'Aún no hay movimientos este mes.'}</p><button class="btn pri" ${hd ? `data-act="newMovOn" data-v="${hd}"` : 'data-act="newMov"'}>Registrar</button></div>`}
      </section>
    </aside>
  </div>`;
}
function movItem(m) {
  const k = m.type === 'Ingreso' ? 'in' : m.type === 'Gasto' ? 'out' : 'tr';
  const sign = m.type === 'Ingreso' || m.type === 'Retiro de meta' ? 1 : m.type === 'Gasto' || m.type === 'Aporte a meta' ? -1 : 0;
  const c0 = mcat(m) || m.type, ws = c0.split(/[\s/]+/).filter(w => w.length > 2), ini = (ws.length > 1 ? ws[0][0] + ws[1][0] : c0.slice(0, 2)).toUpperCase();
  const ab = m.type === 'Transferencia' ? '⇄' : m.type.includes('meta') ? 'ME' : ini;
  const sub = m.type === 'Transferencia' ? `${m.acc} → ${m.to || '¿?'}` : m.type.includes('meta') ? `${m.type} · ${m.tag || m.goal}` : `${m.sub || 'Sin subcategoría'} · ${m.acc}`;
  return `<div class="item click" data-act="editMov" data-id="${esc(m.id)}"><span class="ic ${k}">${ab}</span><div class="t"><b>${esc(m.desc || m.sub || m.type)}</b><small>${esc(sub)}${m.scope && m.scope !== 'Personal' ? ' · ' + esc(m.scope) : ''}</small></div><span class="amt ${sign > 0 ? 'pos' : ''}">${sign > 0 ? '+' : sign < 0 ? '−' : ''}${money(m.amount).replace('−', '')}</span></div>`;
}

/* ---- Libreta: cuentas, días y pestañas de periodo ---- */
const ACC_ORDER = ['Efectivo', 'Banco', 'Ahorro', 'Billetera digital', 'Fondo', 'Inversión', 'Tarjeta de crédito'];
function accGroups() {
  const W = worth(), groups = {};
  S.data.accounts.forEach(a => { const t = a.type || 'Otras'; (groups[t] = groups[t] || []).push({ a, v: W.bal[a.name] || 0 }); });
  const keys = Object.keys(groups).sort((x, y) => (ACC_ORDER.indexOf(x) + 1 || 99) - (ACC_ORDER.indexOf(y) + 1 || 99));
  const all = Object.values(groups).flat();
  const assets = sum(all.filter(x => x.v > 0), x => x.v) + W.inGoals;
  const liab = sum(all.filter(x => x.v < 0), x => -x.v) + W.debts;
  return { W, groups, keys, assets, liab, total: assets - liab };
}
function walletCard(sp, isNow) {
  const G = accGroups();
  const accs = Object.values(G.groups).flat().filter(x => Math.abs(x.v) >= .005).sort((a, b) => b.v - a.v);
  const zero = S.data.accounts.length - accs.length;
  let spend = '';
  if (sp.mode !== 'closed') spend = `<div class="w-spend"><div><span>Puedes gastar hoy</span><b class="${sp.rem < 0 ? 'neg' : ''}">${money(sp.perDay)}</b><small>${sp.rem >= 0 ? `Te quedan ${money(sp.rem)} ${sp.mode === 'budget' ? 'del presupuesto' : 'de lo que entró'} para ${sp.left} día${sp.left > 1 ? 's' : ''}` : `Pasaste ${sp.mode === 'budget' ? 'el presupuesto' : 'lo que entró'} por ${money(-sp.rem)}`}</small></div><div class="meter"><div><span>${sp.mode === 'budget' ? 'Presupuesto usado' : 'Gastado'}</span><b>${pct(sp.used)}</b></div><div class="track"><i class="${sp.used > 1 ? 'over' : ''}" style="width:${Math.min(100, (sp.used || 0) * 100)}%"></i></div></div></div>`;
  return `<section class="wallet">
    <div class="w-top"><span>Tienes en tus cuentas</span><a href="#cuentas">Ver cuentas</a></div>
    <div class="w-big ${G.W.inAcc < 0 ? 'neg' : ''}">${money(G.W.inAcc)}</div>
    <div class="w-sub">${G.W.inGoals ? `En metas ${money(G.W.inGoals)} · ` : ''}Deudas ${money(G.liab)} · Patrimonio ${money(G.total)}</div>
    <div class="w-accs">${accs.map(x => `<button type="button" class="w-acc ${x.v < 0 ? 'neg' : ''}" data-act="accGo" data-n="${esc(x.a.name)}"><span>${esc(x.a.name)}</span><b>${money(x.v)}</b></button>`).join('')}${zero ? `<a class="w-acc dim" href="#cuentas"><span>${zero} en cero</span></a>` : ''}</div>
    ${spend}
  </section>`;
}
function miniCal(ym, sel) {
  const [y, m] = ym.split('-').map(Number), first = (new Date(y, m - 1, 1).getDay() + 6) % 7, dim = daysIn(ym);
  const ms = S.data.movs.filter(x => scopeOk(x) && ymOf(x.date) === ym);
  let h = WEEK.map(w => `<span class="mc-h">${w[0]}</span>`).join('') + '<span></span>'.repeat(first);
  for (let d = 1; d <= dim; d++) {
    const ds = `${ym}-${pad(d)}`, dm = ms.filter(x => x.date === ds);
    const out = sum(dm.filter(x => x.type === 'Gasto'), x => x.amount), inc = sum(dm.filter(x => x.type === 'Ingreso'), x => x.amount);
    h += `<button type="button" class="mc-d ${ds === today() ? 'today' : ''} ${ds === sel ? 'on' : ''} ${dm.length ? 'has' : ''}" data-act="homeDay" data-v="${ds === sel ? '' : ds}" aria-label="${dLabel(ds)}"><span>${d}</span>${out ? `<small class="neg">${out >= 100 ? Math.round(out) : out.toFixed(0)}</small>` : inc ? `<small class="pos">+${Math.round(inc)}</small>` : ''}</button>`;
  }
  return `<div class="mcal">${h}</div>`;
}
function weekStart(ds) { const d = new Date((ds || today()) + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function envelopeState() {
  const E = S.cfg.envelope || {}; if (!E.on || !(E.amount > 0)) return null;
  const ws = weekStart(), acc = E.acc || (S.data.accounts.find(a => a.type === 'Efectivo') || S.data.accounts[0] || {}).name;
  const reg = S.data.movs.filter(m => m.type === 'Gasto' && m.sub === ENV_SUB && m.date >= ws && m.date <= today());
  return { amount: E.amount, acc, ws, done: reg.length > 0, reg: sum(reg, m => m.amount) };
}
function envelopeCard() {
  const env = envelopeState(); if (!env) return '';
  const [y, m, d] = env.ws.split('-').map(Number);
  return `<section class="card side-card"><header style="margin:0"><h2>Sobre de la semana</h2><span class="pill ${env.done ? 'ok' : 'mid'}">${env.done ? 'Registrado' : 'Pendiente'}</span></header>
    <div class="row2"><span class="num" style="font-size:1.35rem">${money(env.done ? env.reg : env.amount)}</span><span class="muted" style="font-size:.84rem">semana del ${d} ${MSHORT[m - 1].toLowerCase()} · ${esc(env.acc)}</span></div>
    ${env.done ? '<p class="note">Lo que gastes en efectivo esta semana ya está contado. Registra aparte solo lo grande.</p>' : `<button type="button" class="btn pri" data-act="envelope">Registrar sobre de ${money(env.amount)}</button><p class="note">Se guarda como un solo gasto en “${ENV_SUB}” y ya no detallas cada compra pequeña.</p>`}
  </section>`;
}
function notifications() {
  if (!S.data) return [];
  const ym = ymOf(today()), cur = month(ym), out = [];
  S.data.fixed.filter(f => f.freq === 'Mensual').forEach(f => { const s = fixedStatus(f, ym); if (!s.marked && (s.late || s.due === today())) out.push({ sev: 'bad', text: `${esc(f.name)} ${s.late ? 'vencido' : 'vence hoy'} · <b class="num">${money(f.amount)}</b>`, href: '#pagos' }); });
  S.data.budgets.filter(b => b.amount > 0 && (cur.byCat[b.cat] || 0) > b.amount).forEach(b => out.push({ sev: 'bad', text: `${esc(b.cat)} pasó el límite (${money(cur.byCat[b.cat])} de ${money(b.amount)})`, href: '#presupuesto' }));
  const lastMov = S.data.movs.filter(m => m.date <= today()).map(m => m.date).sort().pop();
  const daysSince = d => d ? Math.floor((new Date(today() + 'T12:00') - new Date(d + 'T12:00')) / 864e5) : null;
  const dm = daysSince(lastMov);
  if (dm != null && dm >= 2) out.push({ sev: 'mid', text: `Llevas ${dm} días sin registrar nada. ¿Se te pasó algún gasto?`, act: 'newMov' });
  const hasCash = S.data.accounts.some(a => a.type === 'Efectivo');
  const lastCountDate = [S.cfg.lastCount ? new Date(S.cfg.lastCount).toISOString().slice(0, 10) : '', ...S.data.movs.filter(m => m.sub === ADJ || m.sub === UNK).map(m => m.date)].sort().pop();
  const dc = daysSince(lastCountDate);
  if (hasCash && (dc == null || dc >= 3)) out.push({ sev: 'mid', text: dc == null ? 'Cuadra tu efectivo por primera vez' : `Cuadra tu efectivo: el último cuadre fue hace ${dc} días`, act: 'cash' });
  const env = envelopeState(); if (env && !env.done) out.push({ sev: 'info', text: `Registra tu sobre de la semana · <b class="num">${money(env.amount)}</b>`, act: 'envelope' });
  const n = checks().filter(c => c.sev !== 'info').length; if (n) out.push({ sev: 'mid', text: `${n} dato${n > 1 ? 's' : ''} por revisar`, href: '#revision' });
  if (!S.cfg.url && !window.__SEED__) out.unshift({ sev: 'info', text: 'Conecta tu hoja de Google', href: '#ajustes' });
  if (S.installEvt) out.push({ sev: 'info', text: 'Instala la app en este equipo', act: 'install' });
  return out;
}
function renderBell() {
  const b = $('#bell'); if (!b) return;
  const L = notifications(), urgent = L.filter(x => x.sev === 'bad').length;
  const badge = b.querySelector('.badge'); badge.hidden = !L.length; badge.textContent = L.length; badge.classList.toggle('bad', !!urgent);
  $('#notifs').innerHTML = `<div class="nf-head">Avisos</div>${L.length ? L.map(x => x.act ? `<button type="button" class="nf ${x.sev}" data-act="${x.act}"><i></i><span>${x.text}</span></button>` : `<a class="nf ${x.sev}" href="${x.href}"><i></i><span>${x.text}</span></a>`).join('') : '<p class="nf-empty">Todo en orden. No tienes avisos.</p>'}`;
}
function dayHead(dt, ms) {
  const inc = sum(ms.filter(x => x.type === 'Ingreso'), x => x.amount), out = sum(ms.filter(x => x.type === 'Gasto'), x => x.amount);
  const [y, m, d] = dt.split('-').map(Number);
  return `<div class="dhead"><b class="dnum">${d}</b><span class="dwk">${WEEK[(new Date(dt + 'T12:00').getDay() + 6) % 7]}</span><span class="dmo">${MSHORT[m - 1].toLowerCase()} ${y}</span><span class="dsum">${inc ? `<span class="pos">+${money(inc)}</span>` : ''}${out ? `<span class="neg">−${money(out)}</span>` : ''}</span></div>`;
}
function dayList(list) {
  const groups = {}; list.forEach(x => (groups[x.date] = groups[x.date] || []).push(x));
  return Object.entries(groups).map(([dt, ms]) => `<div class="dgroup">${dayHead(dt, ms)}<div class="list">${ms.map(movItem).join('')}</div></div>`).join('');
}
function trio(inc, exp) {
  return `<div class="trio"><div><span>Ingresos</span><b class="pos">${money(inc)}</b></div><div><span>Gastos</span><b class="neg">${money(exp)}</b></div><div><span>Total</span><b class="${inc - exp < 0 ? 'neg' : ''}">${money(inc - exp, true)}</b></div></div>`;
}
function vMovs() {
  const u = S.ui, D = S.data, tab = u.mTab || 'dia';
  const tabs = `<div class="ptabs">${[['dia', 'Diario'], ['cal', 'Calendario'], ['mes', 'Mensual'], ['total', 'Total']].map(([k, l]) => `<button type="button" data-act="mTab" data-v="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const opt = (arr, sel, all) => `<option value="">${all}</option>` + arr.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const cats = [...new Set([...D.lists.expenseCats, ...D.lists.incomeCats, ...D.cats.map(c => c.cat)])];
  const filters = `<div class="card"><div class="filters">
    <input class="ctl" id="fq" type="search" placeholder="Buscar descripción, monto, nota…" value="${esc(u.q)}" style="flex:2 1 220px">
    ${tab === 'dia' ? `<select class="ctl" id="fPeriod"><option value="mes" ${u.fPeriod === 'mes' ? 'selected' : ''}>${ymLabel(u.ym)}</option><option value="año" ${u.fPeriod === 'año' ? 'selected' : ''}>Todo ${u.ym.slice(0, 4)}</option><option value="todo" ${u.fPeriod === 'todo' ? 'selected' : ''}>Todo el historial</option></select>` : ''}
    <select class="ctl" id="fType">${opt(D.lists.types, u.fType, 'Todos los tipos')}</select>
    <select class="ctl" id="fAcc">${opt(D.accounts.map(a => a.name), u.fAcc, 'Todas las cuentas')}</select>
    <select class="ctl" id="fCat">${opt(cats, u.fCat, 'Todas las categorías')}</select>
  </div></div>`;
  const head0 = head('Movimientos', u.fAcc ? `Filtrando por ${esc(u.fAcc)} · <button type="button" class="linkbtn" data-act="clearAcc">Quitar filtro</button>` : '', `<button class="btn" data-act="csv">Exportar CSV</button>`);
  if (tab === 'total') {
    const G = accGroups();
    return `${head0}${tabs}${accountsBlock(G)}`;
  }
  if (tab === 'mes') {
    const y = u.ym.slice(0, 4), keep = u.fPeriod; u.fPeriod = 'año'; const L = filteredMovs(); u.fPeriod = keep;
    const rows = MONTHS.map((n, i) => { const k = `${y}-${pad(i + 1)}`, ms = L.filter(x => ymOf(x.date) === k); return { k, n, inc: sum(ms.filter(x => x.type === 'Ingreso'), x => x.amount), exp: sum(ms.filter(x => x.type === 'Gasto'), x => x.amount), c: ms.length }; });
    return `${head0}${tabs}${filters}${trio(sum(rows, r => r.inc), sum(rows, r => r.exp))}
    <div class="card"><div class="list">${rows.map(r => `<button type="button" class="mrow ${r.k === u.ym ? 'on' : ''}" data-act="goMonth" data-v="${r.k}"><span><b>${r.n}</b><small>${r.c ? r.c + ' movimientos' : 'Sin movimientos'}</small></span><span class="pos num">${r.inc ? money(r.inc) : ''}</span><span class="neg num">${r.exp ? money(r.exp) : ''}</span><span class="num ${r.inc - r.exp < 0 ? 'neg' : ''}">${r.c ? money(r.inc - r.exp, true) : '—'}</span></button>`).join('')}</div></div>`;
  }
  const keep = u.fPeriod; if (tab === 'cal') u.fPeriod = 'mes';
  const L = filteredMovs(); u.fPeriod = keep;
  const inc = sum(L.filter(m => m.type === 'Ingreso'), m => m.amount), exp = sum(L.filter(m => m.type === 'Gasto'), m => m.amount);
  if (tab === 'cal') {
    const [y, m] = u.ym.split('-').map(Number), first = (new Date(y, m - 1, 1).getDay() + 6) % 7, dim = daysIn(u.ym);
    const sel = u.calDay && ymOf(u.calDay) === u.ym ? u.calDay : null;
    let cells = WEEK.map(w => `<div class="cal-h">${w}</div>`).join('') + '<div class="cal-e"></div>'.repeat(first);
    for (let d = 1; d <= dim; d++) {
      const ds = `${u.ym}-${pad(d)}`, ms = L.filter(x => x.date === ds);
      const di = sum(ms.filter(x => x.type === 'Ingreso'), x => x.amount), de = sum(ms.filter(x => x.type === 'Gasto'), x => x.amount);
      cells += `<button type="button" class="cal-d ${ds === today() ? 'today' : ''} ${ds === sel ? 'on' : ''}" data-act="calDay" data-v="${ds}"><span>${d}</span>${di ? `<small class="pos">+${Math.round(di)}</small>` : ''}${de ? `<small class="neg">−${Math.round(de)}</small>` : ''}</button>`;
    }
    const dayMovs = sel ? L.filter(x => x.date === sel) : [];
    return `${head0}${tabs}${filters}${trio(inc, exp)}<div class="card"><div class="cal">${cells}</div></div>
    ${sel ? `<div class="card">${dayMovs.length ? dayList(dayMovs) : `<div class="empty"><p>Sin movimientos el ${dLabel(sel)}.</p><button class="btn pri" data-act="newMovOn" data-v="${sel}">Registrar en ese día</button></div>`}</div>` : '<p class="muted" style="margin:0">Toca un día para ver sus movimientos.</p>'}`;
  }
  return `${head0}${tabs}${filters}${trio(inc, exp)}
  <div class="card">${L.length ? dayList(L) : `<div class="empty"><p>No hay movimientos con estos filtros.</p><button class="btn pri" data-act="newMov">Agregar movimiento</button></div>`}</div>`;
}
function accountsBlock(G) {
  return `<div class="trio"><div><span>Activos</span><b class="pos">${money(G.assets)}</b></div><div><span>Pasivos</span><b class="neg">${money(G.liab)}</b></div><div><span>Total</span><b>${money(G.total)}</b></div></div>
  <div class="card"><div class="agroups">${G.keys.map(k => { const g = G.groups[k]; return `<div class="agroup"><div class="ahead"><span>${esc(k)}</span><b class="num">${money(sum(g, x => x.v))}</b></div>${g.map(x => `<button type="button" class="arow" data-act="accGo" data-n="${esc(x.a.name)}"><span>${esc(x.a.name)}</span><b class="num ${x.v < 0 ? 'neg' : ''}">${money(x.v)}</b></button>`).join('')}</div>`; }).join('')}
  ${G.W.inGoals ? `<div class="agroup"><div class="ahead"><span>Metas (fuera de cuentas)</span><b class="num">${money(G.W.inGoals)}</b></div></div>` : ''}
  ${S.data.debts.length ? `<div class="agroup"><div class="ahead"><span>Deudas</span><b class="num neg">${money(G.W.debts)}</b></div>${S.data.debts.map(d => `<a class="arow" href="#deudas"><span>${esc(d.name)}</span><b class="num neg">${money(debtInfo(d).pending)}</b></a>`).join('')}</div>` : ''}
  </div></div>`;
}

/* ---- Movimientos ---- */
function filteredMovs() {
  const u = S.ui, q = u.q.trim().toLowerCase();
  return S.data.movs.filter(m => {
    if (!scopeOk(m)) return false;
    if (u.fPeriod === 'mes' && ymOf(m.date) !== u.ym) return false;
    if (u.fPeriod === 'año' && m.date.slice(0, 4) !== u.ym.slice(0, 4)) return false;
    if (u.fType && m.type !== u.fType) return false;
    if (u.fAcc && m.acc !== u.fAcc && m.to !== u.fAcc) return false;
    if (u.fCat && mcat(m) !== u.fCat) return false;
    if (q && !`${m.desc} ${m.sub} ${m.notes} ${m.acc} ${m.to} ${m.tag} ${m.amount}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.row || 0) - (a.row || 0));
}
/* ---- Cuentas ---- */
function vCuentas() {
  const W = worth(), ym = S.ui.ym;
  const net = {}; S.data.movs.filter(m => ymOf(m.date) === ym).forEach(m => { const A = m.amount; const add = (a, v) => net[a] = (net[a] || 0) + v; if (m.type === 'Ingreso' || m.type === 'Retiro de meta') add(m.acc, A); else if (m.type === 'Gasto' || m.type === 'Aporte a meta') add(m.acc, -A); else if (m.type === 'Transferencia') { add(m.acc, -A); if (m.to) add(m.to, A); } });
  const linked = g => S.data.goals.filter(x => x.acc === g).map(x => x.name);
  return `${head('Cuentas', 'Saldo actual = saldo inicial + ingresos − gastos ± transferencias − aportes a metas + retiros. La misma fórmula de tu hoja.', `<button class="btn" data-act="cash">Contar efectivo</button><button class="btn" data-act="newTransfer">Transferir</button><button class="btn pri" data-act="newAcc">Nueva cuenta</button>`)}
  ${accountsBlock(accGroups())}
  <h2 style="margin-top:8px">Detalle y edición</h2>
  <div class="card tbl-wrap"><table><thead><tr><th>Cuenta</th><th>Tipo</th><th class="r">Saldo inicial</th><th class="r">Neto ${MSHORT[Number(ym.slice(5)) - 1]}</th><th class="r">Saldo actual</th><th></th></tr></thead><tbody>
  ${S.data.accounts.map(a => { const b = W.bal[a.name] || 0, n = net[a.name] || 0; const l = linked(a.name); return `<tr><td><b>${esc(a.name)}</b>${l.length ? `<br><small class="muted">Meta: ${esc(l.join(', '))}</small>` : ''}</td><td>${esc(a.type)}</td><td class="r">${money(a.initial)}</td><td class="r ${n < 0 ? 'neg' : n > 0 ? 'pos' : 'muted'}">${n ? money(n, true) : '—'}</td><td class="r ${b < 0 ? 'neg' : ''}"><b>${money(b)}</b></td><td><button class="linkbtn" data-act="editAcc" data-n="${esc(a.name)}">Editar</button></td></tr>`; }).join('')}
  </tbody><tfoot><tr><td colspan="4">Total en cuentas</td><td class="r">${money(W.inAcc)}</td><td></td></tr></tfoot></table></div>`;
}

/* ---- Metas ---- */
function vMetas() {
  const bal = balances(), avg = avgExpense(ymOf(today()));
  return `${head('Metas de ahorro', 'Cada meta avanza con movimientos “Aporte a meta”, o con el saldo de la cuenta donde la guardas si la vinculas.', `<button class="btn pri" data-act="newGoal">Nueva meta</button>`)}
  <div class="grid">${S.data.goals.map(g => {
    const s = goalSaved(g, null, bal), p = g.target ? s / g.target : null;
    let monthsLeft = null; if (g.due) { const [y, m] = g.due.split('-').map(Number); const [ty, tm] = today().split('-').map(Number); monthsLeft = Math.max((y - ty) * 12 + m - tm, 0); }
    const falta = g.target ? Math.max(g.target - s, 0) : null, sug = falta != null && monthsLeft != null ? (monthsLeft ? falta / monthsLeft : falta) : null;
    const st = !g.target ? ['Sin monto', ''] : s >= g.target ? ['Lograda', 'ok'] : g.due && g.due < today() ? ['Vencida', 'bad'] : p >= .75 ? ['Casi lista', 'acc'] : ['En progreso', 'mid'];
    const emerg = /emergencia/i.test(g.name) && !g.target ? `<p class="muted" style="margin:0;font-size:.84rem">Sugerido: ${S.cfg.emergencyMonths} meses de gastos = <b>${money(avg * S.cfg.emergencyMonths)}</b></p>` : '';
    return `<section class="card" style="display:grid;gap:10px"><header style="margin:0"><div><h2>${esc(g.name)}</h2><small class="muted">${esc(g.purpose || '')}${g.acc ? ' · en ' + esc(g.acc) : ''}</small></div><span class="pill ${st[1]}">${st[0]}</span></header>
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><span class="num" style="font-size:1.5rem;font-weight:600">${money(s)}</span><span class="muted">${g.target ? 'de ' + money(g.target) : ''}</span></div>
      ${g.target ? `<div class="bar ${p >= 1 ? 'good' : ''}"><i style="width:${Math.min(100, p * 100)}%"></i></div>` : ''}
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:.84rem" class="muted"><span>${g.due ? 'Para ' + dLabel(g.due) + (monthsLeft != null ? ` · ${monthsLeft} meses` : '') : 'Sin fecha'}</span><span>${sug ? `Aporta <b class="num" style="color:var(--fg)">${money(sug)}</b>/mes` : ''}</span></div>${emerg}
      <div class="btns"><button class="btn sm pri" data-act="goalIn" data-n="${esc(g.name)}">Aportar</button><button class="btn sm" data-act="goalOut" data-n="${esc(g.name)}">Retirar</button><button class="btn sm" data-act="editGoal" data-n="${esc(g.name)}">Editar</button></div></section>`;
  }).join('')}</div>`;
}

/* ---- Presupuesto ---- */
function vPresupuesto() {
  const ym = S.ui.ym, cur = month(ym), y = ym.slice(0, 4);
  const yearAgg = agg(m => m.date.slice(0, 4) === y);
  const monthsWithExp = Math.max(1, MONTHS.filter((_, i) => month(`${y}-${pad(i + 1)}`).exp > 0).length);
  const rows = S.data.lists.expenseCats.map(c => { const b = (S.data.budgets.find(x => x.cat === c) || {}).amount || 0; return { c, b, sp: cur.byCat[c] || 0, avg: (yearAgg.byCat[c] || 0) / monthsWithExp }; });
  const tb = sum(rows, r => r.b), ts = sum(rows.filter(r => r.b), r => r.sp);
  const needs = sum(Object.entries(cur.byCat).filter(([c]) => S.cfg.needs.includes(c)), e => e[1]), wants = cur.exp - needs;
  const inc = cur.inc || 1;
  return `${head('Presupuesto', `Comparado con ${ymLabel(ym)}. Toca un monto para cambiarlo; se guarda en tu hoja.`)}
  <div class="kpis"><div class="kpi"><span class="label">Presupuestado</span><span class="v">${money(tb)}</span></div><div class="kpi"><span class="label">Gastado en esas categorías</span><span class="v">${money(ts)}</span></div><div class="kpi"><span class="label">Disponible</span><span class="v ${tb - ts < 0 ? 'neg' : 'pos'}">${money(tb - ts)}</span></div><div class="kpi"><span class="label">Sin presupuesto</span><span class="v">${money(cur.exp - ts)}</span><span class="d">gastos en categorías sin monto</span></div></div>
  <div class="grid-2">
  <section class="card tbl-wrap"><table><thead><tr><th>Categoría</th><th class="r">Presupuesto</th><th class="r">Gastado</th><th style="width:28%">Uso</th><th class="r">Prom. ${y}</th></tr></thead><tbody>
  ${rows.map(r => { const p = r.b ? r.sp / r.b : null; return `<tr><td>${esc(r.c)}</td><td class="r"><button class="linkbtn num" data-act="budget" data-c="${esc(r.c)}">${r.b ? money(r.b) : 'Definir'}</button></td><td class="r ${p > 1 ? 'neg' : ''}">${r.sp ? money(r.sp) : '—'}</td><td>${r.b ? `<div class="bar ${p > 1 ? 'over' : p >= .85 ? 'near' : 'good'}"><i style="width:${Math.min(100, p * 100)}%"></i></div>` : r.sp ? '<span class="pill mid">Sin monto</span>' : ''}</td><td class="r muted">${r.avg ? money(r.avg) : '—'}</td></tr>`; }).join('')}
  </tbody></table></section>
  <section class="card" style="display:grid;gap:12px;align-content:start"><header style="margin:0"><h2>Regla 50 / 30 / 20</h2></header>
    <p class="muted" style="margin:0;font-size:.86rem">De lo que entra: 50% necesidades, 30% gustos, 20% ahorro. Con tus ingresos de ${money(cur.inc)}:</p>
    ${[['Necesidades', needs, .5], ['Gustos y otros', wants, .3], ['Ahorro (lo que sobra)', cur.inc - cur.exp, .2]].map(([n, v, t]) => `<div class="hbar"><span>${n} <small class="muted">ideal ${money(cur.inc * t)}</small></span><b class="${(n.startsWith('Ahorro') ? v < cur.inc * t : v > cur.inc * t) ? 'neg' : 'pos'}">${money(v)} <small class="muted">${pct(v / inc)}</small></b><div class="bar ${(n.startsWith('Ahorro') ? v >= cur.inc * t : v <= cur.inc * t) ? 'good' : 'over'}"><i style="width:${Math.max(0, Math.min(100, v / inc * 100))}%"></i></div></div>`).join('')}
    <p class="muted" style="margin:0;font-size:.8rem">Necesidades: ${esc(S.cfg.needs.join(', '))}. Puedes cambiarlas en Ajustes.</p>
  </section></div>`;
}

/* ---- Pagos fijos ---- */
function vPagos() {
  const ym = S.ui.ym, mi = Number(ym.slice(5));
  const rows = S.data.fixed.map(f => ({ f, s: fixedStatus(f, ym) }));
  const monthly = sum(S.data.fixed.filter(f => f.freq === 'Mensual'), f => f.amount), pend = sum(rows.filter(r => r.f.freq === 'Mensual' && !r.s.marked), r => r.f.amount);
  return `${head('Pagos fijos', `Estado de ${ymLabel(ym)}. Si ya registraste el gasto, la app lo detecta y te deja marcarlo como pagado.`, `<button class="btn pri" data-act="newFixed">Nuevo pago fijo</button>`)}
  <div class="kpis"><div class="kpi"><span class="label">Total mensual</span><span class="v">${money(monthly)}</span></div><div class="kpi"><span class="label">Pendiente este mes</span><span class="v ${pend ? 'neg' : 'pos'}">${money(pend)}</span></div><div class="kpi"><span class="label">Costo anual</span><span class="v">${money(sum(S.data.fixed, f => f.amount * ({ Anual: 1, Trimestral: 4, Quincenal: 24, Semanal: 52 }[f.freq] || 12)))}</span></div></div>
  <div class="card tbl-wrap"><table><thead><tr><th>Concepto</th><th class="r">Monto</th><th class="r">Día</th><th>Estado</th>${MSHORT.map((m, i) => `<th style="text-align:center;${i + 1 === mi ? 'color:var(--accent)' : ''}">${m[0]}</th>`).join('')}<th></th></tr></thead><tbody>
  ${rows.map(({ f, s }) => `<tr><td><b>${esc(f.name)}</b><br><small class="muted">${esc(f.sub)} · ${esc(f.acc || '')} · ${esc(f.freq)}</small></td><td class="r">${money(f.amount)}</td><td class="r">${f.day}</td>
    <td>${s.marked ? '<span class="pill ok">Pagado</span>' : s.found.length ? `<button class="btn sm" data-act="fixMark" data-n="${esc(f.name)}" data-p="1">Detectado ${money(s.found[0].amount)} · marcar</button>` : `<span class="pill ${s.late ? 'bad' : 'mid'}">${s.late ? 'Vencido' : 'Pendiente'}</span> <button class="btn sm" data-act="fixPay" data-n="${esc(f.name)}">Pagar</button>`}</td>
    ${(f.paid || []).map((p, i) => `<td style="text-align:center"><button class="linkbtn" data-act="fixToggle" data-n="${esc(f.name)}" data-m="${i + 1}" title="${MONTHS[i]}" style="color:${p ? 'var(--pos)' : 'var(--line)'};font-size:1rem">${p ? '●' : '○'}</button></td>`).join('')}
    <td><button class="linkbtn" data-act="editFixed" data-n="${esc(f.name)}">Editar</button></td></tr>`).join('') || `<tr><td colspan="17" class="muted">Aún no tienes pagos fijos.</td></tr>`}
  </tbody></table></div>`;
}

/* ---- Deudas ---- */
function vDeudas() {
  const L = S.data.debts.map(d => ({ d, i: debtInfo(d) }));
  return `${head('Deudas y préstamos', 'Cada pago se registra como gasto con la deuda seleccionada. Con la tasa y la cuota se estima cuánto falta y cuánto pagarás de intereses.', `<button class="btn pri" data-act="newDebt">Nueva deuda</button>`)}
  ${L.length ? `<div class="grid">${L.map(({ d, i }) => `<section class="card" style="display:grid;gap:10px"><header style="margin:0"><div><h2>${esc(d.name)}</h2><small class="muted">${esc(d.creditor || '')}${d.rate ? ' · ' + d.rate + '% anual' : ''}</small></div>${i.pending ? `<span class="pill mid">Pendiente</span>` : '<span class="pill ok">Pagada</span>'}</header>
    <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="num neg" style="font-size:1.4rem;font-weight:600">${money(i.pending)}</span><span class="muted">de ${money(d.original)}</span></div>
    <div class="bar good"><i style="width:${Math.min(100, (i.pctPaid || 0) * 100)}%"></i></div>
    <div class="muted" style="font-size:.84rem">Cuota ${money(d.payment)}${d.day ? ' el día ' + d.day : ''}${i.months != null ? ` · faltan ≈ ${i.months} cuotas` : ''}${i.interest ? ` · intereses por pagar ≈ ${money(i.interest)}` : ''}${i.warn ? ` · <b class="neg">${i.warn}</b>` : ''}</div>
    <div class="btns"><button class="btn sm pri" data-act="debtPay" data-n="${esc(d.name)}">Pagar cuota</button><button class="btn sm" data-act="editDebt" data-n="${esc(d.name)}">Editar</button></div></section>`).join('')}</div>` : `<div class="card empty"><p>No tienes deudas registradas.</p><p style="margin:0;font-size:.85rem">Si tienes un préstamo o tarjeta, agrégalo para ver cuánto te falta y cuánto pagas en intereses.</p></div>`}`;
}

/* ---- Estadísticas ---- */
function vStats() {
  const ym = S.ui.ym, y = ym.slice(0, 4), mi = Number(ym.slice(5));
  const ms = MONTHS.map((_, i) => ({ ym: `${y}-${pad(i + 1)}`, ...month(`${y}-${pad(i + 1)}`) }));
  const totInc = sum(ms, m => m.inc), totExp = sum(ms, m => m.exp), active = ms.filter(m => m.exp || m.inc).length || 1;
  const yearAgg = agg(m => m.date.slice(0, 4) === y);
  const cur = ms[mi - 1];
  const wd = Array(7).fill(0); S.data.movs.filter(m => m.type === 'Gasto' && ymOf(m.date) === ym && scopeOk(m)).forEach(m => wd[(new Date(m.date + 'T12:00').getDay() + 6) % 7] += m.amount);
  const sc = {}; S.data.movs.filter(m => ymOf(m.date) === ym && (m.type === 'Gasto' || m.type === 'Ingreso')).forEach(m => { const k = m.scope || 'Personal'; sc[k] = sc[k] || { i: 0, g: 0 }; sc[k][m.type === 'Ingreso' ? 'i' : 'g'] += m.amount; });
  const nw = ms.map((m, i) => ({ label: MSHORT[i], v: worth(`${m.ym}-31`).net })).filter((_, i) => `${y}-${pad(i + 1)}` <= ymOf(today()) || i < mi);
  // gasto acumulado del mes vs ritmo del mes anterior
  const dim = daysIn(ym), cum = [], prevCum = []; let a = 0, b = 0;
  const pm = addM(ym, -1);
  for (let d = 1; d <= dim; d++) { const ds = `${ym}-${pad(d)}`, ps = `${pm}-${pad(d)}`; a += sum(S.data.movs.filter(m => m.type === 'Gasto' && m.date === ds && scopeOk(m)), m => m.amount); b += sum(S.data.movs.filter(m => m.type === 'Gasto' && m.date === ps && scopeOk(m)), m => m.amount); cum.push({ label: String(d), v: a, ref: b }); }
  const isNow = ym === ymOf(today()); const cumShown = isNow ? cum.slice(0, Number(today().slice(8))) : cum;
  const avgCat = {}; Object.entries(yearAgg.byCat).forEach(([c, v]) => avgCat[c] = v / active);
  const subs = Object.entries(cur.bySub).sort((x, z) => z[1] - x[1]).slice(0, 8);
  return `${head('Estadísticas ' + y, `Mes destacado: ${MONTHS[mi - 1]}. Las cifras siguen las mismas reglas que tu hoja.`, scopeSeg())}
  <div class="kpis"><div class="kpi"><span class="label">Ingresos ${y}</span><span class="v">${money(totInc)}</span><span class="d">prom. ${money(totInc / active)}/mes</span></div><div class="kpi"><span class="label">Gastos ${y}</span><span class="v">${money(totExp)}</span><span class="d">prom. ${money(totExp / active)}/mes</span></div><div class="kpi"><span class="label">Ahorro ${y}</span><span class="v ${totInc - totExp < 0 ? 'neg' : 'pos'}">${money(totInc - totExp)}</span><span class="d">tasa ${pct(totInc ? (totInc - totExp) / totInc : null)}</span></div><div class="kpi"><span class="label">Sin identificar ${MSHORT[mi - 1]}</span><span class="v ${(cur.bySub[UNK] || 0) / (cur.exp || 1) > .05 ? 'neg' : ''}">${money(cur.bySub[UNK] || 0)}</span><span class="d">${pct((cur.bySub[UNK] || 0) / (cur.exp || 1))} de tus gastos · meta: menos de 5%</span></div><div class="kpi"><span class="label">Gasto diario ${MSHORT[mi - 1]}</span><span class="v">${money(cur.exp / (isNow ? Number(today().slice(8)) : daysIn(ym)))}</span></div></div>
  <section class="card"><header><h2>Ingresos y gastos por mes</h2><div class="legend"><span><i style="background:var(--pos)"></i>Ingresos</span><span><i style="background:var(--neg)"></i>Gastos</span></div></header>${barChart(ms.map((m, i) => ({ label: MSHORT[i], a: m.inc, b: m.exp, on: i + 1 === mi })), [{ k: 'a', c: 'var(--pos)', n: 'Ingresos' }, { k: 'b', c: 'var(--neg)', n: 'Gastos' }], 1000)}</section>
  <div class="grid-2">
    <section class="card"><header><h2>Gasto acumulado de ${MONTHS[mi - 1]}</h2><div class="legend"><span><i style="background:var(--accent)"></i>Este mes</span><span><i style="background:var(--muted)"></i>Mes anterior</span></div></header>${lineChart(cumShown.length ? cumShown : [{ label: '1', v: 0, ref: 0 }], { ref: true })}</section>
    <section class="card"><header><h2>Patrimonio neto al cierre de cada mes</h2></header>${nw.length ? lineChart(nw) : '<p class="muted">Sin datos.</p>'}</section>
    <section class="card"><header><h2>Categorías de ${MONTHS[mi - 1]}</h2><span class="muted" style="font-size:.78rem">vs promedio del año</span></header>${hbars(Object.entries(cur.byCat).sort((x, z) => z[1] - x[1]), cur.exp, avgCat)}</section>
    <section class="card"><header><h2>Subcategorías con más gasto</h2></header>${hbars(subs, cur.exp)}</section>
    <section class="card"><header><h2>Gasto por día de la semana</h2></header>${barChart(WEEK.map((w, i) => ({ label: w, a: wd[i] })), [{ k: 'a', c: 'var(--accent)', n: 'Gasto' }], 520)}</section>
    <section class="card"><header><h2>Por ámbito</h2><span class="muted" style="font-size:.78rem">Personal · Compartido · Negocio</span></header>
      <div class="tbl-wrap"><table><thead><tr><th>Ámbito</th><th class="r">Ingresos</th><th class="r">Gastos</th><th class="r">Balance</th></tr></thead><tbody>${Object.entries(sc).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${money(v.i)}</td><td class="r">${money(v.g)}</td><td class="r ${v.i - v.g < 0 ? 'neg' : 'pos'}">${money(v.i - v.g)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sin datos</td></tr>'}</tbody></table></div>
      <p class="muted" style="font-size:.8rem;margin:10px 0 0">Marca con “Negocio” lo de Computer Services DC para ver si el negocio deja ganancia aparte de tu salario.</p></section>
  </div>
  <section class="card tbl-wrap"><header><h2>Resumen mes a mes</h2></header><table><thead><tr><th>Mes</th><th class="r">Ingresos</th><th class="r">Gastos</th><th class="r">Balance</th><th class="r">Tasa de ahorro</th><th class="r">Aportes a metas</th><th class="r">Mov.</th></tr></thead><tbody>
  ${ms.map((m, i) => `<tr ${i + 1 === mi ? 'style="background:var(--accent-soft)"' : ''}><td>${MONTHS[i]}</td><td class="r">${m.inc ? money(m.inc) : '—'}</td><td class="r">${m.exp ? money(m.exp) : '—'}</td><td class="r ${m.bal < 0 ? 'neg' : m.bal > 0 ? 'pos' : 'muted'}">${m.n ? money(m.bal) : '—'}</td><td class="r">${pct(m.rate)}</td><td class="r">${m.ap ? money(m.ap) : '—'}</td><td class="r">${m.n || '—'}</td></tr>`).join('')}
  </tbody><tfoot><tr><td>Total</td><td class="r">${money(totInc)}</td><td class="r">${money(totExp)}</td><td class="r">${money(totInc - totExp)}</td><td class="r">${pct(totInc ? (totInc - totExp) / totInc : null)}</td><td class="r">${money(sum(ms, m => m.ap))}</td><td class="r">${sum(ms, m => m.n)}</td></tr></tfoot></table></section>`;
}

/* ---- Estados financieros ---- */
const acct = n => { n = r2(n); const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? `(${s})` : s; };
function vEstados() {
  const ym = S.ui.ym, yr = ym.slice(0, 4), annual = S.ui.stPeriod === 'año';
  const A = annual ? agg(x => x.date.slice(0, 4) === yr) : month(ym);
  const until = annual ? (yr === today().slice(0, 4) ? today() : `${yr}-12-31`) : (ym === ymOf(today()) ? today() : `${ym}-31`);
  const W = worth(until), avg = avgExpense(ym), st = stages();
  const period = annual ? `Año ${yr}` : `Del 1 al ${until.slice(8) * 1} de ${MONTHS[Number(ym.slice(5)) - 1].toLowerCase()} de ${yr}`;
  const inc = Object.entries(A.incByCat).sort((a, b) => b[1] - a[1]);
  const exp = Object.entries(A.byCat).sort((a, b) => b[1] - a[1]);
  const topExp = exp.slice(0, 7), restExp = exp.slice(7);
  const big = S.data.movs.filter(x => x.type === 'Gasto' && scopeOk(x) && (annual ? x.date.slice(0, 4) === yr : ymOf(x.date) === ym)).sort((a, b) => b.amount - a.amount)[0];
  const extra = big && A.exp && big.amount / A.exp > .35 ? big : null;
  const extraCat = extra ? mcat(extra) : '';
  const days = annual ? (yr === today().slice(0, 4) ? Math.ceil((new Date(today()) - new Date(yr + '-01-01')) / 864e5) + 1 : 365) : Number(until.slice(8));
  const liquid = sum(S.data.accounts.filter(a => a.type !== 'Tarjeta de crédito'), a => Math.max(W.bal[a.name] || 0, 0)) + W.inGoals;
  const accs = S.data.accounts.map(a => ({ a, v: W.bal[a.name] || 0 })).sort((x, z) => z.v - x.v);
  const zero = accs.filter(x => Math.abs(x.v) < .005);
  const debts = S.data.debts.map(dd => ({ dd, v: Math.max((dd.original || 0) - debtPaid(dd, until), 0) })).filter(x => x.v > 0);
  const goalsOut = S.data.goals.filter(g => !g.acc).map(g => ({ g, v: goalSaved(g, until) })).filter(x => Math.abs(x.v) > .005);
  const ratios = [
    ['Resultado del ' + (annual ? 'año' : 'mes'), acct(A.bal), A.bal < 0 ? 'neg' : 'pos'],
    ['Tasa de ahorro', pct(A.rate), A.rate != null && A.rate < .2 ? 'neg' : ''],
    ['Patrimonio neto', acct(W.net), ''],
    ['Meses de reserva', avg ? (liquid / avg).toFixed(1) + ` / ${S.cfg.emergencyMonths}` : '—', ''],
    ['Gasto diario prom.', acct(A.exp / Math.max(days, 1)), ''],
    ['Avance a tu libertad', pct(st.freedom ? Math.max(W.net, 0) / st.freedom : 0), '']
  ];
  return `${head('Estados financieros', period + '. Cifras en dólares; los negativos van entre paréntesis.', `<div class="seg"><button type="button" data-act="stPeriod" data-v="mes" class="${annual ? '' : 'on'}">Mes</button><button type="button" data-act="stPeriod" data-v="año" class="${annual ? 'on' : ''}">Año ${yr}</button></div>`)}
  <div class="kpis">${ratios.map(([k, v, c]) => `<div class="kpi"><span class="label">${k}</span><span class="v ${c}">${v}</span></div>`).join('')}</div>
  <div class="grid-2" style="align-items:start">
    <section class="card"><header><div><h2 style="font-size:1.15rem">Estado de resultados</h2><small class="muted">${annual ? 'Enero a diciembre' : MONTHS[Number(ym.slice(5)) - 1] + ' ' + yr}</small></div></header>
      <div class="stmt">
        <div class="stmt-sec"><span>Ingresos</span><span></span></div>
        ${inc.map(([c, v]) => `<div class="stmt-row"><span>${esc(c)}</span><span>${acct(v)}</span></div>`).join('') || '<div class="stmt-row dim"><span>Sin ingresos registrados</span><span>0.00</span></div>'}
        <div class="stmt-total"><span>Total ingresos</span><span>${acct(A.inc)}</span></div>
        <div class="stmt-sec"><span>Gastos</span><span></span></div>
        ${topExp.map(([c, v]) => `<div class="stmt-row"><span>${esc(c)}${c === extraCat ? '<span class="tag">extraordinario</span>' : ''}</span><span>${acct(v)}</span></div>`).join('') || '<div class="stmt-row dim"><span>Sin gastos registrados</span><span>0.00</span></div>'}
        ${restExp.length ? `<div class="stmt-row dim"><span>${restExp.length} categorías más</span><span>${acct(sum(restExp, e => e[1]))}</span></div>` : ''}
        <div class="stmt-total"><span>Total gastos</span><span>${acct(A.exp)}</span></div>
        <div class="stmt-net"><span>Resultado neto</span><span class="${A.bal < 0 ? 'neg' : ''}">${acct(A.bal)}</span></div>
      </div>
      ${extra ? `<p class="note" style="margin-top:12px">Sin “${esc(extra.desc || extra.sub)}” (${money(extra.amount)}), el resultado sería ${acct(A.bal + extra.amount)}.</p>` : ''}
    </section>
    <section class="card"><header><div><h2 style="font-size:1.15rem">Balance general</h2><small class="muted">Al ${dLabel(until)}</small></div></header>
      <div class="stmt">
        <div class="stmt-sec"><span>Activos</span><span></span></div>
        ${accs.filter(x => Math.abs(x.v) >= .005).map(x => `<div class="stmt-row"><span>${esc(x.a.name)}</span><span class="${x.v < 0 ? 'neg' : ''}">${acct(x.v)}</span></div>`).join('')}
        ${goalsOut.map(x => `<div class="stmt-row"><span>Meta: ${esc(x.g.name)}</span><span>${acct(x.v)}</span></div>`).join('')}
        ${zero.length ? `<div class="stmt-row dim"><span>${zero.length} cuenta${zero.length > 1 ? 's' : ''} en cero</span><span>0.00</span></div>` : ''}
        <div class="stmt-total"><span>Total activos</span><span>${acct(W.inAcc + W.inGoals)}</span></div>
        <div class="stmt-sec"><span>Pasivos</span><span></span></div>
        ${debts.map(x => `<div class="stmt-row"><span>${esc(x.dd.name)}</span><span>${acct(x.v)}</span></div>`).join('') || '<div class="stmt-row dim"><span>Sin deudas registradas</span><span>0.00</span></div>'}
        <div class="stmt-total"><span>Total pasivos</span><span>${acct(W.debts)}</span></div>
        <div class="stmt-net"><span>Patrimonio neto</span><span>${acct(W.net)}</span></div>
      </div>
    </section>
  </div>
  <section class="card"><header><h2>Etapas hacia tu libertad financiera</h2><a href="#metas">Ver metas</a></header>
    <div class="stages-wide">${st.list.map((s, i) => `<div class="st ${s.done ? 'done' : i === st.now ? 'now' : ''}"><div class="bar ${s.done ? 'good' : ''}"><i style="width:${(s.p * 100).toFixed(0)}%"></i></div><b>${i + 1} · ${s.k}</b><small>${s.v}</small></div>`).join('')}</div>
    ${st.next ? `<div class="next-step" style="margin-top:14px">Siguiente paso: ${st.next}</div>` : ''}
  </section>`;
}

/* ---- Revisión ---- */
let CHECKS = [];
function vRevision() {
  CHECKS = checks();
  const lab = { bad: ['Error', 'bad'], mid: ['Revisar', 'mid'], info: ['Sugerencia', 'acc'] };
  return `${head('Revisión de datos', 'Errores que cambian tus números y mejoras para clasificar mejor. Se revisa solo cada vez que entras.')}
  ${CHECKS.length ? CHECKS.map((c, i) => `<div class="alert ${c.sev === 'bad' ? 'bad' : c.sev === 'info' ? 'info' : ''}"><span></span><div><span class="pill ${lab[c.sev][1]}">${lab[c.sev][0]}</span> <b>${esc(c.title)}</b><p>${esc(c.detail)}</p></div><div class="acts">${(c.acts || []).map((a, j) => `<button class="btn sm ${j ? '' : 'pri'}" data-act="fix" data-i="${i}" data-j="${j}">${esc(a[0])}</button>`).join('')}</div></div>`).join('') : '<div class="card empty"><p>Todo en orden. No encontré errores en tus datos.</p></div>'}`;
}

/* ---- Agenda: Día, Pendientes y Notas (se respalda en la hoja "Notas") ---- */
const AG_COLORS = { verde: '#3fae7f', ambar: '#d9a23b', azul: '#4b8fd6', rojo: '#d9624f', morado: '#8b7fd6', gris: '#8c958f' };
const NOTE_BG = { verde: 'nb-verde', ambar: 'nb-ambar', azul: 'nb-azul', rojo: 'nb-rojo', morado: 'nb-morado', gris: '' };
const WDAY_FULL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const addDays = (ds, n) => { const d = new Date(ds + 'T12:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function kindOf(n) {
  if (n.kind) return n.kind;
  const meta = (S.noteMeta || {})[n.id]; if (meta && meta.kind) return meta.kind;
  return (n.due || n.status === 'Pendiente' || n.status === 'En curso' || n.status === 'Hecho') && !n.time ? 'pendiente' : 'nota';
}
const isDone = n => n.status === 'Hecho';
function noteSave(rec) {
  S.noteMeta = S.noteMeta || {}; S.noteMeta[rec.id] = { kind: rec.kind, time: rec.time || '', color: rec.color || '', pinned: !!rec.pinned };
  op('note.upsert', rec);
}
function agItemsOn(ds) {
  const N = S.data.notes;
  const ev = N.filter(n => kindOf(n) === 'evento' && n.due === ds).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  const td = N.filter(n => kindOf(n) === 'pendiente' && (n.due === ds || (ds === today() && n.due && n.due < ds && !isDone(n))));
  const ym = ymOf(ds), pays = S.data.fixed.filter(f => f.freq === 'Mensual').map(f => ({ f, s: fixedStatus(f, ym) })).filter(x => x.s.due === ds || (ds === today() && x.s.late));
  return { ev, td, pays };
}
function agDot(ds) { const it = agItemsOn(ds); return it.ev.length + it.td.filter(n => !isDone(n)).length + it.pays.filter(x => !x.s.marked).length; }
function agEventRow(n) {
  const c = AG_COLORS[n.color] || AG_COLORS.verde;
  return `<button type="button" class="ag-ev ${isDone(n) ? 'done' : ''}" data-act="agEdit" data-id="${esc(n.id)}" style="--c:${c}"><span class="ag-time">${esc(n.time || 'Todo el día')}</span><span class="ag-evb"><b>${esc(n.text)}</b>${n.action ? `<small>${esc(n.action)}</small>` : ''}${n.tag ? `<small class="ag-tag">${esc(n.tag)}</small>` : ''}</span></button>`;
}
function agTodoRow(n, showDue) {
  const late = n.due && n.due < today() && !isDone(n);
  return `<div class="ag-todo ${isDone(n) ? 'done' : ''}"><button type="button" class="ag-check" data-act="agToggle" data-id="${esc(n.id)}" aria-label="${isDone(n) ? 'Marcar como pendiente' : 'Marcar como hecho'}">${isDone(n) ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>' : ''}</button><button type="button" class="ag-todob" data-act="agEdit" data-id="${esc(n.id)}"><span>${esc(n.text)}</span>${(showDue && n.due) || late || n.tag || n.time ? `<small class="${late ? 'neg' : ''}">${late ? 'Vencido · ' : ''}${showDue && n.due ? agDueLabel(n.due) : ''}${n.time ? ' ' + esc(n.time) : ''}${n.tag ? ' · ' + esc(n.tag) : ''}</small>` : ''}</button></div>`;
}
function agPayRow({ f, s }) {
  return `<div class="ag-todo pay ${s.marked ? 'done' : ''}"><span class="ag-check pay" aria-hidden="true">$</span><a class="ag-todob" href="#pagos"><span>Pagar ${esc(f.name)}</span><small class="${s.late ? 'neg' : ''}">${s.marked ? 'Pagado' : s.late ? 'Vencido' : 'Pago fijo'} · <b class="num">${money(f.amount)}</b></small></a>${s.marked ? '' : `<button type="button" class="btn sm" data-act="${s.found.length ? 'fixMark' : 'fixPay'}" data-n="${esc(f.name)}">${s.found.length ? 'Marcar' : 'Pagar'}</button>`}</div>`;
}
function agDueLabel(ds) {
  const t = today(); if (ds === t) return 'Hoy'; if (ds === addDays(t, 1)) return 'Mañana'; if (ds === addDays(t, -1)) return 'Ayer';
  const d = new Date(ds + 'T12:00'), diff = Math.round((d - new Date(t + 'T12:00')) / 864e5);
  if (diff > 0 && diff < 7) return WDAY_FULL[d.getDay()][0].toUpperCase() + WDAY_FULL[d.getDay()].slice(1);
  return dLabel(ds).replace(/ \d{4}$/, '');
}
function vAgenda() {
  const tab = S.ui.agTab || 'dia';
  const pend = S.outbox.filter(o => o.type.startsWith('note.')).length;
  const status = !S.cfg.url ? `<span class="ag-sync warn">Solo en este equipo · <a href="#ajustes">conecta tu hoja</a> para respaldar</span>`
    : S.agendaV1 || (S.cfg.serverV && S.cfg.serverV < 2) ? `<span class="ag-sync warn">Actualiza el conector de tu hoja para respaldar horas, colores y fijadas en otros equipos</span>`
    : pend ? `<span class="ag-sync">${pend} cambio${pend > 1 ? 's' : ''} por respaldar</span>`
    : `<span class="ag-sync ok">Respaldado en tu hoja${S.cfg.lastSync ? ' · ' + ago(S.cfg.lastSync) : ''}</span>`;
  const tabs = `<div class="ptabs">${[['dia', 'Día'], ['pend', 'Pendientes'], ['notas', 'Notas']].map(([k, l]) => `<button type="button" data-act="agTab" data-v="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const hd = head('Agenda', status, `<button class="btn" data-act="agBackup">Descargar respaldo</button><button class="btn pri" data-act="agNew" data-v="${tab === 'notas' ? 'nota' : tab === 'pend' ? 'pendiente' : 'evento'}">+ ${tab === 'notas' ? 'Nota' : tab === 'pend' ? 'Pendiente' : 'Nuevo'}</button>`);
  if (tab === 'pend') return hd + tabs + agPendView();
  if (tab === 'notas') return hd + tabs + agNotesView();
  return hd + tabs + agDayView();
}
function agDayView() {
  const day = S.ui.agDay || today(), ws = weekStart(day);
  const strip = Array.from({ length: 7 }, (_, i) => { const ds = addDays(ws, i), d = new Date(ds + 'T12:00'), n = agDot(ds); return `<button type="button" class="ag-d ${ds === day ? 'on' : ''} ${ds === today() ? 'today' : ''}" data-act="agDay" data-v="${ds}"><span>${WEEK[i]}</span><b>${d.getDate()}</b><i class="${n ? '' : 'none'}"></i></button>`; }).join('');
  const it = agItemsOn(day), d = new Date(day + 'T12:00');
  const noTime = it.td;
  const empty = !it.ev.length && !noTime.length && !it.pays.length;
  return `<div class="card ag-week"><div class="ag-wnav"><button type="button" class="linkbtn" data-act="agDay" data-v="${addDays(ws, -7)}">‹ Semana anterior</button><b>${MONTHS[d.getMonth()]} ${d.getFullYear()}</b>${day !== today() ? '<button type="button" class="linkbtn" data-act="agDay" data-v="">Hoy</button>' : ''}<button type="button" class="linkbtn" data-act="agDay" data-v="${addDays(ws, 7)}">Siguiente ›</button></div><div class="ag-strip">${strip}</div></div>
  <div class="grid-2" style="align-items:start">
    <section class="card"><header><h2>${WDAY_FULL[d.getDay()][0].toUpperCase() + WDAY_FULL[d.getDay()].slice(1)} ${d.getDate()} de ${MONTHS[d.getMonth()].toLowerCase()}</h2><button type="button" class="linkbtn" data-act="agNew" data-v="evento" data-d="${day}">+ Actividad</button></header>
      ${it.ev.length ? `<div class="ag-evs">${it.ev.map(agEventRow).join('')}</div>` : `<p class="note">${empty ? 'Día libre. Agrega una actividad con hora o un pendiente.' : 'Sin actividades con hora.'}</p>`}
    </section>
    <section class="card"><header><h2>Pendientes y pagos</h2><button type="button" class="linkbtn" data-act="agNew" data-v="pendiente" data-d="${day}">+ Pendiente</button></header>
      ${it.pays.length || noTime.length ? `<div class="ag-todos">${it.pays.map(agPayRow).join('')}${noTime.map(n => agTodoRow(n, false)).join('')}</div>` : '<p class="note">Nada pendiente para este día.</p>'}
    </section>
  </div>`;
}
function parseTodo(txt) {
  let t = ' ' + txt.trim() + ' ', due = '', time = '';
  const low = t.toLowerCase(), td = today();
  const set = (re, v) => { const m = low.match(re); if (m) { due = v; t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length); return true; } return false; };
  set(/\s(pasado mañana)\s/, addDays(td, 2)) || set(/\s(mañana|manana)\s/, addDays(td, 1)) || set(/\s(hoy)\s/, td);
  if (!due) { WDAY_FULL.forEach((w, i) => { if (due) return; const re = new RegExp('\\s(el\\s)?' + w.replace('é', '[eé]').replace('á', '[aá]') + '\\s'); const cur = new Date(td + 'T12:00').getDay(); let k = (i - cur + 7) % 7; if (k === 0) k = 7; set(re, addDays(td, k)); }); }
  if (!due) { const m = t.toLowerCase().match(/\s(el\s)?(\d{1,2})(\s(de\s)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))?\s/); if (m) { const day = Number(m[2]); let mo = m[5] ? MONTHS.map(x => x.toLowerCase()).indexOf(m[5]) + 1 : new Date(td + 'T12:00').getMonth() + 1, yr = Number(td.slice(0, 4)); let ds = `${yr}-${pad(mo)}-${pad(day)}`; if (ds < td && !m[5]) { mo++; if (mo > 12) { mo = 1; yr++; } ds = `${yr}-${pad(mo)}-${pad(day)}`; } if (day >= 1 && day <= 31 && (m[1] || m[5])) { due = ds; t = t.replace(m[0], ' '); } } }
  const tm = t.match(/\s(a las\s)?(\d{1,2})(:(\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)?\s/i);
  if (tm && (tm[1] || tm[3] || tm[5])) { let h = Number(tm[2]); const mi = tm[4] || '00', ap = (tm[5] || '').toLowerCase(); if (ap.startsWith('p') && h < 12) h += 12; if (ap.startsWith('a') && h === 12) h = 0; if (!ap && h < 7) h += 12; if (h < 24) { time = `${pad(h)}:${mi}`; t = t.replace(tm[0], ' '); } }
  return { text: t.replace(/\s+/g, ' ').trim(), due, time };
}
function agPendView() {
  const all = S.data.notes.filter(n => kindOf(n) === 'pendiente'), td = today(), wk = addDays(td, 7);
  const open = all.filter(n => !isDone(n));
  const g = { hoy: open.filter(n => n.due && n.due <= td), sem: open.filter(n => n.due && n.due > td && n.due <= wk), algun: open.filter(n => !n.due || n.due > wk) };
  Object.values(g).forEach(L => L.sort((a, b) => (a.due || '9').localeCompare(b.due || '9') || (a.time || '').localeCompare(b.time || '')));
  const done = all.filter(isDone).sort((a, b) => (b.due || b.date || '').localeCompare(a.due || a.date || '')).slice(0, 8);
  const tot = all.filter(n => !n.due || n.due <= wk).length, ok = all.filter(n => isDone(n) && (!n.due || n.due <= wk)).length;
  const pays = S.data.fixed.filter(f => f.freq === 'Mensual').map(f => ({ f, s: fixedStatus(f, ymOf(td)) })).filter(x => !x.s.marked && (x.s.late || x.s.due <= wk));
  const sec = (title, cls, L, extra = '') => (L.length || extra) ? `<div class="ag-grp ${cls}">${title}</div><div class="ag-todos">${extra}${L.map(n => agTodoRow(n, true)).join('')}</div>` : '';
  return `<section class="card ag-pend">
    <div class="row2"><span class="muted">${ok} de ${tot} hechos</span><span class="num muted">${tot ? Math.round(ok / tot * 100) : 0}%</span></div>
    <div class="bar good"><i style="width:${tot ? ok / tot * 100 : 0}%"></i></div>
    <form id="agQuick" class="ag-quick"><input id="agQ" type="text" autocomplete="off" placeholder="Escribe y presiona Enter: pagar luz el viernes a las 5pm"><button class="btn pri" type="submit">Agregar</button></form>
    <p class="note" id="agQhint"></p>
    ${sec('Hoy', 'hoy', g.hoy, pays.filter(x => x.s.late || x.s.due <= td).map(agPayRow).join(''))}
    ${sec('Esta semana', 'sem', g.sem, pays.filter(x => !x.s.late && x.s.due > td).map(agPayRow).join(''))}
    ${sec('Algún día', 'algun', g.algun)}
    ${!open.length && !pays.length ? '<div class="empty"><p>No tienes pendientes. Escribe arriba el primero.</p></div>' : ''}
    ${done.length ? `<details class="ag-donebox"><summary>Hechos recientemente (${done.length})</summary><div class="ag-todos">${done.map(n => agTodoRow(n, true)).join('')}</div></details>` : ''}
  </section>`;
}
function agNotesView() {
  const q = (S.ui.agQ || '').toLowerCase(), tag = S.ui.agTag || '';
  const notes = S.data.notes.filter(n => kindOf(n) === 'nota');
  const tags = [...new Set(notes.map(n => n.tag).filter(Boolean))].sort();
  const L = notes.filter(n => (!tag || n.tag === tag) && (!q || `${n.text} ${n.action} ${n.tag}`.toLowerCase().includes(q))).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const pinned = L.filter(n => n.pinned || (S.noteMeta || {})[n.id]?.pinned), rest = L.filter(n => !pinned.includes(n));
  const card = n => `<button type="button" class="ag-note ${NOTE_BG[n.color] || ''}" data-act="agEdit" data-id="${esc(n.id)}"><b>${esc(n.text)}</b>${n.action ? `<span>${esc(n.action).replace(/\n/g, '<br>')}</span>` : ''}<small>${n.tag ? esc(n.tag) + ' · ' : ''}${dLabel(n.date).replace(/ \d{4}$/, '')}</small></button>`;
  return `<div class="card"><div class="filters"><input class="ctl" id="agSearch" type="search" placeholder="Buscar en tus notas" value="${esc(S.ui.agQ || '')}" style="flex:2 1 220px"></div>
    ${tags.length ? `<div class="chips" style="margin-top:10px;flex-wrap:wrap">${['', ...tags].map(t => `<button type="button" class="rchip ${t === tag ? 'on' : ''}" data-act="agTagF" data-v="${esc(t)}">${t ? esc(t) : 'Todas'}</button>`).join('')}</div>` : ''}</div>
  ${pinned.length ? `<div class="ag-grp">Fijadas</div><div class="ag-notes">${pinned.map(card).join('')}</div>` : ''}
  ${rest.length ? `${pinned.length ? '<div class="ag-grp">Otras</div>' : ''}<div class="ag-notes">${rest.map(card).join('')}</div>` : !pinned.length ? `<div class="card empty"><p>${q || tag ? 'No hay notas con ese filtro.' : 'Sin notas todavía. Apunta ideas, listas o lo que no quieras olvidar.'}</p><button class="btn pri" data-act="agNew" data-v="nota">Nueva nota</button></div>` : ''}`;
}
function editAgenda(n, kind, day) {
  const isNew = !n;
  const meta = n ? (S.noteMeta || {})[n.id] || {} : {};
  n = Object.assign({ id: uid(), date: today(), tag: '', text: '', action: '', due: kind === 'nota' ? '' : (day || S.ui.agDay || today()), status: kind === 'nota' ? '' : 'Pendiente', kind: kind || 'evento', time: '', color: kind === 'nota' ? 'gris' : 'verde', pinned: false }, n ? { kind: kindOf(n), time: n.time || meta.time || '', color: n.color || meta.color || '', pinned: n.pinned || meta.pinned || false } : {}, n || {}, n ? { kind: kindOf(n), time: n.time || meta.time || '', color: n.color || meta.color || (kindOf(n) === 'nota' ? 'gris' : 'verde'), pinned: !!(n.pinned || meta.pinned) } : {});
  const K = [['evento', 'Actividad'], ['pendiente', 'Pendiente'], ['nota', 'Nota']];
  const tags = [...new Set(S.data.notes.map(x => x.tag).filter(Boolean))];
  const body = `<div class="seg" id="agK">${K.map(([k, l]) => `<button type="button" data-k="${k}" class="${n.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <label class="field"><span id="agTitleL">Título</span><input id="agTitle" value="${esc(n.text)}" required autofocus placeholder="Reparar laptop cliente"></label>
    <div class="two" data-k="evento,pendiente"><label class="field"><span>Fecha</span><input id="agDue" type="date" value="${n.due || ''}"></label><label class="field"><span>Hora</span><input id="agTime" type="time" value="${n.time || ''}"></label></div>
    <label class="field"><span id="agBodyL">Detalle</span><textarea id="agBody" rows="${n.kind === 'nota' ? 6 : 3}" placeholder="Notas, lista, dirección…">${esc(n.action)}</textarea></label>
    <div class="two"><label class="field"><span>Etiqueta</span><input id="agTag" list="agTags" value="${esc(n.tag)}" placeholder="Negocio, U, Compras…"><datalist id="agTags">${tags.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
    <div class="field"><span>Color</span><div class="ag-colors" id="agColor">${Object.entries(AG_COLORS).map(([k, c]) => `<button type="button" data-c="${k}" class="${n.color === k ? 'on' : ''}" style="background:${c}" aria-label="${k}"></button>`).join('')}</div></div></div>
    <label class="ag-pin" data-k="nota"><input type="checkbox" id="agPin" ${n.pinned ? 'checked' : ''}> Fijar arriba</label>
    <label class="ag-pin" data-k="pendiente,evento"><input type="checkbox" id="agDone" ${isDone(n) ? 'checked' : ''}> Hecho</label>
    <div class="btns" style="justify-content:space-between">${isNew ? '<span></span>' : '<button type="button" class="btn danger" id="agDel">Eliminar</button>'}<button class="btn pri">Guardar</button></div>
    <div id="agDelC" hidden class="alert bad"><span></span><div><b>¿Eliminar?</b><p>Se borra también de tu hoja.</p></div><div class="acts"><button type="button" class="btn sm danger" id="agDelY">Eliminar</button></div></div>`;
  openSheet(isNew ? 'Agregar a la agenda' : 'Editar', body, f => {
    const k = f.querySelector('#agK .on').dataset.k, text = $('#agTitle').value.trim();
    if (!text) return 'Escribe el título.';
    if (k === 'evento' && !$('#agDue').value) return 'Elige la fecha de la actividad.';
    const rec = { id: n.id, date: n.date || today(), tag: $('#agTag').value.trim(), text, action: $('#agBody').value.trim(), due: k === 'nota' ? '' : $('#agDue').value, status: k === 'nota' ? '' : ($('#agDone').checked ? 'Hecho' : 'Pendiente'), kind: k, time: k === 'nota' ? '' : $('#agTime').value, color: f.querySelector('#agColor .on')?.dataset.c || '', pinned: k === 'nota' && $('#agPin').checked };
    noteSave(rec); toast(isNew ? 'Guardado en tu agenda' : 'Cambios guardados');
  }, f => {
    const sync = () => { const k = f.querySelector('#agK .on').dataset.k; f.querySelectorAll('[data-k]').forEach(el => { if (el.closest('#agK')) return; el.hidden = !el.dataset.k.split(',').includes(k); }); $('#agTitleL').textContent = k === 'nota' ? 'Título' : k === 'pendiente' ? '¿Qué tienes que hacer?' : 'Actividad'; $('#agBody').rows = k === 'nota' ? 6 : 3; };
    f.querySelector('#agK').onclick = e => { const b = e.target.closest('button'); if (!b) return; f.querySelectorAll('#agK button').forEach(x => x.classList.toggle('on', x === b)); sync(); };
    f.querySelector('#agColor').onclick = e => { const b = e.target.closest('button'); if (!b) return; f.querySelectorAll('#agColor button').forEach(x => x.classList.toggle('on', x === b)); };
    $('#agDel')?.addEventListener('click', () => { $('#agDelC').hidden = false; });
    $('#agDelY')?.addEventListener('click', () => { op('note.delete', { id: n.id }); closeSheet(); toast('Eliminado'); });
    sync();
  });
}
function todayCard() {
  const it = agItemsOn(today());
  const ev = it.ev.filter(n => !isDone(n)), td = it.td.filter(n => !isDone(n)), pays = it.pays.filter(x => !x.s.marked);
  const upcoming = !ev.length && !td.length && !pays.length ? S.data.notes.filter(n => kindOf(n) !== 'nota' && !isDone(n) && n.due > today()).sort((a, b) => (a.due + (a.time || '')).localeCompare(b.due + (b.time || ''))).slice(0, 3) : [];
  return `<section class="card side-card today-card"><header style="margin:0"><h2>Hoy en tu agenda</h2><a href="#agenda">Agenda</a></header>
    ${ev.length || td.length || pays.length ? `<div class="ag-evs">${ev.map(agEventRow).join('')}</div><div class="ag-todos">${pays.map(agPayRow).join('')}${td.map(n => agTodoRow(n, false)).join('')}</div>`
    : `<p class="note">Nada para hoy.${upcoming.length ? ' Lo que viene:' : ''}</p>${upcoming.length ? `<div class="ag-todos">${upcoming.map(n => agTodoRow(n, true)).join('')}</div>` : ''}`}
    <form id="agQuickHome" class="ag-quick"><input id="agQH" type="text" autocomplete="off" placeholder="Anota un pendiente: llamar a cliente mañana"><button class="btn sm" type="submit">Agregar</button></form>
  </section>`;
}
function agBackup() {
  const notes = S.data.notes.map(n => Object.assign({}, n, { kind: kindOf(n) }));
  const kinds = { evento: 'ACTIVIDADES', pendiente: 'PENDIENTES', nota: 'NOTAS' };
  const txt = Object.entries(kinds).map(([k, t]) => `${t}\n` + notes.filter(n => n.kind === k).sort((a, b) => (a.due || a.date || '').localeCompare(b.due || b.date || '')).map(n => `- ${n.due ? n.due + (n.time ? ' ' + n.time : '') + ' · ' : ''}${isDone(n) ? '[hecho] ' : ''}${n.text}${n.tag ? ' #' + n.tag : ''}${n.action ? '\n    ' + n.action.replace(/\n/g, '\n    ') : ''}`).join('\n')).join('\n\n');
  download(`agenda-${today()}.txt`, `Mis Finanzas · Agenda (${today()})\n\n` + txt + '\n', 'text/plain');
  setTimeout(() => download(`agenda-${today()}.json`, JSON.stringify({ app: 'Mis Finanzas', tipo: 'agenda', exportado: new Date().toISOString(), notas: notes }, null, 1), 'application/json'), 400);
}

/* =====================================================================
   Bloc de notas (tipo OneNote): cuadernos › secciones › páginas
   Se respalda en la hoja AppData (conector v3):
     nb  = cuadernos, sec = secciones, pg = páginas (datos),
     pgx = contenido de cada página en trozos, img = imágenes en trozos
   ===================================================================== */
const CHUNK = 45000;
const NB_COLORS = ['#d9a23b', '#4b8fd6', '#3fae7f', '#8b7fd6', '#d9624f', '#3fa7b5', '#8c958f'];
const IMG = new Map();
const store = c => ((S.data.store = S.data.store || {})[c] = S.data.store[c] || {});
/* operación sin redibujar (para escribir sin perder el cursor) */
function opq(type, data) {
  if (!S.syncing && type === 'rec.upsert') S.outbox = S.outbox.filter(o => !(o.type === 'rec.upsert' && o.data.coll === data.coll && o.data.id === data.id));
  const o = { opId: uid(), type, data, t: Date.now() };
  applyLocal(o); S.outbox.push(o); save(); scheduleSync(2500);
}
function blobPut(coll, id, str) {
  const n = Math.max(1, Math.ceil(str.length / CHUNK)), prev = blobCount(coll, id);
  for (let i = 0; i < n; i++) opq('rec.upsert', { coll, id: `${id}:${i}`, data: i === 0 ? { n, d: str.slice(0, CHUNK) } : str.slice(i * CHUNK, (i + 1) * CHUNK) });
  for (let i = n; i < prev; i++) opq('rec.delete', { coll, id: `${id}:${i}` });
  return n;
}
function blobCount(coll, id) { const c = store(coll)[`${id}:0`]; return c && c.n ? c.n : 0; }
function blobGet(coll, id) {
  const s = store(coll), c0 = s[`${id}:0`]; if (!c0) return null;
  let out = c0.d || ''; for (let i = 1; i < (c0.n || 1); i++) { const c = s[`${id}:${i}`]; if (c == null) return null; out += c; }
  return out;
}
function blobDel(coll, id, n) { for (let i = 0; i < (n || blobCount(coll, id) || 1); i++) opq('rec.delete', { coll, id: `${id}:${i}` }); }

/* ---- imágenes: caché en IndexedDB para que el teléfono no se llene ---- */
const IDB = (() => {
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => { try { const r = indexedDB.open('misfinanzas-img', 1); r.onupgradeneeded = () => r.result.createObjectStore('img'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }));
  const tx = (mode, fn) => db().then(d => new Promise((res, rej) => { const t = d.transaction('img', mode), s = t.objectStore('img'); const q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }));
  return { get: k => tx('readonly', s => s.get(k)).catch(() => null), put: (k, v) => tx('readwrite', s => s.put(v, k)).catch(() => null), del: k => tx('readwrite', s => s.delete(k)).catch(() => null) };
})();
async function imgSrc(id) {
  if (IMG.has(id)) return IMG.get(id);
  let v = await IDB.get(id);
  if (!v) { v = blobGet('img', id); if (v) IDB.put(id, v); }
  if (v) IMG.set(id, v);
  return v || '';
}
function hydrateImgs(root) { (root || document).querySelectorAll('img[data-img]').forEach(async im => { if (!im.getAttribute('src')) { const s = await imgSrc(im.dataset.img); if (s) im.src = s; else im.alt = 'Imagen pendiente de sincronizar'; } }); }
/* al llegar datos de la hoja: pasa las imágenes a la caché y no las guarda en localStorage */
function absorbImages() {
  const s = (S.data.store || {}).img; if (!s) return;
  Object.keys(s).filter(k => k.endsWith(':0')).forEach(k => { const id = k.slice(0, -2); if (!IMG.has(id)) { const v = blobGet('img', id); if (v) { IMG.set(id, v); IDB.put(id, v); } } });
}
function compressImage(file, max = 1100, q = 0.66) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { const im = new Image(); im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', q)); }; im.onerror = rej; im.src = fr.result; };
    fr.onerror = rej; fr.readAsDataURL(file);
  });
}
function storeImage(dataUrl) {
  const id = 'i' + uid(); IMG.set(id, dataUrl); IDB.put(id, dataUrl);
  const n = blobPut('img', id, dataUrl);
  return { id, n };
}

/* ---- modelo ---- */
const NBS = () => Object.entries(store('nb')).map(([id, v]) => Object.assign({ id }, v)).filter(x => !x.del).sort((a, b) => (a.order || 0) - (b.order || 0) || (a.name || '').localeCompare(b.name || ''));
const SECS = nb => Object.entries(store('sec')).map(([id, v]) => Object.assign({ id }, v)).filter(x => x.nb === nb).sort((a, b) => (a.order || 0) - (b.order || 0));
const PGS = sec => Object.entries(store('pg')).map(([id, v]) => Object.assign({ id }, v)).filter(x => !sec || x.sec === sec).sort((a, b) => (b.updated || 0) - (a.updated || 0));
const pgGet = id => { const v = store('pg')[id]; return v ? Object.assign({ id }, v) : null; };
const pgHtml = id => blobGet('pgx', id) || '';
const plain = html => { const d = document.createElement('div'); d.innerHTML = html; return (d.textContent || '').replace(/\s+/g, ' ').trim(); };
function recPut(coll, id, data) { opq('rec.upsert', { coll, id, data }); }
function ensureBloc() {
  if (NBS().length) return;
  if (!S.cfg.url || S.cfg.serverV >= 3 || window.__SEED__) {
    const nb = 'n' + uid(), sec = 's' + uid();
    recPut('nb', nb, { name: 'Mi cuaderno', color: NB_COLORS[0], order: 1 });
    recPut('sec', sec, { nb, name: 'Notas rápidas', color: NB_COLORS[0], order: 1 });
    S.ui.nb = nb; S.ui.sec = sec;
  }
}
function curNb() { const L = NBS(); if (!L.find(x => x.id === S.ui.nb)) S.ui.nb = L[0] && L[0].id; return S.ui.nb; }
function curSec() { const L = SECS(curNb()); if (!L.find(x => x.id === S.ui.sec)) S.ui.sec = L[0] && L[0].id; return S.ui.sec; }

/* ---- plantillas ---- */
const TEMPLATES = {
  blanco: ['Página en blanco', ''],
  orden: ['Orden de servicio', `<h2>Cliente</h2><p><b>Nombre:</b>&nbsp;</p><p><b>Teléfono:</b>&nbsp;</p><h2>Equipo</h2><p><b>Tipo / marca / modelo:</b>&nbsp;</p><p><b>Problema reportado:</b>&nbsp;</p><h2>Diagnóstico y trabajo</h2><ul class="chk"><li>Revisar encendido</li><li>Respaldo de información</li><li><br></li></ul><h2>Costos</h2><table><tbody><tr><th>Concepto</th><th>Monto</th></tr><tr><td>Repuestos</td><td>$</td></tr><tr><td>Mano de obra</td><td>$</td></tr><tr><td><b>Total</b></td><td><b>$</b></td></tr></tbody></table><p><b>Fecha de entrega:</b>&nbsp;</p>`],
  cotizacion: ['Cotización', `<h2>Cotización para</h2><p><br></p><table><tbody><tr><th>Producto / servicio</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr><tr><td><br></td><td>1</td><td>$</td><td>$</td></tr><tr><td><br></td><td>1</td><td>$</td><td>$</td></tr><tr><td colspan="3"><b>Total</b></td><td><b>$</b></td></tr></tbody></table><p><b>Validez:</b> 15 días</p><p><b>Forma de pago:</b>&nbsp;</p>`],
  clase: ['Apuntes de clase', `<p><b>Materia:</b>&nbsp;</p><p><b>Tema:</b>&nbsp;</p><h2>Ideas principales</h2><ul><li><br></li></ul><h2>Tareas</h2><ul class="chk"><li><br></li></ul><h2>Dudas para el docente</h2><ul><li><br></li></ul>`],
  compras: ['Lista de compras', `<ul class="chk"><li><br></li><li><br></li><li><br></li></ul><p><b>Presupuesto:</b> $</p>`],
  reunion: ['Reunión', `<p><b>Fecha y hora:</b>&nbsp;</p><p><b>Participantes:</b>&nbsp;</p><h2>Temas</h2><ul><li><br></li></ul><h2>Acuerdos</h2><ul class="chk"><li><br></li></ul>`]
};
/* ---- importar archivos como páginas ---- */
function mdToHTML(md) {
  const inl = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/~~(.+?)~~/g, '<s>$1</s>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const open = t => { if (list !== t) { close(); out.push(t === 'chk' ? '<ul class="chk">' : `<${t}>`); list = t; } };
  String(md).split(/\r?\n/).forEach(l => {
    let m;
    if ((m = l.match(/^\s*(#{1,6})\s+(.*)/))) { close(); const h = Math.min(3, m[1].length); out.push(`<h${h}>${inl(m[2])}</h${h}>`); }
    else if ((m = l.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)/))) { open('chk'); out.push(`<li${m[1].trim() ? ' class="done"' : ''}>${inl(m[2])}</li>`); }
    else if ((m = l.match(/^\s*(?:[-*+•·]|☐|☑)\s+(.*)/))) { open('ul'); out.push(`<li>${inl(m[1])}</li>`); }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { open('ol'); out.push(`<li>${inl(m[1])}</li>`); }
    else if ((m = l.match(/^\s*>\s?(.*)/))) { close(); out.push(`<blockquote>${inl(m[1])}</blockquote>`); }
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { close(); out.push('<hr>'); }
    else if (!l.trim()) { close(); out.push('<p><br></p>'); }
    else { close(); out.push(`<p>${inl(l)}</p>`); }
  });
  close(); return out.join('');
}
async function importFiles(files) {
  const sec = curSec(); if (!sec) return toast('Crea primero una sección');
  let last = '', n = 0;
  for (const f of files) {
    try {
      const raw = await f.text(), isHtml = /\.html?$/i.test(f.name) || /html/.test(f.type) || /^\s*<(!doctype|html|body|div|p|h\d)/i.test(raw);
      let title = f.name.replace(/\.[^.]+$/, ''), html;
      if (isHtml) {
        const t = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]; if (t && t.trim()) title = plain(t);
        const body = (raw.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || raw;
        html = cleanHTML(body);
      } else html = cleanHTML(mdToHTML(raw));
      const d = document.createElement('div'); d.innerHTML = html;
      const h1 = d.firstElementChild; if (h1 && h1.tagName === 'H1' && plain(h1.innerHTML).toLowerCase() === title.toLowerCase()) h1.remove();
      for (const im of [...d.querySelectorAll('img[data-pending]')]) { try { const url = await compressImage(await (await fetch(im.src)).blob()); const r = storeImage(url); im.removeAttribute('data-pending'); im.removeAttribute('src'); im.setAttribute('data-img', r.id); im.setAttribute('data-n', r.n); } catch (e) { im.remove(); } }
      const id = 'p' + uid(), now = Date.now(), imgs = [...d.querySelectorAll('img[data-img]')].map(im => ({ id: im.dataset.img, n: Number(im.dataset.n) || 1 }));
      blobPut('pgx', id, d.innerHTML);
      recPut('pg', id, { sec, title, created: now, updated: now, bg: 'lineas', size: 15, pinned: false, imgs, snip: plain(d.innerHTML).slice(0, 120) });
      last = id; n++;
    } catch (e) { toast(`No pude leer ${f.name}`); }
  }
  if (last) { S.ui.pg = last; S.ui.blocPane = 'editor'; S.ui.blocQ = ''; render(); toast(n > 1 ? `${n} páginas importadas` : 'Página importada'); }
}
function pgBlank(id) { const p = pgGet(id); if (!p) return false; const d = document.createElement('div'); d.innerHTML = pgHtml(id); return !(p.title || '').trim() && !plain(d.innerHTML) && !d.querySelector('img,table,hr') && !(p.imgs || []).length; }
function leavePage(next) { const cur = S.ui.pg; if (!cur || cur === next) return; if (edTimer || $('#pgEditor')) pgSaveNow(); if (pgBlank(cur)) delPage(cur); }
function askDelPage(id) {
  const p = pgGet(id); if (!p) return;
  if (S.ui.pg === id && $('#pgEditor')) pgSaveNow();
  const done = () => { delPage(id); if (S.ui.pg === id) { S.ui.pg = ''; S.ui.blocPane = 'pages'; } render(); toast('Página eliminada'); };
  if (pgBlank(id)) return done();
  openSheet('Eliminar página', `<div class="alert bad"><span></span><div><b>¿Eliminar “${esc(p.title || 'Sin título')}”?</b><p>Se borra también de tu hoja, con sus imágenes. No se puede deshacer.</p></div></div><button class="btn danger">Eliminar</button>`, () => { setTimeout(done, 0); });
}
function newPage(tplKey) {
  leavePage();
  const sec = curSec(); if (!sec) return toast('Crea primero una sección');
  const [t, html] = TEMPLATES[tplKey] || TEMPLATES.blanco, id = 'p' + uid(), now = Date.now();
  recPut('pg', id, { sec, title: tplKey === 'blanco' ? '' : t, created: now, updated: now, bg: 'lineas', size: 15, pinned: false, imgs: [], snip: '' });
  blobPut('pgx', id, html);
  S.ui.pg = id; S.ui.blocPane = 'editor'; render();
  setTimeout(() => { const el = $('#pgTitle'); if (el && !el.value) el.focus(); else $('#pgEditor')?.focus(); }, 60);
}

/* ---- vista ---- */
function vBloc() {
  if (S.cfg.url && S.cfg.serverV && S.cfg.serverV < 3 && !NBS().length) return `${head('Bloc de notas')}<div class="alert"><span></span><div><b>Actualiza el conector de tu hoja para usar el bloc</b><p>El bloc guarda páginas e imágenes en la hoja AppData, que necesita el conector v3. Pégalo una vez en Apps Script (Ajustes te dice cómo) y vuelve aquí.</p></div><div class="acts"><a class="btn sm" href="#ajustes">Ir a Ajustes</a></div></div>`;
  ensureBloc();
  const nb = curNb(), sec = curSec(), q = (S.ui.blocQ || '').toLowerCase();
  if (!S.ui.pg && window.innerWidth >= 900) { const f = PGS(sec)[0]; if (f) S.ui.pg = f.id; }
  if (S.ui.pg && !pgGet(S.ui.pg)) S.ui.pg = '';
  const pane = S.ui.blocPane || 'pages';
  const nbs = NBS();
  const tree = `<div class="bl-tree"><div class="bl-h">Cuadernos</div>${nbs.map(n => `<div class="bl-nb ${n.id === nb ? 'on' : ''}"><button type="button" class="bl-nbb" data-act="blNb" data-v="${n.id}"><svg viewBox="0 0 24 24" fill="none" stroke="${n.color}" stroke-width="2" aria-hidden="true"><path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h12M9 8h6"/></svg><span>${esc(n.name)}</span></button><button type="button" class="bl-more" data-act="blNbMenu" data-v="${n.id}" aria-label="Opciones del cuaderno">⋯</button></div>
      ${n.id === nb ? `<div class="bl-secs">${SECS(n.id).map(s => `<div class="bl-sec ${s.id === sec ? 'on' : ''}"><button type="button" data-act="blSec" data-v="${s.id}"><i style="background:${s.color || n.color}"></i><span>${esc(s.name)}</span><small>${PGS(s.id).length}</small></button><button type="button" class="bl-more" data-act="blSecMenu" data-v="${s.id}" aria-label="Opciones de la sección">⋯</button></div>`).join('')}<button type="button" class="bl-add" data-act="blNewSec">+ Sección</button></div>` : ''}`).join('')}
      <button type="button" class="bl-add" data-act="blNewNb">+ Nuevo cuaderno</button></div>`;
  const all = q ? PGS().filter(p => `${p.title} ${p.snip}`.toLowerCase().includes(q) || pgHtml(p.id).toLowerCase().includes(q)) : PGS(sec);
  const secObj = SECS(nb).find(s => s.id === sec);
  const pages = `<div class="bl-pages"><input class="ctl" id="blSearch" type="search" placeholder="Buscar en todo el bloc" value="${esc(S.ui.blocQ || '')}">
      <div class="bl-h">${q ? `Resultados (${all.length})` : esc(secObj ? secObj.name : '')}</div>
      ${all.map(p => `<div class="bl-pgw"><button type="button" class="bl-pg ${p.id === S.ui.pg ? 'on' : ''}" data-act="blPg" data-v="${p.id}" style="--c:${(SECS(nb).find(s => s.id === p.sec) || {}).color || '#8c958f'}"><b>${p.pinned ? '📌 ' : ''}${esc(p.title || 'Sin título')}</b><small>${new Date(p.updated || p.created).toLocaleDateString('es', { day: 'numeric', month: 'short' })}${p.imgs && p.imgs.length ? ` · ${p.imgs.length} foto${p.imgs.length > 1 ? 's' : ''}` : ''}${p.snip ? ' · ' + esc(p.snip.slice(0, 40)) : ''}</small></button><button type="button" class="bl-pgdel" data-act="blDelPg" data-v="${p.id}" title="Eliminar página" aria-label="Eliminar página"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button></div>`).join('') || `<p class="note">${q ? 'Nada coincide.' : 'Sección vacía.'}</p>`}
      ${q ? '' : `<div class="bl-newpg"><button type="button" class="btn sm pri" data-act="blNewPg" data-v="blanco">+ Página</button><select class="ctl" id="blTpl" aria-label="Nueva página desde plantilla"><option value="">Plantilla…</option>${Object.entries(TEMPLATES).filter(([k]) => k !== 'blanco').map(([k, [t]]) => `<option value="${k}">${t}</option>`).join('')}</select><label class="btn sm" title="Importar archivo .html, .txt o .md como página nueva">Importar<input type="file" id="blImport" accept=".html,.htm,.txt,.md,text/html,text/plain,text/markdown" multiple hidden></label></div>`}</div>`;
  const p = S.ui.pg && pgGet(S.ui.pg);
  const ed = p ? editorHTML(p) : `<div class="bl-empty"><p>Elige una página o crea una nueva.</p><div class="btns">${Object.entries(TEMPLATES).map(([k, [t]]) => `<button type="button" class="btn sm ${k === 'blanco' ? 'pri' : ''}" data-act="blNewPg" data-v="${k}">${t}</button>`).join('')}</div></div>`;
  return `<div class="bloc pane-${pane}">
    <div class="bl-mhead"><button type="button" class="linkbtn" data-act="blPane" data-v="${pane === 'editor' ? 'pages' : 'tree'}">${pane === 'editor' ? '‹ ' + esc(secObj ? secObj.name : 'Páginas') : pane === 'pages' ? '‹ Cuadernos' : ''}</button><b>${pane === 'tree' ? 'Bloc de notas' : ''}</b><button type="button" class="btn sm" data-act="blExport">PDF</button></div>
    ${tree}${pages}<div class="bl-ed">${ed}</div></div>`;
}
function editorHTML(p) {
  const tb = (a, label, title, extra = '') => `<button type="button" class="tb" data-cmd="${a}" title="${title}" aria-label="${title}" ${extra}>${label}</button>`;
  const ic = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const nb = NBS().find(n => n.id === S.ui.nb) || {}, sec = SECS(S.ui.nb).find(s => s.id === p.sec) || {};
  return `<div class="ed-bar" id="edBar">
      <select class="ed-sel" id="edBlock" aria-label="Estilo de párrafo"><option value="p">Texto</option><option value="h1">Título</option><option value="h2">Subtítulo</option><option value="h3">Encabezado</option><option value="blockquote">Cita</option></select>
      <span class="ed-sep"></span>
      ${tb('bold', '<b>B</b>', 'Negrita')}${tb('italic', '<i>I</i>', 'Cursiva')}${tb('underline', '<u>U</u>', 'Subrayado')}${tb('strikeThrough', '<s>S</s>', 'Tachado')}
      <label class="tb hl" title="Resaltar"><span>A</span><select id="edHl" aria-label="Resaltado"><option value="">Resaltar</option><option value="#ffe066">Amarillo</option><option value="#b7f0c8">Verde</option><option value="#bcdcff">Azul</option><option value="#ffc6c0">Rojo</option><option value="transparent">Quitar</option></select></label>
      <label class="tb fc" title="Color de letra"><span>A</span><select id="edFc" aria-label="Color de letra"><option value="">Color</option><option value="#d9624f">Rojo</option><option value="#2e7d5b">Verde</option><option value="#2c6fb7">Azul</option><option value="#b07a12">Ámbar</option><option value="#6b5bd6">Morado</option><option value="inherit">Normal</option></select></label>
      <span class="ed-sep"></span>
      ${tb('insertUnorderedList', ic('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'), 'Viñetas')}${tb('insertOrderedList', ic('<path d="M10 6h10M10 12h10M10 18h10M4 4v4M3 18h3l-3 2h3M3 11c1-1 3-1 3 1l-3 2h3"/>'), 'Numeración')}${tb('check', ic('<rect x="3" y="4" width="7" height="7" rx="1.5"/><path d="M4.5 7.5l1.5 1.5 3-3M13 7h8M13 17h8"/><rect x="3" y="13" width="7" height="7" rx="1.5"/>'), 'Lista de tareas')}
      <span class="ed-sep"></span>
      <label class="tb" title="Insertar imagen">${ic('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>')}<input type="file" id="edImg" accept="image/*" multiple hidden></label>
      ${tb('draw', ic('<path d="M4 20c4 0 4-6 8-6s4 4 8 4M15 4l5 5-7 7H8v-5z"/>'), 'Dibujar a mano')}${tb('table', ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>'), 'Insertar tabla')}${tb('link', ic('<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>'), 'Enlace')}
      <span class="ed-sep"></span>
      ${tb('justifyLeft', ic('<path d="M4 6h16M4 12h10M4 18h14"/>'), 'Alinear a la izquierda')}${tb('justifyCenter', ic('<path d="M4 6h16M7 12h10M5 18h14"/>'), 'Centrar')}${tb('removeFormat', ic('<path d="M6 4h12M10 4l-4 16M14 20H6M17 14l4 4M21 14l-4 4"/>'), 'Quitar formato')}${tb('undo', ic('<path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>'), 'Deshacer')}${tb('redo', ic('<path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"/>'), 'Rehacer')}
      <span class="ed-sep"></span>
      ${tb('todo', ic('<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>') + '<span class="tb-t">Pendiente</span>', 'Convertir texto seleccionado en pendiente de la agenda', 'style="width:auto;padding:0 8px"')}
      <span class="ed-tblops" id="edTblOps" hidden>${tb('rowAdd', '+ fila', 'Agregar fila', 'style="width:auto;padding:0 6px"')}${tb('colAdd', '+ col', 'Agregar columna', 'style="width:auto;padding:0 6px"')}${tb('rowDel', '− fila', 'Quitar fila', 'style="width:auto;padding:0 6px"')}</span>
      <span class="ed-right"><button type="button" class="btn sm ed-del" data-act="blDelPg" data-v="${p.id}" title="Eliminar página" aria-label="Eliminar página"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button><button type="button" class="btn sm" data-act="blPageMenu">Página</button><button type="button" class="btn sm pri" data-act="blExport">PDF</button></span>
    </div>
    <div class="ed-scroll"><div class="ed-paper bg-${p.bg || 'lineas'}" style="--fs:${p.size || 15}px">
      <input id="pgTitle" class="ed-title" value="${esc(p.title || '')}" placeholder="Título de la página" autocomplete="off">
      <div class="ed-meta">${new Date(p.created || Date.now()).toLocaleString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${esc(nb.name || '')} › ${esc(sec.name || '')}<span id="edSaved"></span></div>
      <div id="pgEditor" class="ed-body" contenteditable="true" spellcheck="true" data-placeholder="Escribe aquí. Pega o arrastra imágenes, usa las herramientas de arriba.">${pgHtml(p.id)}</div>
      <div class="img-bar" id="imgBar" hidden><span class="ib-l">Tamaño</span>${[['25', 'S'], ['50', 'M'], ['75', 'L'], ['100', 'XL']].map(([w, l]) => `<button type="button" data-iw="${w}" title="${w}% del ancho">${l}</button>`).join('')}<span class="ib-sep"></span>${[['l', '<path d="M3 5h8v8H3zM14 6h7M14 10h7M3 17h18M3 21h14"/>', 'Izquierda, con texto al lado'], ['c', '<path d="M7 4h10v9H7zM3 17h18M6 21h12"/>', 'Centrada'], ['r', '<path d="M13 5h8v8h-8zM3 6h7M3 10h7M3 17h18M7 21h14"/>', 'Derecha, con texto al lado']].map(([a, d, t]) => `<button type="button" data-ia="${a}" title="${t}" aria-label="${t}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg></button>`).join('')}<span class="ib-sep"></span><button type="button" data-ix="reset" title="Tamaño original">Original</button><button type="button" data-ix="del" title="Quitar imagen" aria-label="Quitar imagen" class="ib-del"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button><span class="ib-w" id="imgW"></span></div>
      <span class="img-h" id="imgH" hidden title="Arrastra para cambiar el tamaño"></span>
    </div></div>`;
}

/* ---- guardar ---- */
let edTimer = null;
function pgSaveNow() {
  clearTimeout(edTimer); edTimer = null;
  const ed = $('#pgEditor'), p = S.ui.pg && pgGet(S.ui.pg); if (!ed || !p) return;
  const c = ed.cloneNode(true);
  c.querySelectorAll('img[data-img]').forEach(im => im.removeAttribute('src'));
  c.querySelectorAll('img.sel').forEach(im => { im.classList.remove('sel'); if (!im.className) im.removeAttribute('class'); });
  const html = c.innerHTML, title = ($('#pgTitle')?.value || '').trim();
  const imgs = [...c.querySelectorAll('img[data-img]')].map(im => ({ id: im.dataset.img, n: Number(im.dataset.n) || 1 }));
  const gone = (p.imgs || []).filter(x => !imgs.some(y => y.id === x.id));
  if (html !== pgHtml(p.id)) blobPut('pgx', p.id, html);
  gone.forEach(x => { blobDel('img', x.id, x.n); IDB.del(x.id); IMG.delete(x.id); });
  const meta = Object.assign({}, store('pg')[p.id], { title, updated: Date.now(), imgs, snip: plain(html).slice(0, 120) });
  recPut('pg', p.id, meta);
  const s = $('#edSaved'); if (s) s.textContent = ' · Guardado';
}
function pgSaveSoon() { const s = $('#edSaved'); if (s) s.textContent = ' · Guardando…'; clearTimeout(edTimer); edTimer = setTimeout(pgSaveNow, 900); }

/* ---- Limpieza de lo que se pega (OneNote, Word, páginas web) ---- */
const KEEP_TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'A', 'IMG', 'SPAN', 'MARK', 'SUB', 'SUP', 'HR']);
const DROP_TAGS = new Set(['STYLE', 'SCRIPT', 'META', 'LINK', 'TITLE', 'HEAD', 'XML', 'O:P', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FORM']);
const BLOCKS = /^(P|DIV|H[1-6]|UL|OL|LI|TABLE|THEAD|TBODY|TR|TD|TH|BLOCKQUOTE|PRE|SECTION|ARTICLE|HEADER|FOOTER|ASIDE|NAV|MAIN|FIGURE|DL|DT|DD|HR|ADDRESS)$/;
function isLightBg(c) {
  if (!c) return true; c = c.trim().toLowerCase();
  if (['transparent', 'white', 'inherit', 'initial', 'none', 'window', 'rgba(0, 0, 0, 0)'].includes(c)) return true;
  const m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/); let r, g, b;
  if (m) { const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1]; r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16); }
  else { const n = c.match(/rgba?\(([^)]+)\)/); if (!n) return false; [r, g, b] = n[1].split(',').map(Number); if (n[1].split(',').length === 4 && Number(n[1].split(',')[3]) === 0) return true; }
  const l = (0.299 * r + 0.587 * g + 0.114 * b); return l > 238 || l < 40;
}
function cleanHTML(html) {
  html = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?o:p[^>]*>/gi, '').replace(/<\/?(w|m|v|st1):[^>]*>/gi, '');
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  const walk = node => {
    [...node.childNodes].forEach(n => {
      if (n.nodeType === 8) { n.remove(); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toUpperCase();
      if (DROP_TAGS.has(tag) || tag.includes(':')) { n.remove(); return; }
      walk(n);
      const st = (n.getAttribute('style') || '').toLowerCase();
      const bold = /font-weight\s*:\s*(bold|[6-9]00)/.test(st), ital = /font-style\s*:\s*italic/.test(st), und = /text-decoration[^;]*underline/.test(st), strike = /text-decoration[^;]*line-through/.test(st);
      const bgm = st.match(/background(?:-color)?\s*:\s*([^;]+)/), bg = bgm && !/url\(/.test(bgm[1]) && !isLightBg(bgm[1]) ? bgm[1].trim() : '';
      const keepCls = tag === 'UL' && n.classList.contains('chk') ? 'chk' : tag === 'LI' && n.classList.contains('done') ? 'done' : tag === 'IMG' ? [...n.classList].filter(c => /^(drawing|al-[lcr])$/.test(c)).join(' ') : '';
      const imW = tag === 'IMG' && (st.match(/(?:^|;)\s*width\s*:\s*(\d{1,3}(?:\.\d+)?)%/) || [])[1];
      const keep = { href: n.getAttribute('href'), src: n.getAttribute('src'), dimg: n.getAttribute('data-img'), dn: n.getAttribute('data-n'), colspan: n.getAttribute('colspan'), rowspan: n.getAttribute('rowspan'), alt: n.getAttribute('alt') };
      [...n.attributes].forEach(a => n.removeAttribute(a.name));
      if (keepCls) n.className = keepCls;
      if (tag === 'A' && keep.href && /^(https?:|mailto:|tel:)/i.test(keep.href)) { n.setAttribute('href', keep.href); n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener'); }
      if ((tag === 'TD' || tag === 'TH')) { if (keep.colspan) n.setAttribute('colspan', keep.colspan); if (keep.rowspan) n.setAttribute('rowspan', keep.rowspan); }
      if (tag === 'IMG') {
        if (keep.dimg) { n.setAttribute('data-img', keep.dimg); if (keep.dn) n.setAttribute('data-n', keep.dn); if (keep.src && keep.src.startsWith('data:')) n.setAttribute('src', keep.src); }
        else if (keep.src && /^(data:image|https?:)/i.test(keep.src)) { n.setAttribute('src', keep.src); if (keep.src.startsWith('data:')) n.setAttribute('data-pending', '1'); }
        else { n.remove(); return; }
        if (keep.alt) n.setAttribute('alt', keep.alt);
        if (imW && Number(imW) >= 5 && Number(imW) <= 100) n.setAttribute('style', `width:${Math.round(Number(imW))}%`);
      }
      let el = n;
      if (!KEEP_TAGS.has(tag)) {
        if (/^(H4|H5|H6)$/.test(tag)) { const h = document.createElement('h3'); while (n.firstChild) h.appendChild(n.firstChild); n.replaceWith(h); el = h; }
        else if (BLOCKS.test(tag) && ![...n.childNodes].some(c => c.nodeType === 1 && BLOCKS.test(c.tagName))) { const p = document.createElement('p'); while (n.firstChild) p.appendChild(n.firstChild); n.replaceWith(p); el = p; }
        else { const f = document.createDocumentFragment(); while (n.firstChild) f.appendChild(n.firstChild); n.replaceWith(f); return; }
      }
      const wrapIn = t => { const w = document.createElement(t); while (el.firstChild) w.appendChild(el.firstChild); el.appendChild(w); };
      if (/^(P|LI|TD|TH|SPAN|H1|H2|H3|BLOCKQUOTE)$/.test(el.tagName)) { if (strike) wrapIn('s'); if (und) wrapIn('u'); if (ital) wrapIn('i'); if (bold && !/^H[1-3]$/.test(el.tagName)) wrapIn('b'); }
      if (bg && el.tagName !== 'IMG') { if (el.tagName === 'SPAN' || el.tagName === 'MARK') el.setAttribute('style', `background-color:${bg}`); else { const s = document.createElement('span'); s.setAttribute('style', `background-color:${bg}`); while (el.firstChild) s.appendChild(el.firstChild); el.appendChild(s); } }
      if (el.tagName === 'SPAN' && !el.getAttribute('style')) { const f = document.createDocumentFragment(); while (el.firstChild) f.appendChild(el.firstChild); el.replaceWith(f); }
    });
  };
  walk(tpl.content);
  // párrafos vacíos repetidos y espacios raros
  let out = tpl.innerHTML.replace(/&nbsp;/g, ' ').replace(/ /g, ' ').replace(/(<p>(\s|<br\s*\/?>)*<\/p>\s*){2,}/gi, '<p><br></p>').replace(/<(b|i|u|s|strong|em)>\s*<\/\1>/gi, '');
  // texto suelto fuera de bloques → párrafo
  const t2 = document.createElement('template'); t2.innerHTML = out;
  let run = null;
  [...t2.content.childNodes].forEach(n => {
    const inline = n.nodeType === 3 ? n.textContent.trim() !== '' : n.nodeType === 1 && !BLOCKS.test(n.tagName) && n.tagName !== 'IMG' ? true : n.nodeType === 1 && n.tagName === 'IMG';
    if (inline) { if (!run) { run = document.createElement('p'); n.before(run); } run.appendChild(n); } else { if (n.nodeType === 3 && !n.textContent.trim()) n.remove(); run = null; }
  });
  return t2.innerHTML;
}
const looksMessy = html => /position\s*:\s*absolute|mso-|font-family|class="?Mso|<div[^>]*style=|color\s*:\s*(white|#fff)|file:\/\//i.test(html || '');
async function absorbPastedImages(root) {
  const L = [...root.querySelectorAll('img[data-pending]')];
  for (const im of L) {
    try { const blob = await (await fetch(im.src)).blob(); const url = await compressImage(blob); const { id, n } = storeImage(url); im.removeAttribute('data-pending'); im.setAttribute('data-img', id); im.setAttribute('data-n', n); im.src = url; } catch (e) { im.removeAttribute('data-pending'); }
  }
  return L.length;
}

/* ---- herramientas del editor ---- */
function edFocus() { const ed = $('#pgEditor'); if (ed && !ed.contains(document.activeElement)) ed.focus(); }
function insertHTML(html) { edFocus(); document.execCommand('insertHTML', false, html); pgSaveSoon(); }
async function insertImageFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try { const url = await compressImage(f); const { id, n } = storeImage(url); insertHTML(`<p><img data-img="${id}" data-n="${n}" src="${url}" alt=""></p>`); }
    catch (e) { toast('No pude leer esa imagen'); }
  }
  hydrateImgs($('#pgEditor')); pgSaveNow();
}
function tableHTML(r = 3, c = 3) { return `<table><tbody>${Array.from({ length: r }, (_, i) => `<tr>${Array.from({ length: c }, () => i ? '<td><br></td>' : '<th><br></th>').join('')}</tr>`).join('')}</tbody></table><p><br></p>`; }
function selCell() { const s = window.getSelection(); let n = s && s.anchorNode; while (n && n !== document.body) { if (n.nodeName === 'TD' || n.nodeName === 'TH') return n; n = n.parentNode; } return null; }
function edCmd(cmd) {
  const ed = $('#pgEditor'); if (!ed) return;
  if (cmd === 'check') { edFocus(); document.execCommand('insertUnorderedList'); const s = window.getSelection(); let n = s.anchorNode; while (n && n !== ed && n.nodeName !== 'UL') n = n.parentNode; if (n && n.nodeName === 'UL') n.classList.toggle('chk'); pgSaveSoon(); return; }
  if (cmd === 'table') {
    edFocus(); document.execCommand('insertHTML', false, tableHTML().replace('<table>', '<table data-new="1">'));
    const t = ed.querySelector('table[data-new]'); if (t) { t.removeAttribute('data-new'); const c = t.querySelector('th,td'); const r = document.createRange(); r.selectNodeContents(c); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    document.dispatchEvent(new Event('selectionchange')); return pgSaveSoon();
  }
  if (cmd === 'draw') return openDraw();
  if (cmd === 'link') { const s = window.getSelection(), txt = s ? String(s) : ''; const range = s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null; openSheet('Insertar enlace', `<label class="field"><span>Dirección</span><input id="lnkUrl" type="url" placeholder="https://" autofocus></label><label class="field"><span>Texto</span><input id="lnkTxt" value="${esc(txt)}"></label><button class="btn pri">Insertar</button>`, () => { let u = $('#lnkUrl').value.trim(); if (!u) return 'Escribe la dirección.'; if (!/^https?:\/\//.test(u)) u = 'https://' + u; const t = $('#lnkTxt').value.trim() || u; setTimeout(() => { const ed2 = $('#pgEditor'); ed2.focus(); if (range) { const s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(range); } document.execCommand('insertHTML', false, `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>&nbsp;`); pgSaveSoon(); }, 30); }); return; }
  if (cmd === 'todo') {
    const s = window.getSelection(); let txt = s ? String(s).trim() : '';
    if (!txt && s && s.anchorNode) { let n = s.anchorNode; while (n && n !== ed && !/^(P|LI|DIV|H1|H2|H3)$/.test(n.nodeName)) n = n.parentNode; txt = n && n !== ed ? n.textContent.trim() : ''; }
    if (!txt) return toast('Selecciona el texto o pon el cursor en la línea');
    const p = parseTodo(txt.slice(0, 200)), pg = pgGet(S.ui.pg);
    noteSave({ id: uid(), date: today(), tag: 'Bloc', text: p.text, action: pg ? 'De la página: ' + (pg.title || 'Sin título') : '', due: p.due, status: 'Pendiente', kind: 'pendiente', time: p.time, color: 'azul', pinned: false });
    return toast(`Pendiente creado${p.due ? ' para ' + agDueLabel(p.due).toLowerCase() : ''}`);
  }
  if (cmd === 'rowAdd' || cmd === 'colAdd' || cmd === 'rowDel') {
    const cell = selCell(); if (!cell) return; const tr = cell.parentNode, tbl = tr.closest('table'), idx = [...tr.children].indexOf(cell);
    if (cmd === 'rowAdd') { const n = tr.cloneNode(true); n.querySelectorAll('td,th').forEach(c => { const td = document.createElement('td'); td.innerHTML = '<br>'; c.replaceWith(td); }); tr.after(n); }
    if (cmd === 'colAdd') tbl.querySelectorAll('tr').forEach((r, i) => { const c = document.createElement(i ? 'td' : 'th'); c.innerHTML = '<br>'; const ref = r.children[idx]; ref ? ref.after(c) : r.appendChild(c); });
    if (cmd === 'rowDel') { if (tbl.querySelectorAll('tr').length > 1) tr.remove(); else tbl.remove(); }
    return pgSaveSoon();
  }
  edFocus(); document.execCommand(cmd, false, null); pgSaveSoon();
}
/* ---- tamaño y posición de imágenes ---- */
function imgSel() { const ed = $('#pgEditor'); return ed && ed.querySelector('img.sel'); }
function imgBarPlace() {
  const bar = $('#imgBar'), h = $('#imgH'), im = imgSel(); if (!bar || !h) return;
  if (!im) { bar.hidden = true; h.hidden = true; return; }
  const paper = bar.parentNode, pr = paper.getBoundingClientRect(), r = im.getBoundingClientRect();
  bar.hidden = false; h.hidden = false;
  const bw = bar.offsetWidth, top = r.top - pr.top - bar.offsetHeight - 8;
  bar.style.top = Math.max(4, top < 4 ? r.bottom - pr.top + 8 : top) + 'px';
  bar.style.left = Math.max(4, Math.min(pr.width - bw - 4, r.left - pr.left + r.width / 2 - bw / 2)) + 'px';
  h.style.top = (r.bottom - pr.top - 9) + 'px'; h.style.left = (r.right - pr.left - 9) + 'px';
  const w = (im.style.width || '').replace('%', ''), al = ['l', 'c', 'r'].find(a => im.classList.contains('al-' + a)) || '';
  bar.querySelectorAll('[data-iw]').forEach(b => b.classList.toggle('on', b.dataset.iw === w));
  bar.querySelectorAll('[data-ia]').forEach(b => b.classList.toggle('on', b.dataset.ia === al));
  $('#imgW').textContent = w ? w + '%' : 'auto';
}
function imgSet(im, o) {
  if (o.w !== undefined) { if (o.w) im.style.width = o.w + '%'; else im.style.removeProperty('width'); if (!im.getAttribute('style')) im.removeAttribute('style'); }
  if (o.al !== undefined) { im.classList.remove('al-l', 'al-c', 'al-r'); if (o.al) im.classList.add('al-' + o.al); }
  requestAnimationFrame(imgBarPlace); pgSaveSoon();
}
function imgBind(ed) {
  const bar = $('#imgBar'), h = $('#imgH'); if (!bar || !h) return;
  bar.addEventListener('mousedown', e => e.preventDefault());
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'), im = imgSel(); if (!b || !im) return;
    if (b.dataset.iw) return imgSet(im, { w: Number(b.dataset.iw) });
    if (b.dataset.ia) { const cur = im.classList.contains('al-' + b.dataset.ia); return imgSet(im, { al: cur ? '' : b.dataset.ia, w: !cur && b.dataset.ia !== 'c' && (!im.style.width || parseFloat(im.style.width) > 60) ? 40 : undefined }); }
    if (b.dataset.ix === 'reset') return imgSet(im, { w: 0, al: '' });
    if (b.dataset.ix === 'del') { const p = im.parentNode; im.remove(); if (p && p !== ed && p.nodeName === 'P' && !p.textContent.trim() && !p.querySelector('img')) p.innerHTML = '<br>'; imgBarPlace(); pgSaveNow(); }
  });
  h.addEventListener('pointerdown', e => {
    const im = imgSel(); if (!im) return; e.preventDefault(); h.setPointerCapture(e.pointerId);
    const full = ed.clientWidth, left = im.getBoundingClientRect().left, rtl = im.classList.contains('al-c') ? 2 : 1;
    const startX = e.clientX, startW = im.getBoundingClientRect().width;
    const mv = ev => { const w = Math.max(10, Math.min(100, Math.round((startW + (ev.clientX - startX) * rtl) / full * 100))); im.style.width = w + '%'; imgBarPlace(); };
    const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); const w = Math.round(parseFloat(im.style.width) / 5) * 5; im.style.width = Math.max(10, w) + '%'; imgBarPlace(); pgSaveNow(); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
  ed.addEventListener('load', e => { if (e.target.tagName === 'IMG' && e.target.classList.contains('sel')) imgBarPlace(); }, true);
  ed.addEventListener('input', () => requestAnimationFrame(imgBarPlace));
  window.addEventListener('resize', imgBarPlace);
}
function edBind() {
  const ed = $('#pgEditor'); if (!ed || ed.dataset.b) return; ed.dataset.b = 1;
  try { document.execCommand('styleWithCSS', false, false); document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { }
  if (looksMessy(ed.innerHTML)) { ed.innerHTML = cleanHTML(ed.innerHTML); setTimeout(() => { pgSaveNow(); toast('Arreglé el formato pegado de esta página'); }, 50); }
  hydrateImgs(ed); imgBind(ed);
  ed.addEventListener('input', pgSaveSoon);
  ed.addEventListener('blur', () => edTimer && pgSaveNow());
  $('#pgTitle').addEventListener('input', pgSaveSoon);
  $('#pgTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ed.focus(); } });
  ed.addEventListener('click', e => {
    const li = e.target.closest('ul.chk > li'); if (li && e.offsetX < 26) { li.classList.toggle('done'); pgSaveSoon(); }
    const a = e.target.closest('a[href]'); if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank', 'noopener');
    const im = e.target.closest('img'); ed.querySelectorAll('img.sel').forEach(x => x !== im && x.classList.remove('sel')); if (im) { im.classList.add('sel'); const r = document.createRange(); r.setStartAfter(im); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } imgBarPlace();
  });
  ed.addEventListener('keydown', e => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && ed.querySelector('img.sel')) { e.preventDefault(); ed.querySelector('img.sel').remove(); imgBarPlace(); pgSaveNow(); }
    else if (ed.querySelector('img.sel') && !['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) { ed.querySelectorAll('img.sel').forEach(x => x.classList.remove('sel')); imgBarPlace(); }
    if (e.key === 'Tab') {
      e.preventDefault(); const cell = selCell();
      if (cell) { const cells = [...cell.closest('table').querySelectorAll('th,td')], i = cells.indexOf(cell); let nx = cells[i + (e.shiftKey ? -1 : 1)]; if (!nx && !e.shiftKey) { edCmd('rowAdd'); nx = cell.closest('table').querySelectorAll('tr')[[...cell.closest('table').querySelectorAll('tr')].indexOf(cell.parentNode) + 1].firstElementChild; } if (nx) { const r = document.createRange(); r.selectNodeContents(nx); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } return; }
      document.execCommand(e.shiftKey ? 'outdent' : 'indent');
    }
  });
  ed.addEventListener('paste', async e => {
    const cd = e.clipboardData; if (!cd) return;
    const files = [...(cd.files || [])].filter(f => f.type.startsWith('image/'));
    const html = cd.getData('text/html'), txt = cd.getData('text/plain');
    if (html) {
      e.preventDefault();
      const lostImgs = (html.match(/<img[^>]+src=["']?(file:|cid:|[a-z]:\\)/gi) || []).length;
      const clean = cleanHTML(html);
      document.execCommand('insertHTML', false, clean.trim() ? clean : esc(txt).replace(/\n/g, '<br>'));
      const n = await absorbPastedImages(ed);
      if (files.length && (lostImgs || !/<img/i.test(clean))) await insertImageFiles(files);
      else if (lostImgs) toast(`${lostImgs} imagen${lostImgs > 1 ? 'es' : ''} de OneNote no se pudo copiar: pégala o insértala aparte`);
      hydrateImgs(ed); pgSaveNow(); return;
    }
    if (files.length) { e.preventDefault(); insertImageFiles(files); return; }
    if (txt) { e.preventDefault(); document.execCommand('insertHTML', false, txt.split(/\r?\n/).map(l => `<p>${esc(l) || '<br>'}</p>`).join('')); pgSaveSoon(); }
  });
  ed.addEventListener('drop', e => { const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); insertImageFiles(files); } });
  const bar = $('#edBar');
  bar.addEventListener('mousedown', e => { if (e.target.closest('button.tb')) e.preventDefault(); });
  bar.addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (b) edCmd(b.dataset.cmd); });
  bar.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'edBlock') { edFocus(); document.execCommand('formatBlock', false, '<' + t.value + '>'); pgSaveSoon(); }
    if (t.id === 'edHl' && t.value) { edFocus(); document.execCommand('styleWithCSS', false, true); document.execCommand('hiliteColor', false, t.value); document.execCommand('styleWithCSS', false, false); t.value = ''; pgSaveSoon(); }
    if (t.id === 'edFc' && t.value) { edFocus(); document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, t.value === 'inherit' ? getComputedStyle(ed).color : t.value); document.execCommand('styleWithCSS', false, false); t.value = ''; pgSaveSoon(); }
    if (t.id === 'edImg' && t.files.length) { insertImageFiles([...t.files]); t.value = ''; }
  });
}
document.addEventListener('selectionchange', () => {
  const ops = $('#edTblOps'); if (ops) ops.hidden = !selCell();
  const ed = $('#pgEditor'), sel = $('#edBlock'); if (!ed || !sel) return;
  const s = window.getSelection(); let n = s && s.anchorNode; if (!n || !ed.contains(n)) return;
  while (n && n !== ed && !/^(P|H1|H2|H3|BLOCKQUOTE|LI|DIV)$/.test(n.nodeName)) n = n.parentNode;
  const tag = n && n !== ed ? n.nodeName.toLowerCase() : 'p'; sel.value = ['h1', 'h2', 'h3', 'blockquote'].includes(tag) ? tag : 'p';
  ['bold', 'italic', 'underline', 'strikeThrough'].forEach(c => { const b = document.querySelector(`#edBar [data-cmd="${c}"]`); if (b) b.classList.toggle('on', document.queryCommandState(c)); });
});

/* ---- dibujar a mano ---- */
function openDraw() {
  const ed = $('#pgEditor'), s = window.getSelection(), range = s && s.rangeCount && ed.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null;
  openSheet('Dibujar', `<div class="dr-tools"><div class="ag-colors" id="drCol">${['#14171a', '#d9624f', '#2c6fb7', '#2e7d5b', '#d9a23b'].map((c, i) => `<button type="button" data-c="${c}" class="${i ? '' : 'on'}" style="background:${c}" aria-label="Color ${i + 1}"></button>`).join('')}</div><div class="seg" id="drW"><button type="button" data-w="2">Fino</button><button type="button" data-w="4" class="on">Medio</button><button type="button" data-w="9">Grueso</button><button type="button" data-w="e">Borrador</button></div><button type="button" class="btn sm" id="drUndo">Deshacer</button><button type="button" class="btn sm" id="drClr">Limpiar</button></div>
    <canvas id="drC" class="dr-c" width="900" height="560"></canvas><button class="btn pri">Insertar dibujo</button>`, () => {
    const c = $('#drC'), url = c.toDataURL('image/jpeg', 0.8);
    setTimeout(() => { const e2 = $('#pgEditor'); e2.focus(); if (range) { const s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(range); } const { id, n } = storeImage(url); document.execCommand('insertHTML', false, `<p><img data-img="${id}" data-n="${n}" src="${url}" class="drawing" alt="Dibujo"></p>`); pgSaveNow(); }, 40);
  }, f => {
    const c = $('#drC'), x = c.getContext('2d'); let col = '#14171a', w = 4, drawing = false, hist = [];
    const clear = () => { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }; clear();
    const pos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    c.addEventListener('pointerdown', e => { e.preventDefault(); c.setPointerCapture(e.pointerId); hist.push(x.getImageData(0, 0, c.width, c.height)); if (hist.length > 25) hist.shift(); drawing = true; const [px, py] = pos(e); x.beginPath(); x.moveTo(px, py); x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = w === 'e' ? '#fff' : col; x.lineWidth = (w === 'e' ? 22 : w) * (e.pressure && e.pointerType === 'pen' ? 0.5 + e.pressure : 1); x.lineTo(px + .1, py + .1); x.stroke(); });
    c.addEventListener('pointermove', e => { if (!drawing) return; const [px, py] = pos(e); x.lineTo(px, py); x.stroke(); });
    const end = () => { drawing = false; }; c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    f.querySelector('#drCol').onclick = e => { const b = e.target.closest('button'); if (!b) return; col = b.dataset.c; f.querySelectorAll('#drCol button').forEach(z => z.classList.toggle('on', z === b)); };
    f.querySelector('#drW').onclick = e => { const b = e.target.closest('button'); if (!b) return; w = b.dataset.w === 'e' ? 'e' : Number(b.dataset.w); f.querySelectorAll('#drW button').forEach(z => z.classList.toggle('on', z === b)); };
    $('#drUndo').onclick = () => { const h = hist.pop(); if (h) x.putImageData(h, 0, 0); };
    $('#drClr').onclick = () => { hist.push(x.getImageData(0, 0, c.width, c.height)); clear(); };
  });
}

/* ---- menús de cuaderno, sección y página ---- */
function nameSheet(title, value, color, onSave, onDel, extra = '') {
  openSheet(title, `<label class="field"><span>Nombre</span><input id="nmV" value="${esc(value)}" required autofocus></label>
    <div class="field"><span>Color</span><div class="ag-colors" id="nmC">${NB_COLORS.map(c => `<button type="button" data-c="${c}" class="${c === color ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div>${extra}
    <div class="btns" style="justify-content:space-between">${onDel ? '<button type="button" class="btn danger" id="nmDel">Eliminar</button>' : '<span></span>'}<button class="btn pri">Guardar</button></div>
    <div id="nmDelC" hidden class="alert bad"><span></span><div><b>¿Eliminar con todo su contenido?</b><p>Se borra también de tu hoja.</p></div><div class="acts"><button type="button" class="btn sm danger" id="nmDelY">Eliminar</button></div></div>`, f => {
    const v = $('#nmV').value.trim(); if (!v) return 'Escribe el nombre.';
    onSave(v, f.querySelector('#nmC .on')?.dataset.c || color, f); render();
  }, f => {
    f.querySelector('#nmC').onclick = e => { const b = e.target.closest('button'); if (!b) return; f.querySelectorAll('#nmC button').forEach(z => z.classList.toggle('on', z === b)); };
    $('#nmDel')?.addEventListener('click', () => { $('#nmDelC').hidden = false; });
    $('#nmDelY')?.addEventListener('click', () => { onDel(); closeSheet(); render(); });
  });
}
function delPage(id) {
  const p = pgGet(id); if (!p) return;
  (p.imgs || []).forEach(x => { blobDel('img', x.id, x.n); IDB.del(x.id); });
  blobDel('pgx', id); opq('rec.delete', { coll: 'pg', id });
  if (S.ui.pg === id) { S.ui.pg = ''; S.ui.blocPane = 'pages'; }
}
function delSection(id) { PGS(id).forEach(p => delPage(p.id)); opq('rec.delete', { coll: 'sec', id }); }
function pageMenu() {
  const p = pgGet(S.ui.pg); if (!p) return;
  pgSaveNow();
  const secs = NBS().flatMap(n => SECS(n.id).map(s => [s.id, `${n.name} › ${s.name}`]));
  openSheet('Opciones de la página', `
    <div class="field"><span>Fondo</span><div class="seg" id="pmBg">${[['blanco', 'Liso'], ['lineas', 'Líneas'], ['cuadros', 'Cuadrícula']].map(([k, l]) => `<button type="button" data-v="${k}" class="${(p.bg || 'lineas') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="field"><span>Tamaño de letra</span><div class="seg" id="pmFs">${[13, 15, 17, 19].map(s => `<button type="button" data-v="${s}" class="${(p.size || 15) === s ? 'on' : ''}">${s}</button>`).join('')}</div></div>
    <label class="field"><span>Mover a</span>${sel('pmSec', secs, p.sec)}</label>
    <label class="ag-pin"><input type="checkbox" id="pmPin" ${p.pinned ? 'checked' : ''}> Fijar en Inicio</label>
    <div class="btns"><button type="button" class="btn" id="pmClean">Limpiar formato pegado</button><button type="button" class="btn" id="pmDup">Duplicar página</button><button type="button" class="btn danger" id="pmDel">Eliminar página</button></div>
    <div id="pmDelC" hidden class="alert bad"><span></span><div><b>¿Eliminar esta página?</b><p>Se borra también de tu hoja, con sus imágenes.</p></div><div class="acts"><button type="button" class="btn sm danger" id="pmDelY">Eliminar</button></div></div>
    <button class="btn pri">Guardar</button>`, f => {
    const meta = Object.assign({}, store('pg')[p.id], { bg: f.querySelector('#pmBg .on').dataset.v, size: Number(f.querySelector('#pmFs .on').dataset.v), sec: $('#pmSec').value, pinned: $('#pmPin').checked, updated: Date.now() });
    recPut('pg', p.id, meta);
    if (meta.sec !== p.sec) { const s = store('sec')[meta.sec]; if (s) { S.ui.nb = s.nb; S.ui.sec = meta.sec; } }
    render();
  }, f => {
    ['#pmBg', '#pmFs'].forEach(s => f.querySelector(s).onclick = e => { const b = e.target.closest('button'); if (!b) return; f.querySelectorAll(s + ' button').forEach(z => z.classList.toggle('on', z === b)); });
    $('#pmDup').onclick = () => { const id = 'p' + uid(), now = Date.now(); const html = pgHtml(p.id); recPut('pg', id, Object.assign({}, store('pg')[p.id], { title: (p.title || 'Sin título') + ' (copia)', created: now, updated: now, pinned: false })); blobPut('pgx', id, html); S.ui.pg = id; closeSheet(); render(); toast('Página duplicada'); };
    $('#pmClean').onclick = () => { const html = cleanHTML(pgHtml(p.id)); blobPut('pgx', p.id, html); recPut('pg', p.id, Object.assign({}, store('pg')[p.id], { updated: Date.now(), snip: plain(html).slice(0, 120) })); closeSheet(); render(); toast('Formato limpio'); };
    $('#pmDel').onclick = () => { $('#pmDelC').hidden = false; };
    $('#pmDelY').onclick = () => { delPage(p.id); closeSheet(); render(); toast('Página eliminada'); };
  });
}

/* ---- exportar PDF ---- */
function exportDialog() {
  if (S.ui.pg) pgSaveNow();
  const hasPg = !!(S.ui.pg && pgGet(S.ui.pg));
  openSheet('Exportar PDF', `<div class="seg" id="exS">${hasPg ? '<button type="button" data-v="pg" class="on">Esta página</button>' : ''}<button type="button" data-v="sec" class="${hasPg ? '' : 'on'}">Sección</button><button type="button" data-v="nb">Cuaderno</button><button type="button" data-v="agenda">Agenda</button></div>
    <label class="ag-pin"><input type="checkbox" id="exImg" checked> Incluir imágenes</label>
    <label class="ag-pin"><input type="checkbox" id="exHead" checked> Fecha y encabezado</label>
    <label class="ag-pin"><input type="checkbox" id="exLines"> Fondo de líneas</label>
    <p class="note">Se abre la ventana de impresión: elige <b>Guardar como PDF</b> como destino. En el celular: Compartir o Imprimir → Guardar como PDF.</p>
    <button class="btn pri">Crear PDF</button>`, f => {
    const scope = f.querySelector('#exS .on').dataset.v;
    buildPrint(scope, { img: $('#exImg').checked, head: $('#exHead').checked, lines: $('#exLines').checked });
  }, f => { f.querySelector('#exS').onclick = e => { const b = e.target.closest('button'); if (!b) return; f.querySelectorAll('#exS button').forEach(z => z.classList.toggle('on', z === b)); }; });
}
async function buildPrint(scope, o) {
  let area = $('#printArea'); if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  const nb = NBS().find(n => n.id === S.ui.nb) || {};
  let docTitle = '', parts = [];
  if (scope === 'agenda') {
    docTitle = 'Agenda';
    const notes = S.data.notes.map(n => Object.assign({}, n, { kind: kindOf(n) }));
    const block = (t, L) => L.length ? `<h2>${t}</h2><ul>${L.map(n => `<li>${n.due ? `<b>${dLabel(n.due)}${n.time ? ' ' + esc(n.time) : ''}</b> · ` : ''}${isDone(n) ? '☑ ' : n.kind === 'pendiente' ? '☐ ' : ''}${esc(n.text)}${n.tag ? ` <i>#${esc(n.tag)}</i>` : ''}${n.action ? `<br><small>${esc(n.action)}</small>` : ''}</li>`).join('')}</ul>` : '';
    const by = (a, b) => (a.due || '9').localeCompare(b.due || '9') || (a.time || '').localeCompare(b.time || '');
    parts.push(`<section class="pp">${block('Actividades', notes.filter(n => n.kind === 'evento' && n.due >= today()).sort(by))}${block('Pendientes', notes.filter(n => n.kind === 'pendiente' && !isDone(n)).sort(by))}${block('Notas', notes.filter(n => n.kind === 'nota'))}</section>`);
  } else {
    const pages = scope === 'pg' ? [pgGet(S.ui.pg)] : scope === 'sec' ? PGS(S.ui.sec).reverse() : SECS(S.ui.nb).flatMap(s => PGS(s.id).reverse());
    docTitle = scope === 'pg' ? (pages[0].title || 'Página') : scope === 'sec' ? ((SECS(S.ui.nb).find(s => s.id === S.ui.sec) || {}).name || 'Sección') : (nb.name || 'Cuaderno');
    for (const p of pages) {
      const d = document.createElement('div'); d.innerHTML = pgHtml(p.id);
      for (const im of d.querySelectorAll('img[data-img]')) { if (o.img) im.src = await imgSrc(im.dataset.img); else im.remove(); }
      const sec = (store('sec')[p.sec] || {}).name || '';
      parts.push(`<section class="pp ${o.lines ? 'lines' : ''}" style="--fs:${p.size || 15}px">${o.head ? `<div class="pp-meta">${new Date(p.created || Date.now()).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${esc(nb.name || '')} › ${esc(sec)}</div>` : ''}<h1 class="pp-title">${esc(p.title || 'Sin título')}</h1><div class="pp-body">${d.innerHTML}</div></section>`);
    }
  }
  area.innerHTML = `${o.head ? `<div class="pp-doc">${esc(docTitle)} · Mis Finanzas · ${dLabel(today())}</div>` : ''}${parts.join('')}`;
  const prev = document.title; document.title = docTitle.replace(/[\\/:*?"<>|]/g, '') + ' ' + today();
  await Promise.all([...area.querySelectorAll('img')].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
  setTimeout(() => { try { window.print(); } catch (e) { toast('Tu navegador no permite imprimir aquí'); } setTimeout(() => { document.title = prev; }, 1500); }, 120);
}

/* ---- tarjeta de páginas fijadas en Inicio ---- */
function pinnedPagesCard() {
  const L = PGS().filter(p => p.pinned).slice(0, 4); if (!L.length) return '';
  return `<section class="card side-card"><header style="margin:0"><h2>Notas fijadas</h2><a href="#bloc">Bloc</a></header>${L.map(p => `<button type="button" class="bl-pg" data-act="blOpen" data-v="${p.id}" style="--c:${(store('sec')[p.sec] || {}).color || '#8c958f'}"><b>${esc(p.title || 'Sin título')}</b><small>${esc((p.snip || '').slice(0, 70))}</small></button>`).join('')}</section>`;
}

/* ---- panel rápido de agenda (barra superior) ---- */
function agPanelHTML() {
  const td = today(), ws = weekStart(td), it = agItemsOn(td), d = new Date(td + 'T12:00');
  const strip = Array.from({ length: 7 }, (_, i) => { const ds = addDays(ws, i); return `<button type="button" class="agp-d ${ds === td ? 'on' : ''}" data-act="agpDay" data-v="${ds}"><span>${WEEK[i][0]}</span><b>${new Date(ds + 'T12:00').getDate()}</b>${agDot(ds) ? '<i></i>' : ''}</button>`; }).join('');
  const any = it.ev.length || it.td.length || it.pays.length;
  return `<div class="agp-head"><b>Hoy · ${WDAY_FULL[d.getDay()]} ${d.getDate()}</b><a href="#agenda" data-act="agpClose">Abrir agenda ›</a></div>
    <div class="agp-strip">${strip}</div>
    ${any ? `<div class="ag-evs">${it.ev.map(agEventRow).join('')}</div><div class="ag-todos">${it.pays.filter(x => !x.s.marked).map(agPayRow).join('')}${it.td.map(n => agTodoRow(n, false)).join('')}</div>` : '<p class="note">Nada para hoy.</p>'}
    <form id="agpQuick" class="ag-quick"><input id="agpQ" type="text" autocomplete="off" placeholder="Anota algo: llamar a cliente mañana 3pm"><button class="btn sm pri" type="submit">+</button></form>`;
}
function agPanelCount() { const it = agItemsOn(today()); return it.ev.filter(n => !isDone(n)).length + it.td.filter(n => !isDone(n)).length + it.pays.filter(x => !x.s.marked).length; }
function renderAgBtn() {
  const b = $('#agBtn'); if (!b || !S.data) return;
  const n = agPanelCount(), badge = b.querySelector('.badge'); badge.hidden = !n; badge.textContent = n;
  const p = $('#agPanel'); if (p && !p.hidden && !p.contains(document.activeElement)) p.innerHTML = agPanelHTML();
}

/* ---- Notas ---- */
function vNotas() {
  const L = S.data.notes.slice().sort((a, b) => (a.status === 'Hecho') - (b.status === 'Hecho') || (b.date || '').localeCompare(a.date || ''));
  return `${head('Notas', 'Ideas de ahorro, compras que estás evaluando y acciones pendientes.', `<button class="btn pri" data-act="newNote">Nueva nota</button>`)}
  <div class="card"><div class="list">${L.map(n => `<div class="item click" data-act="editNote" data-id="${esc(n.id)}"><span class="ic ${n.status === 'Hecho' ? 'in' : ''}">${n.status === 'Hecho' ? '✓' : '•'}</span><div class="t"><b style="white-space:normal">${esc(n.text)}</b><small>${esc(n.tag || '')}${n.action ? ' · ' + esc(n.action) : ''}${n.due ? ' · para ' + dLabel(n.due) : ''}</small></div><span class="muted" style="font-size:.78rem">${dLabel(n.date)}</span></div>`).join('') || '<p class="muted">Sin notas todavía.</p>'}</div></div>`;
}

/* ---- Ajustes ---- */
function vAjustes() {
  const c = S.cfg;
  const designs = [['a', 'Pulso', 'Claro y directo: cuánto puedes gastar hoy y lo que pasó, día por día.', ['#14171a', '#c7f0db', '#f4f5f1']], ['b', 'Balance', 'Azul marino, como estados financieros. Pestañas arriba y cifras contables.', ['#0b2239', '#8fb8e0', '#edf0f3']], ['c', 'Rumbo', 'Oscuro, enfocado en tus metas. Azul cielo para el avance y dorado para actuar.', ['#0f141b', '#7cc4ff', '#161d27']]];
  return `${head('Ajustes')}
  <section class="card"><header><h2>Diseño</h2></header><div class="design-pick">${designs.map(([k, n, d, col]) => `<button type="button" data-act="design" data-v="${k}" class="${c.design === k ? 'on' : ''}"><span class="sw" style="background:${col[2]};border:1px solid var(--line)"><i style="background:${col[0]}"></i><i style="background:${col[1]};opacity:.9"></i></span><b>${n}</b><small class="muted">${d}</small></button>`).join('')}</div>
  <div style="margin-top:14px" class="seg">${[['auto', 'Según el sistema'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([k, n]) => `<button type="button" data-act="theme" data-v="${k}" class="${c.theme === k ? 'on' : ''}">${n}</button>`).join('')}</div>${c.design === 'c' ? '<p class="muted" style="font-size:.8rem;margin:8px 0 0">Rumbo siempre es oscuro.</p>' : ''}</section>
  <section class="card"><header><h2>Conectar mi hoja de Google</h2>${c.url ? '<span class="pill ok">Conectada</span>' : '<span class="pill">Sin conectar</span>'}</header>
    <form class="form" id="connForm"><label class="field"><span>URL de la app web de Apps Script</span><input id="cUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c.url)}" required></label>
    <label class="field"><span>Código de acceso (lo muestra la función configurar)</span><input id="cTok" type="password" value="${esc(c.token)}" required autocomplete="off"></label>
    <div class="err-msg" id="cErr">${esc(S.syncErr)}</div>
    <div class="btns"><button class="btn pri" type="submit">${c.url ? 'Guardar y sincronizar' : 'Conectar'}</button>${c.url ? '<button class="btn" type="button" data-act="syncNow">Sincronizar ahora</button><button class="btn danger" type="button" data-act="disconnect">Desconectar</button>' : ''}</div></form>
    ${c.url && c.serverV && c.serverV < 3 ? `<div class="alert" style="margin-top:12px"><span></span><div><b>Actualiza el conector de tu hoja (una sola vez)</b><p>Tu hoja tiene el conector v${c.serverV}. Con la versión 3 la agenda completa y tus ajustes se respaldan y se comparten entre tus equipos, y las mejoras futuras ya no necesitarán este paso.</p></div><div class="acts"><a class="btn sm" href="https://github.com/diego291/mis-finanzas/blob/main/apps-script/Code.gs" target="_blank" rel="noopener">Ver código</a></div></div>` : c.url && c.serverV >= 3 ? '<p class="muted" style="font-size:.82rem;margin:12px 0 0">Conector v3: tus ajustes se comparten entre tus equipos.</p>' : ''}
    <p class="muted" style="font-size:.82rem;margin:12px 0 0">La hoja es la fuente de verdad: lo que cambies directo en Sheets también aparece aquí. ${S.outbox.length ? `<b>${S.outbox.length} cambio(s) esperan para enviarse.</b>` : ''}</p></section>
  <section class="card"><header><h2>Personal y análisis</h2></header><form class="form" id="anaForm"><label class="field"><span>Tu nombre (para el saludo)</span><input id="aName" value="${esc(c.name)}" placeholder="Diego"></label><label class="field"><span>Meses de gastos para el fondo de emergencia</span><input id="aEm" type="number" min="1" max="12" value="${c.emergencyMonths}"></label>
    <div class="field"><span>Categorías que cuentan como necesidad (regla 50/30/20)</span><div class="chips" style="flex-wrap:wrap">${S.data.lists.expenseCats.map(k => `<label class="chip" style="border-style:solid;${c.needs.includes(k) ? 'color:var(--accent);border-color:var(--accent)' : ''}"><input type="checkbox" name="need" value="${esc(k)}" ${c.needs.includes(k) ? 'checked' : ''} style="margin-right:5px">${esc(k)}</label>`).join('')}</div></div><div><button class="btn" type="submit">Guardar</button></div></form></section>
  <section class="card"><header><h2>Sobre semanal de efectivo</h2>${c.envelope && c.envelope.on ? '<span class="pill ok">Activo</span>' : ''}</header><form class="form" id="envForm">
    <p class="muted" style="margin:0;font-size:.86rem">Cada semana registras el efectivo para gastos pequeños como un solo gasto. Ya no tienes que anotar cada pupusa ni cada pasaje.</p>
    <div class="two"><label class="field"><span>Monto por semana</span><input id="eAmt" class="calc" type="text" inputmode="decimal" autocomplete="off" value="${(c.envelope && c.envelope.amount) || ''}" placeholder="${(() => { const L = S.data.movs.filter(m => m.sub === ENV_SUB && m.type === 'Gasto' && m.date >= addM(ymOf(today()), -2) + '-01'); return L.length ? Math.round(sum(L, m => m.amount) / 9) : 0; })() || 25}"></label><label class="field"><span>Sale de</span>${sel('eAcc', S.data.accounts.map(a => a.name), (c.envelope && c.envelope.acc) || (S.data.accounts.find(a => a.type === 'Efectivo') || {}).name)}</label></div>
    <div class="btns"><button class="btn pri" type="submit">${c.envelope && c.envelope.on ? 'Guardar' : 'Activar sobre semanal'}</button>${c.envelope && c.envelope.on ? '<button class="btn" type="button" data-act="envOff">Desactivar</button>' : ''}</div></form></section>
  <section class="card"><header><h2>Categorías</h2></header><form class="form" id="catForm"><div class="two"><label class="field"><span>Nueva subcategoría</span><input id="nSub" required placeholder="Ej. Repuestos de computadora"></label><label class="field"><span>Tipo</span><select id="nType"><option>Gasto</option><option>Ingreso</option></select></label></div>
    <label class="field"><span>Categoría principal</span><input id="nCat" list="catList" required placeholder="Elige o escribe una nueva"><datalist id="catList">${[...S.data.lists.expenseCats, ...S.data.lists.incomeCats].map(x => `<option value="${esc(x)}">`).join('')}</datalist></label><div><button class="btn" type="submit">Agregar a la hoja</button></div></form></section>
  <section class="card"><header><h2>Respaldo</h2></header><p class="muted" style="margin:0 0 12px;font-size:.86rem">Tu hoja ya es el respaldo principal. Esto descarga una copia de lo que tiene la app en este equipo.</p>
    <div class="btns"><button class="btn" data-act="exportJson">Descargar copia (.json)</button><button class="btn" data-act="copyJson">Copiar copia</button>${c.url ? '' : '<label class="btn">Importar copia<input type="file" id="impFile" accept="application/json" hidden></label>'}</div></section>
  <section class="card"><header><h2>Aplicación</h2><span class="muted num">v${VERSION}</span></header>
    <div class="btns">${S.installEvt ? '<button class="btn pri" data-act="install">Instalar app</button>' : ''}<button class="btn" data-act="checkUpdate">Buscar actualización</button><button class="btn danger" data-act="resetLocal">Borrar datos de este equipo</button></div>
    <p class="muted" style="font-size:.82rem;margin:12px 0 0">En iPhone: abre en Safari, toca Compartir y luego “Agregar a inicio”. En Android: menú de Chrome → “Instalar app”.</p>
    <div id="resetConfirm" hidden style="margin-top:12px" class="alert bad"><span></span><div><b>¿Borrar los datos de este equipo?</b><p>No toca tu hoja. ${S.outbox.length ? `Perderás ${S.outbox.length} cambio(s) sin enviar.` : ''}</p></div><div class="acts"><button class="btn sm danger" data-act="resetYes">Borrar</button></div></div></section>`;
}

/* ---------------- Formularios (hoja inferior) ---------------- */
function openSheet(title, body, onSubmit, after) {
  $('#sheet').innerHTML = `<header><h2>${title}</h2><button type="button" class="x" data-act="close" aria-label="Cerrar">×</button></header><form class="form" id="sheetForm" novalidate>${body}<div class="err-msg" id="fErr"></div></form>`;
  $('#sheetBg').hidden = false;
  const f = $('#sheetForm');
  f.onsubmit = e => { e.preventDefault(); const err = onSubmit(f); if (err) { $('#fErr').textContent = err; return; } closeSheet(); };
  if (after) after(f);
  setTimeout(() => f.querySelector('[autofocus]')?.focus(), 60);
}
function closeSheet() { $('#sheetBg').hidden = true; $('#sheet').innerHTML = ''; }
const sel = (id, arr, v, blank) => `<select id="${id}">${blank != null ? `<option value="">${blank}</option>` : ''}${arr.map(x => { const [val, lab] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
function subOptions(type, v) {
  const groups = {}; S.data.cats.filter(c => c.type === type).forEach(c => (groups[c.cat] = groups[c.cat] || []).push(c.sub));
  return `<option value="">Elige…</option>` + Object.entries(groups).map(([g, subs]) => `<optgroup label="${esc(g)}">${subs.map(s => `<option ${s === v ? 'selected' : ''}>${esc(s)}</option>`).join('')}</optgroup>`).join('') + (v && !catMap()[v] ? `<option selected>${esc(v)}</option>` : '');
}
function frequent() {
  const cnt = {}; S.data.movs.slice(-80).forEach(m => { if (m.type !== 'Gasto' && m.type !== 'Ingreso') return; const k = [m.type, m.sub, m.acc, m.desc].join('|'); cnt[k] = (cnt[k] || 0) + 1; });
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k.split('|'));
}
/* ---- Registro: teclado completo ---- */
const GLYPH = {
  cart: '<path d="M4 5h2l2 10h10l2-7H7"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  fuel: '<path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M4 21h12M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3M7 8h6"/>',
  coffee: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', pill: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  school: '<path d="M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5"/>', glass: '<path d="M8 3l1 8a3 3 0 0 0 6 0l1-8M12 14v7M8 21h8"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>', wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>', bus: '<rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 11h16M7 21v-3M17 21v-3"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>', gift: '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8v13M3 12h18M12 8c-2-4-6-3-5 0M12 8c2-4 6-3 5 0"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12h18"/>', money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  card: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>', robot: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01"/>',
  shirt: '<path d="M8 3l-5 3 2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z"/>', dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
};
function glyphFor(sub, cat) {
  const t = (sub + ' ' + cat).toLowerCase();
  const rules = [[/combust|gasolin/, 'fuel'], [/super|mercado/, 'cart'], [/caf[eé]|snack|restaur|comida|almuerzo|delivery/, 'coffee'], [/energ|luz/, 'bolt'], [/internet/, 'wifi'], [/tel[eé]f|celular|recarga/, 'phone'],
    [/salud|medic|dent|consulta|[oó]ptica|laboratorio/, 'pill'], [/universi|educa|curso|libro|útil|matr[ií]cula/, 'school'], [/salida|evento|cine|entreten|hobb|videojuego/, 'glass'],
    [/vivienda|hogar|alquiler|limpieza/, 'home'], [/bus|uber|taxi|transporte|parqueo|peaje/, 'bus'], [/regalo|celebra/, 'gift'], [/gaby|apoyo|familia|donaci|iglesia/, 'heart'],
    [/ia\b|suscrip|software|app/, 'robot'], [/ropa|calzado|accesorio/, 'shirt'], [/salario|bono|aguinaldo|horas/, 'money'], [/freelance|servicio|negocio|trabajo|venta|insumo|herramienta/, 'work'], [/pr[eé]stamo|deuda|banc|tarjeta/, 'card']];
  const hit = rules.find(r => r[0].test(t));
  return hit ? hit[1] : 'dots';
}
const gsvg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[k] || GLYPH.dots}</svg>`;
function topSubs(type, n) {
  const cnt = {}; const since = addM(ymOf(today()), -3) + '-01';
  S.data.movs.forEach(m => { if (m.type === type && m.sub && m.date >= since) cnt[m.sub] = (cnt[m.sub] || 0) + 1; });
  const used = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(e => e[0]).filter(s => catMap()[s]);
  const rest = S.data.cats.filter(c => c.type === type && !used.includes(c.sub) && c.sub !== ADJ).map(c => c.sub);
  return used.concat(rest).slice(0, n);
}
function accOrder() {
  const cnt = {}; S.data.movs.slice(-120).forEach(m => { cnt[m.acc] = (cnt[m.acc] || 0) + 1; });
  return S.data.accounts.map(a => a.name).sort((a, b) => (cnt[b] || 0) - (cnt[a] || 0));
}
function parseQuick(t) {
  t = (t || '').toLowerCase();
  const out = {};
  const num = t.match(/\d+(?:[.,]\d{1,2})?/); if (num) out.amt = num[0].replace(',', '.');
  if (/\bayer\b/.test(t)) out.date = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
  if (/\+|me pagaron|cobr[eé]|ingreso|entr[oó]/.test(t)) out.type = 'Ingreso';
  const words = t.replace(/[\d.,+$]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const accHit = S.data.accounts.find(a => { const n = a.name.toLowerCase(); return words.some(w => n.includes(w)) || (/efectivo|cash/.test(t) && a.type === 'Efectivo') || (/banco|tarjeta|cuenta/.test(t) && n.includes('principal')); });
  if (accHit) out.acc = accHit.name;
  const acW = accHit ? accHit.name.toLowerCase() : '';
  const cand = words.filter(w => !acW.includes(w) && !['ayer', 'hoy', 'efectivo', 'banco', 'cuenta', 'pague', 'pagué', 'compre', 'compré', 'para', 'por', 'con', 'del', 'los', 'las'].includes(w));
  if (cand.length) {
    const recent = S.data.movs.slice().reverse().find(m => (m.type === 'Gasto' || m.type === 'Ingreso') && cand.some(w => (m.desc || '').toLowerCase().includes(w)));
    const glyphWord = { gasolina: 'Combustible', comida: 'Supermercado', super: 'Supermercado', luz: 'Energía eléctrica', recarga: 'Teléfono / celular', uber: 'Trabajo de Uber' };
    const bySub = S.data.cats.find(c => cand.some(w => c.sub.toLowerCase().includes(w) || (glyphWord[w] && c.sub === glyphWord[w])));
    if (recent) { out.sub = recent.sub; out.desc = recent.desc; if (!out.type) out.type = recent.type; if (!out.acc) out.acc = recent.acc; }
    else if (bySub) { out.sub = bySub.sub; if (!out.type) out.type = bySub.type; }
    if (!out.desc) out.desc = cand.join(' ').replace(/^./, c => c.toUpperCase());
  }
  return out;
}
function editMov(m, preset, opts = {}) {
  const isNew = !m, D = S.data;
  const st = Object.assign({ id: uid(), date: S.ui.ym === ymOf(today()) ? today() : S.ui.ym + '-01', type: 'Gasto', acc: accOrder()[0] || '', to: '', sub: '', desc: '', amt: '', goal: '', debt: '', scope: 'Personal', method: '', notes: '', more: false, allCats: false }, m ? Object.assign({}, m, { amt: String(m.amount || '') }) : {}, preset ? Object.assign({}, preset, preset.amount != null ? { amt: String(preset.amount) } : {}) : {});
  if (st.tag && !st.goal && !st.debt) { if (st.type === 'Gasto') st.debt = st.tag; else st.goal = st.tag; }
  const kind = () => st.type.includes('meta') ? 'Meta' : st.type === 'Transferencia' ? 'Mover' : st.type;
  const typeTabs = [['Gasto', 'Gasto'], ['Ingreso', 'Ingreso'], ['Transferencia', 'Mover'], ['Aporte a meta', 'Meta']];
  $('#sheet').innerHTML = `<header><h2>${isNew ? 'Registrar' : 'Editar movimiento'}</h2><button type="button" class="x" data-act="close" aria-label="Cerrar">×</button></header>
    <div class="reg">
      <label class="reg-text"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg><input id="rText" type="text" autocomplete="off" placeholder="Escríbelo: 10 gasolina efectivo"></label>
      <div id="regBody"></div>
    </div>`;
  $('#sheetBg').hidden = false;
  const body = $('#regBody');
  const budgetNote = () => {
    if (st.type !== 'Gasto' || !st.sub) return '';
    const cat = catOf(st.sub), b = (D.budgets.find(x => x.cat === cat) || {}).amount || 0;
    if (!b) return `<div class="reg-note">${esc(cat)} no tiene presupuesto.</div>`;
    const ym = ymOf(st.date || today()), spent = month(ym).byCat[cat] || 0;
    const prev = m && m.type === 'Gasto' && catOf(m.sub) === cat && ymOf(m.date) === ym ? m.amount : 0;
    const left = b - (spent - prev) - (calc(st.amt) || 0);
    return left >= 0 ? `<div class="reg-note ok">${esc(cat)}: te quedan <b>${money(left)}</b> este mes</div>` : `<div class="reg-note bad">${esc(cat)}: te pasas por <b>${money(-left)}</b> este mes</div>`;
  };
  const valid = () => {
    const n = calc(st.amt);
    if (st.amt && isExpr(st.amt) && !isFinite(n)) return 'Revisa la operación';
    if (!(n > 0)) return 'Escribe el monto';
    if ((st.type === 'Gasto' || st.type === 'Ingreso') && !st.sub) return 'Elige una categoría';
    if (!st.acc) return 'Elige la cuenta';
    if (st.type === 'Transferencia' && (!st.to || st.to === st.acc)) return 'Elige a qué cuenta va';
    if (st.type.includes('meta') && !st.goal) return 'Elige la meta';
    return '';
  };
  const chipRow = (list, cur, act) => `<div class="reg-chips">${list.map(n => `<button type="button" class="rchip ${n === cur ? 'on' : ''}" data-r="${act}" data-v="${esc(n)}">${esc(n)}</button>`).join('')}</div>`;
  const paint = () => {
    const n = r2(calc(st.amt) || 0), k = kind(), err = valid(), ex = isExpr(st.amt);
    const sign = st.type === 'Gasto' || st.type === 'Aporte a meta' ? '−' : st.type === 'Ingreso' || st.type === 'Retiro de meta' ? '+' : '';
    const tiles = (st.type === 'Gasto' || st.type === 'Ingreso') ? (() => {
      let subs = topSubs(st.type, 7); if (st.sub && !subs.includes(st.sub)) subs = [st.sub].concat(subs.slice(0, 6));
      return `<div class="reg-tiles">${subs.map(s => `<button type="button" class="rtile ${s === st.sub ? 'on' : ''}" data-r="sub" data-v="${esc(s)}" title="${esc(s)}">${gsvg(glyphFor(s, catOf(s)))}<span>${esc(s.replace(/\s*\(.*\)/, ''))}</span></button>`).join('')}<button type="button" class="rtile" data-r="allCats">${gsvg('dots')}<span>Más</span></button></div>
      ${st.allCats ? `<label class="field"><span>Todas las subcategorías</span><select id="rSub">${subOptions(st.type, st.sub)}</select></label>` : ''}`;
    })() : '';
    const freq = isNew && (st.type === 'Gasto' || st.type === 'Ingreso') ? frequent().filter(f => f[0] === st.type).slice(0, 5) : [];
    body.innerHTML = `
      <div class="seg reg-type">${typeTabs.map(([t, l]) => `<button type="button" data-r="type" data-v="${t}" class="${(l === k) ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${k === 'Meta' ? `<div class="seg reg-type sm">${[['Aporte a meta', 'Aportar'], ['Retiro de meta', 'Retirar']].map(([t, l]) => `<button type="button" data-r="type" data-v="${t}" class="${st.type === t ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
      <div class="reg-amt ${st.type === 'Gasto' ? 'out' : st.type === 'Ingreso' ? 'in' : ''} ${n ? '' : 'zero'}">${ex ? `<small class="reg-expr">${esc(st.amt.replace(/\*/g, '×').replace(/\//g, '÷'))}</small>` : ''}<span>${sign}$${ex ? (isFinite(calc(st.amt)) ? n.toFixed(2) : '…') : esc(st.amt || '0')}</span></div>
      ${budgetNote()}
      ${freq.length ? `<div class="reg-chips">${freq.map((f, i) => `<button type="button" class="rchip dash" data-r="freq" data-v="${i}">${esc(f[3] || f[1])}</button>`).join('')}</div>` : ''}
      ${tiles}
      ${st.type === 'Transferencia' || st.type.includes('meta') ? `<div class="reg-lab">${st.type === 'Retiro de meta' ? 'Entra a' : 'Sale de'}</div>` : ''}
      ${chipRow(accOrder(), st.acc, 'acc')}
      ${st.type === 'Transferencia' ? `<div class="reg-lab">Va a</div>${chipRow(accOrder().filter(a => a !== st.acc), st.to, 'to')}` : ''}
      ${st.type.includes('meta') ? `<div class="reg-lab">Meta</div>${chipRow(D.goals.map(g => g.name), st.goal, 'goal')}` : ''}
      <div class="reg-chips">${[['Hoy', today()], ['Ayer', (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })()]].map(([l, v]) => `<button type="button" class="rchip ${st.date === v ? 'on' : ''}" data-r="date" data-v="${v}">${l}</button>`).join('')}<label class="rchip date ${st.date !== today() ? 'on' : ''}"><input type="date" id="rDate" value="${st.date}" aria-label="Fecha"></label></div>
      <button type="button" class="reg-more" data-r="more">${st.more ? 'Menos detalles' : 'Descripción, notas y más'}</button>
      ${st.more ? `<div class="form">
        <label class="field"><span>Descripción</span><input id="rDesc" value="${esc(st.desc)}" placeholder="Gasolina para la semana"></label>
        <div class="two"><label class="field"><span>Ámbito</span>${sel('rScope', D.lists.scopes, st.scope || 'Personal')}</label><label class="field"><span>Método de pago</span>${sel('rMethod', D.lists.methods, st.method, '—')}</label></div>
        ${st.type === 'Gasto' && D.debts.length ? `<label class="field"><span>¿Es pago de una deuda?</span>${sel('rDebt', D.debts.map(d => d.name), st.debt, 'No')}</label>` : ''}
        <label class="field"><span>Notas</span><textarea id="rNotes" rows="2">${esc(st.notes)}</textarea></label></div>` : ''}
      <div class="reg-keys">${['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '.', '0', 'del', '+'].map(x => { const lab = { del: '⌫', '/': '÷', '*': '×', '-': '−', '+': '+' }[x] || x; return `<button type="button" class="${'+-*/'.includes(x) ? 'op' : ''}" data-r="key" data-v="${x}" aria-label="${{ del: 'Borrar', '/': 'Dividir', '*': 'Multiplicar', '-': 'Restar', '+': 'Sumar', '.': 'Punto decimal' }[x] || x}">${lab}</button>`; }).join('')}</div>
      ${ex && isFinite(calc(st.amt)) ? `<button type="button" class="rchip" data-r="key" data-v="=" style="justify-self:center">= ${money(n)} · usar resultado</button>` : ''}
      <button type="button" class="reg-save ${err ? 'off' : ''}" data-r="save">${err || (isNew ? 'Guardar ' : 'Guardar cambios · ') + sign + money(n).replace('−', '')}</button>
      ${isNew ? '' : `<div class="btns" style="justify-content:center"><button type="button" class="btn sm" data-r="dup">Duplicar</button><button type="button" class="btn sm danger" data-r="del">Eliminar</button></div><div id="delConfirm" hidden class="alert bad"><span></span><div><b>¿Eliminar este movimiento?</b><p>Se borra también de tu hoja.</p></div><div class="acts"><button type="button" class="btn sm danger" data-r="delYes">Eliminar</button></div></div>`}`;
  };
  const readMore = () => { if (!st.more) return; st.desc = $('#rDesc')?.value.trim() ?? st.desc; st.scope = $('#rScope')?.value || st.scope; st.method = $('#rMethod')?.value ?? st.method; st.debt = $('#rDebt')?.value ?? st.debt; st.notes = $('#rNotes')?.value.trim() ?? st.notes; };
  const save = () => {
    readMore(); if (valid()) return;
    const t = st.type;
    const rec = { id: st.id, date: st.date || today(), type: t, acc: st.acc, to: t === 'Transferencia' ? st.to : '', sub: t === 'Gasto' || t === 'Ingreso' ? st.sub : '', desc: st.desc || (t === 'Gasto' || t === 'Ingreso' ? st.sub : t === 'Transferencia' ? 'A ' + st.to : st.goal), amount: r2(calc(st.amt)), goal: t.includes('meta') ? st.goal : '', debt: t === 'Gasto' ? st.debt : '', scope: st.scope || 'Personal', method: st.method, notes: st.notes };
    op('mov.upsert', rec);
    if (opts.after) opts.after(rec);
    if (!isNew) { closeSheet(); toast('Cambios guardados'); return; }
    const sp = spendToday(ymOf(today()));
    body.innerHTML = `<div class="reg-done"><span class="ok-dot">${gsvg('dots').replace(GLYPH.dots, '<path d="M5 12l5 5 9-10"/>')}</span><h2>Guardado</h2><p>${esc(rec.desc)} · ${money(rec.amount)} · ${esc(rec.acc)}</p>${sp.mode !== 'closed' ? `<p class="reg-left">Hoy puedes gastar <b>${money(sp.perDay)}</b></p>` : ''}<div class="btns"><button type="button" class="btn pri" data-r="again">Registrar otro</button><button type="button" class="btn" data-act="close">Listo</button></div></div>`;
    $('#rText').value = '';
  };
  body.onclick = e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    const r = b.dataset.r, v = b.dataset.v;
    if (r !== 'key') readMore();
    if (r === 'type') { st.type = v; if (v !== 'Gasto' && v !== 'Ingreso') st.sub = ''; else if (st.sub && catMap()[st.sub]?.type !== v) st.sub = ''; st.allCats = false; }
    else if (r === 'sub') st.sub = v;
    else if (r === 'allCats') st.allCats = !st.allCats;
    else if (r === 'acc') { st.acc = v; if (st.to === v) st.to = ''; }
    else if (r === 'to') st.to = v;
    else if (r === 'goal') st.goal = v;
    else if (r === 'date') st.date = v;
    else if (r === 'more') st.more = !st.more;
    else if (r === 'freq') { const f = frequent().filter(x => x[0] === st.type)[v]; if (f) { st.type = f[0]; st.sub = f[1]; st.acc = f[2]; st.desc = f[3]; const last = S.data.movs.slice().reverse().find(x => x.sub === f[1] && x.desc === f[3]); if (last && !st.amt) st.amt = String(last.amount); } }
    else if (r === 'key') {
      let a = st.amt || ''; const seg = a.split(/[+\-*/]/).pop();
      if (v === 'del') a = a.slice(0, -1);
      else if (v === '=') { const z = calc(a); if (isFinite(z)) a = String(r2(z)); }
      else if ('+-*/'.includes(v)) { if (a && '+-*/'.includes(a.slice(-1))) a = a.slice(0, -1) + v; else if (a) a += v; }
      else if (v === '.') { if (!seg.includes('.')) a += seg ? '.' : '0.'; }
      else if (!(seg.includes('.') && seg.split('.')[1].length >= 2) && a.length < 28) a = a === '0' ? v : a + v;
      st.amt = a;
    }
    else if (r === 'save') return save();
    else if (r === 'again') { Object.assign(st, { id: uid(), amt: '', sub: '', desc: '', notes: '', to: '', goal: '', debt: '', date: today() }); }
    else if (r === 'dup') { closeSheet(); return editMov(null, Object.assign({}, m, { id: uid(), date: today() })); }
    else if (r === 'del') { $('#delConfirm').hidden = false; return; }
    else if (r === 'delYes') { op('mov.delete', { id: st.id }); closeSheet(); toast('Movimiento eliminado'); return; }
    paint();
  };
  body.onchange = e => {
    if (e.target.id === 'rSub') { st.sub = e.target.value; st.allCats = false; readMore(); paint(); }
    if (e.target.id === 'rDate' && e.target.value) { st.date = e.target.value; readMore(); paint(); }
  };
  $('#rText').oninput = e => {
    const p = parseQuick(e.target.value);
    if (p.type) st.type = p.type; else if (st.type !== 'Gasto' && st.type !== 'Ingreso') st.type = 'Gasto';
    if (p.amt) st.amt = p.amt; if (p.sub) st.sub = p.sub; if (p.acc) st.acc = p.acc; if (p.date) st.date = p.date; if (p.desc) st.desc = p.desc;
    paint();
  };
  $('#rText').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  const keyH = e => {
    if ($('#sheetBg').hidden || !document.body.contains(body)) { document.removeEventListener('keydown', keyH); return; }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const kmap = { x: '*', X: '*', ',': '.' }; const kk = kmap[e.key] || e.key;
    if (/^[0-9.+\-*/]$/.test(kk)) { body.querySelector(`[data-r="key"][data-v="${kk}"]`)?.click(); e.preventDefault(); }
    else if (kk === '=') { body.querySelector('[data-r="key"][data-v="="]')?.click(); e.preventDefault(); }
    else if (e.key === 'Backspace') { body.querySelector('[data-r="key"][data-v="del"]')?.click(); e.preventDefault(); }
    else if (e.key === 'Enter') { save(); e.preventDefault(); }
  };
  document.addEventListener('keydown', keyH);
  paint();
}
function editAcc(a) {
  const isNew = !a; a = a || { name: '', type: 'Banco', initial: 0 };
  openSheet(isNew ? 'Nueva cuenta' : 'Editar cuenta', `<label class="field"><span>Nombre</span><input id="aName" value="${esc(a.name)}" required autofocus></label><div class="two"><label class="field"><span>Tipo</span>${sel('aType', S.data.lists.accTypes, a.type)}</label><label class="field"><span>Saldo inicial</span><input id="aIni" class="calc" type="text" inputmode="decimal" autocomplete="off" value="${a.initial}"></label></div>
  ${isNew ? '' : '<p class="muted" style="margin:0;font-size:.82rem">Si cambias el nombre, también se actualiza en todos tus movimientos de la hoja.</p>'}
  <div class="btns" style="justify-content:space-between">${isNew ? '<span></span>' : '<button type="button" class="btn danger" id="aDel">Eliminar</button>'}<button class="btn pri">Guardar</button></div>`, () => {
    const name = $('#aName').value.trim(); if (!name) return 'Escribe el nombre.';
    if (name !== a.name && S.data.accounts.some(x => x.name === name)) return 'Ya existe una cuenta con ese nombre.';
    op('acc.upsert', { oldName: isNew ? '' : a.name, name, type: $('#aType').value, initial: calcVal('#aIni') });
  }, () => $('#aDel')?.addEventListener('click', () => { if (S.data.movs.some(m => m.acc === a.name || m.to === a.name)) { $('#fErr').textContent = 'Esta cuenta tiene movimientos. Cámbialos de cuenta antes de eliminarla.'; return; } op('acc.delete', { name: a.name }); closeSheet(); }));
}
function editGoal(g) {
  const isNew = !g; g = g || { name: '', purpose: '', target: '', initial: 0, due: '', acc: '' };
  openSheet(isNew ? 'Nueva meta' : 'Editar meta', `<label class="field"><span>Nombre</span><input id="gName" value="${esc(g.name)}" required autofocus></label><label class="field"><span>Para qué es</span><input id="gPur" value="${esc(g.purpose)}"></label>
  <div class="two"><label class="field"><span>Monto objetivo</span><input id="gTar" class="calc" type="text" inputmode="decimal" autocomplete="off" value="${g.target || ''}"></label><label class="field"><span>Fecha objetivo</span><input id="gDue" type="date" value="${g.due || ''}"></label></div>
  <div class="two"><label class="field"><span>Saldo inicial</span><input id="gIni" class="calc" type="text" inputmode="decimal" autocomplete="off" value="${g.initial || 0}"></label><label class="field"><span>Se guarda en la cuenta</span>${sel('gAcc', S.data.accounts.map(a => a.name), g.acc, 'No vincular')}</label></div>
  <p class="muted" style="margin:0;font-size:.82rem">Si la vinculas a una cuenta (por ejemplo “Fondo compartido”), el avance es el saldo de esa cuenta y no hace falta registrar aportes.</p>
  <div class="btns" style="justify-content:space-between">${isNew ? '<span></span>' : '<button type="button" class="btn danger" id="gDel">Eliminar</button>'}<button class="btn pri">Guardar</button></div>`, () => {
    const name = $('#gName').value.trim(); if (!name) return 'Escribe el nombre.';
    op('goal.upsert', { oldName: isNew ? '' : g.name, name, purpose: $('#gPur').value.trim(), target: calcVal('#gTar'), initial: calcVal('#gIni'), due: $('#gDue').value, acc: $('#gAcc').value });
  }, () => $('#gDel')?.addEventListener('click', () => { op('goal.delete', { name: g.name }); closeSheet(); }));
}
function editDebt(d) {
  const isNew = !d; d = d || { name: '', creditor: '', original: '', rate: '', payment: '', day: '' };
  openSheet(isNew ? 'Nueva deuda' : 'Editar deuda', `<div class="two"><label class="field"><span>Nombre</span><input id="dName" value="${esc(d.name)}" required autofocus></label><label class="field"><span>Acreedor</span><input id="dCred" value="${esc(d.creditor)}"></label></div>
  <div class="two"><label class="field"><span>Monto original</span><input id="dOri" class="calc" type="text" inputmode="decimal" autocomplete="off" value="${d.original}"></label><label class="field"><span>Tasa anual (%)</span><input id="dRate" type="number" step="0.01" value="${d.rate}"></label></div>
  <div class="two"><label class="field"><span>Cuota mensual</span><input id="dPay" class="calc" type="text" inputmode="decimal" autocomplete="off" value="${d.payment}"></label><label class="field"><span>Día de pago</span><input id="dDay" type="number" min="1" max="31" value="${d.day}"></label></div>
  <div class="btns" style="justify-content:space-between">${isNew ? '<span></span>' : '<button type="button" class="btn danger" id="dDel">Eliminar</button>'}<button class="btn pri">Guardar</button></div>`, () => {
    const name = $('#dName').value.trim(); if (!name) return 'Escribe el nombre.';
    op('debt.upsert', { oldName: isNew ? '' : d.name, name, creditor: $('#dCred').value.trim(), original: calcVal('#dOri'), rate: Number($('#dRate').value) || 0, payment: calcVal('#dPay'), day: Number($('#dDay').value) || '' });
  }, () => $('#dDel')?.addEventListener('click', () => { op('debt.delete', { name: d.name }); closeSheet(); }));
}
function editFixed(f) {
  const isNew = !f; f = f || { name: '', sub: '', amount: '', day: 1, acc: S.data.accounts[0]?.name, freq: 'Mensual' };
  openSheet(isNew ? 'Nuevo pago fijo' : 'Editar pago fijo', `<label class="field"><span>Concepto</span><input id="xName" value="${esc(f.name)}" required autofocus></label>
  <div class="two"><label class="field"><span>Monto</span><input id="xAmt" class="calc" type="text" inputmode="decimal" autocomplete="off" value="${f.amount}"></label><label class="field"><span>Día de pago</span><input id="xDay" type="number" min="1" max="31" value="${f.day}"></label></div>
  <div class="two"><label class="field"><span>Subcategoría</span><select id="xSub">${subOptions('Gasto', f.sub)}</select></label><label class="field"><span>Cuenta</span>${sel('xAcc', S.data.accounts.map(a => a.name), f.acc)}</label></div>
  <label class="field"><span>Frecuencia</span>${sel('xFreq', ['Mensual', 'Quincenal', 'Trimestral', 'Anual'], f.freq)}</label>
  <div class="btns" style="justify-content:space-between">${isNew ? '<span></span>' : '<button type="button" class="btn danger" id="xDel">Eliminar</button>'}<button class="btn pri">Guardar</button></div>`, () => {
    const name = $('#xName').value.trim(); if (!name) return 'Escribe el concepto.'; if (!$('#xSub').value) return 'Elige la subcategoría.';
    op('fixed.upsert', { oldName: isNew ? '' : f.name, name, amount: calcVal('#xAmt'), day: Number($('#xDay').value) || 1, sub: $('#xSub').value, acc: $('#xAcc').value, freq: $('#xFreq').value });
  }, () => $('#xDel')?.addEventListener('click', () => { op('fixed.delete', { name: f.name }); closeSheet(); }));
}
function editNote(n) {
  const isNew = !n; n = n || { id: uid(), date: today(), tag: '', text: '', action: '', due: '', status: 'Pendiente' };
  openSheet(isNew ? 'Nueva nota' : 'Editar nota', `<label class="field"><span>Apunte</span><textarea id="nText" rows="3" required autofocus>${esc(n.text)}</textarea></label>
  <div class="two"><label class="field"><span>Etiqueta</span><input id="nTag" value="${esc(n.tag)}" placeholder="Ej. Reflexión del mes"></label><label class="field"><span>Estado</span>${sel('nSt', ['Pendiente', 'En curso', 'Hecho'], n.status)}</label></div>
  <div class="two"><label class="field"><span>Acción pendiente</span><input id="nAct" value="${esc(n.action)}"></label><label class="field"><span>Fecha límite</span><input id="nDue" type="date" value="${n.due || ''}"></label></div>
  <div class="btns" style="justify-content:space-between">${isNew ? '<span></span>' : '<button type="button" class="btn danger" id="nDel">Eliminar</button>'}<button class="btn pri">Guardar</button></div>`, () => {
    if (!$('#nText').value.trim()) return 'Escribe el apunte.';
    op('note.upsert', { id: n.id, date: n.date || today(), tag: $('#nTag').value.trim(), text: $('#nText').value.trim(), action: $('#nAct').value.trim(), due: $('#nDue').value, status: $('#nSt').value });
  }, () => $('#nDel')?.addEventListener('click', () => { op('note.delete', { id: n.id }); closeSheet(); }));
}
function cashCounter() {
  const bills = [1, 5, 10, 20, 50, 100], coins = [0.01, 0.05, 0.10, 0.25, 1];
  const cashAccs = S.data.accounts.filter(a => a.type === 'Efectivo').map(a => a.name);
  const bal = balances();
  openSheet('Contar efectivo', `<p class="muted" style="margin:0;font-size:.85rem">Cuenta lo que tienes en la mano y compáralo con lo que dice la app.</p>
  <div class="label">Billetes</div><div class="cash">${bills.map(b => `<label>$${b}<input class="calc" type="text" inputmode="decimal" autocomplete="off" data-v="${b}"></label>`).join('')}</div>
  <div class="label">Monedas</div><div class="cash">${coins.map(b => `<label>${b < 1 ? Math.round(b * 100) + '¢' : '$1'}<input class="calc" type="text" inputmode="decimal" autocomplete="off" data-v="${b}"></label>`).join('')}</div>
  <label class="field"><span>Comparar con la cuenta</span>${sel('cAcc', cashAccs.length ? cashAccs : S.data.accounts.map(a => a.name), cashAccs[0])}</label>
  <div class="kpis"><div class="kpi"><span class="label">Contado</span><span class="v" id="cTot">$0.00</span></div><div class="kpi"><span class="label">Según la app</span><span class="v" id="cApp"></span></div><div class="kpi"><span class="label">Diferencia</span><span class="v" id="cDif"></span></div></div>
  <div class="field" id="cWhy"><span>Si falta dinero, ¿qué pasó?</span><div class="seg"><button type="button" data-w="unk" class="on">No recuerdo en qué lo gasté</button><button type="button" data-w="adj">Error de registro</button></div></div>
  <p class="muted" style="margin:0;font-size:.8rem">"No recuerdo" se guarda como <b>${UNK}</b> y cuenta como gasto real. "Error de registro" va a <b>${ADJ}</b>.</p>
  <div class="btns" style="justify-content:end"><button class="btn pri" id="cAdj">Guardar cuadre</button></div>`, () => {
    const tot = r2([...document.querySelectorAll('.cash input')].reduce((s, i) => s + (calc(i.value) || 0) * Number(i.dataset.v), 0));
    const acc = $('#cAcc').value, dif = r2(tot - (bal[acc] || 0));
    if (!tot && !Number(bal[acc])) return 'Escribe cuántos billetes y monedas tienes.';
    S.cfg.lastCount = Date.now(); save();
    if (!dif) { toast('Cuadrado: tu efectivo coincide'); render(); return; }
    const why = document.querySelector('#cWhy .on')?.dataset.w || 'unk';
    const sub = dif < 0 && why === 'unk' ? UNK : ADJ;
    if (sub === UNK) ensureUnk(); else ensureAdj();
    op('mov.upsert', { id: uid(), date: today(), type: dif < 0 ? 'Gasto' : 'Ingreso', acc, sub, desc: sub === UNK ? 'Gasto no registrado (cuadre)' : 'Ajuste por conteo de efectivo', amount: Math.abs(dif), scope: 'Personal', method: 'Efectivo', notes: `Contado ${money(tot)}, la app tenía ${money(bal[acc] || 0)}`, to: '', goal: '', debt: '' });
    toast(sub === UNK ? 'Cuadre guardado como gasto sin identificar' : 'Ajuste registrado');
  }, f => {
    const upd = () => { const tot = [...f.querySelectorAll('.cash input')].reduce((s, i) => s + (calc(i.value) || 0) * Number(i.dataset.v), 0); const app = bal[$('#cAcc').value] || 0; $('#cTot').textContent = money(tot); $('#cApp').textContent = money(app); const d = tot - app; $('#cDif').textContent = money(d, true); $('#cDif').className = 'v ' + (Math.abs(d) < .005 ? 'pos' : 'neg'); };
    f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
    f.querySelector('#cWhy').onclick = e => { const b = e.target.closest('button'); if (!b) return; f.querySelectorAll('#cWhy button').forEach(x => x.classList.toggle('on', x === b)); };
  });
}
function payFixed(f) {
  const ym = S.ui.ym, date = ym === ymOf(today()) ? today() : `${ym}-${pad(Math.min(f.day, daysIn(ym)))}`;
  editMov(null, { type: 'Gasto', sub: f.sub, acc: f.acc || S.data.accounts[0]?.name, desc: f.name, amount: f.amount, date }, { after: () => op('fixed.mark', { name: f.name, month: Number(ym.slice(5)), paid: true }) });
}

/* ---------------- Eventos ---------------- */
const byN = (arr, n) => arr.find(x => x.name === n);
const ACT = {
  close: closeSheet, newMov: () => editMov(), editMov: el => editMov(S.data.movs.find(m => m.id === el.dataset.id)),
  newTransfer: () => editMov(null, { type: 'Transferencia' }), newAcc: () => editAcc(), editAcc: el => editAcc(byN(S.data.accounts, el.dataset.n)),
  newGoal: () => editGoal(), editGoal: el => editGoal(byN(S.data.goals, el.dataset.n)),
  goalIn: el => { const g = byN(S.data.goals, el.dataset.n); g.acc ? editMov(null, { type: 'Transferencia', to: g.acc, desc: 'Ahorro ' + g.name }) : editMov(null, { type: 'Aporte a meta', goal: g.name, desc: 'Aporte ' + g.name }); },
  goalOut: el => { const g = byN(S.data.goals, el.dataset.n); g.acc ? editMov(null, { type: 'Transferencia', acc: g.acc, desc: 'Retiro ' + g.name }) : editMov(null, { type: 'Retiro de meta', goal: g.name, desc: 'Retiro ' + g.name }); },
  newDebt: () => editDebt(), editDebt: el => editDebt(byN(S.data.debts, el.dataset.n)),
  debtPay: el => { const d = byN(S.data.debts, el.dataset.n); if (!catMap()['Cuota de préstamo']) op('cat.add', { sub: 'Cuota de préstamo', cat: 'Finanzas y deudas', type: 'Gasto' }); editMov(null, { type: 'Gasto', sub: 'Cuota de préstamo', debt: d.name, amount: d.payment, desc: 'Cuota ' + d.name }); },
  newFixed: () => editFixed(), editFixed: el => editFixed(byN(S.data.fixed, el.dataset.n)),
  fixPay: el => payFixed(byN(S.data.fixed, el.dataset.n)),
  fixMark: el => { op('fixed.mark', { name: el.dataset.n, month: Number(S.ui.ym.slice(5)), paid: true }); toast('Marcado como pagado'); },
  fixToggle: el => { const f = byN(S.data.fixed, el.dataset.n), m = Number(el.dataset.m); op('fixed.mark', { name: f.name, month: m, paid: !(f.paid || [])[m - 1] }); },
  newNote: () => editNote(), editNote: el => editNote(S.data.notes.find(n => n.id === el.dataset.id)),
  budget: el => { const c = el.dataset.c, b = (S.data.budgets.find(x => x.cat === c) || {}).amount || ''; openSheet('Presupuesto de ' + esc(c), `<label class="field"><span>Monto mensual</span><input id="bAmt" class="calc" type="text" inputmode="decimal" autocomplete="off" value="${b}" autofocus></label><button class="btn pri">Guardar</button>`, () => op('budget.set', { cat: c, amount: calcVal('#bAmt') })); },
  mTab: el => { S.ui.mTab = el.dataset.v; render(); },
  calDay: el => { S.ui.calDay = el.dataset.v; render(); },
  goMonth: el => { S.ui.ym = el.dataset.v; S.ui.mTab = 'dia'; S.ui.fPeriod = 'mes'; render(); },
  accGo: el => { S.ui.fAcc = el.dataset.n; S.ui.mTab = 'dia'; go('movimientos'); },
  clearAcc: () => { S.ui.fAcc = ''; render(); },
  envOff: () => { S.cfg.envelope = Object.assign({}, S.cfg.envelope, { on: false }); pushSettings(); render(); },
  envelope: () => { const env = envelopeState(); if (!env) return go('ajustes'); if (!catMap()[ENV_SUB]) op('cat.add', { sub: ENV_SUB, cat: 'Otros gastos', type: 'Gasto' }); const [y, m, d] = env.ws.split('-').map(Number); op('mov.upsert', { id: uid(), date: today(), type: 'Gasto', acc: env.acc, sub: ENV_SUB, desc: `Sobre semana del ${d} ${MSHORT[m - 1].toLowerCase()}`, amount: env.amount, scope: 'Personal', method: 'Efectivo', notes: '', to: '', goal: '', debt: '' }); toast('Sobre de la semana registrado'); },
  agTab: el => { S.ui.agTab = el.dataset.v; render(); },
  agDay: el => { S.ui.agDay = el.dataset.v; render(); },
  agNew: el => editAgenda(null, el.dataset.v, el.dataset.d),
  agEdit: el => editAgenda(S.data.notes.find(n => n.id === el.dataset.id)),
  agToggle: el => { const n = S.data.notes.find(x => x.id === el.dataset.id); if (!n) return; const m = (S.noteMeta || {})[n.id] || {}; noteSave(Object.assign({}, n, { kind: kindOf(n), time: n.time || m.time || '', color: n.color || m.color || '', pinned: n.pinned || !!m.pinned, status: isDone(n) ? 'Pendiente' : 'Hecho' })); if (!isDone(n)) toast('Hecho'); },
  agTagF: el => { S.ui.agTag = el.dataset.v; render(); },
  agBackup: () => agBackup(),
  blDelPg: el => askDelPage(el.dataset.v),
  blNb: el => { leavePage(); S.ui.pg = ''; S.ui.nb = el.dataset.v; S.ui.sec = ''; S.ui.blocQ = ''; render(); },
  blSec: el => { leavePage(); S.ui.sec = el.dataset.v; S.ui.blocQ = ''; S.ui.pg = ''; S.ui.blocPane = 'pages'; render(); },
  blPg: el => { leavePage(el.dataset.v); const p = pgGet(el.dataset.v); if (p) { const s = store('sec')[p.sec]; if (s) { S.ui.nb = s.nb; S.ui.sec = p.sec; } } S.ui.pg = el.dataset.v; S.ui.blocPane = 'editor'; render(); },
  blOpen: el => { const p = pgGet(el.dataset.v); if (p) { const s = store('sec')[p.sec]; if (s) { S.ui.nb = s.nb; S.ui.sec = p.sec; } S.ui.pg = p.id; S.ui.blocPane = 'editor'; } go('bloc'); },
  blPane: el => { S.ui.blocPane = el.dataset.v; if (el.dataset.v !== 'editor') { leavePage(); if (S.ui.pg && !pgGet(S.ui.pg)) S.ui.pg = ''; } render(); },
  blNewNb: () => nameSheet('Nuevo cuaderno', '', NB_COLORS[NBS().length % NB_COLORS.length], (v, c) => { const id = 'n' + uid(), s = 's' + uid(); recPut('nb', id, { name: v, color: c, order: NBS().length + 1 }); recPut('sec', s, { nb: id, name: 'General', color: c, order: 1 }); S.ui.nb = id; S.ui.sec = s; S.ui.pg = ''; }),
  blNewSec: () => { const nb = NBS().find(n => n.id === curNb()); nameSheet('Nueva sección', '', NB_COLORS[SECS(nb.id).length % NB_COLORS.length], (v, c) => { const id = 's' + uid(); recPut('sec', id, { nb: nb.id, name: v, color: c, order: SECS(nb.id).length + 1 }); S.ui.sec = id; S.ui.pg = ''; S.ui.blocPane = 'pages'; }); },
  blNbMenu: el => { const n = NBS().find(x => x.id === el.dataset.v); nameSheet('Cuaderno', n.name, n.color, (v, c) => recPut('nb', n.id, Object.assign({}, store('nb')[n.id], { name: v, color: c })), NBS().length > 1 ? () => { SECS(n.id).forEach(s => delSection(s.id)); opq('rec.delete', { coll: 'nb', id: n.id }); S.ui.nb = ''; } : null); },
  blSecMenu: el => { const s = Object.assign({ id: el.dataset.v }, store('sec')[el.dataset.v]); nameSheet('Sección', s.name, s.color, (v, c) => recPut('sec', s.id, Object.assign({}, store('sec')[s.id], { name: v, color: c })), SECS(s.nb).length > 1 ? () => { delSection(s.id); S.ui.sec = ''; } : null); },
  blNewPg: el => newPage(el.dataset.v),
  blPageMenu: () => pageMenu(),
  blExport: () => exportDialog(),
  agpDay: el => { S.ui.agDay = el.dataset.v; S.ui.agTab = 'dia'; $('#agPanel').hidden = true; go('agenda'); },
  agpClose: () => { $('#agPanel').hidden = true; },
  homeDay: el => { S.ui.homeDay = el.dataset.v; render(); },
  newMovOn: el => editMov(null, { date: el.dataset.v }),
  stPeriod: el => { S.ui.stPeriod = el.dataset.v; render(); },
  cash: cashCounter, scope: el => { S.cfg.scope = el.dataset.v; save(); render(); },
  design: el => { S.cfg.design = el.dataset.v; pushSettings(); render(); }, theme: el => { S.cfg.theme = el.dataset.v; save(); render(); },
  fix: el => { const a = CHECKS[el.dataset.i]?.acts?.[el.dataset.j]; if (a) a[1](); },
  go: el => go(el.dataset.v), syncNow: () => sync(true),
  disconnect: () => { S.cfg.url = ''; S.cfg.token = ''; save(); render(); toast('Hoja desconectada. Los datos siguen en este equipo.'); },
  startLocal: () => { S.data = normalize(emptyData()); save(); render(); },
  more: () => openSheet('Secciones', `<div class="list">${VIEWS.map(([k, n]) => `<a class="item click" href="#${k}" data-act="close" style="text-decoration:none;color:inherit"><span class="ic">${svgI(k)}</span><div class="t"><b>${n}</b></div><span></span></a>`).join('')}</div>`, () => { }),
  csv: () => { const L = filteredMovs(); const cols = ['date', 'type', 'acc', 'sub', 'cat', 'desc', 'amount', 'to', 'tag', 'scope', 'method', 'notes']; const head = ['Fecha', 'Tipo', 'Cuenta', 'Subcategoría', 'Categoría', 'Descripción', 'Monto', 'Cuenta destino', 'Meta / Deuda', 'Ámbito', 'Método', 'Notas']; download('movimientos.csv', '﻿' + [head, ...L.map(m => cols.map(c => c === 'cat' ? mcat(m) : m[c]))].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv'); },
  exportJson: () => download(`mis-finanzas-${today()}.json`, JSON.stringify({ app: 'Mis Finanzas', version: VERSION, exported: new Date().toISOString(), data: S.data, outbox: S.outbox }, null, 1), 'application/json'),
  copyJson: () => { const t = JSON.stringify({ data: S.data }); navigator.clipboard?.writeText(t).then(() => toast('Copia en el portapapeles'), () => toast('No se pudo copiar en este navegador')); },
  install: async () => { const e = S.installEvt; if (!e) return; e.prompt(); await e.userChoice; S.installEvt = null; render(); },
  checkUpdate: async () => { const r = await navigator.serviceWorker?.getRegistration(); if (!r) return toast('La app se actualiza sola al abrirla desde GitHub Pages.'); await r.update(); toast(r.waiting || r.installing ? 'Descargando versión nueva…' : 'Ya tienes la última versión'); },
  reloadSheet: () => { if (!S.cfg.url) { toast('Primero conecta tu hoja en Ajustes'); return go('ajustes'); } S.data = normalize(emptyData()); save(); S.ui.view = 'inicio'; sync(true); },
  resetLocal: () => { $('#resetConfirm').hidden = false; },
  resetYes: () => { try { localStorage.removeItem(LS); } catch (e) { } S.data = normalize(emptyData()); S.outbox = []; S.cfg.url = ''; S.cfg.token = ''; S.cfg.lastSync = 0; render(); }
};
function download(name, text, type) {
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('Descargando ' + name); }
  catch (e) { toast('Tu navegador bloqueó la descarga'); }
}
let toastT;
function toast(msg, action) {
  const t = $('#toast'); t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action[0])}</button>` : ''}`; t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action[1](); };
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, action ? 15000 : 3200);
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const f = ACT[el.dataset.act]; if (!f) return;
  if (el.tagName === 'A' && el.dataset.act !== 'close') e.preventDefault();
  f(el);
});
/* Barra de operaciones para cualquier campo de dinero */
const calcBar = document.createElement('div'); calcBar.className = 'calc-bar'; calcBar.hidden = true;
calcBar.innerHTML = ['+', '-', '*', '/', '(', ')', '='].map(o => `<button type="button" data-o="${o}" aria-label="${{ '+': 'Sumar', '-': 'Restar', '*': 'Multiplicar', '/': 'Dividir', '(': 'Abrir paréntesis', ')': 'Cerrar paréntesis', '=': 'Calcular' }[o]}">${{ '-': '−', '*': '×', '/': '÷' }[o] || o}</button>`).join('') + '<span class="calc-res"></span>';
let calcTarget = null;
const calcPreview = () => { if (!calcTarget) return; const v = calcTarget.value, z = calc(v); calcBar.querySelector('.calc-res').textContent = v && isExpr(v) ? (isFinite(z) ? '= ' + money(z) : 'Revisa la operación') : ''; };
document.addEventListener('focusin', e => {
  const t = e.target; if (!t.classList || !t.classList.contains('calc')) return;
  calcTarget = t; t.insertAdjacentElement('afterend', calcBar); calcBar.hidden = false; calcPreview();
});
document.addEventListener('focusout', e => { const t = e.target; if (t === calcTarget) setTimeout(() => { if (document.activeElement !== t) { calcBar.hidden = true; const z = calc(t.value); if (t.value && isExpr(t.value) && isFinite(z)) { t.value = String(r2(z)); t.dispatchEvent(new Event('input', { bubbles: true })); } if (calcTarget === t) calcTarget = null; } }, 150); });
calcBar.addEventListener('mousedown', e => e.preventDefault());
calcBar.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !calcTarget) return; const o = b.dataset.o, t = calcTarget;
  if (o === '=') { const z = calc(t.value); if (isFinite(z)) t.value = String(r2(z)); }
  else { const p = t.selectionStart ?? t.value.length; t.value = t.value.slice(0, p) + o + t.value.slice(t.selectionEnd ?? p); try { t.setSelectionRange(p + 1, p + 1); } catch (er) { } }
  t.focus(); t.dispatchEvent(new Event('input', { bubbles: true })); calcPreview();
});
document.addEventListener('input', e => { if (e.target === calcTarget) calcPreview(); });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('calc') && isExpr(e.target.value)) { const z = calc(e.target.value); if (isFinite(z)) { e.preventDefault(); e.target.value = String(r2(z)); e.target.dispatchEvent(new Event('input', { bubbles: true })); calcPreview(); } } });
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'blSearch') { S.ui.blocQ = e.target.value; clearTimeout(window._blT); window._blT = setTimeout(() => { const pos = e.target.selectionStart; render(); const q = $('#blSearch'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }, 250); }
  if (id === 'agSearch') { S.ui.agQ = e.target.value; clearTimeout(window._agT); window._agT = setTimeout(() => { const pos = e.target.selectionStart; render(); const q = $('#agSearch'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }, 250); }
  if (id === 'agQ' || id === 'agQH') { const h = $('#agQhint'); if (h) { const p = parseTodo(e.target.value); h.textContent = e.target.value.trim() ? `Se guardará: “${p.text}”${p.due ? ' · ' + agDueLabel(p.due) : ' · sin fecha'}${p.time ? ' · ' + p.time : ''}` : ''; } }
  if (id === 'fq') { S.ui.q = e.target.value; clearTimeout(window._qT); window._qT = setTimeout(() => { const pos = e.target.selectionStart; render(); const q = $('#fq'); q.focus(); q.setSelectionRange(pos, pos); }, 250); }
});
document.addEventListener('change', e => {
  const id = e.target.id, map = { fPeriod: 'fPeriod', fType: 'fType', fAcc: 'fAcc', fCat: 'fCat' };
  if (map[id]) { S.ui[map[id]] = e.target.value; render(); }
  if (id === 'blTpl' && e.target.value) { newPage(e.target.value); return; }
  if (id === 'blImport' && e.target.files.length) { importFiles([...e.target.files]); e.target.value = ''; return; }
  if (id === 'impFile') {
    const file = e.target.files[0]; if (!file) return;
    file.text().then(t => { const j = JSON.parse(t); S.data = normalize(j.data || j); save(); render(); toast('Copia importada'); }).catch(() => toast('Ese archivo no es una copia válida'));
  }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'connForm') { e.preventDefault(); S.cfg.url = $('#cUrl').value.trim(); S.cfg.token = $('#cTok').value.trim(); S.syncErr = ''; save(); sync(true); }
  if (e.target.id === 'agQuick' || e.target.id === 'agQuickHome' || e.target.id === 'agpQuick') { e.preventDefault(); const inp = e.target.querySelector('input'); const p = parseTodo(inp.value); if (!p.text) return toast('Escribe el pendiente'); noteSave({ id: uid(), date: today(), tag: '', text: p.text, action: '', due: p.due, status: 'Pendiente', kind: 'pendiente', time: p.time, color: 'verde', pinned: false }); toast(p.due ? `Pendiente para ${agDueLabel(p.due).toLowerCase()}${p.time ? ' a las ' + p.time : ''}` : 'Pendiente agregado'); setTimeout(() => { if (inp.id === 'agpQ') { $('#agPanel').innerHTML = agPanelHTML(); } const n = $('#' + inp.id); n && n.focus(); }, 30); return; }
  if (e.target.id === 'envForm') { e.preventDefault(); const amt = $('#eAmt').value.trim() ? calcVal('#eAmt') : r2($('#eAmt').placeholder); if (!(amt > 0)) return toast('Escribe el monto por semana'); S.cfg.envelope = { on: true, amount: amt, acc: $('#eAcc').value }; pushSettings(); render(); toast('Sobre semanal activado'); }
  if (e.target.id === 'anaForm') { e.preventDefault(); S.cfg.emergencyMonths = Number($('#aEm').value) || 6; S.cfg.name = $('#aName').value.trim(); pushSettings(); S.cfg.needs = [...e.target.querySelectorAll('input[name=need]:checked')].map(i => i.value); save(); render(); toast('Guardado'); }
  if (e.target.id === 'catForm') { e.preventDefault(); const sub = $('#nSub').value.trim(), cat = $('#nCat').value.trim(); if (!sub || !cat) return; if (catMap()[sub]) return toast('Esa subcategoría ya existe'); op('cat.add', { sub, cat, type: $('#nType').value }); toast('Subcategoría agregada'); }
});
$('#sheetBg').addEventListener('click', e => { if (e.target.id === 'sheetBg') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheetBg').hidden) closeSheet(); if (e.key === 'n' && e.altKey) editMov(); });
$('#fab').onclick = () => editMov();
$('#addBtn').onclick = () => editMov();
$('#mPrev').onclick = () => { S.ui.ym = addM(S.ui.ym, -1); render(); };
$('#mNext').onclick = () => { S.ui.ym = addM(S.ui.ym, 1); render(); };
$('#mLabel').onclick = () => { if (S.ui.ym !== ymOf(today())) { S.ui.ym = ymOf(today()); render(); } };
/* El mes sigue al calendario: al abrir la app, al volver a ella o a medianoche del último día */
let awaySince = 0;
function followMonth(force) {
  const now = ymOf(today());
  if (now !== S.ui.seenYm || force) { S.ui.seenYm = now; if (S.ui.ym !== now) { S.ui.ym = now; S.ui.homeDay = ''; S.ui.calDay = ''; render(); } }
}
setInterval(() => followMonth(false), 60000);
$('#agBtn').onclick = e => { e.stopPropagation(); const p = $('#agPanel'); p.hidden = !p.hidden; if (!p.hidden) p.innerHTML = agPanelHTML(); $('#notifs').hidden = true; if (TP.open && TP.mode === 'drop') { TP.open = false; tapeRender(); } };
$('#blocBtn').onclick = () => { $('#agPanel').hidden = true; go('bloc'); };
document.addEventListener('click', e => { const p = $('#agPanel'); if (p && !p.hidden && !e.target.closest('#agPanel') && !e.target.closest('#agBtn') && $('#sheetBg').hidden) p.hidden = true; });
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.ui.view === 'bloc') { e.preventDefault(); pgSaveNow(); toast('Guardado'); } });
$('#bell').onclick = e => { e.stopPropagation(); $('#notifs').hidden = !$('#notifs').hidden; if (typeof TP !== 'undefined' && TP.open && TP.mode === 'drop') { TP.open = false; tapeRender(); } };
document.addEventListener('click', e => { const p = $('#notifs'); if (p && !p.hidden && (!e.target.closest('#notifs') || e.target.closest('.nf'))) p.hidden = true; });
$('#syncPill').onclick = () => S.cfg.url ? sync(true) : go('ajustes');
window.addEventListener('hashchange', route);
window.addEventListener('online', () => { updatePill(); sync(); });
window.addEventListener('offline', updatePill);
document.addEventListener('visibilitychange', () => { if (document.hidden) { awaySince = Date.now(); return; } followMonth(awaySince && Date.now() - awaySince > 30 * 60000); awaySince = 0; sync(); });
setInterval(() => { if (!document.hidden) { sync(); } }, 120000);
setInterval(updatePill, 30000);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; render(); });

/* ---- Calculadora de cinta (botón junto a la campana / burbuja flotante) ---- */
const TAPE_LS = 'misfinanzas.tape';
const TP = { lines: [], cur: { note: '', amt: '', sign: 1 }, edit: -1, mode: 'drop', x: null, y: null, open: false };
try { Object.assign(TP, JSON.parse(localStorage.getItem(TAPE_LS) || '{}'), { open: false }); } catch (e) { }
const tapeSave = () => { try { localStorage.setItem(TAPE_LS, JSON.stringify({ lines: TP.lines, cur: TP.cur, mode: TP.mode, x: TP.x, y: TP.y })); } catch (e) { } };
const lineVal = l => { const v = calc(l.amt); return isFinite(v) ? r2(v) * (l.sign || 1) : 0; };
const tapeTotal = () => r2(sum(TP.lines, lineVal) + (TP.edit < 0 ? lineVal(TP.cur) : 0));
function tapeCommit() {
  const l = TP.cur; if (!l.amt || !isFinite(calc(l.amt))) return false;
  const rec = { note: (l.note || '').trim(), amt: String(r2(calc(l.amt))), sign: l.sign || 1 };
  if (TP.edit >= 0) TP.lines[TP.edit] = rec; else TP.lines.push(rec);
  TP.cur = { note: '', amt: '', sign: 1 }; TP.edit = -1; return true;
}
function tapeHTML() {
  const total = tapeTotal(), cur = TP.cur, ex = isExpr(cur.amt), cv = calc(cur.amt);
  const n = TP.lines.filter(l => lineVal(l) > 0).length + (TP.edit < 0 && lineVal(cur) > 0 ? 1 : 0);
  return `<div class="tp-head" data-tp="drag"><b>Cuenta rápida</b><span class="tp-tools">
      <button type="button" data-tp="mode" aria-label="${TP.mode === 'float' ? 'Fijar junto a la campana' : 'Hacer flotante'}" title="${TP.mode === 'float' ? 'Fijar junto a la campana' : 'Hacer flotante'}">${TP.mode === 'float' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M9 4v6l-3 4h12l-3-4V4M8 4h8M12 14v6"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="4" y="8" width="12" height="12" rx="2"/><path d="M10 4h10v10"/></svg>'}</button>
      ${TP.mode === 'float' ? '<button type="button" data-tp="min" aria-label="Minimizar" title="Minimizar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg></button>' : ''}
      <button type="button" data-tp="close" aria-label="Cerrar" title="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span></div>
    <div class="tp-lines">${TP.lines.map((l, i) => `<button type="button" class="tp-line ${i === TP.edit ? 'on' : ''} ${l.sign < 0 ? 'neg' : ''}" data-tp="pick" data-i="${i}"><span>${esc(l.note || 'Sin nota')}</span><b>${l.sign < 0 ? '−' : '+'} ${r2(calc(l.amt)).toFixed(2)}</b></button>`).join('') || '<p class="tp-empty">Suma y resta como en una lista: escribe el monto, ponle nota y presiona ↵.</p>'}</div>
    <div class="tp-cur ${cur.sign < 0 ? 'neg' : ''}">
      <button type="button" class="tp-sign" data-tp="sign" aria-label="Cambiar a ${cur.sign < 0 ? 'sumar' : 'restar'}">${cur.sign < 0 ? '−' : '+'}</button>
      <input id="tpNote" type="text" autocomplete="off" placeholder="Nota (opcional)" value="${esc(cur.note)}">
      <span class="tp-amt">${ex ? `<small>${esc(cur.amt.replace(/\*/g, '×').replace(/\//g, '÷'))}</small>${isFinite(cv) ? r2(cv).toFixed(2) : '…'}` : esc(cur.amt || '0')}</span>
    </div>
    <div class="tp-total"><span>Total${TP.lines.length ? ` · ${TP.lines.length} línea${TP.lines.length > 1 ? 's' : ''}` : ''}</span><b class="${total < 0 ? 'neg' : ''}">${money(total)}</b></div>
    <div class="tp-keys">${['7', '8', '9', '-', '4', '5', '6', '+', '1', '2', '3', '*', '.', '0', 'del', 'ok'].map(k => `<button type="button" data-tp="key" data-v="${k}" class="${'+-*'.includes(k) ? 'op' : ''} ${k === 'ok' ? 'ok' : ''}" aria-label="${{ del: 'Borrar', ok: 'Agregar línea', '-': 'Restar', '+': 'Sumar', '*': 'Multiplicar', '.': 'Punto' }[k] || k}">${{ del: '⌫', ok: '↵', '-': '−', '*': '×' }[k] || k}</button>`).join('')}</div>
    <div class="tp-acts">
      ${TP.edit >= 0 ? `<button type="button" class="btn sm danger" data-tp="delLine">Quitar línea</button><button type="button" class="btn sm" data-tp="cancelEdit">Cancelar</button>` : `<button type="button" class="btn sm" data-tp="clear">Limpiar</button><button type="button" class="btn sm" data-tp="copy">Copiar</button>`}
      <span style="flex:1"></span>
      ${n > 1 ? `<button type="button" class="btn sm" data-tp="regMany">Registrar ${n} gastos</button>` : ''}
      <button type="button" class="btn sm pri" data-tp="regOne" ${Math.abs(total) < .005 ? 'disabled' : ''}>Registrar ${money(Math.abs(total))}</button>
    </div>`;
}
function tapeRender() {
  const box = $('#tape'), bub = $('#tapeBubble');
  if (!box) return;
  box.hidden = !TP.open; box.classList.toggle('float', TP.mode === 'float');
  bub.hidden = !(TP.mode === 'float' && !TP.open && (TP.lines.length || TP.cur.amt));
  bub.querySelector('b').textContent = money(tapeTotal());
  const btn = $('#calcBtn'); btn.classList.toggle('on', TP.open);
  const dot = btn.querySelector('.badge'); dot.hidden = !(TP.lines.length && !TP.open); dot.textContent = TP.lines.length;
  if (!TP.open) return;
  const focusNote = document.activeElement && document.activeElement.id === 'tpNote', caret = focusNote ? document.activeElement.selectionStart : null;
  box.innerHTML = tapeHTML();
  if (TP.mode === 'float') {
    const w = box.offsetWidth, h = box.offsetHeight;
    const x = TP.x == null ? window.innerWidth - w - 24 : Math.min(Math.max(8, TP.x), window.innerWidth - w - 8);
    const y = TP.y == null ? 90 : Math.min(Math.max(8, TP.y), window.innerHeight - Math.min(h, window.innerHeight - 16) - 8);
    box.style.left = x + 'px'; box.style.top = y + 'px';
  } else { box.style.left = ''; box.style.top = ''; }
  if (focusNote) { const n = $('#tpNote'); n.focus(); try { n.setSelectionRange(caret, caret); } catch (e) { } }
}
function tapeKey(v) {
  const c = TP.cur; let a = c.amt || ''; const seg = a.split(/[+\-*/]/).pop();
  if (v === 'ok') { if (!tapeCommit()) return; }
  else if (v === 'del') { if (a) a = a.slice(0, -1); else if (TP.edit < 0 && TP.lines.length) { TP.edit = TP.lines.length - 1; TP.cur = Object.assign({}, TP.lines[TP.edit]); tapeRender(); return; } }
  else if ('+-*'.includes(v)) {
    if (!a && v !== '*') { c.sign = v === '-' ? -1 : 1; }
    else if (a && '+-*/'.includes(a.slice(-1))) a = a.slice(0, -1) + v;
    else if (a && (v === '+' || v === '-')) { tapeCommit(); TP.cur.sign = v === '-' ? -1 : 1; tapeSave(); tapeRender(); return; }
    else if (a) a += v;
  }
  else if (v === '.') { if (!seg.includes('.')) a += seg ? '.' : '0.'; }
  else if (!(seg.includes('.') && seg.split('.')[1].length >= 2) && a.length < 24) a = a === '0' ? v : a + v;
  if (v !== 'ok') c.amt = a;
  tapeSave(); tapeRender();
}
function tapeRegister(many) {
  if (TP.cur.amt) tapeCommit();
  const lines = TP.lines.filter(l => Math.abs(lineVal(l)) > .004);
  if (!lines.length) return;
  if (!many) {
    const total = tapeTotal(), note = lines.map(l => (l.sign < 0 ? '−' : '') + (l.note || r2(calc(l.amt)).toFixed(2))).join(', ');
    TP.open = false; tapeRender();
    editMov(null, { type: total >= 0 ? 'Gasto' : 'Ingreso', amount: Math.abs(total), desc: lines.length === 1 ? (lines[0].note || '') : '', notes: lines.length > 1 ? 'Cuenta rápida: ' + note : '' }, { after: () => { TP.lines = []; TP.cur = { note: '', amt: '', sign: 1 }; tapeSave(); tapeRender(); } });
    return;
  }
  const queue = lines.filter(l => lineVal(l) > 0);
  TP.open = false; tapeRender();
  const next = () => {
    const l = queue.shift(); if (!l) { TP.lines = TP.lines.filter(x => lineVal(x) <= 0); tapeSave(); tapeRender(); toast('Gastos de la cuenta rápida registrados'); return; }
    const p = parseQuick((l.note || '') + ' ' + l.amt);
    editMov(null, Object.assign({ type: 'Gasto' }, p.sub && catMap()[p.sub]?.type === 'Gasto' ? { sub: p.sub } : {}, { amount: r2(calc(l.amt)), desc: l.note || '' }), { after: () => { TP.lines = TP.lines.filter(x => x !== l); tapeSave(); setTimeout(next, 250); } });
    toast(`Gasto ${lines.filter(x => lineVal(x) > 0).length - queue.length} de ${lines.filter(x => lineVal(x) > 0).length}: elige categoría y guarda`);
  };
  next();
}
function tapeInit() {
  const box = $('#tape');
  $('#calcBtn').onclick = e => { e.stopPropagation(); TP.open = !TP.open; $('#notifs').hidden = true; tapeRender(); };
  $('#tapeBubble').onclick = () => { TP.open = true; tapeRender(); };
  box.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('[data-tp]'); if (!b || b.dataset.tp === 'drag') return;
    const a = b.dataset.tp;
    if (a === 'key') return tapeKey(b.dataset.v);
    if (a === 'close') { TP.open = false; }
    else if (a === 'min') { TP.open = false; }
    else if (a === 'mode') { TP.mode = TP.mode === 'float' ? 'drop' : 'float'; }
    else if (a === 'sign') { TP.cur.sign = (TP.cur.sign || 1) * -1; }
    else if (a === 'pick') { if (TP.cur.amt && TP.edit < 0) tapeCommit(); const i = Number(b.dataset.i); TP.edit = i; TP.cur = Object.assign({}, TP.lines[i]); }
    else if (a === 'delLine') { TP.lines.splice(TP.edit, 1); TP.edit = -1; TP.cur = { note: '', amt: '', sign: 1 }; }
    else if (a === 'cancelEdit') { TP.edit = -1; TP.cur = { note: '', amt: '', sign: 1 }; }
    else if (a === 'clear') { if (!TP.lines.length && !TP.cur.amt) return; TP.lines = []; TP.cur = { note: '', amt: '', sign: 1 }; TP.edit = -1; toast('Cuenta rápida limpia'); }
    else if (a === 'copy') { const t = TP.lines.map(l => `${l.sign < 0 ? '−' : '+'} ${r2(calc(l.amt)).toFixed(2)}${l.note ? '  ' + l.note : ''}`).concat(['= ' + money(tapeTotal())]).join('\n'); navigator.clipboard?.writeText(t).then(() => toast('Cuenta copiada'), () => toast('No se pudo copiar')); return; }
    else if (a === 'regOne') return tapeRegister(false);
    else if (a === 'regMany') return tapeRegister(true);
    tapeSave(); tapeRender();
  });
  box.addEventListener('input', e => { if (e.target.id === 'tpNote') { TP.cur.note = e.target.value; tapeSave(); } });
  box.addEventListener('keydown', e => {
    if (e.target.id === 'tpNote') { if (e.key === 'Enter') { e.preventDefault(); tapeKey('ok'); } return; }
  });
  document.addEventListener('keydown', e => {
    if (!TP.open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || !$('#sheetBg').hidden) return;
    const k = { x: '*', X: '*', ',': '.', Enter: 'ok', '=': 'ok', Backspace: 'del' }[e.key] || e.key;
    if (/^[0-9.+\-*]$/.test(k) || k === 'ok' || k === 'del') { e.preventDefault(); tapeKey(k); }
    else if (e.key === 'Escape') { TP.open = false; tapeRender(); }
  });
  document.addEventListener('click', e => { if (TP.open && TP.mode === 'drop' && !e.target.closest('#tape') && !e.target.closest('#calcBtn') && $('#sheetBg').hidden) { TP.open = false; tapeRender(); } });
  // arrastrar en modo flotante (y la burbuja)
  const drag = (el, onEnd) => {
    let sx, sy, ox, oy, moved = false;
    el.addEventListener('pointerdown', e => {
      const isHead = e.target.closest('[data-tp="drag"]') && !e.target.closest('button');
      if (el === box && !(TP.mode === 'float' && isHead)) return;
      sx = e.clientX; sy = e.clientY; const r = el.getBoundingClientRect(); ox = r.left; oy = r.top; moved = false;
      const mv = ev => { const dx = ev.clientX - sx, dy = ev.clientY - sy; if (Math.abs(dx) + Math.abs(dy) > 4) moved = true; el.style.left = Math.min(Math.max(4, ox + dx), window.innerWidth - el.offsetWidth - 4) + 'px'; el.style.top = Math.min(Math.max(4, oy + dy), window.innerHeight - 50) + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; };
      const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); if (moved) onEnd(el.getBoundingClientRect()); };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
    });
    el.addEventListener('click', e => { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
  };
  drag(box, r => { TP.x = r.left; TP.y = r.top; tapeSave(); });
  drag($('#tapeBubble'), r => { TP.bx = r.left; TP.by = r.top; });
  window.addEventListener('resize', () => { if (TP.open && TP.mode === 'float') tapeRender(); const [yy, mm] = S.ui.ym.split('-').map(Number); $('#mLabel').textContent = window.innerWidth < 600 ? `${MSHORT[mm - 1]} ${yy}` : ymLabel(S.ui.ym); });
  tapeRender();
}

/* ---------------- Service worker: sin internet + actualizaciones desde GitHub ---------------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    const ask = w => toast('Hay una versión nueva de la app', ['Actualizar', () => w.postMessage('SKIP_WAITING')]);
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); }); });
    setInterval(() => reg.update().catch(() => { }), 30 * 60 * 1000);
  }).catch(() => { /* entorno sin service worker (vista previa) */ });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

/* ---------------- Arranque ---------------- */
load();
S.ui.ym = ymOf(today()); S.ui.seenYm = S.ui.ym;
try { route(); } catch (e) { console.error(e); }
try { tapeInit(); } catch (e) { console.error(e); }
try { registerSW(); } catch (e) { }
sync();
window.addEventListener('error', e => { if (e && e.message) toast('Error: ' + e.message); });
