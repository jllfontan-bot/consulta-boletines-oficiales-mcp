#!/usr/bin/env node
/**
 * boe-consolidada — Transporte MCP (stdio) para legislación española consolidada.
 *
 * Fuente principal: https://www.boe.es/datosabiertos/api/legislacion-consolidada
 * (estatal y, en la medida en que el BOE la recoge, autonómica).
 *
 * Fuentes autonómicas propias, añadidas solo cuando la comunidad ofrece una
 * API real con licencia de reutilización explícita (mismo listón que el BOE):
 *   - País Vasco: https://api.euskadi.eus/bopv (Open Data Euskadi, CC BY 4.0).
 * El resto de comunidades no tienen API consultable, solo portal web — ver
 * docs/estudio-legislacion-autonomica.md. No añadir ninguna sin repetir esta
 * comprobación (API real + licencia), ni por scraping HTML.
 *
 * Solo estas URLs fijas. Ninguna se construye a partir de entrada del usuario.
 * Sin dependencias externas. Toda la lógica de negocio vive en ./nucleo.js.
 *
 * Fase 1: buscar normas, ficha, índice, texto de artículo, análisis.
 * Fase 2: resolver referencias ("art. 56 ET") y verificar citas de un escrito.
 * Fase 3: normativa del País Vasco vía Open Data Euskadi.
 * Fase 4 (1.6.0): BORME (actos y anuncios del Registro Mercantil, mismo host www.boe.es).
 * Fase 5 (1.7.0): normativa de la UE vía CELLAR (publications.europa.eu), en castellano o
 * inglés — ver docs/estudio-normativa-europea.md.
 */

'use strict';

const N = require('./nucleo.js');
const {
  log, norm, hoyISO, ATAJOS, AVISO, AVISO_EUSKADI, AVISO_TC, AVISO_BORME, FUENTE_BORME, TIPO_BORME, AVISO_UE, FUENTE_UE,
  buscarNormasUE, fichaNormaUE, textoArticuloUE, verificarCitaUE,
  analisisNorma, buscarBorme, buscarNormas, buscarNormativaEuskadi, buscarSentenciasTC, estadoBaseNorma,
  fichaNorma, indiceNorma, localizarBloque, resolverNorma, textoBloque, textoBorme, textoNormativaEuskadi, textoSentenciaTC,
  verificarCitaEuskadi, verificarCitaMultifuente, verificarEscrito,
} = N;

const PROTOCOL_FALLBACK = '2025-06-18';

/* ------------------------------------------------------------------ */
/* Formulario de ámbito de búsqueda (MCP Apps, io.modelcontextprotocol/ui) */
/*                                                                      */
/* Experimental: en clientes que soportan la extensión MCP Apps (SEP-1865,     */
/* Claude Desktop la declara), boe_elegir_ambito muestra un formulario real    */
/* con checkboxes en vez de una pregunta en texto. En clientes que no la       */
/* soportan, el propio resultado de la herramienta lleva la pregunta en texto */
/* como alternativa — se degrada sin romperse. El formulario llama de vuelta  */
/* a boe_ambito_seleccionado (oculta al modelo, visibility:["app"]) para      */
/* devolver la elección a la conversación.                                    */
/* ------------------------------------------------------------------ */

const RESOURCE_AMBITO_URI = 'ui://boe-consolidada/ambito.html';

const NOMBRES_COMUNIDADES = {
  andalucia: 'Andalucía', aragon: 'Aragón', asturias: 'Asturias', baleares: 'Baleares',
  canarias: 'Canarias', cantabria: 'Cantabria', castilla_la_mancha: 'Castilla-La Mancha',
  castilla_y_leon: 'Castilla y León', cataluna: 'Cataluña', comunidad_valenciana: 'C. Valenciana',
  extremadura: 'Extremadura', galicia: 'Galicia', la_rioja: 'La Rioja', madrid: 'Madrid',
  murcia: 'Murcia', navarra: 'Navarra', pais_vasco: 'País Vasco',
};

const HTML_AMBITO = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  body { font-family: var(--font-sans, -apple-system, sans-serif); color: var(--color-text-primary, #1a1a1a); background: var(--color-background-primary, #fff); margin: 0; padding: 16px; font-size: 14px; }
  h2 { font-size: 15px; margin: 0 0 12px; }
  fieldset { border: 1px solid var(--color-border-primary, #ddd); border-radius: 8px; padding: 10px 12px; margin: 0 0 12px; }
  legend { padding: 0 4px; font-weight: 600; }
  label { display: flex; align-items: center; gap: 6px; padding: 3px 0; cursor: pointer; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; }
  button { background: #d97757; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  #estado { margin-top: 10px; font-size: 13px; color: var(--color-text-secondary, #666); }
</style>
</head>
<body>
  <h2>¿Dónde busco?</h2>
  <fieldset>
    <legend>Fuentes</legend>
    <label><input type="checkbox" name="boe" checked> BOE (legislación estatal y autonómica)</label>
    <label><input type="checkbox" name="tc"> Tribunal Constitucional (sentencias)</label>
    <label><input type="checkbox" name="ue"> Unión Europea (reglamentos, directivas y decisiones, vía EUR-Lex)</label>
    <label><input type="checkbox" name="cendoj"> Resto de jurisprudencia (CENDOJ — solo si lo autorizas en una ventana aparte)</label>
  </fieldset>
  <fieldset>
    <legend>Comunidad autónoma (opcional, una o varias)</legend>
    <div class="grid" id="ccaa"></div>
  </fieldset>
  <button id="enviar" type="button">Buscar con esta selección</button>
  <div id="estado"></div>

<script>
  var COMUNIDADES = ${JSON.stringify(NOMBRES_COMUNIDADES)};
  var cont = document.getElementById('ccaa');
  Object.keys(COMUNIDADES).forEach(function (slug) {
    var label = document.createElement('label');
    label.innerHTML = '<input type="checkbox" name="ccaa" value="' + slug + '"> ' + COMUNIDADES[slug];
    cont.appendChild(label);
  });

  var nextId = 1;
  var pendientes = {};
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (data && data.id != null && pendientes[data.id]) {
      pendientes[data.id](data);
      delete pendientes[data.id];
    }
  });
  function enviarPeticion(method, params) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pendientes[id] = function (data) { if (data.error) reject(data.error); else resolve(data.result); };
      window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params }, '*');
    });
  }

  enviarPeticion('ui/initialize', {
    clientInfo: { name: 'boe-consolidada-ambito', version: '1.0' },
    protocolVersion: '2025-06-18',
    capabilities: {},
  }).catch(function () {});

  document.getElementById('enviar').addEventListener('click', function () {
    var boton = document.getElementById('enviar');
    var estado = document.getElementById('estado');
    boton.disabled = true;
    estado.textContent = 'Enviando...';
    var boe = document.querySelector('input[name="boe"]').checked;
    var tc = document.querySelector('input[name="tc"]').checked;
    var ue = document.querySelector('input[name="ue"]').checked;
    var cendoj = document.querySelector('input[name="cendoj"]').checked;
    var comunidades = Array.prototype.map.call(
      document.querySelectorAll('input[name="ccaa"]:checked'),
      function (el) { return el.value; }
    );
    enviarPeticion('tools/call', {
      name: 'boe_ambito_seleccionado',
      arguments: { boe: boe, tc: tc, ue: ue, cendoj: cendoj, comunidades: comunidades },
    }).then(function () {
      estado.textContent = 'Selección enviada. Sigue la conversación con Claude.';
    }).catch(function () {
      estado.textContent = 'No se pudo enviar. Dile a Claude tu elección por texto.';
      boton.disabled = false;
    });
  });
</script>
</body>
</html>`;

// Prueba real del 03/11/2026 (1.7.0): mientras esperaba el ámbito, Claude adelantó de memoria
// «un punto de partida probable» (dos reglamentos de la UE). Acertó, pero es citar sin verificar.
const REGLA_ESPERA_AMBITO =
  'Mientras esperas la respuesta, no nombres ninguna norma, acto de la UE ni sentencia concretos (ni como ejemplo, ni como «punto de partida probable», ni para anticipar qué vas a buscar): limítate a pedir el ámbito.';

function textoAmbitoFallback() {
  return (
    'Se ha mostrado al usuario un formulario para elegir el ámbito de búsqueda ' +
    '(BOE, Tribunal Constitucional, Unión Europea, CENDOJ, comunidad autónoma). Si tu ' +
    'cliente no admite formularios interactivos y no ves confirmación de una selección, ' +
    'pregunta tú mismo, textualmente: "¿Dónde quieres que busque? BOE (legislación ' +
    'estatal y autonómica), normativa de la Unión Europea, también jurisprudencia del ' +
    'Tribunal Constitucional o del resto de tribunales (CENDOJ), y/o normativa propia de ' +
    'alguna comunidad autónoma en concreto — dime cuál(es)." y espera la respuesta antes ' +
    'de buscar nada. ' + REGLA_ESPERA_AMBITO
  );
}

/* ------------------------------------------------------------------ */
/* Ventana de permiso para consultar el CENDOJ (MCP Apps)               */
/*                                                                      */
/* El conector NUNCA accede al CENDOJ por sí mismo (Reglamento 3/2010   */
/* del CGPJ). Cuando Claude quiere consultarlo con su navegador, antes  */
/* debe llamar a cendoj_pedir_permiso: muestra esta ventana con dos      */
/* botones. La respuesta vuelve por dos vías, para no depender de una:  */
/* (1) ui/message, que inserta la respuesta como mensaje del usuario en  */
/* la conversación, y (2) tools/call a cendoj_permiso_respuesta. Si el   */
/* cliente no admite ventanas, el resultado de la herramienta trae la    */
/* pregunta en texto. Ninguna vía sustituye a la respuesta explícita.    */
/* ------------------------------------------------------------------ */

const VERSION = '1.7.0'; // debe coincidir con manifest.json (lo comprueba test/protocolo.js)

const RESOURCE_CENDOJ_URI = 'ui://boe-consolidada/cendoj-permiso.html';

const HTML_CENDOJ = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  body { font-family: var(--font-sans, -apple-system, sans-serif); color: var(--color-text-primary, #1a1a1a); background: var(--color-background-primary, #fff); margin: 0; padding: 16px; font-size: 14px; line-height: 1.45; }
  h2 { font-size: 15px; margin: 0 0 10px; }
  p { margin: 0 0 10px; }
  .caja { border: 1px solid var(--color-border-primary, #ddd); border-radius: 8px; padding: 10px 12px; margin: 0 0 12px; }
  .peque { font-size: 12.5px; color: var(--color-text-secondary, #666); }
  #motivo { font-weight: 600; }
  .botones { display: flex; gap: 10px; flex-wrap: wrap; }
  button { border: none; border-radius: 6px; padding: 9px 16px; font-size: 14px; cursor: pointer; }
  #si { background: #d97757; color: #fff; }
  #no { background: transparent; color: inherit; border: 1px solid var(--color-border-primary, #bbb); }
  button:disabled { opacity: .5; cursor: default; }
  #estado { margin-top: 10px; font-size: 13px; color: var(--color-text-secondary, #666); }
</style>
</head>
<body>
  <h2>&#9888;&#65039; ¿Autorizas que Claude consulte el CENDOJ?</h2>
  <p>Claude quiere abrir el buscador de jurisprudencia del CENDOJ (poderjudicial.es) con su navegador y hacer la consulta en tu nombre, para tu uso particular.</p>
  <div class="caja" id="cajamotivo" style="display:none">Consulta prevista: <span id="motivo"></span></div>
  <p class="peque">Es una consulta particular y puntual, no una descarga sistemática ni una reutilización de la base de datos (Reglamento 3/2010 del CGPJ); Claude solo hará las consultas necesarias para lo que le pides. Este conector no accede al CENDOJ por sí mismo. La autorización vale solo para esta tarea de investigación; si después hace falta otra, te lo volverá a pedir.</p>
  <div class="botones">
    <button id="si" type="button">Autorizar la consulta al CENDOJ</button>
    <button id="no" type="button">No autorizar</button>
  </div>
  <div id="estado"></div>

<script>
  var nextId = 1;
  var pendientes = {};
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data) return;
    if (data.id != null && pendientes[data.id]) {
      pendientes[data.id](data);
      delete pendientes[data.id];
      return;
    }
    if (data.method === 'ui/notifications/tool-input' && data.params && data.params.arguments && data.params.arguments.motivo) {
      document.getElementById('motivo').textContent = String(data.params.arguments.motivo).slice(0, 400);
      document.getElementById('cajamotivo').style.display = 'block';
    }
  });
  function enviarPeticion(method, params) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pendientes[id] = function (data) { if (data.error) reject(data.error); else resolve(data.result); };
      window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params }, '*');
    });
  }

  // Saludo del borrador antiguo de MCP Apps, igual que en la 1.6.0: es con el que Claude Desktop
  // dibuja la ventana. Con appInfo/appCapabilities (versiones 2026-01-26 y 2025-11-21) dejó de
  // dibujarse en la prueba real del 25/10/2026. No cambiarlo sin probarlo en Claude Desktop.
  enviarPeticion('ui/initialize', {
    clientInfo: { name: 'boe-consolidada-cendoj', version: '1.0' },
    protocolVersion: '2025-06-18',
    capabilities: {},
  }).then(function () {
    window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
  }).catch(function () {});

  function responder(autorizado) {
    document.getElementById('si').disabled = true;
    document.getElementById('no').disabled = true;
    var estado = document.getElementById('estado');
    estado.textContent = 'Enviando...';
    var texto = autorizado
      ? 'Autorizo que consultes el CENDOJ con tu navegador para esta tarea.'
      : 'No autorizo la consulta al CENDOJ. No lo abras: dame el enlace y las instrucciones para hacerlo yo.';
    var registro = enviarPeticion('tools/call', { name: 'cendoj_permiso_respuesta', arguments: { autorizado: autorizado } })
      .catch(function () {});
    // 1.6.1: «content» como lista de bloques, igual que las ventanas de Claude Desktop; si el
    // cliente la rechaza, se repite con un solo bloque (borrador anterior).
    var mensaje = enviarPeticion('ui/message', { role: 'user', content: [{ type: 'text', text: texto }] })
      .catch(function () { return enviarPeticion('ui/message', { role: 'user', content: { type: 'text', text: texto } }); })
      .then(function () { return true; }, function () { return false; });
    Promise.all([registro, mensaje]).then(function (r) {
      estado.textContent = r[1]
        ? (autorizado ? 'Autorizado. Claude continúa.' : 'No autorizado. Claude no abrirá el CENDOJ.')
        : 'Respuesta registrada. Si Claude no continúa, escríbele "' + (autorizado ? 'autorizo' : 'no autorizo') + '" en el chat.';
    });
  }
  document.getElementById('si').addEventListener('click', function () { responder(true); });
  document.getElementById('no').addEventListener('click', function () { responder(false); });
</script>
</body>
</html>`;

function textoCendojPedirFallback(motivo, conVentana = true) {
  const que = motivo ? ` para: ${motivo}` : '';
  if (!conVentana) {
    // 1.6.1: cliente sin MCP Apps -- no hay ventana; el permiso se pide por texto.
    return (
      'Este cliente no admite ventanas: NO se ha mostrado ninguna al usuario. Pregúntale tú textualmente: ' +
      `"¿Autorizas que consulte el CENDOJ (poderjudicial.es) con mi navegador${que}? Responde sí o no." y espera su respuesta. ` +
      'Solo cuenta como autorización un "sí/autorizo" explícito del usuario escrito en la conversación; silencio, evasivas o "sigue" sin más NO son autorización. ' +
      'Si el usuario autoriza, la consulta la haces tú con tu navegador, en su nombre (esta extensión nunca accede al CENDOJ). Una autorización solo vale para una herramienta de navegación real; NUNCA la uses para buscar en la web general ni para afirmar jurisprudencia de terceros. ' +
      'Si no autoriza, o no tienes navegador, NO abras el CENDOJ ni lo sustituyas por una búsqueda web general: da el enlace y las instrucciones de rellenado de la sección ENLACES para que lo haga él.'
    );
  }
  return (
    'Se ha mostrado al usuario una ventana para autorizar o denegar que consultes el CENDOJ con tu navegador. ' +
    'ESPERA su respuesta antes de abrir poderjudicial.es: solo cuenta como autorización un "sí/autorizo" explícito del usuario (por la ventana, que llegará como mensaje suyo, o por texto). ' +
    'Silencio, evasivas o "sigue" sin más NO son autorización. Si tu cliente no admite ventanas y no ves respuesta, pregunta tú textualmente: ' +
    `"¿Autorizas que consulte el CENDOJ (poderjudicial.es) con mi navegador${que}? Responde sí o no." y espera. ` +
    'Si el usuario autoriza, la consulta la haces tú con tu navegador, en su nombre (esta extensión nunca accede al CENDOJ). Una autorización solo vale para una herramienta de navegación real; NUNCA la uses para buscar en la web general ni para afirmar jurisprudencia de terceros. ' +
    'Si no autoriza, o no tienes navegador, NO abras el CENDOJ ni lo sustituyas por una búsqueda web general: da el enlace y las instrucciones de rellenado de la sección ENLACES para que lo haga él.'
  );
}

/* ------------------------------------------------------------------ */
/* Definición de herramientas                                          */
/* ------------------------------------------------------------------ */

const TOOLS = [
  {
    name: 'boe_buscar_normas',
    annotations: { title: 'Buscar normas en el BOE', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Busca normas en la colección de legislación consolidada del BOE (única fuente admisible para legislación). Incluye tanto normativa estatal como de las 17 comunidades autónomas; usa "comunidades" para elegir en cuáles buscar (pregunta al usuario si no lo ha dicho) o ambito_codigo=2 para todas las autonómicas sin distinguir. Devuelve identificador, título, rango, fecha y ELI. Úsala antes de citar cualquier norma; nunca cites de memoria. Aviso importante: esta colección no incluye todo lo publicado en el BOE (comprobado con normas reales, p. ej. el Real Decreto 86/2025, ausentes de ella) — cero resultados no es prueba de que la norma no exista, solo de que no está consolidada; la respuesta lo indica explícitamente cuando pasa.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Busca en el texto completo de las normas.' },
        titulo: { type: 'string', description: 'Busca en el título de la norma.' },
        numero_oficial: { type: 'string', description: 'Número oficial, p. ej. "40/2015".' },
        rango_codigo: { type: 'number', description: 'Código de rango del BOE (1300 = Ley).' },
        materia_codigo: { type: 'number', description: 'Código de materia del vocabulario del BOE.' },
        ambito_codigo: {
          type: 'number',
          description:
            'Ámbito territorial: 1 = Estatal, 2 = Autonómico. La colección consolidada del BOE incluye normativa de las 17 comunidades autónomas (no solo estatal), aunque el título se conserva en castellano. Los Estatutos de Autonomía son Leyes Orgánicas de las Cortes Generales y por tanto constan como ámbito 1 (Estatal), no 2.',
        },
        comunidades: {
          type: 'array',
          description:
            'Limita la búsqueda a una o varias comunidades autónomas concretas. Si el usuario no ha dicho qué comunidad(es) quiere, pregúntaselo explícitamente antes de buscar (no asumas "todas" ni elijas una por tu cuenta) — la respuesta puede ser una comunidad, varias, o "todas" (en cuyo caso usa ambito_codigo=2 en su lugar y deja este campo vacío). Con varias comunidades, el resultado incluye normas de cualquiera de ellas (OR). Cubre automáticamente los dos códigos históricos de Baleares y de la Comunitat Valenciana. Para "pais_vasco" en concreto, complementa esta búsqueda con euskadi_buscar_normativa: esa herramienta consulta la fuente propia del Gobierno Vasco y sí incluye Órdenes y Resoluciones, que aquí faltan.',
          items: {
            type: 'string',
            enum: [
              'andalucia', 'aragon', 'asturias', 'baleares', 'canarias', 'cantabria',
              'castilla_la_mancha', 'castilla_y_leon', 'cataluna', 'comunidad_valenciana',
              'extremadura', 'galicia', 'la_rioja', 'madrid', 'murcia', 'navarra', 'pais_vasco',
            ],
          },
        },
        departamento_codigo: {
          type: 'number',
          description:
            'Filtra por un código de departamento emisor concreto (avanzado; para comunidades autónomas normalmente es más cómodo usar "comunidades"). Ver el auxiliar "datos-auxiliares/departamentos" del BOE para la lista completa de códigos.',
        },
        publicada_desde: { type: 'string', description: 'Fecha mínima de publicación (AAAAMMDD o AAAA-MM-DD).' },
        publicada_hasta: { type: 'string', description: 'Fecha máxima de publicación.' },
        solo_vigentes: { type: 'boolean', description: 'Excluye normas con vigencia agotada.' },
        limite: { type: 'number', description: 'Número de resultados (1-50, por defecto 10).' },
        offset: { type: 'number', description: 'Desplazamiento para paginar.' },
      },
    },
  },
  {
    name: 'boe_ficha_norma',
    annotations: { title: 'Ficha de una norma del BOE', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Ficha completa de una norma consolidada por su identificador BOE (p. ej. BOE-A-1995-25444): título oficial, rango, fechas, si está derogada o anulada, estado de consolidación y ELI. Usa esto para comprobar la vigencia antes de citar.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Identificador BOE-A-AAAA-N.' } },
      required: ['id'],
    },
  },
  {
    name: 'boe_indice_norma',
    annotations: { title: 'Índice de una norma del BOE', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Índice de una norma consolidada: lista de bloques (artículos, disposiciones, anexos) con su identificador de bloque y su título. Úsalo para localizar el bloque de un artículo antes de pedir su texto.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identificador BOE-A-AAAA-N.' },
        filtro: { type: 'string', description: 'Filtra los títulos que contengan este texto.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'boe_texto_articulo',
    annotations: { title: 'Texto vigente de un artículo', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Texto literal de un artículo o bloque de una norma consolidada, en la versión vigente hoy. Acepta el identificador del bloque (p. ej. "a22") o el título del artículo (p. ej. "Artículo 22" o "22"). Es la única forma admisible de citar el contenido de un precepto.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identificador BOE-A-AAAA-N.' },
        articulo: { type: 'string', description: 'Bloque o artículo, p. ej. "a22", "Artículo 22" o "22".' },
      },
      required: ['id', 'articulo'],
    },
  },
  {
    name: 'boe_analisis_norma',
    annotations: { title: 'Análisis de una norma (modificaciones y derogaciones)', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Análisis jurídico de una norma: materias, notas y referencias a otras normas (qué deroga, qué la modifica). Úsalo para saber si un precepto ha sido modificado y por qué norma.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Identificador BOE-A-AAAA-N.' } },
      required: ['id'],
    },
  },
  {
    name: 'boe_resolver_norma',
    annotations: { title: 'Identificar una norma por su nombre o sigla', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Convierte una referencia libre a una norma ("ET", "Código Penal", "Ley 40/2015", "Estatuto de los Trabajadores") en su identificador BOE verificado, devolviendo el título oficial y su vigencia. Úsalo cuando el usuario nombre una norma sin dar su identificador.',
    inputSchema: {
      type: 'object',
      properties: { nombre: { type: 'string', description: 'Nombre, siglas o número de la norma.' } },
      required: ['nombre'],
    },
  },
  {
    name: 'boe_verificar_cita',
    annotations: { title: 'Verificar una cita legal', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Verifica una cita legal concreta: comprueba que la norma existe, que está vigente y que el artículo citado existe, y devuelve su texto actual. Prueba primero contra el BOE y, si no la resuelve y la cita incluye la fecha de la disposición (p. ej. "Orden de 4 de mayo de 2009"), también contra el BOPV (Open Data Euskadi) — el campo "fuente" del resultado dice cuál la resolvió. Estados posibles: OK, NORMA_DEROGADA, ARTICULO_NO_ENCONTRADO, NO_RESUELTA. Solo verifica normas: una sentencia del Supremo/Audiencias/TSJ NO se verifica aquí — dila como "no verificada" y no añadas de memoria nada de ella (ni número, ni ponente, ni contenido).',
    inputSchema: {
      type: 'object',
      properties: {
        norma: { type: 'string', description: 'Norma citada ("ET", "Ley 40/2015", "Código Civil").' },
        articulo: { type: 'string', description: 'Artículo citado, p. ej. "56" o "24.2". Opcional.' },
      },
      required: ['norma'],
    },
  },
  {
    name: 'boe_verificar_escrito',
    annotations: { title: 'Verificar las citas legales de un escrito', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Analiza un escrito (demanda, recurso, contrato, informe) y verifica automáticamente todas las citas legales que contenga, contra el BOE consolidado y, cuando la cita trae fecha de disposición, también contra el BOPV (Open Data Euskadi). Devuelve, para cada cita, si la norma existe, si está vigente, si el artículo existe, y qué fuente la resolvió. Úsalo cuando el usuario pida revisar o verificar las citas de un texto. Solo verifica normas: las sentencias del Supremo/Audiencias/TSJ que cite el escrito NO se verifican aquí — márcalas como "no verificadas" y no añadas de memoria nada de ellas (ni número, ni ponente, ni contenido); solo se comprueban en el CENDOJ con un navegador real y con permiso del usuario.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Texto completo del escrito a revisar.' },
        incluir_texto: { type: 'boolean', description: 'Incluir el texto literal de cada artículo verificado (más lento).' },
        maximo: { type: 'number', description: 'Máximo de citas a verificar (por defecto 25).' },
      },
      required: ['texto'],
    },
  },
  {
    name: 'boe_comprobar_atajos',
    annotations: { title: 'Comprobar la tabla de normas frecuentes', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Auditoría interna: comprueba uno a uno los identificadores de la tabla de atajos de normas frecuentes contra el BOE y devuelve el título oficial que responde cada uno. Ejecútalo una vez tras instalar para confirmar que la tabla es correcta.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'euskadi_buscar_normativa',
    annotations: { title: 'Buscar normativa del BOPV (País Vasco)', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Busca disposiciones del Boletín Oficial del País Vasco (BOPV) vía Open Data Euskadi — fuente propia del Gobierno Vasco, no del BOE. A diferencia de boe_buscar_normas SÍ incluye Órdenes y Resoluciones (convocatorias, exenciones, etc.), que no están en la colección consolidada del BOE. Limitación real: la API solo permite navegar por año/mes, no busca por texto en servidor — el parámetro "texto" filtra localmente solo dentro de la página pedida, no en todo el período; si no aparece nada, prueba a acotar el mes o pedir más páginas antes de decir que no existe.',
    inputSchema: {
      type: 'object',
      properties: {
        anio: { type: 'number', description: 'Año de publicación (obligatorio en la práctica; por defecto el año actual).' },
        mes: { type: 'number', description: 'Mes de publicación (1-12). Opcional; acota mucho y hace el filtro por texto más fiable.' },
        texto: { type: 'string', description: 'Filtro local (no exhaustivo) por título o materia dentro de la página descargada.' },
        limite: { type: 'number', description: 'Resultados por página (1-50, por defecto 10).' },
        pagina: { type: 'number', description: 'Número de página (por defecto 1).' },
      },
      required: ['anio'],
    },
  },
  {
    name: 'euskadi_texto_norma',
    annotations: { title: 'Texto de una disposición del BOPV', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Texto completo, vigencia y referencias cruzadas de una disposición concreta del BOPV (Open Data Euskadi), a partir del id que devuelve euskadi_buscar_normativa (formato "AAAA/MM/N").',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Id del acto, formato "AAAA/MM/N", p. ej. "2024/7/3154".' } },
      required: ['id'],
    },
  },
  {
    name: 'euskadi_verificar_cita',
    annotations: { title: 'Verificar una cita del BOPV', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Verifica directamente una cita del BOPV (Open Data Euskadi) sin pasar por el BOE. La norma debe citarse con su fecha de disposición (p. ej. "Orden de 4 de mayo de 2009, del Consejero de..."), que es como se citan estas normas en la práctica — sin fecha no hay forma de resolverla, porque la API del BOPV no busca por título. En la mayoría de los casos es más cómodo usar boe_verificar_cita directamente: ya intenta esto automáticamente si el BOE no resuelve la cita.',
    inputSchema: {
      type: 'object',
      properties: {
        norma: { type: 'string', description: 'Norma citada, con su fecha de disposición, p. ej. "Orden de 4 de mayo de 2009, del Consejero de Justicia".' },
        articulo: { type: 'string', description: 'Artículo citado, si lo tiene. Opcional — muchas disposiciones del BOPV no se numeran en artículos.' },
      },
      required: ['norma'],
    },
  },
  {
    name: 'boe_tc_buscar_sentencias',
    annotations: { title: 'Buscar sentencias del Tribunal Constitucional en el BOE', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Busca sentencias (y autos) del Tribunal Constitucional publicadas en el BOE entre dos fechas. Son sentencias, no legislación — indícalo siempre así al usuario, no las llames "norma". Se publican en el BOE por mandato legal, en una colección distinta de la legislación consolidada y también distinta del CENDOJ (no dependen de su reglamento de reutilización). Limitación real: solo se puede navegar día a día (máximo 31 días por llamada), no hay búsqueda por texto en el servidor — "texto" filtra localmente sobre lo ya encontrado, no es exhaustivo.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha_desde: { type: 'string', description: 'Fecha de publicación en el BOE, inicio del rango (AAAAMMDD o AAAA-MM-DD).' },
        fecha_hasta: { type: 'string', description: 'Fecha de publicación, fin del rango. Por defecto, igual a fecha_desde (un solo día). Máximo 31 días de rango.' },
        texto: { type: 'string', description: 'Filtro local (no exhaustivo) por palabras del título dentro de lo encontrado en el rango.' },
        limite: { type: 'number', description: 'Máximo de resultados a devolver (por defecto 20, máximo 100).' },
      },
      required: ['fecha_desde'],
    },
  },
  {
    name: 'boe_tc_texto_sentencia',
    annotations: { title: 'Texto de una sentencia del Tribunal Constitucional', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Texto completo (antecedentes, fundamentos jurídicos, fallo y votos particulares si los hay), materias y referencias a normas afectadas de una sentencia del Tribunal Constitucional, a partir de su identificador BOE-A-AAAA-N (el que devuelve boe_tc_buscar_sentencias). Indica siempre que es una sentencia del TC, no una norma, y da el url de la sentencia (campo "url" y "url_pdf") en cualquier cita.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Identificador BOE-A-AAAA-N de la sentencia.' } },
      required: ['id'],
    },
  },
  {
    name: 'boe_borme_buscar',
    annotations: { title: 'Buscar actos y anuncios de una empresa en el BORME', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Busca en el BORME (Boletín Oficial del Registro Mercantil, publicado por la Agencia Estatal BOE) lo publicado sobre UNA EMPRESA entre dos fechas, en toda España: anuncios y avisos legales de la Sección Segunda (convocatorias de juntas, fusiones, escisiones, reducciones de capital...) y actos inscritos de la Sección Primera (constituciones, nombramientos, ceses, cambios de domicilio...), estos a través del índice alfabético de sociedades de cada día. Si sabes la provincia del registro mercantil, indícala: la búsqueda de actos es más rápida. NO es legislación — dilo siempre así al usuario. Solo por DENOMINACIÓN de la empresa: la búsqueda nunca mira el cuerpo de los actos, así que NO sirve para buscar personas, y no debes intentarlo (no pongas nombres de personas físicas en "denominacion" ni recopiles información sobre ellas): los nombres de administradores, apoderados o socios que aparezcan son datos personales publicados para la publicidad mercantil. Limitación real: se recorre día a día (máximo 31 días por llamada; un mes entero sin provincia puede tardar unos segundos), sin búsqueda por texto en el servidor. Cita siempre el "url_pdf" (única versión oficial).',
    inputSchema: {
      type: 'object',
      properties: {
        denominacion: { type: 'string', description: 'Denominación social de la empresa (p. ej. "Construcciones Ejemplo"). La forma social (S.A., S.L....) es opcional. Obligatoria; nunca el nombre de una persona.' },
        fecha_desde: { type: 'string', description: 'Fecha de publicación en el BORME, inicio del rango (AAAAMMDD o AAAA-MM-DD). Desde 2009.' },
        fecha_hasta: { type: 'string', description: 'Fin del rango. Por defecto, igual a fecha_desde (un solo día). Máximo 31 días de rango.' },
        provincia: { type: 'string', description: 'Opcional. Provincia del registro mercantil (nombre, p. ej. "Madrid", "Bizkaia", o código INE de dos cifras): limita los actos inscritos a esa provincia. Sin ella se buscan en toda España.' },
        limite: { type: 'number', description: 'Máximo de actos y de anuncios a devolver (por defecto 20, máximo 100).' },
      },
      required: ['denominacion', 'fecha_desde'],
    },
  },
  {
    name: 'boe_borme_texto',
    annotations: { title: 'Texto de un anuncio o acto del BORME', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Texto de un documento del BORME a partir de su identificador (el que devuelve boe_borme_buscar). Para un anuncio de la Sección Segunda (BORME-C-AAAA-N), el anuncio completo. Para un documento de la Sección Primera (BORME-A-AAAA-NNN-PP o BORME-B-..., una provincia entera en un día) exige "denominacion" y devuelve SOLO los actos de esa empresa, nunca el documento entero. No es legislación. Puede contener datos personales publicados para la publicidad mercantil: úsalos solo para esa finalidad. Da siempre "url_pdf" (única versión oficial) en cualquier cita.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identificador del BORME: BORME-C-AAAA-N (anuncio) o BORME-A-AAAA-NNN-PP / BORME-B-AAAA-NNN-PP (actos de una provincia).' },
        denominacion: { type: 'string', description: 'Denominación de la empresa. Obligatoria para documentos de la Sección Primera (A/B).' },
      },
      required: ['id'],
    },
  },
  {
    name: 'ue_buscar_normas',
    annotations: { title: 'Buscar normativa de la Unión Europea', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Busca reglamentos, directivas o decisiones de la Unión Europea por palabras de su título, en CELLAR (Oficina de Publicaciones de la UE, la base de EUR-Lex) — fuente distinta del BOE. Busca en los títulos en castellano ("texto_es"), en inglés ("texto_en") o en los dos a la vez, y devuelve títulos y enlaces en "idioma". DA SIEMPRE LOS DOS: encuentra más que cualquiera solo, porque cada idioma redacta los títulos a su manera (p. ej. texto_es "crédito consumo" y texto_en "consum* credit"). Busca en todos los años y tipos de acto salvo que acotes "tipo" o "anio_desde"/"anio_hasta": una sola llamada basta, no hace falta trocear por años. Todas las palabras de cada idioma deben aparecer en el título, escritas como en él (en castellano con sus tildes: "crédito", no "credito"); no busca sinónimos, así que si no sale nada prueba con otra palabra del título (p. ej. "matrimonial" además de "divorcio") o con un prefijo terminado en * ("divorci*", "consum*"). Cada resultado dice si está en vigor ("en_vigor") y, si ya no lo está, desde cuándo ("fin_de_vigencia", úsala en vez de calcularla tú), y en qué idioma coincidió ("encontrada_por"). Si ya sabes el número del acto, usa directamente ue_ficha_norma. Si el acto tiene un nombre usual, viene en "conocido_como": usa solo esos; no añadas apodos de memoria («Roma III», «Bruselas II bis»…) a actos que no lo traigan.',
    inputSchema: {
      type: 'object',
      properties: {
        texto_es: { type: 'string', description: 'Palabras del título en castellano, con tildes (p. ej. "crédito consumo"). Las palabras vacías ("de", "la"...) se ignoran.' },
        texto_en: { type: 'string', description: 'Las mismas ideas en inglés, como se escribirían en el título oficial (p. ej. "consum* credit"). Recomendado siempre, junto con texto_es.' },
        tipo: { type: 'string', enum: ['reglamento', 'directiva', 'decision'], description: 'Opcional. Tipo de acto; sin él, los tres.' },
        anio_desde: { type: 'number', description: 'Opcional. Año del acto, inicio del rango; sin él, desde el principio.' },
        anio_hasta: { type: 'number', description: 'Opcional. Fin del rango (por defecto, igual a anio_desde si se da; si no, hasta hoy).' },
        idioma: { type: 'string', enum: ['es', 'en'], description: 'Idioma de los títulos y enlaces del resultado: castellano ("es", por defecto) o inglés ("en"). No depende del idioma de las palabras buscadas.' },
        limite: { type: 'number', description: 'Máximo de resultados (por defecto 20, máximo 50).' },
      },
    },
  },
  {
    name: 'ue_ficha_norma',
    annotations: { title: 'Ficha de un acto de la Unión Europea', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Ficha de un reglamento, directiva o decisión de la UE: título oficial (en castellano o inglés), fecha, si está en vigor, versiones consolidadas (con la que rige hoy y las futuras) y actos que lo modifican, con enlaces a EUR-Lex y al DOUE (ELI). Acepta la cita tal como se escribe ("Reglamento (UE) 2016/679", "Directiva 95/46/CE", "Reglamento (CE) n.º 44/2001"), siglas frecuentes (RGPD, Reglamento de IA, DSA, DMA, Bruselas I bis, Bruselas II bis/ter, Roma I/II/III…) o el número CELEX (32016R0679). No cubre los Tratados ni la Carta de Derechos Fundamentales. Si el acto tiene un nombre usual, viene en "conocido_como": usa solo esos; no añadas apodos de memoria («Roma III», «Bruselas II bis»…) a actos que no lo traigan.',
    inputSchema: {
      type: 'object',
      properties: {
        norma: { type: 'string', description: 'Cita, siglas o CELEX del acto.' },
        idioma: { type: 'string', enum: ['es', 'en'], description: 'Castellano ("es", por defecto) o inglés ("en").' },
      },
      required: ['norma'],
    },
  },
  {
    name: 'ue_texto_articulo',
    annotations: { title: 'Texto de un artículo de un acto de la UE', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Texto literal de un artículo de un reglamento, directiva o decisión de la UE en la versión consolidada que rige hoy (o en el texto original si no hay consolidada), en castellano o en inglés. Si el texto no existe en el idioma pedido devuelve IDIOMA_NO_DISPONIBLE: nunca lo sustituye por otro idioma. El texto consolidado es documental, sin efecto jurídico: en cualquier cita da también "url_doue" (lo auténtico es el DOUE) y "version_desde".',
    inputSchema: {
      type: 'object',
      properties: {
        norma: { type: 'string', description: 'Cita, siglas o CELEX del acto ("RGPD", "Reglamento (UE) 2024/1689", "32012R1215").' },
        articulo: { type: 'string', description: 'Número del artículo, p. ej. "17" o "4 bis".' },
        idioma: { type: 'string', enum: ['es', 'en'], description: 'Castellano ("es", por defecto) o inglés ("en").' },
      },
      required: ['norma', 'articulo'],
    },
  },
  {
    name: 'ue_verificar_cita',
    annotations: { title: 'Verificar una cita de normativa de la UE', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description:
      'Verifica una cita a un acto de la UE: que existe, si está en vigor y, si se da, que el artículo existe, con su texto vigente. Estados: OK, NORMA_VIGENTE, NORMA_NO_VIGENTE, ARTICULO_NO_ENCONTRADO, IDIOMA_NO_DISPONIBLE, NO_RESUELTA. boe_verificar_cita y boe_verificar_escrito ya mandan aquí solas las citas europeas (en castellano); usa esta herramienta para verificar en inglés.',
    inputSchema: {
      type: 'object',
      properties: {
        norma: { type: 'string', description: 'Acto citado ("Reglamento (UE) 2016/679", "RGPD", "Directiva 2019/1023").' },
        articulo: { type: 'string', description: 'Artículo citado. Opcional.' },
        idioma: { type: 'string', enum: ['es', 'en'], description: 'Castellano ("es", por defecto) o inglés ("en").' },
      },
      required: ['norma'],
    },
  },
  {
    name: 'boe_elegir_ambito',
    annotations: { title: 'Elegir el ámbito de la búsqueda', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description:
      'Muestra al usuario un formulario para elegir el ámbito de una investigación jurídica abierta: BOE, Tribunal Constitucional, Unión Europea, CENDOJ, y/o una o varias comunidades autónomas. Llámala ANTES de buscar nada cuando la petición sea una investigación abierta ("qué dice la normativa sobre X"), nunca para una cita concreta ya identificada (usa boe_verificar_cita/euskadi_verificar_cita directamente en ese caso). No le pases argumentos. En clientes que admiten formularios interactivos (MCP Apps) se muestra un formulario real; en el resto, el resultado trae la pregunta en texto para que la hagas tú. Espera la respuesta (formulario o texto) antes de llamar a cualquier otra herramienta de búsqueda. ' + REGLA_ESPERA_AMBITO,
    inputSchema: { type: 'object', properties: {} },
    _meta: { ui: { resourceUri: RESOURCE_AMBITO_URI } },
  },
  {
    name: 'boe_ambito_seleccionado',
    annotations: { title: 'Ámbito elegido (uso interno)', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description: 'Uso interno del formulario de boe_elegir_ambito — no la llames directamente, ni la menciones al usuario.',
    inputSchema: {
      type: 'object',
      properties: {
        boe: { type: 'boolean' },
        tc: { type: 'boolean' },
        ue: { type: 'boolean' },
        cendoj: { type: 'boolean' },
        comunidades: { type: 'array', items: { type: 'string' } },
      },
    },
    _meta: { ui: { visibility: ['app'] } },
  },
  {
    name: 'cendoj_pedir_permiso',
    description:
      'REGLA DE ORO: sin haber verificado una sentencia del Supremo o de las Audiencias en el CENDOJ NO puedes afirmar NADA de ella — ni ponente, ni fecha, ni ECLI, ni contenido, ni "de memoria" ni "porque está muy citada": di únicamente que no has podido verificarla. OBLIGATORIA antes de abrir o consultar el CENDOJ (poderjudicial.es) con tu navegador, por poco que vayas a hacer: muestra al usuario una ventana emergente pidiéndole confirmación explícita para que consultes el CENDOJ en su nombre. Antes de llamarla, en una frase di qué vas a buscar y pásalo en "motivo". Después ESPERA la respuesta del usuario: solo si autoriza (por la ventana, que llegará como mensaje suyo, o por texto) puedes navegar al CENDOJ; si no autoriza, no responde o no tienes navegador, no lo abras y da el enlace e instrucciones para que lo consulte él. El permiso vale solo para la tarea de investigación en curso; en otra tarea, vuelve a pedirlo. Esta herramienta NO consulta el CENDOJ: solo pide el permiso. El conector nunca accede al CENDOJ por sí mismo. SOLO aplica si dispones de una herramienta de navegación real (p. ej. Claude en Chrome): si solo tienes búsqueda web general (web_search/web_fetch), no llames a esta herramienta, no busques, no ofrezcas buscar en la web general como alternativa y da el enlace https://www.poderjudicial.es/search/indexAN.jsp (NO index.jsp, que solo cubre el Tribunal Supremo) con instrucciones concretas — y una autorización del usuario NO convierte la búsqueda web general en una vía válida para el CENDOJ. Con autorización y navegador real, la consulta la realizas tú, en nombre del usuario y para su uso particular: solo consultas puntuales, sin descargas masivas ni redistribución de resoluciones. Sin navegador real, explícale al usuario que para que consultes tú el CENDOJ necesita instalar y conectar la extensión Claude en Chrome con Claude Desktop, y dale mientras tanto el enlace y los pasos.',
    inputSchema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Qué vas a buscar en el CENDOJ y por qué, en una frase (se muestra al usuario en la ventana).' },
      },
    },
    annotations: { title: 'Pedir permiso para consultar el CENDOJ', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { ui: { resourceUri: RESOURCE_CENDOJ_URI } },
  },
  {
    name: 'cendoj_permiso_respuesta',
    annotations: { title: 'Respuesta al permiso del CENDOJ (uso interno)', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    description: 'Uso interno de la ventana de cendoj_pedir_permiso — no la llames directamente, ni la menciones al usuario.',
    inputSchema: {
      type: 'object',
      properties: { autorizado: { type: 'boolean' } },
    },
    _meta: { ui: { visibility: ['app'] } },
  },
];

/* ------------------------------------------------------------------ */
/* Ejecución de herramientas                                           */
/* ------------------------------------------------------------------ */

// B9: `cendoj_permiso_respuesta` no comprobaba de dónde venía la llamada --
// el propio modelo podía llamarla directamente con `autorizado: true` y
// obtener el "AUTORIZADO" sin que hubiese pasado nunca por la ventana. Es
// una barrera BLANDA por diseño (el servidor no puede impedir que el cliente
// llame a la herramienta que quiera -- ver regla 9/CLAUDE.md), pero al menos
// exigir que YA se haya llamado a `cendoj_pedir_permiso` en esta misma sesión
// antes de aceptar una respuesta cierra el caso más simple del hallazgo: una
// llamada suelta a `cendoj_permiso_respuesta` sin haber pedido permiso nunca.
// De un solo uso (se consume al responder, autorizado o no), coherente con
// "vale solo para esta tarea de investigación" que ya dice el propio texto.
let permisoCendojPendiente = false;

// 1.6.1: `cendoj_permiso_respuesta` y `boe_ambito_seleccionado` son solo para
// las ventanas (visibility ["app"]). Un cliente con MCP Apps las oculta al
// modelo; uno sin MCP Apps las listaría como herramientas normales y el modelo
// podría autorizarse solo el CENDOJ. Por eso solo se listan, y solo se
// aceptan, si el cliente declaró `io.modelcontextprotocol/ui` en initialize
// (spec de MCP Apps: "servers should check client capabilities").
let clienteAdmiteApps = false;

function soloParaVentana(tool) {
  const vis = tool._meta && tool._meta.ui && tool._meta.ui.visibility;
  return Array.isArray(vis) && !vis.includes('model');
}

function herramientasVisibles() {
  return clienteAdmiteApps ? TOOLS : TOOLS.filter((t) => !soloParaVentana(t));
}

async function ejecutar(name, args) {
  args = args || {};
  switch (name) {
    case 'boe_buscar_normas': {
      const r = await buscarNormas(args);
      const resp = { fuente: 'BOE · legislación consolidada', consultado: hoyISO(), resultados: r.length, normas: r, aviso: AVISO };
      if (r.length === 0) {
        // Comprobado en vivo (14/08/2026, caso RD 86/2025, BOE-A-2025-2575):
        // una norma real y publicada puede no estar en esta colección. Cero
        // resultados no equivale a "la norma no existe" — hay que decirlo
        // explícitamente para no inducir a Claude (o al usuario) a concluir
        // que no existe. Ver regla 11 de CLAUDE.md.
        resp.aviso_sin_resultados = args.numero_oficial
          ? `No hay ninguna norma con el número oficial "${args.numero_oficial}" en la colección de legislación consolidada del BOE. Esto no significa que la norma no exista: esta colección no incluye todo lo publicado en el BOE (comprobado con el Real Decreto 86/2025, real y publicado, ausente de esta colección). No está en esta colección, puede que exista igual (sin estar consolidado) — antes de decir que no existe, compruébalo en boe.es directamente.`
          : 'Sin resultados en la colección de legislación consolidada del BOE para esta búsqueda. Esta colección no incluye todo lo publicado en el BOE (comprobado con normas reales ausentes de ella) — no está en esta colección, puede que exista igual (sin estar consolidado). No concluyas que la norma no existe sin comprobarlo en boe.es directamente.';
      }
      return resp;
    }
    case 'boe_ficha_norma': {
      const f = await fichaNorma(args.id);
      return { fuente: 'BOE · legislación consolidada', consultado: hoyISO(), ...f, aviso: AVISO };
    }
    case 'boe_indice_norma': {
      let idx = await indiceNorma(args.id);
      const total = idx.length;
      if (args.filtro) {
        const f = norm(args.filtro);
        idx = idx.filter((b) => norm(b.titulo).includes(f));
      }
      const truncado = idx.length > 400;
      return {
        fuente: 'BOE · legislación consolidada',
        norma_id: args.id,
        bloques_totales: total,
        mostrados: truncado ? 400 : idx.length,
        truncado,
        bloques: idx.slice(0, 400),
      };
    }
    case 'boe_texto_articulo': {
      const idx = await indiceNorma(args.id);
      const loc = localizarBloque(idx, args.articulo);
      if (!loc) {
        return { error: `No hay ningún bloque que corresponda a "${args.articulo}" en ${args.id}.`, sugerencia: 'Consulta boe_indice_norma para ver los bloques disponibles.' };
      }
      const cuerpo = await textoBloque(args.id, loc.bloque);
      const ficha = await fichaNorma(args.id);
      return {
        fuente: 'BOE · legislación consolidada',
        consultado: hoyISO(),
        norma: ficha.titulo,
        norma_id: ficha.id,
        norma_derogada: ficha.derogada,
        // B7: derogada NON é o único motivo por que unha norma pode non ser
        // fiable coma vixente -- ver `estadoBaseNorma`.
        norma_anulada: ficha.anulada,
        norma_vigencia_agotada: ficha.vigencia_agotada,
        bloque: loc.bloque,
        titulo: loc.titulo,
        coincidencia: loc.exacto ? 'exacta' : 'aproximada',
        version_desde: cuerpo && cuerpo.version_desde,
        // B6: esta é a redacción máis recente que existe, pero pode que
        // aínda non estea en vigor -- ver `version_desde` fronte a hoxe.
        aun_no_vigente: Boolean(cuerpo && cuerpo.aun_no_vigente),
        texto: cuerpo && cuerpo.texto,
        url: ficha.url,
        eli: ficha.eli,
        aviso: AVISO,
      };
    }
    case 'boe_analisis_norma': {
      const a = await analisisNorma(args.id);
      return { fuente: 'BOE · legislación consolidada', norma_id: args.id, ...a };
    }
    case 'boe_resolver_norma': {
      const f = await resolverNorma(args.nombre);
      if (!f) return { encontrada: false, consulta: args.nombre, detalle: 'Sin coincidencias en la colección consolidada del BOE.' };
      return { encontrada: true, consulta: args.nombre, ...f, aviso: AVISO };
    }
    case 'boe_verificar_cita': {
      const r = await verificarCitaMultifuente(args.norma, args.articulo);
      const aviso = r.fuente === 'Open Data Euskadi · BOPV (Gobierno Vasco)' ? AVISO_EUSKADI : r.fuente === FUENTE_UE ? AVISO_UE : AVISO;
      return { consultado: hoyISO(), cita: { norma: args.norma, articulo: args.articulo || null }, ...r, aviso };
    }
    case 'boe_verificar_escrito': {
      const r = await verificarEscrito(args.texto, { maximo: args.maximo, incluirTexto: args.incluir_texto });
      return {
        fuente: 'BOE · legislación consolidada + Open Data Euskadi · BOPV + Oficina de Publicaciones de la UE · CELLAR (según cada cita, ver "fuente" en el detalle)',
        consultado: hoyISO(),
        ...r,
        nota: 'Una cita NO_RESUELTA no significa que sea falsa: puede tratarse de normativa de otra comunidad autónoma, reglamentaria, o de un Tratado de la UE, que no está en ninguna de las fuentes de este conector. Revísala a mano. Cada cita lleva el aviso de su propia fuente: el texto consolidado de la UE es documental (lo auténtico es el DOUE).',
      };
    }
    case 'boe_comprobar_atajos': {
      const out = [];
      for (const a of ATAJOS) {
        try {
          const f = await fichaNorma(a.id);
          out.push({ id: a.id, siglas: a.siglas, ok: true, titulo_oficial: f.titulo, derogada: f.derogada });
        } catch (e) {
          out.push({ id: a.id, siglas: a.siglas, ok: false, error: e.message });
        }
      }
      return { comprobados: out.length, fallidos: out.filter((o) => !o.ok).length, detalle: out };
    }
    case 'euskadi_buscar_normativa': {
      const r = await buscarNormativaEuskadi(args);
      return { fuente: 'Open Data Euskadi · BOPV (Gobierno Vasco)', consultado: hoyISO(), ...r, aviso: AVISO_EUSKADI };
    }
    case 'euskadi_texto_norma': {
      const f = await textoNormativaEuskadi(args.id);
      return { fuente: 'Open Data Euskadi · BOPV (Gobierno Vasco)', consultado: hoyISO(), ...f, aviso: AVISO_EUSKADI };
    }
    case 'euskadi_verificar_cita': {
      const r = await verificarCitaEuskadi(args.norma, args.articulo);
      return { consultado: hoyISO(), cita: { norma: args.norma, articulo: args.articulo || null }, ...r, aviso: AVISO_EUSKADI };
    }
    case 'boe_tc_buscar_sentencias': {
      const r = await buscarSentenciasTC(args);
      return { fuente: 'BOE · sumario diario (Tribunal Constitucional)', tipo: 'sentencias, no legislación', consultado: hoyISO(), ...r, aviso: AVISO_TC };
    }
    case 'boe_tc_texto_sentencia': {
      const f = await textoSentenciaTC(args.id);
      return { fuente: 'BOE · sumario diario (Tribunal Constitucional)', tipo: 'sentencia, no legislación', consultado: hoyISO(), ...f, aviso: AVISO_TC };
    }
    case 'boe_borme_buscar': {
      const r = await buscarBorme(args);
      const total = r.encontrados.actos + r.encontrados.anuncios;
      return {
        fuente: FUENTE_BORME,
        tipo: TIPO_BORME,
        consultado: hoyISO(),
        ...r,
        ...(total ? {} : { resultado: 'sin resultados', detalle: `Nada publicado en el BORME sobre "${r.denominacion_buscada}" en las secciones revisadas y en ese rango. No significa que la empresa no exista: puede haber publicaciones fuera del rango${r.provincia ? ' o en otra provincia' : ''}.` }),
        aviso: AVISO_BORME,
      };
    }
    case 'boe_borme_texto': {
      const r = await textoBorme(args.id, args.denominacion);
      return { fuente: FUENTE_BORME, tipo: TIPO_BORME, consultado: hoyISO(), ...r, aviso: AVISO_BORME };
    }
    case 'ue_buscar_normas': {
      const r = await buscarNormasUE(args);
      return {
        fuente: FUENTE_UE,
        consultado: hoyISO(),
        ...r,
        ...(r.resultados ? {} : { resultado: 'sin resultados', detalle: 'Ningún título en ese idioma contiene todas esas palabras (en el tipo y los años pedidos, si se acotaron). No significa que el acto no exista: prueba con menos palabras, con tildes, con otra palabra del título o con un prefijo terminado en *.' }),
        aviso: AVISO_UE,
      };
    }
    case 'ue_ficha_norma': {
      const f = await fichaNormaUE(args.norma, args.idioma);
      return { fuente: FUENTE_UE, consultado: hoyISO(), ...f, aviso: AVISO_UE };
    }
    case 'ue_texto_articulo': {
      const t = await textoArticuloUE(args.norma, args.articulo, args.idioma);
      return { fuente: FUENTE_UE, consultado: hoyISO(), ...t, aviso: AVISO_UE };
    }
    case 'ue_verificar_cita': {
      const r = await verificarCitaUE(args.norma, args.articulo, args.idioma);
      return { consultado: hoyISO(), cita: { norma: args.norma, articulo: args.articulo || null }, ...r, aviso: AVISO_UE };
    }
    case 'boe_elegir_ambito': {
      return { formulario_mostrado: clienteAdmiteApps ? 'ámbito de búsqueda' : null, texto_alternativo_si_no_hay_formulario: textoAmbitoFallback() };
    }
    case 'boe_ambito_seleccionado': {
      if (!clienteAdmiteApps) {
        return {
          ambito_elegido_por_el_usuario: 'RECHAZADO: este cliente no admite el formulario de ámbito',
          instruccion: 'Esta herramienta es solo para el formulario, nunca se llama directamente. Pregunta al usuario por texto qué ámbito quiere (ver texto_alternativo_si_no_hay_formulario de boe_elegir_ambito) y espera su respuesta.',
        };
      }
      const partes = [];
      if (args.boe) partes.push('BOE');
      if (args.tc) partes.push('Tribunal Constitucional (boe_tc_*)');
      if (args.ue) partes.push('Unión Europea: reglamentos, directivas y decisiones (ue_*, fuente distinta del BOE; en castellano salvo que el usuario pida inglés)');
      if (args.cendoj) partes.push('CENDOJ, resto de jurisprudencia (el conector no accede a él. Si vas a consultarlo con tu navegador, ANTES llama a cendoj_pedir_permiso y espera la autorización explícita del usuario; si no autoriza o no tienes navegador, da instrucciones/enlace de la sección ENLACES de las instrucciones del proyecto)');
      const comunidades = Array.isArray(args.comunidades) ? args.comunidades : [];
      if (comunidades.length) {
        const nombres = comunidades.map((c) => NOMBRES_COMUNIDADES[c] || c).join(', ');
        partes.push(`comunidad(es) autónoma(s): ${nombres} (usa euskadi_* si incluye País Vasco; para el resto, sin acceso automatizado — enlace de la sección ENLACES)`);
      }
      return {
        ambito_elegido_por_el_usuario: partes.length ? partes : ['ninguno — pregunta de nuevo antes de buscar'],
        instruccion: 'Continúa la conversación usando este ámbito para decidir qué herramientas llamar.',
      };
    }
    case 'cendoj_pedir_permiso': {
      const motivo = typeof args.motivo === 'string' ? args.motivo.trim().slice(0, 400) : '';
      permisoCendojPendiente = true;
      return {
        ventana_mostrada: clienteAdmiteApps ? 'permiso para consultar el CENDOJ' : null,
        motivo: motivo || null,
        instruccion: textoCendojPedirFallback(motivo, clienteAdmiteApps),
      };
    }
    case 'cendoj_permiso_respuesta': {
      // 1.6.1: sin MCP Apps no hay ventana que pueda responder: cualquier
      // llamada viene del modelo, nunca del usuario.
      if (!clienteAdmiteApps) {
        return {
          permiso_cendoj: 'RECHAZADO: este cliente no admite la ventana de permiso',
          instruccion:
            'Esta herramienta es solo para la ventana de cendoj_pedir_permiso y tu cliente no la muestra: no la llames nunca. El permiso se pide por texto: pregunta al usuario y espera su "sí" explícito en la conversación antes de abrir el CENDOJ.',
        };
      }
      // B9: sin una petición pendiente (nadie llamó a cendoj_pedir_permiso
      // antes, en esta misma sesión), no hay nada que "responder" -- se
      // rechaza en vez de fiarse ciegamente de `args.autorizado`.
      if (!permisoCendojPendiente) {
        return {
          permiso_cendoj: 'RECHAZADO: no hay ninguna petición de permiso pendiente',
          instruccion:
            'Esta herramienta es solo para la ventana de cendoj_pedir_permiso, nunca se llama directamente ni por tu cuenta. Si de verdad necesitas consultar el CENDOJ, llama primero a cendoj_pedir_permiso y espera la respuesta real del usuario.',
        };
      }
      permisoCendojPendiente = false;
      if (args.autorizado === true) {
        return {
          permiso_cendoj: 'AUTORIZADO por el usuario, solo para esta tarea de investigación',
          instruccion:
            'Solo si dispones de una herramienta de navegación real (p. ej. Claude en Chrome), puedes abrir https://www.poderjudicial.es/search/indexAN.jsp y hacer la consulta que anunciaste; con solo búsqueda web general NO tienes acceso: no busques, explícale que necesita instalar y conectar la extensión Claude en Chrome con Claude Desktop para que consultes tú, y da el enlace e instrucciones. Con navegador real, la consulta la realizas tú, en nombre del usuario y para su uso particular, solo con consultas puntuales (nunca descargas masivas ni redistribuir resoluciones), siguiendo la sección ENLACES/CENDOJ de las instrucciones del proyecto. No lo extiendas a otras tareas: en otra, vuelve a llamar a cendoj_pedir_permiso.',
        };
      }
      return {
        permiso_cendoj: 'DENEGADO por el usuario',
        instruccion:
          'NO abras el CENDOJ ni lo sustituyas por una búsqueda web general. Da el enlace (https://www.poderjudicial.es/search/indexAN.jsp) y las instrucciones concretas de rellenado para que lo consulte el propio usuario.',
      };
    }
    default:
      throw new Error(`Herramienta desconocida: ${name}`);
  }
}

/* ------------------------------------------------------------------ */
/* Bucle JSON-RPC sobre stdio                                          */
/* ------------------------------------------------------------------ */

function enviar(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function responder(id, result) {
  enviar({ jsonrpc: '2.0', id, result });
}

function responderError(id, code, message) {
  enviar({ jsonrpc: '2.0', id, error: { code, message } });
}

async function manejar(msg) {
  const { id, method, params } = msg;
  const esNotificacion = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const pedido = params && params.protocolVersion;
      const ext = params && params.capabilities && params.capabilities.extensions;
      clienteAdmiteApps = !!(ext && typeof ext === 'object' && ext['io.modelcontextprotocol/ui']);
      return responder(id, {
        protocolVersion: typeof pedido === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(pedido) ? pedido : PROTOCOL_FALLBACK,
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: 'boe-consolidada', version: VERSION },
        instructions:
          'REGLA Nº 1, SIN EXCEPCIONES: si en ESTA conversación no has verificado una sentencia del Supremo, la Audiencia Nacional, los TSJ o las Audiencias en el CENDOJ con un navegador real, NO nombres ninguna: ni su número, ni ponente, fecha, ECLI o contenido, ni "la doctrina del Supremo (STS x/aaaa…)", ni "la muy conocida…", ni "me suena", ni como ejemplo, ni al ofrecer tu ayuda, ni "mientras tanto, de lo que recuerdo", ni "las fuentes secundarias dicen que trata de…", ni MIENTRAS ESPERAS la autorización del usuario para consultar el CENDOJ (en ese mensaje limítate a pedir el permiso; no describas la sentencia ni su materia). Cuando el usuario pida verificar una sentencia por su número, NO adelantes de qué trata: verifícala primero. Tampoco lo digas para negarte: ni "aunque me suene", ni "aunque la conozco", ni "aunque es muy citada" — di solo "no he podido verificarla". REGLA Nº 2: Claude en Chrome (la extensión de navegador que permitiría consultar el CENDOJ) solo está disponible en los planes de pago de Claude (Pro, Max, Team y Enterprise) y solo en Google Chrome; SIEMPRE que lo menciones al usuario, dilo en esa misma frase (p. ej. "Claude en Chrome, disponible solo en planes de pago"), y no se lo ofrezcas como solución sin decirlo. Puedes describir la materia sin citar sentencias y decir que la doctrina jurisprudencial hay que verificarla en el CENDOJ. Herramientas de consulta de legislación y jurisprudencia constitucional española: la colección consolidada del BOE (boe_*, estatal y autonómica en la medida en que el BOE la recoge), sentencias del Tribunal Constitucional publicadas en el BOE (boe_tc_*, distintas de la legislación — indícalo siempre), actos y anuncios de empresas publicados en el BORME (boe_borme_*, tampoco son legislación — indícalo; solo por denominación de la empresa: nunca busques ni recopiles información sobre personas físicas, cuyos nombres en el BORME son datos personales publicados solo para la publicidad mercantil) y, para el País Vasco específicamente, Open Data Euskadi/BOPV (euskadi_*, incluye Órdenes y Resoluciones que el BOE no tiene) y la normativa de la Unión Europea (ue_*: reglamentos, directivas y decisiones, en castellano o en inglés según el parámetro "idioma", desde CELLAR/EUR-Lex de la Oficina de Publicaciones de la UE — fuente distinta del BOE; su texto consolidado es documental, lo auténtico es el DOUE; nunca cambies de idioma sin decírselo al usuario). No hay acceso a ninguna otra jurisprudencia (Supremo, Audiencias...): eso depende del CENDOJ, fuera de este conector. REGLA CENDOJ: el conector nunca accede al CENDOJ. Sin haber verificado una sentencia del Supremo/Audiencias en el CENDOJ, NO afirmes nada de ella (ni ponente, fecha, ECLI o contenido, ni de memoria): di que no has podido verificarla. "Navegador" significa una herramienta de navegación real (p. ej. la extensión Claude en Chrome), NUNCA la búsqueda web general (web_search/web_fetch): si solo dispones de búsqueda web, NO tienes acceso al CENDOJ ni a jurisprudencia que no sea del TC — no busques ni afirmes nada de ella; da el enlace https://www.poderjudicial.es/search/indexAN.jsp (SIEMPRE indexAN.jsp, NUNCA index.jsp: este último solo cubre el Tribunal Supremo) y las instrucciones para que lo consulte el usuario. Si tienes navegador real y el usuario quiere jurisprudencia del Supremo/Audiencias, ANTES de abrir poderjudicial.es llama a cendoj_pedir_permiso (ventana de confirmación) y espera su autorización explícita; con ella, la consulta la realizas TÚ con tu navegador, en nombre del usuario y para su uso particular (el conector sigue sin acceder al CENDOJ). LÍMITES de esa consulta (aviso legal y Reglamento 3/2010 del CGPJ): solo las consultas puntuales necesarias para la petición concreta del usuario, con pausa entre ellas; NUNCA descargas masivas, ni recorrer listados completos, ni guardar o redistribuir resoluciones, ni uso comercial; sin ella, da el enlace e instrucciones. SIN NAVEGADOR REAL (p. ej. el Chat de Claude Desktop sin la extensión Claude en Chrome conectada): cuando el usuario pida jurisprudencia del Supremo/Audiencias, díselo con claridad en las primeras líneas — (1) esta extensión nunca accede al CENDOJ (Reglamento 3/2010 del CGPJ); solo puedes consultarlo tú, en su nombre y con su autorización expresa, si dispones de un navegador real; (2) ahora no dispones de él, y para que lo consultes tú debe instalar y conectar la extensión Claude en Chrome con Claude Desktop (SIEMPRE que la menciones, di que solo está disponible en los planes de pago de Claude —Pro, Max, Team y Enterprise— y solo en Google Chrome); (3) mientras tanto, el enlace y los pasos para consultarlo él mismo. Aviso: Claude en Chrome solo está disponible en los planes de pago de Claude (Pro, Max, Team y Enterprise) y solo en Google Chrome; si el usuario tiene el plan gratuito, no le insistas en instalarlo: dile que en su plan la consulta debe hacerla él mismo (enlace, campo «Nº Resolución» con el número tal cual y «Tipo de órgano: Tribunal Supremo», sin fecha) y que te pegue el resultado para que lo analices. No lo presentes como un fallo ni prometas hacerlo más tarde sin navegador. Y sin verificarla en el CENDOJ NO nombres ninguna sentencia concreta: ni por su número, ni "que te suena", ni "muy conocida", ni como ejemplo. Úsalas como ÚNICA fuente para cualquier afirmación sobre normas, artículos o sentencias del TC españoles, o sobre lo publicado en el BORME o la normativa de la UE. Nunca cites nada sin haberlo recuperado con estas herramientas, tampoco mientras esperas que el usuario elija el ámbito o autorice una consulta: en ese mensaje no nombres ninguna norma, acto de la UE ni sentencia concretos, ni como ejemplo ni como «punto de partida probable». Si ninguna herramienta devuelve resultados, dilo explícitamente en vez de contestar de memoria. Cada fuente indica su propio aviso de valor no oficial en cada respuesta.',
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;
    case 'ping':
      return responder(id, {});
    case 'tools/list':
      return responder(id, { tools: herramientasVisibles() });
    case 'resources/list':
      return responder(id, {
        resources: [
          {
            uri: RESOURCE_AMBITO_URI,
            name: 'Formulario de ámbito de búsqueda',
            mimeType: 'text/html;profile=mcp-app',
          },
          {
            uri: RESOURCE_CENDOJ_URI,
            name: 'Ventana de permiso para consultar el CENDOJ',
            mimeType: 'text/html;profile=mcp-app',
          },
        ],
      });
    case 'resources/read': {
      const uri = params && params.uri;
      const paginas = { [RESOURCE_AMBITO_URI]: HTML_AMBITO, [RESOURCE_CENDOJ_URI]: HTML_CENDOJ };
      if (!Object.prototype.hasOwnProperty.call(paginas, uri)) return responderError(id, -32602, `Recurso desconocido: ${uri}`);
      return responder(id, {
        contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: paginas[uri] }],
      });
    }
    case 'prompts/list':
      return responder(id, { prompts: [] });
    case 'tools/call': {
      const nombre = params && params.name;
      try {
        const datos = await ejecutar(nombre, params && params.arguments);
        return responder(id, { content: [{ type: 'text', text: JSON.stringify(datos, null, 1) }] });
      } catch (e) {
        log(`[error] ${nombre}: ${e.stack || e.message}`);
        return responder(id, {
          content: [{ type: 'text', text: JSON.stringify({ error: e.message, herramienta: nombre, fuente: 'BOE · legislación consolidada' }) }],
          isError: true,
        });
      }
    }
    default:
      if (esNotificacion) return;
      return responderError(id, -32601, `Método no soportado: ${method}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let corte;
  while ((corte = buffer.indexOf('\n')) >= 0) {
    const linea = buffer.slice(0, corte).trim();
    buffer = buffer.slice(corte + 1);
    if (!linea) continue;
    let msg;
    try {
      msg = JSON.parse(linea);
    } catch (e) {
      log('[error] línea no es JSON: ' + linea.slice(0, 120));
      continue;
    }
    Promise.resolve()
      .then(() => manejar(msg))
      .catch((e) => {
        log('[error] ' + (e.stack || e.message));
        if (msg && msg.id !== undefined && msg.id !== null) responderError(msg.id, -32603, e.message);
      });
  }
});

process.stdin.on('end', () => process.exit(0));
log('boe-consolidada MCP listo (fuentes: boe.es/datosabiertos, api.euskadi.eus/bopv, publications.europa.eu/cellar)');

module.exports = N;
