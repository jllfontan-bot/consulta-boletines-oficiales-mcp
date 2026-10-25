// Pruebas SIN RED del BORME: transporte falso con el formato real de la API
// (comprobado el 18/10/2026), pero con empresas y personas INVENTADAS.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const m = require('../server/nucleo.js');

let fallos = 0;
const ok = (cond, msg) => { if (!cond) { fallos++; console.log('  FALLO: ' + msg); } else { console.log('  ok: ' + msg); } };
const lanza = async (fn, re, msg) => {
  try { await fn(); ok(false, `${msg} (no lanzó error)`); } catch (e) { ok(re.test(e.message), `${msg} (${e.message})`); }
};

const item = (id, titulo) => ({
  identificador: id,
  titulo,
  url_pdf: { szBytes: '1000', szKBytes: '1', pagina_inicial: '100', pagina_final: '101', texto: `https://www.boe.es/borme/dias/2099/01/05/pdfs/${id}.pdf` },
  url_html: `https://www.boe.es/diario_borme/txt.php?id=${id}`,
  url_xml: `https://www.boe.es/diario_borme/xml.php?id=${id}`,
});

const SUMARIO = {
  status: { code: '200', text: 'ok' },
  data: { sumario: {
    metadatos: { publicacion: 'BORME', fecha_publicacion: '20990105' },
    diario: {
      numero: '3',
      seccion: [
        { codigo: 'A', nombre: 'SECCIÓN PRIMERA. Empresarios. Actos inscritos', item: [
          item('BORME-A-2099-3-01', 'ARABA/ÁLAVA'),
          item('BORME-A-2099-3-28', 'MADRID'),
          item('BORME-A-2099-3-99', 'ÍNDICE ALFABÉTICO DE SOCIEDADES'),
        ] },
        { codigo: 'B', nombre: 'SECCIÓN PRIMERA. Empresarios. Otros actos publicados en el Registro Mercantil', item: item('BORME-B-2099-3-28', 'MADRID') },
        { codigo: 'C', nombre: 'SECCIÓN SEGUNDA. Anuncios y avisos legales', apartado: [
          { codigo: '002', nombre: 'CONVOCATORIAS DE JUNTAS', item: [item('BORME-C-2099-11', 'QUESERÍAS INVENTADAS DEL NORTE, S.A.'), item('BORME-C-2099-12', 'OTRA EMPRESA FICTICIA, S.L.')] },
          { codigo: '003', nombre: 'FUSIONES Y ABSORCIONES DE EMPRESAS', item: item('BORME-C-2099-13', 'QUESERIAS INVENTADAS DEL NORTE SA') },
        ] },
      ],
    },
  } },
};

const doc = (id, titulo, seccion, cuerpo, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<documento fecha_actualizacion="20990105T071825Z">
  <metadatos>
    <identificador>${id}</identificador>
    <titulo>${titulo}</titulo>
    <diario>Boletín Oficial del Registro Mercantil</diario>
    <diario_numero>3</diario_numero>
    <seccion codigo="${seccion}">SECCI&#211;N</seccion>${extra}
    <fecha_publicacion>20990105</fecha_publicacion>
    <pagina_inicial>100</pagina_inicial>
    <pagina_final>101</pagina_final>
    <url_pdf>https://www.boe.es/borme/dias/2099/01/05/pdfs/${id}.pdf</url_pdf>
  </metadatos>
  <texto>
${cuerpo}
  </texto>
</documento>`;

const XML = {
  'BORME-A-2099-3-28': doc('BORME-A-2099-3-28', 'MADRID', 'A', `
    <p class="articulo">900001 - QUESERIAS INVENTADAS DEL NORTE SA.</p>
    <p class="parrafo">Nombramientos. Adm. Unico: PERSONA FICTICIA UNO.  Datos registrales. S 8 , H M 1, I/A 2 ( 2.01.99).</p>
    <p class="articulo">900002 - QUESERIAS INVENTADAS DEL SUR SL.</p>
    <p class="parrafo">Ceses/Dimisiones. Adm. Unico: PERSONA FICTICIA DOS.  Datos registrales. S 8 , H M 3, I/A 4 ( 2.01.99).</p>
    <p class="articulo">900003 - INVENTADAS NORTE SL.</p>
    <p class="parrafo">Constitución. Socio único: PERSONA FICTICIA TRES.</p>`),
  'BORME-B-2099-3-28': doc('BORME-B-2099-3-28', 'MADRID', 'B', `
    <p class="centro_redonda">Depósitos de proyectos de escisión parcial</p>
    <p class="articulo">501 - QUESERIAS INVENTADAS DEL NORTE SA. (03/01/2099)</p>`),
  'BORME-A-2099-3-01': doc('BORME-A-2099-3-01', 'ARABA/ÁLAVA', 'A', `
    <p class="articulo">900010 - QUESERIAS INVENTADAS DEL NORTE SA.</p>
    <p class="parrafo">Nombramientos. Apoderado: PERSONA FICTICIA CUATRO.</p>`),
  // Índice alfabético del día (formato real: tabla de tres celdas; las filas de una celda son la letra).
  'BORME-A-2099-3-99': doc('BORME-A-2099-3-99', 'ÍNDICE ALFABÉTICO DE SOCIEDADES', 'A', `
    <table class="sinbordes"><tbody>
      <tr><td class="cuerpo_tabla_centro" colspan="3"><p class="centro_negrita">I</p></td></tr>
      <tr><td>INVENTADAS NORTE SL.</td><td><p class="cuerpo_tabla_izq">BORME-A-2099-3-28</p></td><td> (900003) </td></tr>
      <tr><td>QUESERIAS INVENTADAS DEL NORTE SA.</td><td><p class="cuerpo_tabla_izq">BORME-A-2099-3-01</p></td><td> (900010) </td></tr>
      <tr><td>QUESERIAS INVENTADAS DEL NORTE SA.</td><td><p class="cuerpo_tabla_izq">BORME-A-2099-3-28</p></td><td> (900001) </td></tr>
      <tr><td>QUESERIAS INVENTADAS DEL SUR SL.</td><td><p class="cuerpo_tabla_izq">BORME-A-2099-3-28</p></td><td> (900002) </td></tr>
    </tbody></table>`),
  'BORME-C-2099-11': doc('BORME-C-2099-11', 'QUESERÍAS INVENTADAS DEL NORTE, S.A.', 'C', `
    <p class="parrafo">Se convoca junta general ordinaria en el domicilio social.</p>
    <p class="centro_redonda">Orden del d&#237;a</p>
    <p class="parrafo">Primero.- Aprobaci&#243;n de las cuentas.</p>`, `
    <departamento>CONVOCATORIAS DE JUNTAS</departamento>
    <id_anuncio>A990000001</id_anuncio>`),
};

const peticiones = [];
m.configurar({
  cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'borme-test-')),
  transporte: async ({ host, path: ruta }) => {
    peticiones.push(ruta);
    if (host !== 'www.boe.es') throw new Error('host inesperado ' + host);
    if (ruta === '/datosabiertos/api/borme/sumario/20990105') return { status: 200, headers: {}, body: JSON.stringify(SUMARIO) };
    if (ruta.startsWith('/datosabiertos/api/borme/sumario/')) return { status: 404, headers: {}, body: '<response><status><code>404</code></status></response>' };
    const id = decodeURIComponent((/[?&]id=([^&]+)/.exec(ruta) || [])[1] || '');
    if (ruta.startsWith('/diario_borme/xml.php') && XML[id]) return { status: 200, headers: {}, body: XML[id] };
    if (ruta.startsWith('/diario_borme/xml.php')) return { status: 200, headers: {}, body: '<?xml version="1.0"?>\n<error><descripcion>Documento con referencia desconocida.</descripcion></error>' };
    throw new Error('ruta inesperada ' + ruta);
  },
});

(async () => {
  console.log('\n1) Provincias y denominaciones');
  ok(m.provinciaBorme('28').nombre === 'Madrid' && m.provinciaBorme(1).codigo === '01', 'provincia por código INE');
  ok(m.provinciaBorme('Vizcaya').codigo === '48' && m.provinciaBorme('la coruña').codigo === '15' && m.provinciaBorme('Álava').codigo === '01', 'provincia por nombre, con nombres alternativos');
  ok(m.provinciaBorme('99') === null && m.provinciaBorme('Atlántida') === null, 'el 99 (índice) y nombres desconocidos no son provincias');
  ok(Object.keys(m.PROVINCIAS_BORME).length === 52, 'las 52 provincias del INE');
  ok(m.consultaDenominacion('Queserías Inventadas, S.A.').join(' ') === 'queserias inventadas', 'la consulta quita la forma social y los acentos');
  ok(m.consultaDenominacion('S.L.').length === 0 && m.consultaDenominacion('ab').length === 0, 'una consulta sin denominación útil queda vacía');
  const q = m.consultaDenominacion('Inventadas del Norte');
  ok(m.coincideDenominacion('QUESERIAS INVENTADAS DEL NORTE SA.', q), 'coincide si las palabras van seguidas');
  ok(!m.coincideDenominacion('INVENTADAS NORTE SL.', q), 'no coincide si falta una palabra');
  ok(!m.coincideDenominacion('REINVENTADAS DEL NORTE SL.', q), 'compara palabras enteras, no trozos');

  console.log('\n2) Parseo de documentos (formato real)');
  const actos = m.actosDocumentoBorme(XML['BORME-A-2099-3-28']);
  ok(actos.length === 3 && actos[0].numero === '900001' && actos[0].denominacion === 'QUESERIAS INVENTADAS DEL NORTE SA.', 'separa los actos de la Sección Primera por su cabecera');
  ok(/Adm\. Unico/.test(actos[0].texto) && !/FICTICIA DOS/.test(actos[0].texto), 'cada acto lleva solo su propio párrafo');
  const actosB = m.actosDocumentoBorme(XML['BORME-B-2099-3-28']);
  ok(actosB[0].tipo === 'Depósitos de proyectos de escisión parcial' && actosB[0].fecha_indicada === '03/01/2099' && actosB[0].denominacion === 'QUESERIAS INVENTADAS DEL NORTE SA.', 'Sección B: tipo de acto y fecha entre paréntesis');
  const meta = m.metadatosBorme(XML['BORME-C-2099-11']);
  ok(meta.apartado === 'CONVOCATORIAS DE JUNTAS' && meta.fecha_actualizacion === '2099-01-05T07:18:25Z' && meta.fecha_publicacion === '05/01/2099', 'metadatos: apartado, fecha de actualización y de publicación');
  const docs = m.documentosSumarioBorme(SUMARIO.data.sumario);
  ok(docs.length === 7 && docs.filter((d) => d.seccion === 'C').every((d) => d.apartado), 'el sumario da los documentos de A, B y C (con su apartado)');
  const idx = m.entradasIndiceBorme(XML['BORME-A-2099-3-99']);
  ok(idx.length === 4 && idx[1].documento_id === 'BORME-A-2099-3-01' && idx[1].numero_acto === '900010' && idx[1].denominacion === 'QUESERIAS INVENTADAS DEL NORTE SA.', 'índice alfabético: denominación, documento y número de acto (sin la fila de la letra)');

  console.log('\n3) buscarBorme');
  peticiones.length = 0;
  const sinProv = await m.buscarBorme({ denominacion: 'Queserías Inventadas del Norte', fecha_desde: '2099-01-04', fecha_hasta: '2099-01-05' });
  ok(sinProv.anuncios.length === 2, `sin provincia: anuncios de la Sección C (dio ${sinProv.anuncios.length})`);
  ok(sinProv.anuncios[0].fecha_publicacion === '05/01/2099', `la fecha de los anuncios va en dd/mm/aaaa, como la de los actos (dio ${sinProv.anuncios[0].fecha_publicacion})`);
  ok(sinProv.actos.length === 3 && ['01', '28'].every((p) => sinProv.actos.some((a) => a.documento_id.endsWith('-' + p))), `sin provincia: actos de toda España vía el índice, A y B (dio ${sinProv.actos.length})`);
  ok(sinProv.dias_revisados === 2 && sinProv.dias_con_borme === 1 && !sinProv.nota_indice, 'un día sin BORME (404) no es un error');
  ok(!JSON.stringify(sinProv).includes('FICTICIA DOS') && !JSON.stringify(sinProv).includes('FICTICIA TRES'), 'sin provincia tampoco devuelve actos de otras empresas');
  peticiones.length = 0;
  const soloIndice = await m.buscarBorme({ denominacion: 'Empresa Que No Esta En El Indice', fecha_desde: '2099-01-05' });
  ok(soloIndice.actos.length === 0 && !peticiones.some((p) => /BORME-A-2099-3-(01|28)/.test(p)), 'si la empresa no está en el índice no se descarga ningún documento de la Sección A');
  peticiones.length = 0;
  const conProv = await m.buscarBorme({ denominacion: 'queserias inventadas del norte sa', provincia: 'Madrid', fecha_desde: '20990105' });
  ok(conProv.actos.length === 2 && conProv.actos.every((a) => a.denominacion.startsWith('QUESERIAS INVENTADAS DEL NORTE')), 'con provincia: los actos de A y B de esa empresa');
  ok(!JSON.stringify(conProv).includes('FICTICIA DOS') && !JSON.stringify(conProv).includes('FICTICIA TRES'), 'nunca devuelve los actos de otras empresas');
  ok(!JSON.stringify(conProv).includes('FICTICIA CUATRO') && !peticiones.some((p) => p.includes('-01')), 'solo descarga los documentos de la provincia pedida');
  ok(conProv.actos[0].url_pdf.endsWith('BORME-A-2099-3-28.pdf') && conProv.actos[0].fecha_actualizacion && conProv.actos[0].url, 'cada acto lleva url, url_pdf y fecha de actualización');
  const porPersona = await m.buscarBorme({ denominacion: 'Persona Ficticia Uno', provincia: '28', fecha_desde: '20990105' });
  ok(porPersona.actos.length === 0 && porPersona.anuncios.length === 0, 'el nombre de una persona no encuentra nada: solo se compara con la denominación');
  await lanza(() => m.buscarBorme({ denominacion: 'S.A.', fecha_desde: '20990105' }), /denominación/, 'exige una denominación útil');
  await lanza(() => m.buscarBorme({ denominacion: 'Inventadas', provincia: 'Atlántida', fecha_desde: '20990105' }), /Provincia no reconocida/, 'rechaza una provincia desconocida');
  await lanza(() => m.buscarBorme({ denominacion: 'Inventadas', fecha_desde: '2099-01-01', fecha_hasta: '2099-02-15' }), /31 días/, 'tope de 31 días');
  await lanza(() => m.buscarBorme({ denominacion: 'Inventadas', fecha_desde: '2008-12-31' }), /2009/, 'no hay sumarios antes de 2009');
  await lanza(() => m.buscarBorme({ denominacion: 'Inventadas', fecha_desde: '2099-02-30' }), /fecha real/, 'rechaza una fecha imposible');

  console.log('\n4) textoBorme');
  const anuncio = await m.textoBorme('BORME-C-2099-11');
  ok(anuncio.estado === 'OK' && /Orden del día/.test(anuncio.texto) && /Aprobación/.test(anuncio.texto), 'anuncio de la Sección C: texto completo con entidades decodificadas');
  ok(anuncio.apartado === 'CONVOCATORIAS DE JUNTAS' && anuncio.url_pdf && anuncio.fecha_actualizacion, 'el anuncio lleva apartado, url_pdf y fecha de actualización');
  await lanza(() => m.textoBorme('BORME-A-2099-3-28'), /denominación/, 'un documento de provincia exige la denominación');
  const deEmpresa = await m.textoBorme('BORME-A-2099-3-28', 'Queserias Inventadas del Sur');
  ok(deEmpresa.estado === 'OK' && deEmpresa.actos.length === 1 && deEmpresa.actos[0].numero_acto === '900002', 'de un documento de provincia, solo los actos de esa empresa');
  const noHay = await m.textoBorme('BORME-A-2099-3-28', 'Empresa Que No Esta');
  ok(noHay.estado === 'ACTO_NO_ENCONTRADO' && noHay.actos.length === 0, 'estado explícito si la empresa no tiene actos en ese documento');
  await lanza(() => m.textoBorme('BORME-C-2099-999'), /no existe en el BORME/, 'un id desconocido (200 con <error>) se trata como inexistente');
  await lanza(() => m.textoBorme('BORME-A-2099-3'), /no válido/, 'rechaza un id de la Sección A sin provincia');
  await lanza(() => m.textoBorme('../../etc'), /no válido/, 'rechaza cualquier id que no sea del BORME');

  console.log('\n5) Aviso y procedencia');
  ok(/RD 1979\/2008/.test(m.AVISO_BORME) && /RGPD/.test(m.AVISO_BORME) && /Basado en datos de la Agencia Estatal Boletín Oficial del Estado/.test(m.AVISO_BORME), 'el aviso cita el RD 1979/2008, el RGPD y la fuente como pide la licencia');
  ok(m.FUENTE_BORME !== 'BOE · legislación consolidada' && /no legislación/.test(m.TIPO_BORME), 'fuente y tipo propios, distintos de la legislación consolidada');

  console.log(fallos === 0 ? '\n=== TODO CORRECTO ===' : `\n=== ${fallos} FALLOS ===`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
