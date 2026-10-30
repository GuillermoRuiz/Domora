# Workflow de incidencias: expediente, trabajo humano y esperas

> **Incidencias es un módulo 100 % manual.** No hay clasificación con IA, detección de duplicados, sugerencia de vía, contacto
> automático con proveedores, correos automáticos ni estados de «automatización». Crear o actualizar una incidencia nunca crea
> un `AiJob` ni ningún otro artefacto de automatización. La IA de la plataforma sigue existiendo, pero solo en
> Contabilidad (facturas y conciliación), Juntas (redacción del acta) y el Asistente (resumen semanal); ver `docs/ai/`.
> La migración `20261106110000_remove_incident_automation` retiró las tablas `ai_incidents`, `ai_messages`, `automation_rules`,
> `ai_policies` y `administrator_features`, y la columna `ai_jobs.issue_id`.
> Pendiente: ejecución de presupuestos (`approve_quote` solo tiene esquema).

## Reparto de responsabilidades

| Pregunta | Fuente de verdad | Quién la escribe |
|---|---|---|
| ¿Qué es el problema y en qué punto del ciclo está? | `Issue` (+ `Issue.status`) | gestión |
| ¿Qué tiene que hacer una **persona**? | `AgendaTask` con `issueId` y `kind` | Domora (abre) · persona (resuelve) |
| ¿A quién espera el expediente **fuera** de Domora? | `IssueWait` · `SupplierVisit` planificada | `IssueWorkflowService` · proveedores |
| ¿Qué ocurrió y quién lo hizo? | `IssueTimelineEntry` (`kind`, `actorKind`, `refType/refId`) | `issueEventData` / `IssueEventsService` |
| ¿De dónde llegó el aviso? | `IssueReport` (canal, referencia, contenido original) | `IssuesService.create` |
| Cosas concretas | `SupplierVisit`, `IssueProviderAssignment`, `InsuranceClaim`… | sus servicios |

**La agenda es trabajo humano.** Las esperas y los seguimientos no son tareas: una acción instantánea deja un evento; una
espera es un `IssueWait`; un seguimiento programado es el `dueAt` de una espera, que atiende el barrido de incidencias
(`IssueWorkflowSweepService`) abriendo una tarea para una persona.

## Situación y siguiente paso (proyecciones, no datos)

`IssueSituationService` deriva, sin guardar nada en la incidencia:

1. `Resuelta` o `Cerrada` → `completed`, SIEMPRE y con la pelota en `nobody` (ver «Liquidación»): la proyección no esconde
   trabajo —la liquidación ya lo retiró de verdad—, es la última capa.
2. `AgendaTask` que pide una decisión ahora (`PENDIENTE`/`EN_CURSO`) con ese `issueId` → `requires_attention` (**Requiere atención**)
3. `IssueWait` abierta o `SupplierVisit` planificada **que aún no venció** → `waiting_third_party` (**Esperando tercero**).
   Una visita vence cuando pasa su hora más `ISSUE_VISIT_GRACE_MINUTES` (120, lo que dura la visita): desde entonces ya
   no es una espera al proveedor y el barrido abre una tarea humana (ver «Visitas»).
4. nada de lo anterior → `no_pending_action` (**Sin acción pendiente**) — salvo que el expediente siga abierto, sin
   tarea, espera ni visita y sin actividad desde hace más de `ISSUE_STALLED_GRACE_MINUTES` (240, 4 h): entonces es
   `stalled` (**Sin siguiente paso**) y el barrido abre `review_issue` con motivo `no_next_step`.

**Tarea «en espera» (`EN_ESPERA`).** Una persona la miró y espera algo: no pide una decisión ahora (no es `requires_attention`),
pero SIGUE SIENDO trabajo humano vivo. Hay una sola regla para «hay una tarea» (`isTaskOperationallyActive` en
`agenda-task.constants.ts`: no terminal) que leen la carga de hechos de la proyección, `hasNextStep`, `settleEntryReview` y el
barrido; lo que pide atención ahora es un subconjunto (`taskNeedsAttention`: `PENDIENTE`/`EN_CURSO`). Con solo una tarea aparcada
la incidencia es `no_pending_action`, **nunca `stalled`** (el barrido no abre `no_next_step`), y la pelota (`ballInCourt`) la tiene
la administración **solo si nadie más la tiene** (una espera, una visita o Domora mandan sobre ella). Completada o cancelada
(también `superseded`) deja de contar.

**`ballInCourt`** (proyección, tampoco se guarda): quién tiene que mover ficha — `administration` (tarea humana),
`provider`, `insurer`, `owner`, `other` (esperas por `IssueWait.party`; la aseguradora es una
`WaitParty`, la administración nunca) o `nobody`. Si hay varias esperas, `primary` + `others`.
El **siguiente paso** sigue la misma precedencia: tarea humana (con enlace `/b/tasks?task=<id>`) →
espera/visita → nada. No existe ningún campo `nextAction`.

## Tareas humanas (`AgendaTask`)

Columnas añadidas: `issueId`, `kind`, `payload`, `outcome`, `resultRef`, `createdByKind` (`person|ai|system`) y
`createdByUserId` pasa a ser opcional. Cada `kind` tiene **tres esquemas** (clases `class-validator`,
`issue-workflow/task-kinds/task-kind.dtos.ts`): `payload` (al abrir), resolución (lo que envía la persona) y
`resultRef` (lo ejecutado). Se rechazan los campos no declarados.

| `kind` | Se abre cuando | Resolución |
|---|---|---|
| `chase_provider` | vence el plazo de una espera sin respuesta | `wait_more` · `contacted` · `dismiss` |
| `review_issue` | incidencia nueva (`new_issue`), novedad manual (`manual_review`), el solicitante añadió una nota (`requester_update`, ver «Experiencia del solicitante»), la vía «Administrador» (`direct_management`), el proveedor de la comunidad como vía (`contact_provider`), el seguro (`open_insurance_claim`), la visita ya ocurrió (`after_visit`), un seguimiento que una persona fijó (`follow_up`) o no hay siguiente paso (`no_next_step`) | `choose_route` · `schedule_follow_up` · `mark_resolved` · `next_step_exists` (y `done`, equivalente al último); rechazada con 409 si deja la incidencia sin siguiente paso — ver «Revisión de arquitectura» |
| `inform_requester` | propone avisar al solicitante con una plantilla de hechos (visita programada, **incidencia resuelta**) | `send` · `dismiss` |
| `approve_quote` | *(solo esquema; se resolverá en su fase)* | 501 hasta entonces |

Una tarea de decisión (con `kind`) **no se completa, cancela ni reabre a mano**: se RESUELVE con `POST /agenda/tasks/:id/resolution` (`{ "result": { … } }`)
(o, para soporte, desde su incidencia) y, como consecuencia, queda técnicamente en `COMPLETADA` o `CANCELADA` con su `outcome`. El botón genérico «completar» y el
borrado de una abierta se rechazan; una ya resuelta no se modifica («Esta decisión ya está resuelta y no puede modificarse»).

### Principios de seguridad

- **Todo lo decide una persona.** Elegir la vía, contactar a un tercero, abrir un siniestro, programar una visita, avisar al
  solicitante y resolver o cerrar son acciones de la gestión; el sistema solo proyecta la situación y abre tareas humanas.
- **Un propietario solo opera sobre SUS incidencias.** El JWT del rol C lleva fincas, no propiedades: comprobar solo la finca
  dejaba leer, escribir notas (que abren trabajo a la gestión) y crear incidencias en las de un vecino. Lectura, detalle, listado
  (también el total), historial/notas, fotos (ver y subir), alta y avisos pasan por `PropertyAccessService` (titular que creó la
  propiedad o membresía vinculada y no revocada; el mismo criterio para los listados con `ownedPropertiesWhere`). Una incidencia
  o propiedad ajena responde 404 idéntico al de una inexistente: no se revela que existe. La gestión (A y B) sigue por finca.
  Pruebas: `issues-owner-access.http.integration.spec.ts`.
- **Visibilidad al propietario por lista blanca** (`REQUESTER_VISIBLE_EVENT_KINDS`): los eventos nuevos son internos por
  defecto; `meta` no se expone y `resolutionRoute` tampoco.

## Sin IA en Incidencias

Incidencias no usa IA ni entitlement de producto: el módulo funciona igual para todas las gestoras, a mano. No existe
`incident_ai`, ni `FeatureEntitlementService`, ni la tabla `administrator_features` (ver `docs/entitlements.md`). La
infraestructura de IA (`AiJob`, `AiRequest`, `AiBatch`, `AiAudit`, worker, región, privacidad) es compartida por Contabilidad,
Juntas y el Asistente, y ya no conoce las incidencias.

## Pantalla de Incidencias (frontend)

La pantalla gestiona **expedientes, no tareas** y consume las proyecciones de arriba sin duplicar estado:

- **Lista**: por fila, qué incidencia es, inmueble, origen, antigüedad, situación, quién tiene la pelota (con «+N» si hay
  varias esperas) y siguiente paso con su plazo. Filtros de trabajo: Todas · Requieren atención (`requires_attention` +
  `stalled`) · Esperando tercero · Resueltas. **El agrupamiento vive solo en el backend** (`ISSUE_SITUATION_FILTERS` en
  `issue-situation.ts`): el listado se filtra con `GET /estates/:id/issues?situation=attention|waiting|resolved`
  (misma proyección que el detalle y el resumen; se pagina sobre el resultado; sin el parámetro responde exactamente igual
  que siempre; solo gestión) y los recuentos llegan agrupados en `situation-summary.filters`. El frontend solo les pone
  nombre. Coste: la situación se calcula por incidencia, así que filtrar
  recorre las de la finca (como el resumen); si una comunidad llega a miles habrá que cachearlo.
- **Detalle**, en bloques apilados: cabecera → **Situación actual** (quién tiene la pelota, qué ocurre, qué pasará, cuándo toca
  actuar) → acciones («Registrar gestión», «Informar al solicitante») → **Vía de gestión** → **Expediente** → **Historial**.
- **Intervención humana**: si hay una `AgendaTask` abierta, solo un aviso compacto con «Abrir tarea», que enlaza a Tareas
  (`/b/tasks?task=<id>`). Las decisiones (confirmar el resultado de una visita, reclamar a un tercero, informar al solicitante…) se
  toman en el panel «Decisión pendiente» del cajón de Tareas (`POST /agenda/tasks/:id/resolution`). Una tarea de decisión
  no se completa, cancela ni reabre a mano: solo se decide.
- **Registrar gestión** traduce frases de administrador («esperamos su respuesta», «hay una visita programada», «fijar la
  vía»…) a `POST /issues/:id/interactions` (los efectos tipados no se enseñan). **Informar al solicitante** es una gestión sin
  contraparte con el efecto `inform_requester`, solo a quien reportó (`reporterUserId`). Antes de enviar se ve el **texto
  exacto**: `POST /issues/:id/requester-notices/preview` (mismo `renderRequesterMessage` y mismas comprobaciones que el
  envío; no envía ni crea eventos) y el botón solo se activa con ese texto a la vista; lo enviado es el mismo texto y queda
  en el historial. Lo mismo vale si se marca «informar» dentro de «Registrar gestión».
- **Historial**: una sola cronología; se omite la maquinaria (tareas internas, envío en curso) y nunca se muestran ids,
  metadatos técnicos ni restos de procesos internos.
- Código: `src/app/features/issues/`, `src/app/core/issue-workflow.*`, `src/app/core/issue-interaction.builder.ts`.

## Vía de gestión y registro de interacciones

- `Issue.resolutionRoute` (nullable): `community_provider | community_insurance | owner_insurance | direct_management`, validada por código (`resolution-routes.ts`). La decide siempre una persona
  (`PUT /issues/:id/resolution-route`, evento `route_decided`).
- **La vía es AUTORITATIVA** (`route-compatibility.ts` es la única tabla; `IssueWorkflowService.decideRoute` la aplica):
  - Cada vía activa UNA rama: `community_provider` → proveedor de la comunidad; `community_insurance` → seguro de la comunidad
    (y el profesional que envía la aseguradora); `owner_insurance` → propietario;
    `direct_management` → ninguna. Sin vía (`null`) ninguna rama está activa.
  - **Cambio de vía** (`reconcileRouteChange`, bajo el bloqueo de la incidencia): se invalida lo que pertenece a una rama que la
    vía nueva no activa y nada se borra. Esperas de la rama anterior → `superseded`, con sus tareas de reclamar; tareas de las otras
    ramas (abrir siniestro, pedir al propietario, siniestro rechazado…). Los siniestros (nunca se cierran en silencio) y el
    profesional enviado por la aseguradora (si la vía nueva es la del seguro) no se tocan. Volver a «sin decidir» no cierra
    ninguna espera: siguen y su vencimiento abre tarea.
  - **Tarea de entrada** («Revisar incidencia nueva»): se sustituye cuando una persona ha actuado (vía decidida o cualquier
    gestión registrada) **y** la incidencia queda con un siguiente paso real (una espera, una visita u otra
    tarea concreta); si cerrarla dejara la incidencia sin pelota, se mantiene (`settleEntryReview`).
- La aseguradora es un `Supplier` de categoría «Seguros»; la póliza, un `SupplierContract`; el siniestro, un
  `InsuranceClaim` (ver «Siniestro de seguro»).
- `POST /issues/:id/interactions` (`IssueInteractionsService.register`) es la **única** operación para dejar constancia de
  una comunicación manual/externa (llamada, WhatsApp, email, presencial) y sus consecuencias. Los efectos son una lista
  cerrada y tipada, cada uno con su esquema estricto: `end_wait`, `start_wait`, `schedule_visit`, `open_follow_up`,
  `set_resolution_route`, `inform_requester`, `resolve_issue`, `open_claim`, `update_claim`, `assign_provider`. El servidor valida estado, permisos y pertenencia a la
  comunidad y lo aplica **en una transacción** (todo o nada). Un LLM solo podría proponer efectos; nunca los ejecuta.
- Avisar al solicitante: solo a `reporterUserId`, con plantillas de hechos (`requester-messages.ts`); el texto exacto y la
  hora quedan en el historial (`requester_informed`). El aviso lo envía siempre una persona.

## Siniestro de seguro (`InsuranceClaim`)

Funcionalidad de Incidencias, toda manual. El siniestro describe
SOLO el expediente del seguro; no guarda próxima actuación, visitas, profesional, llamadas ni tareas, que ya tienen su
entidad: trabajo humano = `AgendaTask`, espera a la aseguradora = `IssueWait` (`party=insurer`, `refType=insurance_claim`,
`refId`=siniestro), profesional enviado = `IssueProviderAssignment.claimId`, visita = `SupplierVisit`, comunicaciones =
historial.

- **Modelo**: `issueId`, `insurerSupplierId?` (aseguradora del directorio; un seguro privado del propietario no está en él),
  `insurerName` (congelado), `contractId?` + `policyNumber?` (congelado), `reference?` (nº de siniestro; aún no existe al
  abrirlo), `status`, `openedAt/openedByKind/openedByUserId`, `contactName?/contactPhone?` (el tramitador de ESTE siniestro),
  `closedAt?`. Una incidencia puede tener varios, también de la misma aseguradora.
- **Estados** (`insurance-claims.ts`): `open` · `under_assessment` · `accepted` · `rejected` · `withdrawn` · `closed`. Solo
  `withdrawn` y `closed` son terminales (`closedAt`). `rejected` NO lo es: puede pasar a `under_assessment`, `accepted`,
  `closed` o `withdrawn` sobre el mismo expediente y número. Cerrar el siniestro no cierra la incidencia. La **etapa** visible
  (esperando a la aseguradora, esperando profesional, profesional asignado…) se deriva (`claimStage`), no se guarda.
- **Reglas del servidor** (`InsuranceClaimsService`, una sola operación para efectos y `PATCH`): `rejected` cierra las esperas del
  siniestro (cumplidas) y abre la tarea `review_issue` / `claim_rejected`; reconsiderarlo la sustituye; un estado terminal cierra
  las esperas y fija `closedAt`; un terminal ya no cambia. Todo cambio queda en el historial (`claim_opened`, `claim_updated`,
  `provider_assigned`; internos: no los ve el solicitante).
- **Varios siniestros**: con varios vivos, toda operación ambigua (`update_claim`, `assign_provider` por la aseguradora, `start_wait`
  `insurer_reply`) exige `claimId`: nunca se infiere. Con uno solo (o el creado antes en la misma interacción) se usa ese.
- **Referencia única** por (incidencia, aseguradora, referencia): la identidad de la aseguradora es su proveedor del directorio o,
  si no lo hay, su nombre normalizado, así que dos aseguradoras pueden repetir número. Valida el servicio bajo el bloqueo de la
  incidencia (409 claro) y respalda un índice único parcial en la migración.
- **Tarea al decidir la vía**: `community_insurance` abre «Llamar al seguro de la comunidad» (`review_issue` /
  `open_insurance_claim`), que resuelve `open_claim`; `owner_insurance` abre «Solicitar al propietario que tramite el
  siniestro» (`ask_owner_file_claim`), que se resuelve al esperar al propietario o al abrir el siniestro. Cambiar o quitar la vía
  cancela la que ya no corresponde; con un siniestro vivo no se pide otro. Regla: una decisión humana pendiente, una tarea:
  al decidir una vía de seguro, la tarea de entrada «Revisar incidencia nueva» (`new_issue` / `ai_disabled` /
  `ai_unavailable`), cuya decisión era justo esa vía, queda resuelta y queda UNA sola tarea abierta. No se crea ningún
  seguimiento hasta que exista una espera y venza su plazo.
- **Asignar el proveedor es una sola operación** (`IssueWorkflowService.assignProvider`), la use «Editar proveedor»
  (`POST /issues/:id/provider`) o el efecto `assign_provider`: con un proveedor del directorio exige que sea **activo y de esta
  comunidad** (400 si no) y el snapshot sale de su ficha; cierra la asignación vigente y crea la nueva; deja el evento
  `provider_assigned` («Proveedor cambiado: de X a Y» si cambia, con la anterior en `meta.previous`); una persona que asigna al
  proveedor de la comunidad (no el que envía la aseguradora, que lleva `claimId`) **resuelve la tarea «Asignar proveedor»**
  (`review_issue` / `missing_provider`) y, si queda un siguiente paso real, sustituye la revisión de entrada. Asignar es
  contexto: **no contacta, no espera, no envía y no decide la vía**; no toca el siniestro.
  «Editar proveedor» deja elegir un proveedor del directorio (se conserva su ficha: `supplierId`, y de ella salen el nombre y la
  categoría) o escribir solo un nombre (`supplierId` nulo). Conservar la ficha mantiene la asignación y el historial del proveedor coherentes. La fecha estimada es un control de fecha (`AAAA-MM-DD`); si el servidor rechaza algo, el
  error se enseña en el propio modal.
  **Cambiar de proveedor retira lo del anterior** (`reconcileProviderChange`, una sola vez, bajo el bloqueo de la incidencia): sus
  mensajes sin enviar (`draft`/`ready`/`failed` → `discarded`, con su envío pendiente y la tarea de aprobarlos o revisarlos), el contacto
  que la rama aún no había hecho, y sus esperas (`superseded`) con su tarea de reclamar y sus recordatorios sin enviar. Lo ocurrido
  (enviados, respuestas, visitas) queda, y no se hace nada hacia el nuevo: ni se le escribe, ni se abre una espera, ni se decide la
  vía. Si el correo al anterior ya estaba saliendo, sale (historial) pero no se abre una espera a quien ya no es el vigente. El
  profesional que envía una aseguradora (`claimId`) es de la rama del seguro y no dispara esta reconciliación.
- **Una sola intención de contacto con el proveedor.** Registrar una comunicación **saliente** con un proveedor
  (`party: provider`, `direction: outbound`) retira lo que Domora tenía preparado para ESE proveedor y aún no salió: el mensaje
  `draft`/`ready`/`failed` (un recordatorio incluido) pasa a `discarded` (evento `message_discarded`, `reason: manual_contact`),
  se cancela su envío pendiente y se retira la tarea de aprobarlo o de revisar su envío fallido (el proveedor se reconoce por su
  ficha o, si solo se escribió el nombre, por el nombre; otro proveedor, o una llamada entrante, no cuentan). Lo ya enviado, saliendo
  o de resultado incierto es historial y no se toca; un contacto POSTERIOR a uno enviado es otro paso legítimo. A la inversa, si el
  contacto manual llegó primero (también antes de elegir la vía), la rama del proveedor —aunque su resultado llegue tarde— no
  prepara otro (nota interna `reason: manual_contact`); y si el correo ya estaba saliendo, no se abre una segunda espera al mismo
  proveedor. Todo bajo el bloqueo de la incidencia (el reclamo de `send` relee también la asignación con él).
- **Profesional externo**: `assign_provider` acepta un proveedor del directorio o solo un nombre (snapshot en
  `IssueProviderAssignment`; no se da de alta ningún `Supplier`). `SupplierVisit.supplierId` es opcional: la visita de un
  profesional externo lleva `assignmentId` (exactamente uno de los dos, CHECK) y su nombre/teléfono salen del snapshot de la
  asignación. `schedule_visit` sin `supplierId` usa la asignación vigente.
- **Sin automatización**: nada contacta ni selecciona un proveedor o la aseguradora por su cuenta. Una espera a la aseguradora vencida abre una tarea humana.
- **API**: `GET /issues/:id/insurance-claims` (solo gestión: etapa derivada, profesional, espera) y
  `PATCH /issues/:id/insurance-claims/:claimId` (correcciones y estado fuera de una comunicación). Crear siempre nace de una
  comunicación (`open_claim`). `open_claim`, `update_claim` y `assign_provider` van en `POST /issues/:id/interactions`.
- **UI**: bloque «Seguro» dentro del detalle (con vía de seguro o algún siniestro): aseguradora, póliza, nº de siniestro, etapa,
  profesional y el estado; «Registrar gestión con el seguro» / «Abrir siniestro» abren el mismo diálogo de siempre con sección
  «Siniestro de seguro». Sin conceptos técnicos.
- **Fuera por ahora**: llamadas/emails automáticos al seguro, gasto/franquicia/indemnización, documentos del siniestro, el perito
  como entidad (su visita es una espera a la aseguradora con plazo), reabrir un terminal, que el propietario vea el siniestro.

## Visitas (`SupplierVisit`)

Ciclo: `planificada` → `realizada` | `cancelada` (los dos finales; no hay un estado «no realizada»: una visita que no llegó a
hacerse es una cancelada con su nota, y si hace falta otra se programa una nueva).

- **Una sola operación cierra una visita**: `IssueWorkflowService.recordVisitOutcome`, por visita + incidencia, **nunca por
  `supplierId`**: vale para un proveedor del directorio, un profesional asignado (`IssueProviderAssignment`), uno enviado por
  la aseguradora y uno solo con nombre. La usan `PATCH /issues/:id/visits/:visitId` (`{ outcome: 'completed' | 'cancelled',
  notes? }`; `GET /issues/:id/visits` las lista), la tarea `confirm_visit_outcome` y el panel del proveedor (para visitas ligadas a
  una incidencia). Deja el evento `visit_completed` / `visit_cancelled` y resuelve la tarea de confirmar.
- **Visita vencida**: pasada su hora (más el margen), el barrido (`processOverdueVisits`) abre UNA tarea
  `confirm_visit_outcome` por visita (idempotente) y la pelota la tiene la administración. Nunca se queda el proveedor con ella
  indefinidamente.
- **Realizada ≠ resuelta**: si tras registrar el resultado no queda ningún siguiente paso (otra tarea, espera, visita o trabajo
  de Domora), se abre UNA tarea `review_issue` / `after_visit` («Decidir cómo sigue la incidencia tras la visita»). Nada se
  resuelve solo.
- **Las visitas se manejan desde la propia incidencia** (bloque «Visitas», `GET/PATCH /issues/:id/visits…`), para el proveedor del
  directorio, el profesional asignado, el que envía la aseguradora y el que solo tiene nombre: dar el resultado, **cancelar una visita
  futura** (`outcome: cancelled`) y **cambiarle la hora** (`PATCH /issues/:id/visits/:visitId/reschedule`, `IssueWorkflowService.rescheduleVisit`,
  la misma operación que usa el panel del proveedor para una visita ligada a una incidencia). Todo bajo el bloqueo de la incidencia (contra
  el cierre y contra el resultado: el que llega después ve el estado ya decidido). Reprogramar deja `visit_rescheduled` (interno) y exige
  una hora futura y una visita aún planificada. Un resultado (realizada o cancelada) retira la tarea «Informar al solicitante» que
  hablaba de esa visita; reprogramar retira la de la hora anterior y, si ya se le había dicho esa hora (o había un aviso pendiente), da la
  nueva con la plantilla `visit_scheduled` —sola con autonomía ≥ 2, o como UNA tarea con el texto a la vista—; una visita que nadie
  comunicó no inventa un aviso. No hay plantilla de «visita cancelada»: lo ya enviado no se corrige.
- Una cita ya pasada no es una visita planificada: `registerVisit` la rechaza; el modelo no ofrece confirmarla con un clic
  (la lee una persona) y confirmar una propuesta que ya pasó se rechaza.

## Respuestas del proveedor

No hay correo entrante ni interpretación automática: cuando un proveedor responde (teléfono, WhatsApp, correo leído por una
persona), la gestión lo registra con «Registrar gestión» (`end_wait` + el siguiente paso). Terminar la espera retira su
seguimiento; las respuestas se guardan como comunicaciones en el historial.

## Liquidación: qué significa «Resuelta» / «Cerrada»

`IssueWorkflowService.settleIssueLifecycle` es el ÚNICO sitio (lo llama `applyStatusInTx`, que usan `PATCH …/status` y el efecto
`resolve_issue`, bajo el bloqueo de la incidencia). Nada se borra:

| Objeto | Al liquidar |
|---|---|
| `IssueWait` abiertas | `superseded` |
| `AgendaTask` de decisión abiertas (con `kind`) | canceladas `superseded`; las tareas manuales de la agenda no se tocan |
| `SupplierVisit` `planificada` | `cancelada` («porque la incidencia se resolvió/cerró»); realizada o cancelada, sin cambios |
| `IssueProviderAssignment` | contexto histórico, no se toca |
| `InsuranceClaim` | **no se toca** (ni al resolver, ni al cerrar, ni al reabrir): es el expediente administrativo con la aseguradora, no el problema en la comunidad. Ver «Resuelta frente a Cerrada» |
| Aviso de resolución al solicitante | Lo ÚNICO que se crea después de liquidar: al pasar a Resuelta se evalúa `informResolved` (ver «Experiencia del solicitante»); si deja una tarea `inform_requester`, `→ Cerrada` se rechaza hasta que se envíe o descarte (nunca se cancela en silencio) |

Puertas de defensa en profundidad: `openTask`, `startWait` y `registerVisit` no crean nada sobre una incidencia terminada. **Resuelta y Cerrada liquidan exactamente lo mismo** (no hay diferencia operativa; cambian las marcas
`resolvedAt`/`closedAt` y la regla del siniestro de abajo). **Reabrir** (cualquier estado activo) no revive nada: lo retirado
queda retirado, y el siguiente paso lo decide una persona o, pasado el margen, `no_next_step`; tampoco cambia el siniestro.

### Resuelta frente a Cerrada: el siniestro de seguro

- **Resuelta** = «el problema que originó la incidencia está solucionado». Puede quedar un `InsuranceClaim` no terminal
  (`open`, `under_assessment`, `accepted`, `rejected`): la incidencia es `completed` con la pelota en `nobody` y el siniestro
  sigue visible y gestionable como contexto administrativo. No se abre ninguna tarea por mantenerlo abierto.
- **Cerrada** = «resuelta y sin gestión administrativa pendiente del siniestro». `applyStatusInTx` rechaza `→ Cerrada`
  (desde cualquier estado) mientras exista un siniestro no terminal: **409** con `{ code: 'ISSUE_HAS_OPEN_INSURANCE_CLAIM',
  message }`. Terminales: `withdrawn` y `closed` (`TERMINAL_CLAIM_STATUSES`); `rejected` NO lo es (se puede reconsiderar), así
  que un rechazo bloquea el cierre hasta que se desista o se cierre.
- Nada se cierra solo: cerrar la incidencia no toca el siniestro, y un siniestro que termina no cierra la incidencia
  (solo desaparece el bloqueo).
- **Invariante: `Cerrada ⇒ ningún siniestro no terminal`.** La comprobación se hace con la incidencia bloqueada
  (`FOR UPDATE`) y todo el que abre o cambia un siniestro (`InsuranceClaimsService.open/update`) bloquea esa misma fila antes
  de leer: no hay hueco entre «no hay siniestros vivos» y el commit. Sobre una Cerrada, `open` y reactivar un siniestro a un
  estado vivo se rechazan (409 `ISSUE_CLOSED_INSURANCE_CLAIM_NOT_ALLOWED`); terminarlo sigue permitido.

## Duplicados

Ya no hay detección ni fusión de duplicados. Las incidencias que se fusionaron antes de retirar la automatización conservan su
historial (`issue_reports.originIssueId` y los eventos `duplicate_linked`/`report_merged`, internos); no se migran ni se leen
de forma especial.

## Las incidencias son de la comunidad

**Una incidencia es siempre de la comunidad (finca), nunca de una vivienda.** No existe «incidencia de vivienda»: ni se reporta, ni se
lista por propiedad, ni cuelga de una (`Issue` no tiene `propertyId` ni `scope`). Un propietario o inquilino que quiere avisar de algo
lo hace a la comunidad, y su vivienda no aporta nada. `IssueReport.reporterUserId` dice **quién avisó** (el reportante no es su dueño);
`assetId` dice **qué instalación** está afectada y nunca decide los permisos.

- **Modelo**: `Issue.estateId` es obligatorio (FK a `estates`, `ON DELETE RESTRICT`, índice `(estate_id, status)`) y la única referencia
  de finca. `ai_check_tenant()` compara con `issues.estate_id`.
- **Una sola abstracción** para filtrar por finca: `issues/issue-estate.ts` (`issuesOfEstate`, `issuePortalLink`). Un test del código
  (`issue-estate.guard.spec.ts`) falla si una consulta de incidencias vuelve a filtrar por `property: { estateId }`.
- **Quién la ve (rol C)**: cualquier miembro **activo** de la comunidad. `PropertyAccessService.isActiveMember` consulta la base de datos
  (membresía vinculada, no revocada, de una propiedad no dada de baja de ESA finca): nunca el `estateIds` del JWT, que no se entera de una
  baja hasta renovar la sesión. Quien no es miembro recibe el mismo 404 que si no existiera. La gestión accede por finca.
- **Quién la crea**: la gestión (en nombre de la comunidad) o cualquier miembro activo, por `POST /estates/:id/issues` (el único
  endpoint de alta). Quien la reporta queda como reportante, no como dueño.
- **Notas y fotos del rol C**: solo quien la reportó. El resto de miembros ve la incidencia pero no escribe en ella.
- **Lo que ve un vecino** es una proyección de **lista blanca** (`issue-resident-view.ts`): título, descripción, estado, tipo,
  prioridad, fechas, fotos (sin clave de almacenamiento), un historial público (reporte, cambios de estado, notas de personas, visita
  programada, cita confirmada; autores como «Tú», «Un vecino», «Administración») y `reportedByMe`. Nada de proveedor, siniestro,
  esperas, tareas, visitas, vía, presupuesto, instalación, avisos enviados ni referencias internas. `GET /issues/:id/provider`,
  `provider/history` y `notifications` son solo de gestión.
- **Avisos automáticos** (resolución, visita…): a **todos** sus reportantes (incluidos los de incidencias que se fusionaron antes de retirar los duplicados), con el enlace
  `/c/incidencias?issue=:id` (los enlaces antiguos a `/c/community?issue=` redirigen); el resto de la comunidad la ve en el portal, sin avisos. Las alertas y la actividad del propietario muestran
  las incidencias que él reportó.
- **Mismo workflow**: vía → proveedor/seguro → esperas → visitas → resolución → avisos → cierre.
  `IssueWorkflowService.scope` devuelve `estateId`; nada del workflow necesita una propiedad.
- **Reporting**: todas las incidencias cuentan en los listados, contadores e informes por finca; el informe «issues» ya no tiene columna de
  propiedad, y el estado de pago de una propiedad (`ok` / `overdue`) depende solo de su deuda.

### Historia: de las incidencias de vivienda a esta decisión

El modelo llegó a tener un ámbito (`Issue.scope`, `Privada` / `Zona común` en `main`, `unit` / `common` en esta rama) y una vivienda
(`Issue.propertyId`). Por decisión de producto **una incidencia es siempre de la comunidad**: no hay ámbito ni vivienda. La migración
`20261101100000_issues_belong_to_estate` parte del estado de `main` (`20261028120000_owner_issues_unify_tickets`, que no se toca):
rellena `estate_id` desde la finca de la propiedad, pasa `reporter_user_id` a `issue_reports` (la fuente de quién avisó; una incidencia
puede tener varios avisos), quita `property_id`, `scope`, `reporter_user_id` y el tipo `IssueScope`, hace `estate_id` obligatorio con su
FK e índice y reemplaza `ai_check_tenant()` para comparar con `issues.estate_id`. Los datos de partida eran de prueba: una base que no
pueda migrarse (p. ej. una incidencia de una propiedad sin finca) se resetea.

`issue_timeline_entries.internal` lo añade `main` (notas internas de la gestión). Nuestras migraciones ya no lo crean antes de tiempo:
`20261028130000_issue_event_visibility` garantiza la columna (`IF NOT EXISTS`) y aplica la lista blanca de tipos de evento visibles.

## Lo que viene de #44 sobre el modelo comunitario

- **Ubicación** (`location`): la zona o instalación afectada, en texto («Portal 1», «Piscina»…). Nunca una vivienda. Una incidencia es
  siempre una incidencia: no hay «categoría» de aviso (Solicitud, Consulta, Sugerencia); `type` (Avería, Fuga…) clasifica el problema.
  `20261101120000_issues_drop_category` quita `issues.category` y el enum `IssueCategory`. La instalación vinculada por la gestión (`assetId`) prevalece al mostrarla.
- **Pedir información** (`POST /issues/:id/request-info`, solo A/B): la incidencia pasa a `Pendiente de información` y recuerda el estado
  al que volver (`statusBeforeInfoRequest`, que pedirla otra vez no pisa). Es un estado **no terminal derivado del propio estado**, sin
  `IssueWait`: la situación es «esperando a un tercero», la pelota la tiene quien avisó (`source: 'status'`) y el siguiente paso es
  «Esperando la respuesta del solicitante»; nunca se considera estancada y una tarea de la administración sigue teniendo precedencia.
  Los destinatarios son todos los reportantes con cuenta (`IssueReport`). Responde solo un reportante: restaura el estado y vacía
  `statusBeforeInfoRequest`; un cambio manual de estado también lo vacía. El texto de la petición y la respuesta (`info_requested` /
  `info_provided`) solo los ven los reportantes y la gestión.
- **Retirada** (`Retirada`): la retira quien reportó, solo estando `Abierta`, solo si es el **único** reportante y nadie marcó «me
  afecta también» (409), y no con un siniestro vivo (409, como `Cerrada`). Es **terminal pero no una resolución**: usa `closedAt`, nunca
  `resolvedAt`; situación `completed`, pelota de nadie; pasa por la misma liquidación que los demás estados terminales
  (`settleIssueLifecycle`: esperas, tareas, mensajes sin enviar, jobs y visitas planificadas) y no se avisa de «resuelta» al propio
  reportante. No cuenta en «Resueltas» (se encuentra en «Todas» y por estado), ni en tiempos de resolución, ni como resolución de un
  proveedor (`RESOLVED_ISSUE_STATUSES` frente a `isTerminalIssueStatus`).
- **Valoración** (`rating`, `ratingComment`): una por incidencia, de un reportante, tras `Resuelta`/`Cerrada`; solo la ve quien valoró y la
  administración.
- **«Me afecta también»** (`IssueAffectedUser`): un miembro que no es reportante marca una incidencia abierta de otro. No es un aviso ni da
  permisos de reportante (no escribe notas ni sube fotos).
- **Notas internas** (`internal`): solo las escribe la gestión; nunca salen en la proyección de un vecino ni de quien avisó.
- **Portal del propietario** `/c/incidencias` (`/me/issues`): por comunidad (`estateId`), con la membresía activa comprobada en la base de
  datos y la proyección pública de siempre; `mine` significa «tengo un aviso mío en ella». Las zonas del alta
  (`GET /me/issues/locations?estateId`) salen de las instalaciones, portales, zonas reservables y zonas comunes de la comunidad; nunca «Mi vivienda».

## Experiencia del solicitante

Una sola conversación: el historial de la incidencia (`IssueTimelineEntry`). El solicitante escribe y lee ahí (`POST /issues/:id/timeline`,
solo ve la lista blanca `REQUESTER_VISIBLE_EVENT_KINDS`); la gestión lee lo mismo más la maquinaria. No hay un buzón aparte.

### Una nota del solicitante no pasa desapercibida

La nota es historial (como siempre). Lo nuevo es la señal operativa, que decide `requesterNoteReceived` con la incidencia bloqueada
(`lockIssue`: la nota y su señal van en una transacción; una resolución concurrente gana o pierde entera):

| Situación de la incidencia | Qué ocurre |
|---|---|
| Activa, sin otra decisión pidiendo atención ahora | UNA tarea `review_issue` / `requester_update` («Revisar actualización del solicitante») y su aviso a la gestión |
| Ya hay esa tarea abierta (2.ª, 3.ª nota) | La misma: no se abre otra (`discriminator = requester_update`); el aviso lleva la misma clave y la bandeja lo colapsa mientras no se lea. Si la tarea se resolvió, la nota siguiente abre otra (regla de siempre: una tarea resuelta no se reabre) |
| Activa y otra decisión humana ya pide atención (`PENDIENTE`/`EN_CURSO`) | **Sin segunda tarea**: «una decisión pendiente = una tarea». La nota es contexto de esa decisión; la gestión recibe un aviso informativo que enlaza a la incidencia (`requester-note:<id>`, colapsado mientras no se lea) |
| Solo hay tareas aparcadas (`EN_ESPERA`) o la de avisar al solicitante | No cuentan como decisión pendiente: la nota abre la suya |
| `Resuelta` / `Cerrada` | **No se reabre ni se crea trabajo.** La nota queda en el historial y la gestión recibe el aviso informativo («ya resuelta/cerrada»); la proyección sigue siendo `completed` con la pelota en `nobody` |

No se distingue «información para la decisión abierta» de «decisión nueva» leyendo la nota (eso sería interpretar texto, otro bloque):
con otra decisión abierta se elige siempre lo conservador, no duplicar la tarea, y el aviso informativo evita que pase inadvertida.
Una nota **nunca** toca esperas, visitas, jobs ni mensajes: no es la respuesta de un tercero (la espera al proveedor, aseguradora
o propietario sigue abierta; mientras la tarea de revisar esté abierta la proyección dice «requiere atención» y al atenderla vuelve a
«esperando tercero»). Solo cuentan las notas de quien escribe con rol propietario/inquilino (C); lo que escribe la gestión no genera
nada. Leer la novedad no es un «siguiente paso» (`isInformationalTask`, igual que avisar al solicitante): no tapa una incidencia sin
siguiente paso ni impide abrir la decisión de después de una visita.

### Aviso de resolución

En una transición REAL a Resuelta (`applyStatusInTx`, que usan `PATCH …/status` y el efecto `resolve_issue`; bajo el bloqueo
de la incidencia, ya cambiado el estado y liquidada) se llama a `informResolved`, con la plantilla de hechos `issue_resolved` (nunca un
texto del modelo) como tarea para una persona:

| Qué ocurre |
|---|
| Se abre la tarea `inform_requester` / `issue_resolved`, con la plantilla a la vista, que una persona envía o descarta (la misma de las visitas). Nada se envía solo. |

- **Una sola vez.** Solo una transición real a Resuelta avisa (desde activa o, si nunca se le dijo, desde Cerrada); `Resuelta → Cerrada`, `Cerrada → Cerrada`, editar una resuelta o cerrar sin pasar por
  Resuelta no. Reabrir retira la tarea de avisar que esperaba a una persona (ya no es cierto) y una nueva resolución es otra resolución: se avisa de nuevo. Si ya se le dijo «resuelta» desde la última
  apertura (a mano, antes de resolver o en la misma gestión) no se repite (`resolutionAlreadyInformed`). Dos resoluciones a la vez
  se serializan con el bloqueo: la segunda ve el estado ya cambiado.
- **Sin solicitante con cuenta** (`reporterUserId`, p. ej. una incidencia dada de alta por la gestión) no se crea nada: ni evento, ni
  tarea, ni aviso. Resolver sigue funcionando igual.
- **La tarea nace sobre una incidencia ya resuelta** (`openTask({ afterSettlement: true })`, único caso): es una obligación
  administrativa POSTERIOR a solucionar el problema, no trabajo operativo. La incidencia sigue `completed` con la pelota en `nobody`,
  la tarea vive en Tareas y no reactiva esperas, visitas, jobs ni ramas del proveedor o del seguro. Una nota del solicitante tampoco la
  convierte en trabajo.
- **Resuelta ≠ Cerrada.** Resuelta: el problema está solucionado y puede quedar por informar al solicitante. Cerrada: caso finalizado,
  sin esa comunicación pendiente. Por eso `→ Cerrada` se **rechaza** (409 `ISSUE_HAS_PENDING_REQUESTER_NOTICE`) mientras la tarea
  «Informar al solicitante» siga abierta (también aparcada): cerrar no cancela en silencio la tarea, porque así el solicitante no
  se enteraría nunca. Enviarla o descartarla (resolverla con `dismiss`, una decisión consciente de la gestión) la cierra y desbloquea.
  Mensaje: «Antes de cerrar la incidencia, revisa la comunicación pendiente al solicitante: envíala o descártala desde Tareas.»; la UI
  nunca enseña el código. Sin solicitante con cuenta (o con aviso automático) no hay tarea y por tanto ningún bloqueo.
- **Dos bloqueos a la vez** (comunicación pendiente + siniestro no terminal): UNA sola respuesta 409, determinista:
  `code` = el primero de [`ISSUE_HAS_OPEN_INSURANCE_CLAIM`, `ISSUE_HAS_PENDING_REQUESTER_NOTICE`], `blockers` = todos, y un mensaje
  humano que los nombra juntos. Al resolver uno, el otro sigue diciendo solo lo suyo.
- **Cierre directo.** `activa → Cerrada` (sin pasar por Resuelta) es posible hoy y NO se restringe: lo ofrecen el selector de estado
  de la incidencia y el de Operaciones (cualquier estado), `PATCH …/status` lo acepta, Ahí no hay aviso de resolución que saltarse
  (el problema no se declaró solucionado) y si luego se pasa a Resuelta, se le avisa si nunca se le dijo.
- **Si la entrega falla** (`deliverRequesterNotice` nunca lanza) la incidencia sigue `Resuelta`: el mensaje ya consta en el historial del
  solicitante y la gestión ve el evento interno `requester_notice_failed` («No se pudo entregar la notificación…»). Resolver y
  avisar no se mezclan: no hay rollback.

## Esperas y relojes

`IssueWait` (`party`, `kind`, `refType/refId`, `startedAt`, `dueAt?`, `endedAt?`, `endReason?`). Como mucho una espera
abierta por (incidencia, `kind`, `refId`) — índice único parcial en la migración.

**El reloj es workflow.** El barrido de incidencias (`IssueWorkflowSweepService`, cada 10 min) atiende las esperas con
`dueAt` vencido y `dueHandledAt` vacío (`IssueWorkflowService.processDueWaits`): bajo el bloqueo de la incidencia, vuelve a mirar
la espera y abre la tarea `chase_provider` (reclamar) para una persona. Cada vencimiento se atiende una sola vez (idempotente).
No hay recordatorios automáticos.

**Terminar una espera a mano retira su seguimiento.** Con el efecto `end_wait` de «Registrar gestión» (`retireWaitFollowUp`, la misma
retirada que hacen la respuesta del proveedor y el siniestro, acotada a UNA espera): la tarea de reclamarla queda cancelada
(`superseded`). Nada se borra y las demás
esperas —también las de la misma parte— no se tocan.

## Revisión de arquitectura de Tareas + Incidencias (comportamiento vigente)

Qué es cada cosa: **incidencia** = el expediente; **tarea** (`AgendaTask`) = trabajo de una persona;
**`IssueWait`** = lo que esperamos de un tercero; **`SupplierVisit`** = visita programada. La proyección (`issue-situation.ts`) responde
a «¿quién tiene la pelota?» con una precedencia fija y determinista: *terminada > persona (tarea viva sin aparcar) > tercero (espera, visita planificada,
información pedida) > nadie*. `hasNextStep` usa la misma noción de «siguiente paso»
(avisar al solicitante y leer su novedad no cuentan).

### Cuándo se hace, cuándo vence, cuánto dura

`startAt`/`endAt` son el **bloque del calendario** (cuándo se hace); `dueAt` es la **fecha límite**. Una tarea de incidencia nace con
`dueAt` = creación + SLA (urgente 2 h, alta 24 h, media 72 h, baja 168 h) y un bloque de 30 min en ese instante: una tarea MEDIA vence en
72 h pero **no dura** 72 h. Arrastrarla o reprogramarla cambia el bloque, nunca el plazo. «Vencida» se mide contra `dueAt` y, si es `null`
(tareas manuales sin plazo propio y todas las anteriores a la columna; no se rellenó nada con datos inventados), contra el fin del bloque.
Una tarea manual puede llevar su propio `dueAt`; una serie no (cada ocurrencia vence con su bloque).

### Resuelta, Cerrada, Retirada

| Estado | Significa | ¿Trabajo nuevo? |
|---|---|---|
| Abierta, En reparación, Pendiente proveedor, Pendiente de información | operativamente activa (`isOperationallyActive`) | sí |
| **Resuelta** | el problema está solucionado; puede quedar trabajo administrativo posterior | solo el posterior a resolver (`allowsPostResolutionWork`): avisar al solicitante, valoración, reapertura. `openTask` lo exige con `afterSettlement`, que solo vale en Resuelta |
| **Cerrada**, **Retirada** | expediente acabado (`isFullyClosed`) | no: ni tareas, ni esperas, ni visitas, ni trabajo del barrido |

`isTerminalIssueStatus` sigue significando «ya no hay nada vivo que hacer» (liquidada); no se usa para decidir si admite el trabajo posterior.

### `review_issue`: nunca «Hecho» a secas

La resolución es un conjunto cerrado de acciones (`ReviewIssueResolution`): `choose_route` (vía de gestión), `schedule_follow_up` (próxima
actuación con texto y fecha futura → tarea `follow_up`), `mark_resolved` (pasa a Resuelta por la operación de dominio), `next_step_exists` (solo
vale si ya hay otro paso) y `done` (valor histórico, equivale al anterior). Todo corre en **una transacción con la incidencia bloqueada** y,
si la incidencia sigue activa sin tarea viva, espera, visita planificada ni job de Domora, se rechaza entera con **409 `ISSUE_NO_NEXT_STEP`**
(nada cambia). El barrido no tiene nada que «arreglar» después. En la UI el panel pregunta «¿Qué quieres hacer ahora?».

**`direct_management`** («Administrador») ya no es «nadie tiene la pelota»: elegirla abre `review_issue` / `direct_management` (una persona
lleva el caso y debe dejar su siguiente actuación); salir de esa vía la sustituye. Si venía una revisión de entrada, queda sustituida
por ésta.

### Soporte (rol A) y la agenda

La agenda sigue siendo solo de la gestora (B): A no pertenece a ninguna. Pero A gestiona incidencias, así que puede resolver las **decisiones de
una incidencia** desde su ficha: `POST /issues/:id/tasks/:taskId/resolution` (roles A y B). Autoriza por la incidencia (`assertIssueAccess`),
exige que la tarea sea de ESA incidencia y delega en el mismo `AgendaTaskResolutionService` (validación, cerrojo, ejecución y rastro). C no puede.
La UI de Incidencias es hoy solo `/b/…`: el endpoint existe, la pantalla de soporte no.

### Borrar una incidencia

Borrado lógico (`deletedAt`) bajo el bloqueo de la incidencia, idempotente. Las tareas **no se borran**: se cierran y se archivan
(`AgendaTask.archivedAt`; decisiones sin resolver quedan con `outcome = issue_deleted`). Salen de la agenda, del resumen y de los recordatorios, y no
las toca ningún barrido, pero conservan payload, resultado, responsable, comentarios y adjuntos que el historial referencia. El historial
recibe un evento interno `issue_deleted` con los recuentos. Es «ocultar del producto», no retención ni borrado legal: `archivedAt` es el
gancho para una política futura.

### Editar una serie no reescribe el pasado

Las ocurrencias resueltas (`agenda_task_occurrences`) conservan su inicio, su estado y su **fin congelado** (`occurrence_end`) cuando la serie
cambia de día, hora, zona, regla o fecha. Se siguen mostrando en su hueco original aunque la serie nueva ya no las genere. La regla nueva
rige desde su nuevo ancla (`startAt`): lo anterior sin resolver no se materializa. Las filas anteriores a la columna reciben su fin al editar
(con la duración que tenía la serie justo antes); no hay relleno masivo.

### Efectos externos: tres problemas distintos

1. *Abrir una tarea una vez*: `sourceRef` único + discriminador. 2. *Resolverla una vez*: el cerrojo `outcome = resolving` (caduca a los 5 min).
3. *Que el efecto no salga dos veces si el proceso muere entre ejecutarlo y anotarlo*: el reintento tras caducar el cerrojo reutiliza lo hecho.
El aviso al solicitante lleva una clave estable por tarea (`meta.idempotencyKey`) y se entrega con `once: true` (una notificación por clave, leída o no);
el rastro `task_resolved` se escribe una vez; el seguimiento de una revisión se reutiliza. No hay envío de correos ni outbox con worker: el único efecto fuera de la base de datos
que ejecutan las decisiones es la notificación, y la clave la hace idempotente.

### Vínculos de una tarea

`agenda_task_links.label` guarda el título al vincular. Al leer, un vínculo cuya entidad ya no existe sale con `deleted: true` y ese título (o «Entidad
eliminada»; una incidencia en la papelera conserva su referencia y título). No se filtra en silencio. Sí se omite lo que existe pero cae fuera de las fincas
del lector. Las entidades se borran de verdad solo en proveedores, juntas y documentos; el historial no depende de ellas.

### Cambios de estado a mano

`PATCH :id/status` y el efecto «resolver» pasan por `MANUAL_ISSUE_TRANSITIONS`: Cerrada solo vuelve a Resuelta o a Abierta; Retirada solo a Abierta;
Resuelta a cualquier estado de trabajo o Cerrada; el resto, libre entre sí y hacia Resuelta/Cerrada. Pedir información, retirar y la reapertura del
solicitante tienen sus operaciones y no pasan por aquí. Salir de «Pendiente de información» a mano borra `statusBeforeInfoRequest`.

### El barrido es red de seguridad

Operaciones normales que dejaban trabajo al barrido: resolver una revisión sin siguiente paso (ahora rechazado) y elegir «Administrador» (ahora abre su tarea).
Lo que el barrido sigue cubriendo es recuperación: esperas vencidas, visitas pasadas sin resultado y decisiones que se perdieron por un fallo. `no_next_step` es la última red: no debería dispararse por una acción humana normal.

### Privacidad hacia propietarios

Sin cambios de diseño: el vecino recibe solo `presentIssueForResident` (lista blanca campo a campo, eventos con su propia lista blanca, sin `meta`, `refType`, proveedor, siniestro,
tareas, notas internas ni contacto); tests de forma exacta de claves en `issue-resident-view.spec.ts` y `issues-owner-privacy.spec.ts`.

### Pendiente de decisión de producto

**Vivienda/unidad opcional en la incidencia (`propertyId`)**: NO implementado. Contradice la decisión registrada de que una incidencia es solo de la comunidad
(sin `Issue.propertyId`; ver «Las incidencias son de la comunidad»). Si producto la revoca, la entidad canónica es `Property`, con `propertyId` nulo y una
comprobación `property.estateId = issue.estateId`.

## Deuda conocida (aprobada con las fases 5-6)

| Deuda | Tratamiento |
|---|---|
| Rendimiento del filtro de situación: se calcula por incidencia, así que filtrar recorre las de la finca (igual que el resumen) | Optimización futura si el volumen lo exige (caché/proyección persistida); no antes. |
| Cambiar el filtro por instalación con un filtro de situación activo no recarga la lista filtrada; hay que volver a pulsar el filtro | Bug menor de UX. |
| Un aviso suelto al solicitante deja dos eventos (la gestión y el aviso); la UI oculta el primero | Deuda de modelo/limpieza: un efecto sin gestión asociada. |
| `approve_quote` sin resolución en el backend, la UI no ofrece botones | Bloqueado hasta implementar el flujo real de presupuestos. |
| Revisar si en el futuro queremos formalizar un state machine donde Cerrada requiera Resuelta, y cómo encajan cierre directo, duplicados y posibles casos de cancelación | Decidido (B12): no se restringe. `activa → Cerrada` sigue permitido (UI y API) y no inventa un aviso de «resuelta»; solo `Resuelta → Cerrada` espera la comunicación pendiente. Pendiente para la auditoría final. |
| Una incidencia no admite todavía comentarios de la comunidad ni «a mí también me pasa»; solo reportantes y gestión escriben | v1 deliberada; se decidirá con producto. |
| La comunidad no recibe avisos de una incidencia por defecto (solo sus reportantes) | Un canal de comunicación comunitaria aparte, si se quiere. |
| La instalación afectada no se enseña a los vecinos | Decisión pendiente de qué instalaciones son información pública segura. |
| Las fotos de incidencias de prueba que se resetean al migrar una base antigua pueden quedar en el almacenamiento | Limpieza aparte (script de huérfanos); no hay fila que las referencie. |
| «Avisar que está resuelta» (el propietario indicaba a la gestora que su incidencia estaba resuelta) no existe en la ficha de la comunidad | La ficha de la propiedad ya no tiene incidencias; se decidirá con producto si hace falta. |
| Baseline conocido de PGlite en `ledger`, `agenda-tasks`, `property-memberships`, `suppliers`, `verifactu` | Ajeno a incidencias; no se reabre aquí. |

## Datos anteriores

Las migraciones rellenan `issue_reports` (uno por incidencia, canal `form`) y corrigen el rol «Sistema» de las entradas con
autor. `20261106110000_remove_incident_automation` cancela (`superseded`) las tareas abiertas de los tipos retirados
(`approve_provider_message`, `confirm_appointment`, `review_failed_delivery`, `review_provider_reply`, `review_duplicate`),
cierra (`superseded`) las esperas ligadas a `ai_message`, borra los jobs de IA de incidencias (`incident`, `send`, `reply`,
`issue_wait_due`) y elimina las tablas de la automatización. Los eventos del historial con tipos retirados se conservan: son
internos por defecto (lista blanca de `REQUESTER_VISIBLE_EVENT_KINDS`) y se leen sin errores.

## Recorrido (journey) y tareas sin duración

- **Recorrido vivo** (`IssueJourneyService`, `issue-journey.ts`): una PROYECCIÓN de lo que de verdad ocurrió, no una plantilla de hitos que se tachan. Solo lee (tareas, esperas, visitas, siniestros, eventos `route_decided`/`claim_updated`/`communication` y la situación); no guarda ningún "paso actual" ni ejecuta reglas de dominio. Devuelve `{ route, status, steps }` con `status` = `on_track` | `needs_attention` | `resolved`, y cada paso con `status` (`completed` | `current` | `upcoming`), `source` (`system`, `task`, `wait`, `visit`, `claim`, `interaction`, `timeline`, `custom`), fechas (`completedAt`, `scheduledAt`, `startedAt`, `dueAt`, `overdue`) y, en el actual, una `action` de tipo cerrado (`open_task`, `manage_visit`, `register_response`, `manage_claim`, `register_activity`, `change_route`, `resolve_issue`) con su `entityId`; el cliente decide a dónde lleva cada una.
- **Pasado, presente, futuro inmediato**: pasado = solo hechos reales (creada, vía cambiada, comunicaciones, siniestro abierto y sus cambios de estado, tareas completadas, respuestas recibidas, visitas realizadas, resuelta). Presente = UNA situación con la misma precedencia que la situación operativa: tarea que requiere atención → espera abierta (con «desde hace», seguimiento y vencido) → visita planificada (o «confirmar el resultado» si pasó) → información pedida al solicitante → tarea aparcada. Futuro = como máximo un «Después: …» previsible (según la tarea o espera actual) más los hitos propios aún pendientes; nunca la rama completa. Por vía no hay una secuencia fija: la vía solo influye en el texto de los pasos y en el «Después».
- **Sin siguiente paso**: una incidencia activa sin tarea, espera ni visita devuelve `status = needs_attention` y el paso actual «Definir siguiente paso» (`register_activity`, o `change_route` si no hay vía). El barrido sigue abriendo `review_issue` (`no_next_step`) como red de seguridad, pero la ficha no lo esconde.
- **Hitos del sistema vs propios**: los del sistema salen de los hechos y no se pueden dar por hechos a mano (solo cambiar de nombre u ocultar uno ya ocurrido, salvo «creada» y «resuelta»). Los propios (`issue_journey_milestones` con `templateKey` nulo) se renombran, completan y borran; hechos pasan al pasado en su fecha, pendientes salen como pendientes. En la tabla solo se guardan esos y los ajustes de nombre/ocultación (`templateKey` = clave del paso, p. ej. `claim:1a2b3c4d`); los ajustes antiguos con claves de la plantilla fija ya no coinciden con nada y se ignoran, sin inventar hechos. API: `GET /issues/:id/journey`, `POST /issues/:id/journey/milestones` (`{ label }`), `PATCH|DELETE …/milestones/:ref`. Solo gestión (A/B) con acceso a la finca.
- **Cambio de vía**: queda como hito «Vía cambiada: A → B» (evento `route_decided` con `from` y `to`); el pasado se conserva y la nueva rama se construye desde la realidad actual. La invalidación del trabajo de la vía anterior sigue siendo del workflow (`reconcileRouteChange`).
- **«¿Qué pasa ahora?» en Registrar actividad**: `POST /issues/:id/interactions` exige `nextStep` (`task`, `wait`, `visit`, `route`, `resolved`, `none`); sin él responde 400 `NEXT_STEP_REQUIRED`. Cada opción exige su efecto (`open_follow_up`, `start_wait`, `schedule_visit`, `set_resolution_route`, `resolve_issue`) y, salvo `resolved`, la incidencia no puede quedar activa sin tarea, espera, visita : si no, 409 `ISSUE_WITHOUT_NEXT_STEP` y no se aplica nada (todo o nada). `none` solo vale si ya hay otro paso. Excepciones explícitas: los avisos al solicitante (`party = requester`) no cambian el rumbo de la incidencia y no lo exigen, y `legacyNoNextStep: true` (**deprecado**, solo compatibilidad): únicamente lo admite una integración anterior que se identifica con la cabecera `X-Domora-Legacy-Client: <nombre>` (`[A-Za-z0-9._/-]`, máx. 60); sin ella, 400 `LEGACY_CLIENT_REQUIRED`. Cada uso queda registrado (log `DEPRECATED legacyNoNextStep: client=… user=… issue=…` y `legacyNoNextStep`/`legacyClient` en el `meta` de la comunicación) y la respuesta lleva `Deprecation: true`; con `nextStep` presente no se considera uso. Rige entonces el barrido. Para retirarlo: cuando el log deje de mostrar clientes, quitar el campo del DTO. La tarea de `task` admite `assigneeUserId` (de su equipo, regla única en `agenda-task-assignee.ts`, la misma que las tareas manuales) y `priority`; el texto de la acción es `note` y la fecha `dueAt`.
- **Revisión (`review_issue`) sin «hecho»**: una revisión de una incidencia activa solo se cierra indicando el siguiente paso, con `POST /agenda/tasks/:id/resolution`: `schedule_follow_up` (tarea, con `assigneeUserId`/`priority`), `start_wait`, `schedule_visit`, `choose_route`, `mark_resolved` o `next_step_exists` (solo si ya hay otro). `completed` y `done` son alias heredados de `next_step_exists` y también lo comprueban (409 `ISSUE_NO_NEXT_STEP`). **Qué cuenta como siguiente paso** (`IssueWorkflowService.hasNextStep`, la MISMA regla para cerrar una revisión, `nextStep` de Registrar actividad y el barrido): solo lo operativamente activo y de la vía vigente. Tareas vivas (`PENDIENTE`/`EN_CURSO`/`EN_ESPERA`, no archivadas) que no sean avisar al solicitante ni leer su novedad y que no sean de una rama que la vía no activa (`taskCompatibleWithRoute`); el reclamo de una espera no cuenta por sí solo (cuenta su espera). Esperas con `endedAt` nulo (las cumplidas, canceladas, vencidas o `superseded` no). Visitas `planificada` (no `realizada` ni `cancelada`). **Entidad real en la revisión**: `start_wait` admite `supplierId` (proveedor o aseguradora del directorio de la comunidad; el nombre sale de él y `partyLabel` pasa a ser opcional) y `schedule_visit` admite `supplierId` o `useAssignedProfessional: true` (el profesional asignado, aunque no esté en el directorio); `partyLabel`/`visitorLabel` siguen valiendo como respaldo. Las reglas viven en `waitSupplier`/`visitTarget` (workflow) y las comparte Registrar actividad. El botón genérico «Completada» (`PATCH …/status`) ya no cierra una revisión: 400 `REVIEW_NEEDS_NEXT_STEP`. Desde Tareas, el detalle de la revisión muestra «¿Qué pasa ahora?». El barrido queda como red de seguridad para casos excepcionales.
- **Migración del recorrido antiguo (comprobación)**: los ajustes de `issue_journey_milestones` con claves de la plantilla fija (`call_insurer`, `claim_opened`, `insurer_replied`, `expert_visit`, `provider_repair`, `ask_owner`, `contact_provider`, `visit_scheduled`, `work_done`, `direct_started`, `choose_route`) ya no coinciden con ningún paso y se ignoran. Comprobado el 2026-10-28 sobre la base de demo (`domora_demo`): 2 filas con clave de plantilla (`call_insurer`, `claim_opened`), ninguna oculta, renombrada ni marcada como hecha, y 0 hitos propios; repetido ese día sobre la base local `domora` (0 filas); es decir, no llevaban información y no hay datos reales afectados. **La base de producción/pre no se ha consultado: la auditoría está pendiente allí y es requisito previo al deploy.** Por eso no se añade migración. Antes de desplegar en otro entorno: `SELECT template_key, hidden, label IS NOT NULL AS renamed, done_at IS NOT NULL AS done, count(*) FROM issue_journey_milestones WHERE template_key IS NOT NULL GROUP BY 1,2,3,4`; si hubiera filas con `hidden`, `renamed` o `done`, convertirlas a mano (los hitos propios, `template_key IS NULL`, se conservan tal cual).
- **Sin duración** (`AgendaTask.noDuration`): los pasos de una incidencia no ocupan tiempo; en el calendario semanal salen como notas del día (franja «Acciones», con «Ver acciones» si hay más de dos; clic = estado, doble clic = detalle). En el formulario de tarea: «Dura todo el día» y «Sin duración» (solo fecha de inicio).
- **Completada en una revisión** (`review_issue`) la cierra con la decisión `completed`, sin exigir siguiente paso (el barrido es la red de seguridad). La tarea de la vía seguro de comunidad se titula con su acción: «REF · Llamar al seguro de la comunidad».
