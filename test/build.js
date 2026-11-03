// Build reproducible: dos builds seguidos dan el mismo .mcpb, byte a byte, y la
// fecha de las entradas es la fija (no la hora del build). Si esto falla, la sha256
// de server.json deja de servir para comprobar la release.
const { execFileSync } = require('node:child_process');
const { readFileSync, rmSync, mkdtempSync } = require('node:fs');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  FALLO: ' + m); } else console.log('  ok: ' + m); };

const tmp = mkdtempSync(path.join(os.tmpdir(), 'build-mcpb-'));
const construir = (nombre, env) => {
  const salida = path.join(tmp, nombre);
  // build.mjs une la salida a la raíz del proyecto: se le pasa relativa.
  execFileSync(process.execPath, [path.join(RAIZ, 'build.mjs'), path.relative(RAIZ, salida)], { env: { ...process.env, ...env }, stdio: 'ignore' });
  return readFileSync(salida);
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

try {
  console.log('\nBuild reproducible del .mcpb');
  const sinEpoch = { SOURCE_DATE_EPOCH: '' };
  const a = construir('a.mcpb', sinEpoch);
  const b = construir('b.mcpb', sinEpoch);
  ok(sha(a) === sha(b), `dos builds seguidos dan la misma sha256 (${sha(a).slice(0, 12)}…)`);
  // Cabecera local de la primera entrada: hora en el byte 10, fecha en el 12 (formato DOS).
  ok(a.readUInt16LE(10) === 0 && a.readUInt16LE(12) === ((0 << 9) | (1 << 5) | 1), 'las entradas llevan la fecha fija 1980-01-01 00:00');
  const c = construir('c.mcpb', { SOURCE_DATE_EPOCH: String(Date.UTC(2026, 9, 25) / 1000) });
  ok(c.readUInt16LE(12) === ((46 << 9) | (10 << 5) | 25) && sha(c) !== sha(a), 'SOURCE_DATE_EPOCH cambia la fecha de las entradas');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fallos === 0 ? '\n=== TODO CORRECTO ===' : `\n=== ${fallos} FALLOS ===`);
process.exit(fallos ? 1 : 0);
