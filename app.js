/* Mis Finanzas · app.js
 * Una sola fuente de verdad: tu hoja de Google (vía Apps Script).
 * La app guarda una copia local para trabajar sin internet y una cola de cambios
 * que se envían solos cuando vuelve la conexión.
 */
'use strict';
const VERSION = '1.2.0';
const LS = 'misfinanzas.v1';
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MSHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const WEEK = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const NEEDS = ['Vivienda', 'Servicios básicos', 'Alimentación', 'Transporte', 'Auto', 'Salud', 'Educación', 'Finanzas y deudas', 'Impuestos y trámites', 'Familia y hogar'];
const ADJ = 'Ajuste de saldo';

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
  cfg: { url: '', token: '', name: '', design: 'a', theme: 'auto', lastSync: 0, needs: NEEDS.slice(), scope: 'Todos', emergencyMonths: 6 },
  ui: { view: 'inicio', ym: ymOf(today()), q: '', fType: '', fAcc: '', fCat: '', fPeriod: 'mes', stPeriod: 'mes' },
  syncing: false, syncErr: '', installEvt: null
};
function load() {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) { const j = JSON.parse(raw); S.data = j.data; S.outbox = j.outbox || []; Object.assign(S.cfg, j.cfg || {}); }
  } catch (e) { /* almacenamiento bloqueado: se trabaja en memoria */ }
  if (!S.data) S.data = window.__SEED__ ? JSON.parse(JSON.stringify(window.__SEED__)) : emptyData();
  normalize(S.data);
}
function save() { try { localStorage.setItem(LS, JSON.stringify({ data: S.data, outbox: S.outbox, cfg: S.cfg })); } catch (e) { } }
function normalize(d) {
  ['accounts', 'goals', 'debts', 'fixed', 'budgets', 'cats', 'notes', 'movs'].forEach(k => d[k] = d[k] || []);
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
  d.notes.forEach(x => { ['date', 'tag', 'text', 'action', 'due', 'status'].forEach(k => x[k] = str(x[k])); });
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
  }
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
    S.data = normalize(j.data);
    S.outbox.forEach(applyLocal);
    S.cfg.lastSync = Date.now(); S.syncErr = '';
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
function catMap() { if (CM && CM.src === S.data.cats) return CM.map; const map = {}; S.data.cats.forEach(c => map[c.sub] = c); CM = { src: S.data.cats, map }; return map; }
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
    if (m.type === 'Gasto' && /ajuste/i.test(m.desc) && m.sub !== ADJ) out.push({ sev: 'info', title: 'Ajuste registrado como gasto normal', detail: `${m.desc} · ${money(m.amount)} quedó en “${m.sub}”. Ponerlo en “${ADJ}” separa la plata que no cuadró de tus gastos reales.`, acts: [['Mover a ' + ADJ, () => { ensureAdj(); op('mov.upsert', Object.assign({}, m, { sub: ADJ })); }]] });
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
  ['inicio', 'Inicio', 'Día a día'], ['movimientos', 'Movimientos'], ['estados', 'Estados'], ['cuentas', 'Cuentas'], ['metas', 'Metas'],
  ['presupuesto', 'Presupuesto', 'Planear'], ['pagos', 'Pagos fijos'], ['deudas', 'Deudas'],
  ['estadisticas', 'Estadísticas', 'Analizar'], ['revision', 'Revisión'], ['notas', 'Notas'], ['ajustes', 'Ajustes', 'App']
];
const PRIMARY = ['inicio', 'movimientos', 'estados', 'metas'];
function renderNav() {
  const html = ['<div class="navbrand"><span class="mark">$</span>Mis Finanzas</div>'];
  VIEWS.forEach(([k, name, grp], i) => {
    if (grp) html.push(`<div class="grp">${grp}</div>`);
    if (k === 'estados') html.push('<span class="slot" aria-hidden="true"></span>');
    const n = k === 'revision' && S.data ? checks().filter(c => c.sev !== 'info').length : 0;
    html.push(`<a href="#${k}" data-v="${k}" class="${PRIMARY.includes(k) ? '' : 'sec'} ${S.ui.view === k ? 'on' : ''}">${svgI(k)}<span>${name}${n ? ` <span class="pill bad">${n}</span>` : ''}</span></a>`);
  });
  html.push(`<a href="#" class="more" data-act="more">${svgI('mas')}<span>Más</span></a>`);
  $('#nav').innerHTML = html.join('');
}
function go(v) { if (location.hash !== '#' + v) location.hash = v; else route(); }
function route() {
  const v = (location.hash || '#inicio').slice(1);
  S.ui.view = VIEWS.some(x => x[0] === v) ? v : 'inicio';
  render(); window.scrollTo(0, 0);
}

/* ---------------- Render principal ---------------- */
function render() {
  document.body.dataset.design = S.cfg.design;
  if (S.cfg.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = S.cfg.theme;
  const tc = { a: '#14171a', b: '#0b2239', c: '#0f141b' }[S.cfg.design]; document.querySelector('meta[name=theme-color]')?.setAttribute('content', tc);
  $('#mLabel').textContent = ymLabel(S.ui.ym);
  renderNav(); updatePill();
  const fn = { inicio: vInicio, estados: vEstados, movimientos: vMovs, cuentas: vCuentas, metas: vMetas, presupuesto: vPresupuesto, pagos: vPagos, deudas: vDeudas, estadisticas: vStats, revision: vRevision, notas: vNotas, ajustes: vAjustes }[S.ui.view];
  try { $('#view').innerHTML = `<div class="wrap">${fn()}</div>`; S.lastError = ''; }
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

  return `
  ${window.__SEED__ && !S.cfg.url ? `<div class="preview-note">Vista previa con los datos de tu archivo. Los cambios aquí no llegan a tu hoja.</div>` : ''}
  <div class="home">
    <div class="home-main">
      <div class="hello"><div><p>${isNow ? `${wd[0].toUpperCase() + wd.slice(1)} ${d} de ${MONTHS[m - 1].toLowerCase()}` : ymLabel(ym)}</p><h1>${isNow ? greet + name : 'Resumen de ' + MONTHS[m - 1].toLowerCase()}</h1></div>${scopeSeg()}</div>
      <section class="spend">${hero}${meters}</section>
      ${chips.length ? `<div class="chipbar">${chips.join('')}</div>` : ''}
      <section class="feed"><header><h2>Lo que pasó</h2><a href="#movimientos">Ver todo</a></header>
        ${Object.keys(groups).length ? Object.entries(groups).map(([dt, ms]) => { const out = sum(ms.filter(x => x.type === 'Gasto'), x => x.amount); return `<div class="day-head"><span>${WEEK[(new Date(dt + 'T12:00').getDay() + 6) % 7]} ${dLabel(dt).replace(/ \d{4}$/, '')}</span><span class="num">${out ? '−' + money(out) : ''}</span></div><div class="list">${ms.map(movItem).join('')}</div>`; }).join('') : `<div class="empty"><p>Aún no hay movimientos este mes.</p><button class="btn pri" data-act="newMov">Registrar el primero</button></div>`}
      </section>
    </div>
    <aside class="home-side">
      <section class="card side-card"><header style="margin:0"><h2>${MONTHS[m - 1]}</h2><a href="#estados">Estados</a></header>
        <div class="row2"><span class="muted">Entró</span><span class="num">${money(cur.inc)}</span></div>
        <div class="row2"><span class="muted">Salió</span><span class="num">${money(cur.exp)}</span></div>
        <div class="row2 total"><span>Balance</span><span class="num ${cur.bal < 0 ? 'neg' : 'pos'}">${money(cur.bal, true)}</span></div>
        ${big && cur.exp && big.amount / cur.exp > .35 ? `<p class="note">${esc(big.desc || big.sub)} (${money(big.amount)}) es el ${pct(big.amount / cur.exp)} del mes. Sin ese gasto saliste con ${money(cur.exp - big.amount)}.</p>` : cur.inc ? `<p class="note">Tasa de ahorro: ${pct(cur.rate)}. Lo sano es 20% o más.</p>` : ''}
      </section>
      ${stagesCard(false)}
      <section class="card side-card"><header style="margin:0"><h2>Presupuesto</h2><a href="#presupuesto">Detalle</a></header>
        ${buds.slice(0, 4).map(({ b, sp: s }) => { const p = s / b.amount; return `<div class="mini"><div class="row2"><span>${esc(b.cat)}</span><span class="num ${p > 1 ? 'neg' : ''}">${money(s).replace('.00', '')} / ${money(b.amount).replace('.00', '')}</span></div><div class="bar ${p > 1 ? 'over' : p >= .85 ? 'near' : 'good'}"><i style="width:${Math.min(100, p * 100)}%"></i></div></div>`; }).join('') || '<p class="note">Define montos en Presupuesto para saber cuánto puedes gastar cada día.</p>'}
      </section>
      ${goals.map(g => { const s = goalSaved(g, null, bal), p = s / g.target; let ml = null; if (g.due) { const [gy, gm] = g.due.split('-').map(Number); ml = Math.max((gy - y) * 12 + gm - m, 0); } return `<section class="card side-card"><header style="margin:0"><h2>${esc(g.name)}</h2><span class="pill ${p >= 1 ? 'ok' : 'acc'}">${pct(p)}</span></header><div class="row2"><span class="num" style="font-size:1.35rem">${money(s)}</span><span class="muted" style="font-size:.84rem">de ${money(g.target)}${g.due ? ' · ' + dLabel(g.due).replace(/ \d{4}$/, '') : ''}</span></div><div class="bar ${p >= 1 ? 'good' : ''}"><i style="width:${Math.min(100, Math.max(p, 0) * 100)}%"></i></div>${ml != null && p < 1 ? `<p class="note">Aparta ${money((g.target - s) / Math.max(ml, 1))} al mes para llegar a tiempo.</p>` : ''}</section>`; }).join('')}
      ${pend.length ? `<section class="card side-card"><header style="margin:0"><h2>Por pagar</h2><a href="#pagos">Pagos fijos</a></header>${pend.slice(0, 4).map(({ f, s }) => `<div class="row2"><span>${esc(f.name)} <small class="${s.late ? 'neg' : 'muted'}">${s.late ? 'vencido' : 'día ' + f.day}</small></span><span class="btns"><span class="num">${money(f.amount)}</span>${s.found.length ? `<button class="btn sm" data-act="fixMark" data-n="${esc(f.name)}">Marcar</button>` : `<button class="btn sm" data-act="fixPay" data-n="${esc(f.name)}">Pagar</button>`}</span></div>`).join('')}</section>` : ''}
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
function vMovs() {
  const L = filteredMovs(), u = S.ui, D = S.data;
  const inc = sum(L.filter(m => m.type === 'Ingreso'), m => m.amount), exp = sum(L.filter(m => m.type === 'Gasto'), m => m.amount);
  const groups = {}; L.forEach(m => (groups[m.date] = groups[m.date] || []).push(m));
  const opt = (arr, sel, all) => `<option value="">${all}</option>` + arr.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const cats = [...new Set([...D.lists.expenseCats, ...D.lists.incomeCats, ...D.cats.map(c => c.cat)])];
  return `${head('Movimientos', `${L.length} movimientos · entradas ${money(inc)} · salidas ${money(exp)}`, `<button class="btn" data-act="csv">Exportar CSV</button>`)}
  <div class="card"><div class="filters">
    <input class="ctl" id="fq" type="search" placeholder="Buscar descripción, monto, nota…" value="${esc(u.q)}" style="flex:2 1 220px">
    <select class="ctl" id="fPeriod"><option value="mes" ${u.fPeriod === 'mes' ? 'selected' : ''}>${ymLabel(u.ym)}</option><option value="año" ${u.fPeriod === 'año' ? 'selected' : ''}>Todo ${u.ym.slice(0, 4)}</option><option value="todo" ${u.fPeriod === 'todo' ? 'selected' : ''}>Todo el historial</option></select>
    <select class="ctl" id="fType">${opt(D.lists.types, u.fType, 'Todos los tipos')}</select>
    <select class="ctl" id="fAcc">${opt(D.accounts.map(a => a.name), u.fAcc, 'Todas las cuentas')}</select>
    <select class="ctl" id="fCat">${opt(cats, u.fCat, 'Todas las categorías')}</select>
  </div></div>
  <div class="card">${Object.keys(groups).length ? Object.entries(groups).map(([d, ms]) => `<div class="day-head"><span>${dLabel(d)} · ${WEEK[(new Date(d + 'T12:00').getDay() + 6) % 7]}</span><span class="num">${money(sum(ms.filter(m => m.type === 'Gasto'), m => m.amount) ? -sum(ms.filter(m => m.type === 'Gasto'), m => m.amount) : 0)}</span></div><div class="list">${ms.map(movItem).join('')}</div>`).join('') : `<div class="empty"><p>No hay movimientos con estos filtros.</p><button class="btn pri" data-act="newMov">Agregar movimiento</button></div>`}</div>`;
}

/* ---- Cuentas ---- */
function vCuentas() {
  const W = worth(), ym = S.ui.ym;
  const net = {}; S.data.movs.filter(m => ymOf(m.date) === ym).forEach(m => { const A = m.amount; const add = (a, v) => net[a] = (net[a] || 0) + v; if (m.type === 'Ingreso' || m.type === 'Retiro de meta') add(m.acc, A); else if (m.type === 'Gasto' || m.type === 'Aporte a meta') add(m.acc, -A); else if (m.type === 'Transferencia') { add(m.acc, -A); if (m.to) add(m.to, A); } });
  const linked = g => S.data.goals.filter(x => x.acc === g).map(x => x.name);
  return `${head('Cuentas', 'Saldo actual = saldo inicial + ingresos − gastos ± transferencias − aportes a metas + retiros. La misma fórmula de tu hoja.', `<button class="btn" data-act="cash">Contar efectivo</button><button class="btn" data-act="newTransfer">Transferir</button><button class="btn pri" data-act="newAcc">Nueva cuenta</button>`)}
  <div class="kpis"><div class="kpi"><span class="label">En cuentas</span><span class="v">${money(W.inAcc)}</span></div><div class="kpi"><span class="label">En metas</span><span class="v">${money(W.inGoals)}</span></div><div class="kpi"><span class="label">Deudas</span><span class="v">${money(W.debts)}</span></div><div class="kpi"><span class="label">Patrimonio neto</span><span class="v">${money(W.net)}</span></div></div>
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
  <div class="kpis"><div class="kpi"><span class="label">Ingresos ${y}</span><span class="v">${money(totInc)}</span><span class="d">prom. ${money(totInc / active)}/mes</span></div><div class="kpi"><span class="label">Gastos ${y}</span><span class="v">${money(totExp)}</span><span class="d">prom. ${money(totExp / active)}/mes</span></div><div class="kpi"><span class="label">Ahorro ${y}</span><span class="v ${totInc - totExp < 0 ? 'neg' : 'pos'}">${money(totInc - totExp)}</span><span class="d">tasa ${pct(totInc ? (totInc - totExp) / totInc : null)}</span></div><div class="kpi"><span class="label">Gasto diario ${MSHORT[mi - 1]}</span><span class="v">${money(cur.exp / (isNow ? Number(today().slice(8)) : daysIn(ym)))}</span></div></div>
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
    <p class="muted" style="font-size:.82rem;margin:12px 0 0">La hoja es la fuente de verdad: lo que cambies directo en Sheets también aparece aquí. ${S.outbox.length ? `<b>${S.outbox.length} cambio(s) esperan para enviarse.</b>` : ''}</p></section>
  <section class="card"><header><h2>Personal y análisis</h2></header><form class="form" id="anaForm"><label class="field"><span>Tu nombre (para el saludo)</span><input id="aName" value="${esc(c.name)}" placeholder="Diego"></label><label class="field"><span>Meses de gastos para el fondo de emergencia</span><input id="aEm" type="number" min="1" max="12" value="${c.emergencyMonths}"></label>
    <div class="field"><span>Categorías que cuentan como necesidad (regla 50/30/20)</span><div class="chips" style="flex-wrap:wrap">${S.data.lists.expenseCats.map(k => `<label class="chip" style="border-style:solid;${c.needs.includes(k) ? 'color:var(--accent);border-color:var(--accent)' : ''}"><input type="checkbox" name="need" value="${esc(k)}" ${c.needs.includes(k) ? 'checked' : ''} style="margin-right:5px">${esc(k)}</label>`).join('')}</div></div><div><button class="btn" type="submit">Guardar</button></div></form></section>
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
    const left = b - (spent - prev) - (Number(st.amt) || 0);
    return left >= 0 ? `<div class="reg-note ok">${esc(cat)}: te quedan <b>${money(left)}</b> este mes</div>` : `<div class="reg-note bad">${esc(cat)}: te pasas por <b>${money(-left)}</b> este mes</div>`;
  };
  const valid = () => {
    const n = Number(st.amt) || 0;
    if (!(n > 0)) return 'Escribe el monto';
    if ((st.type === 'Gasto' || st.type === 'Ingreso') && !st.sub) return 'Elige una categoría';
    if (!st.acc) return 'Elige la cuenta';
    if (st.type === 'Transferencia' && (!st.to || st.to === st.acc)) return 'Elige a qué cuenta va';
    if (st.type.includes('meta') && !st.goal) return 'Elige la meta';
    return '';
  };
  const chipRow = (list, cur, act) => `<div class="reg-chips">${list.map(n => `<button type="button" class="rchip ${n === cur ? 'on' : ''}" data-r="${act}" data-v="${esc(n)}">${esc(n)}</button>`).join('')}</div>`;
  const paint = () => {
    const n = Number(st.amt) || 0, k = kind(), err = valid();
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
      <div class="reg-amt ${st.type === 'Gasto' ? 'out' : st.type === 'Ingreso' ? 'in' : ''} ${n ? '' : 'zero'}"><span>${sign}$${esc(st.amt || '0')}</span></div>
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
      <div class="reg-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map(x => `<button type="button" data-r="key" data-v="${x}" aria-label="${x === 'del' ? 'Borrar' : x}">${x === 'del' ? '⌫' : x}</button>`).join('')}</div>
      <button type="button" class="reg-save ${err ? 'off' : ''}" data-r="save">${err || (isNew ? 'Guardar ' : 'Guardar cambios · ') + sign + money(n).replace('−', '')}</button>
      ${isNew ? '' : `<div class="btns" style="justify-content:center"><button type="button" class="btn sm" data-r="dup">Duplicar</button><button type="button" class="btn sm danger" data-r="del">Eliminar</button></div><div id="delConfirm" hidden class="alert bad"><span></span><div><b>¿Eliminar este movimiento?</b><p>Se borra también de tu hoja.</p></div><div class="acts"><button type="button" class="btn sm danger" data-r="delYes">Eliminar</button></div></div>`}`;
  };
  const readMore = () => { if (!st.more) return; st.desc = $('#rDesc')?.value.trim() ?? st.desc; st.scope = $('#rScope')?.value || st.scope; st.method = $('#rMethod')?.value ?? st.method; st.debt = $('#rDebt')?.value ?? st.debt; st.notes = $('#rNotes')?.value.trim() ?? st.notes; };
  const save = () => {
    readMore(); if (valid()) return;
    const t = st.type;
    const rec = { id: st.id, date: st.date || today(), type: t, acc: st.acc, to: t === 'Transferencia' ? st.to : '', sub: t === 'Gasto' || t === 'Ingreso' ? st.sub : '', desc: st.desc || (t === 'Gasto' || t === 'Ingreso' ? st.sub : t === 'Transferencia' ? 'A ' + st.to : st.goal), amount: r2(st.amt), goal: t.includes('meta') ? st.goal : '', debt: t === 'Gasto' ? st.debt : '', scope: st.scope || 'Personal', method: st.method, notes: st.notes };
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
    else if (r === 'key') { let a = st.amt; if (v === 'del') a = a.slice(0, -1); else if (v === '.') { if (!a.includes('.')) a = (a || '0') + '.'; } else if (!(a.includes('.') && a.split('.')[1].length >= 2) && a.replace('.', '').length < 8) a = a === '0' ? v : a + v; st.amt = a; }
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
    if (/^[0-9.]$/.test(e.key)) { body.querySelector(`[data-r="key"][data-v="${e.key}"]`)?.click(); e.preventDefault(); }
    else if (e.key === 'Backspace') { body.querySelector('[data-r="key"][data-v="del"]')?.click(); e.preventDefault(); }
    else if (e.key === 'Enter') { save(); e.preventDefault(); }
  };
  document.addEventListener('keydown', keyH);
  paint();
}
function editAcc(a) {
  const isNew = !a; a = a || { name: '', type: 'Banco', initial: 0 };
  openSheet(isNew ? 'Nueva cuenta' : 'Editar cuenta', `<label class="field"><span>Nombre</span><input id="aName" value="${esc(a.name)}" required autofocus></label><div class="two"><label class="field"><span>Tipo</span>${sel('aType', S.data.lists.accTypes, a.type)}</label><label class="field"><span>Saldo inicial</span><input id="aIni" type="number" step="0.01" value="${a.initial}"></label></div>
  ${isNew ? '' : '<p class="muted" style="margin:0;font-size:.82rem">Si cambias el nombre, también se actualiza en todos tus movimientos de la hoja.</p>'}
  <div class="btns" style="justify-content:space-between">${isNew ? '<span></span>' : '<button type="button" class="btn danger" id="aDel">Eliminar</button>'}<button class="btn pri">Guardar</button></div>`, () => {
    const name = $('#aName').value.trim(); if (!name) return 'Escribe el nombre.';
    if (name !== a.name && S.data.accounts.some(x => x.name === name)) return 'Ya existe una cuenta con ese nombre.';
    op('acc.upsert', { oldName: isNew ? '' : a.name, name, type: $('#aType').value, initial: r2($('#aIni').value) });
  }, () => $('#aDel')?.addEventListener('click', () => { if (S.data.movs.some(m => m.acc === a.name || m.to === a.name)) { $('#fErr').textContent = 'Esta cuenta tiene movimientos. Cámbialos de cuenta antes de eliminarla.'; return; } op('acc.delete', { name: a.name }); closeSheet(); }));
}
function editGoal(g) {
  const isNew = !g; g = g || { name: '', purpose: '', target: '', initial: 0, due: '', acc: '' };
  openSheet(isNew ? 'Nueva meta' : 'Editar meta', `<label class="field"><span>Nombre</span><input id="gName" value="${esc(g.name)}" required autofocus></label><label class="field"><span>Para qué es</span><input id="gPur" value="${esc(g.purpose)}"></label>
  <div class="two"><label class="field"><span>Monto objetivo</span><input id="gTar" type="number" step="0.01" value="${g.target || ''}"></label><label class="field"><span>Fecha objetivo</span><input id="gDue" type="date" value="${g.due || ''}"></label></div>
  <div class="two"><label class="field"><span>Saldo inicial</span><input id="gIni" type="number" step="0.01" value="${g.initial || 0}"></label><label class="field"><span>Se guarda en la cuenta</span>${sel('gAcc', S.data.accounts.map(a => a.name), g.acc, 'No vincular')}</label></div>
  <p class="muted" style="margin:0;font-size:.82rem">Si la vinculas a una cuenta (por ejemplo “Fondo compartido”), el avance es el saldo de esa cuenta y no hace falta registrar aportes.</p>
  <div class="btns" style="justify-content:space-between">${isNew ? '<span></span>' : '<button type="button" class="btn danger" id="gDel">Eliminar</button>'}<button class="btn pri">Guardar</button></div>`, () => {
    const name = $('#gName').value.trim(); if (!name) return 'Escribe el nombre.';
    op('goal.upsert', { oldName: isNew ? '' : g.name, name, purpose: $('#gPur').value.trim(), target: r2($('#gTar').value), initial: r2($('#gIni').value), due: $('#gDue').value, acc: $('#gAcc').value });
  }, () => $('#gDel')?.addEventListener('click', () => { op('goal.delete', { name: g.name }); closeSheet(); }));
}
function editDebt(d) {
  const isNew = !d; d = d || { name: '', creditor: '', original: '', rate: '', payment: '', day: '' };
  openSheet(isNew ? 'Nueva deuda' : 'Editar deuda', `<div class="two"><label class="field"><span>Nombre</span><input id="dName" value="${esc(d.name)}" required autofocus></label><label class="field"><span>Acreedor</span><input id="dCred" value="${esc(d.creditor)}"></label></div>
  <div class="two"><label class="field"><span>Monto original</span><input id="dOri" type="number" step="0.01" value="${d.original}"></label><label class="field"><span>Tasa anual (%)</span><input id="dRate" type="number" step="0.01" value="${d.rate}"></label></div>
  <div class="two"><label class="field"><span>Cuota mensual</span><input id="dPay" type="number" step="0.01" value="${d.payment}"></label><label class="field"><span>Día de pago</span><input id="dDay" type="number" min="1" max="31" value="${d.day}"></label></div>
  <div class="btns" style="justify-content:space-between">${isNew ? '<span></span>' : '<button type="button" class="btn danger" id="dDel">Eliminar</button>'}<button class="btn pri">Guardar</button></div>`, () => {
    const name = $('#dName').value.trim(); if (!name) return 'Escribe el nombre.';
    op('debt.upsert', { oldName: isNew ? '' : d.name, name, creditor: $('#dCred').value.trim(), original: r2($('#dOri').value), rate: Number($('#dRate').value) || 0, payment: r2($('#dPay').value), day: Number($('#dDay').value) || '' });
  }, () => $('#dDel')?.addEventListener('click', () => { op('debt.delete', { name: d.name }); closeSheet(); }));
}
function editFixed(f) {
  const isNew = !f; f = f || { name: '', sub: '', amount: '', day: 1, acc: S.data.accounts[0]?.name, freq: 'Mensual' };
  openSheet(isNew ? 'Nuevo pago fijo' : 'Editar pago fijo', `<label class="field"><span>Concepto</span><input id="xName" value="${esc(f.name)}" required autofocus></label>
  <div class="two"><label class="field"><span>Monto</span><input id="xAmt" type="number" step="0.01" value="${f.amount}"></label><label class="field"><span>Día de pago</span><input id="xDay" type="number" min="1" max="31" value="${f.day}"></label></div>
  <div class="two"><label class="field"><span>Subcategoría</span><select id="xSub">${subOptions('Gasto', f.sub)}</select></label><label class="field"><span>Cuenta</span>${sel('xAcc', S.data.accounts.map(a => a.name), f.acc)}</label></div>
  <label class="field"><span>Frecuencia</span>${sel('xFreq', ['Mensual', 'Quincenal', 'Trimestral', 'Anual'], f.freq)}</label>
  <div class="btns" style="justify-content:space-between">${isNew ? '<span></span>' : '<button type="button" class="btn danger" id="xDel">Eliminar</button>'}<button class="btn pri">Guardar</button></div>`, () => {
    const name = $('#xName').value.trim(); if (!name) return 'Escribe el concepto.'; if (!$('#xSub').value) return 'Elige la subcategoría.';
    op('fixed.upsert', { oldName: isNew ? '' : f.name, name, amount: r2($('#xAmt').value), day: Number($('#xDay').value) || 1, sub: $('#xSub').value, acc: $('#xAcc').value, freq: $('#xFreq').value });
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
  <div class="label">Billetes</div><div class="cash">${bills.map(b => `<label>$${b}<input type="number" min="0" data-v="${b}" inputmode="numeric"></label>`).join('')}</div>
  <div class="label">Monedas</div><div class="cash">${coins.map(b => `<label>${b < 1 ? Math.round(b * 100) + '¢' : '$1'}<input type="number" min="0" data-v="${b}" inputmode="numeric"></label>`).join('')}</div>
  <label class="field"><span>Comparar con la cuenta</span>${sel('cAcc', cashAccs.length ? cashAccs : S.data.accounts.map(a => a.name), cashAccs[0])}</label>
  <div class="kpis"><div class="kpi"><span class="label">Contado</span><span class="v" id="cTot">$0.00</span></div><div class="kpi"><span class="label">Según la app</span><span class="v" id="cApp"></span></div><div class="kpi"><span class="label">Diferencia</span><span class="v" id="cDif"></span></div></div>
  <div class="btns" style="justify-content:end"><button class="btn pri" id="cAdj">Registrar ajuste</button></div>`, () => {
    const tot = r2([...document.querySelectorAll('.cash input')].reduce((s, i) => s + (Number(i.value) || 0) * Number(i.dataset.v), 0));
    const acc = $('#cAcc').value, dif = r2(tot - (bal[acc] || 0));
    if (!dif) return 'No hay diferencia: la cuenta cuadra.';
    ensureAdj();
    op('mov.upsert', { id: uid(), date: today(), type: dif < 0 ? 'Gasto' : 'Ingreso', acc, sub: ADJ, desc: 'Ajuste por conteo de efectivo', amount: Math.abs(dif), scope: 'Personal', method: 'Efectivo', notes: `Contado ${money(tot)}, la app tenía ${money(bal[acc] || 0)}`, to: '', goal: '', debt: '' });
    toast('Ajuste registrado');
  }, f => {
    const upd = () => { const tot = [...f.querySelectorAll('.cash input')].reduce((s, i) => s + (Number(i.value) || 0) * Number(i.dataset.v), 0); const app = bal[$('#cAcc').value] || 0; $('#cTot').textContent = money(tot); $('#cApp').textContent = money(app); const d = tot - app; $('#cDif').textContent = money(d, true); $('#cDif').className = 'v ' + (Math.abs(d) < .005 ? 'pos' : 'neg'); };
    f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
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
  budget: el => { const c = el.dataset.c, b = (S.data.budgets.find(x => x.cat === c) || {}).amount || ''; openSheet('Presupuesto de ' + esc(c), `<label class="field"><span>Monto mensual</span><input id="bAmt" type="number" step="0.01" min="0" value="${b}" autofocus></label><button class="btn pri">Guardar</button>`, () => op('budget.set', { cat: c, amount: r2($('#bAmt').value) })); },
  stPeriod: el => { S.ui.stPeriod = el.dataset.v; render(); },
  cash: cashCounter, scope: el => { S.cfg.scope = el.dataset.v; save(); render(); },
  design: el => { S.cfg.design = el.dataset.v; save(); render(); }, theme: el => { S.cfg.theme = el.dataset.v; save(); render(); },
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
document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'fq') { S.ui.q = e.target.value; clearTimeout(window._qT); window._qT = setTimeout(() => { const pos = e.target.selectionStart; render(); const q = $('#fq'); q.focus(); q.setSelectionRange(pos, pos); }, 250); }
});
document.addEventListener('change', e => {
  const id = e.target.id, map = { fPeriod: 'fPeriod', fType: 'fType', fAcc: 'fAcc', fCat: 'fCat' };
  if (map[id]) { S.ui[map[id]] = e.target.value; render(); }
  if (id === 'impFile') {
    const file = e.target.files[0]; if (!file) return;
    file.text().then(t => { const j = JSON.parse(t); S.data = normalize(j.data || j); save(); render(); toast('Copia importada'); }).catch(() => toast('Ese archivo no es una copia válida'));
  }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'connForm') { e.preventDefault(); S.cfg.url = $('#cUrl').value.trim(); S.cfg.token = $('#cTok').value.trim(); S.syncErr = ''; save(); sync(true); }
  if (e.target.id === 'anaForm') { e.preventDefault(); S.cfg.emergencyMonths = Number($('#aEm').value) || 6; S.cfg.name = $('#aName').value.trim(); S.cfg.needs = [...e.target.querySelectorAll('input[name=need]:checked')].map(i => i.value); save(); render(); toast('Guardado'); }
  if (e.target.id === 'catForm') { e.preventDefault(); const sub = $('#nSub').value.trim(), cat = $('#nCat').value.trim(); if (!sub || !cat) return; if (catMap()[sub]) return toast('Esa subcategoría ya existe'); op('cat.add', { sub, cat, type: $('#nType').value }); toast('Subcategoría agregada'); }
});
$('#sheetBg').addEventListener('click', e => { if (e.target.id === 'sheetBg') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheetBg').hidden) closeSheet(); if (e.key === 'n' && e.altKey) editMov(); });
$('#fab').onclick = () => editMov();
$('#addBtn').onclick = () => editMov();
$('#mPrev').onclick = () => { S.ui.ym = addM(S.ui.ym, -1); render(); };
$('#mNext').onclick = () => { S.ui.ym = addM(S.ui.ym, 1); render(); };
$('#syncPill').onclick = () => S.cfg.url ? sync(true) : go('ajustes');
window.addEventListener('hashchange', route);
window.addEventListener('online', () => { updatePill(); sync(); });
window.addEventListener('offline', updatePill);
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
setInterval(() => { if (!document.hidden) { sync(); } }, 120000);
setInterval(updatePill, 30000);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; render(); });

/* ---------------- Service worker: sin internet + actualizaciones desde GitHub ---------------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(reg => {
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
if (S.data && !S.data.movs.some(m => ymOf(m.date) === S.ui.ym)) { const last = S.data.movs.map(m => ymOf(m.date)).filter(x => x <= ymOf(today())).sort().pop(); if (last) S.ui.ym = last; }
try { route(); } catch (e) { console.error(e); }
try { registerSW(); } catch (e) { }
sync();
window.addEventListener('error', e => { if (e && e.message) toast('Error: ' + e.message); });
