const { spawn } = require('node:child_process');
const path = require('node:path');

const srv = spawn('node', [path.join(__dirname, '..', 'server', 'index.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
const respuestas = new Map();
let buf = '';
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  FALLO: ' + m); } else console.log('  ok: ' + m); };

srv.stdout.setEncoding('utf8');
srv.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!l) continue;
    const msg = JSON.parse(l);
    if (respuestas.has(msg.id)) { respuestas.get(msg.id)(msg); respuestas.delete(msg.id); }
  }
});

let seq = 0;
function pedir(method, params) {
  const id = ++seq;
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('sin respuesta a ' + method)), 45000);
    respuestas.set(id, (m) => { clearTimeout(t); res(m); });
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

// Segundo servidor, con un cliente que no declara io.modelcontextprotocol/ui.
async function clienteSinApps() {
  const otro = spawn('node', [path.join(__dirname, '..', 'server', 'index.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pendientes = new Map();
  let resto = '';
  let n = 0;
  otro.stdout.setEncoding('utf8');
  otro.stdout.on('data', (d) => {
    resto += d;
    let i;
    while ((i = resto.indexOf('\n')) >= 0) {
      const l = resto.slice(0, i).trim();
      resto = resto.slice(i + 1);
      if (!l) continue;
      const msg = JSON.parse(l);
      if (pendientes.has(msg.id)) { pendientes.get(msg.id)(msg); pendientes.delete(msg.id); }
    }
  });
  const rpc = (method, params) => new Promise((res, rej) => {
    const id = ++n;
    const t = setTimeout(() => rej(new Error('sin respuesta a ' + method)), 15000);
    pendientes.set(id, (m) => { clearTimeout(t); res(m); });
    otro.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const llamar = async (name, args) => JSON.parse((await rpc('tools/call', { name, arguments: args })).result.content[0].text);
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sin-apps', version: '1' } });
    const nombres = (await rpc('tools/list', {})).result.tools.map((t) => t.name);
    ok(nombres.length === 18, `lista 18 herramientas, sin las dos internas (${nombres.length})`);
    ok(!nombres.includes('cendoj_permiso_respuesta') && !nombres.includes('boe_ambito_seleccionado'), 'no lista cendoj_permiso_respuesta ni boe_ambito_seleccionado');
    ok(nombres.includes('cendoj_pedir_permiso') && nombres.includes('boe_elegir_ambito'), 'sí lista cendoj_pedir_permiso y boe_elegir_ambito (con su texto alternativo)');
    const pedido = await llamar('cendoj_pedir_permiso', { motivo: 'comprobar una sentencia' });
    ok(pedido.ventana_mostrada === null && /no admite ventanas/.test(pedido.instruccion) && /Responde sí o no/.test(pedido.instruccion), 'cendoj_pedir_permiso no dice que haya ventana y manda preguntar por texto');
    const autoSi = await llamar('cendoj_permiso_respuesta', { autorizado: true });
    ok(/^RECHAZADO/.test(autoSi.permiso_cendoj), 'aunque se haya pedido permiso, una llamada directa con autorizado: true se RECHAZA');
    const ambito = await llamar('boe_ambito_seleccionado', { boe: true, cendoj: true });
    ok(/^RECHAZADO/.test(ambito.ambito_elegido_por_el_usuario), 'boe_ambito_seleccionado también se rechaza');
    const elegir = await llamar('boe_elegir_ambito', {});
    ok(elegir.formulario_mostrado === null && !!elegir.texto_alternativo_si_no_hay_formulario, 'boe_elegir_ambito no dice que haya formulario y trae la pregunta en texto');
  } finally {
    otro.kill();
  }
}

(async () => {
  console.log('\n1) Handshake');
  // Como Claude Desktop: declara MCP Apps (las secciones 2-5 prueban ese caso;
  // la 6 repite lo esencial con un cliente que NO las admite).
  const init = await pedir('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
    clientInfo: { name: 'test', version: '1' },
  });
  ok(init.result && init.result.protocolVersion === '2025-06-18', 'devuelve la versión de protocolo pedida');
  ok(init.result.serverInfo.name === 'boe-consolidada', 'se identifica correctamente');
  const manifestVersion = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  ok(init.result.serverInfo.version === manifestVersion.version, `1.5.9: la versión del servidor (${init.result.serverInfo.version}) coincide con manifest.json (${manifestVersion.version})`);
  ok(manifestVersion.display_name.endsWith('v' + manifestVersion.version), '1.5.9: el nombre visible de la extensión incluye la versión');
  ok(!!init.result.capabilities.tools, 'anuncia capacidad de herramientas');
  ok(/ÚNICA fuente/.test(init.result.instructions), 'incluye instrucciones de fuente única');
  ok(/cendoj_pedir_permiso/.test(init.result.instructions), 'las instrucciones del servidor exigen pedir permiso antes de consultar el CENDOJ');
  ok(/NUNCA la búsqueda web general/.test(init.result.instructions), 'las instrucciones del servidor excluyen la búsqueda web general como "navegador" para el CENDOJ');
  ok(/REGLA Nº 2/.test(init.result.instructions) && /aunque me suene/.test(init.result.instructions), '1.5.11: regla nº 2 (Claude en Chrome solo de pago, dicho siempre) y prohibido "aunque me suene" al negarse');
  ok(/MIENTRAS ESPERAS/.test(init.result.instructions) && /NUNCA index\.jsp/.test(init.result.instructions) && /planes de pago/.test(init.result.instructions) && /plan gratuito/.test(init.result.instructions), '1.5.11: no describir la sentencia mientras se espera el permiso; siempre indexAN.jsp; Claude en Chrome solo en planes de pago (plan gratuito -> consulta manual)');
  ok(init.result.instructions.startsWith('REGLA Nº 1, SIN EXCEPCIONES') && /me suena/.test(init.result.instructions) && /ni al ofrecer tu ayuda/.test(init.result.instructions), '1.5.10: la prohibición de nombrar sentencias no verificadas es la REGLA Nº 1 (primera de las instrucciones)');
  ok(/uso particular/.test(init.result.instructions) && /NUNCA descargas masivas/.test(init.result.instructions) && /NO nombres ninguna sentencia concreta/.test(init.result.instructions), '1.5.9: consulta particular en nombre del usuario, sin descargas masivas y sin nombrar sentencias no verificadas');
  ok(/SIN NAVEGADOR REAL/.test(init.result.instructions) && /Claude en Chrome/.test(init.result.instructions) && /la consulta la realizas TÚ/.test(init.result.instructions), '1.5.8: sin navegador real explica qué falta (Claude en Chrome); con permiso la consulta la hace Claude en nombre del usuario');

  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  console.log('  ok: la notificación initialized no provoca respuesta ni caída');

  console.log('\n2) Listado de herramientas');
  const tl = await pedir('tools/list', {});
  const nombres = tl.result.tools.map((t) => t.name);
  const sinAnotar = tl.result.tools.filter((t) => !t.annotations || !t.annotations.title || typeof t.annotations.readOnlyHint !== 'boolean').map((t) => t.name);
  ok(sinAnotar.length === 0, `1.6.1: todas las herramientas llevan title y readOnlyHint${sinAnotar.length ? ' (faltan: ' + sinAnotar.join(', ') + ')' : ''}`);
  console.log('  herramientas:', nombres.join(', '));
  ok(nombres.length === 20, `expone 20 herramientas (${nombres.length})`);
  ok(nombres.includes('cendoj_pedir_permiso') && nombres.includes('cendoj_permiso_respuesta'), 'incluye las herramientas de permiso del CENDOJ');
  ok(nombres.includes('boe_verificar_escrito'), 'incluye el verificador de escritos');
  const borme = tl.result.tools.find((t) => t.name === 'boe_borme_buscar');
  ok(!!borme && /NO es legislación/.test(borme.description) && /NO sirve para buscar personas/.test(borme.description) && borme.inputSchema.required.includes('denominacion'), '1.6.0: boe_borme_buscar exige denominación, dice que no es legislación y que no sirve para buscar personas');
  ok(/boe_borme_\*/.test(init.result.instructions) && /nunca busques ni recopiles información sobre personas físicas/.test(init.result.instructions), '1.6.0: las instrucciones presentan el BORME como fuente aparte y prohíben buscar personas');
  const bormeMal = await pedir('tools/call', { name: 'boe_borme_texto', arguments: { id: 'BORME-A-2026-200-01' } });
  ok(bormeMal.result.isError === true && /denominación/.test(JSON.parse(bormeMal.result.content[0].text).error), '1.6.0: boe_borme_texto no devuelve un documento de provincia entero sin denominación');
  const malas = tl.result.tools.filter((t) => !t.description || !t.inputSchema || t.inputSchema.type !== 'object');
  ok(malas.length === 0, 'todas tienen descripción y esquema de entrada válido');

  console.log('\n3) Métodos auxiliares');
  ok((await pedir('ping', {})).result !== undefined, 'responde a ping');
  ok(Array.isArray((await pedir('prompts/list', {})).result.prompts), 'responde a prompts/list');
  const desc = await pedir('metodo/inexistente', {});
  ok(desc.error && desc.error.code === -32601, 'un método desconocido devuelve error -32601, no una caída');

  console.log('\n3b) Formulario de ámbito (MCP Apps)');
  const listaRecursos = await pedir('resources/list', {});
  const recursoAmbito = listaRecursos.result.resources.find((r) => r.uri === 'ui://boe-consolidada/ambito.html');
  ok(!!recursoAmbito && recursoAmbito.mimeType === 'text/html;profile=mcp-app', 'resources/list expone el formulario de ámbito con el mimeType correcto');
  const lecturaRecurso = await pedir('resources/read', { uri: 'ui://boe-consolidada/ambito.html' });
  const html = lecturaRecurso.result.contents[0].text;
  ok(html.includes('<form') === false && html.includes('name="boe"') && html.includes('name="ccaa"'), 'el HTML trae los checkboxes de boe/tc/cendoj y comunidades');
  const elegir = await pedir('tools/call', { name: 'boe_elegir_ambito', arguments: {} });
  ok(!elegir.result.isError && JSON.parse(elegir.result.content[0].text).texto_alternativo_si_no_hay_formulario, 'boe_elegir_ambito trae el texto alternativo para clientes sin formularios');
  const seleccion = await pedir('tools/call', {
    name: 'boe_ambito_seleccionado',
    arguments: { boe: true, tc: true, cendoj: false, comunidades: ['cataluna'] },
  });
  const datosSeleccion = JSON.parse(seleccion.result.content[0].text);
  ok(
    datosSeleccion.ambito_elegido_por_el_usuario.some((s) => s.includes('BOE')) &&
      datosSeleccion.ambito_elegido_por_el_usuario.some((s) => s.includes('Cataluña')),
    'boe_ambito_seleccionado traduce la selección del formulario a texto legible'
  );

  console.log('\n3c) Ventana de permiso del CENDOJ (MCP Apps)');
  const recursoCendoj = listaRecursos.result.resources.find((r) => r.uri === 'ui://boe-consolidada/cendoj-permiso.html');
  ok(!!recursoCendoj && recursoCendoj.mimeType === 'text/html;profile=mcp-app', 'resources/list expone la ventana de permiso del CENDOJ');
  const lecturaCendoj = await pedir('resources/read', { uri: 'ui://boe-consolidada/cendoj-permiso.html' });
  const htmlCendoj = lecturaCendoj.result.contents[0].text;
  ok(htmlCendoj.includes('id="si"') && htmlCendoj.includes('id="no"') && htmlCendoj.includes('cendoj_permiso_respuesta') && htmlCendoj.includes('ui/message'), 'la ventana trae los botones Autorizar/No autorizar y devuelve la respuesta por tools/call y ui/message');
  ok(/content: \[\{ type: 'text', text: texto \}\]/.test(htmlCendoj) && /clientInfo:/.test(htmlCendoj) && !/appInfo:/.test(htmlCendoj) && !/appInfo:/.test(html), '1.6.1: ui/message con lista de bloques; el saludo sigue siendo el de la 1.6.0 (con appInfo la ventana no se dibuja en Claude Desktop)');
  const descHerr = (n) => tl.result.tools.find((x) => x.name === n).description;
  ok(/NO se verifica aquí/.test(descHerr('boe_verificar_cita')) && /NO se verifican aquí/.test(descHerr('boe_verificar_escrito')), '1.5.10: los verificadores de citas avisan de que no verifican sentencias del Supremo/Audiencias');
  const herrPermiso = tl.result.tools.find((t) => t.name === 'cendoj_pedir_permiso');
  ok(herrPermiso._meta.ui.resourceUri === 'ui://boe-consolidada/cendoj-permiso.html', 'cendoj_pedir_permiso apunta a su ventana');
  const herrResp = tl.result.tools.find((t) => t.name === 'cendoj_permiso_respuesta');
  ok(herrResp._meta.ui.visibility[0] === 'app', 'cendoj_permiso_respuesta es solo para la ventana, oculta al modelo');
  const pedirPermiso = await pedir('tools/call', { name: 'cendoj_pedir_permiso', arguments: { motivo: 'comprobar la STS 623/2010' } });
  const datosPedir = JSON.parse(pedirPermiso.result.content[0].text);
  ok(!pedirPermiso.result.isError && /ESPERA/.test(datosPedir.instruccion) && /NO son autorización/.test(datosPedir.instruccion) && datosPedir.motivo === 'comprobar la STS 623/2010', 'cendoj_pedir_permiso ordena esperar la autorización explícita y trae la pregunta en texto');
  const permisoSi = JSON.parse((await pedir('tools/call', { name: 'cendoj_permiso_respuesta', arguments: { autorizado: true } })).result.content[0].text);
  ok(/^AUTORIZADO/.test(permisoSi.permiso_cendoj) && /indexAN\.jsp/.test(permisoSi.instruccion), 'la respuesta afirmativa habilita indexAN.jsp solo para esta tarea');
  ok(/Claude en Chrome/.test(permisoSi.instruccion) && /la consulta la realizas tú/.test(permisoSi.instruccion), '1.5.8: la autorización indica que la consulta la hace Claude y qué necesita sin navegador');
  // B9: cada respuesta es de UN SOLO USO -- hay que volver a pedir permiso
  // antes de cada una de las siguientes comprobaciones, igual que exige ya
  // el propio texto ("en otra [tarea], vuelve a llamar a cendoj_pedir_permiso").
  await pedir('tools/call', { name: 'cendoj_pedir_permiso', arguments: { motivo: 'otra consulta' } });
  const permisoNo = JSON.parse((await pedir('tools/call', { name: 'cendoj_permiso_respuesta', arguments: { autorizado: false } })).result.content[0].text);
  ok(/^DENEGADO/.test(permisoNo.permiso_cendoj) && /NO abras/.test(permisoNo.instruccion), 'la respuesta negativa prohíbe abrir el CENDOJ');
  await pedir('tools/call', { name: 'cendoj_pedir_permiso', arguments: { motivo: 'otra consulta más' } });
  const permisoVacio = JSON.parse((await pedir('tools/call', { name: 'cendoj_permiso_respuesta', arguments: {} })).result.content[0].text);
  ok(/^DENEGADO/.test(permisoVacio.permiso_cendoj), 'sin respuesta explícita se trata como denegado, nunca como autorizado');
  // B9 (revisión 21/09/2026): antes, el propio modelo podía llamar
  // cendoj_permiso_respuesta DIRECTAMENTE (sin que nadie hubiese llamado
  // nunca a cendoj_pedir_permiso) y obtenía igualmente "AUTORIZADO".
  const permisoSuelto = JSON.parse((await pedir('tools/call', { name: 'cendoj_permiso_respuesta', arguments: { autorizado: true } })).result.content[0].text);
  ok(/^RECHAZADO/.test(permisoSuelto.permiso_cendoj), 'B9: una respuesta sin haber pedido permiso antes NO se acepta como autorización');
  const ambitoCendoj = JSON.parse((await pedir('tools/call', { name: 'boe_ambito_seleccionado', arguments: { cendoj: true } })).result.content[0].text);
  ok(ambitoCendoj.ambito_elegido_por_el_usuario.some((s) => s.includes('cendoj_pedir_permiso')), 'elegir CENDOJ en el formulario de ámbito remite a pedir el permiso');

  console.log('\n4) Llamada real a la API del BOE');
  const call = await pedir('tools/call', { name: 'boe_ficha_norma', arguments: { id: 'BOE-A-1995-25444' } });
  const texto = call.result.content[0].text;
  const datos = JSON.parse(texto);
  if (call.result.isError) {
    console.log('  RED NO DISPONIBLE en este entorno ->', datos.error);
    ok(typeof datos.error === 'string', 'el fallo de red se devuelve como error controlado, no como caída');
  } else {
    console.log('  respuesta:', JSON.stringify(datos).slice(0, 200));
    ok(/penal/i.test(datos.titulo || ''), 'BOE-A-1995-25444 es el Código Penal');
    ok(datos.derogada === false, 'consta como no derogada');
  }

  console.log('\n5) Robustez');
  const malformado = await pedir('tools/call', { name: 'boe_texto_articulo', arguments: {} });
  ok(!!malformado.result, 'argumentos incompletos no tumban el servidor');
  const inexistente = await pedir('tools/call', { name: 'no_existe', arguments: {} });
  ok(inexistente.result.isError === true, 'herramienta inexistente devuelve isError');
  srv.stdin.write('esto no es json\n');
  ok((await pedir('ping', {})).result !== undefined, 'sigue vivo tras recibir basura por stdin');

  srv.kill();

  console.log('\n6) Cliente sin MCP Apps (1.6.1: el modelo no puede autorizarse solo el CENDOJ)');
  await clienteSinApps();

  console.log(fallos === 0 ? '\n=== TODO CORRECTO ===' : `\n=== ${fallos} FALLOS ===`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); srv.kill(); process.exit(1); });
