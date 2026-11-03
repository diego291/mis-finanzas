/**
 * Mis Finanzas · cargador del conector (v7)
 * ------------------------------------------------------------
 * Pega este archivo UNA sola vez en Apps Script. No hace falta volver a tocarlo:
 * cada vez que corre, descarga de tu GitHub (diego291/mis-finanzas, apps-script/nucleo.js)
 * la versión más reciente del conector y la ejecuta. Así las mejoras llegan solas.
 *
 * - Guarda una copia del núcleo en la hoja (Propiedades del script): si GitHub no responde,
 *   sigue funcionando con la última copia buena.
 * - Solo acepta código que tenga doPost y API_VERSION.
 *
 * Funciones para ejecutar desde el editor:
 *   activarTodo        → la primera vez: carga el núcleo, activa los avisos programados y te manda un correo.
 *   actualizarAhora    → toma ya la última versión de GitHub (si no, se renueva sola cada hora).
 *   configurar         → crea tu código de acceso (solo si es una hoja nueva).
 */
const MF_URL = 'https://raw.githubusercontent.com/diego291/mis-finanzas/main/apps-script/nucleo.js';
const MF_EXPORTS = ['doGet', 'doPost', 'configurar', 'repararFormulasMetas', 'activarAvisos', 'desactivarAvisos', 'revisarAvisos'];
const MF_CHUNK = 3000;
let MF_ = null, MF_SRC_ = '';

function doGet(e) { return mf_().doGet(e); }
function doPost(e) { return mf_().doPost(e); }
function revisarAvisos() { return mf_().revisarAvisos(); }
function configurar() { return mf_().configurar(); }
function repararFormulasMetas() { return mf_().repararFormulasMetas(); }
function activarAvisos() { return mf_().activarAvisos(); }
function desactivarAvisos() { return mf_().desactivarAvisos(); }

function activarTodo() {
  CacheService.getScriptCache().remove('MF_SRC_N'); MF_ = null;
  const m = mf_();
  m.activarAvisos();
  Logger.log('Listo. Conector v' + mfVersion_() + ' cargado desde GitHub. Desde ahora tu hoja toma sola cada mejora (revisa cada hora).');
}
function actualizarAhora() {
  CacheService.getScriptCache().remove('MF_SRC_N'); MF_ = null;
  mf_(); Logger.log('Conector v' + mfVersion_() + ' cargado.');
}

function mf_() {
  if (MF_) return MF_;
  const cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties();
  let src = cache.get('MF_SRC_N');
  if (!src) {
    try {
      const r = UrlFetchApp.fetch(MF_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
      if (r.getResponseCode() === 200 && mfValido_(r.getContentText())) { src = r.getContentText(); mfGuardar_(props, src); }
      else Logger.log('GitHub respondió ' + r.getResponseCode() + '; uso la copia guardada.');
    } catch (e) { Logger.log('No pude leer GitHub (' + e + '); uso la copia guardada.'); }
    if (!src) src = mfLeer_(props);
    if (!src) throw new Error('No pude descargar el conector desde GitHub y no hay una copia guardada. Revisa tu internet y vuelve a intentar.');
    try { cache.put('MF_SRC_N', src, 3600); } catch (e) { }
  }
  MF_SRC_ = src;
  MF_ = new Function(src + '\n;return {' + MF_EXPORTS.join(', ') + '};')();
  return MF_;
}
function mfVersion_() { return (MF_SRC_.match(/const API_VERSION = (\d+);/) || [])[1] || '?'; }
function mfValido_(s) { return /function doPost\(/.test(s) && /const API_VERSION = \d+;/.test(s) && s.length > 8000; }
function mfGuardar_(props, s) {
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8));
  if (props.getProperty('MF_HASH') === hash) return;
  const n = Math.ceil(s.length / MF_CHUNK), o = { MF_N: String(n), MF_HASH: hash };
  for (let i = 0; i < n; i++) o['MF_' + i] = s.slice(i * MF_CHUNK, (i + 1) * MF_CHUNK);
  props.setProperties(o);
}
function mfLeer_(props) {
  const n = Number(props.getProperty('MF_N') || 0); if (!n) return '';
  let s = ''; for (let i = 0; i < n; i++) s += props.getProperty('MF_' + i) || '';
  return mfValido_(s) ? s : '';
}
