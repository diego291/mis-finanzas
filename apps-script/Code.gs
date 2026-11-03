/**
 * Mis Finanzas · conector con tu hoja de Google
 * ------------------------------------------------------------
 * Este script vive DENTRO de tu hoja "Control de Finanzas Personales".
 * La app (GitHub Pages) le envía los cambios y recibe la hoja completa.
 * Solo escribe en las columnas que tú llenas (las amarillas); las fórmulas
 * de Estadísticas, Inicio, Presupuesto, etc. siguen funcionando igual.
 *
 * Instalación: ver README.md del repositorio (sección "Conectar tu hoja").
 *
 * Versión 3 (universal): además de tus hojas de siempre, guarda en la hoja "AppData"
 * cualquier dato nuevo de la app (ajustes compartidos, funciones futuras), así que
 * las próximas mejoras de la app ya no necesitan cambiar este código.
 *
 * Versión 4: avisos programados por correo (tu Gmail) y al teléfono (app ntfy).
 * Después de pegar este código: elige la función "activarAvisos" arriba, toca Ejecutar
 * y acepta los permisos. Luego Implementar → Administrar implementaciones → Editar →
 * Versión: Nueva versión → Implementar.
 */

// ---------- Estructura de tu hoja (no cambiar salvo que muevas columnas) ----------
const MOV = { sheet: 'Movimientos', first: 5, last: 3002, idCol: 18 };            // A..L datos, R = ID de la app
const CUE = { sheet: 'Cuentas', first: 6, last: 25 };                               // A nombre, B tipo, C saldo inicial
const MET = { sheet: 'Metas', first: 6, last: 17, accCol: 14 };                     // A..E datos, N = cuenta vinculada (app)
const DEU = { sheet: 'Deudas', first: 6, last: 15 };                                // A..F
const PAG = { sheet: 'Pagos fijos', first: 6, last: 30 };                           // A..F datos, G..R meses
const PRE = { sheet: 'Presupuesto', first: 6, last: 45 };                           // A categoría (fórmula), B monto
const CAT = { sheet: 'Categorias', first: 5, last: 400 };                           // A sub, B categoría, C tipo; E gasto, G ingreso, K métodos, M ámbitos, O tipos de cuenta
const NOT = { sheet: 'Notas', first: 6, last: 1005, idCol: 7, extra: 4 };          // A..F, G = ID de la app, H tipo, I hora, J color, K fijada
const API_VERSION = 4;
const APP = { sheet: 'AppData' };                                                  // almacén genérico: Colección | ID | Datos (JSON) | Actualizado

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
    return json_({ ok: true, v: API_VERSION, results: results, serverTime: Date.now(), data: snapshot_(ss) });
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
  ensureNoteHeaders_(ss.getSheetByName(NOT.sheet));
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
      ensureNoteHeaders_(sh);
      sh.getRange(r, NOT.idCol + 1, 1, NOT.extra).setValues([[d.kind || '', d.time ? "'" + d.time : '', d.color || '', d.pinned ? 'Sí' : '']]);
      return;
    }
    case 'note.delete': { const sh = ss.getSheetByName(NOT.sheet); const r = findById_(sh, NOT, d.id); if (r) { sh.getRange(r, 1, 1, 6).clearContent(); sh.getRange(r, NOT.idCol, 1, 1 + NOT.extra).clearContent(); } return; }
    case 'rec.upsert': {
      const sh = appSheet_(ss), row = findRec_(sh, d.coll, d.id) || sh.getLastRow() + 1;
      sh.getRange(row, 2).setNumberFormat('@');
      sh.getRange(row, 1, 1, 4).setValues([[String(d.coll), String(d.id), JSON.stringify(d.data == null ? null : d.data), new Date()]]);
      return;
    }
    case 'rec.delete': { const sh = appSheet_(ss), row = findRec_(sh, d.coll, d.id); if (row) sh.deleteRow(row); return; }
    case 'notif.install': return instalarDisparador_();
    case 'notif.test': return notifTest_(ss, d);
    case 'notif.send': return notifSendNow_(ss, d);
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
  const notes = read(NOT, NOT.idCol + NOT.extra).filter(r => r[2] !== '').map(r => ({ id: r[6], date: fmt_(r[0]), tag: r[1], text: r[2], action: r[3], due: fmt_(r[4]), status: r[5], kind: r[7] || '', time: r[8] instanceof Date ? Utilities.formatDate(r[8], TZ, 'HH:mm') : String(r[8] || ''), color: r[9] || '', pinned: r[10] === 'Sí' || r[10] === true }));

  const store = {};
  const ash = ss.getSheetByName(APP.sheet);
  if (ash && ash.getLastRow() > 1) {
    ash.getRange(2, 1, ash.getLastRow() - 1, 3).getValues().forEach(r => {
      if (r[0] === '' || r[1] === '') return;
      let v = null; try { v = JSON.parse(r[2]); } catch (e) { v = r[2]; }
      (store[r[0]] = store[r[0]] || {})[String(r[1])] = v;
    });
  }

  return {
    accounts, goals, debts, fixed, budgets, cats, notes, movs, store,
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

function appSheet_(ss) {
  let sh = ss.getSheetByName(APP.sheet);
  if (!sh) {
    sh = ss.insertSheet(APP.sheet);
    sh.getRange(1, 1, 1, 4).setValues([['Colección', 'ID', 'Datos (no editar a mano)', 'Actualizado']]).setFontWeight('bold');
    sh.setFrozenRows(1); sh.setColumnWidth(3, 520);
  }
  return sh;
}

function findRec_(sh, coll, id) {
  const n = sh.getLastRow() - 1; if (n < 1) return 0;
  const v = sh.getRange(2, 1, n, 2).getValues();
  const i = v.findIndex(r => String(r[0]) === String(coll) && String(r[1]) === String(id));
  return i < 0 ? 0 : i + 2;
}

function ensureNoteHeaders_(sh) {
  const h = sh.getRange(5, NOT.idCol + 1, 1, NOT.extra);
  if (h.getValues()[0][0] === '') h.setValues([['Tipo (app)', 'Hora', 'Color', 'Fijada']]).setFontColor('#999999');
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


// =====================================================================
//  Avisos programados (v4): correo con tu Gmail + teléfono con ntfy
// =====================================================================
const NOTIF_EVERY_MIN = 10;   // cada cuánto revisa si toca mandar algo
const APP_URL_DEFAULT = 'https://diego291.github.io/mis-finanzas/';

/** Ejecútala UNA vez desde el editor: pide los permisos (correo, internet, horarios) y programa la revisión. */
function activarAvisos() {
  instalarDisparador_();
  const cfg = notifCfg_(SpreadsheetApp.getActive());
  const to = (cfg && cfg.email) || Session.getActiveUser().getEmail();
  if (to) MailApp.sendEmail({ to: to, subject: 'Mis Finanzas · avisos activados', htmlBody: mailWrap_('Avisos activados', '<p>Desde ahora tu hoja revisa cada ' + NOTIF_EVERY_MIN + ' minutos si toca mandarte un resumen o un recordatorio. Las horas y lo que incluye cada aviso se configuran en la app: <b>Ajustes → Avisos y notificaciones</b>.</p>', (cfg && cfg.appUrl) || APP_URL_DEFAULT) });
  Logger.log('Listo. Avisos activados. Ahora: Implementar → Administrar implementaciones → Editar → Nueva versión → Implementar.');
}
/** Por si quieres apagar todo desde la hoja. */
function desactivarAvisos() { ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'revisarAvisos').forEach(t => ScriptApp.deleteTrigger(t)); Logger.log('Avisos desactivados.'); }

function instalarDisparador_() {
  const has = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'revisarAvisos');
  if (!has) ScriptApp.newTrigger('revisarAvisos').timeBased().everyMinutes(NOTIF_EVERY_MIN).create();
  return 'ok';
}
function notifCfg_(ss) { const sh = appSheet_(ss), r = findRec_(sh, 'notif', 'cfg'); if (!r) return null; try { return JSON.parse(sh.getRange(r, 3).getValue()); } catch (e) { return null; } }

/** La llama el disparador cada 10 minutos. */
function revisarAvisos() {
  const lock = LockService.getScriptLock(); if (!lock.tryLock(30000)) return;
  try {
    const ss = SpreadsheetApp.getActive(), cfg = notifCfg_(ss);
    if (!cfg || cfg.off) return;
    const props = PropertiesService.getScriptProperties();
    let sent = {}; try { sent = JSON.parse(props.getProperty('NOTIF_SENT') || '{}'); } catch (e) { }
    const now = new Date(), today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd'), hm = Utilities.formatDate(now, TZ, 'HH:mm');
    const dow = Number(Utilities.formatDate(now, TZ, 'u')); // 1 = lunes … 7 = domingo
    const nowMin = toMin_(hm);
    let data = null; const D = () => data || (data = snapshot_(ss));
    // 1) resúmenes programados
    (cfg.schedules || []).forEach(sc => {
      if (sc.off || !sc.time) return;
      if (sc.days && sc.days.length && sc.days.indexOf(dow) < 0) return;
      const t = toMin_(sc.time); if (nowMin < t || nowMin - t > 90) return;   // hasta 90 min de tolerancia si Google se retrasa
      const key = 'S|' + sc.id + '|' + today; if (sent[key]) return;
      const dg = digest_(D(), sc.content || ['agenda', 'pagos', 'veh', 'dinero'], today);
      if (sc.skipEmpty && !dg.count) { sent[key] = Date.now(); return; }
      deliver_(cfg, sc.channels || ['email', 'phone'], (sc.name || 'Resumen') + ' · ' + fechaLarga_(today), dg, false);
      sent[key] = Date.now();
    });
    // 2) aviso a la hora exacta de cada pendiente o actividad con hora
    const ex = cfg.exact || {};
    if (ex.on) {
      const before = Number(ex.before) || 0;
      D().notes.forEach(n => {
        if (!n.due || !n.time || n.status === 'Hecho' || !/^\d{1,2}:\d{2}/.test(n.time)) return;
        if (n.due !== today) return;
        const at = toMin_(n.time) - before;
        if (nowMin < at || nowMin - at > 60) return;
        const key = 'E|' + n.id + '|' + n.due + '|' + n.time; if (sent[key]) return;
        const title = (before ? 'En ' + before + ' min: ' : 'Ahora: ') + n.text;
        deliverOne_(cfg, ex.channels || ['phone'], title, (n.time + (n.action ? ' · ' + n.action : '') + (n.tag ? ' · #' + n.tag : '')), 'high', ['alarm_clock']);
        sent[key] = Date.now();
      });
    }
    // limpia registros de más de 10 días
    const lim = Date.now() - 10 * 864e5; Object.keys(sent).forEach(k => { if (sent[k] < lim) delete sent[k]; });
    props.setProperty('NOTIF_SENT', JSON.stringify(sent));
  } finally { lock.releaseLock(); }
}

function notifTest_(ss, d) {
  const cfg = Object.assign({}, notifCfg_(ss) || {}, d.cfg || {});
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const dg = digest_(snapshot_(ss), ['agenda', 'pagos', 'veh', 'dinero'], today);
  deliver_(cfg, [d.channel || 'email'], 'Prueba · ' + fechaLarga_(today), dg, true);
  return 'ok';
}
function notifSendNow_(ss, d) {
  const cfg = Object.assign({}, notifCfg_(ss) || {}, d.cfg || {});
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const dg = digest_(snapshot_(ss), d.content || ['agenda'], today, d.all);
  deliver_(cfg, d.channels || ['email'], d.title || ('Tus pendientes · ' + fechaLarga_(today)), dg, true);
  return 'ok';
}

function deliver_(cfg, channels, title, dg, force) {
  if (channels.indexOf('email') >= 0) {
    const to = cfg.email || Session.getEffectiveUser().getEmail();
    if (!to) throw new Error('Falta tu correo en Ajustes → Avisos');
    MailApp.sendEmail({ to: to, subject: 'Mis Finanzas · ' + title, htmlBody: mailWrap_(title, dg.html || '<p>Todo en orden. No tienes nada pendiente.</p>', cfg.appUrl || APP_URL_DEFAULT), name: 'Mis Finanzas' });
  }
  if (channels.indexOf('phone') >= 0) {
    if (!cfg.topic) { if (force) throw new Error('Falta el tema de ntfy en Ajustes → Avisos'); return; }
    ntfy_(cfg, title, dg.text || 'Todo en orden. No tienes nada pendiente.', dg.urgent ? 'high' : 'default', dg.urgent ? ['warning'] : ['spiral_calendar']);
  }
}
function deliverOne_(cfg, channels, title, body, prio, tags) {
  if (channels.indexOf('phone') >= 0 && cfg.topic) ntfy_(cfg, title, body, prio, tags);
  if (channels.indexOf('email') >= 0) { const to = cfg.email || Session.getEffectiveUser().getEmail(); if (to) MailApp.sendEmail({ to: to, subject: 'Recordatorio · ' + title, htmlBody: mailWrap_(title, '<p>' + esc_(body) + '</p>', cfg.appUrl || APP_URL_DEFAULT), name: 'Mis Finanzas' }); }
}
function ntfy_(cfg, title, message, priority, tags) {
  const server = (cfg.server || 'https://ntfy.sh').replace(/\/+$/, '');
  const res = UrlFetchApp.fetch(server, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify({ topic: cfg.topic, title: title, message: String(message).slice(0, 3500), priority: priority === 'high' ? 4 : 3, tags: tags || [], click: cfg.appUrl || APP_URL_DEFAULT }) });
  if (res.getResponseCode() >= 300) throw new Error('ntfy respondió ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 120));
}

// ---------- Contenido del resumen ----------
function digest_(D, content, today, allPend) {
  const sec = [], txt = []; let count = 0, urgent = false;
  const add = (title, items) => { if (!items.length) return; count += items.length; sec.push('<h3 style="margin:18px 0 6px;font-size:15px">' + esc_(title) + '</h3><ul style="margin:0;padding-left:18px">' + items.map(i => '<li style="margin:3px 0' + (i.bad ? ';color:#c0392b' : '') + '">' + i.h + '</li>').join('') + '</ul>'); txt.push(title.toUpperCase()); items.forEach(i => txt.push('• ' + i.t)); txt.push(''); };
  const tomorrow = addDays_(today, 1), ym = today.slice(0, 7), day = Number(today.slice(8));
  if (content.indexOf('agenda') >= 0) {
    const N = D.notes.filter(n => n.status !== 'Hecho' && n.text && (n.kind === 'pendiente' || n.kind === 'evento' || n.due));
    const line = n => { const when = n.due ? (n.due === today ? 'hoy' : n.due === tomorrow ? 'mañana' : fechaCorta_(n.due)) : ''; const t = (n.time ? n.time + ' · ' : '') + n.text + (n.action ? ' (' + n.action + ')' : ''); return { h: '<b>' + esc_(t) + '</b>' + (when && n.due !== today ? ' <span style="color:#888">· ' + when + '</span>' : ''), t: t + (when && n.due !== today ? ' · ' + when : ''), bad: n.due && n.due < today }; };
    const late = N.filter(n => n.due && n.due < today), hoy = N.filter(n => n.due === today).sort((a, b) => (a.time || '99').localeCompare(b.time || '99')), man = N.filter(n => n.due === tomorrow);
    if (late.length) urgent = true;
    add('Atrasado', late.map(line)); add('Hoy', hoy.map(line)); add('Mañana', man.map(line));
    const sinFecha = N.filter(n => !n.due && n.kind === 'pendiente');
    if (allPend) add('Sin fecha', sinFecha.map(line));
    else if (sinFecha.length) { sec.push('<p style="color:#888;margin:8px 0 0">Y ' + sinFecha.length + ' pendiente' + (sinFecha.length > 1 ? 's' : '') + ' sin fecha.</p>'); txt.push('+ ' + sinFecha.length + ' pendiente' + (sinFecha.length > 1 ? 's' : '') + ' sin fecha', ''); }
    const prox = N.filter(n => n.due > tomorrow && n.due <= addDays_(today, 7));
    if (allPend) add('Próximos 7 días', prox.map(line));
  }
  if (content.indexOf('pagos') >= 0) {
    const mi = Number(ym.slice(5)) - 1, L = [];
    D.fixed.filter(f => f.freq === 'Mensual' && !(f.paid || [])[mi]).forEach(f => {
      const paidMov = D.movs.some(m => m.type === 'Gasto' && m.sub === f.sub && m.date.slice(0, 7) === ym && Math.abs(m.amount - f.amount) < f.amount * .3);
      if (paidMov) return;
      const left = (f.day || 1) - day;
      if (left <= 3) { const t = f.name + ' · $' + money_(f.amount) + ' · ' + (left < 0 ? 'atrasado' : left === 0 ? 'vence hoy' : 'en ' + left + ' día' + (left > 1 ? 's' : '')); L.push({ h: esc_(t), t: t, bad: left <= 0 }); if (left <= 0) urgent = true; }
    });
    add('Pagos fijos', L);
  }
  if (content.indexOf('veh') >= 0) {
    const st = D.store || {}, V = st.veh || {}, L = [];
    Object.keys(V).forEach(vid => {
      const v = V[vid]; if (!v || v.del) return; const km = Number(v.km) || 0;
      Object.keys(st.vtask || {}).map(k => st.vtask[k]).filter(t => t && t.veh === vid).forEach(t => {
        let rem = null, dd = null;
        if (t.everyKm && t.lastKm !== '' && t.lastKm != null) rem = Number(t.lastKm) + Number(t.everyKm) - km;
        if (t.everyMonths && t.lastDate) dd = daysBetween_(today, addMonths_(t.lastDate, Number(t.everyMonths)));
        const bad = (rem != null && rem <= 0) || (dd != null && dd <= 0), soon = !bad && ((rem != null && rem <= Math.max(150, t.everyKm * .1)) || (dd != null && dd <= 7));
        if (!bad && !soon) return; if (bad) urgent = true;
        const s = v.name + ': ' + t.name + ' · ' + (bad ? (rem != null && rem <= 0 ? 'vencido hace ' + Math.round(-rem) + ' km' : 'vencido') : rem != null ? 'faltan ' + Math.round(rem) + ' km' : 'en ' + dd + ' días');
        L.push({ h: esc_(s), t: s, bad: bad });
      });
      Object.keys(st.vdoc || {}).map(k => st.vdoc[k]).filter(d => d && d.veh === vid && d.due).forEach(d => {
        const n = daysBetween_(today, d.due); if (n > 30) return;
        const s = v.name + ': ' + d.name + ' ' + (n < 0 ? 'venció' : n === 0 ? 'vence hoy' : 'vence en ' + n + ' días'); L.push({ h: esc_(s), t: s, bad: n <= 0 }); if (n <= 0) urgent = true;
      });
    });
    add('Vehículos', L);
  }
  if (content.indexOf('dinero') >= 0) {
    const M = D.movs.filter(m => m.date.slice(0, 7) === ym), dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate(), left = dim - day + 1;
    const byCat = {}; M.filter(m => m.type === 'Gasto').forEach(m => byCat[m.cat] = (byCat[m.cat] || 0) + m.amount);
    const B = D.budgets.filter(b => b.amount > 0), L = [];
    if (B.length) {
      const tot = B.reduce((s, b) => s + b.amount, 0), sp = B.reduce((s, b) => s + (byCat[b.cat] || 0), 0), rem = tot - sp;
      L.push({ h: rem >= 0 ? 'Puedes gastar hoy <b>$' + money_(rem / left) + '</b> (te quedan $' + money_(rem) + ' para ' + left + ' días)' : '<b>Ya pasaste el presupuesto del mes por $' + money_(-rem) + '</b>', t: rem >= 0 ? 'Puedes gastar hoy $' + money_(rem / left) + ' (quedan $' + money_(rem) + ' para ' + left + ' días)' : 'Pasaste el presupuesto por $' + money_(-rem), bad: rem < 0 });
      B.filter(b => (byCat[b.cat] || 0) > b.amount).forEach(b => { const s = b.cat + ' pasó el límite: $' + money_(byCat[b.cat]) + ' de $' + money_(b.amount); L.push({ h: esc_(s), t: s, bad: true }); });
    }
    const last = D.movs.map(m => m.date).filter(x => x && x <= today).sort().pop();
    if (last) { const n = daysBetween_(last, today); if (n >= 2) { const s = 'Llevas ' + n + ' días sin registrar nada. ¿Se te pasó algún gasto?'; L.push({ h: esc_(s), t: s }); } }
    if (!M.some(m => m.date === today) && Number(Utilities.formatDate(new Date(), TZ, 'H')) >= 18) { const s = 'Hoy no has registrado movimientos.'; L.push({ h: esc_(s), t: s }); }
    add('Tu dinero', L);
  }
  return { html: sec.join(''), text: txt.join('\n').trim(), count: count, urgent: urgent };
}

// ---------- utilidades de avisos ----------
function mailWrap_(title, body, url) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#14171a;font-size:14px;line-height:1.5">'
    + '<div style="background:#14171a;color:#c7f0db;padding:14px 18px;border-radius:12px 12px 0 0;font-weight:bold;font-size:16px">$ Mis Finanzas</div>'
    + '<div style="border:1px solid #e3e6e1;border-top:0;padding:16px 18px;border-radius:0 0 12px 12px"><h2 style="margin:0 0 6px;font-size:18px">' + esc_(title) + '</h2>' + body
    + '<p style="margin:20px 0 0"><a href="' + url + '" style="background:#1e6b52;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block">Abrir la app</a></p>'
    + '<p style="color:#999;font-size:12px;margin-top:16px">Cambia las horas o lo que incluye en Ajustes → Avisos y notificaciones.</p></div></div>';
}
function toMin_(hm) { const m = String(hm).match(/(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
function addDays_(d, k) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + k); return Utilities.formatDate(x, TZ, 'yyyy-MM-dd'); }
function addMonths_(d, k) { const x = new Date(d + 'T12:00:00'); x.setMonth(x.getMonth() + k); return Utilities.formatDate(x, TZ, 'yyyy-MM-dd'); }
function daysBetween_(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); }
const MESES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_ = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function fechaLarga_(d) { const x = new Date(d + 'T12:00:00'); return DIAS_[x.getDay()] + ' ' + x.getDate() + ' de ' + MESES_[x.getMonth()]; }
function fechaCorta_(d) { const x = new Date(d + 'T12:00:00'); return x.getDate() + ' ' + MESES_[x.getMonth()].slice(0, 3); }
function money_(n) { return (Math.round(n * 100) / 100).toFixed(2); }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
