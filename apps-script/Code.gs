/**
 * Mis Finanzas · conector con tu hoja de Google
 * ------------------------------------------------------------
 * Este script vive DENTRO de tu hoja "Control de Finanzas Personales".
 * La app (GitHub Pages) le envía los cambios y recibe la hoja completa.
 * Solo escribe en las columnas que tú llenas (las amarillas); las fórmulas
 * de Estadísticas, Inicio, Presupuesto, etc. siguen funcionando igual.
 *
 * Instalación: ver README.md del repositorio (sección "Conectar tu hoja").
 */

// ---------- Estructura de tu hoja (no cambiar salvo que muevas columnas) ----------
const MOV = { sheet: 'Movimientos', first: 5, last: 3002, idCol: 18 };            // A..L datos, R = ID de la app
const CUE = { sheet: 'Cuentas', first: 6, last: 25 };                               // A nombre, B tipo, C saldo inicial
const MET = { sheet: 'Metas', first: 6, last: 17, accCol: 14 };                     // A..E datos, N = cuenta vinculada (app)
const DEU = { sheet: 'Deudas', first: 6, last: 15 };                                // A..F
const PAG = { sheet: 'Pagos fijos', first: 6, last: 30 };                           // A..F datos, G..R meses
const PRE = { sheet: 'Presupuesto', first: 6, last: 45 };                           // A categoría (fórmula), B monto
const CAT = { sheet: 'Categorias', first: 5, last: 400 };                           // A sub, B categoría, C tipo; E gasto, G ingreso, K métodos, M ámbitos, O tipos de cuenta
const NOT = { sheet: 'Notas', first: 6, last: 305, idCol: 7 };                      // A..F, G = ID de la app

const TZ = 'America/El_Salvador';

// ---------- Puntos de entrada ----------
function doGet(e) {
  return json_({ ok: true, app: 'Mis Finanzas', msg: 'Conector activo. Usa la app para sincronizar.' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Solicitud inválida' }); }
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || body.token !== token) return json_({ ok: false, error: 'Código de acceso incorrecto' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json_({ ok: false, error: 'La hoja está ocupada, intenta en unos segundos' });
  try {
    const ss = SpreadsheetApp.getActive();
    const results = [];
    (body.ops || []).forEach(op => {
      try { applyOp_(ss, op); results.push({ opId: op.opId, ok: true }); }
      catch (err) { results.push({ opId: op.opId, ok: false, error: String(err.message || err) }); }
    });
    SpreadsheetApp.flush();
    return json_({ ok: true, results: results, serverTime: Date.now(), data: snapshot_(ss) });
  } finally {
    lock.releaseLock();
  }
}

/** Ejecuta esta función UNA vez desde el editor: crea tu código de acceso y prepara la hoja. */
function configurar() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) { token = Utilities.getUuid().replace(/-/g, '').slice(0, 20); props.setProperty('TOKEN', token); }
  const ss = SpreadsheetApp.getActive();
  ss.getSheetByName(MOV.sheet).getRange(4, MOV.idCol).setValue('ID app').setFontColor('#999999');
  ss.getSheetByName(MET.sheet).getRange(5, MET.accCol).setValue('Cuenta vinculada (app)');
  ss.getSheetByName(NOT.sheet).getRange(5, NOT.idCol).setValue('ID app').setFontColor('#999999');
  ensureListValue_(ss, 13, 'Negocio');   // Ámbito: Personal, Compartido, Negocio
  assignIds_(ss);
  Logger.log('Tu código de acceso es: ' + token);
  Logger.log('Cópialo en la app: Ajustes → Conectar mi hoja.');
}

/** Opcional: corrige las fórmulas de la hoja Metas que apuntan a la fila equivocada. */
function repararFormulasMetas() {
  const sh = SpreadsheetApp.getActive().getSheetByName(MET.sheet);
  for (let r = MET.first; r <= MET.last; r++) {
    sh.getRange(r, 6, 1, 8).setFormulas([[
      `=IF($A${r}="","",SUMIFS(Movimientos!$G$5:$G$3002,Movimientos!$I$5:$I$3002,$A${r},Movimientos!$B$5:$B$3002,"Aporte a meta"))`,
      `=IF($A${r}="","",SUMIFS(Movimientos!$G$5:$G$3002,Movimientos!$I$5:$I$3002,$A${r},Movimientos!$B$5:$B$3002,"Retiro de meta"))`,
      `=IF($A${r}="","",D${r}+F${r}-G${r})`,
      `=IF(OR($A${r}="",N(C${r})=0),"",H${r}/C${r})`,
      `=IF(OR($A${r}="",N(C${r})=0),"",MAX(C${r}-H${r},0))`,
      `=IF(OR($A${r}="",E${r}=""),"",MAX((YEAR(E${r})-YEAR(TODAY()))*12+MONTH(E${r})-MONTH(TODAY()),0))`,
      `=IF(OR(J${r}="",K${r}=""),"",IF(K${r}>0,J${r}/K${r},J${r}))`,
      `=IF(OR($A${r}="",N(C${r})=0),"",IF(H${r}>=C${r},"Lograda",IF(AND(E${r}<>"",E${r}<TODAY()),"Vencida",IF(I${r}>=0.75,"Casi lista","En progreso"))))`
    ]]);
  }
  Logger.log('Fórmulas de Metas reparadas en filas ' + MET.first + ' a ' + MET.last);
}

// ---------- Aplicar cambios que manda la app ----------
function applyOp_(ss, op) {
  const d = op.data || {};
  switch (op.type) {
    case 'mov.upsert': return movUpsert_(ss, d);
    case 'mov.delete': return movDelete_(ss, d.id);
    case 'acc.upsert': return rowUpsert_(ss, CUE, d.oldName || d.name, [d.name, d.type, num_(d.initial)], { renameIn: [[MOV.sheet, 3], [MOV.sheet, 8]], newName: d.name, oldName: d.oldName });
    case 'acc.delete': return rowClear_(ss, CUE, d.name, 3);
    case 'goal.upsert': {
      const r = rowUpsert_(ss, MET, d.oldName || d.name, [d.name, d.purpose || '', num_(d.target) || '', num_(d.initial) || '', date_(d.due)], { renameIn: [[MOV.sheet, 9]], newName: d.name, oldName: d.oldName });
      ss.getSheetByName(MET.sheet).getRange(r, MET.accCol).setValue(d.acc || '');
      return r;
    }
    case 'goal.delete': { const sh = ss.getSheetByName(MET.sheet); const r = findRow_(sh, MET, d.name); if (r) { sh.getRange(r, 1, 1, 5).clearContent(); sh.getRange(r, MET.accCol).clearContent(); } return; }
    case 'debt.upsert': return rowUpsert_(ss, DEU, d.oldName || d.name, [d.name, d.creditor || '', num_(d.original), num_(d.rate) / 100 || '', num_(d.payment), d.day || ''], { renameIn: [[MOV.sheet, 9]], newName: d.name, oldName: d.oldName });
    case 'debt.delete': return rowClear_(ss, DEU, d.name, 6);
    case 'fixed.upsert': return rowUpsert_(ss, PAG, d.oldName || d.name, [d.name, d.sub, num_(d.amount), d.day || '', d.acc || '', d.freq || 'Mensual']);
    case 'fixed.delete': return rowClear_(ss, PAG, d.name, 18);
    case 'fixed.mark': {
      const sh = ss.getSheetByName(PAG.sheet); const r = findRow_(sh, PAG, d.name);
      if (!r) throw new Error('No encontré el pago fijo ' + d.name);
      sh.getRange(r, 6 + Number(d.month)).setValue(d.paid ? 'Pagado' : '');
      return;
    }
    case 'budget.set': {
      const sh = ss.getSheetByName(PRE.sheet);
      const vals = sh.getRange(PRE.first, 1, PRE.last - PRE.first + 1, 1).getValues();
      const i = vals.findIndex(v => v[0] === d.cat);
      if (i < 0) throw new Error('La categoría ' + d.cat + ' no está en Presupuesto');
      sh.getRange(PRE.first + i, 2).setValue(num_(d.amount) || '');
      return;
    }
    case 'cat.add': {
      const sh = ss.getSheetByName(CAT.sheet);
      const col = sh.getRange(CAT.first, 1, CAT.last - CAT.first + 1, 1).getValues();
      if (col.some(v => v[0] === d.sub)) return;
      const i = col.findIndex(v => v[0] === '');
      sh.getRange(CAT.first + i, 1, 1, 3).setValues([[d.sub, d.cat, d.type]]);
      ensureListValue_(ss, d.type === 'Ingreso' ? 7 : 5, d.cat);
      return;
    }
    case 'note.upsert': {
      const sh = ss.getSheetByName(NOT.sheet);
      let r = findById_(sh, NOT, d.id) || firstEmpty_(sh, NOT, [1, 3, NOT.idCol]);
      sh.getRange(r, 1, 1, 6).setValues([[date_(d.date), d.tag || '', d.text || '', d.action || '', date_(d.due), d.status || '']]);
      sh.getRange(r, NOT.idCol).setValue(d.id);
      return;
    }
    case 'note.delete': { const sh = ss.getSheetByName(NOT.sheet); const r = findById_(sh, NOT, d.id); if (r) { sh.getRange(r, 1, 1, 6).clearContent(); sh.getRange(r, NOT.idCol).clearContent(); } return; }
    default: throw new Error('Operación desconocida: ' + op.type);
  }
}

function movUpsert_(ss, m) {
  const sh = ss.getSheetByName(MOV.sheet);
  const r = findById_(sh, MOV, m.id) || firstEmpty_(sh, MOV, [1, 7, MOV.idCol]);
  if (!r) throw new Error('La hoja Movimientos está llena (fila ' + MOV.last + '). Amplía las fórmulas.');
  // A Fecha, B Tipo, C Cuenta, D Subcategoría, (E fórmula), F Descripción, G Monto, H Destino, I Meta/Deuda, J Ámbito, K Método, L Notas
  sh.getRange(r, 1, 1, 4).setValues([[date_(m.date), m.type, m.acc, m.sub || '']]);
  sh.getRange(r, 6, 1, 7).setValues([[m.desc || '', num_(m.amount), m.to || '', m.goal || m.debt || '', m.scope || '', m.method || '', m.notes || '']]);
  sh.getRange(r, MOV.idCol).setValue(m.id);
  return r;
}

function movDelete_(ss, id) {
  const sh = ss.getSheetByName(MOV.sheet);
  const r = findById_(sh, MOV, id);
  if (!r) return;
  sh.getRange(r, 1, 1, 4).clearContent();
  sh.getRange(r, 6, 1, 7).clearContent();
  sh.getRange(r, MOV.idCol).clearContent();
}

function rowUpsert_(ss, T, key, values, opts) {
  const sh = ss.getSheetByName(T.sheet);
  let r = findRow_(sh, T, key) || findRow_(sh, T, values[0]) || firstEmpty_(sh, T, [1]);
  if (!r) throw new Error('No hay filas libres en ' + T.sheet);
  const prev = sh.getRange(r, 1).getValue();
  const cur = sh.getRange(r, 1, 1, values.length).getValues()[0];
  // No pisa fórmulas (ej. saldo inicial =453.15-399.98) si el valor no cambió
  const formulas = sh.getRange(r, 1, 1, values.length).getFormulas()[0];
  values.forEach((v, i) => {
    if (formulas[i] && Number(cur[i]) === Number(v)) return;
    if (v === undefined || v === null) return;
    sh.getRange(r, i + 1).setValue(v);
  });
  if (opts && opts.oldName && opts.newName && opts.oldName !== opts.newName && prev === opts.oldName) {
    opts.renameIn.forEach(([sheetName, col]) => renameValues_(ss.getSheetByName(sheetName), col, opts.oldName, opts.newName));
  }
  return r;
}

function rowClear_(ss, T, name, width) {
  const sh = ss.getSheetByName(T.sheet); const r = findRow_(sh, T, name);
  if (r) sh.getRange(r, 1, 1, width).clearContent();
}

function renameValues_(sh, col, from, to) {
  const rg = sh.getRange(MOV.first, col, MOV.last - MOV.first + 1, 1);
  const v = rg.getValues(); let changed = false;
  v.forEach(row => { if (row[0] === from) { row[0] = to; changed = true; } });
  if (changed) rg.setValues(v);
}

// ---------- Leer la hoja completa ----------
function snapshot_(ss) {
  assignIds_(ss);
  const read = (T, cols) => ss.getSheetByName(T.sheet).getRange(T.first, 1, T.last - T.first + 1, cols).getValues();

  const movs = [];
  read(MOV, MOV.idCol).forEach((r, i) => {
    if (r[0] === '' && r[6] === '') return;
    const type = r[1];
    const tag = r[8] || '';
    movs.push({
      id: r[17], row: MOV.first + i, date: fmt_(r[0]), type: type, acc: r[2], sub: r[3], cat: r[4], desc: r[5], amount: Number(r[6]) || 0,
      to: r[7], goal: type === 'Gasto' ? '' : tag, debt: type === 'Gasto' ? tag : '', tag: tag, scope: r[9], method: r[10], notes: r[11]
    });
  });

  const accounts = read(CUE, 3).filter(r => r[0] !== '').map(r => ({ name: r[0], type: r[1], initial: Number(r[2]) || 0 }));
  const goals = read(MET, MET.accCol).filter(r => r[0] !== '').map(r => ({ name: r[0], purpose: r[1], target: Number(r[2]) || 0, initial: Number(r[3]) || 0, due: fmt_(r[4]), acc: r[13] || '' }));
  const debts = read(DEU, 6).filter(r => r[0] !== '').map(r => ({ name: r[0], creditor: r[1], original: Number(r[2]) || 0, rate: (Number(r[3]) || 0) * 100, payment: Number(r[4]) || 0, day: r[5] }));
  const fixed = read(PAG, 18).filter(r => r[0] !== '').map(r => ({ name: r[0], sub: r[1], amount: Number(r[2]) || 0, day: Number(r[3]) || 1, acc: r[4], freq: r[5] || 'Mensual', paid: r.slice(6, 18).map(x => x === 'Pagado') }));
  const budgets = read(PRE, 2).filter(r => r[0] !== '').map(r => ({ cat: r[0], amount: Number(r[1]) || 0 }));
  const catRows = read(CAT, 15);
  const cats = catRows.filter(r => r[0] !== '').map(r => ({ sub: r[0], cat: r[1], type: r[2] }));
  const list = col => catRows.map(r => r[col]).filter(v => v !== '' && !String(v).startsWith('No editar'));
  const notes = read(NOT, NOT.idCol).filter(r => r[2] !== '').map(r => ({ id: r[6], date: fmt_(r[0]), tag: r[1], text: r[2], action: r[3], due: fmt_(r[4]), status: r[5] }));

  return {
    accounts, goals, debts, fixed, budgets, cats, notes, movs,
    lists: { expenseCats: list(4), incomeCats: list(6), types: list(8), methods: list(10), scopes: list(12), accTypes: list(14) }
  };
}

// ---------- Utilidades ----------
function assignIds_(ss) {
  [[MOV, [1, 7]], [NOT, [3]]].forEach(([T, keyCols]) => {
    const sh = ss.getSheetByName(T.sheet);
    const n = T.last - T.first + 1;
    const data = sh.getRange(T.first, 1, n, T.idCol).getValues();
    const ids = data.map(r => [r[T.idCol - 1]]);
    let changed = false;
    data.forEach((r, i) => {
      const used = keyCols.some(c => r[c - 1] !== '');
      if (used && !ids[i][0]) { ids[i][0] = Utilities.getUuid().slice(0, 12); changed = true; }
    });
    if (changed) sh.getRange(T.first, T.idCol, n, 1).setValues(ids);
  });
}

function findById_(sh, T, id) {
  if (!id) return 0;
  const v = sh.getRange(T.first, T.idCol, T.last - T.first + 1, 1).getValues();
  const i = v.findIndex(r => r[0] === id);
  return i < 0 ? 0 : T.first + i;
}

function findRow_(sh, T, name) {
  if (!name) return 0;
  const v = sh.getRange(T.first, 1, T.last - T.first + 1, 1).getValues();
  const i = v.findIndex(r => r[0] === name);
  return i < 0 ? 0 : T.first + i;
}

function firstEmpty_(sh, T, cols) {
  const maxCol = Math.max.apply(null, cols);
  const v = sh.getRange(T.first, 1, T.last - T.first + 1, maxCol).getValues();
  const i = v.findIndex(r => cols.every(c => r[c - 1] === ''));
  return i < 0 ? 0 : T.first + i;
}

function ensureListValue_(ss, col, value) {
  const sh = ss.getSheetByName(CAT.sheet);
  const v = sh.getRange(CAT.first, col, 40, 1).getValues();
  if (v.some(r => r[0] === value)) return;
  const i = v.findIndex(r => r[0] === '');
  if (i >= 0) sh.getRange(CAT.first + i, col).setValue(value);
}

function date_(s) {
  if (!s) return '';
  const p = String(s).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12, 0, 0);   // mediodía: evita saltos de día por zona horaria
}
function fmt_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : (d || ''); }
function num_(x) { const n = Number(x); return isNaN(n) ? 0 : Math.round(n * 100) / 100; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
