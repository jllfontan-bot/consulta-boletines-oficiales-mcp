const { spawn } = require('node:child_process');
// 1.7.2 (quinta y sexta prueba): recuadro fijo del lote de sentencias del CENDOJ, en dos variantes;
// tienen que llegar tal cual.
const RECUADRO_A = [
  '> **📄 Sentencias que propongo leer — te toca a ti**',
  '> 1. ROJ … · ECLI … — órgano — [enlace directo](dirección openDocument del CENDOJ)',
  '> 2. …',
  '>',
  '> **Qué hacer:**',
  '> 1. Abre cada enlace.',
  '> 2. Pulsa el icono de descarga (arriba a la derecha del visor); se guarda en Descargas.',
  '> 3. Cuando estén todas, escríbeme «ya están».',
  '>',
  '> **Puedes responderme:** «ya están» → las leo · «quita la 2» / «añade X» → cambio el lote · «no» → no leo ninguna.',
].join('\n');
const RECUADRO_B = [
  '> **📄 Sentencias que propongo leer — te toca a ti**',
  '> ⚠️ **Descargas no está conectada a este chat** (si lo prefieres, adjúntame los PDF en la conversación).',
  '> 1. ROJ … · ECLI … — órgano — [enlace directo](dirección openDocument del CENDOJ)',
  '> 2. …',
  '>',
  '> **Qué hacer:**',
  '> 0. Añade la carpeta Descargas a este chat: botón «+» de la caja de mensaje → «Añadir carpeta» → Descargas.',
  '> 1. Abre cada enlace.',
  '> 2. Pulsa el icono de descarga (arriba a la derecha del visor); se guarda en Descargas.',
  '> 3. Cuando estén todas, escríbeme «ya están».',
  '>',
  '> **Puedes responderme:** «ya están» → las leo · «quita la 2» / «añade X» → cambio el lote · «no» → no leo ninguna.',
].join('\n');
const DOS_VARIANTES = (x) => x.includes('VARIANTE A — Descargas conectada (sin paso 0):\n' + RECUADRO_A) && x.includes('VARIANTE B — Descargas NO conectada, o no puedes comprobarlo (aviso al empezar y paso 0):\n' + RECUADRO_B) && /comprueba si la carpeta Descargas está entre las carpetas conectadas a este chat y usa SOLO la variante que toque/.test(x) && /nunca copies la condición/.test(x) && !/\(solo si/.test(x);
const path = require('node:path');

const srv = spawn('node', [path.join(__dirname, '..', 'server', 'index.js')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, BOE_CONSOLIDADA_SIN_AVISO_ACTUALIZACION: '1' } });
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
  const otro = spawn('node', [path.join(__dirname, '..', 'server', 'index.js')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, BOE_CONSOLIDADA_SIN_AVISO_ACTUALIZACION: '1' } });
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
    ok(nombres.length === 22, `lista 22 herramientas, sin las dos internas (${nombres.length})`);
    ok(!nombres.includes('cendoj_permiso_respuesta') && !nombres.includes('boe_ambito_seleccionado'), 'no lista cendoj_permiso_respuesta ni boe_ambito_seleccionado');
    ok(nombres.includes('cendoj_pedir_permiso') && nombres.includes('boe_elegir_ambito'), 'sí lista cendoj_pedir_permiso y boe_elegir_ambito (con su texto alternativo)');
    const pedido = await llamar('cendoj_pedir_permiso', { motivo: 'comprobar una sentencia' });
    ok(pedido.ventana_ofrecida === null && /no admite ventanas/.test(pedido.instruccion) && /Responde sí o no/.test(pedido.instruccion), 'cendoj_pedir_permiso no dice que haya ventana y manda preguntar por texto');
    const autoSi = await llamar('cendoj_permiso_respuesta', { autorizado: true });
    ok(/^RECHAZADO/.test(autoSi.permiso_cendoj), 'aunque se haya pedido permiso, una llamada directa con autorizado: true se RECHAZA');
    ok(/resto de esta conversación/.test(pedido.instruccion) && /Reglamento 3\/2010/.test(pedido.instruccion), '1.7.2: sin ventana, un «sí» por texto vale para la conversación y se repiten los límites');
    ok(/a un LOTE de unas pocas/.test(pedido.instruccion) && /ENLACE DIRECTO/.test(pedido.instruccion) && /borrarlos es cosa suya/.test(pedido.instruccion), '4b: sin ventana, también se explica la descarga del PDF por lote');
    const otraVez = await llamar('cendoj_pedir_permiso', { motivo: 'otra' });
    ok(!/^YA AUTORIZADO/.test(String(otraVez.permiso_cendoj)), '1.7.2: sin ventana el servidor nunca se da por autorizado');
    const ambito = await llamar('boe_ambito_seleccionado', { boe: true, cendoj: true });
    ok(/^RECHAZADO/.test(ambito.ambito_elegido_por_el_usuario), 'boe_ambito_seleccionado también se rechaza');
    const elegir = await llamar('boe_elegir_ambito', {});
    ok(elegir.formulario_ofrecido === null && /NO se ha mostrado ninguno/.test(elegir.pregunta_por_texto) && /¿Dónde quieres que busque\?/.test(elegir.pregunta_por_texto), 'boe_elegir_ambito no dice que haya formulario y trae la pregunta en texto');
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
  ok(/no vuelvas a pedirla en cada consulta/.test(init.result.instructions) && /que siguen aunque no vuelvas a pedir permiso/.test(init.result.instructions) && /barridos/.test(init.result.instructions), '1.7.2: las instrucciones dicen que el permiso no se repite en cada consulta y mantienen los límites');
  ok(/«sí» expreso del usuario a un LOTE de unas pocas, sin barridos/.test(init.result.instructions) && /cita solo lo leído/.test(init.result.instructions) && /no las conserves ni redistribuyas/.test(init.result.instructions) && !/guardar o redistribuir/.test(init.result.instructions), '4b: las instrucciones permiten leer el PDF de sentencias concretas con un «sí» al lote, sin conservarlas');
  ok(/NO intentes descargar tú el PDF/.test(init.result.instructions) && /enlace directo openDocument/.test(init.result.instructions) && /sin ese enlace, no la propongas/.test(init.result.instructions) && /nunca presentes indexAN\.jsp como enlace a una sentencia/.test(init.result.instructions) && /borrarlas es cosa del usuario/.test(init.result.instructions), '5a-ajuste 2: por defecto descarga el usuario; enlace directo obligatorio, nunca indexAN.jsp como enlace; borrar es cosa del usuario');
  ok(DOS_VARIANTES(init.result.instructions) && /Su «ya están» es el «sí» al lote/.test(init.result.instructions) && /NO pidas acceso a carpetas a mitad del chat/.test(init.result.instructions) && /que adjunte el PDF/.test(init.result.instructions), '5a-ajuste 5: las instrucciones traen el recuadro fijo del lote y no piden acceso a carpetas a mitad del chat');
  ok(/REGLA WEB: ante CUALQUIER petición de jurisprudencia/.test(init.result.instructions) && /lo PRIMERO es el ámbito \(boe_elegir_ambito\)/.test(init.result.instructions) && /PROHIBIDO buscar en la web general, abrir noticias, blogs o resúmenes/.test(init.result.instructions) && /ni como «adelanto» ni con el aviso de «sin verificar»/.test(init.result.instructions), '5a-ajuste 5: regla web endurecida: ámbito y permiso primero, nada de web, prensa ni adelantos sin verificar');
  ok(/descargas masivas o en bloque/.test(init.result.instructions) && /recorrer listados completos/.test(init.result.instructions) && /uso comercial/.test(init.result.instructions) && /barridos/.test(init.result.instructions), '4b: siguen prohibidos las descargas en bloque, los listados completos, los barridos y el uso comercial');
  ok(/si ya ha escrito en esta conversación un «autorizo» explícito para el CENDOJ, basta/.test(init.result.instructions), '4b: un «autorizo» explícito ya escrito por el usuario basta para consultar el CENDOJ');
  ok(/puede no verse: pregunta SIEMPRE también por texto/.test(init.result.instructions), '5a: las instrucciones avisan de que la ventana puede no verse y mandan preguntar por texto');
  ok(/REGLA Nº 1/.test(init.result.instructions) && /NO nombres ninguna/.test(init.result.instructions), '4b: se mantiene la regla de no nombrar sentencias sin verificarlas en el CENDOJ');
  ok(/NUNCA la búsqueda web general/.test(init.result.instructions), 'las instrucciones del servidor excluyen la búsqueda web general como "navegador" para el CENDOJ');
  ok(/REGLA Nº 2/.test(init.result.instructions) && /aunque me suene/.test(init.result.instructions), '1.5.11: regla nº 2 (Claude en Chrome solo de pago, dicho siempre) y prohibido "aunque me suene" al negarse');
  ok(/MIENTRAS ESPERAS/.test(init.result.instructions) && /NUNCA index\.jsp/.test(init.result.instructions) && /planes de pago/.test(init.result.instructions) && /plan gratuito/.test(init.result.instructions), '1.5.11: no describir la sentencia mientras se espera el permiso; siempre indexAN.jsp; Claude en Chrome solo en planes de pago (plan gratuito -> consulta manual)');
  ok(/COMUNIDADES AUTÓNOMAS/.test(init.result.instructions) && /web de la Consejería competente/.test(init.result.instructions) && /boletín oficial de esa comunidad/.test(init.result.instructions), '1.7.2: las instructions piden Consejería primero y verificar en el boletín oficial de la comunidad');
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
  ok(nombres.length === 24, `expone 24 herramientas (${nombres.length})`);
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
  ok(!elegir.result.isError && JSON.parse(elegir.result.content[0].text).pregunta_por_texto, 'boe_elegir_ambito trae el texto alternativo para clientes sin formularios');
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
  // 1.7.0 (prueba real del 03/11/2026): el formulario no ofrecía la UE y Claude, mientras
  // esperaba, adelantó reglamentos de memoria.
  ok(html.includes('name="ue"') && /ue: ue/.test(html), '1.7.0: el formulario ofrece «Unión Europea» y la envía');
  const seleccionUE = JSON.parse((await pedir('tools/call', { name: 'boe_ambito_seleccionado', arguments: { ue: true } })).result.content[0].text);
  ok(seleccionUE.ambito_elegido_por_el_usuario.some((s) => /Unión Europea/.test(s) && /ue_\*/.test(s)), '1.7.0: la UE elegida se traduce a las herramientas ue_*');
  const textoAlt = JSON.parse(elegir.result.content[0].text).pregunta_por_texto;
  const descElegir = tl.result.tools.find((t) => t.name === 'boe_elegir_ambito').description;
  const resElegir = JSON.parse(elegir.result.content[0].text);
  ok(/puede que tu cliente no lo muestre/.test(resElegir.formulario_ofrecido) && !('formulario_mostrado' in resElegir), '5a: boe_elegir_ambito dice que el formulario se ofrece, no que se haya mostrado');
  ok(!/Se ha mostrado/.test(textoAlt) && /puede que su cliente no lo muestre/.test(textoAlt) && /Pregunta SIEMPRE también por texto/.test(textoAlt) && /¿Dónde quieres que busque\?/.test(textoAlt) && /espera la respuesta/.test(textoAlt), '5a: el texto del ámbito manda preguntar SIEMPRE también por texto y esperar');
  ok(/puede que el cliente no lo muestre/.test(descElegir) && /SIEMPRE también la pregunta en texto/.test(descElegir) && !/se muestra un formulario real/.test(descElegir), '5a: la descripción de boe_elegir_ambito no promete que el formulario se vea');
  ok(/Unión Europea/.test(textoAlt) && /Unión Europea/.test(descElegir), '1.7.0: el texto alternativo y la descripción mencionan la UE');
  ok([textoAlt, descElegir, init.result.instructions].every((t) => /punto de partida probable/.test(t)), '1.7.0: mientras espera el ámbito, no nombra normas (texto alternativo, descripción e instrucciones)');

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
  const llamarSrv = async (name, args) => JSON.parse((await pedir('tools/call', { name, arguments: args })).result.content[0].text);
  const descPermiso = herrPermiso.description;
  ok(/hasta que el usuario cierre Claude Desktop/.test(descPermiso) && /no vuelvas a llamar a esta herramienta/.test(descPermiso) && !/solo para la tarea/.test(descPermiso) && !/por poco que/.test(descPermiso), '1.7.2: la descripción de cendoj_pedir_permiso dice que el permiso dura hasta cerrar Claude Desktop y que no se vuelve a pedir');
  ok(/Reglamento 3\/2010/.test(descPermiso) && /pausa/.test(descPermiso) && /recorrer listados completos/.test(descPermiso) && /barridos/.test(descPermiso) && /indexAN\.jsp/.test(descPermiso), '1.7.2: la descripción mantiene los límites legales y aclara que «al detalle» no es hacer barridos');
  ok(/«sí» del usuario a un lote de unas pocas/.test(descPermiso) && /NO intentas descargar tú el PDF salvo que él te lo pida/.test(descPermiso) && /nunca construido ni de memoria; sin él, no la propongas/.test(descPermiso) && /recuadro fijo «📄 Sentencias que propongo leer — te toca a ti»/.test(descPermiso) && /arriba a la derecha del visor/.test(descPermiso) && /No pidas acceso a carpetas a mitad del chat/.test(descPermiso) && /Nunca presentes indexAN\.jsp como enlace/.test(descPermiso) && /borrarlas es cosa del usuario/.test(descPermiso), '4b/5a-ajuste 5: la descripción pide el recuadro fijo con enlaces directos, que descargue el usuario y nunca indexAN.jsp como enlace');
  ok(/salvo que el usuario ya haya escrito en esta conversación un «autorizo» explícito/.test(descPermiso), '4b: la descripción acepta un «autorizo» explícito ya escrito sin esperar la ventana');
  ok(/te pedirá permiso/.test(htmlCendoj) && /descargar el PDF/.test(htmlCendoj), '4b: la ventana avisa de que se pedirá permiso antes de descargar un PDF');
  ok(htmlCendoj.includes('ui/notifications/tool-result') && htmlCendoj.includes('YA AUTORIZADO') && /hasta que cierres Claude Desktop/.test(htmlCendoj) && !/solo para esta tarea/.test(htmlCendoj), '1.7.2: la ventana dice que vale hasta cerrar Claude Desktop y no pide nada si ya estaba autorizado');
  // Primero, sin autorizar: denegaciones y respuestas que no son `true`.
  const pedirPermiso = await pedir('tools/call', { name: 'cendoj_pedir_permiso', arguments: { motivo: 'comprobar la STS 623/2010' } });
  const datosPedir = JSON.parse(pedirPermiso.result.content[0].text);
  ok(!pedirPermiso.result.isError && /ESPERA/.test(datosPedir.instruccion) && /NO son autorización/.test(datosPedir.instruccion) && datosPedir.motivo === 'comprobar la STS 623/2010', 'cendoj_pedir_permiso ordena esperar la autorización explícita y trae la pregunta en texto');
  ok(/hasta que el usuario cierre Claude Desktop/.test(datosPedir.instruccion) && /Reglamento 3\/2010/.test(datosPedir.instruccion), '1.7.2: la petición avisa de que el permiso dura hasta cerrar Claude Desktop y repite los límites');
  ok(/YA había escrito en esta conversación un «autorizo» explícito/.test(datosPedir.instruccion) && /no esperes la ventana/.test(datosPedir.instruccion) && /a un LOTE de unas pocas/.test(datosPedir.instruccion), '4b: la petición acepta un «autorizo» ya escrito y explica la descarga del PDF por lote');
  ok(/puede que tu cliente no la muestre/.test(datosPedir.ventana_ofrecida) && !('ventana_mostrada' in datosPedir) && !/Se ha mostrado/.test(datosPedir.instruccion) && /pregúntale SIEMPRE también por texto/.test(datosPedir.instruccion) && /Responde sí o no/.test(datosPedir.instruccion), '5a: la ventana del CENDOJ se ofrece (puede no verse) y siempre se pregunta también por texto');
  ok(/puede que su cliente no la muestre/.test(descPermiso) && /pregúntale SIEMPRE también por texto/.test(descPermiso) && !/muestra al usuario una ventana/.test(descPermiso), '5a: la descripción de cendoj_pedir_permiso no promete que la ventana se vea');
  const permisoNo = await llamarSrv('cendoj_permiso_respuesta', { autorizado: false });
  ok(/^DENEGADO/.test(permisoNo.permiso_cendoj) && /NO abras/.test(permisoNo.instruccion), 'la respuesta negativa prohíbe abrir el CENDOJ');
  const trasNo = await llamarSrv('cendoj_pedir_permiso', { motivo: 'otra consulta' });
  ok(!/^YA AUTORIZADO/.test(String(trasNo.permiso_cendoj)) && /ESPERA/.test(trasNo.instruccion), '1.7.2: una denegación no deja autorizado: se vuelve a pedir');
  const permisoVacio = await llamarSrv('cendoj_permiso_respuesta', {});
  ok(/^DENEGADO/.test(permisoVacio.permiso_cendoj), 'sin respuesta explícita se trata como denegado, nunca como autorizado');
  for (const valor of ['true', 1, 'sí', {}]) {
    await llamarSrv('cendoj_pedir_permiso', { motivo: 'prueba' });
    const r = await llamarSrv('cendoj_permiso_respuesta', { autorizado: valor });
    const despues = await llamarSrv('cendoj_pedir_permiso', { motivo: 'prueba' });
    await llamarSrv('cendoj_permiso_respuesta', { autorizado: false });
    ok(/^DENEGADO/.test(r.permiso_cendoj) && !/^YA AUTORIZADO/.test(String(despues.permiso_cendoj)), `1.7.2: autorizado = ${JSON.stringify(valor)} (no es true) no activa el permiso`);
  }
  // B9 (revisión 21/09/2026): antes, el propio modelo podía llamar
  // cendoj_permiso_respuesta DIRECTAMENTE (sin que nadie hubiese llamado
  // nunca a cendoj_pedir_permiso) y obtenía igualmente "AUTORIZADO".
  const permisoSuelto = await llamarSrv('cendoj_permiso_respuesta', { autorizado: true });
  ok(/^RECHAZADO/.test(permisoSuelto.permiso_cendoj), 'B9: una respuesta sin haber pedido permiso antes NO se acepta como autorización');
  const trasSuelto = await llamarSrv('cendoj_pedir_permiso', { motivo: 'comprobar' });
  ok(!/^YA AUTORIZADO/.test(String(trasSuelto.permiso_cendoj)), 'B9: la llamada suelta rechazada tampoco deja el permiso activado');
  // Ahora sí: autorización real (hay una petición pendiente de la llamada anterior).
  const permisoSi = await llamarSrv('cendoj_permiso_respuesta', { autorizado: true });
  ok(/^AUTORIZADO/.test(permisoSi.permiso_cendoj) && /indexAN\.jsp/.test(permisoSi.instruccion) && /hasta que cierre Claude Desktop/.test(permisoSi.permiso_cendoj), '1.7.2: la respuesta afirmativa habilita indexAN.jsp hasta cerrar Claude Desktop');
  ok(/Claude en Chrome/.test(permisoSi.instruccion) && /la consulta la realizas tú/.test(permisoSi.instruccion), '1.5.8: la autorización indica que la consulta la hace Claude y qué necesita sin navegador');
  ok(/no vuelvas a llamar a cendoj_pedir_permiso/.test(permisoSi.instruccion) && /Reglamento 3\/2010/.test(permisoSi.instruccion) && /pausa/.test(permisoSi.instruccion) && /descargas masivas/.test(permisoSi.instruccion) && /barridos/.test(permisoSi.instruccion) && /index\.jsp/.test(permisoSi.instruccion) && !/otra tarea/.test(permisoSi.instruccion), '1.7.2: la autorización dice que no se vuelva a pedir y mantiene los límites legales');
  ok(/a un LOTE de unas pocas/.test(permisoSi.instruccion) && /el permiso de consulta no basta para leerlas/.test(permisoSi.instruccion) && /no las conserves ni redistribuyas/.test(permisoSi.instruccion) && /que te adjunte el PDF en la conversación/.test(permisoSi.instruccion) && /nunca resumas una sentencia que no hayas podido leer/i.test(permisoSi.instruccion), '4b: la autorización explica la lectura del PDF por lote, sin conservarlo, y la vía de adjuntarlo');
  ok(/abre cada resultado candidato en el propio CENDOJ y toma su ENLACE DIRECTO/.test(permisoSi.instruccion) && /openDocument/.test(permisoSi.instruccion) && /no propongas para lectura ninguna sentencia de la que no tengas ya ese enlace/.test(permisoSi.instruccion) && /nunca lo construyas ni lo des de memoria/.test(permisoSi.instruccion), '5a-ajuste 2: antes del lote abre cada resultado y toma su enlace directo; sin él, no la propone');
  ok(/NO intentes descargar tú el PDF/.test(permisoSi.instruccion) && /solo puedes intentarlo si el usuario te lo pide expresamente/.test(permisoSi.instruccion) && DOS_VARIANTES(permisoSi.instruccion) && /varias sentencias = varias líneas numeradas en el MISMO recuadro/.test(permisoSi.instruccion), '5a-ajuste 5: el lote va SIEMPRE en el recuadro fijo, varias sentencias en el mismo, paso 0 solo sin Descargas conectada');
  ok(/NUNCA presentes como enlace a una sentencia el del buscador/.test(permisoSi.instruccion) && /no pongas enlace/.test(permisoSi.instruccion) && /No prometas que el enlace directo sea permanente/.test(permisoSi.instruccion) && /por su ECLI en https:\/\/www\.poderjudicial\.es\/search\/indexAN\.jsp/.test(permisoSi.instruccion) && /borrarlos es cosa suya/.test(permisoSi.instruccion) && !/bórralas/.test(permisoSi.instruccion), '5a-ajuste 2: nunca indexAN.jsp como enlace a una sentencia, enlace no permanente (buscar por ECLI) y borrar es cosa del usuario');
  ok(/El «ya están» \(o «ya la descargué, léela»\) del usuario es su «sí» expreso al lote/.test(permisoSi.instruccion) && /NO pidas acceso a carpetas a mitad del chat/.test(permisoSi.instruccion) && /Nunca intentes leer una carpeta que no esté conectada/.test(permisoSi.instruccion) && /lee solo las del lote/.test(permisoSi.instruccion) && /Otra sentencia fuera del lote = otro recuadro/.test(permisoSi.instruccion), '5a-ajuste 5: «ya están» es el «sí» al lote; nada de pedir acceso a mitad del chat; solo las del lote');
  ok(/No digas que abrir un enlace da acceso a la carpeta, ni prometas que el acceso se conserve/.test(permisoSi.instruccion) && !/le pedirás acceso|te pido el acceso|PIDE el acceso|saldrá un cuadro/.test(permisoSi.instruccion) && !/le pedirás acceso|te pido el acceso|saldrá un cuadro/.test(init.result.instructions) && !/saldrá un cuadro/.test(descPermiso), '5a-ajuste 5: no queda ninguna frase de «te pido el acceso» ni del cuadro de acceso, y no promete que el acceso se conserve');
  ok(/Abre cada enlace/.test(permisoSi.instruccion) && /Cmd\+Shift\+B/.test(permisoSi.instruccion + init.result.instructions + descPermiso) === false, '5a-ajuste 5: el recuadro trae los pasos y no se propaga el atajo Cmd+Shift+B (no comprobado)');
  ok(/si lo está, sin paso 0/.test(descPermiso) && /empieza diciendo «Descargas no está conectada a este chat»/.test(descPermiso) && /nunca la condición copiada/.test(descPermiso) && !/0, solo si/.test(descPermiso), 'fase 4 cerrada: la descripción pide comprobar Descargas y usar solo el caso que toca');
  ok(/no digas «ya las revisé»/.test(permisoSi.instruccion) && /qué has leído entero de verdad y qué solo ves reproducido en otra resolución/.test(init.result.instructions), 'fase 4 cerrada: distingue lo leído de verdad de lo que solo ve reproducido en otra resolución');
  ok(/ALCANCE: ante «la última jurisprudencia sobre X» que el usuario no restringe al TC, no barras por tu cuenta el BOE ni el TC desde años atrás/.test(init.result.instructions) && /consulta el TC solo si el usuario lo pide o el ámbito elegido lo incluye/.test(init.result.instructions), 'fase 4 cerrada: no barre el BOE/TC por su cuenta ante «la última jurisprudencia»');
  const segunda = await llamarSrv('cendoj_pedir_permiso', { motivo: 'otra sentencia' });
  ok(/^YA AUTORIZADO/.test(segunda.permiso_cendoj) && segunda.ventana_ofrecida === null && /NO le vuelvas a pedir permiso/.test(segunda.instruccion) && !/Responde sí o no/.test(segunda.instruccion), '1.7.2: con el permiso concedido, cendoj_pedir_permiso no vuelve a preguntar');
  ok(/Reglamento 3\/2010/.test(segunda.instruccion) && /recorrer listados completos/.test(segunda.instruccion) && /web_search/.test(segunda.instruccion), '1.7.2: aun ya autorizado, recuerda los límites legales y que la búsqueda web no vale');
  ok(/a un LOTE de unas pocas/.test(segunda.instruccion) && /Otra sentencia fuera del lote/.test(segunda.instruccion) && /no la nombres ni afirmes nada de ella/.test(segunda.instruccion), '4b: ya autorizado, la descarga del PDF sigue necesitando un «sí» por lote y se mantiene no nombrar sentencias sin verificar');
  const sueltoAutorizado = await llamarSrv('cendoj_permiso_respuesta', { autorizado: true });
  ok(/^RECHAZADO/.test(sueltoAutorizado.permiso_cendoj), 'B9: ya autorizado, una llamada suelta sigue sin petición pendiente y se RECHAZA');
  const tercera = await llamarSrv('cendoj_pedir_permiso', {});
  ok(/^YA AUTORIZADO/.test(tercera.permiso_cendoj), '1.7.2: el permiso persiste mientras el proceso del servidor siga vivo');
  const retirado = await llamarSrv('cendoj_permiso_respuesta', { autorizado: false });
  const trasRetirar = await llamarSrv('cendoj_pedir_permiso', { motivo: 'después de retirar' });
  ok(/^RETIRADO/.test(retirado.permiso_cendoj) && /NO vuelvas a abrir/.test(retirado.instruccion) && !/^YA AUTORIZADO/.test(String(trasRetirar.permiso_cendoj)) && /ESPERA/.test(trasRetirar.instruccion), '1.7.2: «No autorizar» en la ventana retira el permiso y se vuelve a pedir');
  await llamarSrv('cendoj_permiso_respuesta', { autorizado: false });
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
