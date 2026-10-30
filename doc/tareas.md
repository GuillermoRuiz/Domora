# Tareas — la agenda operativa de la gestora

Sección `/b/tasks` (rol B). Responde a: *¿qué tengo que hacer, cuándo y sobre qué comunidad?*

> No confundir con `GET /tasks` (`notifications/tasks.service.ts`): es una lista de trabajo
> **derivada** (solicitudes sin resolver, inspecciones vencidas…) que no persiste nada y alimenta la
> pantalla de Notificaciones. La agenda vive bajo `/agenda/*`. Ver [`/tasks` frente a
> `/agenda/tasks`](#tasks-frente-a-agendatasks).

## Modelo (`backend/prisma/schema.prisma`, sección 14)

| Tabla | Para qué |
|---|---|
| `agenda_tasks` | La tarea. Tenant = `administrator_id`; `estate_id` opcional. |
| `agenda_task_labels` / `_label_links` | Catálogo de etiquetas **por gestora** y su asignación. |
| `agenda_task_checklist_items` | Subtareas simples (no son tareas). |
| `agenda_task_comments` | Comentarios. |
| `agenda_task_attachments` | Adjuntos sobre el `StorageService` compartido. |
| `agenda_task_links` | Vínculos polimórficos: `issue`, `meeting`, `supplier`, `document`. |
| `agenda_task_occurrences` | Resolución individual de una ocurrencia de una serie. |
| `agenda_task_reminders` | Recordatorios ya emitidos (clave primaria tarea + inicio de ocurrencia): garantiza un único aviso. |

Decisiones que conviene no deshacer sin pensarlo:

- **`VENCIDA` no se guarda.** Se calcula: `fin < ahora` y estado ∉ {COMPLETADA, CANCELADA}
  (`isOverdue`, `agenda-task.constants.ts`). Guardarlo exigiría un cron y se desincroniza al mover la tarea.
- **Una serie es una fila.** `recurrence_freq` + `recurrence_interval` + `recurrence_until`; las
  ocurrencias se calculan al consultar (`recurrence.ts`) sobre la **hora local** de la tarea
  (`timezone`), de modo que "las 10:00" sobrevive al cambio de hora. Solo las ocurrencias
  completadas/canceladas individualmente escriben en `agenda_task_occurrences`.
- **Día completo** = medianoche UTC (fin exclusivo): es una fecha de calendario, no un instante.
  Para decidir si "vence" o cuándo avisar se interpreta como medianoche **local** de la zona de la
  tarea (`localMidnightOf`), de modo que una tarea del martes no está vencida el martes.
- **Zona horaria.** Las fechas viajan siempre en ISO-8601 UTC. El cliente manda su zona (`tz`) en
  listados y resumen para delimitar "hoy", "esta semana" y los días completos; si falta se usa la
  zona por defecto de la aplicación y si no existe el servidor responde 400 en lugar de adivinar.
- **Duración máxima 31 días** (CHECK en BD): permite acotar la consulta por fecha de inicio y usar
  el índice sin perder tareas largas que empezaron antes del rango.
- **Prioridad es el único canal de color** en el calendario; el tipo se ve por icono y el estado por
  tachado/insignia. Nunca solo color.
- Sin `due_at` aparte: el plazo es `end_at`.

## API (`/api/v1/agenda`, solo rol B)

```
GET    tasks?from&to&tz&estateId&assignee&status&priority&type&labelIds&q&overdue&limit
GET    tasks/summary?dayFrom&dayTo&weekFrom&weekTo&tz[&estateId&assignee]
POST   tasks                      PATCH tasks/:id            DELETE tasks/:id
PATCH  tasks/:id/status           POST  tasks/:id/duplicate
POST|DELETE tasks/:id/comments[/:commentId]
POST|PATCH|DELETE tasks/:id/checklist[/:itemId]
POST|GET|DELETE tasks/:id/attachments[/:attachmentId[/file]]
GET|POST|DELETE labels[/:id]      GET assignees
```

- **Con `from`+`to`** (máx. 100 días) devuelve ocurrencias que solapan el rango. **Sin ellos** solo
  devuelve trabajo *abierto* con tope (`limit` ≤ 200): nunca el histórico del tenant.
- `summary` y las consultas sin rango (`overdue`, `limit`) siguen en la API (con sus tests) pero la
  pantalla ya no las usa: se retiraron las tarjetas KPI (Hoy, Esta semana, Urgentes, Vencidas).
- **Topes de seguridad** (`agenda-task.constants.ts`): 1000 tareas leídas por consulta y 5000
  ocurrencias expandidas. Si se alcanzan, la respuesta sigue siendo un array pero lleva la cabecera
  `X-Agenda-Truncated: true` (expuesta por CORS) y la pantalla avisa con una banda amarilla para no
  presentar como completo un calendario al que le faltan tareas. En el resumen solo queda un aviso
  en el log del servidor (el recuento podría ser parcial).
- `assignee`: `me`, `none` (sin asignar) o id de usuario.

## Permisos

Toda consulta parte de `scopeWhere(user)`: tareas de **su gestora** y, de ellas, las generales o de
comunidades en `user.estateIds`. Además se valida en servidor: comunidad accesible
(`EstateAccessService`), responsable = usuario rol B de la misma gestora, etiquetas de la misma
gestora, y que cada entidad vinculada exista, sea accesible y sea de la misma comunidad que la
tarea. Una tarea ajena responde 404 (no 403) para no revelar su existencia. Rol A y C: sin acceso.

## Auditoría

Se usa `AuditService` (`data_access_log`, append-only y no visible a propietarios) con
`resource='agenda_task'` y acciones `create`, `reassign`, `reschedule`, `complete`, `cancel`,
`status`, `delete`, `duplicate`, `attach`. **No** se usa `activity_log`: ese feed se muestra a
propietarios y las tareas son internas.

## Recordatorios

`AgendaTasksRemindersCronService` (`@Cron` cada minuto) emite un aviso en la bandeja
(`NotificationsService.notify`, categoría `task`; el email sigue las preferencias del usuario,
configurables en Ajustes). Idempotente entre ejecuciones, reinicios y réplicas: antes de avisar
inserta la fila (tarea, inicio de ocurrencia) en `agenda_task_reminders` con
`INSERT … ON CONFLICT DO NOTHING`; solo quien gana la inserción envía. Si el envío falla después, el
aviso se pierde en lugar de repetirse (como mucho una vez). Un recordatorio atrasado por una caída
se emite hasta 1 h tarde; después se descarta, y un recordatorio cuyo momento ya había pasado al
crear o editar la tarea no se emite retroactivamente. Para una serie avisa de cada ocurrencia; las
resueltas se omiten. Una limpieza diaria (03:00) borra los registros de más de 30 días.

Lo que **no** hay: notificaciones push ni recordatorios por SMS.

## Automatizaciones futuras

El modelo ya lo permite: `source` (`'manual'` o el id de la automatización) + `source_ref` (p. ej. el
id de la incidencia), único por gestora, hace idempotente la generación. `AgendaTasksModule` exporta
`AgendaTasksService`; una automatización debe importarlo y crear la tarea con
`createdByUserId` = el usuario que originó el evento. Hoy `create()` fija `source='manual'`: al
implementar la primera automatización habrá que exponer un método que acepte `source`/`sourceRef`.

| Evento | Tarea sugerida | `source` / `source_ref` |
|---|---|---|
| Incidencia abierta | Seguimiento incidencia | `issue_followup` / id incidencia |
| Junta creada | Preparar convocatoria, enviar, documentación, acta | `meeting_*` / id junta |
| Mantenimiento periódico | Revisión ascensor cada 3 meses | serie `MONTHLY` interval 3 |
| Póliza / contrato | Renovación a N días | `insurance_renewal` / `contract_expiry` |

## Frontend (`src/app/features/tasks/`)

`TasksComponent` solo orquesta (rango, filtros, selección, diálogos). Pintado: `task-time-grid`
(Día/Semana, con arrastrar y soltar HTML5 — sin dependencias nuevas), `task-month-grid`,
`task-agenda-list` (semana en pantallas estrechas), `task-table` (tabla), `task-kanban` (tablero por
estado), `task-drawer` (detalle editable campo a campo), `task-form-dialog` (alta con "Más
opciones"), `task-filters`. Servicio:
`core/agenda-tasks.service.ts`; tipos y etiquetas: `core/agenda-tasks.model.ts`.

- **Cabecera**: `h1.tarea-title` + descripción. Debajo, una sola fila de controles: a la izquierda
  Día/Semana/Mes y las flechas de periodo; a la derecha el buscador, el selector de vista y
  "Nueva tarea".
- **Forma de ver** (selector de tres iconos, como el de tabla/tarjetas de Contabilidad): *Tabla*,
  *Kanban* o *Calendario* (por defecto). Se recuerda en `localStorage` (`domora-tasks-mode`). Las
  tres muestran las mismas tareas del periodo y filtros activos, sin otra petición. El kanban tiene
  una columna por estado; arrastrar una tarjeta a otra columna cambia su estado (en una serie, solo el
  de esa ocurrencia). Arrastrar es una comodidad para el ratón: con teclado se cambia desde el detalle.
- **Arrastrar** mueve la tarea conservando la duración (optimista, con reversión si el servidor
  rechaza). Las ocurrencias de una serie no se arrastran: se reprograma la serie desde el detalle.
- **Móvil (≤ 720 px)**: el menú lateral se colapsa a iconos (mismo patrón que el listado contable),
  Semana se muestra como agenda en lista, el detalle ocupa toda la pantalla y los filtros van en un panel.

## `/tasks` frente a `/agenda/tasks`

Existen dos conceptos con nombre parecido y **se mantienen separados**:

| | `GET /tasks` | `/agenda/tasks` |
|---|---|---|
| Módulo | `notifications` (`TasksService`) | `agenda-tasks` |
| Naturaleza | Lista derivada y de solo lectura (no hay tabla) | Entidad persistida con ciclo de vida |
| Consumidor | Pantalla de Notificaciones | Sección Tareas (`/b/tasks`) |

No hay conflicto funcional: rutas, módulos, tablas, DTO y tipos de frontend no se solapan, y la agenda
nunca se monta bajo `/tasks`. El riesgo es solo de **nomenclatura** (alguien que busque "tasks" en el
código encuentra ambos). Por eso todo lo de la agenda lleva el prefijo `agenda`/`Agenda` (tablas,
servicios, modelos TypeScript) y el controlador está bajo `/agenda`. Renombrar el endpoint antiguo
sería un cambio de contrato sin beneficio funcional; solo merece la pena si algún día se unifican
ambos conceptos.

## Rendimiento

Medido con la API real sobre Postgres con **150 000 tareas** de una sola gestora (≈140 al día, 1 %
series, casi todas ya resueltas; es un escenario muy por encima de lo realista):

| Consulta | p50 | p95 |
|---|---|---|
| Resumen (KPI) | 248 ms | 254 ms |
| Lista de vencidas / urgentes | 15–44 ms | 17–53 ms |
| Semana filtrada o con búsqueda | 23–88 ms | 36–106 ms |
| Semana sin filtrar (1008 elementos, tope) | 352 ms | 430 ms |

- El listado omite `description` (solo viaja en el detalle) y las etiquetas, el avance de
  subtareas y los recuentos de comentarios, adjuntos y vínculos se cargan en un número fijo de consultas
  (no una por tarea).
- **Trampa con Prisma/Postgres:** Prisma envía los enums como parámetros (`CAST($n AS enum)`), que
  Postgres no pliega a constante, así que un índice **parcial** con predicado sobre `status` jamás se
  usa. Por eso `status` no aparece en ningún predicado parcial y las consultas de "trabajo abierto"
  usan `status IN (PENDIENTE, EN_CURSO, EN_ESPERA)` (en positivo) contra el índice normal
  `(gestora, estado, fin)`.
- Índices: `(gestora, inicio)`, `(gestora, comunidad, inicio)`, `(gestora, responsable, inicio)`,
  `(gestora, estado, fin)`, parcial `recurring` (series) y parcial `reminder` (solo tareas con
  recordatorio).

## Límites conocidos

- Recurrencia: sin "días de la semana concretos" ni "último viernes de mes". Una serie nunca cuenta
  en el KPI *Vencidas* (si no, acumularía deuda indefinida por ocurrencias pasadas sin cerrar).
- Sin historial visible de cambios en el detalle (la auditoría existe en BD pero no se muestra).
- Un único responsable por tarea (decisión de producto de la primera versión).
- El catálogo de etiquetas por defecto se crea **una sola vez** por gestora (marca
  `administrators.agenda_labels_initialized_at`). Lo que la gestora borre, incluido "borrar todas",
  no reaparece.
- Los adjuntos validan el tipo MIME **declarado por el cliente** (comportamiento heredado de
  `StorageService`, común al resto de la app); no se inspecciona el contenido.
- Con más de 1000 tareas en un periodo la vista se recorta y se avisa (ver *Topes de seguridad*).
- Crear tareas con el teclado se hace con "Nueva tarea"; el clic en un hueco horario es solo ratón.
