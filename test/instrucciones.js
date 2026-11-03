// Instrucciones del proyecto de Claude Desktop (sin red). Texto_para_Claude_Desktop.txt es lo que
// el usuario copia entero (Cmd+A) y pega: tiene que ser idéntico a la sección 1 de
// docs/instrucciones-proyecto.md y caber en el cuadro de «Instrucciones del proyecto», que el
// 03/11/2026 no dejó guardar 12.826 caracteres y sí 10.928.
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const MAXIMO = 11500;
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  FALLO: ' + m); } else console.log('  ok: ' + m); };

const txt = readFileSync(path.join(RAIZ, 'Texto_para_Claude_Desktop.txt'), 'utf8').trim();
// docs/ no va en el repositorio público: allí se comprueba todo menos la copia en docs/.
const rutaMd = path.join(RAIZ, 'docs', 'instrucciones-proyecto.md');
const md = existsSync(rutaMd) ? readFileSync(rutaMd, 'utf8') : null;
const seccion1 = md && (/## 1\.[^\n]*\n+```\n([\s\S]*?)\n```/.exec(md) || [])[1];

console.log('\nInstrucciones del proyecto');
ok(txt.startsWith('Trabajas sobre derecho español.') && !/INSTRUCCIONES PARA PEGAR|VERSION 2|-{10}/.test(txt), 'el .txt trae solo el texto que se pega: sin cabecera, separadores ni la versión 2');
if (md) ok(seccion1 !== undefined && seccion1.trim() === txt, 'el .txt es idéntico a la sección 1 de docs/instrucciones-proyecto.md');
else console.log('  (sin docs/instrucciones-proyecto.md: no se compara la copia)');
ok(txt.length <= MAXIMO, `cabe en el cuadro de Claude Desktop (${txt.length} caracteres, máximo ${MAXIMO})`);
const herramientas = ['boe_elegir_ambito', 'boe_verificar_cita', 'boe_tc_buscar_sentencias', 'euskadi_buscar_normativa', 'ue_buscar_normas', 'ue_ficha_norma', 'ue_texto_articulo', 'cendoj_pedir_permiso', 'boe_verificar_escrito'];
const faltan = herramientas.filter((h) => !txt.includes(h));
ok(faltan.length === 0, `nombra las herramientas clave${faltan.length ? ' (faltan: ' + faltan.join(', ') + ')' : ''}`);
ok(/punto de partida probable/.test(txt) && /indexAN\.jsp/.test(txt) && /url_doue/.test(txt), 'mantiene la regla de espera del ámbito, el enlace bueno del CENDOJ y el DOUE como texto auténtico');

console.log(fallos === 0 ? '\n=== TODO CORRECTO ===' : `\n=== ${fallos} FALLOS ===`);
process.exit(fallos ? 1 : 0);
