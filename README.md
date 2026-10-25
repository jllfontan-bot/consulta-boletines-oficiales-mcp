# Consulta Boletines Oficiales - Legislación consolidada — conector para Claude

> **No es un servicio oficial.** No está vinculado a la Agencia Estatal BOE ni al Gobierno
> Vasco: solo usa sus datos abiertos, con las condiciones de reutilización de cada uno.

Da a Claude acceso directo a la colección de legislación consolidada de la Agencia
Estatal BOE, a las sentencias del Tribunal Constitucional publicadas en el BOE y,
para el País Vasco, a la normativa del BOPV vía Open Data Euskadi. Ninguna otra
fuente.

- **Gratis**: ni la API del BOE ni la de Open Data Euskadi piden clave, cuenta ni pago.
- **Sin límites de la fuente**: ninguna de las dos publica cuotas para su API.
- **Sin intermediarios**: se ejecuta en tu ordenador y habla directamente con `boe.es`
  y `api.euskadi.eus`. No pasa por ningún servicio de terceros ni por ningún servidor
  mío.

---

## 1. Instalación

**Requisito**: la app de escritorio de Claude (macOS o Windows). Los servidores MCP locales solo funcionan ahí; no están disponibles en claude.ai ni en el móvil. La app es gratuita y funciona con cualquier plan.

0. **Si tienes la versión anterior, «BOE · Legislación consolidada» (1.6.0 o anterior), desinstálala antes**: Ajustes → Extensiones → la extensión → «…» → Desinstalar. Desde la 1.6.1 tiene otro nombre y otro autor, y Claude Desktop la trata como una extensión distinta: si no la desinstalas, quedan las dos, con las herramientas repetidas. Tu proyecto y tus conversaciones no se borran.
1. Abre Claude Desktop → **Ajustes → Extensiones**.
2. Pulsa **Ajustes avanzados** y busca la sección **Extension Developer**.
3. **Install Extension…** y selecciona `consulta-boletines-oficiales-v<versión>.mcpb` (p. ej. `consulta-boletines-oficiales-v1.6.1.mcpb`; hasta la 1.6.0 se llamaba `boe-consolidada-v<versión>.mcpb`).
4. Acepta y reinicia Claude.

Debería aparecer «Consulta Boletines Oficiales - Legislación consolidada v<versión>» con 20 herramientas. Comprueba que ya no aparece «BOE · Legislación consolidada» (paso 0).

### Alternativa sin .mcpb

Si prefieres el fichero de configuración, copia `server/index.js` donde quieras y añade a `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "boe-consolidada": {
      "command": "node",
      "args": ["/ruta/absoluta/a/server/index.js"]
    }
  }
}
```

Esta vía necesita Node.js ≥18 instalado en el sistema. La vía `.mcpb` no: Claude Desktop trae su propio Node.

---

## 2. Primera comprobación

Nada más instalarlo, pídele esto a Claude:

> Ejecuta `boe_comprobar_atajos` y dime si algún identificador falla.

El servidor lleva una tabla de atajos para 27 normas frecuentes (CC, CP, LEC, ET, LGT, LAU…) que traduce «ET» a `BOE-A-2015-11430`. Auditada contra el BOE real: los 27 identificadores responden y el título oficial corresponde a la sigla.

Si alguno falla no se rompe nada: el servidor cae automáticamente a buscar la norma por su título. Pero conviene corregirlo en la tabla `ATAJOS` de `server/index.js`.

---

## 3. Qué sabe hacer

**Consulta (fase 1)**

| Herramienta | Para qué |
|---|---|
| `boe_buscar_normas` | Buscar por texto, título, número oficial, rango, materia, fechas o comunidad autónoma |
| `boe_ficha_norma` | Título oficial, fechas, si está derogada o anulada, ELI |
| `boe_indice_norma` | Todos los artículos y disposiciones de una norma |
| `boe_texto_articulo` | El texto literal del precepto, en la versión vigente hoy |
| `boe_analisis_norma` | Qué normas la modifican o derogan, y sus materias |

**Verificación (fase 2)**

| Herramienta | Para qué |
|---|---|
| `boe_resolver_norma` | «ET», «Ley 40/2015» o «Código Penal» → identificador BOE verificado |
| `boe_verificar_cita` | Una cita suelta: ¿existe la norma? ¿sigue vigente? ¿existe el artículo? |
| `boe_verificar_escrito` | Pegas una demanda o un recurso y verifica todas sus citas de golpe |

**País Vasco (Open Data Euskadi / BOPV)**

El BOE no cataloga Órdenes ni la mayoría de Resoluciones autonómicas (convocatorias,
exenciones...) de ninguna comunidad. Para el País Vasco, estas dos herramientas
consultan la fuente propia del Gobierno Vasco y sí las tienen:

| Herramienta | Para qué |
|---|---|
| `euskadi_buscar_normativa` | Disposiciones del BOPV por año/mes, incluidas Órdenes y Resoluciones |
| `euskadi_texto_norma` | Texto completo, vigencia y referencias cruzadas de una disposición concreta |
| `euskadi_verificar_cita` | Verifica directamente una cita del BOPV citada por su fecha de disposición |

La API del BOPV solo permite navegar por año/mes, no busca por texto en servidor: el
filtro de texto de `euskadi_buscar_normativa` es local, sobre lo ya descargado, no
exhaustivo.

**`boe_verificar_cita` y `boe_verificar_escrito` ya prueban el BOPV automáticamente.**
Si una cita no se resuelve en el BOE y trae la fecha de disposición ("Orden de 4 de
mayo de 2009, del Consejero de..." — así es como se citan estas normas en la
práctica), lo intentan también contra Open Data Euskadi antes de darla por
`NO_RESUELTA`. El resultado de cada cita indica qué fuente la resolvió.

**Tribunal Constitucional (jurisprudencia)**

Las sentencias del TC se publican en el BOE por mandato legal — el conector las lee
de ahí, no del CENDOJ (cuyas condiciones de reutilización exigen autorización previa
del CGPJ). **Es jurisprudencia, no
legislación** — cada respuesta lo deja explícito. Es la única jurisprudencia a la
que este conector da acceso: nada del Supremo, Audiencias o Juzgados.

| Herramienta | Para qué |
|---|---|
| `boe_tc_buscar_sentencias` | Sentencias del TC publicadas en el BOE entre dos fechas (máx. 31 días) |
| `boe_tc_texto_sentencia` | Texto completo, materias y referencias a las normas afectadas de una sentencia concreta |

Igual que con el BOPV, solo se puede navegar por fecha de publicación, no buscar por
texto en servidor. Cada sentencia trae su `url` (HTML) y su `url_pdf` — el PDF es la
única versión con valor oficial y auténtico, ni siquiera el HTML/XML lo tiene.

**BORME (Registro Mercantil) — desde la 1.6.0**

Actos inscritos y anuncios de empresas publicados en el Boletín Oficial del Registro
Mercantil, que también publica la Agencia Estatal BOE (mismo host, mismas condiciones
de reutilización). **No es legislación** — cada respuesta lo deja explícito con su
propia `fuente` y `tipo`. Solo por **denominación de la empresa**: la búsqueda nunca
mira el cuerpo de los actos, donde van los nombres de administradores y apoderados
(datos personales publicados para la publicidad mercantil), y los documentos con esos
nombres solo se cachean en memoria, nunca en disco.

| Herramienta | Para qué |
|---|---|
| `boe_borme_buscar` | Lo publicado sobre una empresa entre dos fechas (máx. 31 días): anuncios y actos inscritos, de toda España (vía el índice alfabético de sociedades de cada día) o de una provincia |
| `boe_borme_texto` | Texto de un anuncio; de un documento de provincia, solo los actos de la empresa indicada |

Cada resultado trae `url`, `url_pdf` (única versión oficial, RD 1979/2008) y la fecha
de actualización del documento.

### Cómo pedirlo

> ¿Qué dice hoy el artículo 56 del Estatuto de los Trabajadores?

> Localiza las normas consolidadas sobre arrendamientos urbanos publicadas después de 2019.

> Revisa las citas legales de este recurso: [pegas el texto]

> ¿El artículo 348 bis LSC sigue vigente y ha sido modificado?

> Busca sentencias del Tribunal Constitucional publicadas la última semana de junio de 2024.

Cada respuesta trae el identificador BOE, el enlace ELI y la fecha desde la que rige esa versión del precepto.

---

## 4. Lo que hay que saber

**«Sin límites» tiene un matiz.** El BOE no impone cuotas, pero tu plan de Claude sí limita los mensajes. El conector no consume nada aparte de eso.

**Guarda lo consultado en dos sitios, siempre en tu ordenador.** En memoria, mientras el proceso está vivo (se pierde al reiniciar Claude Desktop), y en disco en `~/.cache/boe-consolidada-mcp/` (sobrevive a reinicios — ahí sigue disponible aunque cierres y abras Claude Desktop otro día). Nunca en un servidor externo. Cada tipo de dato caduca a un ritmo distinto, según cuánto puede cambiar y cuánto cuesta volver a pedirlo:

| Qué se guarda | Cuánto dura | Por qué |
|---|---|---|
| Memoria (cualquier respuesta) | 15 minutos | Solo evita repetir la misma llamada dentro de la conversación activa (p. ej. pedir el índice y luego un artículo de la misma norma). |
| Texto completo de una norma (BOE) | 7 días | Es lo más caro de pedir (varios MB en un código grande como el Civil) y lo más estable: el texto consolidado solo cambia cuando entra en vigor otra norma que lo modifica, no de un día para otro. |
| Ficha de una norma (vigencia, derogación) | 24 horas | Aquí importa "hoy": una norma puede pasar a estar derogada justo al entrar en vigor la que la deroga. 24 horas asegura que la información tiene como mucho un día. |
| Análisis (qué la modifica o deroga) | 24 horas | Mismo motivo que la ficha: metadata que puede ganar una entrada nueva cuando se publica una norma que afecta a la consultada. |
| Resultados de búsqueda | 6 horas | La más corta: el BOE publica normas nuevas todos los días, así que una caché de 24 horas podría esconder algo publicado esa misma mañana. |
| Datos del BOPV (Open Data Euskadi) | Igual que el BOE, según el tipo de llamada | Misma lógica de caché, fuente distinta. |

En resumen: cuanto más caro de pedir y más estable es el dato, más dura la caché; cuanto más puede cambiar de un día para otro, más corta. Repreguntar sobre la misma norma —esta conversación, la siguiente, o después de reiniciar Claude Desktop— no vuelve a llamar al BOE ni a Euskadi mientras la caché correspondiente siga viva. Nada de esto afecta a la vigencia real de una norma, solo a cuándo vuelve a comprobarla este conector contra la fuente. Si el disco no se puede escribir, sigue funcionando solo con la caché de memoria, sin romperse.

**El texto consolidado no es oficial.** Lo dice el propio BOE: la consolidación integra las modificaciones en un solo texto para facilitar la consulta, pero para efectos jurídicos hay que ir a la publicación oficial. Lo mismo vale para el texto que reconstruye `euskadi_texto_norma` a partir de la API de Open Data Euskadi: para efectos jurídicos, el PDF/EPUB enlazado. Todas las respuestas incluyen su propio aviso.

**No cubre todo el derecho español.** Solo hay legislación consolidada estatal y autonómica *seleccionada* del BOE, más el BOPV del País Vasco. Fuera quedan reglamentos menores, la normativa de las otras 16 comunidades que no está en el BOE (sobre todo Órdenes y Resoluciones — ver más abajo), la normativa local y el derecho de la UE. Cuando `boe_verificar_escrito` marca una cita como `NO_RESUELTA` **no significa que sea falsa**: significa que no está en esta colección. Hay que mirarla a mano.

**Las Órdenes y la mayoría de Resoluciones autonómicas no están en el BOE, de ninguna comunidad — comprobado, no es una suposición.** El BOE cataloga la normativa autonómica "más relevante" (leyes, decretos), no las convocatorias anuales, exenciones o resoluciones de trámite. Para el País Vasco, `euskadi_buscar_normativa`/`euskadi_texto_norma` sí las tienen. Para el resto de comunidades, ese tipo de normativa hay que buscarlo en su boletín oficial o en la web de la consejería — no está aquí y no debería inventarse.

**Jurisprudencia: solo el Tribunal Constitucional.** Este conector no toca el CENDOJ (sus condiciones de reutilización exigen autorización previa del CGPJ). Las sentencias del TC sí están disponibles, porque se publican en el propio BOE, no en el CENDOJ. Para cualquier otra sentencia (Supremo, Audiencias, Juzgados), si Claude la cita la está sacando de su memoria y puede ser inventada — no debería hacerlo.

**Ante una investigación abierta, Claude pregunta el ámbito antes de buscar.** No la restringe por defecto al BOE: te pregunta si quieres BOE, también jurisprudencia (TC/CENDOJ) y/o la normativa propia de alguna comunidad autónoma en concreto. Para lo que no tiene acceso automatizado (CENDOJ, cualquier comunidad salvo el País Vasco) te da instrucciones de rellenado o el enlace directo al buscador oficial (Aragón y La Rioja admiten el enlace ya relleno con el texto buscado) — nunca como llamada automática del conector.

**El verificador detecta el patrón «art. N + norma».** Coge enumeraciones («arts. 9, 10 y 11 del ET»), apartados («art. 24.2 CE») y ordinales («art. 348 bis»). No detecta citas por nombre de precepto sin número ni referencias implícitas del tipo «el artículo anterior».

---

## 5. Comprobar que funciona sin Claude

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"boe_verificar_cita","arguments":{"norma":"Código Penal","articulo":"22"}}}' \
 | node server/index.js
```

Si devuelve el texto de las circunstancias agravantes, todo está en orden.

---

## 6. Uso responsable

Ambas APIs de datos abiertos existen precisamente para esto, y su uso implica aceptar
las condiciones de reutilización de cada una (BOE; Open Data Euskadi bajo CC BY 4.0).
Aun así: no lances descargas masivas de toda la colección, cita siempre la fuente
correcta (BOE u Open Data Euskadi, nunca las mezcles) y no presentes ningún texto
reconstruido por estas herramientas como si fuera el oficial.

---

## 7. Licencia

Copyright © 2026 José Luis López Fontán.
Licencia cedida con arreglo a la EUPL v1.2 o, a elección del licenciatario, a la GNU AGPL v3.

Este programa se ha desarrollado con la ayuda de **Claude**, el modelo de inteligencia artificial
de **Anthropic**, a través de Claude Code: el autor ha dirigido, revisado y probado el trabajo.
Claude y Anthropic son marcas de Anthropic, PBC; el programa no está afiliado a Anthropic ni
cuenta con su respaldo.

Este programa es software libre con **doble licencia**: puedes usarlo, redistribuirlo y/o
modificarlo, a tu elección, bajo los términos de la **Licencia Pública de la Unión Europea
(EUPL) v1.2** (ver [`LICENCIA-EUPL-1.2.txt`](LICENCIA-EUPL-1.2.txt), texto oficial en
castellano) o de la **GNU Affero General Public License** publicada por la Free Software
Foundation, versión 3 (ver [`LICENSE`](LICENSE)). Identificador SPDX:
`EUPL-1.2 OR AGPL-3.0-only`. Las versiones de la extensión hasta la 1.6.0 se distribuyeron con la licencia MIT.

La extensión no lleva componentes de terceros (solo módulos nativos de Node.js). 

Se distribuye con la esperanza de que sea útil, pero **SIN NINGUNA GARANTÍA**, ni siquiera la
garantía implícita de COMERCIABILIDAD o ADECUACIÓN A UN FIN DETERMINADO. Los datos proceden de la
Agencia Estatal BOE y de Open Data Euskadi (CC BY 4.0), cada uno con sus condiciones de
reutilización.

---

## 8. Agradecimientos

A David Platero, por su colaboración en este proyecto.
