/**
 * Aviso de versión nueva (1.7.2). SOLO AVISA: no descarga ni instala nada.
 *
 * Consulta, como mucho una vez cada 24 h, la última release del repositorio
 * público en GitHub (api.github.com, GET anónimo, sin enviar ningún dato del
 * usuario ni de sus consultas; solo la cabecera User-Agent con el nombre y la
 * versión del conector). El resultado se guarda en la caché del propio
 * conector (~/.cache/boe-consolidada-mcp/actualizacion.json).
 *
 * Se desactiva con cualquiera de estas dos opciones:
 *   - variable de entorno BOE_CONSOLIDADA_SIN_AVISO_ACTUALIZACION=1
 *   - creando el fichero vacío ~/.cache/boe-consolidada-mcp/sin-aviso-actualizacion
 *
 * Nunca lanza errores hacia fuera: si GitHub no responde, no hay aviso.
 */
'use strict';
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOST = 'api.github.com';
const RUTA = '/repos/jllfontan-bot/consulta-boletines-oficiales-mcp/releases/latest';
const URL_RELEASES = 'https://github.com/jllfontan-bot/consulta-boletines-oficiales-mcp/releases/latest';
const TTL_OK_MS = 24 * 3600 * 1000;
const TTL_ERROR_MS = 3600 * 1000; // si falla, no reintentar antes de 1 h
const TIMEOUT_MS = 4000;
const DIR_POR_DEFECTO = path.join(os.homedir(), '.cache', 'boe-consolidada-mcp');

/** "v1.7.2" / "1.7.2" → [1,7,2]; null si no es X.Y.Z. */
function partes(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** >0 si a>b, <0 si a<b, 0 si iguales; null si alguna no es válida. */
function compararVersiones(a, b) {
  const pa = partes(a), pb = partes(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function transporteHttps({ host, path: ruta, timeoutMs, ua }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, path: ruta, method: 'GET', headers: { Accept: 'application/vnd.github+json', 'User-Agent': ua }, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (body.length < 200000) body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('tiempo agotado')));
    req.on('error', reject);
    req.end();
  });
}

function desactivado(dir) {
  if (/^(1|true|si|sí|yes)$/i.test(process.env.BOE_CONSOLIDADA_SIN_AVISO_ACTUALIZACION || '')) return true;
  try { return fs.existsSync(path.join(dir, 'sin-aviso-actualizacion')); } catch (_) { return false; }
}

function leerCache(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'actualizacion.json'), 'utf8')); } catch (_) { return null; }
}
function guardarCache(dir, datos) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'actualizacion.json'), JSON.stringify(datos));
  } catch (_) { /* sin caché no pasa nada */ }
}

/**
 * Devuelve { ultima, url } si hay una versión más nueva que `versionActual`,
 * o null (sin versión nueva, desactivado o error). Opciones inyectables para
 * pruebas: transporte, dir, ahora.
 */
async function comprobar(versionActual, opts = {}) {
  const dir = opts.dir || DIR_POR_DEFECTO;
  const ahora = (opts.ahora || Date.now)();
  const transporte = opts.transporte || transporteHttps;
  try {
    if (desactivado(dir)) return null;
    let c = leerCache(dir);
    const vigente = c && typeof c.t === 'number' && ahora - c.t < (c.ok ? TTL_OK_MS : TTL_ERROR_MS) && ahora >= c.t;
    if (!vigente) {
      c = { t: ahora, ok: false, ultima: null };
      try {
        const r = await transporte({ host: HOST, path: RUTA, timeoutMs: TIMEOUT_MS, ua: `boe-consolidada-mcp/${versionActual}` });
        if (r.status === 200) {
          const tag = JSON.parse(r.body).tag_name;
          if (partes(tag)) c = { t: ahora, ok: true, ultima: String(tag).replace(/^v/, '') };
        }
      } catch (_) { /* queda ok:false */ }
      guardarCache(dir, c);
    }
    if (c.ok && compararVersiones(c.ultima, versionActual) > 0) return { ultima: c.ultima, url: URL_RELEASES };
  } catch (_) { /* nunca romper el servidor por esto */ }
  return null;
}

/** Texto para el usuario (en castellano). */
function textoAviso(versionActual, ultima, url) {
  return `Hay una versión nueva del conector (instalada: ${versionActual}; disponible: ${ultima}). Díselo al usuario UNA vez, con este enlace: ${url} ` +
    '(descarga el archivo .mcpb de la release y ábrelo con Claude Desktop; el conector no se actualiza solo). ' +
    'Para no recibir este aviso: variable BOE_CONSOLIDADA_SIN_AVISO_ACTUALIZACION=1 o crear el fichero vacío ~/.cache/boe-consolidada-mcp/sin-aviso-actualizacion.';
}

module.exports = { comprobar, compararVersiones, textoAviso, URL_RELEASES, HOST, RUTA };
