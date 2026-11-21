// Pruebas SIN RED del aviso de versión nueva (transporte y carpeta de caché falsos).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../server/actualizacion.js');

let fallos = 0;
const ok = (cond, msg) => { if (!cond) { fallos++; console.log('  FALLO: ' + msg); } else { console.log('  ok: ' + msg); } };
const nuevoDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'boe-act-'));
const falso = (status, tag, contador) => async () => {
  if (contador) contador.n++;
  if (status === 'error') throw new Error('sin red');
  return { status, body: JSON.stringify({ tag_name: tag }) };
};

(async () => {
  console.log('Aviso de versión nueva');
  ok(A.compararVersiones('v1.7.2', '1.7.1') > 0, '1.7.2 > 1.7.1 (con prefijo v)');
  ok(A.compararVersiones('1.10.0', '1.9.9') > 0, '1.10.0 > 1.9.9 (comparación numérica, no de texto)');
  ok(A.compararVersiones('1.7.1', '1.7.1') === 0, 'iguales → 0');
  ok(A.compararVersiones('latest', '1.7.1') === null, 'versión no válida → null');

  let dir = nuevoDir(), c = { n: 0 };
  let r = await A.comprobar('1.7.1', { dir, transporte: falso(200, 'v1.7.2', c) });
  ok(r && r.ultima === '1.7.2' && /releases\/latest$/.test(r.url), 'hay versión nueva → { ultima, url }');
  ok(/1\.7\.1/.test(A.textoAviso('1.7.1', r.ultima, r.url)) && /UNA vez/.test(A.textoAviso('1.7.1', r.ultima, r.url)), 'el texto del aviso nombra ambas versiones y pide decirlo una vez');
  r = await A.comprobar('1.7.1', { dir, transporte: falso(200, 'v1.7.2', c) });
  ok(c.n === 1 && r && r.ultima === '1.7.2', 'segunda comprobación en <24 h: sale de la caché, sin nueva petición');
  const t0 = Date.now();
  r = await A.comprobar('1.7.1', { dir, transporte: falso(200, 'v1.7.3', c), ahora: () => t0 + 25 * 3600 * 1000 });
  ok(c.n === 2 && r && r.ultima === '1.7.3', 'pasadas 24 h vuelve a consultar');

  dir = nuevoDir();
  r = await A.comprobar('1.7.1', { dir, transporte: falso(200, 'v1.7.1') });
  ok(r === null, 'misma versión → sin aviso');
  r = await A.comprobar('1.7.1', { dir: nuevoDir(), transporte: falso(200, 'v1.7.0') });
  ok(r === null, 'GitHub con versión anterior → sin aviso');

  c = { n: 0 }; dir = nuevoDir();
  r = await A.comprobar('1.7.1', { dir, transporte: falso('error', null, c) });
  ok(r === null, 'sin red → sin aviso y sin lanzar error');
  await A.comprobar('1.7.1', { dir, transporte: falso('error', null, c) });
  ok(c.n === 1, 'tras un fallo no reintenta en la hora siguiente');
  r = await A.comprobar('1.7.1', { dir: nuevoDir(), transporte: falso(403, 'v9.9.9') });
  ok(r === null, 'respuesta 403 (límite de GitHub) → sin aviso');
  r = await A.comprobar('1.7.1', { dir: nuevoDir(), transporte: falso(200, 'rama-rara') });
  ok(r === null, 'etiqueta que no es X.Y.Z → sin aviso');

  c = { n: 0 }; dir = nuevoDir();
  fs.writeFileSync(path.join(dir, 'sin-aviso-actualizacion'), '');
  r = await A.comprobar('1.7.1', { dir, transporte: falso(200, 'v9.9.9', c) });
  ok(r === null && c.n === 0, 'fichero sin-aviso-actualizacion → no consulta ni avisa');
  c = { n: 0 };
  process.env.BOE_CONSOLIDADA_SIN_AVISO_ACTUALIZACION = '1';
  r = await A.comprobar('1.7.1', { dir: nuevoDir(), transporte: falso(200, 'v9.9.9', c) });
  delete process.env.BOE_CONSOLIDADA_SIN_AVISO_ACTUALIZACION;
  ok(r === null && c.n === 0, 'variable de entorno de opt-out → no consulta ni avisa');

  console.log(fallos ? `\n=== ${fallos} FALLOS ===` : '\n=== TODO CORRECTO ===');
  process.exit(fallos ? 1 : 0);
})();
