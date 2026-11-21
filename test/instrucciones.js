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
ok(/vale hasta cerrar Claude Desktop/.test(txt) && /no lo pidas en cada\s+consulta/.test(txt) && !/una sola tarea|una vez por tarea/.test(txt), '1.7.2: el permiso del CENDOJ dura hasta cerrar Claude Desktop y no se pide en cada consulta');
ok(/Reglamento 3\/2010/.test(txt) && /pausa/.test(txt) && /descargas masivas/.test(txt) && /barridos/.test(txt), '1.7.2: mantiene los límites del Reglamento 3/2010 del CGPJ y aclara que «al detalle» no es hacer barridos');
ok(/no descargues tú el PDF \(salvo que\s+te lo pida\)/.test(txt) && /enlace openDocument del CENDOJ/.test(txt) && /nunca\s+construido ni de memoria; sin él, no la propongas/.test(txt) && /cita solo lo leído/.test(txt) && /sin conservar ni redistribuir/.test(txt) && !/guardar,/.test(txt), '5a-ajuste 2: PDF por lote con enlace openDocument de cada sentencia; por defecto no descarga Claude; citado solo lo leído');
ok(/> \*\*📄 Sentencias que propongo leer — te toca a ti\*\*/.test(txt) && /> \*\*Qué hacer:\*\* 1\. Abre cada enlace\./.test(txt) && /icono de descarga \(arriba a\s+> la derecha del visor\)/.test(txt) && /escríbeme «ya están»/.test(txt) && /> \*\*Puedes responderme:\*\* «ya están» → las leo · «quita la 2» \/ «añade X» →/.test(txt) && /«no» → no leo ninguna/.test(txt) && !/\(solo si/.test(txt), 'fase 4 cerrada: variante A del recuadro (Descargas conectada) sin paso 0 ni condición copiada');
ok(/Antes, mira si Descargas está conectada\. Si no \(o no lo sabes\),\s+abre el recuadro con «Descargas no está conectada a este chat»/.test(txt) && /«0\. Añade Descargas: botón «\+» de la caja de mensaje → «Añadir carpeta»»/.test(txt), 'fase 4 cerrada: variante B del recuadro (Descargas no conectada): aviso al empezar y paso 0');
ok(/Su «ya están» es el «sí» al lote/.test(txt) && /No pidas acceso a carpetas a mitad del chat/.test(txt) && /que adjunte el PDF/.test(txt) && !/saldrá un cuadro|pedirás acceso|pide ya ese acceso/.test(txt) && /Nunca des\s+indexAN\.jsp como\s+enlace de una sentencia/.test(txt) && /borrarlas de Descargas es cosa suya/.test(txt), '5a-ajuste 5: «ya están» es el «sí»; sin pedir acceso a mitad del chat; nunca indexAN.jsp como enlace; borrar es cosa del usuario');
ok(/ante CUALQUIER petición \(también «lo más reciente sobre X»\)/.test(txt) && /primero es el ámbito y el permiso del CENDOJ: nada de web, prensa ni resúmenes/.test(txt) && /ni como adelanto\s+ni «sin verificar»/.test(txt) && !/Cmd\+Shift\+B/.test(txt), '5a-ajuste 5: regla web endurecida en el texto del proyecto');
ok(/si ya lo escribió en esta conversación, basta/.test(txt) && /descargas masivas o en bloque/.test(txt) && /recorrer\s+listados/.test(txt) && /uso comercial/.test(txt), '4b: un «autorizo» ya escrito basta; siguen prohibidos descargas en bloque, listados y uso comercial');

console.log(fallos === 0 ? '\n=== TODO CORRECTO ===' : `\n=== ${fallos} FALLOS ===`);
process.exit(fallos ? 1 : 0);
