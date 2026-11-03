// Pruebas SIN RED de la normativa de la UE (CELLAR): transporte falso con el formato
// real de SPARQL y de los XHTML de CELLAR (comprobado el 03/11/2026), con textos inventados.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const m = require('../server/nucleo.js');

let fallos = 0;
const ok = (cond, msg) => { if (!cond) { fallos++; console.log('  FALLO: ' + msg); } else { console.log('  ok: ' + msg); } };
const lanza = async (fn, re, msg) => {
  try { await fn(); ok(false, `${msg} (no lanzó error)`); } catch (e) { ok(re.test(e.message), `${msg} (${e.message})`); }
};

// --- XHTML de los cuatro formatos que sirve CELLAR -------------------------------
const ORIGINAL_ES = `<html><body>
<p class="oj-ti-section-1">CAPÍTULO I</p>
<div class="eli-subdivision" id="art_1"><p class="oj-ti-art">Artículo 1</p>
<div class="eli-title" id="art_1.tit_1"><p class="oj-sti-art">Objeto</p></div>
<div id="001.001"><p class="oj-normal">1. El presente Reglamento inventado establece normas de prueba.</p></div></div>
<p class="oj-ti-section-1">CAPÍTULO II</p>
<div class="eli-subdivision" id="art_2"><p class="oj-ti-art">Artículo 2</p>
<div class="eli-title" id="art_2.tit_1"><p class="oj-sti-art">Entrada en vigor</p></div>
<p class="oj-normal">Entrará en vigor a los veinte días.</p></div>
<div class="oj-final"><p class="oj-normal">Hecho en Bruselas, el 1 de enero de 2016.</p></div>
<hr class="oj-note"/><p class="oj-note">(1) DO C 1 de 1.1.2016.</p>
</body></html>`;

const CONSOLIDADO = (lengua, rotulo, subt, t1, t4) => `<html><body>
<p class="reference">02016R0679 — ${lengua} — 01.01.2020</p>
<p class="title-division-1">CAPÍTULO I</p>
<div class="eli-subdivision" id="art_1"><p class="title-article-norm" id="id-1">${rotulo} 1</p>
<div class="eli-title" id="art_1.tit_1"><p class="stitle-article-norm">${subt}</p></div>
<div class="norm"><span class="no-parag">1.</span><div class="inline-element"><p class="norm">${t1}</p></div></div></div>
<p class="modref"><a href="http://publications.europa.eu/resource/celex/32019R0001" title="32019R0001">▼M1</a></p>
<div class="eli-subdivision" id="art_4a"><p class="title-article-norm" id="id-2">${rotulo} 4 <span class="norm">bis</span></p>
<div class="eli-title"><p class="stitle-article-norm">Insertado</p></div>
<p class="norm">${t4}</p></div>
<hr class="separator-annex"/><p class="title-annex-1">ANEXO I</p><p>Texto del anexo que no es del artículo.</p>
</body></html>`;

const ANTIGUO = `<html lang="ES"><body><p>Artículo 1 </p><p>Objeto</p><p>Los Estados miembros garantizarán una cosa inventada.</p>
<p>Artículo 2 </p><p>1. Primer apartado inventado.</p><p>Hecho en Luxemburgo, el 24 de octubre de 1995.</p></body></html>`;
const HOJA_DEROGADA = '<html><body><p class="reference">01995L0046 — ES — 25.05.2018</p><p class="norm">Derogado</p></body></html>';

// --- Datos de CELLAR (por CELEX) --------------------------------------------------
const L = 'http://publications.europa.eu/resource/authority/language/';
const ACTOS = {
  '32016R0679': {
    titulos: { SPA: 'Reglamento (UE) 2016/679 inventado de prueba', ENG: 'Regulation (EU) 2016/679 made-up test' },
    fecha: '2016-04-27', vigor: '1',
    versiones: ['02016R0679-20160504', '02016R0679-20200101', '02016R0679-20990101'],
    modifica: ['32019R0001'],
  },
  '31995L0046': {
    titulos: { SPA: 'Directiva 95/46/CE inventada' }, fecha: '1995-10-24', vigor: '0', fin: '2018-05-24',
    versiones: ['01995L0046-20031120', '01995L0046-20180525'], modifica: [],
  },
  '32012R1215': { titulos: { SPA: 'Reglamento (UE) n.º 1215/2012 inventado' }, fecha: '2012-12-12', vigor: '1', versiones: [], modifica: [] },
};
// Documento por CELEX e idioma: { expresión: cuerpo }. Sin entrada = no existe en ese idioma.
const DOCS = {
  '02016R0679-20200101': {
    SPA: ['aaaa-1.0004', CONSOLIDADO('ES', 'Artículo', 'Objeto', '►M1 El presente Reglamento inventado ◄ establece normas.', 'Artículo inventado insertado.')],
    ENG: ['aaaa-1.0001', CONSOLIDADO('EN', 'Article', 'Subject-matter', 'This made-up Regulation lays down rules.', 'Made-up inserted Article.')],
  },
  '01995L0046-20180525': { SPA: ['bbbb-2.0022', HOJA_DEROGADA] },
  '01995L0046-20031120': { SPA: ['bbbb-3.0010', ANTIGUO] },
  '32012R1215': { SPA: ['cccc-4.0023', ORIGINAL_ES] },
};
const CUERPO_POR_EXPRESION = {};
for (const porLengua of Object.values(DOCS)) for (const [expr, cuerpo] of Object.values(porLengua)) CUERPO_POR_EXPRESION[expr] = cuerpo;

const json = (bindings) => ({ status: 200, headers: {}, body: JSON.stringify({ results: { bindings } }) });
const lit = (v) => ({ type: 'literal', value: v });
const consultas = [];
let peticionesRed = 0;
// Fallos simulados para la próxima petición SPARQL (se consumen en orden): 'timeout', 'red' o un código HTTP.
const fallosSparql = [];

function sparql(q) {
  consultas.push(q);
  const celex = (/"([03]\d{4}[RLD]\d{4}(?:-\d{8})?)"\^\^/.exec(q) || [])[1];
  if (/bif:contains/.test(q)) {
    // Una fila por acto e idioma en que coincide (como CELLAR con el UNION de buscarNormasUE).
    const filas = [];
    for (const por of ['es', 'en']) {
      if (!q.includes(`BIND("${por}" AS ?por)`)) continue;
      filas.push({ celex: lit('32016R0679'), por: lit(por), titulo: lit(ACTOS['32016R0679'].titulos.SPA), fecha: lit('2016-04-27'), vigor: lit('1') });
      if (por === 'en') filas.push({ celex: lit('32019R0001'), por: lit(por), fecha: lit('2019-01-01'), vigor: lit('0'), fin: lit('2022-07-31') });
    }
    return json(filas);
  }
  if (/manifestation_type/.test(q)) {
    const lengua = /language\/(SPA|ENG)>/.exec(q)[1];
    const d = DOCS[celex] && DOCS[celex][lengua];
    return json(d ? [{ e: { type: 'uri', value: `http://publications.europa.eu/resource/cellar/${d[0]}` }, tipo: lit('xhtml') }] : []);
  }
  const acto = ACTOS[celex];
  if (/act_consolidated_based_on_resource_legal/.test(q)) return json(acto ? acto.versiones.map((c) => ({ celex: lit(c) })) : []);
  if (/resource_legal_amends_resource_legal/.test(q)) return json(acto ? acto.modifica.map((c) => ({ celex: lit(c) })) : []);
  if (!acto) return json([]);
  return json(Object.entries(acto.titulos).map(([k, t]) => ({
    lang: { type: 'uri', value: L + k }, titulo: lit(t), fecha: lit(acto.fecha), vigor: lit(acto.vigor), ...(acto.fin ? { fin: lit(acto.fin) } : {}),
  })));
}

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-test-'));
m.configurar({
  cacheDir,
  transporte: async ({ host, path: ruta, accept }) => {
    peticionesRed++;
    if (host !== 'publications.europa.eu') throw new Error(`host inesperado en la prueba: ${host}`);
    const u = new URL('https://' + host + ruta);
    if (u.pathname === '/webapi/rdf/sparql') {
      const fallo = fallosSparql.shift();
      if (fallo === 'timeout') throw new Error('timeout tras 15 s');
      if (fallo === 'red') throw new Error('read ETIMEDOUT');
      if (typeof fallo === 'number') return { status: fallo, headers: {}, body: '<html>Web Site Under Maintenance</html>' };
      return sparql(u.searchParams.get('query'));
    }
    const expr = /^\/resource\/cellar\/([0-9a-f-]+\.\d+)$/.exec(u.pathname);
    if (expr && CUERPO_POR_EXPRESION[expr[1]] && accept === 'application/xhtml+xml') {
      return { status: 303, headers: { location: `http://publications.europa.eu/resource/cellar/${expr[1]}.03/DOC_2` }, body: '' };
    }
    const doc = /^\/resource\/cellar\/([0-9a-f-]+\.\d+)\.03\/DOC_2$/.exec(u.pathname);
    if (doc) return { status: 200, headers: {}, body: CUERPO_POR_EXPRESION[doc[1]] };
    return { status: 404, headers: {}, body: '' };
  },
});

(async () => {
  console.log('1) De la cita al CELEX');
  const c = (t) => m.celexDeCita(t)[0];
  ok(c('Reglamento (UE) 2016/679') === '32016R0679', 'Reglamento (UE) 2016/679 -> 32016R0679 (año/número desde 2015)');
  ok(c('Reglamento (CE) n.º 44/2001') === '32001R0044', 'Reglamento (CE) n.º 44/2001 -> 32001R0044 (número/año antes de 2015)');
  ok(c('Reglamento (UE) n.º 1215/2012') === '32012R1215', 'Reglamento (UE) n.º 1215/2012 -> 32012R1215');
  ok(c('Directiva 95/46/CE') === '31995L0046', 'Directiva 95/46/CE -> 31995L0046 (año con dos cifras)');
  ok(c('Directiva (UE) 2019/1023') === '32019L1023', 'Directiva (UE) 2019/1023 -> 32019L1023');
  ok(c('Decisión 2011/833/UE') === '32011D0833', 'Decisión 2011/833/UE -> 32011D0833');
  ok(c('RGPD') === '32016R0679' && c('AI Act') === '32024R1689' && c('Bruselas I bis') === '32012R1215', 'atajos en castellano e inglés');
  ok(c('Roma III') === '32010R1259' && c('Rome III') === '32010R1259' && c('Roma II') === '32007R0864', 'Roma III, sin confundirlo con Roma II');
  ok(c('Bruselas II bis') === '32003R2201' && c('Brussels IIa') === '32003R2201' && c('Bruselas II ter') === '32019R1111', 'Bruselas II bis (derogado) y Bruselas II ter');
  ok(c('CELEX:32016R0679') === '32016R0679', 'acepta el CELEX directamente');
  ok(m.celexDeCita('Ley 3/2018').length === 0, 'una ley española no da CELEX');
  ok(m.celexDeCita('32016R0679" } ; DROP').length === 0, 'un CELEX con basura detrás no pasa la validación (sin inyección en SPARQL)');

  console.log('\n2) ¿Es una cita europea?');
  ok(m.esCitaUE('Reglamento (UE) 2016/679') && m.esCitaUE('Reglamento UE 2016/679') && m.esCitaUE('Directiva 95/46/CE') && m.esCitaUE('RGPD'), 'reconoce reglamentos, directivas y siglas de la UE');
  ok(m.esCitaUE('Regulation (EU) 2016/679'), 'y la forma inglesa');
  ok(!m.esCitaUE('Reglamento General de Costas') && !m.esCitaUE('Ley Orgánica 3/2018') && !m.esCitaUE('Real Decreto 1720/2007'), 'no confunde normas españolas');

  console.log('\n3) Idioma');
  ok(m.idiomaUE() === 'es' && m.idiomaUE('castellano') === 'es' && m.idiomaUE('Español') === 'es', 'castellano por defecto');
  ok(m.idiomaUE('en') === 'en' && m.idiomaUE('inglés') === 'en' && m.idiomaUE('English') === 'en', 'inglés');
  await lanza(() => m.idiomaUE('fr'), /Solo castellano/, 'cualquier otro idioma es un error explícito');

  console.log('\n4) Parseo de los cuatro formatos de XHTML');
  const o = m.articulosXhtmlUE(ORIGINAL_ES);
  ok(o.length === 2 && o[0].numero === '1' && o[0].titulo === 'Objeto' && /^1\. El presente/.test(o[0].texto), 'original (oj-*): número, título y texto');
  ok(!/CAPÍTULO II/.test(o[0].texto) && !/Hecho en Bruselas/.test(o[1].texto) && !/DO C 1/.test(o[1].texto), 'corta en el capítulo siguiente, la fórmula final y las notas');
  const k = m.articulosXhtmlUE(CONSOLIDADO('ES', 'Artículo', 'Objeto', '►M1 Texto ◄ consolidado.', 'Insertado.'));
  ok(k.length === 2 && k[1].numero === '4 bis' && k[1].titulo === 'Insertado', 'consolidado (*-norm): artículo "4 bis" con su título');
  ok(/^1\. Texto consolidado\.$/.test(k[0].texto), 'quita las marcas ►M1/◄ y une el número de apartado con su texto');
  ok(!/▼M1/.test(k[0].texto) && !/anexo/i.test(k[1].texto), 'sin párrafos modref ni el anexo');
  const a = m.articulosXhtmlUE(ANTIGUO);
  ok(a.length === 2 && a[0].titulo === 'Objeto' && a[1].titulo === null && /^1\. Primer apartado/.test(a[1].texto) && !/Luxemburgo/.test(a[1].texto), 'HTML antiguo sin clases: título solo si lo hay');
  ok(m.articulosXhtmlUE(HOJA_DEROGADA).length === 0, 'la hoja de un acto derogado no tiene articulado');
  ok(m.claveArticuloUE('art. 17.1') === '17' && m.claveArticuloUE('Artículo 4 bis') === '4 bis' && m.claveArticuloUE('Article 5') === '5', 'normaliza el número de artículo');

  console.log('\n5) Ficha y texto (transporte falso)');
  const f = await m.fichaNormaUE('RGPD');
  ok(f.estado === 'OK' && f.celex === '32016R0679' && f.resuelta_por === 'atajo' && f.idioma === 'es', 'ficha por siglas, en castellano');
  ok(Array.isArray(f.conocido_como) && f.conocido_como.includes('RGPD') && f.conocido_como.includes('GDPR'), 'la ficha trae sus nombres usuales (conocido_como), para no ponerlos de memoria');
  ok(f.version_consolidada_vigente.celex === '02016R0679-20200101', 'la versión vigente es la última ya pasada, no la futura (2099)');
  ok(f.versiones_consolidadas.some((v) => v.futura && v.desde === '01/01/2099') && f.modificada_por[0] === '32019R0001', 'lista las futuras y los actos que lo modifican');
  ok(f.url === 'https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32016R0679' && f.url_doue === 'https://data.europa.eu/eli/reg/2016/679/oj/spa', 'enlaces a EUR-Lex y al DOUE en castellano');
  const fEn = await m.fichaNormaUE('GDPR', 'en');
  ok(fEn.titulo === ACTOS['32016R0679'].titulos.ENG && fEn.titulo_es === ACTOS['32016R0679'].titulos.SPA && /\/EN\/TXT\//.test(fEn.url) && /\/oj\/eng$/.test(fEn.url_doue), 'en inglés: título inglés, título castellano de referencia y enlaces EN');

  const t = await m.textoArticuloUE('Reglamento (UE) 2016/679', '1');
  ok(t.estado === 'OK' && t.articulo === 'Artículo 1' && t.articulo_titulo === 'Objeto' && /inventado/.test(t.texto), 'texto del artículo en castellano');
  ok(t.version === 'texto consolidado' && t.version_desde === '01/01/2020' && t.versiones_futuras[0] === '01/01/2099', 'con version_desde y aviso de la versión futura');
  ok(t.conocido_como && t.conocido_como.includes('RGPD'), 'el texto del artículo también trae conocido_como');
  const tEn = await m.textoArticuloUE('Reglamento (UE) 2016/679', '4 bis', 'en');
  ok(tEn.estado === 'OK' && tEn.articulo === 'Article 4 bis' && /^Made-up/.test(tEn.texto), 'el mismo acto en inglés sale del documento inglés');
  const inexistente = await m.textoArticuloUE('RGPD', '200');
  ok(inexistente.estado === 'ARTICULO_NO_ENCONTRADO', 'artículo inexistente: estado explícito');

  const sinIngles = await m.textoArticuloUE('Reglamento (UE) n.º 1215/2012', '1', 'en');
  ok(sinIngles.estado === 'IDIOMA_NO_DISPONIBLE' && !sinIngles.texto, 'si no existe en inglés lo dice, sin servir el castellano');
  const original = await m.textoArticuloUE('Reglamento (UE) n.º 1215/2012', '2');
  ok(original.estado === 'OK' && /original/.test(original.version) && original.version_desde === null && /Entrará/.test(original.texto), 'sin versión consolidada usa el original y lo dice');

  const derogada = await m.textoArticuloUE('Directiva 95/46/CE', '1');
  ok(derogada.estado === 'NORMA_NO_VIGENTE' && derogada.version_celex === '01995L0046-20031120' && /no tiene articulado/.test(derogada.aviso_version), 'acto derogado: retrocede a la última versión con texto y avisa');
  ok(derogada.fin_de_vigencia === '24/05/2018', 'con su fecha de fin de vigencia');

  const peticionesAntes = peticionesRed;
  const noExiste = await m.textoArticuloUE('Reglamento (UE) 2025/9999', '1');
  ok(noExiste.estado === 'NO_RESUELTA' && /No he localizado/.test(noExiste.detalle), 'un acto que no existe: NO_RESUELTA, nunca un texto');
  const noUE = await m.fichaNormaUE('Ley 39/2015');
  ok(noUE.estado === 'NO_RESUELTA', 'una ley española en ue_ficha_norma: NO_RESUELTA');
  ok(peticionesRed - peticionesAntes <= 3, 'sin CELEX reconocible no se consulta la red');

  console.log('\n6) Búsqueda (índice de texto, castellano e inglés)');
  const b = await m.buscarNormasUE({ texto_es: 'protección "de" las datos', texto_en: 'data protection' });
  const qb = consultas[consultas.length - 1];
  ok(b.resultados === 2 && b.idioma === 'es' && b.anios === 'todos', 'busca en todos los años y tipos si no se acotan');
  ok(b.normas[0].celex === '32016R0679' && b.normas[0].encontrada_por.join('+') === 'castellano+inglés', 'agrupa por acto e indica en qué idioma coincidió');
  ok(b.normas[0].conocido_como.includes('RGPD') && !('conocido_como' in b.normas[1]), 'conocido_como solo en los actos de la tabla de atajos');
  ok(b.normas[1].celex === '32019R0001' && b.normas[1].titulo === null && /no tiene título en castellano/.test(b.normas[1].aviso_idioma), 'sin título en el idioma pedido, lo dice');
  ok(b.normas[1].en_vigor === false && b.normas[1].fin_de_vigencia === '31/07/2022' && b.normas[0].fin_de_vigencia === null, 'un acto que ya no está en vigor trae su fin_de_vigencia (para que Claude no la ponga de memoria)');
  ok(qb.includes(`bif:contains '"protección" AND "datos"'`) && qb.includes(`bif:contains '"data" AND "protection"'`) && /UNION/.test(qb), 'una rama por idioma con todas sus palabras, unidas con UNION');
  ok(!/"de"|"las"/.test(qb), 'quita las palabras vacías (el índice se hunde con ellas)');
  ok(!/SUBSTR\(STR\(\?celex\), 6, 1\)/.test(qb) && !/\?fecha >=/.test(qb) && /STRLEN\(STR\(\?celex\)\) = 10/.test(qb), 'sin filtros de tipo ni de años, y sin fes de erratas (CELEX de 10 caracteres)');
  await m.buscarNormasUE({ texto: 'consumo', tipo: 'directiva', anio_desde: 2008, anio_hasta: 2023, idioma: 'en' });
  const qt = consultas[consultas.length - 1];
  ok(qt.includes(`bif:contains '"consumo"'`) && !/BIND\("en"/.test(qt), '"texto" vale como texto_es');
  ok(/SUBSTR\(STR\(\?celex\), 6, 1\) = "L"/.test(qt) && qt.includes('"2008-01-01"') && qt.includes('"2023-12-31"') && /language\/ENG> ; cdm:expression_title \?titulo/.test(qt), 'con tipo, años y títulos del resultado en inglés');
  await m.buscarNormasUE({ texto_es: `consumo' } ; DROP "x" divorci* abc*` });
  const qi = consultas[consultas.length - 1];
  ok(qi.includes(`'"consumo" AND "drop" AND "divorci*" AND "abc"'`), 'de cada palabra solo pasan letras y números; el prefijo * solo con 4 letras o más');
  ok(!qi.includes("' }") && !qi.includes('"x"'), 'las comillas y llaves del usuario no llegan a la consulta');
  await lanza(() => m.buscarNormasUE({ texto_es: 'datos', tipo: 'ley' }), /tipo no válido/, 'tipo desconocido: error explícito');
  await lanza(() => m.buscarNormasUE({ texto_es: 'datos', anio_desde: 2020, anio_hasta: 2010 }), /años válidos/, 'rango de años al revés: error explícito');
  await lanza(() => m.buscarNormasUE({ texto_es: 'de la', texto_en: 'of the' }), /Hacen falta palabras/, 'sin palabras útiles: error explícito');

  console.log('\n6b) Reintentos ante CELLAR irregular');
  fallosSparql.push('timeout');
  const tras = await m.buscarNormasUE({ texto_es: 'reintento tras timeout' });
  ok(tras.resultados === 1, 'la búsqueda reintenta una vez si el primer intento agota su tiempo');
  fallosSparql.push(503);
  const tras503 = await m.buscarNormasUE({ texto_es: 'reintento tras mantenimiento' });
  ok(tras503.resultados === 1, 'un 503 pasajero («Web Site Under Maintenance») se reintenta');
  fallosSparql.push('red');
  const trasRed = await m.buscarNormasUE({ texto_es: 'reintento tras corte' });
  ok(trasRed.resultados === 1, 'un corte de red (ETIMEDOUT) se reintenta');
  fallosSparql.push('timeout', 'timeout');
  await lanza(() => m.buscarNormasUE({ texto_es: 'dos timeouts seguidos' }), /tras dos intentos/, 'dos timeouts seguidos: error explícito, sin más reintentos');
  fallosSparql.push('timeout');
  await lanza(() => m.fichaNormaUE('Reglamento (UE) 2018/1'), /no respondió/, 'en la ficha un timeout no se reintenta (ya da 30 s)');
  fallosSparql.length = 0;

  console.log('\n7) Verificación de escritos');
  const citas = m.extraerCitas('Conforme al art. 6.1 del Reglamento (UE) 2016/679 y al artículo 17 RGPD, y al art. 7 del Reglamento (CE) n.º 44/2001.');
  ok(citas.some((x) => x.tipo === 'articulo' && x.articulo === '6.1' && x.norma_texto === 'Reglamento UE 2016/679'), 'detecta "art. 6.1 del Reglamento (UE) 2016/679" (paréntesis normalizados)');
  ok(citas.some((x) => x.articulo === '17' && x.norma_texto === 'RGPD'), 'detecta "artículo 17 RGPD"');
  ok(citas.some((x) => x.articulo === '7' && x.norma_texto === 'Reglamento CE 44/2001'), 'detecta "Reglamento (CE) n.º 44/2001" sin cortarse en "n.º"');
  ok(citas.some((x) => x.tipo === 'norma' && x.cita === 'Reglamento UE 2016/679'), 'y la norma europea suelta');
  const v = await m.verificarCitaMultifuente('RGPD', '1');
  ok(v.fuente === m.FUENTE_UE && v.estado === 'OK', 'boe_verificar_cita manda las citas europeas a CELLAR, no al BOE');
  ok(m.FUENTE_UE !== 'BOE · legislación consolidada' && /2011\/833\/UE/.test(m.AVISO_UE) && /CC BY 4\.0/.test(m.AVISO_UE) && /216\/2013/.test(m.AVISO_UE), 'fuente y aviso propios: licencia, CC BY 4.0 y autenticidad del DOUE');

  // La app de escritorio repite la lista de hosts; sin la UE, la cita queda NO_RESUELTA como antes.
  m.configurar({ transporte: async ({ host }) => { throw new Error(`host no permitido: ${host}`); } });
  const app = await m.verificarCitaMultifuente('Directiva (UE) 2019/1023', '2');
  ok(app.estado === 'NO_RESUELTA' && app.fuente === m.FUENTE_UE, 'con un transporte que no admite la UE, NO_RESUELTA en vez de error');

  fs.rmSync(cacheDir, { recursive: true, force: true });
  console.log(fallos === 0 ? '\n=== TODO CORRECTO ===' : `\n=== ${fallos} FALLOS ===`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
