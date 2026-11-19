/**
 * boe-consolidada — NÚCLEO de negocio (sin transporte MCP, sin efectos al hacer require).
 *
 * Lo comparten la extensión MCP (server/index.js) y, más adelante, la app de
 * escritorio. Para legislación española consolidada.
 *
 * Fuente principal: https://www.boe.es/datosabiertos/api/legislacion-consolidada
 * (estatal y, en la medida en que el BOE la recoge, autonómica).
 *
 * Fuentes autonómicas propias, añadidas solo cuando la comunidad ofrece una
 * API real con licencia de reutilización explícita (mismo listón que el BOE):
 *   - País Vasco: https://api.euskadi.eus/bopv (Open Data Euskadi, CC BY 4.0).
 * El resto de comunidades no tienen API consultable, solo portal web — ver
 * docs/estudio-legislacion-autonomica.md. No añadir ninguna sin repetir esta
 * comprobación (API real + licencia), ni por scraping HTML.
 *
 * Solo estas URLs fijas. Ninguna se construye a partir de entrada del usuario.
 * Sin dependencias externas.
 *
 * Fase 1: buscar normas, ficha, índice, texto de artículo, análisis.
 * Fase 2: resolver referencias ("art. 56 ET") y verificar citas de un escrito.
 * Fase 3: normativa del País Vasco vía Open Data Euskadi.
 * Fase 4 (1.6.0): BORME (actos y anuncios del Registro Mercantil, mismo host www.boe.es).
 */

'use strict';

const https = require('node:https');
const tls = require('node:tls');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const BASE_HOST = 'www.boe.es';
const BASE_PATH = '/datosabiertos/api/legislacion-consolidada';
const EUSKADI_HOST = 'api.euskadi.eus';
// Oficina de Publicaciones de la UE (CELLAR, base de EUR-Lex), desde la 1.7.0.
const UE_HOST = 'publications.europa.eu';

/*
 * api.euskadi.eus presenta su cadena de certificados firmada por IZENPE S.A.
 * (la autoridad certificadora del Gobierno Vasco). La CA raíz de IZENPE es
 * válida y está en el llavero de macOS, pero Node.js no la incluye en su
 * lista de CAs de confianza integrada (curl/openssl del sistema sí la
 * validan; Node falla con "self signed certificate in certificate chain").
 * Comprobado en vivo el 14/08/2026 con `openssl s_client -showcerts`.
 * Se añaden aquí la intermedia y la raíz para que Node pueda verificar la
 * cadena completa, sin desactivar la verificación TLS (rejectUnauthorized
 * sigue en true; solo se amplía la lista de CAs de confianza para este host).
 */
const EUSKADI_CA_INTERMEDIA = `-----BEGIN CERTIFICATE-----
MIIHNzCCBSGgAwIBAgIQJMXIqlZvjuhMvqcFXOFkpDALBgkqhkiG9w0BAQswODEL
MAkGA1UEBhMCRVMxFDASBgNVBAoMC0laRU5QRSBTLkEuMRMwEQYDVQQDDApJemVu
cGUuY29tMB4XDTEwMTAyMDA4MjMzM1oXDTM3MTIxMjIzMDAwMFowgZ0xCzAJBgNV
BAYTAkVTMRQwEgYDVQQKDAtJWkVOUEUgUy5BLjE6MDgGA1UECwwxQVpaIFppdXJ0
YWdpcmkgcHVibGlrb2EgLSBDZXJ0aWZpY2FkbyBwdWJsaWNvIFNDQTE8MDoGA1UE
AwwzRUFFa28gSGVycmkgQWRtaW5pc3RyYXppb2VuIENBIC0gQ0EgQUFQUCBWYXNj
YXMgKDIpMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAoIM7nEdI0N1h
rR5T4xuV/usKDoMIasaiKvfLhbwxaNtTt+a7W/6wV5bv3svQFIy3sUXjjdzV1nG2
To2wo/YSPQiOt8exWvOapvL21ogiof+kelWnXFjWaKJI/vThHYLgIYEMj/y4HdtU
ojI646rZwqsb4YGAopwgmkDfUh5jOhV2IcYE3TgJAYWVkj6jku9PLaIsHiarAHjD
PY8dig8a4SRv0gm5Yk7FXLmW1d14oxQBDeHZ7zOEXfpafxdEDO2SNaRJjpkh8XRr
PGqkg2y1Q3gT6b4537jz+StyDIJ3omylmlJsGCwqT7p8mEqjGJ5kC5I2VnjXKuNn
soShc72khWZVUJiJo5SGuAkNE2ZXqltBVm5Jv6QweQKsX6bkcMc4IZok4a+hx8FM
8IBpGf/I94pU6HzGXqCyc1d46drJgDY9mXa+6YDAJFl3xeXOOW2iGCfwXqhiCrKL
MYvyMZzqF3QH5q4nb3ZnehYvraeMFXJXDn+Utqp8vd2r7ShfQJz01KtM4hgKdgSg
jtW+shkVVN5ng/fPN85ovfAH2BHXFfHmQn4zKsYnLitpwYM/7S1HxlT61cdQ7Nnk
3LZTYEgAoOmEmdheklT40WAYakksXGM5VrzG7x9S7s1Tm+Vb5LSThdHC8bxxwyTb
KsDRDNJ84N9fPDO6qHnzaL2upQ43PycCAwEAAaOCAdkwggHVMIHHBgNVHREEgb8w
gbyGFWh0dHA6Ly93d3cuaXplbnBlLmNvbYEPaW5mb0BpemVucGUuY29tpIGRMIGO
MUcwRQYDVQQKDD5JWkVOUEUgUy5BLiAtIENJRiBBMDEzMzcyNjAtUk1lcmMuVml0
b3JpYS1HYXN0ZWl6IFQxMDU1IEY2MiBTODFDMEEGA1UECQw6QXZkYSBkZWwgTWVk
aXRlcnJhbmVvIEV0b3JiaWRlYSAxNCAtIDAxMDEwIFZpdG9yaWEtR2FzdGVpejAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAdBgNVHQ4EFgQUwKlK90cl
h/+8taaJzoLSRqiJ66MwHwYDVR0jBBgwFoAUHRxlDqjyJXu0kc/ksbHmvVV0bAUw
OgYDVR0gBDMwMTAvBgRVHSAAMCcwJQYIKwYBBQUHAgEWGWh0dHA6Ly93d3cuaXpl
bnBlLmNvbS9jcHMwNwYIKwYBBQUHAQEEKzApMCcGCCsGAQUFBzABhhtodHRwOi8v
b2NzcC5pemVucGUuY29tOjgwOTQwMwYDVR0fBCwwKjAooCagJIYiaHR0cDovL2Ny
bC5pemVucGUuY29tL2NnaS1iaW4vYXJsMjALBgkqhkiG9w0BAQsDggIBAMbjc3HM
3DG9ubWPkzsF0QsktukpujbTTcGk4h20G7SPRy1DiiTxrRzdAMWGjZioOP3/fKCS
M539qH0M+gsySNie+iKlbSZJUyE635T1tKw+G7bDUapjlH1xyv55NC5I6wCXGC6E
3TEP5B/E7dZD0s9E4lS511ubVZivFgOzMYo1DO96diny/N/V1enaTCpRl1qH1OyL
xUYTijV4ph2gL6exwuG7pxfRcVNHYlrRaXWfTz3F6NBKyULxrI3P/y6JAtN1GqT4
VF/+vMygx22n0DufGepBwTQz6/rr1ulSZ+eMnuJiTXgh/BzQnkUsXTb8mHII25iR
0oYF2qAsk6ecWbLiDpkHKIDHmML21MZE13MS8NSvTHoqJO4LyAmDe6SaeNHtrPlK
b6mzE1BN2ug+ZaX8wLA5IMPFaf0jKhb/Cxu8INsxjt00brsErCc9ip1VNaH0M4bi
1tGxfiew2436FaeyUxW7Pl6G5GgkNbuUc7QIoRy06DdU/U38BxW3uyJMY60zwHvS
FlKAn0OvYp4niKhAJwaBVN3kowmJuOU5Rid+TUnfyxbJ9cttSgzaF3hP/N4zgMEM
5tikXUskeckt8LUK96EH0QyssavAMECUEb/xrupyRdYWwjQGvNLq6T5+fViDGyOw
k+lzD44wofy8paAy9uC9Owae0zMEzhcsyRm7
-----END CERTIFICATE-----`;

const EUSKADI_CA_RAIZ = `-----BEGIN CERTIFICATE-----
MIIF8TCCA9mgAwIBAgIQALC3WhZIX7/hy/WL1xnmfTANBgkqhkiG9w0BAQsFADA4
MQswCQYDVQQGEwJFUzEUMBIGA1UECgwLSVpFTlBFIFMuQS4xEzARBgNVBAMMCkl6
ZW5wZS5jb20wHhcNMDcxMjEzMTMwODI4WhcNMzcxMjEzMDgyNzI1WjA4MQswCQYD
VQQGEwJFUzEUMBIGA1UECgwLSVpFTlBFIFMuQS4xEzARBgNVBAMMCkl6ZW5wZS5j
b20wggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQDJ03rKDx6sp4boFmVq
scIbRTJxldn+EFvMr+eleQGPicPK8lVx93e+d5TzcqQsRNiekpsUOqHnJJAKClaO
xdgmlOHZSOEtPtoKct2jmRXagaKH9HtuJneJWK3W6wyyQXpzbm3benhB6QiIEn6H
LmYRY2xU+zydcsC8Lv/Ct90NduM61/e0aL6i9eOBbsFGb12N4E3GVFWJGjMxCrFX
uaOKmMPsOzTFlUFpfnXCPCDFYbpRR6AgkJOhkEvzTnyFRVSa0QUmQbC1TR0zvsQD
yCV8wXDbO/QJLVQnSKwv4cSsPsjLkkxTOTcj7NMB+eAJRE1NZMDhDVqHIrytG6P+
JrUV86f8hBnp7KGItERphIPzidF0BqnMC9bC3ieFUCbKF7jJeodWLBoBHmy+E60Q
rLUk9TiRodZL2vG70t5HtfG8gfZZa88ZU+mNFctKy6lvROUbQc/hhqfK0GqfvEyN
BjNaooXlkDWgYlwWTvDjovoDGrQscbNYLN57C9saD+veIR8GdwYDsMnvmfzAuU8L
hij+0rnq49qlw0dpEuDb8PYZi+17cNcC1u2HGCgsBCRMd+RIihrGO5rUD8r6ddIB
QFqNeb+Lz0vPqhbBleStTIo+F5HUsWLlguWABKQDfo2/2n+iD5dPDNMN+9fR5XJ+
HMh3/1uaD7euBUbl8agW7EekFwIDAQABo4H2MIHzMIGwBgNVHREEgagwgaWBD2lu
Zm9AaXplbnBlLmNvbaSBkTCBjjFHMEUGA1UECgw+SVpFTlBFIFMuQS4gLSBDSUYg
QTAxMzM3MjYwLVJNZXJjLlZpdG9yaWEtR2FzdGVpeiBUMTA1NSBGNjIgUzgxQzBB
BgNVBAkMOkF2ZGEgZGVsIE1lZGl0ZXJyYW5lbyBFdG9yYmlkZWEgMTQgLSAwMTAx
MCBWaXRvcmlhLUdhc3RlaXowDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMC
AQYwHQYDVR0OBBYEFB0cZQ6o8iV7tJHP5LGx5r1VdGwFMA0GCSqGSIb3DQEBCwUA
A4ICAQB4pgwWSp9MiDrAyw6lFn2fuUhfGI8NYjb2zRlrrKvV9pF9rnHzP7MOeIWb
laQnIUdCSnxIOvVFfLMMjlF4rJUT3sb9fbgakEyrkgPH7UIBzg/YsfqikuFgba56
awmqxinuaElnMIAkejEWOVt+8Rwu3WwJrfIxwYJOubv5vr8qhT/AQKM6WfxZSzwo
JNu0FXWuDYi6LnPAvViH5ULy617uHjAimcs30cQhbIHsvm0m5hzkQiCeR7Csg1lw
LDXWrzY0tM07+DKo7+N4ifuNRSzanLh+QBxh5z6ikixL8s36mLYp//Pye6kfLqCT
VyvehQP5aTfLnnhqBbTFMXiJ7HqnheG5ezzevh55hM6fcA5ZwjUukCox2eRFekGk
LhObNA5me0mrZJfQRsN5nXJQY6aYWwa9SG3YOYNw6DXwBdGqvOPbyALqfP2C2sJb
UjWumDqtujWTI6cfSN01RpiyEGjkpTHCClguGYEQyVB1/OpaFs4R1+7vUIgtYf8/
QnMFlEPVjjxOAToZpR9GTnfQXeWBIiGH/pR9hNiTrdZoQ0iy2+tzJOeRf1SktoA+
naM8THLCV8Sg1Mw4J87VBp6iSNnpn86CcDaTmjvfliHjWbcM2pE38P1ZWrOZyGls
QyYBNWNgVYkDOnXYukrZVP/u3oDYLdE41V4tC5h9Pmzb/CaIxw==
-----END CERTIFICATE-----`;

const EUSKADI_CA_LIST = [...tls.rootCertificates, EUSKADI_CA_INTERMEDIA, EUSKADI_CA_RAIZ];
const UA = 'boe-consolidada-mcp/1.0 (uso particular; API datos abiertos BOE)';

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

const log = (...a) => process.stderr.write(a.join(' ') + '\n');

/*
 * Caché de dos niveles:
 *  - memoria (Map): vive lo que dura el proceso, evita repetir una llamada
 *    dentro de la misma petición (p.ej. índice + bloque de la misma norma).
 *  - disco (~/.cache/boe-consolidada-mcp): sobrevive a que Claude Desktop
 *    reinicie el servidor MCP entre conversaciones. Es la que evita volver
 *    a bajar una norma ya consultada antes. Cada tipo de dato tiene su
 *    propio TTL: el texto consolidado casi no cambia (7 días), la ficha de
 *    vigencia/derogación se revisa más a menudo (1 día), y la búsqueda,
 *    que puede tener normas nuevas cada día, se refresca cada pocas horas.
 */
const cache = new Map();
const MEM_TTL_MS = 15 * 60 * 1000;
const FICHA_TTL_MS = 24 * 60 * 60 * 1000;
const ANALISIS_TTL_MS = 24 * 60 * 60 * 1000;
const BUSQUEDA_TTL_MS = 6 * 60 * 60 * 1000;
const TEXTO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > MEM_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.v;
}

function cacheSet(key, v) {
  if (cache.size > 300) cache.clear();
  cache.set(key, { t: Date.now(), v });
}

const CACHE_DIR_POR_DEFECTO = path.join(os.homedir(), '.cache', 'boe-consolidada-mcp');
let CACHE_DIR = CACHE_DIR_POR_DEFECTO;
let discoDisponible = true;

function rutaDisco(key) {
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return path.join(CACHE_DIR, `${hash}.json`);
}

function cacheDiskGet(key, ttlMs) {
  if (!discoDisponible) return null;
  try {
    const ruta = rutaDisco(key);
    const stat = fs.statSync(ruta);
    if (Date.now() - stat.mtimeMs > ttlMs) return null;
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch (_) {
    return null;
  }
}

function cacheDiskSet(key, v) {
  if (!discoDisponible) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(rutaDisco(key), JSON.stringify(v));
  } catch (e) {
    discoDisponible = false;
    log(`[aviso] caché en disco no disponible, se sigue sin ella: ${e.message}`);
  }
}

/** Normaliza: minúsculas, sin acentos, espacios colapsados. */
function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// B11: `.toISOString()` da SIEMPRE la fecha en UTC -- entre medianoche y la
// 1 (invierno, CET) o las 2 (verano, CEST) en España, UTC todavía va por el
// día ANTERIOR. Como "hoy" decide qué redacción de un artículo está vigente
// (`versionVigente`) y desde cuándo (`AUN_NO_VIGENTE`, B6), esa hora y media
// o dos podía hacer que una redacción que ya entró en vigor en España se
// tratase todavía como si no lo hubiese hecho, o al revés. Mismo patrón que
// `FMT_FECHA_MADRID`/`fechaEuskadiISO` (Intl con timeZone real), no un cálculo
// manual de offset (los offsets de España cambian dos veces al año).
const FMT_HOY_MADRID = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' });

function hoyISO() {
  return FMT_HOY_MADRID.format(new Date());
}

function fmtFecha(f) {
  if (!f || !/^\d{8}$/.test(f)) return f || null;
  return `${f.slice(6, 8)}/${f.slice(4, 6)}/${f.slice(0, 4)}`;
}

/* ------------------------------------------------------------------ */
/* Cliente HTTP (solo boe.es, solo GET)                                */
/* ------------------------------------------------------------------ */

// Hallazgo de gravedad baja (revisión 21/09/2026): una redirección a OTRO
// dominio se seguía IGUAL, contra el dominio ORIXINAL (`host` nunca se
// actualizaba, solo se quedaba con el `pathname` nuevo) -- si
// boe.es/api.euskadi.eus alguna vez redirigiese fuera, esto reenviaba la
// petición al mismo host de siempre con una ruta ajena, en vez de seguir la
// redirección de verdad o, mejor aún dada la regla 2 (solo hosts fijos,
// nunca de fuera), rechazarla. Ahora se resuelve la URL completa y solo se
// sigue si el host coincide con el actual; a otro host, se rechaza con un
// error explícito.
function resolverRedireccion(location, host, path) {
  let destino;
  try {
    destino = new URL(location, `https://${host}${path}`);
  } catch (e) {
    throw new Error(`redirección con Location inválida: ${location}`);
  }
  if (destino.hostname !== host) {
    throw new Error(`redirección de ${host} a un host distinto (${destino.hostname}), rechazada -- solo se siguen redirecciones dentro del mismo host de confianza`);
  }
  return destino.pathname + (destino.search || '');
}

/*
 * Transporte HTTP inyectable. Recibe SIEMPRE un host de la lista fija
 * (BASE_HOST / EUSKADI_HOST / UE_HOST); nunca se construye desde la entrada del usuario.
 * Devuelve { status, headers, body }. Por defecto usa node:https; la app de
 * escritorio puede sustituirlo (p. ej. por el cliente `net` de Electron, que
 * respeta el proxy de Windows) con configurar({ transporte }).
 */
function transporteHttps({ host, path: ruta, accept, ca, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        path: ruta,
        method: 'GET',
        headers: { Accept: accept, 'User-Agent': UA },
        timeout: timeoutMs,
        // La verificación TLS sigue activa (rejectUnauthorized por defecto es
        // true); para Euskadi solo se amplía la lista de CAs de confianza con
        // la CA de IZENPE, que Node no trae integrada — ver nota junto a
        // EUSKADI_CA_LIST más arriba.
        ...(ca ? { ca } : {}),
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('timeout', () => { req.destroy(new Error(`timeout tras ${Math.round(timeoutMs / 1000)} s`)); });
    req.on('error', reject);
    req.end();
  });
}

let transporteHttp = transporteHttps;

/**
 * Ajustes inyectables. Todos opcionales; sin llamar a esta función el núcleo
 * se comporta exactamente como la extensión MCP.
 *   cacheDir:   carpeta de la caché en disco (defecto ~/.cache/boe-consolidada-mcp)
 *   transporte: async ({host, path, accept, ca, timeoutMs}) => {status, headers, body}
 */
function configurar(opciones = {}) {
  if (opciones.cacheDir !== undefined) {
    CACHE_DIR = opciones.cacheDir || CACHE_DIR_POR_DEFECTO;
    discoDisponible = true;
  }
  if (opciones.transporte !== undefined) {
    transporteHttp = opciones.transporte || transporteHttps;
  }
}

async function httpGet(path, accept, redirects = 0, host = BASE_HOST, timeoutMs = 30000) {
  if (host !== BASE_HOST && host !== EUSKADI_HOST && host !== UE_HOST) throw new Error(`host no permitido: ${host}`);
  const res = await transporteHttp({
    host,
    path,
    accept,
    ca: host === EUSKADI_HOST ? EUSKADI_CA_LIST : undefined,
    timeoutMs,
  });
  const location = res.headers && res.headers.location;
  // 303: CELLAR (UE) responde así a la negociación de contenido; todo es GET, así que se sigue igual.
  if ([301, 302, 303, 307, 308].includes(res.status) && location && redirects < 5) {
    return httpGet(resolverRedireccion(location, host, path), accept, redirects + 1, host, timeoutMs);
  }
  return { status: res.status, body: res.body };
}

async function apiJSON(reqPath, ttlMsDisco = 0, host = BASE_HOST) {
  const key = 'J' + host + reqPath;
  const mem = cacheGet(key);
  if (mem) return mem;
  if (ttlMsDisco > 0) {
    const disco = cacheDiskGet(key, ttlMsDisco);
    if (disco) {
      cacheSet(key, disco);
      return disco;
    }
  }
  const { status, body } = await httpGet(reqPath, 'application/json', 0, host);
  if (status === 404) throw new ApiError(404, 'La norma o el bloque no existe en la colección consolidada.');
  if (status >= 400) throw new ApiError(status, `${host} respondió ${status}. ${body.slice(0, 300)}`);
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new ApiError(502, `${host} no devolvió JSON válido.`);
  }
  cacheSet(key, data);
  if (ttlMsDisco > 0) cacheDiskSet(key, data);
  return data;
}

async function apiXML(reqPath) {
  const key = 'X' + reqPath;
  const hit = cacheGet(key);
  if (hit) return hit;
  const { status, body } = await httpGet(reqPath, 'application/xml');
  if (status === 404) throw new ApiError(404, 'La norma o el bloque no existe en la colección consolidada.');
  if (status >= 400) throw new ApiError(status, `El BOE respondió ${status}.`);
  cacheSet(key, body);
  return body;
}

class ApiError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* XML mínimo: solo lo necesario para /texto y /texto/bloque           */
/* ------------------------------------------------------------------ */

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü',
  laquo: '«', raquo: '»', ordm: 'º', ordf: 'ª', deg: '°',
  mdash: '—', ndash: '–', hellip: '…', euro: '€',
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENTIDADES[n] !== undefined ? ENTIDADES[n] : m));
}

/** Convierte un fragmento HTML/XML del BOE en texto plano legible. */
function xmlATexto(frag) {
  return decodeEntities(
    String(frag)
      .replace(/<img[^>]*>/gi, '[imagen]')
      .replace(/<\/(p|tr|div|blockquote|table)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '\t')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function atributos(tag) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) out[m[1]] = decodeEntities(m[2]);
  return out;
}

/**
 * Extrae las <version> de un <bloque>. Devuelve [{atributos, texto}] en orden.
 */
function extraerVersiones(xml) {
  const versiones = [];
  const re = /<version\b([^>]*)>([\s\S]*?)<\/version>/gi;
  let m;
  while ((m = re.exec(xml))) {
    versiones.push({ meta: atributos(m[1]), texto: xmlATexto(m[2]) });
  }
  return versiones;
}

/**
 * Extrae los <bloque> de un documento /texto completo (norma entera, no un
 * único bloque). Devuelve [{id, titulo, versiones}], reutilizando
 * extraerVersiones sobre el contenido de cada bloque.
 */
function extraerBloques(xml) {
  const bloques = [];
  const re = /<bloque\s+([^>]*)>([\s\S]*?)<\/bloque>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = atributos(m[1]);
    bloques.push({ id: attrs.id, titulo: attrs.titulo || '', versiones: extraerVersiones(m[2]) });
  }
  return bloques;
}

/** Devuelve la versión vigente hoy (última con fecha_vigencia <= hoy), o la última. */
function versionVigente(versiones) {
  if (!versiones.length) return null;
  // B11: hora de Madrid, non UTC -- ver `hoyISO`.
  const hoy = FMT_HOY_MADRID.format(new Date()).replace(/-/g, '');
  const aplicables = versiones.filter((v) => !v.meta.fecha_vigencia || v.meta.fecha_vigencia <= hoy);
  if (aplicables.length) return aplicables[aplicables.length - 1];
  // B6: ningunha versión está aínda vixente (todas as `fecha_vigencia` son
  // futuras) -- devólvese a máis recente coma referencia (é o único texto
  // dispoñible), pero marcada con `_aunNoVigente` para que quen chame poida
  // avisar en vez de devolver "OK" coma se xa estivese en vigor hoxe (caso
  // real: unha redacción con `fecha_vigencia` 2027-01-02 dábase coma
  // vixente o 2026-09-22, cinco meses antes de entrar en vigor).
  const ultima = versiones[versiones.length - 1];
  return ultima ? { ...ultima, _aunNoVigente: true } : null;
}

/* ------------------------------------------------------------------ */
/* Atajos de normas frecuentes                                         */
/* ------------------------------------------------------------------ */
/*
 * IMPORTANTE: esto es solo un ATAJO. Todo identificador se comprueba contra
 * el BOE antes de usarse, y siempre se devuelve el título oficial recibido
 * para que se pueda ver si el atajo acertó. Si un id falla, se cae a búsqueda
 * por título. Use la herramienta boe_comprobar_atajos para auditar la tabla.
 */
const ATAJOS = [
  { id: 'BOE-A-1978-31229', siglas: ['ce'], nombres: ['constitucion espanola', 'constitucion'] },
  { id: 'BOE-A-1889-4763', siglas: ['cc'], nombres: ['codigo civil'] },
  { id: 'BOE-A-1995-25444', siglas: ['cp'], nombres: ['codigo penal'] },
  { id: 'BOE-A-1885-6627', siglas: ['ccom'], nombres: ['codigo de comercio'] },
  { id: 'BOE-A-2000-323', siglas: ['lec'], nombres: ['ley de enjuiciamiento civil'] },
  { id: 'BOE-A-1882-6036', siglas: ['lecrim'], nombres: ['ley de enjuiciamiento criminal'] },
  { id: 'BOE-A-1998-16718', siglas: ['ljca'], nombres: ['ley de la jurisdiccion contencioso-administrativa', 'jurisdiccion contenciosa'] },
  { id: 'BOE-A-2011-15936', siglas: ['ljs', 'lrjs'], nombres: ['ley reguladora de la jurisdiccion social'] },
  { id: 'BOE-A-2015-11430', siglas: ['et'], nombres: ['estatuto de los trabajadores'] },
  { id: 'BOE-A-2015-11724', siglas: ['lgss'], nombres: ['ley general de la seguridad social'] },
  { id: 'BOE-A-2015-10565', siglas: ['lpac', 'lpacap'], nombres: ['ley del procedimiento administrativo comun'] },
  { id: 'BOE-A-2015-10566', siglas: ['lrjsp'], nombres: ['ley de regimen juridico del sector publico'] },
  { id: 'BOE-A-1985-12666', siglas: ['lopj'], nombres: ['ley organica del poder judicial'] },
  { id: 'BOE-A-2003-23186', siglas: ['lgt'], nombres: ['ley general tributaria'] },
  { id: 'BOE-A-2006-20764', siglas: ['lirpf'], nombres: ['ley del irpf', 'impuesto sobre la renta de las personas fisicas'] },
  { id: 'BOE-A-1992-28740', siglas: ['liva'], nombres: ['ley del iva', 'impuesto sobre el valor anadido'] },
  { id: 'BOE-A-1994-26003', siglas: ['lau'], nombres: ['ley de arrendamientos urbanos'] },
  { id: 'BOE-A-1946-2453', siglas: ['lh'], nombres: ['ley hipotecaria'] },
  { id: 'BOE-A-2010-10544', siglas: ['lsc'], nombres: ['ley de sociedades de capital'] },
  { id: 'BOE-A-2020-4859', siglas: ['trlc'], nombres: ['texto refundido de la ley concursal', 'ley concursal'] },
  { id: 'BOE-A-2018-16673', siglas: ['lopdgdd'], nombres: ['proteccion de datos personales y garantia de los derechos digitales'] },
  { id: 'BOE-A-2007-20555', siglas: ['trlgdcu'], nombres: ['defensa de los consumidores y usuarios'] },
  { id: 'BOE-A-2015-11719', siglas: ['trebep', 'ebep'], nombres: ['estatuto basico del empleado publico'] },
  { id: 'BOE-A-2017-12902', siglas: ['lcsp'], nombres: ['ley de contratos del sector publico'] },
  { id: 'BOE-A-1980-22501', siglas: ['lcs'], nombres: ['ley de contrato de seguro'] },
  { id: 'BOE-A-2004-21760', siglas: [], nombres: ['proteccion integral contra la violencia de genero'] },
  { id: 'BOE-A-1979-23709', siglas: ['lotc'], nombres: ['ley organica del tribunal constitucional'] },
];

function buscarAtajo(hint) {
  const h = norm(hint);
  if (!h) return null;
  let mejor = null;
  for (const a of ATAJOS) {
    for (const n of a.nombres) {
      if (h.includes(n) && (!mejor || n.length > mejor.len)) mejor = { id: a.id, len: n.length, via: n };
    }
    for (const s of a.siglas) {
      const re = new RegExp(`(^|[^a-z0-9])${s}([^a-z0-9]|$)`, 'i');
      if (re.test(h) && (!mejor || s.length > mejor.len)) mejor = { id: a.id, len: s.length, via: s };
    }
  }
  return mejor;
}

/* ------------------------------------------------------------------ */
/* Envoltorio de la API del BOE                                        */
/* ------------------------------------------------------------------ */

function escLucene(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// B8: un `articulo` con caracteres especiales de regex ("24.2", con un "(" o
// "["...) se metía tal cual dentro de un `new RegExp(...)` -- el punto de
// "24.2" es "cualquier carácter" en regex (a veces daba falso positivo, otras
// no encontraba nada si el texto real no tenía justo un carácter ahí), y un
// paréntesis sin cerrar directamente TIRABA la consulta con SyntaxError.
function escRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Código de departamento emisor por comunidad autónoma (datos-auxiliares/departamentos
// del BOE). Baleares y la Comunidad Valenciana tienen dos códigos porque cambiaron de
// denominación oficial; se incluyen ambos para que la comunidad se cubra entera.
const COMUNIDADES_AUTONOMAS = {
  andalucia: [8010],
  aragon: [8020],
  asturias: [8150],
  baleares: [8120, 8121],
  canarias: [8030],
  cantabria: [8040],
  castilla_la_mancha: [8060],
  castilla_y_leon: [9531],
  cataluna: [8070],
  comunidad_valenciana: [8161, 8162],
  extremadura: [8080],
  galicia: [8090],
  la_rioja: [8110],
  madrid: [8131],
  murcia: [8100],
  navarra: [8170],
  pais_vasco: [8140],
};

async function buscarNormas(p) {
  const cond = [];
  if (p.texto) cond.push(`texto:"${escLucene(p.texto)}"`);
  if (p.titulo) cond.push(`titulo:"${escLucene(p.titulo)}"`);
  if (p.numero_oficial) cond.push(`numero_oficial:"${escLucene(p.numero_oficial)}"`);
  if (p.rango_codigo) cond.push(`rango@codigo:${Number(p.rango_codigo)}`);
  if (p.materia_codigo) cond.push(`materia@codigo:${Number(p.materia_codigo)}`);
  if (p.ambito_codigo) cond.push(`ambito@codigo:${Number(p.ambito_codigo)}`);
  if (p.departamento_codigo) cond.push(`departamento@codigo:${Number(p.departamento_codigo)}`);
  if (Array.isArray(p.comunidades) && p.comunidades.length) {
    const codigos = [...new Set(p.comunidades.flatMap((c) => COMUNIDADES_AUTONOMAS[c] || []))];
    if (codigos.length) cond.push(`(${codigos.map((c) => `departamento@codigo:${c}`).join(' or ')})`);
  }
  if (p.solo_vigentes) cond.push('vigencia_agotada:N');

  const q = { query: {} };
  if (cond.length) q.query.query_string = { query: cond.join(' and ') };
  if (p.publicada_desde || p.publicada_hasta) {
    const r = {};
    if (p.publicada_desde) r.gte = String(p.publicada_desde).replace(/-/g, '');
    if (p.publicada_hasta) r.lte = String(p.publicada_hasta).replace(/-/g, '');
    q.query.range = { fecha_publicacion: r };
  }
  q.sort = [{ fecha_publicacion: 'desc' }];

  const limite = Math.min(Math.max(Number(p.limite) || 10, 1), 50);
  let path = `${BASE_PATH}?limit=${limite}`;
  if (p.offset) path += `&offset=${Number(p.offset)}`;
  if (Object.keys(q.query).length || p.publicada_desde) {
    path += `&query=${encodeURIComponent(JSON.stringify(q))}`;
  }

  const data = await apiJSON(path, BUSQUEDA_TTL_MS);
  const items = Array.isArray(data.data) ? data.data : [];
  return items.map((n) => ({
    id: n.identificador,
    titulo: n.titulo,
    rango: n.rango && n.rango.texto,
    numero_oficial: n.numero_oficial || null,
    fecha_publicacion: fmtFecha(n.fecha_publicacion),
    vigencia_agotada: n.vigencia_agotada === 'S',
    eli: n.url_eli || null,
    url: n.url_html_consolidada,
  }));
}

async function fichaNorma(id) {
  const d = await apiJSON(`${BASE_PATH}/id/${encodeURIComponent(id)}/metadatos`, FICHA_TTL_MS);
  const m = (Array.isArray(d.data) ? d.data[0] : d.data) || {};
  return {
    id: m.identificador || id,
    titulo: m.titulo,
    rango: m.rango && m.rango.texto,
    departamento: m.departamento && m.departamento.texto,
    numero_oficial: m.numero_oficial || null,
    fecha_disposicion: fmtFecha(m.fecha_disposicion),
    fecha_publicacion: fmtFecha(m.fecha_publicacion),
    fecha_vigencia: fmtFecha(m.fecha_vigencia),
    derogada: m.estatus_derogacion === 'S',
    fecha_derogacion: fmtFecha(m.fecha_derogacion),
    anulada: m.estatus_anulacion === 'S',
    vigencia_agotada: m.vigencia_agotada === 'S',
    estado_consolidacion: m.estado_consolidacion && m.estado_consolidacion.texto,
    eli: m.url_eli || null,
    url: m.url_html_consolidada,
  };
}

/**
 * Descarga y parsea la norma COMPLETA (todos sus bloques) de una sola vez, en
 * vez de un índice + un bloque por cada artículo. Se cachea en disco por
 * TEXTO_TTL_MS: la primera consulta a un código paga el coste completo, pero
 * cualquier otro artículo de esa misma norma —en esta conversación o en
 * cualquier otra, incluso tras reiniciar Claude Desktop— sale del caché sin
 * red. `indiceNorma` y `textoBloque` comparten este resultado.
 */
async function textoCompletoNorma(id) {
  const key = 'B' + id;
  const mem = cacheGet(key);
  if (mem) return mem;
  const disco = cacheDiskGet(key, TEXTO_TTL_MS);
  if (disco) {
    cacheSet(key, disco);
    return disco;
  }
  const xml = await apiXML(`${BASE_PATH}/id/${encodeURIComponent(id)}/texto`);
  const bloques = extraerBloques(xml);
  cacheSet(key, bloques);
  cacheDiskSet(key, bloques);
  return bloques;
}

async function indiceNorma(id) {
  const bloques = await textoCompletoNorma(id);
  return bloques.map((b) => {
    const ultima = b.versiones[b.versiones.length - 1];
    return {
      bloque: b.id,
      titulo: b.titulo,
      actualizado: ultima ? fmtFecha(ultima.meta.fecha_publicacion) : null,
    };
  });
}

async function textoBloque(id, bloque) {
  const bloques = await textoCompletoNorma(id);
  const b = bloques.find((x) => x.id === bloque);
  if (!b) return null;
  const v = versionVigente(b.versiones);
  if (!v) return null;
  return {
    texto: v.texto,
    version_desde: fmtFecha(v.meta.fecha_vigencia),
    introducida_por: v.meta.id_norma || null,
    versiones_totales: b.versiones.length,
    aun_no_vigente: v._aunNoVigente === true,
  };
}

async function analisisNorma(id) {
  const d = await apiJSON(`${BASE_PATH}/id/${encodeURIComponent(id)}/analisis`, ANALISIS_TTL_MS);
  const raiz = (Array.isArray(d.data) ? d.data[0] : d.data) || {};
  const a = raiz.analisis || raiz;
  const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  // referencias.{anteriores,posteriores} y materias vienen como array de contenedores
  // de un solo elemento (p.ej. [{ anterior: [...] }]), no como el objeto directo.
  const desanidar = (contenedor, clave) => arr(contenedor).flatMap((c) => arr(c && c[clave]));
  const post = desanidar(a.referencias && a.referencias.posteriores, 'posterior');
  const ant = desanidar(a.referencias && a.referencias.anteriores, 'anterior');
  const mat = arr(a.materias).map((m) => m && m.materia).filter(Boolean);
  return {
    materias: mat.map((m) => (typeof m === 'string' ? m : m.texto)).filter(Boolean),
    notas: arr(a.notas && a.notas.nota).map((n) => (typeof n === 'string' ? n : n.texto)).filter(Boolean),
    referencias_posteriores: post.slice(0, 60).map((r) => ({
      norma: r.id_norma,
      relacion: r.relacion && (r.relacion.texto || r.relacion),
      detalle: r.texto,
    })),
    referencias_anteriores: ant.slice(0, 30).map((r) => ({
      norma: r.id_norma,
      relacion: r.relacion && (r.relacion.texto || r.relacion),
      detalle: r.texto,
    })),
  };
}

/** Localiza el bloque de un artículo dentro del índice. */
function localizarBloque(indice, referencia) {
  const ref = norm(referencia);
  // el BOE titula los bloques como "Art 1902" o "Artículo 24"; ambos se aceptan.
  const prefijo = /^art(iculo)?s?\.?\s*/;
  const soloNum = ref.replace(prefijo, '').trim();
  // B1: "1.902" (punto de millares, habitual citando el Código Civil: art.
  // 1902, 1544...) y "1902" (como lo titula el propio índice del BOE, SIN
  // punto) son el MISMO artículo -- probarlo tiene que ir ANTES del recorte
  // por apartado de abajo, o "1.902" acababa casando por error con el
  // bloque "Art 1" (como si 902 fuese su apartado, que no existe).
  const sinPuntoDeMiles = soloNum.replace(/\./g, '');
  // el bloque es por artículo completo: un apartado citado (24.2) se busca
  // por su número base si no hay bloque para el apartado exacto. Un punto
  // de millares real dejar SIEMPRE exactamente 3 dígitos detrás (1.902,
  // 12.345); un apartado casi nunca llega a 3 dígitos (24.2, no 24.234) --
  // así que el recorte por apartado NO se aplica cuando parece de millares,
  // para no confundir los dos casos.
  const partes = soloNum.split(/[.,]/);
  const pareceMiles = partes.length === 2 && /^\d{3}$/.test(partes[1]);
  const numBase = pareceMiles ? null : partes[0].trim();

  const candidatos = [];
  for (const b of indice) {
    const t = norm(b.titulo);
    if (b.bloque === referencia || t === ref) return { ...b, exacto: true };
    const tNum = t.replace(prefijo, '').trim();
    if (tNum === soloNum || tNum === sinPuntoDeMiles) return { ...b, exacto: true };
    if (numBase && tNum === numBase) return { ...b, exacto: numBase === soloNum };
    if (tNum.startsWith(`${soloNum} `) || (numBase && tNum.startsWith(`${numBase} `))) candidatos.push(b);
    if (t.includes(ref) && ref.length > 4) candidatos.push(b);
  }
  return candidatos.length ? { ...candidatos[0], exacto: false } : null;
}

/** Resuelve un nombre libre de norma a un identificador BOE verificado. */
// B5: un nombre reducido al tipo de norma, sin ningún otro dato (ni número, ni
// materia, ni fecha), no identifica UNA norma concreta -- "Reglamento" o "Ley"
// solos podrían ser cualquiera de miles. Antes esto se resolvía igual que
// cualquier otro título, con "coincidencia: exacta" contra lo primero que
// devolviese la búsqueda (regla 4 del proyecto: nunca inventar/afirmar de más).
const _TIPOS_NORMA_GENERICOS = new Set([
  'ley', 'leyes', 'ley organica', 'ley ordinaria',
  'decreto', 'decretos', 'real decreto', 'real decreto legislativo', 'real decreto ley',
  'decreto legislativo', 'decreto ley', 'decreto foral', 'decreto foral legislativo',
  'orden', 'ordenes', 'circular', 'circulares', 'resolucion', 'resoluciones',
  'instruccion', 'instrucciones', 'reglamento', 'reglamentos',
  'codigo', 'codigos', 'estatuto', 'estatutos', 'convenio', 'convenios',
  'norma', 'normas', 'disposicion', 'disposiciones',
]);

// B10: el "hint" que queda tras un "artículo N de..." puede ser CUALQUIER
// texto cercano del propio escrito del usuario -- "artículo 3 del contrato
// firmado con Juan Pérez" deja el hint "contrato firmado con Juan Pérez", que
// sin este filtro se mandaba tal cual a boe.es/Euskadi como búsqueda por
// título. Eso es enviar un fragmento potencialmente sensible del escrito de
// un cliente a un servicio externo, sin que el usuario lo sepa. Ahora la
// búsqueda por título SOLO se intenta si el propio texto ya menciona algún
// tipo de norma reconocible -- si no, es más probable que sea prosa del
// escrito que una cita real, y no vale la pena el riesgo.
const _PISTA_TIPO_NORMA_RE = /\b(ley|decreto|reglamento|orden|circular|resoluci[oó]n|instrucci[oó]n|c[oó]digo|estatuto|convenio|constituci[oó]n|directiva|carta\s+magna)\b/i;

/**
 * Elige, entre las normas que comparten un número oficial ("3/2018"), la que
 * pide el texto del usuario. Función pura (sin red), probada en test/unit.js.
 *
 * B3: por defecto la búsqueda ordena por fecha de publicación descendente y
 * antes se cogía la primera -- la más reciente, sin mirar su RANGO ni su título.
 * B12 (19/11/2026): el filtro por rango usaba "el nombre CONTIENE el rango", y
 * "Ley" está contenido en "Ley Orgánica 3/2018": pasaban las dos y ganaba la
 * ley autonómica más reciente. Ahora, entre las que encajan por rango, se queda
 * el rango MÁS ESPECÍFICO (el más largo), y después se desempata por el
 * solapamiento de palabras entre el nombre pedido y el título ("Ley 9/2007 de
 * subvenciones de Galicia" -> la que dice "subvenciones de Galicia").
 *
 * @param {string} nombre texto del usuario
 * @param {Array<{id:string,titulo:string,rango:string}>} candidatos orden por fecha desc
 * @returns {{elegido: object, alternativas: object[]}} alternativas = empatadas con el elegido
 */
function elegirPorNumeroOficial(nombre, candidatos) {
  const nombreNorm = norm(nombre);
  let pool = candidatos;
  const porRango = candidatos.filter((x) => x.rango && nombreNorm.includes(norm(x.rango)));
  if (porRango.length) {
    const maxLen = Math.max(...porRango.map((x) => norm(x.rango).length));
    pool = porRango.filter((x) => norm(x.rango).length === maxLen);
  }
  const puntos = pool.map((x) => solapamientoPalabras(nombre, x.titulo || ''));
  const mejor = Math.max(...puntos);
  const empatadas = pool.filter((_, i) => puntos[i] === mejor);
  return { elegido: empatadas[0], alternativas: empatadas.slice(1) };
}

async function resolverNorma(nombre) {
  // B2: si el propio nombre ya trae un número oficial explícito ("Ley 42/2015,
  // de reforma de la Ley de Enjuiciamiento Civil"), esa es la referencia
  // INEQUÍVOCA a la norma citada -- tiene que ganar a un atajo por alias
  // ("Ley de Enjuiciamiento Civil" -> LEC) que solo aparece ahí de forma
  // descriptiva, de paso. Antes el atajo se probaba primero y "ganaba" siempre
  // que hiciese match, aunque el número presente en el mismo texto apuntase a
  // otra norma distinta (la que reforma, no la reformada).
  const numero = String(nombre).match(/(\d+\/\d{4})/);
  if (numero) {
    // B12 (19/11/2026): el límite era 5 y dejaba fuera la norma buscada cuando
    // el mismo número lo comparten varias (la Ley Orgánica 1/1996 era la 8.ª de
    // 9 resultados). Se pide el máximo que admite la API (50).
    const r = await buscarNormas({ numero_oficial: numero[1], limite: 50 });
    if (r.length) {
      const { elegido, alternativas } = elegirPorNumeroOficial(nombre, r);
      const ficha = await fichaNorma(elegido.id);
      const res = { ...ficha, origen: `búsqueda por número oficial ${numero[1]}` };
      // Regla 4: si tras rango y título siguen empatadas varias normas, no se
      // finge certeza -- se dice y se listan las demás.
      if (alternativas.length) {
        res.ambigua = true;
        res.alternativas = alternativas.map((x) => ({ id: x.id, titulo: x.titulo, rango: x.rango, fecha_publicacion: x.fecha_publicacion }));
        res.aviso_ambiguedad =
          `Hay ${alternativas.length + 1} normas con el número oficial ${numero[1]} que encajan igual con lo pedido; se devuelve la más reciente. ` +
          'Añade el rango completo, el título o la comunidad autónoma para fijar cuál es.';
      }
      return res;
    }
  }
  const atajo = buscarAtajo(nombre);
  if (atajo) {
    try {
      const ficha = await fichaNorma(atajo.id);
      return { ...ficha, origen: `atajo (${atajo.via})` };
    } catch (e) {
      log(`[aviso] atajo caducado para "${atajo.via}" -> ${atajo.id}: ${e.message}`);
    }
  }
  const limpio = String(nombre).replace(/^(de\s+l[ao]s?\s+|del\s+|de\s+)/i, '').trim();
  if (limpio.length > 3 && !_TIPOS_NORMA_GENERICOS.has(norm(limpio)) && _PISTA_TIPO_NORMA_RE.test(limpio)) {
    const r = await buscarNormas({ titulo: limpio, limite: 5 });
    if (r.length) return { ...(await fichaNorma(r[0].id)), origen: 'búsqueda por título' };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Fuentes autonómicas — País Vasco (Open Data Euskadi / BOPV)         */
/* ------------------------------------------------------------------ */

// Aviso del BOE consolidado (compartido por la extensión MCP y la app de escritorio).
const AVISO =
  'Texto consolidado del BOE, sin valor oficial: solo lo tiene el texto publicado en el diario oficial (art. 3.1 RD 181/2008). Para efectos jurídicos debe consultarse la publicación oficial.';

const AVISO_EUSKADI =
  'Datos de Open Data Euskadi (Gobierno Vasco), licencia CC BY 4.0 — fuente distinta del BOE. Para efectos jurídicos, usa el PDF/EPUB oficial enlazado en "descargas", no este texto reconstruido de la API.';

// Las fechas de la API llegan en UTC pero representan medianoche LOCAL de Madrid
// (p.ej. "2024-06-30T22:00:00Z" = 1 de julio en Madrid). Cortar el ISO a lo bruto
// se queda un día antes en CEST (y a veces también en CET); hay que convertir de
// verdad a la fecha del calendario de Madrid, no fiarse del literal UTC.
const FMT_FECHA_MADRID = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' });
function fechaEuskadiISO(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : FMT_FECHA_MADRID.format(d);
}

function euskadiATexto(act) {
  const ficha = {
    id: act.id,
    titulo: act.name,
    rango: act.normativeRange,
    vigencia: act.state,
    ambito_territorial: act.territorialScope,
    fecha_publicacion: fechaEuskadiISO(act.publishDate),
    fecha_disposicion: fechaEuskadiISO(act.disposalDate),
    organo: act.issuingBody,
    departamento: act.department,
    seccion: act.section,
    materias: (act.themes || []).map((t) => t.name).filter(Boolean),
    url: (act._links && act._links.self && act._links.self.href) || act.mainEntityOfPage || null,
    descargas: (act.downloadable || []).map((d) => ({ formato: d.format, url: d.url })),
  };
  return ficha;
}

/**
 * Busca actos administrativos del BOPV por año (obligatorio) y, opcionalmente,
 * mes. La API no ofrece búsqueda por texto ni por título en servidor — a
 * diferencia de boe_buscar_normas — así que si se pide `texto`, el filtrado
 * es local sobre la página descargada (no exhaustivo: solo lo que entra en
 * `limite`/`offset`). Hay que decírselo siempre a quien use la herramienta.
 */
async function buscarNormativaEuskadi(p) {
  const anio = Number(p.anio) || new Date().getFullYear();
  const limite = Math.min(Math.max(Number(p.limite) || 10, 1), 50);
  const pagina = Math.max(Number(p.pagina) || 1, 1);
  let reqPath = `/bopv/administrative-acts/${anio}`;
  if (p.mes) reqPath += `/${Number(p.mes)}`;
  reqPath += `?currentPage=${pagina}&itemsOfPage=${limite}&lang=SPANISH`;

  const data = await apiJSON(reqPath, BUSQUEDA_TTL_MS, EUSKADI_HOST);
  let items = Array.isArray(data.items) ? data.items : [];
  let filtradoLocal = false;
  if (p.texto) {
    const q = norm(p.texto);
    items = items.filter(
      (a) => norm(a.name).includes(q) || (a.themes || []).some((t) => norm(t.name).includes(q))
    );
    filtradoLocal = true;
  }
  return {
    totalItemsPeriodo: data.totalItems,
    totalPaginas: data.totalPages,
    pagina: data.currentPage,
    filtradoLocalPorTexto: filtradoLocal,
    normas: items.map(euskadiATexto),
  };
}

/** Ficha + texto completo de un acto del BOPV, a partir de su id "AAAA/MM/N". */
async function textoNormativaEuskadi(id) {
  const partes = String(id || '').split('/');
  if (partes.length !== 3) throw new Error('id debe tener el formato "AAAA/MM/N" (año/mes/número de orden), tal como lo devuelve euskadi_buscar_normativa.');
  const [anio, mes, numOrden] = partes;
  const reqPath = `/bopv/administrative-acts/${Number(anio)}/${Number(mes)}/${numOrden}?lang=SPANISH`;
  const act = await apiJSON(reqPath, FICHA_TTL_MS, EUSKADI_HOST);
  const ficha = euskadiATexto(act);
  ficha.texto = act.text ? xmlATexto(act.text.content) : null;
  const enlaces = (act._links) || {};
  ficha.referencias_anteriores = (enlaces.previousReferences || []).map((r) => ({ tipo: r.type, titulo: r.name, url: r.href }));
  ficha.referencias_posteriores = (enlaces.followingReferences || []).map((r) => ({ tipo: r.type, titulo: r.name, url: r.href }));
  return ficha;
}

/* ------------------------------------------------------------------ */
/* Fuentes propias del BOE — Tribunal Constitucional (vía Sumario)     */
/*                                                                      */
/* Las sentencias del TC se publican en el BOE por mandato de su Ley   */
/* Orgánica, pero NO están en "legislación consolidada" (no son normas */
/* que se consoliden: son documentos de una sola vez). Se descubren    */
/* día a día con la API del Sumario del BOE y se leen con el mismo     */
/* endpoint /diario_boe/xml.php que ya usa este servidor para el texto */
/* de las leyes — mismo host, mismas condiciones de reutilización del  */
/* BOE, sin depender del CENDOJ ni de su Reglamento 3/2010 (que rige   */
/* la base de datos general de jurisprudencia, una fuente distinta y   */
/* deliberadamente excluida de este conector — ver CLAUDE.md).         */
/* ------------------------------------------------------------------ */

const SUMARIO_PATH = '/datosabiertos/api/boe/sumario';
const SUMARIO_TTL_MS = 30 * 24 * 60 * 60 * 1000; // un sumario ya publicado no cambia nunca
const TC_SECCION_CODIGO = 'T';
const AVISO_TC = 'Texto del BOE tal como se publicó (diario oficial), reconstruido desde su versión HTML/XML — no es la edición en PDF, que es la única con valor oficial y auténtico. Para efectos jurídicos, usa el PDF enlazado en "url_pdf".';

function fechaAAAAMMDD(f) {
  return String(f || '').replace(/-/g, '');
}

// Hallazgo de gravedad baja (revisión 21/09/2026): una fecha con formato
// correcto pero IMPOSIBLE ("20240230", 30 de febrero) pasaba la comprobación
// `/^\d{8}$/` sin problema, y `new Date(...)` la normaliza en silencio (la
// "redondea" al 1 de marzo) en vez de fallar -- la búsqueda seguía adelante
// con una fecha DISTINTA a la pedida, sin avisar de nada, en vez de dar un
// error claro. Se valida por ida y vuelta: si el día/mes/año que devuelve el
// propio `Date` no coincide con lo que se le pidió, es que no era una fecha
// real.
function fechaCalendarioValida(f) {
  if (!/^\d{8}$/.test(f)) return false;
  const anio = Number(f.slice(0, 4));
  const mes = Number(f.slice(4, 6));
  const dia = Number(f.slice(6, 8));
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/** Recoge recursivamente los <item> de un nodo del sumario, estén bajo <epigrafe> o directos. */
function itemsDelNodo(nodo, out) {
  if (!nodo) return;
  if (nodo.item) {
    const items = Array.isArray(nodo.item) ? nodo.item : [nodo.item];
    out.push(...items);
  }
  if (nodo.epigrafe) {
    const epigrafes = Array.isArray(nodo.epigrafe) ? nodo.epigrafe : [nodo.epigrafe];
    for (const ep of epigrafes) itemsDelNodo(ep, out);
  }
}

/** Extrae las sentencias/autos del Tribunal Constitucional del sumario de un día. */
function itemsTCDelSumario(sumario) {
  const out = [];
  if (!sumario) return out;
  const diarios = Array.isArray(sumario.diario) ? sumario.diario : [sumario.diario].filter(Boolean);
  for (const diario of diarios) {
    if (!diario) continue;
    const secciones = Array.isArray(diario.seccion) ? diario.seccion : [diario.seccion].filter(Boolean);
    const tc = secciones.find((s) => s && s.codigo === TC_SECCION_CODIGO);
    if (!tc || !tc.departamento) continue;
    const departamentos = Array.isArray(tc.departamento) ? tc.departamento : [tc.departamento];
    for (const dep of departamentos) {
      const items = [];
      itemsDelNodo(dep.texto, items);
      for (const it of items) {
        out.push({ id: it.identificador, titulo: it.titulo, url: it.url_html || null });
      }
    }
  }
  return out;
}

/**
 * Busca sentencias del TC publicadas entre dos fechas (máx. 31 días: el
 * Sumario del BOE no admite búsqueda por texto, solo navegación día a día,
 * igual que la limitación ya conocida del BOPV). `texto`, si se da, filtra
 * localmente sobre los títulos ya recogidos — no es una búsqueda exhaustiva.
 */
async function buscarSentenciasTC(p) {
  const desde = fechaAAAAMMDD(p.fecha_desde);
  const hasta = fechaAAAAMMDD(p.fecha_hasta) || desde;
  if (!/^\d{8}$/.test(desde) || !/^\d{8}$/.test(hasta)) {
    throw new Error('fecha_desde (y fecha_hasta, si se da) deben tener formato AAAAMMDD o AAAA-MM-DD.');
  }
  if (!fechaCalendarioValida(desde)) throw new Error(`fecha_desde no es una fecha real: ${p.fecha_desde}`);
  if (!fechaCalendarioValida(hasta)) throw new Error(`fecha_hasta no es una fecha real: ${p.fecha_hasta}`);
  const iso = (f) => `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`;
  const d0 = new Date(iso(desde));
  const d1 = new Date(iso(hasta));
  const dias = Math.round((d1 - d0) / 86400000) + 1;
  if (!(dias > 0)) throw new Error('fecha_hasta debe ser igual o posterior a fecha_desde.');
  if (dias > 31) throw new Error('El rango entre fecha_desde y fecha_hasta no puede superar 31 días (navegación día a día, sin búsqueda por texto en el servidor).');

  const resultados = [];
  for (let i = 0; i < dias; i++) {
    const f = new Date(d0.getTime() + i * 86400000);
    const fStr = f.toISOString().slice(0, 10).replace(/-/g, '');
    let data;
    try {
      data = await apiJSON(`${SUMARIO_PATH}/${fStr}`, SUMARIO_TTL_MS, BASE_HOST);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) continue; // sin BOE ese día (domingo, festivo...)
      throw e;
    }
    const sumario = data && data.data && data.data.sumario;
    itemsTCDelSumario(sumario).forEach((it) => resultados.push({ ...it, fecha_publicacion: iso(fStr) }));
  }

  let filtradoLocal = false;
  let items = resultados;
  if (p.texto) {
    const q = norm(p.texto);
    items = items.filter((it) => norm(it.titulo).includes(q));
    filtradoLocal = true;
  }
  const limite = Math.min(Math.max(Number(p.limite) || 20, 1), 100);
  return { diasRevisados: dias, encontradas: items.length, filtradoLocalPorTexto: filtradoLocal, sentencias: items.slice(0, limite) };
}

function tagSimple(xml, nombre) {
  const m = new RegExp(`<${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${nombre}>`, 'i').exec(xml);
  return m ? decodeEntities(m[1]).trim() || null : null;
}

/** Ficha, análisis y texto completo de una sentencia del TC a partir de su BOE-A-AAAA-N. */
async function textoSentenciaTC(id) {
  const xml = await apiXML(`/diario_boe/xml.php?id=${encodeURIComponent(id)}`);

  const materias = [];
  const reMateria = /<materia\b[^>]*>([\s\S]*?)<\/materia>/gi;
  let m;
  while ((m = reMateria.exec(xml))) materias.push(decodeEntities(m[1]).trim());

  const referencias = [];
  const reAnterior = /<anterior\s+([^>]*)>([\s\S]*?)<\/anterior>/gi;
  while ((m = reAnterior.exec(xml))) {
    const attrs = atributos(m[1]);
    referencias.push({
      norma: attrs.referencia,
      relacion: tagSimple(m[2], 'palabra'),
      detalle: tagSimple(m[2], 'texto'),
    });
  }

  // Los <texto> del cuerpo (antecedentes, fundamentos, fallo, votos particulares)
  // van FUERA de <analisis>, a continuación. Dentro de <analisis><referencias> hay
  // también etiquetas <texto> (el detalle de cada referencia) que no son el cuerpo:
  // hay que buscar solo después de que cierre </analisis>, o se mezclan las dos cosas.
  const cuerpo = xml.split('</analisis>').pop();
  const textos = [];
  const reTexto = /<texto>([\s\S]*?)<\/texto>/gi;
  while ((m = reTexto.exec(cuerpo))) textos.push(xmlATexto(m[1]));

  return {
    id: tagSimple(xml, 'identificador') || id,
    titulo: tagSimple(xml, 'titulo'),
    rango: tagSimple(xml, 'rango'),
    organo: tagSimple(xml, 'departamento'),
    numero_oficial: tagSimple(xml, 'numero_oficial'),
    fecha_disposicion: fmtFecha(tagSimple(xml, 'fecha_disposicion')),
    fecha_publicacion: fmtFecha(tagSimple(xml, 'fecha_publicacion')),
    url: `https://www.boe.es/diario_boe/txt.php?id=${encodeURIComponent(id)}`,
    url_pdf: tagSimple(xml, 'url_pdf'),
    materias,
    referencias_a_normas_anteriores: referencias,
    texto: textos.join('\n\n').trim() || null,
  };
}

/* ------------------------------------------------------------------ */
/* BOE — BORME (Boletín Oficial del Registro Mercantil)                */
/*                                                                      */
/* Mismo host (www.boe.es) y mismas condiciones de reutilización que el */
/* BOE (licencia tipo de 27/06/2024, que cita el BORME expresamente).   */
/* Comprobado en vivo el 18/10/2026 (docs/estudio-borme-boletines-      */
/* provinciales.md): API del sumario diario (desde 2009) y el mismo     */
/* /diario_borme/xml.php por documento. Sin búsqueda por texto en el    */
/* servidor: se recorre día a día, como con el TC.                      */
/*                                                                      */
/* NO es legislación: son actos inscritos y anuncios de empresas, con   */
/* DATOS PERSONALES (administradores, apoderados, socios únicos...)     */
/* publicados por mandato legal. Minimización, decidida por José Luis   */
/* el 18/10/2026 (índice alfabético aprobado el mismo día):             */
/*  - solo búsqueda por DENOMINACIÓN de la empresa, que se compara con  */
/*    la cabecera de cada acto o con el título del anuncio, nunca con   */
/*    el cuerpo (donde van los nombres de personas);                    */
/*  - rango de 31 días como máximo; la Sección Primera (un documento    */
/*    por provincia) en toda España a través del índice alfabético de   */
/*    sociedades del día, o solo en la provincia indicada;              */
/*  - se devuelven solo los actos de la empresa buscada, nunca el       */
/*    documento entero de una provincia;                                */
/*  - el sumario y el índice (sin nombres de personas) van a la caché  */
/*    de disco; los actos y anuncios, solo a la de memoria (apiXML).    */
/* ------------------------------------------------------------------ */

const BORME_SUMARIO_PATH = '/datosabiertos/api/borme/sumario';
const BORME_XML_PATH = '/diario_borme/xml.php';
const BORME_PRIMER_DIA = '20090101'; // sumarios disponibles desde enero de 2009 (FAQ de la API)
const FUENTE_BORME = 'BOE · BORME (Boletín Oficial del Registro Mercantil)';
const TIPO_BORME = 'actos y anuncios del Registro Mercantil, no legislación';
const CITA_BORME = 'Basado en datos de la Agencia Estatal Boletín Oficial del Estado (https://www.boe.es)';
const AVISO_BORME =
  'Texto del BORME reconstruido desde su versión XML, sin valor oficial: solo la edición en PDF firmada electrónicamente tiene carácter oficial y auténtico (RD 1979/2008); para efectos jurídicos, usa el PDF enlazado en "url_pdf". ' +
  'Contiene datos personales publicados por mandato legal para la publicidad mercantil: úsalos solo para esa finalidad, con pleno respeto al RGPD y a la LOPDGDD, y nunca para perfilar a personas. ' +
  CITA_BORME + '.';
const RE_ID_BORME = /^BORME-([ABC])-(\d{4})-(\d{1,6})(?:-(\d{2}))?$/;

// Códigos de provincia del INE: son el sufijo de los documentos de la Sección
// Primera (BORME-A-2026-200-28 = Madrid). Comprobado contra los sumarios reales
// de junio-octubre de 2026; el 99 es el índice alfabético del día, no una provincia.
const PROVINCIAS_BORME = {
  '01': ['Araba/Álava', 'alava', 'araba'], '02': ['Albacete'], '03': ['Alicante/Alacant', 'alicante', 'alacant'],
  '04': ['Almería'], '05': ['Ávila'], '06': ['Badajoz'], '07': ['Illes Balears', 'baleares', 'islas baleares', 'balears'],
  '08': ['Barcelona'], '09': ['Burgos'], '10': ['Cáceres'], '11': ['Cádiz'], '12': ['Castellón/Castelló', 'castellon', 'castello'],
  '13': ['Ciudad Real'], '14': ['Córdoba'], '15': ['A Coruña', 'la coruna', 'coruna'], '16': ['Cuenca'],
  '17': ['Girona', 'gerona'], '18': ['Granada'], '19': ['Guadalajara'], '20': ['Gipuzkoa', 'guipuzcoa'], '21': ['Huelva'],
  '22': ['Huesca'], '23': ['Jaén'], '24': ['León'], '25': ['Lleida', 'lerida'], '26': ['La Rioja', 'rioja'], '27': ['Lugo'],
  '28': ['Madrid'], '29': ['Málaga'], '30': ['Murcia'], '31': ['Navarra'], '32': ['Ourense', 'orense'], '33': ['Asturias'],
  '34': ['Palencia'], '35': ['Las Palmas'], '36': ['Pontevedra'], '37': ['Salamanca'], '38': ['Santa Cruz de Tenerife', 'tenerife'],
  '39': ['Cantabria'], '40': ['Segovia'], '41': ['Sevilla'], '42': ['Soria'], '43': ['Tarragona'], '44': ['Teruel'],
  '45': ['Toledo'], '46': ['Valencia/València', 'valencia'], '47': ['Valladolid'], '48': ['Bizkaia', 'vizcaya'],
  '49': ['Zamora'], '50': ['Zaragoza'], '51': ['Ceuta'], '52': ['Melilla'],
};

/** Provincia por código INE ("28", 28) o por nombre ("Vizcaya", "A Coruña"). null si no la reconoce. */
function provinciaBorme(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (/^\d{1,2}$/.test(s)) {
    const cod = s.padStart(2, '0');
    return PROVINCIAS_BORME[cod] ? { codigo: cod, nombre: PROVINCIAS_BORME[cod][0] } : null;
  }
  const q = norm(s);
  for (const [cod, nombres] of Object.entries(PROVINCIAS_BORME)) {
    if (nombres.some((n) => norm(n) === q)) return { codigo: cod, nombre: nombres[0] };
  }
  return null;
}

// Formas sociales que no distinguen a una empresa de otra: se quitan de la
// consulta ("Talgo, S.A." busca "Talgo"), nunca de la denominación publicada.
const FORMAS_SOCIALES = new Set(['s', 'a', 'l', 'u', 'p', 'sa', 'sl', 'slu', 'sau', 'slp', 'sll', 'sal', 'scp', 'sociedad', 'limitada', 'anonima', 'unipersonal', 'profesional', 'laboral']);

function palabrasDenominacion(s) {
  return norm(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

/** Palabras de la consulta sin la forma social. Vacío si no queda nada útil. */
function consultaDenominacion(q) {
  const p = palabrasDenominacion(q);
  let fin = p.length;
  while (fin > 0 && FORMAS_SOCIALES.has(p[fin - 1])) fin--;
  const out = p.slice(0, fin);
  return out.join('').length >= 3 ? out : [];
}

/** ¿Aparecen las palabras de la consulta, seguidas y en orden, en la denominación? */
function coincideDenominacion(denominacion, consulta) {
  const d = palabrasDenominacion(denominacion);
  if (!consulta.length || consulta.length > d.length) return false;
  for (let i = 0; i + consulta.length <= d.length; i++) {
    if (consulta.every((w, j) => d[i + j] === w)) return true;
  }
  return false;
}

/** Valida un rango de fechas del BORME y devuelve los días (AAAAMMDD), como en el TC. */
function diasRangoBorme(fechaDesde, fechaHasta) {
  const desde = fechaAAAAMMDD(fechaDesde);
  const hasta = fechaAAAAMMDD(fechaHasta) || desde;
  if (!/^\d{8}$/.test(desde) || !/^\d{8}$/.test(hasta)) {
    throw new Error('fecha_desde (y fecha_hasta, si se da) deben tener formato AAAAMMDD o AAAA-MM-DD.');
  }
  if (!fechaCalendarioValida(desde)) throw new Error(`fecha_desde no es una fecha real: ${fechaDesde}`);
  if (!fechaCalendarioValida(hasta)) throw new Error(`fecha_hasta no es una fecha real: ${fechaHasta}`);
  if (desde < BORME_PRIMER_DIA) throw new Error('La API del BORME solo tiene sumarios desde el 1 de enero de 2009.');
  const iso = (f) => `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`;
  const d0 = new Date(iso(desde));
  const total = Math.round((new Date(iso(hasta)) - d0) / 86400000) + 1;
  if (!(total > 0)) throw new Error('fecha_hasta debe ser igual o posterior a fecha_desde.');
  if (total > 31) throw new Error('El rango entre fecha_desde y fecha_hasta no puede superar 31 días (el BORME se recorre día a día, sin búsqueda por texto en el servidor).');
  const dias = [];
  for (let i = 0; i < total; i++) dias.push(new Date(d0.getTime() + i * 86400000).toISOString().slice(0, 10).replace(/-/g, ''));
  return dias;
}

const comoLista = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/**
 * Documentos de un sumario del BORME: [{seccion, seccion_nombre, apartado, id, titulo,
 * url, url_xml, url_pdf, pagina_inicial, pagina_final}]. Sección A y B: uno por
 * provincia (más el índice alfabético, -99); sección C: uno por anuncio.
 */
function documentosSumarioBorme(sumario) {
  const out = [];
  if (!sumario) return out;
  for (const diario of comoLista(sumario.diario)) {
    for (const sec of comoLista(diario && diario.seccion)) {
      if (!sec) continue;
      const nodos = sec.apartado ? comoLista(sec.apartado) : [sec];
      for (const nodo of nodos) {
        for (const it of comoLista(nodo.item)) {
          const pdf = it.url_pdf || {};
          out.push({
            seccion: sec.codigo,
            seccion_nombre: sec.nombre || null,
            apartado: sec.apartado ? nodo.nombre || null : null,
            id: it.identificador,
            titulo: it.titulo || null,
            url: it.url_html || null,
            url_xml: it.url_xml || null,
            url_pdf: typeof pdf === 'string' ? pdf : pdf.texto || null,
            pagina_inicial: pdf.pagina_inicial || null,
            pagina_final: pdf.pagina_final || null,
          });
        }
      }
    }
  }
  return out;
}

function fechaActualizacionBorme(xml) {
  const m = /<documento\b[^>]*\bfecha_actualizacion="(\d{8})T(\d{2})(\d{2})(\d{2})Z"/.exec(xml);
  return m ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2]}:${m[3]}:${m[4]}Z` : null;
}

/** Metadatos de un documento XML del BORME (cualquier sección). */
function metadatosBorme(xml) {
  const sec = /<seccion\s+codigo="([^"]*)"\s*>([\s\S]*?)<\/seccion>/i.exec(xml);
  return {
    id: tagSimple(xml, 'identificador'),
    titulo: tagSimple(xml, 'titulo'),
    seccion: sec ? sec[1] : null,
    seccion_nombre: sec ? decodeEntities(sec[2]).trim() : null,
    apartado: tagSimple(xml, 'departamento'),
    id_anuncio: tagSimple(xml, 'id_anuncio'),
    diario_numero: tagSimple(xml, 'diario_numero'),
    fecha_publicacion: fmtFecha(tagSimple(xml, 'fecha_publicacion')),
    pagina_inicial: tagSimple(xml, 'pagina_inicial'),
    pagina_final: tagSimple(xml, 'pagina_final'),
    url_pdf: tagSimple(xml, 'url_pdf'),
    fecha_actualizacion: fechaActualizacionBorme(xml),
  };
}

/**
 * Actos de un documento de la Sección Primera (A o B). Cada acto empieza con
 * `<p class="articulo">NÚMERO - DENOMINACIÓN.</p>` y sigue con sus párrafos;
 * en la B, un `<p class="centro_redonda">` encabeza cada tipo de acto.
 */
function actosDocumentoBorme(xml) {
  const cuerpo = (/<texto>([\s\S]*?)<\/texto>/i.exec(xml) || [])[1] || '';
  const actos = [];
  let epigrafe = null;
  let actual = null;
  const reP = /<p\s+class="([^"]*)"\s*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = reP.exec(cuerpo))) {
    const clase = m[1];
    const texto = xmlATexto(m[2]).replace(/\s+/g, ' ').trim();
    if (clase === 'centro_redonda') {
      epigrafe = texto;
      actual = null;
    } else if (clase === 'articulo') {
      const c = /^(\d+)\s*-\s*([\s\S]+)$/.exec(texto);
      let denominacion = c ? c[2] : texto;
      const fechaActo = / \((\d{2}\/\d{2}\/\d{4})\)$/.exec(denominacion);
      if (fechaActo) denominacion = denominacion.slice(0, fechaActo.index);
      actual = {
        numero: c ? c[1] : null,
        denominacion: denominacion.trim(),
        tipo: epigrafe,
        fecha_indicada: fechaActo ? fechaActo[1] : null,
        texto: '',
      };
      actos.push(actual);
    } else if (actual) {
      actual.texto = actual.texto ? `${actual.texto}\n${texto}` : texto;
    }
  }
  for (const a of actos) a.texto = a.texto || null;
  return actos;
}

// Un id que no existe NO da 404: xml.php responde 200 con
// `<error><descripcion>Documento con referencia desconocida.</descripcion></error>`
// (comprobado el 18/10/2026). Se trata igual que un 404.
async function xmlBorme(id) {
  let xml;
  try {
    xml = await apiXML(`${BORME_XML_PATH}?id=${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new ApiError(404, `${id} no existe en el BORME.`);
    throw e;
  }
  if (!/<documento\b/.test(xml) || tagSimple(xml, 'identificador') !== id) {
    const desc = tagSimple(xml, 'descripcion');
    throw new ApiError(404, `${id} no existe en el BORME${desc ? ` (${desc.replace(/\.$/, '')})` : ''}.`);
  }
  return xml;
}

/** Actos de la empresa buscada en un documento A/B, con su procedencia. Nunca el resto. */
function actosDeEmpresa(xml, doc, consulta) {
  const meta = metadatosBorme(xml);
  return actosDocumentoBorme(xml)
    .filter((a) => coincideDenominacion(a.denominacion, consulta))
    .map((a) => ({
      seccion: meta.seccion || doc.seccion,
      seccion_nombre: meta.seccion_nombre || doc.seccion_nombre,
      documento_id: meta.id || doc.id,
      provincia: meta.titulo || doc.titulo,
      fecha_publicacion: meta.fecha_publicacion,
      numero_acto: a.numero,
      denominacion: a.denominacion,
      tipo: a.tipo,
      fecha_indicada: a.fecha_indicada,
      texto: a.texto,
      url: `https://www.boe.es/diario_borme/txt.php?id=${encodeURIComponent(meta.id || doc.id)}`,
      url_pdf: meta.url_pdf || doc.url_pdf,
      paginas: meta.pagina_inicial ? `${meta.pagina_inicial}-${meta.pagina_final}` : null,
      fecha_actualizacion: meta.fecha_actualizacion,
    }));
}

// Cada sumario trae en la Sección A un «Índice alfabético de sociedades»
// (BORME-A-AAAA-NNN-99, desde 2009, ~600 KB): una fila por acto inscrito con
// `<td>DENOMINACIÓN.</td><td>…BORME-A-AAAA-NNN-PP…</td><td>(NÚMERO)</td>`, sin
// nombres de personas. Permite buscar los actos de una empresa en toda España
// bajando solo el índice y, si aparece, el documento de su provincia. Como no
// trae nombres de personas y lo ya publicado no cambia, va a la caché de disco
// (ya analizado), como el sumario. Comprobado el 18/10/2026. No cubre la Sección B.
const BORME_INDICE_SUFIJO = '99';

/** Entradas del índice alfabético: [{denominacion, documento_id, numero_acto}]. */
function entradasIndiceBorme(xml) {
  const out = [];
  const reFila = /<tr>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = reFila.exec(xml))) {
    const celdas = [];
    const reCelda = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    while ((c = reCelda.exec(m[1]))) celdas.push(xmlATexto(c[1]).replace(/\s+/g, ' ').trim());
    if (celdas.length !== 3) continue; // las filas de una sola celda son la letra del abecedario
    const doc = /BORME-[AB]-\d{4}-\d{1,6}-\d{2}/.exec(celdas[1]);
    if (!doc) continue;
    const num = /\((\d+)\)/.exec(celdas[2]);
    out.push({ denominacion: celdas[0], documento_id: doc[0], numero_acto: num ? num[1] : null });
  }
  return out;
}

async function indiceBorme(id) {
  const clave = 'BORME-INDICE ' + id;
  const enMemoria = cacheGet(clave);
  if (enMemoria) return enMemoria;
  const enDisco = cacheDiskGet(clave, SUMARIO_TTL_MS);
  if (enDisco) {
    cacheSet(clave, enDisco);
    return enDisco;
  }
  const entradas = entradasIndiceBorme(await xmlBorme(id));
  cacheSet(clave, entradas);
  cacheDiskSet(clave, entradas);
  return entradas;
}

/**
 * Busca en el BORME, día a día (máx. 31 días), lo publicado sobre una empresa:
 *  - anuncios de la Sección Segunda (C) de toda España, por su título;
 *  - actos de la Sección Primera: con `provincia`, en los documentos (A y B) de
 *    esa provincia; sin ella, en toda España: la A a través del índice alfabético
 *    del día (solo se descargan los documentos donde aparece la empresa) y la B
 *    (pocos documentos pequeños al día, sin índice) entera.
 * `denominacion` es obligatoria y nunca se compara con el cuerpo de los actos.
 */
async function buscarBorme(p = {}) {
  const consulta = consultaDenominacion(p.denominacion);
  if (!consulta.length) throw new Error('Indica la denominación de la empresa (al menos 3 letras o cifras, sin contar la forma social).');
  let provincia = null;
  if (p.provincia !== undefined && p.provincia !== null && p.provincia !== '') {
    provincia = provinciaBorme(p.provincia);
    if (!provincia) throw new Error(`Provincia no reconocida: "${p.provincia}". Usa su nombre (p. ej. "Madrid", "Bizkaia") o su código INE de dos cifras.`);
  }
  const dias = diasRangoBorme(p.fecha_desde, p.fecha_hasta);
  const limite = Math.min(Math.max(Number(p.limite) || 20, 1), 100);

  const anuncios = [];
  const actos = [];
  const diasSinIndice = [];
  let diasConBorme = 0;
  for (const dia of dias) {
    let data;
    try {
      data = await apiJSON(`${BORME_SUMARIO_PATH}/${dia}`, SUMARIO_TTL_MS, BASE_HOST);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) continue; // sin BORME ese día (sábado, domingo, festivo en Madrid)
      throw e;
    }
    diasConBorme++;
    const fecha = `${dia.slice(0, 4)}-${dia.slice(4, 6)}-${dia.slice(6, 8)}`;
    const docs = documentosSumarioBorme(data && data.data && data.data.sumario);
    for (const d of docs) {
      if (d.seccion === 'C' && coincideDenominacion(d.titulo, consulta)) {
        anuncios.push({
          id: d.id, denominacion: d.titulo, apartado: d.apartado, seccion: d.seccion, seccion_nombre: d.seccion_nombre,
          fecha_publicacion: fmtFecha(dia), url: d.url, url_pdf: d.url_pdf,
          paginas: d.pagina_inicial ? `${d.pagina_inicial}-${d.pagina_final}` : null,
        });
      }
    }
    const sufijo = (d) => (RE_ID_BORME.exec(d.id || '') || [])[4];
    const primera = docs.filter((d) => (d.seccion === 'A' || d.seccion === 'B') && sufijo(d));
    let aDescargar;
    if (provincia) {
      aDescargar = primera.filter((d) => sufijo(d) === provincia.codigo);
    } else {
      const indice = primera.find((d) => d.seccion === 'A' && sufijo(d) === BORME_INDICE_SUFIJO);
      const conActos = new Set();
      if (indice) {
        for (const e of await indiceBorme(indice.id)) {
          if (coincideDenominacion(e.denominacion, consulta)) conActos.add(e.documento_id);
        }
      } else if (primera.some((d) => d.seccion === 'A')) {
        diasSinIndice.push(fecha);
      }
      aDescargar = primera.filter((d) => (d.seccion === 'A' && conActos.has(d.id)) || (d.seccion === 'B' && sufijo(d) !== BORME_INDICE_SUFIJO));
    }
    for (const d of aDescargar) {
      if (sufijo(d) === BORME_INDICE_SUFIJO) continue;
      actos.push(...actosDeEmpresa(await xmlBorme(d.id), d, consulta));
    }
  }

  return {
    denominacion_buscada: String(p.denominacion).trim(),
    provincia,
    ambito_seccion_primera: provincia ? `solo ${provincia.nombre}` : 'toda España (Sección A por el índice alfabético de sociedades de cada día)',
    secciones_revisadas: ['A (actos inscritos)', 'B (otros actos publicados)', 'C (anuncios y avisos legales)'],
    dias_revisados: dias.length,
    dias_con_borme: diasConBorme,
    ...(diasSinIndice.length ? {
      dias_sin_indice: diasSinIndice,
      nota_indice: 'Esos días el BORME no trae índice alfabético: sus actos inscritos no se han revisado. Indica la provincia para buscarlos.',
    } : {}),
    encontrados: { actos: actos.length, anuncios: anuncios.length },
    actos: actos.slice(0, limite),
    anuncios: anuncios.slice(0, limite),
    truncado: actos.length > limite || anuncios.length > limite,
  };
}

/**
 * Texto de un documento del BORME. Sección C (un anuncio): el anuncio entero.
 * Secciones A y B (una provincia entera, con actos de muchas empresas): exige
 * `denominacion` y devuelve solo los actos de esa empresa (estado explícito si no hay).
 */
async function textoBorme(id, denominacion) {
  const mId = RE_ID_BORME.exec(String(id || '').trim());
  if (!mId || (mId[1] === 'C') === Boolean(mId[4])) {
    throw new Error('Identificador del BORME no válido. Formatos: BORME-C-AAAA-N (anuncio) o BORME-A-AAAA-NNN-PP / BORME-B-AAAA-NNN-PP (actos de una provincia).');
  }
  const idLimpio = mId[0];
  if (mId[1] !== 'C') {
    const consulta = consultaDenominacion(denominacion);
    if (!consulta.length) {
      throw new Error('Este documento reúne los actos de todas las empresas de una provincia en un día: indica la denominación de la empresa para obtener solo sus actos.');
    }
    const xml = await xmlBorme(idLimpio);
    const meta = metadatosBorme(xml);
    const actos = actosDeEmpresa(xml, { id: idLimpio }, consulta);
    return {
      estado: actos.length ? 'OK' : 'ACTO_NO_ENCONTRADO',
      ...(actos.length ? {} : { detalle: `En ${idLimpio} (${meta.titulo || 'sin título'}, ${meta.fecha_publicacion || 'sin fecha'}) no hay ningún acto cuya denominación contenga "${String(denominacion).trim()}".` }),
      id: idLimpio,
      provincia: meta.titulo,
      fecha_publicacion: meta.fecha_publicacion,
      url: `https://www.boe.es/diario_borme/txt.php?id=${encodeURIComponent(idLimpio)}`,
      url_pdf: meta.url_pdf,
      fecha_actualizacion: meta.fecha_actualizacion,
      actos,
    };
  }
  const xml = await xmlBorme(idLimpio);
  const meta = metadatosBorme(xml);
  const cuerpo = (/<texto>([\s\S]*?)<\/texto>/i.exec(xml) || [])[1] || '';
  const texto = xmlATexto(cuerpo) || null;
  return {
    estado: texto ? 'OK' : 'SIN_TEXTO',
    ...(texto ? {} : { detalle: `El BOE no devuelve texto para ${idLimpio}. Consulta el PDF oficial.` }),
    ...meta,
    denominacion: meta.titulo,
    url: `https://www.boe.es/diario_borme/txt.php?id=${encodeURIComponent(idLimpio)}`,
    texto,
  };
}

/* ------------------------------------------------------------------ */
/* Unión Europea — CELLAR (Oficina de Publicaciones, base de EUR-Lex)  */
/*                                                                      */
/* Estudio y comprobación en vivo en docs/estudio-normativa-europea.md  */
/* (03/11/2026). Host fijo `publications.europa.eu`, solo GET:          */
/*  - SPARQL (/webapi/rdf/sparql): ficha, versiones consolidadas,       */
/*    actos que modifican y el documento XHTML de cada idioma.          */
/*  - /resource/cellar/{uuid}.{expr}.{manif}/DOC_n: el XHTML en sí.     */
/* El idioma se elige en la consulta SPARQL (expresión SPA o ENG), no   */
/* con Accept-Language: así el documento es el del idioma pedido por    */
/* construcción y nunca se cambia de idioma en silencio.                */
/* El CELEX solo entra en la consulta si pasa RE_CELEX_UE (sin          */
/* inyección posible); de las palabras de búsqueda solo pasan letras y */
/* números (buscarNormasUE).                                            */
/* La web de EUR-Lex (eur-lex.europa.eu) NO se consulta nunca: tiene    */
/* cortafuegos anti-bots; solo se da como enlace.                       */
/* ------------------------------------------------------------------ */

const UE_SPARQL_PATH = '/webapi/rdf/sparql';
const FUENTE_UE = 'Oficina de Publicaciones de la UE · CELLAR (EUR-Lex)';
const AVISO_UE =
  '© Unión Europea, https://eur-lex.europa.eu — fuente distinta del BOE. Reutilización autorizada (Decisión 2011/833/UE); el texto consolidado se ofrece bajo licencia CC BY 4.0 y aquí se ha extraído y limpiado de su XHTML (sin notas ni marcas de modificación ►M). El texto consolidado es un instrumento de documentación sin efecto jurídico: solo es auténtico lo publicado en el Diario Oficial de la Unión Europea (Reglamento (UE) n.º 216/2013). Para efectos jurídicos, usa el enlace "url_doue".';

const IDIOMAS_UE = {
  es: { codigo: 'SPA', eurlex: 'ES', eli: 'spa', nombre: 'castellano', articulo: 'Artículo' },
  en: { codigo: 'ENG', eurlex: 'EN', eli: 'eng', nombre: 'inglés', articulo: 'Article' },
};
const LENGUA_UE = 'http://publications.europa.eu/resource/authority/language/';
const XSD_STRING = '^^<http://www.w3.org/2001/XMLSchema#string>';
const TIPOS_UE = { R: 'reg', L: 'dir', D: 'dec' };
const NOMBRE_TIPO_UE = { R: 'Reglamento', L: 'Directiva', D: 'Decisión' };
// Sector 3 (legislación) y versiones consolidadas (sector 0 + fecha de la versión).
const RE_CELEX_UE = /^([03])(\d{4})([RLD])(\d{4})(?:-(\d{8}))?$/;
const UE_TEXTO_TTL_MS = TEXTO_TTL_MS;

/** 'es' | 'en' a partir de lo que escriba el usuario o el modelo; por defecto castellano. */
function idiomaUE(v) {
  if (v === undefined || v === null || v === '') return 'es';
  const n = norm(v);
  if (['es', 'spa', 'castellano', 'espanol', 'spanish'].includes(n)) return 'es';
  if (['en', 'eng', 'ingles', 'english'].includes(n)) return 'en';
  throw new Error(`idioma no admitido: "${v}". Solo castellano ("es") o inglés ("en").`);
}

function partesCelex(celex) {
  const m = RE_CELEX_UE.exec(String(celex || '').trim().toUpperCase());
  if (!m) return null;
  return { celex: m[0], sector: m[1], anio: m[2], tipo: m[3], numero: String(Number(m[4])), version: m[5] || null, base: `3${m[2]}${m[3]}${m[4]}` };
}

/** Enlaces de procedencia: EUR-Lex (consulta) y ELI del DOUE (la publicación auténtica). */
function enlacesUE(celex, idioma) {
  const p = partesCelex(celex);
  const L = IDIOMAS_UE[idioma];
  const eli = `https://data.europa.eu/eli/${TIPOS_UE[p.tipo]}/${p.anio}/${p.numero}/oj`;
  return {
    url: `https://eur-lex.europa.eu/legal-content/${L.eurlex}/TXT/?uri=CELEX:${p.celex}`,
    url_doue: `${eli}/${L.eli}`,
    eli,
  };
}

function valoresSparql(data) {
  const filas = (data && data.results && data.results.bindings) || [];
  return filas.map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v && v.value])));
}

// Búsqueda por texto: CELLAR tarda a veces 30 s en la primera ejecución de una consulta y
// 0,1 s al repetirla (medido el 03/11/2026). Primer intento corto y un reintento.
const UE_BUSQUEDA_TIMEOUT_MS = 15000;

async function sparqlUE(consulta, ttlMsDisco, { timeoutMs = 30000, reintentarTimeout = false } = {}) {
  const reqPath = `${UE_SPARQL_PATH}?query=${encodeURIComponent(consulta)}`;
  const key = 'Q' + UE_HOST + reqPath;
  const mem = cacheGet(key);
  if (mem) return mem;
  const disco = ttlMsDisco > 0 ? cacheDiskGet(key, ttlMsDisco) : null;
  if (disco) { cacheSet(key, disco); return disco; }
  let res;
  for (let intento = 1; ; intento++) {
    try {
      res = await httpGet(reqPath, 'application/sparql-results+json', 0, UE_HOST, timeoutMs);
      // 503 «Web Site Under Maintenance» pasajero (visto el 03/11/2026): un reintento.
      if ([502, 503, 504].includes(res.status) && intento < 2) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      break;
    } catch (e) {
      if (/timeout tras/.test(e.message)) {
        if (reintentarTimeout && intento < 2) continue;
        throw new ApiError(504, `La Oficina de Publicaciones de la UE no respondió${reintentarTimeout ? ' tras dos intentos' : ''}. Si era una búsqueda, prueba de nuevo dentro de un momento, con palabras más concretas o acotando el tipo de acto.`);
      }
      // CELLAR corta a veces la conexión (ETIMEDOUT/ECONNRESET, visto el 03/11/2026): un reintento.
      if (intento >= 2 || !/ETIMEDOUT|ECONNRESET|socket hang up|EPIPE/i.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (res.status >= 400) throw new ApiError(res.status, `${UE_HOST} respondió ${res.status}. ${String(res.body).slice(0, 200)}`);
  let filas;
  try {
    filas = valoresSparql(JSON.parse(res.body));
  } catch (e) {
    throw new ApiError(502, `${UE_HOST} no devolvió JSON válido.`);
  }
  cacheSet(key, filas);
  if (ttlMsDisco > 0) cacheDiskSet(key, filas);
  return filas;
}

const PREFIJO_CDM = 'PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>\n';

// Atajos de actos frecuentes (siglas o nombres usuales en castellano e inglés).
// Auditados contra CELLAR en test/vivo.js: cada CELEX tiene que dar el título esperado.
const ATAJOS_UE = [
  { celex: '32016R0679', siglas: ['RGPD', 'GDPR', 'Reglamento general de protección de datos', 'General Data Protection Regulation'], clave: /protecci[oó]n de las personas f[ií]sicas|protection of natural persons/i },
  { celex: '32024R1689', siglas: ['Reglamento de Inteligencia Artificial', 'Reglamento de IA', 'Ley de IA', 'AI Act', 'Artificial Intelligence Act'], clave: /inteligencia artificial|artificial intelligence/i },
  { celex: '32022R2065', siglas: ['Reglamento de Servicios Digitales', 'DSA', 'Digital Services Act'], clave: /servicios digitales|digital services/i },
  { celex: '32022R1925', siglas: ['Reglamento de Mercados Digitales', 'DMA', 'Digital Markets Act'], clave: /mercados disputables|contestable and fair markets/i },
  { celex: '32012R1215', siglas: ['Bruselas I bis', 'Brussels I bis', 'Brussels I recast'], clave: /competencia judicial|jurisdiction/i },
  { celex: '32008R0593', siglas: ['Roma I', 'Rome I'], clave: /obligaciones contractuales|contractual obligations/i },
  { celex: '32007R0864', siglas: ['Roma II', 'Rome II'], clave: /obligaciones extracontractuales|non-contractual obligations/i },
  { celex: '32010R1259', siglas: ['Roma III', 'Rome III'], clave: /divorcio|divorce/i },
  { celex: '32012R0650', siglas: ['Reglamento de sucesiones', 'Reglamento europeo de sucesiones', 'Succession Regulation'], clave: /sucesiones|succession/i },
  { celex: '32019R1111', siglas: ['Bruselas II ter', 'Brussels II ter', 'Brussels IIb'], clave: /responsabilidad parental|parental responsibility/i },
  // Derogado (lo sustituyó el 2019/1111), pero se sigue citando: la ficha lo dice (NORMA_NO_VIGENTE y fin_de_vigencia).
  { celex: '32003R2201', siglas: ['Bruselas II bis', 'Brussels II bis', 'Brussels IIa'], clave: /materia matrimonial|matrimonial matters/i, vigente: false },
  { celex: '32015R0848', siglas: ['Reglamento de insolvencia', 'Insolvency Regulation'], clave: /insolvencia|insolvency/i },
];

/**
 * Nombres usuales de un acto según la tabla de atajos (comprobada en vivo), para que Claude no
 * ponga apodos de memoria (prueba real del 03/11/2026: «Roma III», «Bruselas II ter»). null si no está.
 */
function conocidoComoUE(celex) {
  const p = partesCelex(celex);
  const a = p && ATAJOS_UE.find((x) => x.celex === p.base);
  return a ? a.siglas : null;
}

function buscarAtajoUE(texto) {
  const n = norm(texto).replace(/^(el|la|del|de la|de)\s+/, '').trim();
  if (!n) return null;
  return ATAJOS_UE.find((a) => a.siglas.some((s) => norm(s) === n)) || null;
}

/**
 * Candidatos de CELEX a partir de una cita ("Reglamento (UE) 2016/679",
 * "Directiva 95/46/CE", "Reglamento (CE) n.º 44/2001"). Desde 2015 todos los
 * actos se numeran AAAA/N; antes, los reglamentos se citaban N/AAAA y las
 * directivas y decisiones AA/N o AAAA/N. Se devuelve el orden más probable
 * primero; quien llama comprueba en CELLAR cuál existe (regla 4).
 */
function celexDeCita(texto) {
  const t = String(texto || '');
  const directo = partesCelex(t.replace(/^\s*CELEX\s*:?\s*/i, ''));
  if (directo) return [directo.base];
  const atajo = buscarAtajoUE(t);
  if (atajo) return [atajo.celex];
  let tipo = null;
  if (/\b(?:reglamento|regulation)\b/i.test(t)) tipo = 'R';
  else if (/\b(?:directiva|directive)\b/i.test(t)) tipo = 'L';
  else if (/\b(?:decisi[oó]n|decision)\b/i.test(t)) tipo = 'D';
  const m = /\b(\d{1,4})\/(\d{1,4})\b/.exec(t);
  if (!tipo || !m) return [];
  const anioDe = (s) => {
    const n = Number(s);
    if (s.length === 4) return n >= 1952 && n <= new Date().getFullYear() + 1 ? n : null;
    if (s.length === 2) return n >= 52 ? 1900 + n : null; // antes de 2000 se citaba con dos cifras
    return null;
  };
  const cel = (anio, num) => (anio && Number(num) > 0 && Number(num) < 10000 ? `3${anio}${tipo}${String(Number(num)).padStart(4, '0')}` : null);
  const anioNumero = cel(anioDe(m[1]), m[2]);
  const numeroAnio = cel(anioDe(m[2]), m[1]);
  let orden;
  if (Number(m[1]) >= 2015 && m[1].length === 4) orden = [anioNumero, numeroAnio];
  else if (tipo === 'R' && anioDe(m[2])) orden = [numeroAnio, anioNumero];
  else orden = [anioNumero, numeroAnio];
  return [...new Set(orden.filter(Boolean))];
}

/** ¿La referencia es a un acto de la UE? (para no mandarla al BOE). */
function esCitaUE(texto) {
  const t = String(texto || '').trim();
  if (!t) return false;
  if (buscarAtajoUE(t) || /^\s*CELEX\s*:?\s*[03]\d{4}[RLD]\d{4}/i.test(t)) return true;
  return /^\s*(?:(?:el|la|del|de\s+la)\s+)?(?:reglamento|directiva|decisi[oó]n|regulation|directive|decision)\b(?:\s+(?:delegad[oa]|de\s+ejecuci[oó]n|delegated|implementing))?\s*\(?\s*(?:UE|CE|CEE|EU|EC|EEC|Euratom)\b/i.test(t) ||
    /^\s*(?:(?:la)\s+)?(?:directiva|directive)\s+\d{2,4}\/\d{1,4}\/(?:UE|CE|CEE|EU|EC|EEC)\b/i.test(t);
}

/** Fecha de fin de vigencia de CELLAR en dd/mm/aaaa; null si no consta o es la fecha «abierta» 9999-12-31. */
function finDeVigenciaUE(fin) {
  return fin && !/^9999/.test(fin) ? fmtFecha(fin.slice(0, 10).replace(/-/g, '')) : null;
}

/** Ficha de un acto (por CELEX ya validado): títulos en castellano e inglés, fecha, vigor, versiones y modificaciones. */
async function fichaActoUE(celexBase) {
  const p = partesCelex(celexBase);
  if (!p || p.sector !== '3') throw new Error(`CELEX no válido para un acto legislativo de la UE: "${celexBase}" (formato 3AAAATNNNN, p. ej. 32016R0679).`);
  const lit = `"${p.base}"${XSD_STRING}`;
  const filas = await sparqlUE(
    PREFIJO_CDM +
      `SELECT ?lang ?titulo ?fecha ?vigor ?fin WHERE { ?w cdm:resource_legal_id_celex ${lit} .
  OPTIONAL { ?w cdm:work_date_document ?fecha } OPTIONAL { ?w cdm:resource_legal_in-force ?vigor }
  OPTIONAL { ?w cdm:resource_legal_date_end-of-validity ?fin }
  OPTIONAL { ?e cdm:expression_belongs_to_work ?w ; cdm:expression_uses_language ?lang ; cdm:expression_title ?titulo .
    FILTER(?lang IN (<${LENGUA_UE}SPA>, <${LENGUA_UE}ENG>)) } }`,
    FICHA_TTL_MS
  );
  if (!filas.length) return null;
  const titulos = {};
  for (const f of filas) {
    if (f.lang && f.titulo) titulos[f.lang.endsWith('SPA') ? 'es' : 'en'] = f.titulo;
  }
  const versiones = await sparqlUE(
    PREFIJO_CDM +
      `SELECT DISTINCT ?celex WHERE { ?w cdm:resource_legal_id_celex ${lit} . ?c cdm:act_consolidated_based_on_resource_legal ?w ; cdm:resource_legal_id_celex ?celex . }`,
    FICHA_TTL_MS
  );
  const modificaciones = await sparqlUE(
    PREFIJO_CDM +
      `SELECT DISTINCT ?celex WHERE { ?w cdm:resource_legal_id_celex ${lit} . ?m cdm:resource_legal_amends_resource_legal ?w ; cdm:resource_legal_id_celex ?celex . }`,
    FICHA_TTL_MS
  );
  const f0 = filas[0];
  const hoy = hoyISO().replace(/-/g, '');
  const consolidadas = versiones
    .map((v) => partesCelex(v.celex))
    .filter((v) => v && v.sector === '0' && v.version)
    .sort((a, b) => a.version.localeCompare(b.version));
  const vigor = f0.vigor === undefined ? null : f0.vigor === '1' || f0.vigor === 'true';
  return {
    celex: p.base,
    tipo: NOMBRE_TIPO_UE[p.tipo],
    titulos,
    fecha_documento: f0.fecha ? fmtFecha(f0.fecha.replace(/-/g, '')) : null,
    en_vigor: vigor,
    fin_de_vigencia: finDeVigenciaUE(f0.fin),
    versiones_consolidadas: consolidadas.map((v) => ({ celex: v.celex, desde: fmtFecha(v.version), futura: v.version > hoy })),
    modificada_por: modificaciones.map((m) => m.celex).filter((c) => RE_CELEX_UE.test(c)).sort(),
  };
}

/**
 * Resuelve una cita, unas siglas o un CELEX a la ficha del acto, comprobada
 * en CELLAR. null si ningún candidato existe (NO_RESUELTA, nunca una suposición).
 */
async function resolverNormaUE(texto) {
  const candidatos = celexDeCita(texto);
  for (const c of candidatos) {
    const ficha = await fichaActoUE(c);
    if (ficha) {
      const atajo = buscarAtajoUE(texto);
      return { ...ficha, resuelta_por: atajo ? 'atajo' : candidatos.length > 1 && c !== candidatos[0] ? 'número (orden alternativo año/número)' : 'número' };
    }
  }
  return null;
}

/**
 * Expresión (versión lingüística) de un CELEX en un idioma, con el formato que
 * hay que pedirle, o null si no existe en ese idioma. Se pide la expresión y no
 * un DOC_n concreto: una manifestación puede tener varios (imágenes incluidas) y
 * CELLAR redirige (303) al documento principal del formato pedido.
 */
async function documentoUE(celex, idioma) {
  const L = IDIOMAS_UE[idioma];
  const filas = await sparqlUE(
    PREFIJO_CDM +
      `SELECT DISTINCT ?e ?tipo WHERE { ?w cdm:resource_legal_id_celex "${celex}"${XSD_STRING} .
  ?e cdm:expression_belongs_to_work ?w ; cdm:expression_uses_language <${LENGUA_UE}${L.codigo}> .
  ?m cdm:manifestation_manifests_expression ?e ; cdm:manifestation_type ?tipo . FILTER(STR(?tipo) IN ("xhtml", "html")) }`,
    UE_TEXTO_TTL_MS
  );
  const validas = filas.filter((f) => f.e && /^https?:\/\/publications\.europa\.eu\/resource\/cellar\/[0-9a-f-]+\.\d+$/i.test(f.e));
  const elegida = validas.find((f) => f.tipo === 'xhtml') || validas[0];
  if (!elegida) return null;
  return { ruta: new URL(elegida.e).pathname, accept: elegida.tipo === 'xhtml' ? 'application/xhtml+xml' : 'text/html' };
}

// Fin del cuerpo de un artículo: siguiente artículo o el siguiente elemento de estructura
// (capítulo, sección, anexo, fórmula final, notas al pie).
const RE_CABECERA_ART_UE = /<p\b[^>]*class="(?:oj-ti-art|title-article-norm)"[^>]*>([\s\S]*?)<\/p>/g;
const RE_FIN_ART_UE = /class="(?:oj-ti-section-\d|oj-final|oj-note|oj-doc-end|title-division-\d|separator-annex|title-annex-\d|final|footnote)"|<hr\b/;
const RE_SUBTITULO_ART_UE = /^\s*(?:<\/?div[^>]*>\s*)*<p\b[^>]*class="(?:oj-sti-art|stitle-article-norm)"[^>]*>([\s\S]*?)<\/p>/;

function limpiarTextoUE(html) {
  return xmlATexto(
    String(html)
      .replace(/<p\b[^>]*class="modref"[^>]*>[\s\S]*?<\/p>/g, '')
      .replace(/<span\b[^>]*class="arrow"[^>]*>[\s\S]*?<\/span>/g, '')
  )
    .replace(/[►▼◄]\s*(?:[MABCR]\d*\b)?/g, '')
    .replace(/[ \t ]{2,}/g, ' ')
    .replace(/\n[ \t ]+/g, '\n')
    // El número de apartado o la letra van en su propia celda: "1.\n\nEl interesado..." -> "1. El interesado..."
    .replace(/^((?:\d+\.|\(?[a-z]{1,3}\)|\(?\d+\)))[ \t ]*\n+/gm, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Artículos de un XHTML de CELLAR (original "oj-*" o consolidado "*-norm"): [{ numero, titulo, texto }]. */
function articulosXhtmlUE(html) {
  const cuerpo = String(html);
  const cabeceras = [];
  let m;
  RE_CABECERA_ART_UE.lastIndex = 0;
  while ((m = RE_CABECERA_ART_UE.exec(cuerpo))) cabeceras.push({ ini: m.index, fin: RE_CABECERA_ART_UE.lastIndex, rotulo: limpiarTextoUE(m[1]) });
  if (!cabeceras.length) return articulosHtmlAntiguoUE(cuerpo);
  const out = [];
  cabeceras.forEach((c, i) => {
    const num = /^(?:art[íi]culo|article)\s+(.+)$/i.exec(c.rotulo.replace(/\s+/g, ' '));
    if (!num) return;
    let resto = cuerpo.slice(c.fin, i + 1 < cabeceras.length ? cabeceras[i + 1].ini : cuerpo.length);
    let titulo = null;
    const st = RE_SUBTITULO_ART_UE.exec(resto);
    if (st) {
      titulo = limpiarTextoUE(st[1]) || null;
      resto = resto.slice(st[0].length);
    }
    const corte = resto.search(RE_FIN_ART_UE);
    if (corte >= 0) resto = resto.slice(0, corte);
    out.push({ numero: num[1].trim(), titulo, texto: limpiarTextoUE(resto) });
  });
  return out;
}

// HTML antiguo de EUR-Lex (actos anteriores a ~2010, p. ej. la Directiva 95/46/CE):
// sin clases, cada artículo es un párrafo "<p>Artículo 2 </p>" y, si tiene título,
// el párrafo siguiente ("<p>Definiciones</p>").
const RE_CABECERA_ART_UE_ANTIGUA = /<p\b[^>]*>\s*((?:Art[íi]culo|Article)\s+\d+(?:\s*(?:bis|ter|quater|[a-z]))?)\s*<\/p>/gi;
const RE_FIN_ART_UE_ANTIGUO = /<p\b[^>]*>\s*(?:Hecho en|Done at)\b|<hr\b|<p\b[^>]*>\s*(?:ANEXO|ANNEX)\b/i;

function articulosHtmlAntiguoUE(cuerpo) {
  const cabeceras = [];
  let m;
  RE_CABECERA_ART_UE_ANTIGUA.lastIndex = 0;
  while ((m = RE_CABECERA_ART_UE_ANTIGUA.exec(cuerpo))) cabeceras.push({ ini: m.index, fin: RE_CABECERA_ART_UE_ANTIGUA.lastIndex, rotulo: m[1] });
  return cabeceras.map((c, i) => {
    let resto = cuerpo.slice(c.fin, i + 1 < cabeceras.length ? cabeceras[i + 1].ini : cuerpo.length);
    const corte = resto.search(RE_FIN_ART_UE_ANTIGUO);
    if (corte >= 0) resto = resto.slice(0, corte);
    let titulo = null;
    const st = /^\s*<p\b[^>]*>([^<]{1,150})<\/p>/.exec(resto);
    if (st && !/^\s*(?:\d|\(|[a-z]\))/.test(st[1]) && !/[.:;]\s*$/.test(st[1])) {
      titulo = limpiarTextoUE(st[1]) || null;
      resto = resto.slice(st[0].length);
    }
    return { numero: c.rotulo.replace(/^\S+\s+/, '').trim(), titulo, texto: limpiarTextoUE(resto) };
  });
}

/** "Artículo 17", "art. 17.1", "4 bis" -> "17" / "4 bis" (normalizado para comparar). */
function claveArticuloUE(s) {
  const t = norm(String(s || '').replace(/^\s*(?:art[íi]culos?|articles?|arts?\.?)\s*/i, ''));
  const m = /^(\d+)(?:\s*(bis|ter|quater|quinquies|sexies|septies|octies|[a-z]\b))?/.exec(t);
  return m ? (m[2] ? `${m[1]} ${m[2]}` : m[1]) : t;
}

async function articulosDocumentoUE(celex, idioma) {
  const key = `UEART|${celex}|${idioma}`;
  const mem = cacheGet(key);
  if (mem) return mem;
  const disco = cacheDiskGet(key, UE_TEXTO_TTL_MS);
  if (disco) { cacheSet(key, disco); return disco; }
  const doc = await documentoUE(celex, idioma);
  if (!doc) return null;
  const { status, body } = await httpGet(doc.ruta, doc.accept, 0, UE_HOST);
  if (status >= 400) throw new ApiError(status, `${UE_HOST} respondió ${status} al pedir el texto de ${celex}.`);
  const r = { celex, articulos: articulosXhtmlUE(body) };
  cacheSet(key, r);
  cacheDiskSet(key, r);
  return r;
}

/** Versión que rige hoy: la última consolidada con fecha ya pasada (puede haber futuras); si no hay, el original. */
function versionVigenteUE(ficha) {
  const pasadas = ficha.versiones_consolidadas.filter((v) => !v.futura);
  return pasadas.length ? pasadas[pasadas.length - 1] : null;
}

function cabeceraUE(ficha, idioma) {
  return {
    celex: ficha.celex,
    tipo: ficha.tipo,
    ...(conocidoComoUE(ficha.celex) ? { conocido_como: conocidoComoUE(ficha.celex) } : {}),
    titulo: ficha.titulos[idioma] || null,
    ...(idioma !== 'es' && ficha.titulos.es ? { titulo_es: ficha.titulos.es } : {}),
    fecha_documento: ficha.fecha_documento,
    en_vigor: ficha.en_vigor,
    fin_de_vigencia: ficha.fin_de_vigencia,
    ...enlacesUE(ficha.celex, idioma),
  };
}

/** Ficha para la herramienta ue_ficha_norma. */
async function fichaNormaUE(norma, idiomaPedido) {
  const idioma = idiomaUE(idiomaPedido);
  const ficha = await resolverNormaUE(norma);
  if (!ficha) return { estado: 'NO_RESUELTA', idioma, detalle: noResueltaUE(norma) };
  const vigente = versionVigenteUE(ficha);
  return {
    estado: ficha.en_vigor === false ? 'NORMA_NO_VIGENTE' : 'OK',
    idioma,
    resuelta_por: ficha.resuelta_por,
    ...cabeceraUE(ficha, idioma),
    ...(ficha.titulos[idioma] ? {} : { aviso_idioma: `CELLAR no tiene título en ${IDIOMAS_UE[idioma].nombre} para este acto.` }),
    version_consolidada_vigente: vigente ? { ...vigente, ...enlacesUE(vigente.celex, idioma), url_doue: undefined, eli: undefined } : null,
    versiones_consolidadas: ficha.versiones_consolidadas,
    modificada_por: ficha.modificada_por,
  };
}

function noResueltaUE(norma) {
  return `No he localizado en CELLAR (EUR-Lex) ningún acto que corresponda a "${norma}". Cita el tipo y el número tal como aparecen en el DOUE (p. ej. "Reglamento (UE) 2016/679", "Directiva 95/46/CE", "Reglamento (CE) n.º 44/2001") o el número CELEX. Los Tratados y la Carta de Derechos Fundamentales no están cubiertos.`;
}

/**
 * Texto de un artículo en la versión consolidada vigente hoy (o en el texto
 * original si no hay consolidada), en castellano o en inglés. Si el documento
 * no existe en ese idioma se dice, nunca se sirve otro idioma en su lugar.
 */
async function textoArticuloUE(norma, articulo, idiomaPedido) {
  const idioma = idiomaUE(idiomaPedido);
  const ficha = await resolverNormaUE(norma);
  if (!ficha) return { estado: 'NO_RESUELTA', idioma, detalle: noResueltaUE(norma) };
  const base = { idioma, resuelta_por: ficha.resuelta_por, ...cabeceraUE(ficha, idioma) };
  // Un acto derogado tiene como última versión consolidada una hoja sin articulado
  // (comprobado con la Directiva 95/46/CE, 01995L0046-20180525): se retrocede a la
  // versión anterior con texto y, si no hay ninguna, al original. Se dice siempre cuál.
  const pasadas = ficha.versiones_consolidadas.filter((v) => !v.futura).reverse();
  const candidatas = [...pasadas, null];
  let doc = null;
  let vigente = null;
  let sinArticulado = null;
  for (const v of candidatas) {
    const d = await articulosDocumentoUE(v ? v.celex : ficha.celex, idioma);
    if (!d) {
      if (v === pasadas[0] || (!pasadas.length && v === null)) {
        return {
          ...base,
          estado: 'IDIOMA_NO_DISPONIBLE',
          detalle: `CELLAR no tiene el texto ${v ? 'consolidado ' : ''}de ${v ? v.celex : ficha.celex} en ${IDIOMAS_UE[idioma].nombre}. Puedes pedirlo en ${idioma === 'es' ? 'inglés ("en")' : 'castellano ("es")'}.`,
        };
      }
      continue;
    }
    if (d.articulos.length) { doc = d; vigente = v; break; }
    if (!sinArticulado) sinArticulado = v ? v.celex : ficha.celex;
  }
  if (!doc) {
    return { ...base, estado: 'SIN_TEXTO', detalle: `CELLAR no devuelve articulado para ${ficha.celex} en ${IDIOMAS_UE[idioma].nombre}. Consulta el DOUE ("url_doue").` };
  }
  const version = vigente
    ? { version: 'texto consolidado', version_celex: vigente.celex, version_desde: vigente.desde, url_version: enlacesUE(vigente.celex, idioma).url }
    : { version: 'texto original publicado en el DOUE (sin versión consolidada)', version_celex: ficha.celex, version_desde: null };
  if (sinArticulado) version.aviso_version = `La versión ${sinArticulado} no tiene articulado (lo habitual cuando el acto ya está derogado): se muestra la última versión con texto.`;
  const clave = claveArticuloUE(articulo);
  const art = doc.articulos.find((a) => claveArticuloUE(a.numero) === clave);
  if (!art) {
    return {
      ...base,
      ...version,
      estado: 'ARTICULO_NO_ENCONTRADO',
      detalle: `El acto existe, pero su texto ${vigente ? 'consolidado' : 'original'} no tiene ningún artículo "${articulo}" (tiene ${doc.articulos.length} artículos).`,
    };
  }
  const futuras = ficha.versiones_consolidadas.filter((v) => v.futura);
  return {
    ...base,
    estado: ficha.en_vigor === false ? 'NORMA_NO_VIGENTE' : 'OK',
    ...version,
    nota_version: vigente
      ? 'version_desde es la fecha de la versión consolidada que rige hoy, no necesariamente la fecha en que cambió este artículo.'
      : 'No hay versión consolidada: es el texto tal como se publicó, sin las modificaciones posteriores que pueda haber (ver "modificada_por" en ue_ficha_norma).',
    ...(futuras.length ? { versiones_futuras: futuras.map((v) => v.desde) } : {}),
    articulo: `${IDIOMAS_UE[idioma].articulo} ${art.numero}`,
    articulo_titulo: art.titulo,
    texto: art.texto,
  };
}

/** Verificación de una cita (para ue_verificar_cita y para boe_verificar_cita/escrito). */
async function verificarCitaUE(norma, articulo, idiomaPedido) {
  if (!articulo) {
    const f = await fichaNormaUE(norma, idiomaPedido);
    if (f.estado === 'OK') f.estado = 'NORMA_VIGENTE';
    return { fuente: FUENTE_UE, ...f };
  }
  return { fuente: FUENTE_UE, ...(await textoArticuloUE(norma, articulo, idiomaPedido)) };
}

// Palabras vacías: el índice de texto de CELLAR se hunde con ellas (comprobado: "las" tardó 41 s).
const PALABRAS_VACIAS_UE = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'en', 'por', 'para', 'con', 'que', 'una', 'uno', 'unos', 'unas', 'sobre', 'al', 'se',
  'sus', 'como', 'entre', 'sin', 'este', 'esta', 'estos', 'estas', 'relativo', 'relativa', 'the', 'of', 'and', 'for', 'on', 'in',
  'to', 'with', 'by', 'from', 'an', 'or', 'its', 'which', 'that', 'laying', 'down', 'concerning', 'regard',
]);

/** Palabras de búsqueda para bif:contains: solo letras y números, sin palabras vacías; "*" final = prefijo. */
function palabrasBusquedaUE(texto) {
  return [...new Set(
    String(texto || '')
      .toLowerCase()
      .split(/\s+/)
      .map((w) => {
        const prefijo = /\*$/.test(w);
        const limpia = w.replace(/[^\p{L}\p{N}]/gu, '');
        return prefijo && limpia.length >= 4 ? limpia + '*' : limpia;
      })
      .filter((w) => w.replace('*', '').length >= 3 && !PALABRAS_VACIAS_UE.has(w))
  )].slice(0, 6);
}

/**
 * Búsqueda por palabras del título con el índice de texto de CELLAR
 * (`bif:contains` de Virtuoso), en castellano, en inglés o en los dos a la vez
 * (unión), devolviendo títulos y enlaces en `idioma`. Medido el 03/11/2026: todo
 * el periodo (1952-hoy) en 0,1-0,5 s casi siempre, frente a 20-25 s con
 * FILTER(CONTAINS(...)), que obligaba a trocear en tramos de 5 años; por eso tipo y
 * años son opcionales. Buscar en los dos idiomas da más que cualquiera solo:
 * "crédito consumo" + "consum* credit" encuentra seis directivas; solo en inglés,
 * "consumer credit" se dejaba la 2008/48 y la 2023/2225 ("credit agreements for
 * consumers"). El índice distingue tildes y no admite comillas: de cada palabra
 * solo pasan letras y números (sin inyección posible).
 */
async function buscarNormasUE(p = {}) {
  const idioma = idiomaUE(p.idioma);
  const tipos = { reglamento: 'R', directiva: 'L', decision: 'D', regulation: 'R', directive: 'L' };
  let tipo = null;
  if (p.tipo !== undefined && p.tipo !== null && p.tipo !== '') {
    tipo = tipos[norm(p.tipo)];
    if (!tipo) throw new Error('tipo no válido: "reglamento", "directiva" o "decision" (o déjalo vacío para los tres).');
  }
  const vacio = (v) => v === undefined || v === null || v === '';
  const anioMax = new Date().getFullYear() + 1;
  const desde = vacio(p.anio_desde) ? null : Number(p.anio_desde);
  const hasta = vacio(p.anio_hasta) ? desde : Number(p.anio_hasta);
  if ((desde !== null && (!Number.isInteger(desde) || desde < 1952 || desde > anioMax)) ||
      (hasta !== null && (!Number.isInteger(hasta) || hasta < 1952 || hasta > anioMax)) ||
      (desde !== null && hasta !== null && hasta < desde)) {
    throw new Error('anio_desde y anio_hasta, si se dan, deben ser años válidos, con anio_hasta >= anio_desde.');
  }
  // "texto" se admite como sinónimo de "texto_es".
  const palabras = { es: palabrasBusquedaUE(vacio(p.texto_es) ? p.texto : p.texto_es), en: palabrasBusquedaUE(p.texto_en) };
  const ramas = Object.entries(palabras).filter(([, ws]) => ws.length);
  if (!ramas.length) throw new Error('Hacen falta palabras del título: "texto_es" (en castellano), "texto_en" (en inglés) o las dos, con al menos una palabra significativa de 3 letras o más.');
  const limite = Math.min(Math.max(Number(p.limite) || 20, 1), 50);
  const filtroFechas = [
    desde !== null ? `?fecha >= "${desde}-01-01"^^<http://www.w3.org/2001/XMLSchema#date>` : null,
    hasta !== null ? `?fecha <= "${hasta}-12-31"^^<http://www.w3.org/2001/XMLSchema#date>` : null,
  ].filter(Boolean);
  const rama = ([lengua, ws]) =>
    `{ ?eb cdm:expression_title ?tb . ?tb bif:contains '${ws.map((w) => `"${w}"`).join(' AND ')}' .
    ?eb cdm:expression_uses_language <${LENGUA_UE}${IDIOMAS_UE[lengua].codigo}> ; cdm:expression_belongs_to_work ?w . BIND("${lengua}" AS ?por) }`;
  const filas = await sparqlUE(
    PREFIJO_CDM +
      `SELECT DISTINCT ?celex ?por ?titulo ?fecha ?vigor ?fin WHERE {
  ${ramas.map(rama).join('\n  UNION\n  ')}
  ?w cdm:resource_legal_id_celex ?celex ; cdm:work_date_document ?fecha .
  FILTER(STRLEN(STR(?celex)) = 10 && STRSTARTS(STR(?celex), "3")${tipo ? ` && SUBSTR(STR(?celex), 6, 1) = "${tipo}"` : ''})
  ${filtroFechas.length ? `FILTER(${filtroFechas.join(' && ')})` : ''}
  OPTIONAL { ?w cdm:resource_legal_in-force ?vigor }
  OPTIONAL { ?w cdm:resource_legal_date_end-of-validity ?fin }
  OPTIONAL { ?e cdm:expression_belongs_to_work ?w ; cdm:expression_uses_language <${LENGUA_UE}${IDIOMAS_UE[idioma].codigo}> ; cdm:expression_title ?titulo . }
} ORDER BY DESC(?fecha) LIMIT ${(limite + 1) * ramas.length}`,
    BUSQUEDA_TTL_MS,
    { timeoutMs: UE_BUSQUEDA_TIMEOUT_MS, reintentarTimeout: true }
  );
  // Una fila por acto e idioma en que coincidió: se agrupan conservando el orden (más recientes primero).
  const porCelex = new Map();
  for (const f of filas) {
    if (!RE_CELEX_UE.test(f.celex || '')) continue;
    const previa = porCelex.get(f.celex);
    if (previa) { if (!previa.por.includes(f.por)) previa.por.push(f.por); continue; }
    porCelex.set(f.celex, { ...f, por: [f.por] });
  }
  const todas = [...porCelex.values()];
  const normas = todas.slice(0, limite).map((f) => ({
    celex: f.celex,
    tipo: NOMBRE_TIPO_UE[partesCelex(f.celex).tipo],
    ...(conocidoComoUE(f.celex) ? { conocido_como: conocidoComoUE(f.celex) } : {}),
    titulo: f.titulo || null,
    ...(f.titulo ? {} : { aviso_idioma: `CELLAR no tiene título en ${IDIOMAS_UE[idioma].nombre} para este acto.` }),
    fecha_documento: f.fecha ? fmtFecha(f.fecha.replace(/-/g, '')) : null,
    en_vigor: f.vigor === undefined ? null : f.vigor === '1' || f.vigor === 'true',
    // Sin esto, ante un acto "no vigente" Claude ponía la fecha de memoria (prueba real del 03/11/2026, Bruselas II bis).
    fin_de_vigencia: finDeVigenciaUE(f.fin),
    encontrada_por: f.por.map((l) => IDIOMAS_UE[l].nombre),
    ...enlacesUE(f.celex, idioma),
  }));
  return {
    idioma,
    tipo: tipo ? NOMBRE_TIPO_UE[tipo] : 'reglamentos, directivas y decisiones',
    anios: desde === null && hasta === null ? 'todos' : `${desde ?? 'inicio'}-${hasta ?? 'hoy'}`,
    palabras: Object.fromEntries(ramas),
    resultados: normas.length,
    hay_mas: todas.length > limite || filas.length >= (limite + 1) * ramas.length,
    normas,
  };
}

/* ------------------------------------------------------------------ */
/* Fase 2: extracción y verificación de citas                          */
/* ------------------------------------------------------------------ */

const ORDINAL = '(?:\\s*(?:bis|ter|qu[aá]ter|quinquies|sexies|septies|octies))?';

// El "hint" (nombre de la norma) se captura en LOOKAHEAD: así no consume texto
// y no se pierde la cita que venga justo detrás.
// Tras el número, el espacio no cruza "\\n" ([^\\S\\n] = espacio salvo salto):
// extraerCitas ya une los saltos de línea simples, así que cualquier "\\n" que
// quede es un cambio de párrafo, y lo que venga después no es la norma citada.
const RE_ARTICULO = new RegExp(
  `\\b(?:art[íi]culos?|arts?\\.)\\s*(\\d+${ORDINAL}(?:\\.\\d+)*${ORDINAL})[^\\S\\n]*(?:[ºo°][^\\S\\n]*)?` +
    `(?:,?[^\\S\\n]*(?:de[^\\S\\n]+l[ao]s?|del|de)[^\\S\\n]+)?(?=([^;.()\\n]{0,80}))`,
  'gi'
);

// Enumeraciones encadenadas: "arts. 9, 10 y 11 del ET"
const RE_ENUM = new RegExp(`^\\s*(?:,|;)?\\s*(?:y|e)?\\s*(\\d+${ORDINAL}(?:\\.\\d+)*)\\s*`, 'i');

const RE_NORMA_SUELTA =
  /\b(Ley\s+Org[áa]nica|Real\s+Decreto[-\s]?ley|Real\s+Decreto\s+Legislativo|Real\s+Decreto|Ley)\s+(\d+\/\d{4})/gi;

// Órdenes, Resoluciones y Decretos autonómicos se citan por fecha, no por número
// oficial ("Orden de 4 de mayo de 2009..."): sin esto, una cita así no se detecta
// nunca, porque no encaja en RE_ARTICULO (no lleva "art. N" delante) ni en
// RE_NORMA_SUELTA (no lleva "N/AAAA"). Es el único patrón que hace resoluble una
// norma vía verificarCitaEuskadi. El contexto tras la fecha (lookahead, como en
// RE_ARTICULO) se guarda aparte para desambiguar cuando varios departamentos
// publican una norma del mismo tipo el mismo día — la etiqueta que se muestra al
// usuario se queda solo con la fecha.
const RE_NORMA_POR_FECHA = new RegExp(
  '\\b((?:Orden|Resoluci[óo]n|Decreto(?:\\s+Legislativo)?|Ley(?:\\s+Foral)?)\\s+de\\s+\\d{1,2}\\s+de\\s+[a-záéíóúñ]+\\s+de\\s+\\d{4})\\b' +
    '(?=([^;.()\\n]{0,100}))',
  'gi'
);

// Actos de la UE (1.7.0). "Reglamento (UE) n.º 1215/2012" no cabe en el contexto de
// RE_ARTICULO, que se corta en "(" y en "." para no saltar a otra frase; antes de
// buscar citas se reescribe como "Reglamento UE 1215/2012" (sin paréntesis ni "n.º").
const RE_ACTO_UE_NORMALIZAR =
  /\b(Reglamento|Directiva|Decisi[óo]n)((?:\s+(?:Delegad[oa]|de\s+Ejecuci[óo]n))?)\s*\(\s*(UE|CE|CEE|Euratom)(\s*,\s*Euratom)?\s*\)\s*(?:(?:n\.?\s*[ºo°]|núm)\.?\s*)?/gi;
const RE_NORMA_UE =
  /\b(?:Reglamento|Directiva|Decisi[óo]n)(?:\s+(?:Delegad[oa]|de\s+Ejecuci[óo]n))?\s+(?:UE|CE|CEE|Euratom)(?:\s+Euratom)?\s+\d{1,4}\/\d{1,4}\b|\bDirectiva\s+\d{2,4}\/\d{1,4}\/(?:UE|CE|CEE)\b/gi;

/** Limpia el fragmento que sigue a un artículo hasta dejar el nombre de la norma. */
function limpiarHint(s) {
  let h = String(s || '').replace(/\s+/g, ' ');
  const cortes = [
    /\b(?:art[íi]culos?|arts?\.)/i,
    // Hallazgo de gravedad baja (revisión 21/09/2026): "y al"/"y del" (formas
    // contraídas de "y a el"/"y de el") no se reconocían como conector hacia
    // OTRA cita -- caso real: "art. 1.902 CC y al artículo 1.544..." dejaba
    // la etiqueta con basura pegada al final ("art. 1.902 CC y al") en vez
    // de cortar en "CC", porque el corte de "artículo" ya había pasado y
    // solo quedaba "y al" suelto sin más regla que lo recortase.
    // Excepción: "...de Régimen Jurídico de las Administraciones Públicas y
    // del Procedimiento Administrativo Común" (Ley 30/1992) es título oficial.
    /\s+(?:y|e)\s+(?:el|la|los|las|al|del)\s+(?!Procedimiento\s+Administrativo\b)/i,
    /\s+as[íi]\s+como\s+/i,
    /\s+en\s+relaci[óo]n\s+/i,
    // Conectores que abren OTRA referencia sin pasar por "y el"/"y al":
    // "...ET y con el art. 5...", "...ET conforme a la Ley 30/1992".
    /\s+(?:y|e)\s+(?:con|en|seg[uú]n|conforme|a\s+(?:el|la|los|las))\s+/i,
    // "...art. 34 del ET y por la Ley 30/1992" (14/10/2026): "y por" no
    // encajaba en ninguna regla y la etiqueta arrastraba la otra ley, cuyo
    // número ganaba en resolverNorma (B2). Se respeta "y por el/la que...",
    // que sí es título oficial ("Real Decreto ..., por el que se aprueba ...
    // y por el que se regula ...").
    /\s+(?:y|e)\s+por\s+(?:el|la|los|las|lo)\s+(?!(?:que|cual(?:es)?)\b)/i,
    /\s+(?:conforme\s+a|seg[uú]n|de\s+acuerdo\s+con|de\s+conformidad\s+con|en\s+virtud\s+de)\s+/i,
    // Coma: antes solo se cortaba en " ," (espacio ANTES de la coma, que casi
    // nadie escribe), así que "art. 9999 del Estatuto de los Trabajadores,
    // conforme a la Ley 30/1992" dejaba como norma "Estatuto de los
    // Trabajadores, conforme a la Ley 30/1992" -- y en resolverNorma el
    // número oficial gana (B2), con lo que la cita se verificaba contra la
    // Ley 30/1992 en vez de contra el ET. Ahora se corta en cualquier coma
    // SALVO que lo que sigue sea continuación del título oficial de la
    // propia norma (", de 1 de octubre", ", de reforma de...", ", del
    // Procedimiento...", ", por el que se aprueba...", ", sobre...",
    // ", reguladora de..."): ahí el número que aparezca sí es el de la norma
    // citada y debe seguir ganando. ", de acuerdo con"/", de conformidad
    // con"... empiezan por "de" pero no son título, y sí se cortan.
    new RegExp(
      '\\s*,(?!\\s*(?:' +
        'del(?!\\s+mismo\\b)|sobre|reguladora?|regulador|relativ[ao]|general|org[áa]nica|' +
        'para(?!\\s+(?:ello|eso|esto)\\b)|por\\s+(?:el|la|los|las)\\s+que|' +
        'de(?!\\s+(?:acuerdo|conformidad|modo|forma|manera|lo|nuevo|hecho|igual|otr[ao]s?|ah[ií]|ser|haber)\\b)' +
        ')\\b)',
      'i'
    ),
  ];
  for (const c of cortes) {
    const i = h.search(c);
    if (i > 0) h = h.slice(0, i);
  }
  return h
    .replace(/^\s*(?:de\s+l[ao]s?|del|de|,)\s+/i, '')
    .replace(/\s+\b(?:arts?|y|e|o)\s*$/i, '')
    .trim()
    .slice(0, 70);
}

function extraerCitas(texto) {
  // Un salto de línea SIMPLE (ajuste de línea de un escrito pegado) no separa
  // citas: "arts. 1902 y 1903⏎    del Código Civil" es una sola. Como los
  // patrones de contexto no cruzan "\n" (para no saltar a otro párrafo),
  // antes esa cita se quedaba sin norma y salía NO_RESUELTA. Se une la línea
  // con un espacio (absorbiendo la sangría, que si no se comería la ventana
  // de contexto); una línea en blanco sigue siendo un corte de párrafo.
  texto = String(texto || '')
    .replace(/[ \t]*\r?\n(?![ \t]*\r?\n)[ \t]*/g, ' ')
    .replace(RE_ACTO_UE_NORMALIZAR, (_, tipo, sub, org, euratom) => `${tipo}${sub} ${org}${euratom ? ' Euratom' : ''} `);
  const citas = [];
  const vistos = new Set();
  let m;

  RE_ARTICULO.lastIndex = 0;
  while ((m = RE_ARTICULO.exec(texto))) {
    const numeros = [m[1].replace(/\s+/g, ' ').trim()];
    let resto = m[2] || '';

    // Absorbe "…, 10 y 11" antes de quedarse con el nombre de la norma.
    let mm;
    while ((mm = RE_ENUM.exec(resto)) && numeros.length < 12) {
      numeros.push(mm[1].replace(/\s+/g, ' ').trim());
      resto = resto.slice(mm[0].length);
    }
    const hint = limpiarHint(resto);

    for (const articulo of numeros) {
      const clave = `A|${norm(articulo)}|${norm(hint)}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      citas.push({
        tipo: 'articulo',
        cita: `art. ${articulo}${hint ? ' ' + hint : ''}`,
        articulo,
        norma_texto: hint,
      });
    }
  }

  RE_NORMA_SUELTA.lastIndex = 0;
  while ((m = RE_NORMA_SUELTA.exec(texto))) {
    const clave = `N|${norm(m[2])}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    citas.push({ tipo: 'norma', cita: m[0].trim(), numero_oficial: m[2] });
  }

  RE_NORMA_UE.lastIndex = 0;
  while ((m = RE_NORMA_UE.exec(texto))) {
    const etiqueta = m[0].replace(/\s+/g, ' ').trim();
    const clave = `U|${celexDeCita(etiqueta)[0] || norm(etiqueta)}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    citas.push({ tipo: 'norma', cita: etiqueta, numero_oficial: etiqueta });
  }

  RE_NORMA_POR_FECHA.lastIndex = 0;
  while ((m = RE_NORMA_POR_FECHA.exec(texto))) {
    const etiqueta = m[1].trim();
    const clave = `F|${norm(etiqueta)}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const contexto = (etiqueta + ' ' + (m[2] || '')).slice(0, 160).trim();
    citas.push({ tipo: 'norma', cita: etiqueta, numero_oficial: contexto });
  }
  return citas;
}

// B7: `fichaNorma` ya traía `anulada` y `vigencia_agotada`, pero `estado` solo
// miraba `derogada` -- una norma ANULADA (nula desde el origen, p. ej. por el
// Tribunal Constitucional -- distinto de "derogada", que es sustituida por una
// norma posterior) o con la VIGENCIA AGOTADA (una medida temporal cuyo plazo ya
// pasó) se daba igual como "OK"/"NORMA_VIGENTE", con el dato solo disponible
// como un booleano suelto que era fácil pasar por alto. Prioridad: anulada (más
// grave: nunca debió aplicarse) > derogada > vigencia agotada > vigente.
function estadoBaseNorma(ficha) {
  if (ficha.anulada) return 'NORMA_ANULADA';
  if (ficha.derogada) return 'NORMA_DEROGADA';
  if (ficha.vigencia_agotada) return 'VIGENCIA_AGOTADA';
  return null;
}

async function verificarCita(nombreNorma, articulo) {
  const ficha = await resolverNorma(nombreNorma);
  if (!ficha) {
    return {
      estado: 'NO_RESUELTA',
      detalle: `No he localizado ninguna norma consolidada que corresponda a "${nombreNorma}". Puede que no esté consolidada en el BOE (p. ej. normativa autonómica no incluida) o que la referencia sea incorrecta.`,
    };
  }

  const base = {
    norma: ficha.titulo,
    norma_id: ficha.id,
    resuelta_por: ficha.origen,
    derogada: ficha.derogada,
    fecha_derogacion: ficha.fecha_derogacion,
    anulada: ficha.anulada,
    vigencia_agotada: ficha.vigencia_agotada,
    eli: ficha.eli,
    url: ficha.url,
  };

  if (!articulo) {
    return { ...base, estado: estadoBaseNorma(ficha) || 'NORMA_VIGENTE' };
  }

  const indice = await indiceNorma(ficha.id);
  const loc = localizarBloque(indice, articulo);
  if (!loc) {
    return {
      ...base,
      estado: 'ARTICULO_NO_ENCONTRADO',
      detalle: `La norma existe, pero no contiene ningún bloque que corresponda a "${articulo}". Revise la numeración.`,
    };
  }

  const cuerpo = await textoBloque(ficha.id, loc.bloque);
  // B6: si a única redacción dispoñible aínda non entrou en vigor (a súa
  // `fecha_vigencia` é futura), NON se pode dar coma "OK" -- avísase con
  // `AUN_NO_VIGENTE` en vez de afirmar que xa se aplica hoxe.
  let estado = estadoBaseNorma(ficha) || 'OK';
  if (estado === 'OK' && cuerpo && cuerpo.aun_no_vigente) estado = 'AUN_NO_VIGENTE';
  return {
    ...base,
    estado,
    articulo_titulo: loc.titulo,
    coincidencia: loc.exacto ? 'exacta' : 'aproximada',
    version_desde: cuerpo && cuerpo.version_desde,
    texto: cuerpo && cuerpo.texto,
    ...(estado === 'AUN_NO_VIGENTE'
      ? { aviso_vigencia: `Esta redacción entra en vigor el ${cuerpo.version_desde}, aún no vigente hoy (${fmtFecha(hoyISO().replace(/-/g, ''))}).` }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Fase 2b: verificación de citas contra el BOPV (Open Data Euskadi)   */
/*                                                                      */
/* La API del BOPV no busca por título, así que aquí no hay equivalente */
/* a resolverNorma(): la única vía es que la propia cita traiga la      */
/* fecha de la disposición ("Orden de 4 de mayo de 2009, del..."), que  */
/* es justo como se citan estas normas en la práctica. Sin fecha, no    */
/* hay forma de resolverla — se devuelve NO_RESUELTA, no un error.      */
/* ------------------------------------------------------------------ */

const MESES_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const RE_FECHA_LARGA = /\b(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})\b/i;

function extraerFechaLarga(texto) {
  const m = RE_FECHA_LARGA.exec(String(texto || ''));
  if (!m) return null;
  const mes = MESES_ES[norm(m[2])];
  if (!mes) return null;
  return { dia: Number(m[1]), mes, anio: Number(m[3]) };
}

function fechaISO(dia, mes, anio) {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Busca, en el mes de la disposición y en el siguiente (por si la publicación
 * en el BOPV se retrasó respecto a la fecha de la norma), el acto cuya
 * `fecha_disposicion` coincide exactamente con la fecha citada. Si hay varias
 * el mismo día, afina por tipo de norma (Orden/Resolución/Decreto/Ley) si la
 * cita lo menciona.
 */
const STOPWORDS_ES = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'a', 'al', 'por', 'que',
  'se', 'con', 'para', 'su', 'sus', 'un', 'una', 'e', 'o', 'u',
]);

/** Nº de palabras significativas compartidas entre dos textos (heurística de desempate). */
function solapamientoPalabras(a, b) {
  const palabras = (s) => new Set(norm(s).split(/\W+/).filter((w) => w.length > 2 && !STOPWORDS_ES.has(w)));
  const setA = palabras(a);
  const setB = palabras(b);
  let comunes = 0;
  for (const w of setA) if (setB.has(w)) comunes++;
  return comunes;
}

// B4: Open Data Euskadi solo tiene disposiciones del Gobierno Vasco -- una
// cita que ya menciona explícitamente un MINISTERIO (Gobierno de España) no
// puede ser suya nunca, aunque coincida la fecha exacta. Caso real: "Orden
// de 4 de mayo de 2009, del Ministerio de Trabajo e Inmigración" acababa
// resolviéndose como una orden distinta del mismo día, del Consejero vasco
// de Vivienda -- la única señal que se comprobaba era la fecha (y, si había
// varios candidatos ese día, el tipo de norma), nunca el órgano que la dicta.
const _RE_ORGANO_ESTATAL = /\bministerio\b/i;

async function resolverNormaEuskadi(nombreNorma) {
  if (_RE_ORGANO_ESTATAL.test(nombreNorma)) return null;
  const fecha = extraerFechaLarga(nombreNorma);
  if (!fecha) return null;
  const objetivo = fechaISO(fecha.dia, fecha.mes, fecha.anio);
  const tipoMatch = /\b(orden|resoluci[óo]n|decreto\s+legislativo|decreto|ley)\b/i.exec(nombreNorma);

  for (let i = 0; i < 2; i++) {
    const total = (fecha.anio * 12 + (fecha.mes - 1)) + i;
    const anio = Math.floor(total / 12);
    const mes = (total % 12) + 1;
    const candidatos = [];
    let pagina = 1;
    let totalPaginas = 1;
    do {
      const r = await buscarNormativaEuskadi({ anio, mes, limite: 50, pagina });
      candidatos.push(...r.normas);
      totalPaginas = r.totalPaginas || 1;
      pagina++;
    } while (pagina <= totalPaginas && pagina <= 20);

    let coincidencias = candidatos.filter((c) => c.fecha_disposicion === objetivo);
    if (coincidencias.length > 1 && tipoMatch) {
      const tipoNorm = norm(tipoMatch[1]).split(' ')[0];
      const fino = coincidencias.filter((c) => norm(c.rango).includes(tipoNorm));
      if (fino.length) coincidencias = fino;
    }
    // Varias del mismo día y tipo (frecuente: distintos departamentos publican el
    // mismo día): nos quedamos con la que más palabras significativas comparte con
    // la cita completa (título, órgano...), no con la primera que llegue.
    if (coincidencias.length > 1) {
      coincidencias.sort((x, y) => solapamientoPalabras(nombreNorma, y.titulo) - solapamientoPalabras(nombreNorma, x.titulo));
    }
    if (coincidencias.length) return coincidencias[0];
  }
  return null;
}

async function verificarCitaEuskadi(nombreNorma, articulo) {
  const acto = await resolverNormaEuskadi(nombreNorma);
  if (!acto) {
    return {
      fuente: 'Open Data Euskadi · BOPV (Gobierno Vasco)',
      estado: 'NO_RESUELTA',
      detalle: `No he localizado ninguna disposición del BOPV cuya fecha de disposición corresponda a "${nombreNorma}". O no es del País Vasco, o la fecha citada no coincide, o se publicó más de un mes después de firmarse.`,
    };
  }
  const ficha = await textoNormativaEuskadi(acto.id);
  // B8: el BOPV puede traer estados distintos de "Vigente" que NO son
  // "Derogada" (p. ej. la propia API solo se vio devolver "Vigente" en el
  // muestreo hecho, pero el campo es texto libre del organismo vasco, no un
  // enum cerrado) -- afirmar "DEROGADA" para cualquier cosa que no sea
  // literalmente "Vigente" sería inventar (regla 4). Solo se marca DEROGADA
  // si el propio texto lo dice con claridad; cualquier otro valor se deja
  // explícito, sin traducirlo a un estado que no se ha podido confirmar.
  const vigenciaNorm = norm(ficha.vigencia);
  const vigente = vigenciaNorm === 'vigente';
  const derogada = /derogad|anulad|sin efecto|no vigente|caducad/.test(vigenciaNorm);
  const base = {
    fuente: 'Open Data Euskadi · BOPV (Gobierno Vasco)',
    norma: ficha.titulo,
    norma_id: ficha.id,
    vigencia: ficha.vigencia,
    url: ficha.url,
  };
  const estadoPorVigencia = (siOk) => {
    if (vigente) return siOk;
    if (derogada) return 'NORMA_DEROGADA';
    return 'ESTADO_INCIERTO';
  };
  const detalleIncierto = vigente || derogada
    ? undefined
    : `El BOPV da como estado "${ficha.vigencia}", que no se reconoce como "vigente" ni como derogada/anulada -- revísalo a mano en la URL antes de dar la norma por aplicable.`;

  if (!articulo) {
    return { ...base, estado: estadoPorVigencia('NORMA_VIGENTE'), ...(detalleIncierto ? { detalle: detalleIncierto } : {}) };
  }

  const re = new RegExp(`\\bArt[íi]culo\\s+${escRegExp(articulo)}\\b`, 'i');
  const idx = (ficha.texto || '').search(re);
  if (idx < 0) {
    return {
      ...base,
      estado: 'ARTICULO_NO_ENCONTRADO',
      detalle: `La disposición existe, pero no se ha localizado un "Artículo ${articulo}" en su texto. Muchas disposiciones del BOPV no se numeran en artículos (van por apartados "Primero/Segundo..."); revísalo a mano en la URL.`,
    };
  }
  return {
    ...base,
    estado: estadoPorVigencia('OK'),
    ...(detalleIncierto ? { detalle: detalleIncierto } : {}),
    texto: ficha.texto.slice(idx, idx + 2500).trim(),
  };
}

/**
 * Verifica una cita contra el BOE primero; si no se resuelve, lo intenta
 * contra el BOPV (solo posible si la cita trae fecha de disposición). Cada
 * resultado lleva su propio `fuente` — nunca se etiqueta como BOE lo que
 * vino de Euskadi, ni al revés (regla 7 de CLAUDE.md).
 */
async function verificarCitaMultifuente(nombreNorma, articulo) {
  // Un acto de la UE no está en el BOE consolidado ni en el BOPV: va directo a CELLAR.
  if (esCitaUE(nombreNorma)) {
    try {
      return await verificarCitaUE(nombreNorma, articulo, 'es');
    } catch (e) {
      // La app de escritorio repite la lista de hosts como segunda barrera y, mientras
      // no incluya la UE, una cita europea se queda sin resolver, como antes de la 1.7.0.
      if (!/host no permitido/.test(e.message)) throw e;
      return { fuente: FUENTE_UE, estado: 'NO_RESUELTA', detalle: `"${nombreNorma}" es un acto de la Unión Europea y la consulta de normativa europea no está disponible aquí.` };
    }
  }
  const rBoe = await verificarCita(nombreNorma, articulo);
  if (rBoe.estado !== 'NO_RESUELTA') return { fuente: 'BOE · legislación consolidada', ...rBoe };

  const rEuskadi = await verificarCitaEuskadi(nombreNorma, articulo);
  if (rEuskadi.estado !== 'NO_RESUELTA') return rEuskadi;

  return {
    fuente: 'BOE · legislación consolidada + Open Data Euskadi · BOPV',
    estado: 'NO_RESUELTA',
    detalle: `No he localizado ninguna norma que corresponda a "${nombreNorma}" ni en el BOE ni en el BOPV (Open Data Euskadi). Puede ser de otra comunidad autónoma no integrada en este conector, o la referencia puede ser incorrecta.`,
  };
}

/**
 * Verifica todas las citas de normas de un escrito (bucle compartido por la
 * herramienta MCP boe_verificar_escrito y la pantalla "Verificar escrito" de
 * la app). Cada resultado lleva su propio `fuente` (BOE o BOPV).
 */
async function verificarEscrito(texto, { maximo = 25, incluirTexto = false } = {}) {
  const max = Math.min(Math.max(Number(maximo) || 25, 1), 60);
  const citas = extraerCitas(String(texto || '')).slice(0, max);
  const resultados = [];
  for (const c of citas) {
    try {
      const r =
        c.tipo === 'articulo'
          ? await verificarCitaMultifuente(c.norma_texto || '', c.articulo)
          : await verificarCitaMultifuente(c.numero_oficial, null);
      if (!incluirTexto) delete r.texto;
      resultados.push({ cita: c.cita, ...r });
    } catch (e) {
      resultados.push({ cita: c.cita, estado: 'ERROR', detalle: e.message });
    }
  }
  const cuenta = (s) => resultados.filter((r) => r.estado === s).length;
  return {
    citas_detectadas: citas.length,
    resumen: {
      correctas: cuenta('OK') + cuenta('NORMA_VIGENTE'),
      normas_derogadas: cuenta('NORMA_DEROGADA') + cuenta('NORMA_NO_VIGENTE'),
      articulos_inexistentes: cuenta('ARTICULO_NO_ENCONTRADO'),
      no_resueltas: cuenta('NO_RESUELTA') + cuenta('IDIOMA_NO_DISPONIBLE'),
      errores: cuenta('ERROR'),
    },
    detalle: resultados,
  };
}

/* ------------------------------------------------------------------ */
/* Citas de jurisprudencia: solo DETECTARLAS, nunca verificarlas       */
/*                                                                      */
/* Las sentencias del Supremo, la Audiencia Nacional, los TSJ y las    */
/* Audiencias Provinciales solo se comprueban en el CENDOJ (fuera de    */
/* este núcleo, regla 2). Esto se limita a localizar la referencia tal  */
/* como está escrita para listarla aparte como "no verificada"; no      */
/* devuelve nada sobre su contenido, fecha ni ponente. Las del TC se    */
/* marcan aparte porque sí son consultables (BOE, sumario diario).      */
/* No forma parte de extraerCitas: la salida de boe_verificar_escrito   */
/* no cambia.                                                           */
/* ------------------------------------------------------------------ */

const TRIBUNAL_POR_SIGLA = {
  STS: 'TS', ATS: 'TS', SAN: 'AN', AAN: 'AN', STSJ: 'TSJ', ATSJ: 'TSJ', SAP: 'AP', AAP: 'AP', STC: 'TC', ATC: 'TC', SSTC: 'TC', SSTS: 'TS',
};
const RE_FECHA_O_NUMERO = /\d{1,5}\/\d{4}|\bde\s+\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}/i;
// Siglas en mayúsculas (case-sensitive: "san" o "sap" en minúsculas no son citas).
const RE_JURIS_SIGLA = /\b(SSTS|SSTC|STSJ|ATSJ|STS|ATS|SAN|AAN|SAP|AAP|STC|ATC)\b\.?(?=([^;\n]{0,70}))/g;
const RE_JURIS_LARGA = new RegExp(
  '\\b(?:sentencia|auto)\\s+(?:n[úu]m(?:ero|\\.)?\\s*\\d{1,5}\\/\\d{4},?\\s+)?(?:de\\s+la\\s+|del\\s+)' +
    '(Tribunal\\s+Supremo|Audiencia\\s+Nacional|Tribunal\\s+Superior\\s+de\\s+Justicia|Audiencia\\s+Provincial|Tribunal\\s+Constitucional)' +
    '(?=([^;\\n]{0,90}))',
  'gi'
);
const RE_ECLI = /\bECLI:ES:(TS|AN|TSJ[A-Z]*|AP[A-Z]*|TC):\d{4}:\d+[A-Z]?\b/g;

function extraerCitasJurisprudencia(texto) {
  const t = String(texto || '');
  const out = [];
  const vistos = new Set();
  const anadir = (tribunal, cita) => {
    const c = cita.replace(/\s+/g, ' ').trim().replace(/[,\s]+$/, '');
    const clave = norm(c);
    if (vistos.has(clave)) return;
    vistos.add(clave);
    out.push({ tipo: 'jurisprudencia', tribunal, cita: c });
  };
  // Etiqueta = desde el inicio hasta el primer número N/AAAA o fecha larga, si
  // aparece cerca; si no aparece ninguno, no se considera una cita.
  const etiqueta = (inicio, resto) => {
    // No saltar a la frase siguiente: "La STS citada. La Ley 3/2015…" no es una cita.
    const fin = resto.search(/\.\s+[A-ZÁÉÍÓÚÑ]/);
    if (fin >= 0) resto = resto.slice(0, fin);
    const m = RE_FECHA_O_NUMERO.exec(resto);
    return m ? inicio + resto.slice(0, m.index + m[0].length) : null;
  };
  let m;
  RE_JURIS_SIGLA.lastIndex = 0;
  while ((m = RE_JURIS_SIGLA.exec(t))) {
    const e = etiqueta(m[0], m[2] || '');
    if (e) anadir(TRIBUNAL_POR_SIGLA[m[1]], e);
  }
  RE_JURIS_LARGA.lastIndex = 0;
  while ((m = RE_JURIS_LARGA.exec(t))) {
    const e = etiqueta(m[0], m[2] || '');
    const n = norm(m[1]);
    const tribunal = n.includes('supremo') ? 'TS' : n.includes('nacional') ? 'AN' : n.includes('superior') ? 'TSJ' : n.includes('provincial') ? 'AP' : 'TC';
    if (e) anadir(tribunal, e);
  }
  RE_ECLI.lastIndex = 0;
  while ((m = RE_ECLI.exec(t))) {
    const s = m[1];
    anadir(s === 'TS' ? 'TS' : s === 'AN' ? 'AN' : s === 'TC' ? 'TC' : s.startsWith('TSJ') ? 'TSJ' : 'AP', m[0]);
  }
  return out;
}

module.exports = {
  configurar,
  // utilidades y parseo
  log, norm, hoyISO, fmtFecha, decodeEntities, xmlATexto, extraerVersiones, extraerBloques, versionVigente,
  resolverRedireccion, fechaCalendarioValida, transporteHttps,
  // atajos y BOE consolidada
  ATAJOS, COMUNIDADES_AUTONOMAS, buscarAtajo, buscarNormas, fichaNorma, indiceNorma, textoBloque, analisisNorma, localizarBloque, resolverNorma, elegirPorNumeroOficial,
  // Euskadi
  AVISO, AVISO_EUSKADI, buscarNormativaEuskadi, textoNormativaEuskadi, resolverNormaEuskadi, verificarCitaEuskadi,
  // Tribunal Constitucional
  AVISO_TC, buscarSentenciasTC, textoSentenciaTC,
  // Unión Europea (CELLAR)
  AVISO_UE, FUENTE_UE, ATAJOS_UE, idiomaUE, celexDeCita, esCitaUE, articulosXhtmlUE, claveArticuloUE,
  fichaActoUE, resolverNormaUE, fichaNormaUE, textoArticuloUE, verificarCitaUE, buscarNormasUE,
  // BORME
  AVISO_BORME, FUENTE_BORME, TIPO_BORME, CITA_BORME, PROVINCIAS_BORME, provinciaBorme, consultaDenominacion, coincideDenominacion,
  documentosSumarioBorme, metadatosBorme, actosDocumentoBorme, entradasIndiceBorme, buscarBorme, textoBorme,
  // citas
  extraerCitas, limpiarHint, estadoBaseNorma, verificarCita, verificarCitaMultifuente, verificarEscrito,
  extraerCitasJurisprudencia,
  ApiError,
};
