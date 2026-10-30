# Acciones de la finca en el menú del listado y enlace «Volver a todas las fincas»

ESTADO: IMPLEMENTADO Y VERIFICADO (L4). Antes: PLANIFICADO Y SIN DUDAS ABIERTAS (L3). Decisiones D1–D8 aplicadas (el usuario aprobó las tres preguntas; el resto de recomendaciones del plan se adoptan tal cual) y diseño del botón y del menú definido por un especialista UX/UI. Nada construido todavía.
Rama: main. Estrategia de entrega: ask-on-risk. Test runner: Vitest (front); sin backend previsto.

## Lo que pide el usuario (L1, verbatim)

Imagen con un post-it sobre la cabecera de la ficha de finca (botones «Puesta en marcha (3)», «Editar», «Importar del Catastro», «Nueva propiedad»): "los botones de puesta en marcha, editar, etc… creo que deben de verse en la vista general y no aquí o meter un boton de editar debajo del carrousel de menú".

"Trata de generar un plan que lleve a cabo el cambio que se propone en el post-it de la imagen. Esas opciones se van a integrar al menú de opciones disponible desde el botón disponible desde la columna Acciones del listado de fincas. Aprovechando el cambio en el detalle de la finca, revisa el enlace a "Volver a todas las fincas" porque parece que está roto"

## Lo que existe hoy (investigación 2026-10-20, verificada en el código)

**Listado de fincas** (`features/dashboard-b`):
- Un solo consumidor de la presentación: `estate-overview-views` (vista tabla y vista tarjetas). No tiene spec propio.
- La última columna se llama «Acción» (singular) y cada fila tiene solo el enlace «Ver finca →». **No existe todavía ningún botón de acciones ni menú** (el usuario habla de él como si ya existiera: hay que crearlo).
- En la vista de tarjetas toda la tarjeta es un enlace; un botón dentro de un `<a>` es HTML inválido, así que el menú iría fuera del enlace.
- Ya hay un menú accesible que sirve de modelo: el «⋯» de la tabla de contratos (`role="menu"`, posición fija, flechas, Escape, cierre al pulsar fuera).

**Cabecera de la ficha** (`estate-header`, componente solo de presentación con las salidas `edit`, `importCatastro`, `newProperty`, `openSetup`):
- «Puesta en marcha (N)»: solo aparece si faltan pasos obligatorios; abre un panel lateral con la tarjeta de puesta en marcha; el número sale del estado de la finca (`setup-status`).
- «Editar»: abre el modal de edición, que vive en el componente de la ficha.
- «Importar del Catastro»: abre su modal (también en la ficha). **No tiene enlace con `?action=` hoy.**
- «Nueva propiedad»: abre el asistente compartido que está montado en `app.html` (fuera de la ficha), con el contexto de la finca.
- No hay condiciones de rol ni de estado más allá de la de «Puesta en marcha». Se quedan en la cabecera: foto, nombre, estado («En puesta en marcha»/«Activa»), dirección y el enlace «Volver».

**Cómo se dispara una acción desde fuera:** la ficha entiende `?action=` con tres valores: `edit-estate`, `add-property` y `new-issue` (esta solo en incidencias). **No existen `import-catastro` ni `open-setup`.** El parámetro `action` no se borra de la URL tras usarlo y la lectura se repite en cada navegación (riesgo de que reabra el modal; sin verificar).

**Avance de puesta en marcha de todas las fincas:** ya existe `GET /estates/setup-summary` y `EstatesService.getSetupSummary()` (hoy no lo usa ninguna pantalla): permite pintar el número «(N)» de cada finca en el listado sin backend nuevo.

**Enlace «Volver a todas las fincas» — causa encontrada:** el enlace está bien escrito (`routerLink="/b/estates"`). El fallo es que la ruta `/b/estates` lleva el guard `communityScopeRedirect`, que, si hay una comunidad elegida en el ámbito (`CommunityScopeService`), redirige a su ficha; y entrar en una ficha ya fija esa comunidad como elegida. Resultado: el enlace te devuelve a la misma ficha. El selector de la cabecera sí lo hace bien (`viewAll()` hace `scope.select(null)` antes de navegar). Pendiente de reproducir en navegador (el intento de hoy se frenó por el límite de intentos de login).

## Consecuencia que condiciona el diseño

Con una comunidad elegida (que es lo normal tras abrir una ficha), `/b/estates` redirige a su ficha: **el listado, y con él su menú «Acciones», no se ve**. Si se quitan los cuatro botones de la ficha y solo viven en el listado, para editar la finca en la que ya estás habría que volver a «Todas», abrir el listado y usar su menú. Por eso la duda 1.

## Decisiones (L3)

- **D1 Botón único en la ficha, diseñado por un especialista UX/UI.** En la cabecera de la ficha los cuatro botones se sustituyen por UN botón «Acciones» que abre el mismo menú que el listado. El usuario pidió que el diseño lo haga un sub-agente especialista en UX y UI para que se vea premium, accesible y sin romper la estética: su especificación está en «Diseño del menú» más abajo.
- **D2 Las cuatro acciones pasan al menú:** Puesta en marcha, Editar, Importar del Catastro y Nueva propiedad. «Ver finca →» sigue siendo el enlace principal de la fila.
- **D3 Orden y mecanismo (aprobado):** Puesta en marcha (solo si faltan pasos, con el número), Editar finca, Importar del Catastro, Nueva propiedad. Desde el listado, Puesta en marcha, Editar e Importar navegan a la ficha con `?action=` (`open-setup`, `edit-estate`, `import-catastro`) y la ficha abre el panel o el modal; «Nueva propiedad» abre el asistente directamente desde el listado con el contexto de esa finca. Los modales no se mueven a componentes compartidos.
- **D4 Vista de tarjetas:** botón «⋯» en cada tarjeta, fuera del enlace de la tarjeta.
- **D5 Columna:** «Acción» pasa a «Acciones».
- **D6 Indicador de pendientes** en el botón «⋯» del listado, con los datos de `GET /estates/setup-summary` cargados una vez al abrir el listado (sin backend nuevo).
- **D7 Enlace «Volver a todas las fincas»:** se arregla dejando sin comunidad elegida (`scope.select(null)`) antes de navegar a `/b/estates`, como ya hace `viewAll()` del selector; se comprueba el mismo patrón en Contabilidad. Primero se reproduce con un test que falla.
- **D8 `?action=`:** tras usarlo se borra de la URL (sin añadir historial) para que no se reabra el modal.
- **Alcance:** no se toca la barra superior ni el menú lateral.

## Diseño del menú (especialista UX/UI, L3)

Un único componente compartido (`estate-actions-menu`: botón + panel + teclado + posicionamiento) con tres variantes de botón.

**Botón de la ficha.** `[icono settings] Acciones [chevron-down]`, variante `outline` (no verde: «Nueva propiedad» deja de ser el CTA principal), altura mínima 40 px, padding 8×14, radio `--radius-md`. Hover: fondo `--color-surface-hover` y borde mezclado con el acento; `focus-visible`: contorno de 2 px con `--color-accent` y desfase 3 px; abierto (`aria-expanded`): borde `--color-accent` y chevron girado 180° en 150 ms (sin transición con `prefers-reduced-motion`). El contador de pasos pendientes es una píldora de 18 px (la actual `.setup-entry__badge`) entre la etiqueta y el chevron, solo si hay pendientes. En móvil (≤640 px) ocupa todo el ancho con 44 px de alto.

**Botón del listado.** Solo icono `ellipsis` de 18 px: 36×36 con puntero fino y 44×44 en táctil y móvil; color `--color-muted`, hover/abierto con `--color-text`, fondo `--color-surface-hover` y borde. Punto de 8 px `--color-warning` en la esquina (con halo del color de la superficie) si hay pasos pendientes. En la tabla va a la derecha de «Ver finca →» en un contenedor `row-actions` (columna fija de unos 160 px, el «⋯» siempre alineado a la derecha). En la tarjeta: estructura hermana (la tarjeta pasa de ser un `<a>` a un `<article>` con un enlace interno «estirado» con `::after` y el botón en la esquina superior izquierda de la imagen, con fondo translúcido y desenfoque para leerse sobre cualquier foto; el contador de incidencias ocupa la derecha).

**Panel.** 264 px de ancho (máx. `100vw − 16px`), padding 6 px, radio `--radius-lg` con elementos de `--radius-md`; fondo `--color-surface`, borde 1 px `--color-border`. Sombra nueva `--shadow-popover` (la actual `--shadow-lg` casi no se ve en oscuro) definida en los bloques oscuro y claro. Elementos de 40 px (44–48 px en móvil) con rejilla icono · texto · chip; el icono va en un recuadro de 28×28 que pasa al acento en hover o foco. Descripción de una línea solo en dos elementos: «Puesta en marcha» («Completa los pasos pendientes») e «Importar del Catastro» («Trae propiedades desde datos catastrales»). «Puesta en marcha» va aparte (separador) y destacada cuando hay pendientes: fondo del color de aviso al 10 %, icono y borde izquierdo de 2 px en `--color-warning`, más el chip con el número (la señal no depende solo del color). «Nueva propiedad» con el icono `plus` en verde y texto en peso 600. Estados: hover con `--color-surface-hover`; foco con contorno visible de 2 px (no se elimina); deshabilitado con `aria-disabled`. Entrada de 120 ms (opacidad y ligero desplazamiento), sin animación con `prefers-reduced-motion`. Altura máxima `min(420px, 100dvh − 16px)` con desplazamiento. `z-index` 400 (por encima de barra superior y menú lateral, por debajo del menú de cuenta); se cierra antes de abrir un diálogo.

**Colocación.** Panel con `position: fixed` (o portal a `document.body`) calculado con el rectángulo del botón, porque la tabla del listado tiene `overflow-x: auto` y la tarjeta `overflow: hidden`, que recortarían un menú absoluto. Se abre debajo, alineado a la derecha del botón; si no cabe, hacia arriba (con la altura real medida) y con ajuste horizontal a los bordes. En móvil (≤640 px): hoja inferior con fondo oscurecido que cierra al tocar, asa visual, título «Acciones de {finca}», relleno inferior con `env(safe-area-inset-bottom)` y elementos de 48 px; sin desplazar el cuerpo. Desde tablet hacia arriba, ventana emergente.

**Accesibilidad.** Botón con `aria-haspopup="menu"`, `aria-expanded` y `aria-controls` (identificador único por finca); panel `role="menu"` con `role="menuitem"` y separadores con `role="separator"`. Teclado: Enter, Espacio y flecha abajo abren y enfocan el primero; flecha arriba abre y enfoca el último; flechas con vuelta, Inicio y Fin; Escape cierra y devuelve el foco al botón; Tab cierra sin atrapar el foco. Nombre accesible en el listado: «Acciones de {finca}» (con «, 3 pasos pendientes» si procede); el elemento de puesta en marcha lleva «Puesta en marcha, 3 pasos pendientes» (singular: «1 paso pendiente») y el chip visible es decorativo. Tras elegir una opción el menú se cierra; si abre un modal, éste devuelve el foco al botón al cerrarse. Objetivos táctiles de 44 px. Contraste: **en tema claro el texto oscuro sobre el color de aviso no llega a 4,5:1**, así que el chip usa fondo `--color-warning-bg` con texto `--color-warning` y borde `--color-warning-border` (o texto blanco sobre el aviso), y se mide en ambos temas. `forced-colors`: borde `CanvasText` en el panel, foco `Highlight`, y el punto de pendientes con borde para que no desaparezca.

**Microcopia.** «Acciones» (botón); «Acciones de {finca}» (listado); «Puesta en marcha», «Editar finca» (antes «Editar»), «Importar del Catastro», «Nueva propiedad», de más a menos urgente y de menor a mayor compromiso.

**Riesgos del repositorio a vigilar.** El menú de la tabla de contratos no tiene Inicio/Fin, ni `aria-expanded`, ni devuelve el foco (se puede extraer más adelante una lógica común, no forma parte de este plan); `window:resize` cierra el menú y en móvil el teclado virtual lo dispara (ignorar cambios de solo alto en la hoja inferior); un solo menú abierto a la vez en el listado; hay que sobrescribir el `outline-offset` global de los botones; no dejar CSS muerto de `.estate-tools`, `.estate-header__actions` y `.setup-entry__badge`.

## Plan de unidades (orden de ejecución)

Cada unidad con tests, commit y entrada en el Log; sin push. M0 y M1 son independientes del diseño.

| Orden | ID | Unidad | Decisiones |
|---|---|---|---|
| 1 | M0 | Reproducir el fallo de «Volver a todas las fincas» en navegador y con un test que falle (RED); arreglarlo con `scope.select(null)` antes de navegar; revisar el mismo patrón en Contabilidad | D7 |
| 2 | M1 | Ficha: entender `?action=import-catastro` y `?action=open-setup` y borrar `action` de la URL tras usarlo (sin añadir historial) | D3, D8 |
| 3 | M2 | Variable `--shadow-popover` (oscuro y claro) y componente compartido `estate-actions-menu`: tres variantes de botón (ficha, fila, tarjeta), panel emergente y hoja inferior en móvil, teclado y foco completos, contador y descripciones, contraste medido (chip en tema claro), `prefers-reduced-motion`, `forced-colors`; spec exhaustivo | D1, D2, D3 |
| 4 | M3 | Listado: columna «Acciones» con «Ver finca →» y «⋯» (tabla); tarjeta con estructura hermana y «⋯» (vista de tarjetas); indicador de pendientes con `setup-summary`; acciones que navegan con `?action=` o abren el asistente; spec nuevo de `estate-overview-views` | D2–D6 |
| 5 | M4 | Ficha: quitar los cuatro botones y poner el botón «Acciones» con el mismo menú; limpiar estilos y salidas que sobren; se mantienen foto, nombre, estado, dirección y «Volver» | D1 |
| 6 | M5 | Cierre: verificación en navegador (oscuro, claro, tablet y móvil) del flujo completo (listado → «⋯» → cada acción; ficha → «Acciones»; «Volver» desde varias entradas), revisión de accesibilidad (teclado, foco, contrastes), e2e, specs actualizados (`estate-header`, `estate-detail`, `dashboard-b`), documentación y Risk line | — |

Notas: (1) no se toca la barra superior ni el menú lateral; (2) paleta y componentes de la aplicación; (3) sin backend nuevo; (4) los specs de `estate-header` y de `estate-detail` que buscan «Puesta en marcha», `.estate-header__actions` y «Catastro» se actualizan al mover los botones.

## Log

- L1 (2026-10-20): petición original (arriba, verbatim).
- L2 (2026-10-20): investigación con un explorador de solo lectura y comprobación de la causa del enlace roto en el guard `communityScopeRedirect` y en `CommunityScopeService`. Plan y dudas redactados. No se ha tocado código.
- L3 (2026-10-20): el usuario aprueba el plan. Verbatim: "1. Si, manten accesible pero hazlo a través de un sub-agente especialista en UX y UI  para que el botón se encuentre bien diseñado y accesible sin romper la estetica de la aplicación. Quiero que el resultado se vea premium. 2. Si, las cuatro 3. Correcto". Se encarga el diseño a un sub-agente especialista en UX/UI (solo lectura, sin tocar el repositorio) y se incorpora su especificación al plan; se cierran las dudas (D1–D8) y se reescribe el plan de unidades.
- L4 (2026-10-20): plan aplicado completo, un commit por unidad, sin push. M0 db69c08 (enlace «Volver»: `clearScope()` antes de navegar; Contabilidad ya lo hacía), M1 b04265b (`?action=import-catastro|open-setup` y borrado del parámetro con `replaceUrl`), M2 7a77a9e (componente compartido `estate-actions-menu` + `--shadow-popover`), M3 7357b03 y M4 ab1ff02 (listado y ficha), 6a9a3b7 (el scroll con el botón a la vista no cierra el menú: lo detectó el e2e en móvil, el foco provocaba un scroll de la tabla), tipado del mapa de pendientes. Verificación: frontend 2622/2622 (un «Unhandled Rejection» NG0205 en los specs de `layout`, que no se tocaron), `ng build` sin avisos nuevos, e2e de fincas en chromium, mobile-chrome y mobile-safari, navegador con capturas en oscuro, claro, tarjetas, última fila (el panel se abre hacia arriba) y móvil (hoja inferior). Los pasos pendientes se comprobaron simulando la respuesta de `setup-summary` porque las 10 fincas demo están completas.
- Risk: item 3 acotado (los botones de la cabecera y la columna «Acción» cambian de sitio y de nombre, sin tocar API ni contratos; `?action=` solo se amplía).
