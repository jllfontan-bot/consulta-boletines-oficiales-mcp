const m = require('../server/nucleo.js');
let fallos = 0;
const ok = (cond, msg) => { if (!cond) { fallos++; console.log('  FALLO: ' + msg); } else { console.log('  ok: ' + msg); } };

console.log('\n1) XML -> texto (formato real de /texto/bloque)');
const xmlBloque = `<?xml version="1.0" encoding="utf-8"?>
<response><status><code>200</code><text>ok</text></status><data>
<bloque id="a22" tipo="precepto" titulo="Art&#237;culo 22">
 <version id_norma="BOE-A-1995-25444" fecha_publicacion="19951124" fecha_vigencia="19960524">
  <p class="articulo">Art&#237;culo 22.</p>
  <p class="parrafo">Son circunstancias agravantes:</p>
  <p class="parrafo">1.&#170; Ejecutar el hecho con alevos&#237;a.</p>
 </version>
 <version id_norma="BOE-A-2010-9953" fecha_publicacion="20100623" fecha_vigencia="20101223">
  <p class="parrafo">4.&#170; Cometer el delito por motivos racistas &amp; discriminatorios.</p>
  <blockquote><p class="nota_pie">Se modifica la circunstancia 4&#170; por la Ley Org&#225;nica 5/2010.</p></blockquote>
 </version>
</bloque></data></response>`;

const versiones = m.extraerVersiones(xmlBloque);
ok(versiones.length === 2, `detecta 2 versiones (detectó ${versiones.length})`);
const vig = m.versionVigente(versiones);
ok(vig.meta.id_norma === 'BOE-A-2010-9953', 'elige la versión vigente hoy, no la original');
ok(vig.texto.includes('motivos racistas & discriminatorios'), 'decodifica entidades (&amp; -> &)');
ok(versiones[0].texto.includes('alevosía'), 'decodifica acentos numéricos (&#237; -> í)');
ok(versiones[0].texto.includes('1.ª Ejecutar'), 'decodifica &#170; -> ª');
ok(!vig.texto.includes('<p'), 'elimina las etiquetas HTML');
ok(versiones[0].texto.split('\n').length >= 3, 'conserva los saltos de párrafo');

console.log('\n2) Versión vigente cuando hay una futura');
const futuras = [
  { meta: { fecha_vigencia: '20200101', id_norma: 'A' }, texto: 'vieja' },
  { meta: { fecha_vigencia: '20991231', id_norma: 'B' }, texto: 'futura' },
];
ok(m.versionVigente(futuras).meta.id_norma === 'A', 'ignora versiones que aún no han entrado en vigor');

// B6 (revisión 21/09/2026): cuando NINGUNA versión está aún vigente (todas
// las fechas son futuras -- p. ej. una norma recién publicada cuyo único
// texto entra en vigor dentro de varios meses), antes se devolvía esa
// versión futura como si ya se aplicase hoy ("estado": "OK"). Ahora se
// sigue devolviendo (es el único texto que existe), pero marcada.
const soloFutura = [{ meta: { fecha_vigencia: '20991231', id_norma: 'C' }, texto: 'aun no vigente' }];
{
  const v = m.versionVigente(soloFutura);
  ok(!!v && v.meta.id_norma === 'C', 'sin versión vigente, devuelve igualmente la única que hay');
  ok(v._aunNoVigente === true, 'pero la marca como aún no vigente');
}
ok(m.versionVigente(futuras)._aunNoVigente !== true, 'una versión ya vigente NO se marca como pendiente');

console.log('\n3) Extracción de citas de un escrito');
const escrito = `
Que conforme al artículo 56 del Estatuto de los Trabajadores procede la indemnización,
en relación con los arts. 1902 y 1903 del Código Civil y el art. 24.2 CE.
Resulta aplicable la Ley 40/2015, de 1 de octubre, así como el art. 348 bis LSC.
Cita inventada: artículo 9999 del Código Penal.
Se invoca también la Ley 30/1992, hoy derogada.
`;
const citas = m.extraerCitas(escrito);
console.log('  citas:', citas.map(c => `${c.articulo || c.numero_oficial}|${(c.norma_texto||'').slice(0,28)}`).join('  ·  '));
const art = (n) => citas.find(c => c.articulo === n);
ok(!!art('56') && /Estatuto de los Trabajadores/i.test(art('56').norma_texto), 'art. 56 ET con su norma');
ok(!!art('1902'), 'detecta "arts. 1902 y 1903" (primer artículo)');
ok(!!art('24.2') && /CE/.test(art('24.2').norma_texto), 'detecta art. 24.2 CE con apartado');
ok(!!art('348 bis'), 'detecta "348 bis"');
ok(!!art('9999'), 'detecta el artículo inventado (para poder desmentirlo)');
ok(citas.some(c => c.numero_oficial === '40/2015'), 'detecta "Ley 40/2015" suelta');
ok(citas.some(c => c.numero_oficial === '30/1992'), 'detecta "Ley 30/1992" suelta');

console.log('\n4) Resolución de siglas y nombres');
const casos = [
  ['Estatuto de los Trabajadores', 'BOE-A-2015-11430'],
  ['ET', 'BOE-A-2015-11430'],
  ['CE', 'BOE-A-1978-31229'],
  ['del Código Civil', 'BOE-A-1889-4763'],
  ['LEC', 'BOE-A-2000-323'],
  ['ley de enjuiciamiento criminal', 'BOE-A-1882-6036'],
];
for (const [entrada, esperado] of casos) {
  const r = m.buscarAtajo(entrada);
  ok(r && r.id === esperado, `"${entrada}" -> ${esperado} (obtuvo ${r ? r.id : 'nada'})`);
}
ok(m.buscarAtajo('ordenanza municipal de Santiago') === null, 'no inventa atajo para lo desconocido');
ok(m.buscarAtajo('accidente') === null, '"cc" dentro de otra palabra no dispara falso positivo');

console.log('\n5) Localización de artículo en el índice');
const indice = [
  { bloque: 'pr', titulo: '[preambulo]' },
  { bloque: 'a1', titulo: 'Artículo 1' },
  { bloque: 'a22', titulo: 'Artículo 22' },
  { bloque: 'a222', titulo: 'Artículo 222' },
  { bloque: 'a348bis', titulo: 'Artículo 348 bis' },
  { bloque: 'a1902', titulo: 'Art 1902' },
  { bloque: 'a24', titulo: 'Artículo 24' },
  { bloque: 'dd', titulo: 'Disposición derogatoria' },
];
ok(m.localizarBloque(indice, '22').bloque === 'a22', '"22" -> a22 (no a222)');
ok(m.localizarBloque(indice, 'Artículo 22').bloque === 'a22', '"Artículo 22" -> a22');
ok(m.localizarBloque(indice, 'a22').bloque === 'a22', 'acepta el id de bloque directo');
ok(m.localizarBloque(indice, '348 bis').bloque === 'a348bis', '"348 bis" -> a348bis');
ok(m.localizarBloque(indice, '9999') === null, 'artículo inexistente devuelve null');
// B1 (revisión 21/09/2026): "1.902" (punto de millares) NO es el apartado 902
// del artículo 1 -- es el artículo 1902 (el índice del BOE lo titula "Art 1902",
// sin punto). Antes del arreglo, esto devolvía por error el bloque "Artículo 1".
{
  const r = m.localizarBloque(indice, '1.902');
  ok(!!r && r.bloque === 'a1902' && r.exacto === true, '"1.902" -> a1902 (no a1, no confundir con apartado)');
}
ok(m.localizarBloque(indice, '24.2').bloque === 'a24', '"24.2" (apartado real) sigue recortando a "24"');

console.log('\n6) Prioridad de estado de una norma (anulada > derogada > vigencia agotada)');
// B7 (revisión 21/09/2026): "derogada" no era el único motivo por el que una
// norma puede no ser fiable como vigente -- "anulada" (nula desde el origen)
// y "vigencia_agotada" (una medida temporal cuyo plazo ya pasó) quedaban solo
// como un booleano suelto, sin afectar al "estado" que de verdad se mira.
ok(m.estadoBaseNorma({ anulada: true, derogada: true, vigencia_agotada: true }) === 'NORMA_ANULADA', 'anulada gana a derogada y a vigencia agotada (es la más grave)');
ok(m.estadoBaseNorma({ anulada: false, derogada: true, vigencia_agotada: true }) === 'NORMA_DEROGADA', 'derogada gana a vigencia agotada');
ok(m.estadoBaseNorma({ anulada: false, derogada: false, vigencia_agotada: true }) === 'VIGENCIA_AGOTADA', 'vigencia agotada se refleja aunque no esté derogada ni anulada');
ok(m.estadoBaseNorma({ anulada: false, derogada: false, vigencia_agotada: false }) === null, 'una norma vigente de verdad no lleva ninguna de las tres');

console.log('\n7) "Hoy" se calcula en hora de Madrid, no en UTC (B11)');
{
  // B11 (revisión 21/09/2026): `.toISOString()` da siempre UTC -- entre
  // medianoche y la 1/2 de la madrugada en España, UTC todavía va por el
  // día anterior. 21/09/2026 23:30 UTC = 22/09/2026 01:30 en Madrid (CEST,
  // UTC+2 en septiembre): un caso real donde el día difiere entre las dos.
  const RealDate = Date;
  class DateFalsa extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate('2026-09-21T23:30:00Z');
      return new RealDate(...args);
    }
  }
  global.Date = DateFalsa;
  let hoy;
  try {
    hoy = m.hoyISO();
  } finally {
    global.Date = RealDate;
  }
  ok(hoy === '2026-09-22', `a la 1:30 de la madrugada en Madrid, "hoy" ya es el 22, no el 21 de UTC (dio "${hoy}")`);
}

console.log('\n8) Regresión hallazgos de gravedad baja (revisión 21/09/2026)');
{
  // Redirección a otro dominio: se sigue si el host coincide, se rechaza si no.
  const misma = m.resolverRedireccion('/otra/ruta?x=1', 'www.boe.es', '/datosabiertos/api/x');
  ok(misma === '/otra/ruta?x=1', 'una redirección relativa (mismo host) se resuelve con normalidad');
  const mismoHostAbsoluta = m.resolverRedireccion('https://www.boe.es/otra/ruta', 'www.boe.es', '/x');
  ok(mismoHostAbsoluta === '/otra/ruta', 'una redirección absoluta al MISMO host se sigue');
  let rechazada = null;
  try {
    m.resolverRedireccion('https://evil.example.com/robar', 'www.boe.es', '/x');
  } catch (e) {
    rechazada = e.message;
  }
  ok(/host distinto/.test(rechazada || ''), 'una redirección a OTRO host se rechaza con error explícito, no se sigue');
  let locationInvalida = null;
  try {
    m.resolverRedireccion('https://', 'www.boe.es', '/x');
  } catch (e) {
    locationInvalida = e.message;
  }
  ok(/Location inválida/.test(locationInvalida || ''), 'una Location ilegible se rechaza en vez de reventar');

  // Fecha imposible: "30 de febrero" tiene formato válido pero no existe.
  ok(m.fechaCalendarioValida('20240230') === false, '30 de febrero no es una fecha real (formato correcto, calendario imposible)');
  ok(m.fechaCalendarioValida('20240229') === true, '29 de febrero de 2024 sí es real (bisiesto)');
  ok(m.fechaCalendarioValida('20230229') === false, '29 de febrero de 2023 no es real (no bisiesto)');
  ok(m.fechaCalendarioValida('20240115') === true, 'una fecha normal se acepta');

  // Etiqueta de cita con texto sobrante: conectores contraídos "y al"/"y del".
  const hint = m.limpiarHint('art. 1.902 CC y al artículo 1.544 del Código Civil');
  ok(hint === 'art. 1.902 CC', `"y al" corta la etiqueta en el conector, sin arrastrar texto sobrante (dio "${hint}")`);
  const hintDel = m.limpiarHint('art. 3 LAU y del artículo 5 LEC');
  ok(hintDel === 'art. 3 LAU', `"y del" corta igual (dio "${hintDel}")`);
}

console.log('\n8b) Jurisprudencia: solo se detecta, nunca se verifica');
{
  // Números inventados a propósito (no son sentencias reales).
  const t = 'Según la STS 9999/2099, la SAP Madrid 8888/2098 y la STSJ de Cataluña de 1 de enero de 2097, ' +
    'así como la SSTC 7777/2096 y la sentencia del Tribunal Supremo de 2 de febrero de 2095. ' +
    'Véase ECLI:ES:TS:2094:123456. La STS citada. La Ley 3/2015 no la completa. SAN SEBASTIÁN no es una cita. ' +
    'Conforme al art. 34 del Estatuto de los Trabajadores. STS 9999/2099 repetida.';
  const j = m.extraerCitasJurisprudencia(t);
  const por = (c) => j.find((x) => x.cita.startsWith(c));
  ok(por('STS 9999/2099') && por('STS 9999/2099').tribunal === 'TS', 'STS con número -> TS');
  ok(por('SAP Madrid 8888/2098') && por('SAP Madrid').tribunal === 'AP', 'SAP con plaza -> AP');
  ok(por('STSJ de Cataluña de 1 de enero de 2097') && por('STSJ').tribunal === 'TSJ', 'STSJ con fecha larga -> TSJ');
  ok(por('SSTC 7777/2096') && por('SSTC').tribunal === 'TC', 'SSTC -> TC (consultable aparte)');
  ok(j.some((x) => x.tribunal === 'TS' && /Tribunal Supremo de 2 de febrero de 2095/.test(x.cita)), 'forma larga "sentencia del Tribunal Supremo de..."');
  ok(por('ECLI:ES:TS:2094:123456'), 'ECLI del Supremo');
  ok(j.filter((x) => x.cita === 'STS 9999/2099').length === 1, 'sin duplicados');
  ok(!j.some((x) => /SEBASTI/.test(x.cita)) && !j.some((x) => x.cita === 'STS'), 'sin número/fecha o en otro contexto: no es cita');
  ok(j.every((x) => Object.keys(x).join() === 'tipo,tribunal,cita'), 'solo tipo, tribunal y cita: nada de contenido, ponente ni fecha deducida');
  ok(!m.extraerCitas(t).some((c) => /STS|SAP|STSJ|ECLI/.test(c.cita)), 'extraerCitas (y por tanto boe_verificar_escrito) no cambia');
}

console.log('\n8c) El nombre de la norma no se arrastra más allá de una coma (13/10/2026)');
{
  // Antes solo se cortaba en " ," (espacio delante de la coma): la segunda
  // cita se quedaba con "..., conforme a la Ley 30/1992" y, como el número
  // oficial gana en resolverNorma (B2), se verificaba contra la Ley 30/1992.
  const cs = m.extraerCitas('De acuerdo con el art. 34 del Estatuto de los Trabajadores, y con el art. 9999 del Estatuto de los Trabajadores, conforme a la Ley 30/1992.');
  const etiqueta = (n) => (cs.find((c) => c.articulo === n) || {}).cita;
  ok(etiqueta('34') === 'art. 34 Estatuto de los Trabajadores', `", y con el" corta la etiqueta (dio "${etiqueta('34')}")`);
  ok(etiqueta('9999') === 'art. 9999 Estatuto de los Trabajadores', `", conforme a" corta la etiqueta y no arrastra el número de otra ley (dio "${etiqueta('9999')}")`);
  ok(cs.some((c) => c.numero_oficial === '30/1992'), 'la Ley 30/1992 sigue detectándose como cita aparte');

  const corta = (s) => m.limpiarHint(s);
  ok(corta('ET, según la Ley 30/1992') === 'ET', '", según" corta');
  ok(corta('ET, de acuerdo con la Ley 30/1992') === 'ET', '", de acuerdo con" corta aunque empiece por "de"');
  ok(corta('ET conforme a la Ley 30/1992') === 'ET', '"conforme a" sin coma también corta');
  ok(corta('ET y con el art. 4 LEC') === 'ET', '"y con el" sin coma también corta');
  ok(corta('Código Civil, que establece') === 'Código Civil', '", que" corta');
  ok(corta('Estatuto de los Trabajadores y a los arts') === 'Estatuto de los Trabajadores', '"y a los" corta');

  // Contrapeso: lo que sigue a la coma es parte del título oficial de la
  // propia norma -- ahí el número sí es el de la norma citada y debe
  // conservarse para que siga ganando (B2).
  const mantiene = (s) => ok(corta(s) === s, `conserva el título oficial: "${s}" (dio "${corta(s)}")`);
  mantiene('Ley 42/2015, de reforma de la Ley de Enjuiciamiento Civil');
  mantiene('Ley 39/2015, de 1 de octubre, del Procedimiento Administrativo Común');
  mantiene('Real Decreto Legislativo 2/2015, por el que se aprueba el texto');
  mantiene('Ley 7/1985, reguladora de las Bases del Régimen Local');
}

console.log('\n8d) Un salto de línea simple no parte una cita (13/10/2026)');
{
  // Escrito pegado con ajuste de línea y sangría: antes "arts. 1902 y 1903"
  // se quedaban sin norma (NO_RESUELTA) porque el contexto no cruzaba "\n".
  const cs = m.extraerCitas('a los arts. 1902 y 1903\n            del Código Civil, en relación con el art. 24.2 CE.');
  const norma = (n) => (cs.find((c) => c.articulo === n) || {}).norma_texto;
  ok(norma('1902') === 'Código Civil', `art. 1902 recupera su norma tras el salto de línea (dio "${norma('1902')}")`);
  ok(norma('1903') === 'Código Civil', `art. 1903 también (dio "${norma('1903')}")`);
  ok(norma('24.2') === 'CE', `la cita siguiente no se ve afectada (dio "${norma('24.2')}")`);
  const crlf = m.extraerCitas('el artículo 56 del\r\nEstatuto de los Trabajadores');
  ok(crlf.length === 1 && crlf[0].norma_texto === 'Estatuto de los Trabajadores', `también con saltos de Windows (\\r\\n) (dio "${crlf[0] && crlf[0].norma_texto}")`);
  // Una línea en blanco (cambio de párrafo) sigue cortando: lo que venga en
  // el párrafo siguiente no es el nombre de la norma.
  const parrafo = m.extraerCitas('conforme al artículo 7\n\nCódigo Civil comentado, edición 2020');
  ok(parrafo.length === 1 && parrafo[0].norma_texto === '', `una línea en blanco sigue separando párrafos (dio "${parrafo[0] && parrafo[0].norma_texto}")`);
}

console.log('\n8e) Conectores "y por la", "y a la", "y en la" sin coma (14/10/2026)');
{
  // Caso real de la app de escritorio: "y por la Ley 30/1992" no cortaba y la
  // cita se resolvía contra la Ley 30/1992 en vez de contra el Estatuto.
  const cs = m.extraerCitas('La jornada se rige por el art. 34 del Estatuto de los Trabajadores y por la Ley 30/1992.');
  const c34 = cs.find((c) => c.articulo === '34') || {};
  ok(c34.cita === 'art. 34 Estatuto de los Trabajadores', `"y por la" corta la etiqueta (dio "${c34.cita}")`);
  ok(cs.some((c) => c.numero_oficial === '30/1992'), 'la Ley 30/1992 sigue detectándose como cita aparte');
  const cs2 = m.extraerCitas('La jornada se rige por el art. 34 del Estatuto de los Trabajadores, conforme a la Ley 30/1992.');
  ok((cs2.find((c) => c.articulo === '34') || {}).cita === 'art. 34 Estatuto de los Trabajadores', '", conforme a la" sigue funcionando (v1.5.12)');

  const corta = (s) => m.limpiarHint(s);
  ok(corta('Estatuto de los Trabajadores y por el Real Decreto 1561/1995') === 'Estatuto de los Trabajadores', '"y por el" corta');
  ok(corta('Estatuto de los Trabajadores y por lo dispuesto en la Ley 31/1995') === 'Estatuto de los Trabajadores', '"y por lo dispuesto" corta');
  ok(corta('Estatuto de los Trabajadores y a la Ley 30/1992') === 'Estatuto de los Trabajadores', '"y a la" corta');
  ok(corta('Estatuto de los Trabajadores y en la Ley 30/1992') === 'Estatuto de los Trabajadores', '"y en la" corta');

  // Negativos: títulos oficiales con "y" (o con "y por el que") se conservan.
  const mantiene = (s) => ok(corta(s) === s, `conserva el título oficial: "${s}" (dio "${corta(s)}")`);
  mantiene('Ley de Enjuiciamiento Civil');
  mantiene('Ley de Régimen Jurídico y del Procedimiento Administrativo Común');
  mantiene('Ley de Prevención y Control Integrados de la Contaminación');
  mantiene('RD 1/2099, por el que se crea la Junta y por el que se regula su uso');
  mantiene('Orden 1/2099, por la que se crea un fichero y por la que se deroga');
}

console.log('\n8b) Elección por número oficial: rango específico y título (B12, 19/11/2026)');
{
  // Datos reales devueltos por la API el 19/11/2026 (orden: fecha desc).
  const c318 = [
    { id: 'BOE-A-2019-3997', rango: 'Ley', titulo: 'Ley 3/2018, de 26 de diciembre, de medidas fiscales y administrativas.' },
    { id: 'BOE-A-2018-16673', rango: 'Ley Orgánica', titulo: 'Ley Orgánica 3/2018, de 5 de diciembre, de Protección de Datos Personales y garantía de los derechos digitales.' },
    { id: 'BOE-A-2018-15141', rango: 'Ley', titulo: 'Ley 3/2018, de 9 de octubre, de creación del colegio Profesional de Logopedas.' },
  ];
  const e1 = m.elegirPorNumeroOficial('Ley Orgánica 3/2018', c318);
  ok(e1.elegido.id === 'BOE-A-2018-16673' && !e1.alternativas.length, '"Ley Orgánica 3/2018" gana a las "Ley 3/2018" (antes: la más reciente, autonómica)');
  const c961 = [
    { id: 'BOE-A-1996-19263', rango: 'Ley', titulo: 'Ley 1/1996, de 27 de junio, de Cámaras Agrarias de Castilla-La Mancha.' },
    { id: 'BOE-A-1996-8930', rango: 'Real Decreto Legislativo', titulo: 'Real Decreto Legislativo 1/1996, de 12 de abril, por el que se aprueba el texto refundido de la Ley de Propiedad Intelectual.' },
    { id: 'BOE-A-1996-1069', rango: 'Ley Orgánica', titulo: 'Ley Orgánica 1/1996, de 15 de enero, de Protección Jurídica del Menor.' },
  ];
  ok(m.elegirPorNumeroOficial('Ley Orgánica 1/1996 de Protección Jurídica del Menor', c961).elegido.id === 'BOE-A-1996-1069', '"Ley Orgánica 1/1996" elige la LO aunque no sea la más reciente');
  const c072 = [
    { id: 'BOE-A-2011-16752', rango: 'Ley', titulo: 'Ley 9/2007, de 29 de junio, de creación de Kontsumobide-Instituto Vasco de Consumo.' },
    { id: 'BOE-A-2007-19819', rango: 'Ley', titulo: 'Ley 9/2007, de 22 de octubre, de la Administración de la Junta de Andalucía.' },
    { id: 'BOE-A-2007-13828', rango: 'Ley', titulo: 'Ley 9/2007, de 13 de junio, de subvenciones de Galicia.' },
    { id: 'BOE-A-2007-12200', rango: 'Instrucción', titulo: 'Instrucción 9/2007, de 19 de junio, de la Junta Electoral Central.' },
  ];
  const e3 = m.elegirPorNumeroOficial('Ley 9/2007 de subvenciones de Galicia', c072);
  ok(e3.elegido.id === 'BOE-A-2007-13828' && !e3.alternativas.length, 'el título pedido desempata ("subvenciones de Galicia")');
  const e4 = m.elegirPorNumeroOficial('Ley 9/2007', c072);
  ok(e4.elegido.id === 'BOE-A-2011-16752' && e4.alternativas.length === 2, 'sin más señal: la más reciente PERO declara 2 alternativas (no finge certeza)');
  ok(m.elegirPorNumeroOficial('9/2007', c072).elegido.id === 'BOE-A-2011-16752', 'sin rango en el texto: no revienta y devuelve la más reciente');
}

console.log('\n9) Euskadi: no confundir un ministerio estatal con el Gobierno Vasco');
(async () => {
  // B4 (revisión 21/09/2026): "Orden ... del Ministerio de Trabajo e
  // Inmigración" es del Gobierno de España -- Open Data Euskadi solo tiene
  // disposiciones del Gobierno Vasco, así que nunca debería ni intentar
  // resolverla contra su API (antes, si había una orden vasca cualquiera el
  // mismo día, se devolvía esa por error, solo por coincidir la fecha).
  // Esto no hace ninguna llamada de red: `resolverNormaEuskadi` corta antes.
  const r = await m.resolverNormaEuskadi('Orden de 4 de mayo de 2009, del Ministerio de Trabajo e Inmigración');
  ok(r === null, 'una norma "del Ministerio de..." nunca se busca en Euskadi');

  console.log(fallos === 0 ? '\n=== TODO CORRECTO ===' : `\n=== ${fallos} FALLOS ===`);
  process.exit(fallos ? 1 : 0);
})();
