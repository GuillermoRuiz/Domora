# Plan de acción — Implementación del backend (partiendo del estado real)

> **Documento histórico (2026-09-30).** Este plan describe el estado del
> repositorio en una etapa muy temprana (schema de Prisma con 4 tablas,
> frontend 100% mock) y quedó ampliamente superado por el desarrollo real.
> En particular, todo lo que menciona `backend/src/movements/` describe el
> libro de caja de una sola cuenta que existió hasta la fase 8 de la
> migración a partida doble y que hoy **no existe**: se sustituyó entero por
> un diario de partida doble real, ya con sus 14 fases (0-13) cerradas — ver
> [`doc/contabilidad/roadmap-partida-doble.md`](contabilidad/roadmap-partida-doble.md).
> Se conserva este documento sin reescribir como registro de por dónde
> arrancó el proyecto, no como referencia de su estado actual.

> Este documento **no reemplaza** `doc/plan.md` (arquitectura, stack, roadmap de
> fases) ni `docs/data-model.md` (modelo de datos detallado, con los gaps
> corregidos gap a gap sobre el frontend). Los complementa: diagnostica el
> estado REAL del repositorio a día de hoy, reconcilia las diferencias entre
> ambos documentos (el modelo de datos ha evolucionado significativamente
> desde que se escribió `doc/plan.md`), y traduce todo eso a un plan de
> acción concreto, en el orden en que debe ejecutarse a partir de ahora.

---

## 0. Resumen para quien tenga prisa

1. **El backend ya existe y funciona**: NestJS + Prisma + PostgreSQL, con
   Docker Compose, CI, y un módulo de autenticación real (no un mock) que ya
   se puede probar hoy mismo con `docker compose up` + las credenciales seed
   (`admin@domora.app` / `admin123`).
2. **El frontend sigue siendo 100% mock**: cero líneas de `HttpClient`, sin
   `environments/`, sin `AuthService` Angular. La integración no ha empezado.
3. **El schema de Prisma solo cubre 4 tablas** (`administrators`, `users`,
   `refresh_tokens`, `estates`) — alcance explícitamente acotado así en su
   propio comentario de cabecera, citando `doc/plan.md`.
4. **El modelo de datos ha cambiado mucho desde que se escribió `doc/plan.md`.**
   En esta misma sesión se resolvieron ~13 gaps de modelado sobre el
   frontend (usuarios reales, membresías N:M, proveedores normalizados,
   mandatos SEPA con CID validado, acuerdos de pago persistentes, lectura
   por usuario, activity log...) que `doc/plan.md` no conocía. **A partir de
   ahora, `docs/data-model.md` es la fuente de verdad para entidades, campos
   y relaciones — `doc/plan.md` sigue mandando en arquitectura y roadmap.**
5. **El primer paso no es "seguir con la Fase 2"**: es actualizar el schema
   de Prisma para que absorba el modelo enriquecido antes de construir nada
   encima de la versión antigua y más pobre que `doc/plan.md` describía.

---

## 1. Diagnóstico verificado del estado actual

### 1.1 Backend (`backend/`)

Confirmado por inspección directa del código, no por el README (que es el
boilerplate por defecto de NestJS, sin información del proyecto):

| Pieza | Estado | Evidencia |
|---|---|---|
| Scaffold NestJS + TypeScript | ✅ Hecho | `backend/src/{app,auth,prisma}` |
| Prisma + PostgreSQL | ✅ Hecho | `schema.prisma`, migración inicial aplicada |
| Docker Compose (API + Postgres) | ✅ Hecho | `docker-compose.yml`, healthcheck incluido |
| CI (lint + build + test) | ✅ Hecho | `.github/workflows/backend-ci.yml` |
| Seed con credenciales demo | ✅ Hecho | `prisma/seed.ts` → `admin@domora.app` / `admin123` |
| Login real (bcrypt + JWT) | ✅ Hecho | `auth.service.ts`: `bcrypt.compare`, `JwtService.signAsync` |
| Refresh token con rotación | ✅ Hecho | hash SHA-256 persistido, revocación al rotar |
| `resolveEstateIds` (JWT scoping) | ✅ Hecho para Rol B | Rol C queda `[]` — depende de `owner_properties`, aún no existe |
| `JwtAuthGuard` / `RolesGuard` / `@Public()` / `@Roles()` | ✅ Hecho | `auth/guards/`, `auth/decorators/` |
| `EstateScopeGuard` (multi-tenant por endpoint) | ❌ No existe todavía | Previsto en `doc/plan.md` §2.4, no implementado |
| Módulos de dominio (Estates, Issues, Accounting...) | ❌ No existen | Solo `AppModule` + `AuthModule` + `PrismaModule` |
| Tablas Prisma más allá de Fase 0 | ❌ No existen | Solo `administrators`, `users`, `refresh_tokens`, `estates` |

**Conclusión**: la Fase 0 completa del roadmap de `doc/plan.md` está
terminada, y gran parte de la Fase 1 (auth backend) también. Lo que falta de
Fase 1 es exclusivamente el lado Angular.

### 1.2 Frontend (`src/app/`)

| Pieza | Estado |
|---|---|
| `HttpClient` / llamadas HTTP | ❌ No existe ninguna |
| `src/environments/` | ❌ No existe |
| `AuthService` Angular | ❌ No existe |
| Interceptors (`auth`, `error`, `loading`) | ❌ No existen |
| `DataService` (repositorio único sobre mocks) | ✅ Extenso y estable — 74 métodos públicos, un método por cada operación de dominio |
| `TenantContextService` / guards de ruta | ✅ Existen, pero son **defensa en profundidad del lado cliente sobre datos ya mockeados** — no sustituyen ninguna verificación real de servidor |

**Punto clave a favor**: el `DataService` actual, al ser el único punto de
acceso a datos desde hace varios commits, **ya tiene la forma que debería
tener un cliente de API real** — un método por operación, con nombres y
firmas estables (`listPropertiesByEstate(estateId)`,
`findMandateById(id)`, `createPaymentAgreement(input)`, etc.). Migrar a
backend real consiste, en gran medida, en **sustituir el cuerpo de cada
método** (hoy: filtrar arrays en memoria) **por una llamada HTTP con la
misma firma**, sin tener que tocar los componentes que ya lo consumen. Este
plan se apoya en esa propiedad para acotar el trabajo de integración fase a
fase (ver sección 4).

### 1.3 Los dos documentos de planificación existentes

| Documento | Qué cubre | Vigencia |
|---|---|---|
| `doc/plan.md` (912 líneas) | Arquitectura, decisión de stack, estrategia de auth/multi-tenancy, diseño de API, roadmap de 15 semanas / 11 fases, riesgos | **Vigente** en todo lo arquitectónico. Su **inventario de entidades (sección 3)** quedó desactualizado: fue escrito contra una versión de `models.ts` anterior a toda la serie de correcciones de esta sesión. |
| `docs/data-model.md` (2.188 líneas, cuerpo + 8 apéndices A–H) | Modelo de datos completo y verificado contra el frontend real, incluyendo cada gap detectado y su resolución razonada | **Fuente de verdad actual** para entidades, campos, enums y relaciones. |

Ejemplos concretos de desfase que hay que tener en cuenta al construir:

- `doc/plan.md` no conocía la entidad `User` con NIF/NIE europeo
  (`taxIdCountry`/`taxId`), `PropertyMembership` (N:M usuario↔propiedad con
  `isPrimaryContact` y `nickname`), `ExternalOwner` (titulares sin cuenta),
  ni `UserRepresentation` (representación legal) — asumía un modelo de
  `owner_properties.user_id` mucho más simple.
- `doc/plan.md` decía que `Communication.unread`/`Document.isNew` se
  resolvían con dos tablas nuevas `communication_reads`/`document_reads`.
  La decisión final (`docs/data-model.md`, Apéndice H) fue **una sola tabla
  genérica** `resource_reads(user_id, source_type, source_id, read_at)`
  compartida también por el feed de Alertas — evita triplicar el mismo
  mecanismo.
- `doc/plan.md` modelaba `Issue.provider`/`providerCategory`/... como
  columnas planas de `issues`. La decisión final (Apéndice G) las extrae a
  `issue_providers` (histórico de asignaciones, con FK opcional a
  `suppliers` y snapshot congelado).
- `doc/plan.md` no incluía en absoluto acuerdos de pago (`PaymentAgreement`
  / `PaymentAgreementInstallment`, Apéndice H) — el "acuerdo de pago" del
  frontend era puramente un cálculo en memoria hasta esta sesión.
- `doc/plan.md` decía "generación del fichero SEPA pain.008 pendiente de
  decidir cómo" (riesgo abierto #3). Ya se **prototipó un generador
  pain.008.001.02 completo en el frontend** (`SepaPain008Service`) como
  demo — pero esto es una decisión de seguridad importante que hay que
  corregir antes de construir el backend real (ver sección 3, Fase 6).
- `doc/plan.md` modelaba `Movement.account` como texto libre en la propia
  fila. La decisión final (Apéndice G) usa `accountCode` como FK real a
  `chart_accounts.code`.
- `doc/plan.md` no conocía `Ticket`/`TicketTimelineEntry` (el canal
  genérico rol C → rol B, distinto de `Issue`) ni `AdhesionRequest`
  formalizada con `status`/`resolvedByUserId`/`decision`.
- `doc/plan.md` no conocía `ActivityLogEntry` (feed de actividad híbrido:
  derivado + tabla ligera para eventos sin timeline propio).

### 1.4 `doc/not_designed_yet.md`

Checklist de ~30 botones/interacciones del frontend sin comportamiento real
(`onClick` vacío o solo un toast). Buena parte de esta lista **se resuelve
sola** al conectar cada pantalla a su endpoint real durante la fase
correspondiente (p. ej. "Aprobar"/"Rechazar" en Solicitudes de adhesión ya
tiene lógica real en `DataService.approveAdhesion`, solo falta que la
pantalla llame al backend en vez de mutar el mock). Un puñado de ítems
(campana de notificaciones, "Ver todo" del feed de actividad) no tienen
fase clara asignada — se marcan en la sección 5 como pendientes de decidir
en qué fase entran.

---

## 2. Regla de reconciliación (gobierna todo lo que sigue)

> **Arquitectura, stack, estrategia de auth/multi-tenancy, diseño general de
> API y roadmap de fases → manda `doc/plan.md`.**
> **Entidades, campos, enums, relaciones y reglas de negocio del modelo de
> datos → manda `docs/data-model.md`.**

Donde el modelo enriquecido de `docs/data-model.md` amplía el alcance de una
fase de `doc/plan.md` (por ejemplo, la Fase 2 ahora incluye
`property_memberships`/`external_owners`/`user_representations`, no solo
`owner_properties` simple), la fase se mantiene en el mismo lugar del
roadmap pero su alcance y duración estimada se ajustan — se indica
explícitamente en la sección 3 para cada fase afectada.

No hay contradicción real entre "tenant isolation" (Apéndice A de
`docs/data-model.md`) y "RLS descartado, scoping a nivel de aplicación"
(`doc/plan.md` §2.4): el trabajo del Apéndice A fue una **réplica del lado
cliente** sobre datos mockeados (para no filtrar datos entre tenants ya en
la capa de presentación mientras no hay backend). Es exactamente la
especificación de comportamiento que `EstateScopeGuard` +
`assertEstateAccess()` deben implementar del lado servidor — no un cambio
de decisión sobre RLS.

---

## 3. Plan de acción por fases (a partir de hoy)

### Fase 0.5 — Reconciliar el schema de Prisma ✅ APLICADA

**No existía en el roadmap original** porque `doc/plan.md` es anterior a la
mayoría de correcciones del modelo. Era indispensable hacerla **antes** de
seguir con la Fase 2, o se habría construido sobre una `owner_properties`
más pobre de la que ya se sabía que hacía falta.

**Estado**: aplicada. `backend/prisma/schema.prisma` pasó de 4 tablas
(Fase 0) a 42 tablas / 43 tipos, transcritas 1:1 desde
`src/app/core/models.ts`. Validado con `prisma validate`, `prisma generate`
y `prisma migrate diff --from-empty` (DDL completo inspeccionado
manualmente — acentos en enums vía `@map`, relaciones circulares
Administrator↔User, snapshots inmutables en `receipts`/`remesa_lines`,
`ChartAccount`/`Movement.accountId` como FK real). `npm run build`,
`npm run lint` y `npm test` pasan.

**Migración**: `backend/prisma/migrations/20260704000000_enrich_full_data_model/`
— autora combinando el DDL generado por Prisma (tablas/tipos nuevos) con
`ALTER TABLE` manuales para las 4 tablas que ya existían (baja de
`administrators.users_active`, alta de `vat_number`/`primary_user_id`;
alta de `tax_id_country`/`tax_id` en `users`; alta de `cif`/`creditor_*` en
`estates`). **Confirmada contra una instancia real de PostgreSQL 16**
(cluster local del sandbox, `service postgresql start`): `prisma migrate
deploy` aplica limpiamente de extremo a extremo y `prisma/seed.ts` corre
sin errores contra el esquema resultante (administradora, finca, usuario
admin, propietaria María García y su `PropertyMembership` sobre el piso
2B, todo persistido correctamente). Este paso detectó y corrigió dos
errores reales que la validación estática (`prisma validate`/`generate`/
`migrate diff --from-empty`) no había detectado: un orden incorrecto de
`CREATE TYPE` frente a los `ALTER TABLE` que los referencian, y dos
índices y una FK duplicados entre la sección manual y la autogenerada.

Decisiones de modelado no explícitas en el TS que hubo que resolver al
transcribir (documentadas también en la cabecera del propio
`schema.prisma`):
- `AccountingEstate`/`AdminFinca`/`PropertyView`/`LinkEstate`/
  `RemesaCandidate`/`Alert` siguen sin tabla — son proyecciones derivadas,
  igual que en el mock Angular.
- `Administrator.usersActive` se elimina como columna almacenada (Apéndice
  H: solo membresías `linked` computan; debe calcularse al vuelo).
- `PropertyEvent` cuelga de `Estate`, no de `Property` (un evento de junta
  es de la finca).
- `roles`/`user_roles` multi-rol (§2.3 de `docs/data-model.md`) queda
  fuera — es una decisión de diseño abierta (§21), no un gap resuelto;
  `User.role` sigue singular, tal cual lo tenía el `AuthService` ya
  implementado.
- Ajustes de usuario (`user_sessions`, `notification_prefs`,
  `privacy_prefs`, `integrations`) no se modelan todavía — no existe
  ninguna interfaz verificada en `models.ts` de la que transcribir.

Tareas cubiertas:
1. Ampliar `User` (hoy: `email`, `passwordHash`, `fullName`, `role`,
   `administratorId`, `phone`) con `taxIdCountry`/`taxId` (UNIQUE
   compuesto), y considerar el patrón A.3 acordado (NIF obligatorio solo
   cuando el usuario tiene una membresía con `isPrimaryContact=true`).
2. Añadir `PropertyMembership` (N:M usuario↔propiedad,
   `role_type`/`status`/`is_primary_contact`/`nickname`), sustituyendo a la
   idea original de `owner_properties.user_id` 1:N simple.
3. Añadir `ExternalOwner` (titulares sin cuenta) y `UserRepresentation`
   (representación legal con alcance/vigencia).
4. Unificar `properties`/`owner_properties` en una única tabla `properties`
   con los campos catastrales (Apéndice C: `via_type`, `via_name`,
   `street_number`, `staircase`, `floor`, `door`, `postal_code`,
   `municipality`, `cadastral_reference`...) — no las dos tablas paralelas
   que `doc/plan.md` proponía.
5. Formalizar `Mandate` con `umr`, `scheme`, `payment_type`,
   `debtor_iban`/`debtor_bic`, `status` extendido (`active`/`dormant`/
   `expired`/`revoked`/`pending_signature`), y `MandateAmendment`.
6. Añadir `Estate.cif`/`creditor_id`/`creditor_iban`/`creditor_bic`/
   `creditor_postal_address` (la comunidad, no la gestora, es el acreedor
   SEPA — Apéndice F).
7. Añadir `AdhesionRequest` formalizada (`status`, `resolved_by_user_id`,
   `decision`, `notes`) en vez del registro simple original.
8. Añadir `Ticket`/`TicketTimelineEntry` (canal genérico rol C → rol B).
9. Añadir `resource_reads` genérica (sustituye a los planeados
   `communication_reads`/`document_reads` separados).
10. Añadir `PaymentAgreement`/`PaymentAgreementInstallment`.
11. Añadir `IssueProviderAssignment`/`IssueNotification` (extraídos de
    `issues`).
12. Cambiar `Movement.account` (texto) → `Movement.account_code` (FK a
    `chart_accounts.code`) + `supplier_id` (FK real, no texto).
13. Añadir `DebtorAction` como tabla independiente (no embebida).
14. Añadir `ActivityLogEntry` (tabla ligera para eventos sin timeline
    propio).

`prisma/seed.ts` ampliado con un caso mínimo del modelo enriquecido
(propietario con NIF, propiedad con datos catastrales, membresía como
titular principal) — smoke test de extremo a extremo de las tablas nuevas.
No se ha poblado un caso de CADA entidad nueva (mandatos, tickets, acuerdos
de pago...) — eso se hace fase a fase, junto con la lógica de negocio de
cada módulo, no en este paso de solo-schema.

### Fase 1 — Cerrar autenticación ✅ APLICADA

El backend de esta fase ya estaba implementado (salvo `EstateScopeGuard`,
pospuesto a la Fase 2). El lado Angular se ha completado:

1. `src/environments/environment.ts` / `environment.development.ts`
   (`apiBaseUrl`, `mockRoleSwitch`) + `fileReplacements` en `angular.json`
   para la configuración `development`.
2. `provideHttpClient(withInterceptors([authInterceptor, errorInterceptor]))`
   en `app.config.ts`, más un `APP_INITIALIZER` que llama a
   `AuthService.restoreSession()` al arrancar (recupera la sesión desde el
   refresh token persistido, ya que el access token solo vive en memoria).
3. `AuthService` (`src/app/core/auth.service.ts`): `login()`, `refresh()`,
   `logout()`, `restoreSession()`; signals `currentUser`/`accessToken`
   (en memoria); refresh token persistido en `localStorage`.
4. `authInterceptor` (adjunta Bearer solo a peticiones a `apiBaseUrl`) y
   `errorInterceptor` (ante un 401 de la API propia, refresca el token una
   vez y repite la petición; si el refresh falla, cierra sesión y redirige
   a `/login`). No se implementó `loadingInterceptor` — no había ninguna UI
   de loading global que lo necesitara; se añadirá si una fase futura lo
   requiere.
5. `roleGuard` (`CanActivateFn`) protegiendo el árbol de rutas via
   `canActivateChild` en `app.routes.ts`; `StateService.currentRole` ahora
   deriva de `AuthService.currentUser()?.role`; `cycleRole()` queda
   restringido a `environment.mockRoleSwitch` (solo development).
6. Página de login real (`src/app/features/login/`); `/login` es la única
   ruta fuera del árbol protegido y se renderiza sin el shell/sidebar
   (`App.isLoginRoute` en `app.ts`/`app.html`).
7. Backend: `app.enableCors(...)` en `main.ts` — Fase 0 no lo necesitaba al
   no haber peticiones cross-origin; ahora el frontend (puerto 4200) y el
   backend (puerto 3000) son orígenes distintos.

**Verificado**: `tsc`/`ng build` sin errores en frontend y backend; `POST
/api/v1/auth/login` y `GET /api/v1/auth/me` probados por curl contra el
backend real devuelven exactamente la forma que `AuthService` espera;
preflight CORS (`OPTIONS`) confirmado con `Origin: http://localhost:4200`;
captura de pantalla de `/login` renderizando correctamente en Chromium
headless, sin el sidebar de la app autenticada.

**Pendiente, no bloqueante**: no se pudo automatizar el submit del
formulario de login end-to-end en este sandbox (herramientas de
automatización de navegador no disponibles) — recomendado como primer
smoke test manual antes de dar la fase por cerrada en un entorno con
navegador interactivo.

### Fase 2 — Estates, Properties, Memberships, Adhesion Requests ✅ APLICADA

Alcance ampliado respecto al original: incluye `PropertyMembership`,
`ExternalOwner`, `UserRepresentation`, la tabla `properties` unificada con
datos catastrales, y `PropertyView` (la proyección con JOINs ya
especificada en el Apéndice D de `docs/data-model.md`).

Implementado:
1. `EstateAccessService`/`EstateScopeGuard` (`backend/src/estate-access/`):
   multi-tenancy a nivel de aplicación (doc/plan.md §2.4). `user.estateIds`
   (claim del JWT) es la única fuente de verdad; rol A bypassa; el resto
   queda acotado a sus fincas. `EstateScopeGuard` cubre el caso común de un
   `:estateId` literal en la ruta; para recursos anidados (propiedad,
   titular externo) el servicio resuelve la finca propietaria y llama a
   `assertAccess` directamente.
2. `AuthService.resolveEstateIds` (rol C): antes devolvía `[]` — ahora
   calcula las fincas del usuario a partir de sus `PropertyMembership` con
   `status='linked'`, tal y como estaba previsto explícitamente para esta
   fase.
3. `EstatesModule`: `GET /estates` (listado acotado por tenant), `GET
   /estates/:estateId` , `POST /estates` (solo rol B, bajo su propia
   `administratorId`).
4. `PropertiesModule`: `GET /estates/:estateId/properties`, `GET
   /properties/:id`, `GET /properties/:id/view` (proyección Apéndice D:
   finca + gestora + contacto admin + membresía del usuario que consulta).
5. `PropertyMembershipsModule`: `GET /properties/:id/memberships`, `GET
   /properties/:id/memberships/primary-contact`, `GET
   /users/:userId/memberships`.
6. `ExternalOwnersModule`: `GET /estates/:estateId/external-owners` (join en
   dos pasos, ya que `ExternalOwner` no tiene `estateId` propio), `GET
   /external-owners/:id` (solo titulares no promovidos a usuario).
7. `UserRepresentationsModule`: `GET
   /users/:userId/representations/active`, `GET
   /users/:userId/representations/can-act-on-behalf-of/:representedUserId`
   (alcance global si `grantedEstateId`/`grantedPropertyId` son `null`, o
   acotado si coinciden con la finca/propiedad consultada).
8. `AdhesionRequestsModule`: `GET /estates/:estateId/adhesion-requests`
   (+`?status=pending`), `POST .../:id/approve` y `POST .../:id/reject`
   (ambos restringidos a roles A/B). Aprobar/rechazar son transacciones
   Prisma (`$transaction`) que además de actualizar `AdhesionRequest`
   escriben/revocan la `PropertyMembership` real — la metadata de la
   solicitud nunca sustituye al vínculo, que sigue viviendo únicamente en
   `property_memberships`.

**Corregido durante la verificación**: las primeras respuestas que incluían
`user` (vista de propiedad, membresías, solicitudes de adhesión) filtraban
`passwordHash` sin querer al usar `include: { user: true }` de Prisma —
solucionado con `omit: { passwordHash: true }` en todos los `include`
afectados. Es el tipo de fuga que la validación estática no detecta;
solo apareció al inspeccionar las respuestas JSON reales.

**Verificado end-to-end contra PostgreSQL real**: login y scoping correcto
para rol B (ve solo las fincas de su gestora) y rol C (ve solo las fincas
de sus membresías `linked`); creación de finca rechazada (403) para rol C;
acceso cross-tenant a una finca ajena rechazado (403); aprobar una
solicitud de adhesión crea la `PropertyMembership` (`status: 'linked'`);
rechazarla la revoca; reintentar sobre una solicitud ya resuelta devuelve
409; ausencia de `passwordHash` confirmada en las respuestas afectadas.

No implementado en esta fase (fuera de alcance, no bloqueante): endpoints
de creación/edición para `PropertyMembership`, `ExternalOwner` y
`UserRepresentation` (solo lectura por ahora — el alta real de estas
entidades hoy sigue ocurriendo vía seed/fixtures; se añadirá cuando el
frontend built out empiece a necesitarlos, probablemente junto con el
flujo de solicitud de adhesión en Fase 3+).

### Fase 3 — Issues (Incidencias) + Tickets ✅ APLICADA

Implementado (`backend/src/tickets/`, `backend/src/issues/`):

1. `TicketsModule`:
   - `POST /tickets` — genera `ref` secuencial `#TIC-<año>-NNN`, estado
     inicial `Abierta` y siembra el timeline con la descripción como
     primer mensaje del creador (paridad con `DataService.createTicket`).
   - `POST /tickets/:id/messages` — añade entradas al timeline con
     `authorRole` derivado del rol de plataforma (C → `Propietario`,
     A/B → `Administrador`).
   - `PATCH /tickets/:id/status` — solo lado gestor (403 para rol C);
     `Resuelta`/`Cerrada` fijan `closedAt` y generan la entrada
     `status_change` de autor `Sistema`, como el mock.
   - `GET /tickets/:id`, `GET /users/:userId/tickets` — un ticket es
     visible para su creador, su asignado y los roles A/B con acceso a
     la finca de la propiedad (el canal es C→B: ambos extremos leen el
     hilo completo).
2. `IssuesModule`:
   - `GET /estates/:estateId/issues` (vía relación `property.estateId`),
     `GET /properties/:propertyId/issues`, `GET /issues/:id` (detalle con
     fotos, timeline, histórico de proveedores y notificaciones).
   - `POST /issues/:id/provider` (roles A/B) — transaccional: cierra la
     asignación vigente poniendo su `unassignedAt = assignedAt` de la
     nueva, y congela el snapshot nombre/categoría/teléfono (Apéndice G,
     gap #12; `supplierId` opcional para proveedores ad-hoc).
     `GET .../provider` (vigente) y `GET .../provider/history`.
   - `POST /issues/:id/notifications` (roles A/B) — registra el histórico
     de envíos (Apéndice G, gap #11). `GET .../notifications` para el
     listado; contador y último envío se derivan del listado en el
     cliente. El envío real por email/push/sms queda para la fase de
     integraciones — hoy solo existe el registro, que es lo que el
     frontend consume.

No implementado aún (consciente): creación de `Issue` vía API y la
promoción Ticket("Incidencia") → Issue — el mock tampoco los tiene como
métodos de `DataService`; se añadirán cuando el flujo de alta de
incidencias del frontend se conecte (la decisión Ticket vs Issue del
riesgo cerrado #1 de `doc/plan.md` sigue vigente).

**Verificado end-to-end contra PostgreSQL real**: flujo completo de ticket
C→B (crear con ref `#TIC-2026-001`, responder como B, resolver con
`closedAt` y timeline de 3 entradas), 403 al cambiar estado como rol C,
doble asignación de proveedor con cierre automático de la primera
(histórico correcto), 403 al asignar proveedor como rol C, y registro y
lectura de notificaciones (24 destinatarios, canal email).

### Fase 4 — Accounting: resumen + periodos + recibos ✅ APLICADA

Implementado (`backend/src/accounting/`):

1. `GET /estates/:estateId/accounting/summary` — proyección
   `AccountingEstate` derivada en consulta (§7.1 de `docs/data-model.md`):
   `income`/`expenses` agregados de `movements`, `balance` calculado,
   `delinquency` como suma de recibos `Pendiente`/`Devuelto`, `units`
   contadas; `reserveTarget`/`iban` desde `Estate`. **Simplificación
   consciente**: `reserve` se aproxima al balance hasta que la Fase 5
   traiga el plan contable con cuentas de reserva diferenciadas.
2. `GET /estates/:estateId/accounting/periods` — sin enum de estado: el
   estado del periodo se infiere de `issuedAt`/`closedAt`, como en el
   schema.
3. `POST /estates/:estateId/receipts/generate` (roles A/B) — generación
   masiva idempotente: upsert del periodo por `(estateId, periodKey)`, un
   recibo de cuota ordinaria por propiedad activa con `quotaMonthly > 0`
   (las ya facturadas se omiten), numeración secuencial `YYYY/MM-NNN`, y
   **snapshot congelado en la transacción de emisión** (nombre/NIF/país/
   IBAN — patrón FK-viva + snapshot inmutable, Apéndice B). El titular
   sale de la membresía `linked` con contacto principal; si la unidad no
   tiene usuario en plataforma, el `ExternalOwner` no promovido aporta el
   snapshot y la FK viva queda en null (personas jurídicas, herederos).
4. `GET /estates/:estateId/receipts?periodKey=&status=&page=&pageSize=` —
   paginado.
5. `PATCH /receipts/:id` (roles A/B) — registro manual de cobro/
   devolución: el DTO solo admite `status`/`method`/`returnCode`/
   `returnReason`; al marcar `Devuelto` sin método explícito se fija
   `Devolución` automáticamente. Importe y snapshots son intocables tras
   la emisión.
6. `GET /users/:userId/receipts` — vista del rol C vía la FK viva
   `ownerUserId` (un usuario solo ve los suyos; A/B quedan acotados a sus
   fincas).

**Verificado end-to-end contra PostgreSQL real**: generación del periodo
2026-07 con snapshot correcto (María García, NIF 12345678Z/ES) y FK viva
poblada; re-generación idempotente (0 creados, 1 omitido); morosidad
derivada reflejando el ciclo Pendiente → Pagada → Devuelto (AM04); 403
para rol C tanto en generación como en el PATCH; y vista del propietario
con sus propios recibos.

### Fase 5 — Movimientos + conciliación bancaria ✅ APLICADA

Implementado (`backend/src/movements/`), todo restringido a roles A/B (el
libro mayor no es visible para el rol C):

1. `GET`/`POST /estates/:estateId/movements` — alta con saldo corrido
   recalculado en transacción (el `balance` es derivado, doc/plan.md §4);
   el signo lo determina el tipo (income +, expense/transfer −). La API
   habla `accountCode` y el servicio lo resuelve a la FK real
   (`chart_accounts`, catálogo global `administratorId=null` con
   prioridad para cuentas propias del tenant). La etiqueta
   `'628 · Suministros'` se deriva por JOIN — nunca se almacena.
2. `GET /chart-accounts` — catálogo con `label` derivado.
3. `POST /estates/:estateId/bank-extracts/import` — lote JSON con
   `importBatchId` común. El parseo de CSV/Norma 43 en servidor queda
   para la fase de integraciones bancarias; el contrato de persistencia
   ya está definido.
4. `GET /estates/:estateId/bank-extracts` — con `matchedMovementId`/
   `matchMethod` derivados de `reconciliations`.
5. `POST /estates/:estateId/bank-extracts/auto-match` — matching voraz
   1:1 por igualdad de importe (tolerancia 0.01), la misma regla del
   prototipo Angular; parejas registradas con `matchMethod 'auto'`.
6. `POST`/`DELETE /bank-extracts/:id/reconcile` — vínculo manual y
   desvinculación; `Movement.reconciled` se mantiene en sincronía
   transaccional con la tabla `reconciliations` (409 al conciliar dos
   veces la misma entrada o el mismo movimiento).
7. `GET`/`POST /estates/:estateId/budget` — partidas por ejercicio con
   `executed` **derivado** de los movimientos de la cuenta en el año
   (la columna no existe en la tabla, como decidió el plan).

**Bug corregido de la Fase 4 durante la verificación**: el resumen
contable doblaba los gastos (`income - expenses` con gastos ya en
negativo → balance 207.5 en vez de -32.5). Ahora `balance` es la suma
directa de importes con signo y `expenses` se expone en valor absoluto.

**Verificado end-to-end contra PostgreSQL real**: saldo corrido correcto
(+87.5 → −32.5), auto-match de 1 de 2 entradas del extracto, conciliación
manual con 409 al repetir y desvinculación limpia, presupuesto con
`executed` 120 derivado del movimiento de suministros, 403 para el rol C
en todos los endpoints, y resumen contable corregido.

### Fase 6 — SEPA / Remesas ✅ APLICADA

Esta fase tiene el cambio más importante respecto a `doc/plan.md`, que
dejaba la generación del pain.008 como "riesgo abierto #3, decidir cómo".
Ya se prototipó un generador **completo y funcional** en el frontend
(`SepaPain008Service`, con agrupación por `SeqTp`, validación de CID
español vía ISO 7064, snapshots inmutables, `AmdmntInd`) — pero como demo
sin backend real detrás.

**Esto debe re-implementarse en el servidor, no mantenerse en el cliente**,
por dos razones:
1. **Seguridad**: el fichero pain.008 final se sube a la banca electrónica
   de la comunidad y contiene IBANs de todos los propietarios. No puede
   depender de que el navegador de un admin genere correctamente ese XML
   sin posibilidad de manipulación — la generación debe ocurrir en un
   entorno controlado por el servidor, con los datos leídos directamente
   de la base de datos (no de lo que el cliente afirma).
2. **Integridad del snapshot**: el patrón FK-viva + snapshot-congelado solo
   tiene sentido si el snapshot se congela en el momento de escritura en
   servidor (transacción atómica al presentar la remesa), no en un cálculo
   del lado cliente que podría ejecutarse en momentos distintos con datos
   distintos.

**✅ APLICADA** (`backend/src/sepa/`). Los 5 puntos del plan, tal y como
quedaron:

1. **Port de `SepaPain008Service`** — 1:1 (agrupación por SeqTp, escapado
   XML, límites de longitud SEPA, `AmdmntInd` con `OrgnlMndtId`/
   `OrgnlDbtrAcct`), ahora como servicio NestJS puro sin acceso a mocks.
2. **Ciclo de vida de mandatos (36 meses, Apéndice F)** — `expired` si
   firmado y nunca usado; `dormant` si sin cargo reciente. Aplicado por
   barrido diario (timer propio con `unref()`, **sin** `@nestjs/schedule`
   para no añadir dependencia — `node_modules` está trackeado en git y un
   `npm install` habría metido miles de ficheros al repo) y también de
   forma síncrona antes de calcular candidatos o presentar una remesa.
   `computeSeq`: OOFF para oneOff, FRST sin primer uso, RCUR después;
   FNAL siempre manual.
3. **CID ISO 7064 validado en servidor** como control final (mod 97-10
   streaming, mismo algoritmo que el cliente).
4. **`GET /remesas/:id/file`** sirve el XML persistido en
   `remesas.xml_content` al presentar — nunca regenerado, preservación
   byte a byte de lo que vio el banco.
5. **Cifrado de IBAN en reposo — decisión tomada: AES-256-GCM a nivel de
   aplicación** (no pgcrypto): la clave (`SEPA_ENC_KEY`, 64 hex; fallback
   scrypt de `JWT_SECRET` solo para desarrollo, con warning) nunca toca
   la base de datos, así que un dump/backup robado no expone IBANs, y el
   código sigue siendo Prisma normal sin raw SQL. Formato
   `'enc:v1:'+base64(iv|tag|ct)` en `mandates.debtor_iban` y
   `estates.creditor_iban` (migración
   `20260705000000_sepa_iban_encryption_remesa_xml` ensancha ambas a
   VARCHAR(255) y añade `remesas.xml_content`). Las APIs de listado solo
   devuelven el IBAN enmascarado (`ES76 ···· 5766`); el completo solo
   existe dentro del pain.008 generado en servidor. Los `ibanSnapshot`
   de `remesa_lines` se guardan enmascarados (el XML persistido ya
   contiene el dato legal completo).

**Presentación de remesa = transacción atómica**: snapshots de línea
congelados, XML generado con datos descifrados leídos de la BD (no de lo
que afirme el cliente), amendments pendientes consumidos
(`pendingInFirstNextRemesa → false`) y `firstUseAt`/`lastUseAt`
actualizados — todo o nada.

**Verificado end-to-end contra PostgreSQL real**: XML correcto (bloque
FRST, CID `ES26ZZZG12345678` válido, CtrlSum 87.50, `AmdmntInd true` con
el IBAN original descifrado); cifrado confirmado por SQL directo
(`enc:v1:...` en ambas columnas); segundo ciclo con RCUR y
`AmdmntInd false` (amendment consumido); histórico con contadores
derivados de líneas; 403 para rol C en mandatos y remesas.

**Pendiente consciente**: gestión de devoluciones por línea (pain.002/
retorno bancario → `RemesaLine.status 'Devuelto'` + recibo `Devuelto`)
se hará junto con morosidad en la Fase 7; alta/edición de mandatos vía
API cuando el frontend lo necesite.

### Fase 7 — Proveedores + Morosidad + Acuerdos de pago ✅ APLICADA

Implementado (`backend/src/debtors/`), todo roles A/B con scoping por
tenant/finca (el presupuesto ya se hizo en la Fase 5 dentro de
`movements/`):

1. `GET /suppliers` — proveedores del tenant; `lastInvoice`/`lastAmount`/
   `ytdSpend` **derivados** de los movimientos vinculados por
   `supplierId` (nunca almacenados); `pendingInvoices` en 0 hasta que
   exista un modelo de factura de proveedor.
2. `GET /debtors`, `GET /estates/:estateId/debtors` — morosidad;
   `amount`/`interest` persistidos tal y como quedó en el schema (la
   derivación desde recibos impagados que sugiere `docs/data-model.md`
   §10.1 como vista materializada queda como mejora futura).
3. `GET`/`POST /debtors/:id/actions` — gestiones ordenadas por fecha
   desc; el alta actualiza `lastContact` del deudor en la misma
   transacción (mejora deliberada sobre el mock, que lo dejaba
   desincronizado del histórico).
4. `GET`/`POST /debtors/:id/agreement` — el acuerdo y TODAS sus cuotas
   se crean en una transacción: entrada como `seq 0` en la primera
   fecha, cuotas mensuales `seq 1..N`, redondeo a 2 decimales con el
   último plazo absorbiendo la diferencia (misma fórmula del mock). Un
   solo acuerdo activo por deudor (409); la entrada no puede igualar o
   superar el total.
5. `PATCH /payment-installments/:id/paid` — 409 si ya pagada; al quedar
   todas pagadas el acuerdo pasa a `completed` automáticamente.
   `POST /payment-agreements/:id/cancel` — solo acuerdos `active`.
   El estado `breached` sigue reservado sin transición automática,
   igual que en el mock.
6. `PATCH /remesa-lines/:id/return` — **cierra el pendiente consciente
   de la Fase 6**: la devolución bancaria marca la línea `Devuelto`,
   propaga al recibo (`Devuelto` + método `Devolución` + código de
   retorno) y pasa la remesa a `Con devoluciones`, en una transacción.

**Verificado end-to-end contra PostgreSQL real**: stats de proveedor
derivadas (ytd 120 del movimiento de suministros), acción de deudor
actualizando `lastContact`, acuerdo 183.75 = 30 de entrada + 3×51.25,
409 al intentar un segundo acuerdo activo, pago completo con transición
automática a `completed`, 409 en doble pago y en cancelación de un
completado, y devolución AM04 propagada a línea, recibo y remesa.

### Fase 8 — Amenities / Reservas ✅ APLICADA

Implementado (`backend/src/amenities/` + migración
`20260705120000_bookings_anti_overlap`):

1. **Anti-solapamiento real a nivel de base de datos**: `EXCLUDE USING
   gist` (extensión `btree_gist`) sobre `(amenity_id, date,
   int4range(start, end))` con `WHERE status <> 'cancelled'`, más un
   `CHECK end > start`. Corrección respecto al DDL de `doc/plan.md`, que
   proponía un índice único parcial sobre `(amenity_id, date,
   start_slot)` — eso solo bloquea dos reservas con el MISMO inicio, no
   un solape de rangos (10-12 vs 11-13). La exclusion constraint cubre
   ambos casos y es inmune a condiciones de carrera entre peticiones
   concurrentes.
2. `GET /estates/:estateId/amenities` — accesible al rol C (residente),
   además de A/B.
3. `GET /amenities/:id/availability?date=` — slots ocupados ese día por
   reservas no canceladas de cualquier usuario.
4. `POST /bookings` — validaciones de negocio en el servicio (slots del
   catálogo de la amenity, `maxHours`, `capacity`); el anti-solape se
   delega en la constraint (violación 23P01 → 409).
5. `GET /bookings` (propias) y `PATCH /bookings/:id/cancel` (el dueño o
   un rol A/B de la finca). Cancelar libera el hueco, porque la
   constraint excluye las canceladas.

**Verificado end-to-end contra PostgreSQL real**: reserva 10-12 como rol
C; 409 en solape parcial 11-12 (el caso que el índice del plan original
no habría detectado); 400 por exceso de horas, aforo y slot fuera de
catálogo; disponibilidad correcta; cancelación liberando el hueco (la
misma franja entra después con 201); 409 en doble cancelación.

**Fuera de alcance consciente**: CRUD de amenities (alta/edición por el
gestor) — el catálogo se gestiona por seed/fixtures hasta que la
pantalla correspondiente del frontend exista.

### Fase 9 — Comunicaciones + Documentos + Alertas + Activity Log ✅ APLICADA

Implementado (`backend/src/resources/`) con las decisiones ya tomadas del
Apéndice H:

1. **`resource_reads` única** (PK compuesta `userId+sourceType+sourceId`,
   gap #18/#19 Opción A): la misma fila resuelve la lectura en
   Comunicados, Documentos y Alertas — marcar leído en una pantalla lo
   marca en todas (verificado). `POST /resource-reads` idempotente.
2. **Alertas 100% derivadas** (gap #7, sin tabla): UNION de recibos
   propios (urgente si `Pendiente`), incidencias de propiedades `linked`
   (urgente si activa+`Urgente`), comunicados y documentos de las fincas
   del usuario (los documentos ya vistos desaparecen del feed) y eventos
   futuros de finca. Corrección sobre el mock: `event.sourceId` apunta a
   `property_events.id` real — los ids sintéticos `${pid}:next` del mock
   no cabían en la columna Uuid. `GET /alerts`, `POST /alerts/read-all`.
   **La campana del TopBar reutiliza `GET /alerts` con badge de conteo —
   sin pantalla ni endpoint nuevos** (la decisión propuesta, aplicada).
3. **Feed de actividad híbrido** (gap #17 Opción C): derivado de fuentes
   reales + filas explícitas de `activity_log` SOLO para eventos sin
   timeline propio. Los únicos escritores son approve/reject de
   adhesiones (Fase 2), que ahora insertan su entrada en la misma
   transacción. `GET /activity?limit=`.
4. `GET`/`POST /estates/:id/communications` y `/documents` — lectura para
   cualquier rol con acceso a la finca (C incluido); publicación solo
   A/B; `read`/`isNew` calculados por usuario.

**Verificado end-to-end contra PostgreSQL real**: publicación por B, 403
para C, alertas mezclando 4 tipos (2 urgentes), lectura cruzada
comunicados↔alertas, read-all dejando 0 no leídas y ocultando la alerta
del documento visto, markRead idempotente, y actividad mezclando
recibos/comunicados/incidencias/documentos.

### Fase 10 — Rol A + Suscripción ✅ APLICADA

Implementado (`backend/src/admins/`):

1. Panel de plataforma (rol A): `GET/POST /admins`, `GET/PATCH
   /admins/:id`, `PUT /admins/:id/billing`. `usersActive` SIEMPRE
   derivado (usuarios distintos con membresía `linked` — Apéndice H) y
   `fincas` como proyección de `estates`.
2. Mutaciones de soporte con **MRR recalculado en servidor** desde el
   catálogo (`plans.catalog.ts` — fuente de verdad única; el frontend
   tenía dos copias divergentes que la Fase 11 debe sustituir por
   `GET /plans`): alta con defaults del primer tramo, descuento, cambio
   de plan, ampliación de tramo validada (400 si no existe), bloqueo/
   desbloqueo y prórroga. Cada cambio deja su entrada en
   `admin_activity_log`.
3. `GET /admins/:id/invoices` (A cualquiera; B solo la suya),
   `GET /subscriptions/me` (rol B: plan/tramo/usersActive/vencimiento),
   `GET /plans`.

**Verificado end-to-end contra PostgreSQL real**: usersActive derivado,
403 de B en /admins, alta STANDARD (<50, mrr 129), descuento 20% →
79.2, cambio a PREMIUM → 199.2, tramo inexistente → 400, actividad
completa registrada (signup/discount/plan_change/block), y facturas
ajenas denegadas.

**Fuera de alcance consciente**: addons y facturación recurrente real
(generación de AdminInvoice por ciclo) — dependen de decisiones de
pricing aún abiertas en `doc/plan.md`; el modelo ya los soporta.

---

## 3.b Fases nuevas — cierre funcional y cumplimiento legal (añadidas tras revisar la planificación)

Las fases 0.5–9 dejan el **backend** funcional, pero la aplicación
completa no lo es todavía: el frontend sigue 100% mock salvo el login, no
hay gestión de ficheros reales, y no se ha hecho trabajo explícito de
cumplimiento RGPD/LOPDGDD ni de las obligaciones propias de la
administración de fincas en España. Estas fases cierran esa distancia.

### Fase 11 — Integración frontend completa ✅ APLICADA

Decisión tomada: **refactor asíncrono completo** (frente a la caché
hidratada). Aplicado:

1. `DataService` reescrito íntegro como cliente HTTP asíncrono — los ~74
   métodos conservan nombre pero devuelven Promises contra los endpoints
   reales, con traducción de enums en la frontera (Prisma sin acentos ↔
   display con acentos), fechas normalizadas y adaptadores de forma.
   Cero imports de `mock-data` en `core/`.
2. `TenantContextService` deriva del JWT (AuthService) — sin constantes
   mock.
3. Los 14 componentes consumidores adaptados: signals vacíos + carga en
   `ngOnInit`/al abrir drawers, mutaciones `async` con recarga. La
   generación pain.008 del cliente (recibos-tab) se sustituyó por la
   remesa en servidor de la Fase 6.
4. `tsc` y `ng build` en verde; backend + frontend arrancados juntos con
   login real.

**Pendiente que se traslada a fases posteriores** (con `TODO(backend)` en
código): alta de Issue vía API, recibo manual, catálogo público de
fincas para el wizard de vinculación, edición de estado/presupuesto de
incidencia, y limpieza final de `mock-data.ts` (ya no lo importa nada de
`core/`, pero el fichero sigue existiendo).

### Fase 12 — Ficheros reales ✅ APLICADA

`StorageService` (driver disco local, `STORAGE_DIR`; un driver S3/MinIO
real solo sustituye esta clase — el campo persistido sigue siendo la
clave opaca `s3Key`). Upload multipart de documentos
(`POST /estates/:id/documents/upload`, roles A/B) y fotos de incidencia
(`POST /issues/:id/photos`), descargas autorizadas por el scoping de
finca, allowlist de MIME y límite de 10 MB. Verificado end-to-end
(subida por B, descarga byte-idéntica por C, 403/400). Pendiente: render
de recibos a PDF.

### Fase 13 — Cumplimiento RGPD / LOPDGDD ✅ APLICADA

Código: `GET /gdpr/me/export` (portabilidad art. 20), `POST
/gdpr/me/erasure` (supresión art. 17 con la excepción 17.3.b:
anonimización irreversible del perfil, FK viva anulada, snapshots
legales conservados hasta vencer plazo; cuentas A/B → baja gestionada),
y `data_access_log` append-only (art. 32) registrando accesos a
mandatos, morosidad, pain.008, export y supresión.

Documental: `doc/compliance/rgpd.md` — roles responsable/encargado/
sub-encargado con DPAs art. 28, registro de actividades art. 30 con
bases jurídicas (LPH, no consentimiento, para la gestión ordinaria),
tabla de plazos de conservación, procedimiento de brechas 72h AEPD y
doctrina AEPD de morosidad. Pendiente: job de retención que seudonimice
snapshots vencidos, y plantillas DPA en el onboarding.

### Fase 14 — Obligaciones LPH ✅ APLICADA

Fondo de reserva mínimo (art. 9.1.f): `reserveLegalMinimum`/`
reserveBelowLegalMinimum` en el resumen contable (10% del presupuesto
del ejercicio; null sin presupuesto). Certificado de deudas (art.
9.1.e): `GET /properties/:id/debt-certificate` auditado. Facturación
RD 1619/2012: `POST /admins/:id/invoices` con numeración correlativa
anual sin huecos e IVA 21%. `doc/compliance/lph.md` documenta juntas/
actas (arts. 16/19), Ley 10/2010 y seguro RC. Pendiente: render PDF de
certificado y facturas, generación del documento de convocatoria.

### Fase 15 — Endurecimiento de producción ✅ APLICADA (base)

Rate limiting de login (5/min por IP+email → 429, in-memory — sin Redis
por decisión de stack), cabeceras de seguridad sin helmet (nosniff,
X-Frame-Options, Referrer-Policy, HSTS en producción),
`forbidNonWhitelisted` en la validación global, y
`backend/scripts/smoke-e2e.sh` (flujo crítico para CI/post-deploy).
Pendiente operativo (infraestructura, no código): TLS terminado en el
proxy, backups automatizados y probados de PostgreSQL, secretos
(`SEPA_ENC_KEY`, `JWT_SECRET`) en secret manager, y monitorización.

**Orden recomendado**: 10 → 11 → 12 → 13 → 14 → 15. La 13 puede
solaparse con la 11/12 en su parte documental; la 14 necesita la 10
(AdminInvoice) y la 12 (documentos versionados).

---

## 4. Patrón operativo de migración (aplica a todas las fases)

Para cada fase:

1. **Backend**: crear el módulo NestJS (`Controller` → `Service` →
   `Repository`/Prisma) siguiendo el diseño de endpoints ya especificado en
   `doc/plan.md` §4, ajustado a las entidades reales de
   `docs/data-model.md`.
2. **Frontend — por cada método de `DataService` de esa fase**: sustituir
   el cuerpo (hoy: `Array.filter`/`.find` sobre un mock) por una llamada
   `HttpClient`, **manteniendo el nombre y la firma del método** siempre
   que sea razonable. Los componentes que ya llaman a `this.data.xxx()` no
   deberían necesitar cambios más allá de manejar la naturaleza asíncrona
   (`Observable`/`signal` en vez de valor síncrono) — es el motivo por el
   que se ha mantenido `DataService` como fachada única durante toda esta
   sesión.
3. **Cerrar los botones muertos de `doc/not_designed_yet.md`** que
   pertenezcan al dominio de esa fase (ver mapeo aproximado):
   - Fase 2: "Aprobar"/"Rechazar" adhesión, filas de propiedad clicables.
   - Fase 3: "Reportar incidencia" (header), acciones rápidas del rol C.
   - Fase 4-7: "Exportar libro/Excel", "Nuevo apunte" (cabecera),
     "Registrar factura", "Nuevo proveedor", filas de proveedor clicables,
     "Editar presupuesto", "Editar recibo", "Adjuntar factura", "Ver
     justificante".
   - Fase 9: "Pagar ahora" (banner y tarjeta), "Marcar como leídos" (ya
     resuelto del lado frontend en esta sesión, falta conectar al backend),
     ítems de comunicado/documento clicables, campana de notificaciones,
     "Ver todo" del feed de actividad.
   - Fase 2 (Alertas Rol B): CTAs de cada alerta ("Asignar proveedor", "Ver
     remesa", "Gestionar morosidad", "Generar recibos", "Convocar junta")
     — navegación real a cada módulo, no toast genérico.
4. **Prueba de humo verificable** (criterio de "hecho" de cada fase): el
   mismo criterio ya definido en `doc/plan.md` §6, sin cambios.

---

## 5. Riesgos y decisiones abiertas (actualizado)

Heredados de `doc/plan.md` §7 (siguen abiertos, sin cambios):
1. Proveedor de hosting (PaaS con Postgres administrado vs VPS propio).
2. Backups (RPO/RTO) — decidir antes de la Fase 4 (primeros datos
   contables reales).
3. Notificaciones reales (email/SMS/push) — fuera del alcance de esta
   ronda de fases, tratar como fase 11 separada.
4. RLS de PostgreSQL como mejora futura de defensa en profundidad.

Nuevos, derivados del trabajo de esta sesión sobre el modelo de datos:
5. **Generación del pain.008 debe ser server-side, no cliente** (sección 3,
   Fase 6) — ya no es "decidir cómo generar el XML" sino "portar el
   generador ya prototipado del cliente al servidor y no exponerlo como
   lógica de negocio ejecutable en el navegador".
6. **Cifrado de IBAN en reposo se vuelve más urgente**: el modelo ahora
   persiste IBAN completo en `Mandate.debtorIban` y `Estate.creditorIban`
   (antes `doc/plan.md` asumía `iban_masked`, un enmascarado que reduce el
   problema pero no lo resuelve realmente). Decidir `pgcrypto` vs cifrado
   de aplicación antes de la Fase 6.
7. **Los datos bancarios de la comunidad** (`Estate.creditorId`/
   `creditorIban`/`creditorBic`) requieren control de acceso más estricto
   que el resto de campos de `Estate` — solo el rol B de esa finca y el
   propio proceso de generación de remesa deberían poder leerlos en claro;
   evaluar si necesitan una tabla separada con permisos Prisma/RLS
   distintos en vez de vivir como columnas planas de `estates`.
8. **Snapshot de recibos/mandatos**: confirmar en Fase 4/6 que el backend
   nunca "rehidrata" `ownerNameSnapshot`/`ownerTaxIdSnapshot`/`ibanSnapshot`
   desde `users` al servir una lectura — deben escribirse una única vez, en
   la transacción de emisión, y no tocarse después. Este es un requisito
   legal (recibo regenerable idéntico años después), no solo de estilo.

---

## 6. Próximos 3 pasos inmediatos

1. ~~Confirmar la migración de la Fase 0.5 contra una base de datos real~~
   — **hecho**: `migrate deploy` y `prisma/seed.ts` corren limpiamente
   contra PostgreSQL 16 real.
2. ~~Arrancar la Fase 1 del lado frontend~~ — **hecho**: `environments/`,
   `AuthService`, interceptors, `roleGuard`, página de login real. Ver
   detalle en la sección "Fase 1" de más arriba.
3. ~~Empezar la Fase 2~~ — **hecho**: `EstateScopeGuard`,
   `EstateAccessService`, y los módulos de Estates/Properties/
   PropertyMemberships/ExternalOwners/UserRepresentations/AdhesionRequests.
   Ver detalle en la sección "Fase 2" de más arriba.
4. ~~Empezar la Fase 3~~ — **hecho**: `TicketsModule` e `IssuesModule`
   completos y verificados. Ver detalle en la sección "Fase 3" de más
   arriba.
5. ~~Empezar la Fase 4~~ — **hecho**: resumen derivado, periodos y
   recibos con generación masiva idempotente y snapshot inmutable. Ver
   detalle en la sección "Fase 4" de más arriba.
6. ~~Empezar la Fase 5~~ — **hecho**: movimientos con saldo corrido,
   extracto bancario, conciliación auto/manual y presupuesto. Ver detalle
   en la sección "Fase 5" de más arriba. **Pendiente heredado**: `reserve`
   en el summary sigue aproximada al balance — ahora que el plan contable
   está operativo (cuenta 113), puede refinarse a la suma de movimientos
   de las cuentas de reserva cuando se decida la convención.
7. ~~Empezar la Fase 6~~ — **hecho**: pain.008 en servidor, ciclo de
   vida de mandatos, CID en servidor, XML persistido y cifrado de IBAN
   AES-256-GCM a nivel de aplicación (decisión tomada, ver sección
   "Fase 6"). Recordatorio operativo: configurar `SEPA_ENC_KEY` (64 hex)
   en producción — el fallback derivado de JWT_SECRET es solo para
   desarrollo.
8. ~~Empezar la Fase 7~~ — **hecho**: proveedores con stats derivadas,
   morosidad, acuerdos de pago transaccionales y devoluciones por línea
   de remesa (cerrando el pendiente de la Fase 6). Ver sección "Fase 7".
9. ~~Empezar la Fase 8~~ — **hecho**: amenities + reservas con exclusion
   constraint GiST real. Ver sección "Fase 8".
10. ~~Empezar la Fase 9~~ — **hecho**: `resource_reads` única, alertas y
    actividad derivadas, activity_log solo para adhesiones, y la campana
    reutilizando `GET /alerts`. Ver sección "Fase 9".
11. ~~Empezar la Fase 10~~ — **hecho**: panel de plataforma rol A,
    suscripción rol B y catálogo de planes único. Ver sección "Fase 10".
12. ~~Fases 11-15~~ — **hechas**: integración frontend completa
    (refactor asíncrono), ficheros reales, RGPD/LOPDGDD, obligaciones
    LPH y endurecimiento base de producción. **El plan está completo.**
    Trabajo restante conocido: los `TODO(backend)` del frontend (alta de
    Issue, recibo manual, catálogo de vinculación), render a PDF
    (recibos, certificados, facturas), job de retención RGPD, driver S3
    real, y la parte de infraestructura de la Fase 15 (TLS, backups,
    secret manager, monitorización).
