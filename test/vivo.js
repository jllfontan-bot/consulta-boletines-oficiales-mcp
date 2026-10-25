/**
 * vivo.js — Pruebas contra la API REAL del BOE.
 *
 * Estas son las pruebas que NO pudieron ejecutarse al construir el proyecto,
 * porque el entorno de construcción no tenía salida hacia boe.es.
 * Ejecútalas en tu máquina:  npm run test:vivo
 *
 * Comprueban que las suposiciones sobre el formato de la API son correctas y
 * auditan la tabla de atajos entera.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const srv = spawn('node', [path.join(__dirname, '..', 'server', 'index.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
const pendientes = new Map();
let buf = '';
let seq = 0;
let fallos = 0;
let avisos = 0;

const ok = (c, m) => { if (!c) { fallos++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const aviso = (m) => { avisos++; console.log('  ! ' + m); };

srv.stdout.setEncoding('utf8');
srv.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!l) continue;
    let m;
    try { m = JSON.parse(l); } catch { continue; }
    if (pendientes.has(m.id)) { pendientes.get(m.id)(m); pendientes.delete(m.id); }
  }
});

function rpc(method, params) {
  const id = ++seq;
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('sin respuesta a ' + method)), 120000);
    pendientes.set(id, (m) => { clearTimeout(t); res(m); });
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

async function llamar(name, args) {
  const r = await rpc('tools/call', { name, arguments: args || {} });
  const datos = JSON.parse(r.result.content[0].text);
  if (r.result.isError) throw new Error(datos.error);
  return datos;
}

(async () => {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vivo', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  console.log('\n── 1. Conectividad y ficha de norma ──');
  let cp;
  try {
    cp = await llamar('boe_ficha_norma', { id: 'BOE-A-1995-25444' });
  } catch (e) {
    console.log(`\n  NO HAY CONEXIÓN CON boe.es: ${e.message}`);
    console.log('  Comprueba tu red o si hay un proxy/cortafuegos por medio.\n');
    srv.kill();
    process.exit(1);
  }
  console.log('  título:', cp.titulo);
  ok(/penal/i.test(cp.titulo || ''), 'BOE-A-1995-25444 devuelve el Código Penal');
  ok(cp.derogada === false, 'consta como no derogado');
  ok(!!cp.eli, 'trae enlace ELI');
  ok(/^\d{2}\/\d{2}\/\d{4}$/.test(cp.fecha_publicacion || ''), 'las fechas se formatean como DD/MM/AAAA');

  console.log('\n── 2. Índice y texto de un artículo (XML) ──');
  const idx = await llamar('boe_indice_norma', { id: 'BOE-A-1995-25444', filtro: 'Artículo 22' });
  ok(idx.bloques.length > 0, `el índice localiza el artículo 22 (${idx.bloques_totales} bloques en total)`);
  const art22 = await llamar('boe_texto_articulo', { id: 'BOE-A-1995-25444', articulo: '22' });
  console.log('  texto:', String(art22.texto || '').slice(0, 90).replace(/\n/g, ' ') + '…');
  ok(/agravante/i.test(art22.texto || ''), 'el art. 22 CP habla de circunstancias agravantes');
  ok(!/<[a-z]/i.test(art22.texto || ''), 'el texto sale limpio, sin etiquetas XML');
  ok(!/&[a-z]+;/i.test(art22.texto || ''), 'no quedan entidades HTML sin decodificar');
  ok(!!art22.version_desde, `indica desde cuándo rige esa versión (${art22.version_desde})`);

  console.log('\n── 3. Búsqueda con query JSON ──');
  const busq = await llamar('boe_buscar_normas', { titulo: 'arrendamientos urbanos', limite: 5 });
  ok(busq.resultados > 0, `la búsqueda por título devuelve resultados (${busq.resultados})`);
  ok(busq.normas.every((n) => /^BOE-[A-Z]-\d{4}-\d+$/.test(n.id)), 'todos los identificadores tienen forma válida');
  const fechas = await llamar('boe_buscar_normas', { titulo: 'ley', publicada_desde: '20240101', limite: 5 });
  ok(fechas.resultados > 0, 'el filtro por rango de fechas funciona');

  console.log('\n── 4. Verificación de citas ──');
  const buena = await llamar('boe_verificar_cita', { norma: 'Código Penal', articulo: '22' });
  ok(buena.estado === 'OK', `una cita correcta da OK (dio ${buena.estado})`);
  const mala = await llamar('boe_verificar_cita', { norma: 'Código Penal', articulo: '9999' });
  ok(mala.estado === 'ARTICULO_NO_ENCONTRADO', `un artículo inexistente se detecta (dio ${mala.estado})`);
  const derogada = await llamar('boe_verificar_cita', { norma: 'Ley 30/1992' });
  ok(derogada.estado === 'NORMA_DEROGADA', `una norma derogada se detecta (dio ${derogada.estado})`);
  const inventada = await llamar('boe_verificar_cita', { norma: 'Ley Suprema de Cundinamarca', articulo: '1' });
  ok(inventada.estado === 'NO_RESUELTA', `una norma inexistente no se resuelve a nada (dio ${inventada.estado})`);

  console.log('\n── 5. Verificación de un escrito completo ──');
  const escrito = await llamar('boe_verificar_escrito', {
    texto: `Conforme al artículo 56 del Estatuto de los Trabajadores y a los arts. 1902 y 1903
            del Código Civil, en relación con el art. 24.2 CE, y de acuerdo con la Ley 30/1992,
            procede estimar la demanda. Véase también el artículo 9999 del Código Penal.`,
  });
  console.log('  resumen:', JSON.stringify(escrito.resumen));
  ok(escrito.citas_detectadas >= 6, `detecta al menos 6 citas (${escrito.citas_detectadas})`);
  ok(escrito.resumen.articulos_inexistentes >= 1, 'marca el artículo 9999 como inexistente');
  ok(escrito.resumen.normas_derogadas >= 1, 'marca la Ley 30/1992 como derogada');
  // Los "arts. 1902 y 1903⏎ del Código Civil" de este escrito van partidos
  // por un salto de línea: antes salían NO_RESUELTA (13/10/2026).
  for (const n of ['1902', '1903']) {
    const d = escrito.detalle.find((x) => x.cita === `art. ${n} Código Civil`);
    ok(!!d && d.norma_id === 'BOE-A-1889-4763', `art. ${n} se resuelve contra el Código Civil pese al salto de línea (dio ${d ? d.norma_id : 'cita no detectada'})`);
  }
  ok(escrito.resumen.no_resueltas === 0, `ninguna cita queda sin resolver (dio ${escrito.resumen.no_resueltas})`);

  console.log('\n── 6. AUDITORÍA DE LA TABLA DE ATAJOS ──');
  console.log('  (esta tabla se escribió de memoria y nunca se ha verificado)\n');
  const at = await llamar('boe_comprobar_atajos');
  for (const a of at.detalle) {
    const etiqueta = (a.siglas && a.siglas.length ? a.siglas.join('/') : '—').padEnd(10);
    if (!a.ok) console.log(`  ✗ ${etiqueta} ${a.id}  ERROR: ${a.error}`);
    else console.log(`  ${a.derogada ? '!' : '✓'} ${etiqueta} ${a.id}  ${a.titulo_oficial.slice(0, 78)}`);
  }
  console.log('');
  ok(at.fallidos === 0, `los ${at.comprobados} identificadores de la tabla responden (${at.fallidos} fallan)`);
  const derogadas = at.detalle.filter((a) => a.ok && a.derogada);
  if (derogadas.length) aviso(`${derogadas.length} atajo(s) apuntan a normas DEROGADAS: ${derogadas.map((d) => d.id).join(', ')}`);

  console.log('\n── 7. País Vasco (Open Data Euskadi / BOPV) ──');
  const anioEuskadi = new Date().getFullYear() - 1;
  const busqEuskadi = await llamar('euskadi_buscar_normativa', { anio: anioEuskadi, mes: 1, limite: 5 });
  ok(busqEuskadi.normas.length > 0, `busca disposiciones del BOPV por año/mes (${busqEuskadi.normas.length} de ${busqEuskadi.totalItemsPeriodo})`);
  const primeraEuskadi = busqEuskadi.normas[0];
  ok(/^\d{4}\/\d{1,2}\/\d+$/.test(primeraEuskadi.id), `el id tiene forma "AAAA/MM/N" (${primeraEuskadi.id})`);
  const textoEuskadi = await llamar('euskadi_texto_norma', { id: primeraEuskadi.id });
  ok(!!textoEuskadi.texto && textoEuskadi.texto.length > 20, 'trae el texto completo de la disposición');
  ok(!/<[a-z]/i.test(textoEuskadi.texto || ''), 'el texto sale limpio, sin etiquetas HTML');
  ok(!!textoEuskadi.vigencia, `indica vigencia (${textoEuskadi.vigencia})`);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(primeraEuskadi.fecha_publicacion || ''), `fecha_publicacion en formato ISO (${primeraEuskadi.fecha_publicacion}) — ver aviso sobre el bug de huso horario corregido`);

  console.log('\n── 8. Verificación de citas multi-fuente (BOE + BOPV) ──');
  const citaVascaConocida =
    'Orden de 4 de mayo de 2009, del Consejero de Justicia, Empleo y Seguridad Social, ' +
    'por la que se regulan las ayudas para la creación y el sostenimiento de las empresas de inserción';
  const dirEuskadi = await llamar('euskadi_verificar_cita', { norma: citaVascaConocida });
  ok(dirEuskadi.norma_id === '2009/05/3002', `euskadi_verificar_cita resuelve el id exacto conocido (dio ${dirEuskadi.norma_id})`);
  ok(dirEuskadi.fuente === 'Open Data Euskadi · BOPV (Gobierno Vasco)', 'con la fuente etiquetada como Euskadi');

  const escrito2 = await llamar('boe_verificar_escrito', {
    texto: `Conforme al art. 1902 del Código Civil, y de acuerdo con la ${citaVascaConocida}, procede estimar la demanda.`,
  });
  const citaBopv = escrito2.detalle.find((d) => d.cita === 'Orden de 4 de mayo de 2009');
  ok(!!citaBopv, 'boe_verificar_escrito detecta una cita del BOPV citada solo por fecha, sin "art. N" delante');
  ok(!!citaBopv && citaBopv.norma_id === '2009/05/3002', `y la resuelve al mismo id exacto, no a otra norma del mismo día (dio ${citaBopv && citaBopv.norma_id})`);
  ok(!!citaBopv && citaBopv.fuente === 'Open Data Euskadi · BOPV (Gobierno Vasco)', 'y la etiqueta con su fuente real, no como si fuera del BOE');

  console.log('\n── 9. Tribunal Constitucional (BOE, sumario diario) ──');
  const busqTC = await llamar('boe_tc_buscar_sentencias', { fecha_desde: '2024-06-24', limite: 5 });
  ok(busqTC.sentencias.length === 3, `encuentra las 3 sentencias del TC publicadas ese día (dio ${busqTC.sentencias.length})`);
  ok(busqTC.sentencias.some((s) => s.id === 'BOE-A-2024-12808'), 'incluye la sentencia 79/2024 conocida');
  ok(busqTC.sentencias.every((s) => !!s.url), 'cada sentencia trae su url');

  const stc79 = await llamar('boe_tc_texto_sentencia', { id: 'BOE-A-2024-12808' });
  ok(stc79.numero_oficial === '79/2024', `resuelve el número oficial correcto (dio ${stc79.numero_oficial})`);
  ok(!!stc79.url && !!stc79.url_pdf, 'trae url (html) y url_pdf');
  ok(/^ECLI:ES:TC:2024:79/.test(stc79.texto || ''), 'el texto es el cuerpo real de la sentencia, no el detalle de las referencias (bug ya corregido)');
  ok(!/<[a-z]/i.test(stc79.texto || ''), 'el texto sale limpio, sin etiquetas XML');
  ok(stc79.referencias_a_normas_anteriores.some((r) => r.norma === 'BOE-A-2023-12203'), 'trae las referencias a las normas afectadas');

  console.log('\n── 10. Regresión B1-B6 (revisión de seguridad/correctitud, 21-22/09/2026) ──');

  // B1: "1.902" (punto de millares del Código Civil) no es el apartado 902
  // del artículo 1 -- es el artículo 1902 completo.
  const b1 = await llamar('boe_verificar_cita', { norma: 'Código Civil', articulo: '1.902' });
  ok(b1.articulo_titulo === 'Art 1902', `B1: "art. 1.902 CC" resuelve el artículo 1902, no el 1 (dio "${b1.articulo_titulo}")`);
  ok(b1.coincidencia === 'exacta', 'B1: coincidencia exacta, no aproximada');

  // B2: un número oficial explícito en la propia cita ("Ley 42/2015") tiene
  // que ganar a un atajo por alias que también aparece en el mismo texto
  // ("Ley de Enjuiciamiento Civil" -> LEC, Ley 1/2000, una norma DISTINTA).
  const b2 = await llamar('boe_verificar_cita', { norma: 'Ley 42/2015, de reforma de la Ley de Enjuiciamiento Civil' });
  ok(b2.norma_id === 'BOE-A-2015-10727', `B2: resuelve la Ley 42/2015 (dio ${b2.norma_id}), no la LEC por su alias`);

  // B3: buscar por número oficial sin más contexto puede devolver varias
  // normas de comunidades/rangos distintos con el mismo número -- si el
  // propio texto dice "Ley", tiene que preferir la que sea una Ley de
  // verdad, no un Decreto Legislativo autonómico con el mismo número.
  const b3 = await llamar('boe_verificar_cita', { norma: 'Ley 2/2023' });
  ok(/^ley\b/i.test(b3.norma || ''), `B3: "Ley 2/2023" resuelve una Ley (dio "${(b3.norma || '').slice(0, 60)}…")`);

  // B4: Open Data Euskadi solo tiene disposiciones del Gobierno Vasco -- una
  // cita que ya dice "del Ministerio de..." (Gobierno de España) no puede
  // ser suya, aunque coincida la fecha con una orden vasca del mismo día.
  const b4 = await llamar('boe_verificar_cita', { norma: 'Orden de 4 de mayo de 2009, del Ministerio de Trabajo e Inmigración' });
  ok(b4.estado === 'NO_RESUELTA', `B4: no confunde un ministerio estatal con una orden vasca (dio ${b4.estado}${b4.fuente ? ', fuente: ' + b4.fuente : ''})`);

  // B5: un nombre reducido al mero TIPO de norma ("Reglamento", "Ley"...),
  // sin número ni más contexto, no identifica una norma concreta -- no debe
  // devolverse "coincidencia: exacta" contra lo primero que aparezca.
  const b5 = await llamar('boe_verificar_cita', { norma: 'Reglamento', articulo: '3' });
  ok(b5.estado === 'NO_RESUELTA', `B5: un nombre genérico ("Reglamento") no se resuelve solo (dio ${b5.estado})`);

  // B6: la única redacción que existe de un artículo puede tener una fecha
  // de entrada en vigor FUTURA -- no se puede dar como aplicable hoy.
  const b6 = await llamar('boe_verificar_cita', { norma: 'Real Decreto 707/2026', articulo: '3' });
  ok(b6.estado === 'AUN_NO_VIGENTE', `B6: una redacción con fecha futura no se da como "OK" (dio ${b6.estado})`);
  ok(!!b6.aviso_vigencia, 'B6: explica desde cuándo entra en vigor de verdad');

  // B7: una norma ANULADA (nula desde el origen, no solo derogada por una
  // norma posterior) se daba igual como "NORMA_VIGENTE" -- caso real
  // conocido: BOE-A-2014-8137 (derogada:false, anulada:true).
  const b7 = await llamar('boe_verificar_cita', { norma: 'Real Decreto 591/2014' });
  ok(b7.estado === 'NORMA_ANULADA', `B7: una norma anulada no se da como vigente (dio ${b7.estado})`);
  ok(b7.anulada === true, 'B7: el dato "anulada" viaja explícito en la respuesta');

  // B8: un número de artículo con caracteres especiales de regex (aquí un
  // paréntesis sin cerrar) tiraba la consulta con un SyntaxError al construir
  // el RegExp -- ahora se escapa antes de usarlo.
  const b8 = await llamar('euskadi_verificar_cita', {
    norma: 'Orden de 4 de mayo de 2009, del Consejero de Justicia, Empleo y Seguridad Social, ' +
      'por la que se regulan las ayudas para la creación y el sostenimiento de las empresas de inserción',
    articulo: '2 (bis)',
  });
  ok(b8.estado === 'ARTICULO_NO_ENCONTRADO', `B8: un artículo con "(" no tira la consulta (dio ${b8.estado})`);

  // B9: la respuesta de la ventana de permiso del CENDOJ es de un solo uso y
  // exige haber pedido permiso antes -- el modelo no puede autorizarse solo.
  const b9 = await llamar('cendoj_permiso_respuesta', { autorizado: true });
  ok(/^RECHAZADO/.test(b9.permiso_cendoj), `B9: sin pedir permiso antes, no se acepta la respuesta (dio ${b9.permiso_cendoj})`);

  // B10: un fragmento de prosa del propio escrito del usuario (con un nombre
  // de persona) no debe mandarse a boe.es como búsqueda por título.
  const b10negativo = await llamar('boe_verificar_escrito', { texto: 'El artículo 3 del contrato firmado con Juan Pérez establece la duración.' });
  const citaB10 = b10negativo.detalle[0];
  ok(citaB10.estado === 'NO_RESUELTA', `B10: un fragmento sin pinta de norma no se manda como búsqueda (dio ${citaB10.estado})`);
  // Contrapeso: un nombre de norma real (con un tipo de norma reconocible en
  // el propio texto) sigue resolviéndose por título con normalidad -- el
  // filtro no es tan estricto que rompa la búsqueda legítima.
  const b10positivo = await llamar('boe_verificar_cita', { norma: 'Reglamento de las condiciones básicas de accesibilidad cognitiva' });
  ok(b10positivo.estado !== 'NO_RESUELTA', `B10: una cita real con "Reglamento" en el texto sigue resolviéndose (dio ${b10positivo.estado})`);

  console.log('\n── 11. Regresión hallazgos de gravedad baja (revisión 21/09/2026) ──');

  // Fecha con formato correcto pero imposible ("30 de febrero"): antes se
  // aceptaba en silencio (Date la redondeaba a marzo) y la búsqueda seguía
  // adelante con una fecha distinta de la pedida, sin avisar de nada.
  const fechaImposible = await rpc('tools/call', { name: 'boe_tc_buscar_sentencias', arguments: { fecha_desde: '2024-02-30' } });
  const datosFechaImposible = JSON.parse(fechaImposible.result.content[0].text);
  ok(fechaImposible.result.isError === true, 'una fecha imposible (30 de febrero) da error, no una búsqueda silenciosa');
  ok(/no es una fecha real/.test(datosFechaImposible.error || ''), `el error explica por qué (dio "${datosFechaImposible.error}")`);

  console.log('\n── 12. El nombre de la norma no se arrastra más allá de una coma (13/10/2026) ──');

  // Antes, "art. 9999 del Estatuto de los Trabajadores, conforme a la Ley
  // 30/1992" dejaba como norma "Estatuto de los Trabajadores, conforme a la
  // Ley 30/1992" y, como el número oficial gana (B2), la cita se verificaba
  // contra la Ley 30/1992 en vez de contra el ET.
  const coma = await llamar('boe_verificar_escrito', {
    texto: 'De acuerdo con el art. 34 del Estatuto de los Trabajadores, y con el art. 9999 del Estatuto de los Trabajadores, conforme a la Ley 30/1992.',
  });
  const c34 = coma.detalle.find((d) => /^art\. 34\b/.test(d.cita));
  const c9999 = coma.detalle.find((d) => /^art\. 9999\b/.test(d.cita));
  ok(!!c34 && c34.cita === 'art. 34 Estatuto de los Trabajadores', `etiqueta limpia del art. 34 (dio "${c34 && c34.cita}")`);
  ok(!!c9999 && c9999.norma_id === 'BOE-A-2015-11430', `el art. 9999 se verifica contra el ET, no contra la Ley 30/1992 (dio ${c9999 && c9999.norma_id})`);
  ok(!!c9999 && c9999.estado === 'ARTICULO_NO_ENCONTRADO', `y se marca como inexistente (dio ${c9999 && c9999.estado})`);

  console.log('\n── 13. BORME (Registro Mercantil, sumario diario) — 1.6.0 ──');

  // Casos reales comprobados el 18/10/2026 (personas jurídicas; no se imprime
  // el texto de los actos, que lleva nombres de personas).
  const bormeAnuncio = await llamar('boe_borme_buscar', { denominacion: 'Aula, Escuela Europea, S.A.', fecha_desde: '2026-10-12', fecha_hasta: '2026-10-18' });
  ok(bormeAnuncio.fuente === 'BOE · BORME (Boletín Oficial del Registro Mercantil)' && /no legislación/.test(bormeAnuncio.tipo), 'fuente y tipo propios del BORME');
  ok(bormeAnuncio.anuncios.some((a) => a.id === 'BORME-C-2026-5474' && a.apartado === 'CONVOCATORIAS DE JUNTAS'), 'encuentra el anuncio real de la Sección Segunda');
  // 12/10 (Fiesta Nacional), 17 y 18 (fin de semana): sin BORME, la API da 404.
  ok(bormeAnuncio.dias_revisados === 7 && bormeAnuncio.dias_con_borme === 4, `festivo y fin de semana sin BORME no son error (días con BORME: ${bormeAnuncio.dias_con_borme})`);
  ok(bormeAnuncio.anuncios.every((x) => /^\d{2}\/\d{2}\/\d{4}$/.test(x.fecha_publicacion)), 'fecha de los anuncios en dd/mm/aaaa');
  ok(!bormeAnuncio.nota_indice, 'todos los días con BORME traen índice alfabético');
  ok(/RD 1979\/2008/.test(bormeAnuncio.aviso), 'lleva el aviso del BORME');

  const bormeTexto = await llamar('boe_borme_texto', { id: 'BORME-C-2026-5474' });
  ok(bormeTexto.estado === 'OK' && /Orden del día/.test(bormeTexto.texto || '') && !/<[a-z]/i.test(bormeTexto.texto || ''), 'texto limpio del anuncio');
  ok(/\.pdf$/.test(bormeTexto.url_pdf || '') && /^2026-10-16T/.test(bormeTexto.fecha_actualizacion || ''), 'con url_pdf y fecha de actualización');

  const bormeActo = await llamar('boe_borme_buscar', { denominacion: 'Talgo', provincia: 'Álava', fecha_desde: '20261016' });
  ok(bormeActo.actos.length === 1 && bormeActo.actos[0].documento_id === 'BORME-A-2026-200-01', `encuentra el acto inscrito en la provincia (dio ${bormeActo.actos.length})`);
  ok(bormeActo.actos.every((a) => /^TALGO\b/.test(a.denominacion)), 'solo devuelve actos de la empresa buscada, no el documento entero (78 actos)');
  const bormeTodaEspana = await llamar('boe_borme_buscar', { denominacion: 'Talgo', fecha_desde: '2026-10-12', fecha_hasta: '2026-10-18' });
  ok(bormeTodaEspana.actos.some((a) => a.documento_id === 'BORME-A-2026-200-01' && a.numero_acto === '459719'), 'sin provincia encuentra el mismo acto a través del índice alfabético');
  ok(bormeTodaEspana.actos.every((a) => /^TALGO\b/.test(a.denominacion)), 'y solo actos de esa empresa');

  const bormeNoExiste = await rpc('tools/call', { name: 'boe_borme_texto', arguments: { id: 'BORME-C-2099-1' } });
  ok(bormeNoExiste.result.isError === true && /no existe en el BORME/.test(JSON.parse(bormeNoExiste.result.content[0].text).error || ''), 'un id inexistente (la API da 200 con <error>) es un error explícito, no un texto vacío');

  console.log(`\n${'═'.repeat(60)}`);
  console.log(fallos === 0 ? `TODO CORRECTO${avisos ? ` (con ${avisos} aviso[s] a revisar)` : ''}` : `${fallos} FALLO(S)`);
  console.log('Revisa arriba, uno a uno, que cada título oficial corresponde a sus siglas.');
  console.log('Si alguno no cuadra, corrige la tabla ATAJOS en server/nucleo.js.');
  console.log('═'.repeat(60) + '\n');

  srv.kill();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('\nERROR: ' + e.message); srv.kill(); process.exit(1); });
