# Plan: Backend + API + Base de Datos — Domora Design

> Alcance: exclusivamente el repositorio `domora-design` (frontend Angular standalone). Este plan reemplaza un borrador anterior (generado en una sesión previa de Copilot Chat) que proponía una arquitectura de 26 semanas con BFF separado, Keycloak/Auth0, RLS obligatorio desde el día 1 y Redis. Ver justificación de los cambios en la sección 1.2.

---

# 1. Resumen ejecutivo

### 1.1 Contexto

Domora Design es hoy un frontend Angular standalone, 100% mock-data (`src/app/core/mock-data.ts`), sin `HttpClient`, sin capa de autenticación real y sin backend. El `StateService` actual gestiona `currentRole` con un signal local y un método `cycleRole()` puramente de demo, sin sesión ni JWT. El objetivo de este plan es dotar a la aplicación de un backend real (API + base de datos) que sirva los tres roles ya modelados en el frontend (A = gestoras/admin de plataforma, B = admin de finca, C = propietarios/residentes), sustituyendo los catálogos mock por datos persistidos, sin alterar la experiencia de usuario ya diseñada.

### 1.2 Decisión de stack final

| Capa | Decisión | Estado |
|---|---|---|
| Backend framework | **NestJS** (Node.js + TypeScript) | Confirmado |
| ORM | **Prisma** | Confirmado |
| Base de datos | **PostgreSQL** | Confirmado |
| Topología de servicios | **API monolítica única**, sin BFF separado | Confirmado |
| Autenticación | **JWT propio** (access token en memoria, refresh token en `localStorage`), gestionado por un `AuthService` Angular propio | Confirmado |
| Multi-tenancy | `estate_id` como filtro explícito a nivel de servicio/repositorio NestJS (sin RLS de PostgreSQL en el lanzamiento) | Confirmado |
| Almacenamiento de adjuntos | **S3** (o equivalente compatible), exclusivamente para fotos/adjuntos de incidencias | Confirmado |
| Caché / colas | Ninguna (sin Redis) en el lanzamiento | Confirmado |
| Timeline | **15 semanas**, 11 fases (0–10) | Confirmado |

Este plan **reemplaza** un borrador previo (generado en una sesión anterior de Copilot Chat, conservado como antecedente histórico) que proponía una arquitectura de 26 semanas con BFF separado (Express + Passport en un puerto distinto al de la API core), autenticación vía Keycloak/Auth0 con OAuth2, Row-Level Security de PostgreSQL obligatoria desde el día 1, Redis para sesiones/colas, y un equipo de 2-3 backend developers. Ese borrador queda descartado por las siguientes razones:

1. **Sobre-ingeniería para el tamaño real del equipo.** El equipo disponible es de 1 backend developer (a incorporar) + el frontend developer actual. Una arquitectura de 3 capas con BFF + Core API + Keycloak self-hosted + Redis implica mantener 4 piezas de infraestructura desacopladas (BFF, API, IdP, caché) cuando el dominio real (gestión de fincas con 3 roles y módulos bien delimitados) no presenta los problemas que esos componentes resuelven (no hay necesidad de agregación de múltiples microservicios aguas abajo del BFF, no hay multi-tenant a escala de miles de tenants que justifique RLS day-1, no hay carga que justifique cache distribuido).
2. **BFF innecesario**: un BFF se justifica cuando hay múltiples clientes con necesidades de composición distintas (ej. app móvil + web con shapes de respuesta diferentes) o cuando hace falta ocultar varios servicios backend detrás de una fachada. Aquí hay un único cliente (Angular SPA) y un único servicio backend: NestJS ya cumple el rol de fachada HTTP, autenticación y autorización sin necesitar un salto de red adicional. Los "interceptors" mencionados en este plan son interceptors HTTP de Angular (`authInterceptor`, `errorInterceptor`, `loadingInterceptor`) que viven en el frontend — no hay ningún servicio intermedio.
3. **Keycloak/Auth0 es sobre-dimensionado** para 3 roles fijos y bien conocidos de antemano (A/B/C) sin federación con terceros, sin SSO corporativo requerido, y sin necesidad de un IdP externo. Un JWT propio emitido por NestJS con claims de `role`, `sub` (user id), `estate_id`(s) permitido(s) y `administrators_id` (cuando aplica) cubre el caso de uso completo con muchísima menos superficie operativa (no hay que desplegar ni mantener un IdP separado).
4. **RLS de PostgreSQL day-1 es prematuro**: es una buena práctica de defensa en profundidad, pero implica diseñar y mantener policies SQL por tabla y rol desde el primer sprint, lo cual añade fricción de desarrollo notable cuando el equipo es de 1 backend dev. Se decide implementar el filtrado de tenant a nivel de aplicación (NestJS) de forma disciplinada (ver sección 2.4) y dejar RLS documentado como mejora futura (riesgo abierto #5 en la sección 7).
5. **Redis y arquitectura multi-servicio compleja**: no hay todavía necesidad de sesiones distribuidas (el JWT es stateless), ni de colas asíncronas de volumen (los envíos de notificaciones, en esta fase, son simples y de bajo volumen). Se prioriza la simplicidad operativa: un único proceso NestJS desplegable, una única base de datos PostgreSQL.
6. **26 semanas vs 15 semanas**: el borrador original dimensionaba para 50k+ usuarios y un equipo de 2-3 backend devs con fases de "analítica avanzada" y "seguridad + prod" muy extendidas. Este plan re-prioriza: primero los flujos que destraban valor de negocio inmediato (autenticación, vinculación propietario-finca, incidencias, contabilidad básica), dejando explícitamente fuera del lanzamiento las piezas de escalabilidad masiva (read replicas, PgBouncer, colas) que no son necesarias para el volumen actual de fincas/usuarios gestionado por las gestoras piloto.

### 1.3 Timeline y prioridad

**15 semanas**, organizadas en 11 fases (0 a 10), detalladas en la sección 6. El orden de prioridad de negocio es:

1. **Fase 0-1: Auth** — sin login real no hay nada que proteger.
2. **Fase 2: Estates + OwnerProperties + vinculación** — es el flujo de mayor valor para Rol C (sin esto, un propietario no puede ver nada suyo) y para Rol B (sin fincas no hay nada que administrar). Coincide con la fase 1 marcada como "crítica" en el borrador original, y se conserva esa prioridad.
3. **Fase 3 en adelante**: incidencias (que ya incluyen, vía un campo `category`, el subconjunto de "solicitudes" de tipo Incidencia — ver sección 3.1.3), contabilidad (recibos → movimientos → remesas SEPA → proveedores/presupuesto → morosidad), amenities/reservas, comunicaciones/documentos/alertas, solicitudes (trámites no-incidencia: Documentación/Modificación/Consulta/Queja), y finalmente Rol A (gestoras) + suscripción SaaS + ajustes finales.

Esta secuencia se apoya en el orden de migración de servicios Angular ya definido en la sección 5.5: Auth → Estates+OwnerProperties → Issues (incluye el caso Incidencia de Solicitudes) → Accounting (recibos) → Movimientos → Remesas SEPA → Proveedores+Presupuesto → Morosidad → Amenities/Reservas → Comunicaciones+Documentos+Alertas → Solicitudes (trámites no-incidencia) → Rol A → Suscripción → Ajustes finales.

---

# 2. Arquitectura propuesta

### 2.1 Diagrama de capas

```
┌─────────────────────────────────────────────────────────────────┐
│  Angular SPA (standalone components, signals)                   │
│                                                                   │
│  Componentes (features/**)                                      │
│        ↓                                                         │
│  Servicios de dominio Angular (EstatesService, IssuesService...) │
│        ↓                                                         │
│  HttpClient + Interceptors:                                     │
│    - authInterceptor   (adjunta Bearer token; refresh-and-retry  │
│                          en 401)                                 │
│    - errorInterceptor  (normaliza errores HTTP a {statusCode,    │
│                          message})                                │
│    - loadingInterceptor(contador global de requests activas)    │
│        ↓                                                         │
│  AuthService (signals: currentUser, accessToken en memoria,      │
│               refresh token persistido en localStorage)         │
└───────────────────────────┬───────────────────────────────────────┘
                            │ HTTPS, JSON
                            │ /api/v1/**
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  NestJS API (proceso único, monolítico modular)                 │
│                                                                   │
│  Módulos por dominio: AuthModule, EstatesModule,                 │
│  OwnerPropertiesModule, IssuesModule, RequestsModule,            │
│  AmenitiesModule, BookingsModule, CommunicationsModule,          │
│  DocumentsModule, AlertsModule, AccountingModule,                │
│  MovementsModule, ReceiptsModule, RemesasModule, SuppliersModule,│
│  BudgetModule, DebtorsModule, AdminPlatformModule,               │
│  SubscriptionModule, SettingsModule                              │
│                                                                   │
│  Cada módulo: Controller → Service → Repository (Prisma)         │
│                                                                   │
│  Guards transversales:                                          │
│    - JwtAuthGuard       (valida y decodifica el JWT)             │
│    - RolesGuard         (@Roles('A','B') por endpoint)           │
│    - EstateScopeGuard / EstateScopeInterceptor                  │
│         (inyecta estate_id permitido desde el JWT y lo valida    │
│          contra el recurso solicitado — ver 2.4)                 │
│                                                                   │
│  Prisma Client (tipado, migraciones)                            │
└───────────────────────────┬───────────────────────────────────────┘
                            │ SQL (TCP 5432, conexión directa,
                            │ sin pooler externo en esta fase)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL (instancia única)                                   │
│  - Sin RLS en esta fase (filtrado a nivel aplicación)            │
│  - Soft-delete vía deleted_at en tablas de dominio relevantes    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  S3 (o equivalente) — exclusivamente adjuntos/fotos de incidencias│
│  Subida vía URL prefirmada emitida por IssuesModule              │
└─────────────────────────────────────────────────────────────────┘
```

No existe ningún proceso, puerto ni servicio HTTP entre el Angular SPA y la API NestJS. Los "interceptors" del diagrama son funciones Angular (`HttpInterceptorFn`) que se ejecutan en el navegador, no microservicios.

### 2.2 Por qué NO hace falta un BFF separado

Un BFF (Backend For Frontend) resuelve típicamente alguno de estos problemas, ninguno de los cuales aplica aquí:

- **Múltiples clientes con necesidades de forma de datos distintas** (ej. app móvil necesita payloads reducidos, web necesita payloads completos): Domora Design tiene un único cliente, la SPA Angular. No hay necesidad de una capa de agregación/transformación específica por cliente.
- **Composición de múltiples microservicios backend**: aquí hay un único servicio NestJS modular. No hay nada que "componer" desde un BFF porque no hay múltiples orígenes de datos que reconciliar en el borde.
- **Aislar al cliente de la complejidad de autenticación OAuth2 de terceros**: al usar JWT propio (no Keycloak/Auth0), NestJS ya emite y valida sus propios tokens; no hace falta una capa intermedia que hable con un IdP externo y traduzca eso a cookies/sesiones para el frontend.
- **Rate-limiting y políticas de borde específicas por cliente**: con un único cliente, esas políticas se aplican directamente en NestJS (vía `@nestjs/throttler` o un guard dedicado) sin necesitar un proceso de borde separado.

Añadir un BFF en este contexto introduce un salto de red adicional, un segundo proceso a desplegar/monitorear/versionar, y duplica buena parte de la lógica de autenticación (el BFF tendría que validar igualmente quién es el usuario antes de proxyear). Para un equipo de 1 backend dev, el costo operativo de un servicio adicional no se justifica frente al beneficio (que en este caso es marginal). NestJS, actuando como única API, ya cumple el rol de "fachada para el frontend": expone endpoints pensados para el consumo de la SPA, agrupados por dominio, con DTOs adaptados a lo que cada pantalla necesita.

### 2.3 Estrategia de autenticación y autorización

**Autenticación (quién eres):**

- Login: `POST /api/v1/auth/login` con `email` + `password` → NestJS valida credenciales contra la tabla `users` (password hasheado con bcrypt/argon2) y devuelve:
  - `accessToken`: JWT de vida corta (ej. 15 minutos), firmado con secret/clave del servidor, con claims `sub` (user id), `role` (`A`|`B`|`C`), `estateIds` (array de estate_id a los que el usuario tiene acceso vigente, solo relevante para B/C), `administratorsId` (solo si `role` es `A` o si el usuario B pertenece a una gestora), `exp`.
  - `refreshToken`: token opaco de vida larga (ej. 30 días), persistido en tabla `refresh_tokens` (con posibilidad de revocación), devuelto al cliente para que lo guarde en `localStorage`.
- El `AuthService` Angular mantiene el `accessToken` únicamente en memoria (signal), nunca en `localStorage`, para reducir superficie de ataque ante XSS. El `refreshToken` se persiste en `localStorage` porque debe sobrevivir a un refresh de página.
- El `authInterceptor` (Angular) adjunta `Authorization: Bearer <accessToken>` a cada request salvo en `/auth/login` y `/auth/refresh`. Si una respuesta es 401, el interceptor invoca `POST /api/v1/auth/refresh` con el refresh token, obtiene un nuevo access token y reintenta la request original una sola vez (evitando loops infinitos).
- Logout: `POST /api/v1/auth/logout` revoca el refresh token activo en servidor (lo marca `revoked_at`) y el cliente limpia `localStorage` + el signal en memoria.

**Autorización (qué puedes hacer):**

- A nivel NestJS: `JwtAuthGuard` global (vía `APP_GUARD`) decodifica y valida el JWT en cada request (excepto rutas marcadas `@Public()`). `RolesGuard` complementa con un decorador `@Roles('A')`, `@Roles('B')`, `@Roles('A','B')`, etc. por controlador/endpoint, comparando contra el claim `role` del JWT.
- A nivel de ruta Angular: cada grupo de rutas (`a/**`, `b/**`, `c/**` en `app.routes.ts`) se protege con un `roleGuard` (Angular `CanActivateFn`) que lee `currentRole` desde `AuthService` (derivado de `currentUser().role`) y redirige si el rol no coincide con el prefijo de ruta. Esto es una capa de UX (evitar que un usuario C navegue a pantallas de B), no de seguridad real — la seguridad real vive en NestJS, ya que cualquier guard de frontend es bypasseable por un usuario malicioso editando requests directamente.
- El flag `environment.mockRoleSwitch` (ver sección 5.1/5.4) controla si `cycleRole()` sigue disponible como atajo de demo en desarrollo; en producción este flag está apagado y el rol viene exclusivamente del JWT emitido por el backend.

### 2.4 Estrategia de multi-tenancy sin RLS

Al descartarse RLS de PostgreSQL para el lanzamiento, la responsabilidad de que un admin de finca (Rol B) o un propietario (Rol C) **nunca** pueda leer o escribir datos de una finca (`estate`) a la que no tiene acceso recae enteramente en la capa de aplicación NestJS. Se implementa así:

1. **El JWT es la única fuente de verdad sobre el alcance del usuario.** El claim `estateIds` (para Rol B: todas las fincas que administra; para Rol C: las fincas de sus `owner_properties` con `linkage_status = 'linked'`) se calcula en el momento del login/refresh, no se confía en ningún `estate_id` que el cliente envíe en el body o querystring de una request salvo para verificarlo contra este claim.

2. **`EstateScopeGuard` (guard transversal NestJS).** Para cualquier endpoint cuya ruta incluya `:estateId` o cuyo DTO de entrada incluya `estateId`, este guard:
   - Extrae el `estateId` solicitado (de params, query o body, según el endpoint).
   - Verifica que `estateId` esté incluido en `request.user.estateIds` (poblado por `JwtAuthGuard` a partir del JWT decodificado).
   - Si no está incluido, devuelve `403 Forbidden` antes de que la request llegue al controller/service — la query a Prisma ni se construye.
   - Para Rol A (admin de plataforma), el guard se omite o se trata como "acceso total" explícito (Rol A no tiene `estateIds` limitado, ve todas las fincas de todas las gestoras).

3. **Para endpoints donde el recurso no expone `estateId` directamente en la URL** (ej. `GET /api/v1/issues/:id`, donde hay que resolver primero a qué `estate` pertenece la `issue` vía su `property_id` → `estate_id`), el **Service** (no el guard) es responsable de:
   - Cargar el recurso por id.
   - Comparar su `estate_id` resuelto contra `request.user.estateIds`.
   - Lanzar `ForbiddenException` si no coincide, antes de devolver el dato.

   Esto se centraliza en un método reutilizable `assertEstateAccess(estateId: string, user: AuthenticatedUser): void` en un `EstateAccessService` compartido, inyectado en cada servicio de dominio que opera sobre recursos scoped a finca. Ningún servicio de dominio debe construir una query a Prisma sin pasar antes por esta verificación — esto es una convención de código obligatoria, reforzada por code review, ya que no hay red de seguridad a nivel de base de datos (a diferencia de RLS).

4. **Repositorios/queries Prisma siempre filtran explícitamente por `estate_id`.** Ninguna query de listado (`findMany`) sobre una tabla scoped a finca se ejecuta sin una clausula `where: { estateId: { in: user.estateIds } }` (o `estateId: resolvedEstateId` ya validado por el guard). Esto se aplica de forma sistemática vía un helper `scopedWhere(user, extraWhere)` para reducir el riesgo de que un desarrollador olvide el filtro en un nuevo endpoint.

5. **Diferencia entre Rol B y Rol C dentro de una misma finca**: dentro de una finca a la que ambos tienen acceso, Rol C además se restringe a sus propias `owner_properties` (ej. un propietario no debe ver los recibos de otro propietario de la misma finca). Esto se resuelve con un segundo nivel de filtro: `propertyId IN (SELECT id FROM owner_properties WHERE user_id = :userId AND linkage_status = 'linked')`, aplicado en los servicios de Rol C (`ReceiptsService`, `IssuesService` cuando el caller es C, etc.).

Esta estrategia documentada como "RLS a nivel de aplicación" queda explícitamente marcada como deuda técnica aceptada (riesgo abierto #5, sección 7): el día que el volumen de datos/tenants lo justifique, se puede migrar a RLS de PostgreSQL añadiendo policies que repliquen exactamente esta misma lógica (`estate_id = current_setting('app.current_estate_ids')::uuid[]`) como capa adicional de defensa en profundidad, sin cambiar el contrato de la API.

---

# 3. Modelo de base de datos completo

### 3.1 Inventario de entidades

A continuación se listan todas las entidades identificadas a partir de `src/app/core/models.ts` y `src/app/core/mock-data.ts`, con sus campos reales (no genéricos), y se marca si la tabla resultante es **scoped a finca** (`estate_id` obligatorio o resoluble vía FK) o **global**.

#### 3.1.1 Plataforma / Rol A (globales)

**`administrators`** (de `Administrator`) — GLOBAL
- `name: string`, `cif: string`, `plan: PlanTier ('BASE'|'STANDARD'|'PREMIUM')`, `tier: string`, `end_date: date`, `users_active: int`, `users_max: int`, `status: AdminStatus ('Activa'|'Periodo de gracia'|'Vencida'|'Bloqueada')`, `phone: string`, `contact_name: string`, `contact_email: string`, `mrr: numeric`, `discount_pct: numeric`, `discount_reason?: string`, `discount_until?: date`, `notes: text`, `block_reason?: string`.
- Relación 1:1 con **`admin_billing`** (de `AdminBilling`): `business_name`, `cif`, `address`, `email`, `payment_method: AdminPayMethod ('Domiciliación'|'Tarjeta'|'Transferencia')`, `iban`.
- Relación 1:N con **`admin_invoices`** (de `AdminInvoice`): `no: string`, `date`, `amount: numeric`, `status: AdminInvoiceStatus ('Pagada'|'Pendiente'|'Vencida')`.
- Relación 1:N con **`admin_activity_log`** (de `AdminActivityItem`): `type: AdminActivityType ('login'|'plan_change'|'discount'|'invoice'|'signup'|'block'|'message')`, `title`, `date`, `author`.
- Relación 1:N con `estates` (sustituye a `AdminFinca`, que en el modelo actual es un resumen embebido — en BD, `estates.administrator_id` referencia esta tabla).

**`users`** (nueva, no existe hoy en `models.ts` — necesaria para auth) — GLOBAL
- `id (uuid)`, `email (unique)`, `password_hash`, `full_name`, `role ('A'|'B'|'C')`, `administrator_id (FK nullable, solo si role IN ('A','B'))`, `phone?`, `created_at`, `updated_at`, `deleted_at?`.

**`refresh_tokens`** (nueva, soporte de auth) — GLOBAL
- `id (uuid)`, `user_id (FK)`, `token_hash`, `expires_at`, `revoked_at?`, `created_at`.

**`subscriptions` / `plans` / `addons` / `invoices`** (SaaS billing, derivadas de `Administrator.plan`, `AdminBilling`, `AdminInvoice`) — GLOBAL. `plans` es catálogo (`BASE`/`STANDARD`/`PREMIUM` con límites de `users_max`/precio); `subscriptions` referencia `administrator_id` + `plan_id` + fechas de vigencia; `invoices` es el equivalente persistido de `AdminInvoice`; `addons` es catálogo de extras opcionales por suscripción (no tiene tipo concreto aún en `models.ts`, se modela como tabla abierta `code/name/price`).

#### 3.1.2 Fincas y propiedades (scoped a finca)

**`estates`** (de `Estate`) — define el tenant; `id` es la unidad de scoping
- `id (uuid)`, `administrator_id (FK → administrators)`, `name`, `type: EstateType ('Edificio'|'Urbanización'|'Garaje'|'Trasteros'|'Local')`, `address`, `location`, `created_at`, `deleted_at?`.
- Los campos `properties`, `residents`, `requests`, `occupancy` del modelo `Estate` actual son **derivados** (counts/agregados), no columnas persistidas — se calculan en la capa de servicio o vía vista SQL, no se almacenan para evitar inconsistencia.

**`properties`** (de `Property`) — ESTATE_ID (vía `estate_id` directo)
- `id (uuid)`, `estate_id (FK)`, `type: string`, `ref: string`, `floor?: string`, `door?: string`, `staircase?: string`, `owner_name: string` (texto libre, hoy es solo display — el vínculo real a usuario es vía `owner_properties`), `role_type: RoleType ('Propietario'|'Inquilino'|'Representante'|'Otro'|null)`, `status: PropertyStatus ('Ocupado'|'Vacío'|'Reservado')`, `deleted_at?`.

**`owner_properties`** (de `OwnerProperty`) — ESTATE_ID (vía `estate_id` nullable hasta vincular)
- `id (uuid)`, `user_id (FK → users, propietario)`, `property_id (FK → properties, nullable hasta vinculación)`, `estate_id (FK nullable)`, `type: OwnerPropertyType ('Piso'|'Casa'|'Parking'|'Trastero'|'Local')`, `label: string`, `address`, `location`, `province?`, `role_type: RoleType`, `linkage_status: LinkageStatus ('none'|'pending'|'linked'|'revoked')`, `admin_id (FK → administrators, nullable)`, `admin_contact?`, `quota_monthly: numeric`, `balance: numeric`, `pending_docs: int`, `open_issues: int`, `created_at`, `updated_at`.
  - El campo `linked: boolean` del modelo actual es redundante con `linkage_status` (se deriva: `linked === (linkage_status === 'linked')`) y no se persiste como columna independiente para evitar desincronización.
  - `next_event` (de `PropertyEvent`: `title`, `date`, `day`, `month`, `location`, `room`, `time`) se modela como tabla separada **`property_events`** (1:N, no 1:1, para soportar histórico de eventos por propiedad) con FK a `owner_properties.id` o a `estates.id` si el evento es a nivel de junta de finca completa.

**`adhesion_requests`** (de `AdhesionRequest`) — ESTATE_ID (vía `property_id` → `estate_id`)
- `id (uuid)`, `user_name: string`, `email: string`, `property_id (FK → properties)`, `requested_role_type: RoleType`, `status ('pending'|'approved'|'rejected')` (nuevo, no existe en el mock pero necesario para el flujo real — hoy el mock no tiene estado explícito de la solicitud), `created_at`, `resolved_at?`.

**`link_estates`** — esta tabla no se persiste como tal: `LinkEstate` (de `mock-data.ts`, usado para que un propietario busque finca a la que vincularse) es simplemente una proyección de lectura pública/filtrada de `estates` + `administrators.name`, expuesta vía `GET /api/v1/estates/searchable` (ver sección 4.2) — no requiere tabla propia.

#### 3.1.3 Incidencias y solicitudes (scoped a finca) — decisión de unificación

Investigación de evidencia (ver riesgo cerrado #1 en sección 7): `solicitudes-c.component.ts` define hoy una interfaz local `Solicitud` (no existe en `models.ts`) con `type: SolType = 'Incidencia' | 'Documentación' | 'Modificación' | 'Consulta' | 'Queja'`. Es decir, `'Incidencia'` es **una de cinco categorías** dentro de "Solicitudes" — las otras cuatro son trámites administrativos (petición de certificados, autorización de obras, consultas, quejas de convivencia) que no tienen proveedor, presupuesto ni reparación física, y por tanto no son el mismo concepto de dominio que `Issue`. Además, `Estate.requests: number` y `MOCK_REQUESTS: AdhesionRequest[]` (consumidos por `dashboard-b`/`estate-detail`) son una entidad distinta — solicitudes de **adhesión/vinculación** de un propietario a una finca — y no tienen relación con `solicitudes-c`; ese flujo ya está correctamente modelado aparte en `adhesion_requests` (sección 3.1.2) y no se ve afectado por esta decisión.

Conclusión: no se fusiona todo en una tabla única, pero tampoco quedan como "dos sistemas paralelos" cuando se trata de una incidencia. Se modela `requests` como tabla propia con un campo `category` (que incluye `'Incidencia'` como una opción más), y cuando `category = 'Incidencia'` la request se vincula 1:1 a una fila real de `issues` (que es la que lleva el flujo de gestión — proveedor, presupuesto, estado de reparación). Así:
- El propietario sigue creando todo desde la misma pantalla "Solicitudes" (no se le obliga a distinguir "esto es una request" vs "esto es un issue").
- El admin de finca gestiona las incidencias físicas con el flujo completo ya implementado en `IssuesService`/`estate-detail` (proveedor, presupuesto, timeline), sin reinventar ese flujo dentro de `requests`.
- Los trámites no-incidencia (Documentación/Modificación/Consulta/Queja) quedan en `requests`, con su propio timeline y estado, sin forzar campos de `issues` que no les aplican (`provider`, `budget_amount`, etc., que para estos casos no tienen sentido).

**`issues`** (de `Issue`) — ESTATE_ID (vía `property_id` → `estate_id`)
- `id (uuid)`, `ref: string (unique, ej. '#INC-2026-009')`, `property_id (FK)`, `type: IssueType ('Avería'|'Ruido'|'Daño estructural'|'Fuga'|'Seguridad'|'Limpieza'|'Otro')`, `title`, `description: text`, `status: IssueStatus ('Abierta'|'En reparación'|'Pendiente proveedor'|'Resuelta'|'Cerrada')`, `priority ('Normal'|'Urgente')`, `source ('Propietario'|'Comunidad')`, `date`, `owner_name?`, `provider?`, `provider_category?`, `provider_phone?`, `provider_resolution_date?`, `budget_amount?: numeric`, `budget_description?`, `budget_approved?: boolean`, `notified_date?`, `notified_count?: int`, `created_at`, `updated_at`, `deleted_at?`.
- Relación 1:N con **`issue_timeline`** (de `IssueTimelineEntry`): `date`, `author`, `role ('Propietario'|'Administrador'|'Sistema')`, `text`.
- Relación 1:N con **`issue_attachments`** (de `Issue.photos: string[]`): `id`, `issue_id (FK)`, `s3_key`, `url`, `uploaded_at`.

**`requests`** (Rol C, "Solicitudes" — no confundir con `AdhesionRequest`/`adhesion_requests`; hoy no existe interfaz concreta en `models.ts`, vive local en `solicitudes-c.component.ts` como `Solicitud`) — ESTATE_ID (vía `property_id`)
- `id (uuid)`, `property_id (FK)`, `category: RequestCategory ('Incidencia'|'Documentación'|'Modificación'|'Consulta'|'Queja')`, `title`, `description: text`, `status: RequestStatus ('Abierta'|'En curso'|'Resuelta'|'Cerrada')`, `priority ('Normal'|'Urgente')`, `linked_issue_id (FK nullable → issues, obligatorio cuando category = 'Incidencia')`, `created_at`, `updated_at`, `resolved_at?`.
- Relación 1:N con **`request_timeline`** (mismo shape que `issue_timeline`): `date`, `author`, `role ('Propietario'|'Administrador'|'Sistema')`, `text`.
- Cuando `POST /api/v1/requests` se crea con `category = 'Incidencia'`, el servicio crea automáticamente (en la misma transacción) la fila correspondiente en `issues` con `source: 'Propietario'` y enlaza `linked_issue_id`; a partir de ahí el admin de finca gestiona la reparación íntegramente desde `IssuesService`/`estate-detail`, y el detalle de la `request` para el propietario muestra una proyección de lectura del `issue` enlazado (estado, proveedor, timeline) en lugar de duplicar esos campos.

#### 3.1.4 Amenities / Bookings (scoped a finca)

**`amenities`** (de `Amenity`) — ESTATE_ID directo (en el mock, `AMENITY_CATALOG` está indexado por `propertyId`, pero conceptualmente una amenity pertenece a la finca, no a una propiedad individual — se corrige a `estate_id` en el modelo de datos real)
- `id (uuid)`, `estate_id (FK)`, `name`, `icon`, `color`, `bg`, `max_hours: int`, `slots: text[]` (o tabla normalizada `amenity_slots`), `rules: text`, `capacity: int`, `seasonal?: boolean`, `season_label?`.

**`bookings`** (de `Booking`) — ESTATE_ID (vía `amenity_id` → `estate_id`)
- `id (uuid)`, `amenity_id (FK)`, `user_id (FK → users)`, `date (date)`, `start_slot (time)`, `end_slot (time)`, `status: BookingStatus ('confirmed'|'completed'|'cancelled')`, `created_at`, `guests: int`, `notes?`.

#### 3.1.5 Comunicaciones, documentos, alertas (scoped a finca)

**`communications`** (de `Communication`) — ESTATE_ID
- `id (uuid)`, `estate_id (FK)`, `title`, `body: text`, `date`, `from_name`, `created_at`.
- Relación N:M con `users` vía **`communication_reads`** (sustituye el booleano `unread` por usuario, ya que en multi-usuario "leído" es por destinatario, no global): `communication_id (FK)`, `user_id (FK)`, `read_at?`.

**`documents`** (de `Document`) — ESTATE_ID
- `id (uuid)`, `estate_id (FK)`, `title`, `type: string`, `date`, `size: string` (o `size_bytes: bigint` normalizado), `s3_key`, `created_at`.
- `is_new` no se persiste — se deriva comparando `created_at` contra la última visita del usuario (tabla `document_reads` opcional o simple "últimos N días").

**`alerts`** (nueva, requerida por rutas `b/alerts` y `c/alerts`; no hay interfaz `Alert` en `models.ts` hoy — se infiere del nombre de ruta) — ESTATE_ID
- `id (uuid)`, `estate_id (FK)`, `title`, `body`, `severity ('info'|'warning'|'critical')`, `created_at`, `resolved_at?`.

#### 3.1.6 Contabilidad (scoped a finca)

**`accounting_estates`** (de `AccountingEstate`) — esto es una vista/agregado de `estates`, no tabla independiente: `balance`, `income`, `expenses`, `reserve`, `reserve_target`, `delinquency`, `units`, `iban` son todos derivables de `movements`/`properties`/`debtors` salvo `reserve_target` e `iban`, que sí son columnas propias de `estates` (`estates.reserve_target`, `estates.iban`).

**`chart_accounts`** (de `ChartAccount`) — GLOBAL (catálogo compartido, plan contable estándar; opcionalmente personalizable por finca en el futuro)
- `code (string, PK)`, `name`, `type: MovementType | 'all' ('income'|'expense'|'transfer'|'all')`.

**`movements`** (de `Movement`) — ESTATE_ID directo
- `id (uuid)`, `estate_id (FK)`, `date`, `concept: text`, `account_code (FK → chart_accounts.code)`, `type: MovementType ('income'|'expense'|'transfer')`, `amount: numeric (signed)`, `balance: numeric` (saldo acumulado tras el movimiento — derivado/recalculado, no de confianza ciega en escritura concurrente), `reconciled: boolean`, `supplier_id (FK nullable → suppliers)`, `reversal: boolean`, `created_at`.

**`bank_extracts`** (de `BankExtractEntry`) — ESTATE_ID
- `id (uuid)`, `estate_id (FK)`, `date`, `concept: text`, `amount: numeric`, `matched_movement_id (FK nullable → movements, fruto de la conciliación)`, `imported_at`.

**`accounting_periods`** (de `AccountingPeriod`) — ESTATE_ID
- `id (uuid)`, `estate_id (FK)`, `key: string ('2026-05')`, `label`, `mon`, `remesa_id (FK nullable → remesas)`, `issued (date)`, `current: boolean`.

**`receipts`** (de `AccountingReceipt`, distinto del `Receipt` simplificado de Rol C que es una proyección de lectura de esta misma tabla) — ESTATE_ID (vía `property_id`/`period` → `estate_id`)
- `id (uuid)`, `no: string`, `period_id (FK → accounting_periods)`, `owner_property_id (FK → owner_properties)`, `owner_name`, `unit`, `amount: numeric`, `iban_masked`, `mandate_id (FK nullable → sepa_mandates)`, `concept`, `kind: string`, `status: ReceiptStatus ('Pagada'|'Pendiente'|'Devuelto')`, `date`, `method: PayMethod | string`, `manual: boolean`, `return_code?`, `return_reason?`.

**`sepa_mandates`** (nueva, requerida para `mandate: string` en `RemesaCandidate`/`RemesaLine` y `RemesaCandidate.mandate: boolean`) — ESTATE_ID (vía `owner_property_id`)
- `id (uuid)`, `owner_property_id (FK)`, `reference (string, ej. 'MND-0012')`, `iban_encrypted`, `seq_type: MandateSeq ('FRST'|'RCUR')`, `signed_at`, `revoked_at?`.

**`remesas`** (de `RemesaHistoryItem`, la config de creación es `RemesaConfig`) — ESTATE_ID
- `id (uuid)`, `estate_id (FK)`, `period_label: string`, `scheme: SepaScheme ('CORE'|'B2B')`, `charge_date`, `concept`, `count: int`, `amount: numeric`, `presented_at`, `status: RemesaStatus ('Borrador'|'Presentada'|'Cobrada'|'Con devoluciones')`, `charged_count: int`, `returned_count: int`, `pending_count: int`, `returned_amount: numeric`, `created_at`.

**`remesa_lines`** (de `RemesaLine`) — ESTATE_ID (vía `remesa_id`)
- `id (uuid)`, `remesa_id (FK)`, `owner_property_id (FK)`, `owner_name`, `unit`, `iban_masked`, `mandate_reference`, `seq: string`, `amount: numeric`, `status ('Cobrado'|'Pendiente'|'Devuelto')`, `return_code?`, `return_reason?`.

**`suppliers`** (de `Supplier`) — ESTATE_ID
- `id (uuid)`, `estate_id (FK)`, `name`, `category`, `last_invoice_date`, `last_amount: numeric`, `ytd_spend: numeric` (derivable, candidato a vista), `pending_invoices: int`.

**`budget`** (de `BudgetItem`) — ESTATE_ID
- `id (uuid)`, `estate_id (FK)`, `account_code (FK → chart_accounts.code)`, `category`, `fiscal_year: int`, `budgeted: numeric`, `executed: numeric` (derivable de `movements`, mantenido también como snapshot cacheado).

**`debtors`** (de `Debtor`) — ESTATE_ID (vía `owner_property_id`)
- `id (uuid)`, `owner_property_id (FK)`, `name`, `property_label`, `amount: numeric`, `interest: numeric`, `months_overdue: int`, `oldest_period`, `last_contact_at?`, `reminder_l1_sent: boolean`, `reminder_l2_sent: boolean`, `reminder_bf_sent: boolean`, `step: string`.
- Relación 1:N con **`debtor_gestiones`** (de `GestionEntry`): `id`, `debtor_id (FK)`, `type: GestionType ('Llamada'|'Email'|'Carta amistosa'|'Carta formal'|'Burofax'|'Acción judicial')`, `date`, `note: text`, `result`, `author`.

#### 3.1.7 Preferencias

**`notification_preferences`** (nueva, no existe en `models.ts` hoy) — GLOBAL (por `user_id`)
- `user_id (FK, PK)`, `email_enabled: boolean`, `push_enabled: boolean`, `sms_enabled: boolean`, `updated_at`.

### 3.2 Resumen estate_id vs global

| Scoped a finca (`estate_id`) | Global |
|---|---|
| properties, owner_properties, adhesion_requests, issues (+timeline+attachments), requests, amenities, bookings, communications (+reads), documents, alerts, movements, bank_extracts, accounting_periods, receipts, sepa_mandates, remesas, remesa_lines, suppliers, budget, debtors (+gestiones), property_events | administrators, admin_billing, admin_invoices, admin_activity_log, users, refresh_tokens, subscriptions, plans, addons, invoices, chart_accounts, notification_preferences, estates (es el ancla del tenant, no está "scoped a sí misma") |

### 3.3 DDL esencial (PostgreSQL)

```sql
-- ── Plataforma ──────────────────────────────────────────────────────────
CREATE TABLE administrators (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            varchar(200) NOT NULL,
  cif             varchar(20)  NOT NULL UNIQUE,
  plan            varchar(20)  NOT NULL CHECK (plan IN ('BASE','STANDARD','PREMIUM')),
  tier            varchar(20)  NOT NULL,
  end_date        date,
  users_active    int NOT NULL DEFAULT 0,
  users_max       int NOT NULL,
  status          varchar(30)  NOT NULL CHECK (status IN ('Activa','Periodo de gracia','Vencida','Bloqueada')),
  phone           varchar(30),
  contact_name    varchar(150),
  contact_email   varchar(200),
  mrr             numeric(10,2) NOT NULL DEFAULT 0,
  discount_pct    numeric(5,2)  NOT NULL DEFAULT 0,
  discount_reason varchar(200),
  discount_until  date,
  notes           text,
  block_reason    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             varchar(200) NOT NULL UNIQUE,
  password_hash     varchar(255) NOT NULL,
  full_name         varchar(200) NOT NULL,
  role              varchar(1) NOT NULL CHECK (role IN ('A','B','C')),
  administrator_id  uuid REFERENCES administrators(id),
  phone             varchar(30),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT chk_admin_role CHECK (
    (role IN ('A','B') AND administrator_id IS NOT NULL) OR role = 'C'
  )
);

-- ── Fincas y propiedades ─────────────────────────────────────────────────
CREATE TABLE estates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administrator_id  uuid NOT NULL REFERENCES administrators(id),
  name              varchar(200) NOT NULL,
  type              varchar(30) NOT NULL CHECK (type IN ('Edificio','Urbanización','Garaje','Trasteros','Local')),
  address           varchar(255) NOT NULL,
  location          varchar(150) NOT NULL,
  reserve_target    numeric(12,2) DEFAULT 0,
  iban              varchar(34),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX idx_estates_administrator ON estates(administrator_id) WHERE deleted_at IS NULL;

CREATE TABLE properties (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estate_id   uuid NOT NULL REFERENCES estates(id),
  type        varchar(30) NOT NULL,
  ref         varchar(20) NOT NULL,
  floor       varchar(10),
  door        varchar(10),
  staircase   varchar(10),
  owner_name  varchar(200),
  role_type   varchar(20) CHECK (role_type IN ('Propietario','Inquilino','Representante','Otro')),
  status      varchar(20) NOT NULL CHECK (status IN ('Ocupado','Vacío','Reservado')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (estate_id, ref)
);
CREATE INDEX idx_properties_estate ON properties(estate_id) WHERE deleted_at IS NULL;

CREATE TABLE owner_properties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  property_id     uuid REFERENCES properties(id),
  estate_id       uuid REFERENCES estates(id),
  type            varchar(20) NOT NULL CHECK (type IN ('Piso','Casa','Parking','Trastero','Local')),
  label           varchar(150) NOT NULL,
  address         varchar(255) NOT NULL,
  location        varchar(150) NOT NULL,
  province        varchar(100),
  role_type       varchar(20) CHECK (role_type IN ('Propietario','Inquilino','Representante','Otro')),
  linkage_status  varchar(10) NOT NULL DEFAULT 'none' CHECK (linkage_status IN ('none','pending','linked','revoked')),
  admin_id        uuid REFERENCES administrators(id),
  admin_contact   varchar(150),
  quota_monthly   numeric(10,2) NOT NULL DEFAULT 0,
  balance         numeric(10,2) NOT NULL DEFAULT 0,
  pending_docs    int NOT NULL DEFAULT 0,
  open_issues     int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_linked_requires_estate CHECK (
    linkage_status <> 'linked' OR (estate_id IS NOT NULL AND property_id IS NOT NULL)
  )
);
CREATE INDEX idx_owner_properties_user ON owner_properties(user_id);
CREATE INDEX idx_owner_properties_estate ON owner_properties(estate_id) WHERE estate_id IS NOT NULL;

-- ── Incidencias ──────────────────────────────────────────────────────────
CREATE TABLE issues (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                      varchar(30) NOT NULL UNIQUE,
  property_id              uuid NOT NULL REFERENCES properties(id),
  type                     varchar(30) NOT NULL CHECK (type IN ('Avería','Ruido','Daño estructural','Fuga','Seguridad','Limpieza','Otro')),
  title                    varchar(200) NOT NULL,
  description              text NOT NULL,
  status                   varchar(30) NOT NULL CHECK (status IN ('Abierta','En reparación','Pendiente proveedor','Resuelta','Cerrada')),
  priority                 varchar(10) NOT NULL CHECK (priority IN ('Normal','Urgente')),
  source                   varchar(15) NOT NULL CHECK (source IN ('Propietario','Comunidad')),
  date                     date NOT NULL,
  owner_name               varchar(200),
  provider                 varchar(200),
  provider_category        varchar(100),
  provider_phone           varchar(30),
  provider_resolution_date date,
  budget_amount            numeric(10,2),
  budget_description       text,
  budget_approved          boolean,
  notified_date            date,
  notified_count           int,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);
CREATE INDEX idx_issues_property ON issues(property_id) WHERE deleted_at IS NULL;

CREATE TABLE issue_timeline (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  date        timestamptz NOT NULL DEFAULT now(),
  author      varchar(150) NOT NULL,
  role        varchar(20) NOT NULL CHECK (role IN ('Propietario','Administrador','Sistema')),
  text        text NOT NULL
);
CREATE INDEX idx_issue_timeline_issue ON issue_timeline(issue_id);

CREATE TABLE issue_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id    uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  s3_key      varchar(500) NOT NULL,
  url         varchar(500),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- ── Amenities / Bookings ─────────────────────────────────────────────────
CREATE TABLE amenities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estate_id     uuid NOT NULL REFERENCES estates(id),
  name          varchar(150) NOT NULL,
  icon          varchar(10),
  color         varchar(50),
  bg            varchar(50),
  max_hours     int NOT NULL,
  slots         text[] NOT NULL,
  rules         text,
  capacity      int NOT NULL,
  seasonal      boolean NOT NULL DEFAULT false,
  season_label  varchar(50),
  deleted_at    timestamptz
);
CREATE INDEX idx_amenities_estate ON amenities(estate_id) WHERE deleted_at IS NULL;

CREATE TABLE bookings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amenity_id  uuid NOT NULL REFERENCES amenities(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  date        date NOT NULL,
  start_slot  time NOT NULL,
  end_slot    time NOT NULL,
  status      varchar(15) NOT NULL CHECK (status IN ('confirmed','completed','cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  guests      int NOT NULL DEFAULT 1,
  notes       text,
  CONSTRAINT chk_booking_slots CHECK (end_slot > start_slot)
);
CREATE INDEX idx_bookings_amenity_date ON bookings(amenity_id, date);
CREATE UNIQUE INDEX uq_bookings_no_overlap ON bookings(amenity_id, date, start_slot)
  WHERE status <> 'cancelled';

-- ── Contabilidad ─────────────────────────────────────────────────────────
CREATE TABLE chart_accounts (
  code  varchar(10) PRIMARY KEY,
  name  varchar(150) NOT NULL,
  type  varchar(10) NOT NULL CHECK (type IN ('income','expense','transfer','all'))
);

CREATE TABLE movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estate_id     uuid NOT NULL REFERENCES estates(id),
  date          date NOT NULL,
  concept       text NOT NULL,
  account_code  varchar(10) NOT NULL REFERENCES chart_accounts(code),
  type          varchar(10) NOT NULL CHECK (type IN ('income','expense','transfer')),
  amount        numeric(10,2) NOT NULL,
  balance       numeric(12,2) NOT NULL,
  reconciled    boolean NOT NULL DEFAULT false,
  supplier_id   uuid REFERENCES suppliers(id),
  reversal      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX idx_movements_estate_date ON movements(estate_id, date DESC) WHERE deleted_at IS NULL;

CREATE TABLE receipts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  no                varchar(30) NOT NULL,
  period_id         uuid NOT NULL REFERENCES accounting_periods(id),
  owner_property_id uuid NOT NULL REFERENCES owner_properties(id),
  owner_name        varchar(200) NOT NULL,
  unit              varchar(20) NOT NULL,
  amount            numeric(10,2) NOT NULL,
  iban_masked       varchar(34),
  mandate_id        uuid REFERENCES sepa_mandates(id),
  concept           varchar(200) NOT NULL,
  kind              varchar(50) NOT NULL,
  status            varchar(15) NOT NULL CHECK (status IN ('Pagada','Pendiente','Devuelto')),
  date              date NOT NULL,
  method            varchar(30) NOT NULL,
  manual            boolean NOT NULL DEFAULT false,
  return_code       varchar(10),
  return_reason     varchar(150),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, no)
);
CREATE INDEX idx_receipts_owner_property ON receipts(owner_property_id);

-- ── Remesas SEPA ─────────────────────────────────────────────────────────
CREATE TABLE remesas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estate_id       uuid NOT NULL REFERENCES estates(id),
  period_label    varchar(50) NOT NULL,
  scheme          varchar(5) NOT NULL CHECK (scheme IN ('CORE','B2B')),
  charge_date     date NOT NULL,
  concept         varchar(200) NOT NULL,
  count           int NOT NULL DEFAULT 0,
  amount          numeric(12,2) NOT NULL DEFAULT 0,
  presented_at    timestamptz,
  status          varchar(20) NOT NULL DEFAULT 'Borrador'
                    CHECK (status IN ('Borrador','Presentada','Cobrada','Con devoluciones')),
  charged_count   int NOT NULL DEFAULT 0,
  returned_count  int NOT NULL DEFAULT 0,
  pending_count   int NOT NULL DEFAULT 0,
  returned_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_remesas_estate ON remesas(estate_id);

CREATE TABLE remesa_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remesa_id           uuid NOT NULL REFERENCES remesas(id) ON DELETE CASCADE,
  owner_property_id   uuid NOT NULL REFERENCES owner_properties(id),
  owner_name          varchar(200) NOT NULL,
  unit                varchar(20) NOT NULL,
  iban_masked         varchar(34),
  mandate_reference   varchar(30),
  seq                 varchar(4) NOT NULL CHECK (seq IN ('FRST','RCUR')),
  amount              numeric(10,2) NOT NULL,
  status              varchar(15) NOT NULL CHECK (status IN ('Cobrado','Pendiente','Devuelto')),
  return_code         varchar(10),
  return_reason       varchar(150)
);
CREATE INDEX idx_remesa_lines_remesa ON remesa_lines(remesa_id);

-- ── Morosidad ────────────────────────────────────────────────────────────
CREATE TABLE debtors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_property_id   uuid NOT NULL REFERENCES owner_properties(id),
  name                varchar(200) NOT NULL,
  property_label      varchar(50) NOT NULL,
  amount              numeric(10,2) NOT NULL,
  interest            numeric(10,2) NOT NULL DEFAULT 0,
  months_overdue      int NOT NULL DEFAULT 0,
  oldest_period       varchar(20),
  last_contact_at     timestamptz,
  reminder_l1_sent    boolean NOT NULL DEFAULT false,
  reminder_l2_sent    boolean NOT NULL DEFAULT false,
  reminder_bf_sent    boolean NOT NULL DEFAULT false,
  step                varchar(50) NOT NULL DEFAULT 'Sin gestionar',
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz
);
CREATE INDEX idx_debtors_owner_property ON debtors(owner_property_id);
```

(El resto de tablas — `admin_billing`, `admin_invoices`, `admin_activity_log`, `refresh_tokens`, `adhesion_requests`, `requests`, `communications`, `communication_reads`, `documents`, `alerts`, `bank_extracts`, `accounting_periods`, `sepa_mandates`, `suppliers`, `budget`, `debtor_gestiones`, `property_events`, `subscriptions`, `plans`, `addons`, `invoices`, `notification_preferences` — siguen el mismo patrón de columnas tipadas + `estate_id`/FK + `deleted_at` donde corresponde, y se detallan en el esquema Prisma (`schema.prisma`) durante la Fase 0, no se repiten aquí por espacio.)

---

# 4. Diseño de API

### 4.1 Convenciones generales

- **Versionado**: todas las rutas bajo el prefijo `/api/v1`.
- **Paginación**: endpoints de listado aceptan `?page=1&pageSize=20` (defaults: `page=1`, `pageSize=20`, máximo `pageSize=100`). Respuesta estándar:
  ```json
  { "data": [ /* items */ ], "total": 134, "page": 1, "pageSize": 20 }
  ```
- **Errores**: formato uniforme vía `errorInterceptor`-compatible shape:
  ```json
  { "statusCode": 404, "message": "Issue not found", "errors": [] }
  ```
  `errors` (array opcional) se usa para errores de validación por campo (`{ "field": "email", "message": "must be a valid email" }`).
- **Autorización por rol**: cada grupo indica qué roles pueden invocar el endpoint vía `@Roles(...)`. Donde aplica, se indica también la verificación de `estate_id`/ownership adicional (sección 2.4).
- **Fechas**: ISO 8601 en payloads (`YYYY-MM-DD` o `YYYY-MM-DDTHH:mm:ssZ`), aunque el campo se muestre formateado en español en el frontend (la conversión a `"24 mayo 2026"` es responsabilidad del pipe Angular, no de la API).

### 4.2 Auth

| Método | Ruta | Roles | Descripción |
|---|---|---|---|
| POST | `/api/v1/auth/login` | público | Body `{ email, password }` → `{ accessToken, refreshToken, user: { id, fullName, role, estateIds, administratorId } }` |
| POST | `/api/v1/auth/refresh` | público (requiere refreshToken válido) | Body `{ refreshToken }` → `{ accessToken, refreshToken }` (rotación de refresh token) |
| POST | `/api/v1/auth/logout` | autenticado | Revoca el refresh token activo |
| GET | `/api/v1/auth/me` | autenticado | Devuelve el `user` actual decodificado del JWT + datos frescos de `users` |

### 4.3 Estates / Properties / Owner-Properties / Adhesion-Requests

| Método | Ruta | Roles | DTO request / response |
|---|---|---|---|
| GET | `/api/v1/estates` | A, B | Lista de `Estate` (paginado). A ve todas; B ve solo las suyas (filtradas por `estateIds` del JWT) |
| GET | `/api/v1/estates/searchable` | C | Proyección pública filtrada (`LinkEstate`: `id, name, address, admin`) para que un propietario busque finca a vincular |
| GET | `/api/v1/estates/:id` | A, B (estate-scoped) | `Estate` completo + agregados (`properties`, `residents`, `requests`, `occupancy` calculados) |
| POST | `/api/v1/estates` | A | Crea `Estate` (alta de finca por gestora) |
| PATCH | `/api/v1/estates/:id` | A, B (estate-scoped) | Actualiza campos de `Estate` |
| GET | `/api/v1/estates/:id/properties` | B (estate-scoped) | Lista paginada de `Property` de esa finca |
| POST | `/api/v1/estates/:id/properties` | B (estate-scoped) | Crea `Property`: `{ type, ref, floor?, door?, staircase?, ownerName, roleType, status }` |
| PATCH | `/api/v1/properties/:id` | B (estate-scoped) | Actualiza `Property` |
| GET | `/api/v1/owner-properties` | C | Lista las `OwnerProperty` del usuario autenticado (sin paginación, suelen ser pocas) |
| POST | `/api/v1/owner-properties` | C | Alta de propiedad propia: `{ type, label, address, location, province?, roleType }` (arranca con `linkageStatus: 'none'`) |
| POST | `/api/v1/owner-properties/:id/link-request` | C | Inicia vinculación: `{ estateId, propertyRef }` → pasa `linkageStatus` a `'pending'` y crea una fila relacionada en `adhesion_requests` |
| GET | `/api/v1/estates/:id/adhesion-requests` | B (estate-scoped) | Lista de `AdhesionRequest` pendientes de la finca: `{ userName, email, property, date, roleType }` |
| POST | `/api/v1/adhesion-requests/:id/approve` | B (estate-scoped) | Aprueba: pasa `owner_properties.linkage_status` a `'linked'`, fija `estate_id`/`property_id` |
| POST | `/api/v1/adhesion-requests/:id/reject` | B (estate-scoped) | Rechaza: pasa `linkage_status` a `'revoked'` (o vuelve a `'none'` según UX) |
| GET | `/api/v1/owner-properties/:id` | C (ownership) | Detalle completo de `OwnerProperty` incluyendo `nextEvent` |

### 4.4 Issues

| Método | Ruta | Roles | DTO |
|---|---|---|---|
| GET | `/api/v1/issues?propertyId=&status=&page=&pageSize=` | B (estate-scoped), C (ownership) | Lista paginada de `Issue` (sin `timeline` completo, solo resumen) |
| POST | `/api/v1/issues` | B, C | `{ propertyId, type, title, description, priority, source }` → genera `ref` autoincremental (`#INC-YYYY-NNN`), `status: 'Abierta'` |
| GET | `/api/v1/issues/:id` | B (estate-scoped), C (ownership) | `Issue` completo + `timeline[]` + `photos[]` (URLs firmadas S3) |
| PATCH | `/api/v1/issues/:id` | B (estate-scoped) | Actualiza `status, priority, provider, providerCategory, providerPhone, providerResolutionDate, budgetAmount, budgetDescription, budgetApproved, notifiedDate, notifiedCount` |
| POST | `/api/v1/issues/:id/timeline` | B (estate-scoped), C (ownership, solo lectura propia + comentarios) | Añade `IssueTimelineEntry`: `{ text }` (autor y rol se infieren del JWT) |
| POST | `/api/v1/issues/:id/attachments` | B (estate-scoped), C (ownership) | Devuelve URL prefirmada de S3 para subida directa desde el cliente, luego `PUT` del archivo y `POST` de confirmación que crea el registro en `issue_attachments` |

Nota de unificación (ver sección 3.1.3 y riesgo cerrado #1, sección 7): cuando una `request` (sección 4.5) tiene `category = 'Incidencia'`, `RequestsService` crea automáticamente el `issue` correspondiente vía este mismo módulo (`IssuesModule`) — `solicitudes-c.component.ts` para ese caso particular termina mostrando una proyección de lectura de `GET /api/v1/issues/:id` (estado real de la reparación, proveedor, timeline), no un estado propio duplicado. No se añade un endpoint `mine=true` distinto porque `GET /api/v1/issues?propertyId=` ya cubre el caso de ownership de Rol C al filtrar por las `properties` del usuario autenticado (sección 2.4, punto 5).

### 4.5 Requests (Rol C, "Solicitudes" — decisión de unificación parcial con Issues, ver 3.1.3)

| Método | Ruta | Roles | DTO |
|---|---|---|---|
| GET | `/api/v1/requests?category=&status=&page=&pageSize=` | C (ownership), B (estate-scoped) | Lista paginada de `Solicitud` (incluye las de `category: 'Incidencia'`, con `linkedIssueId` resuelto) |
| POST | `/api/v1/requests` | C | `{ propertyId, category, title, description, priority }` → si `category = 'Incidencia'`, crea también el `issue` enlazado (`source: 'Propietario'`) en la misma transacción y guarda `linkedIssueId` |
| GET | `/api/v1/requests/:id` | C (ownership), B (estate-scoped) | Detalle + `timeline[]`; si `linkedIssueId` existe, incluye también el `issue` enlazado completo (delegado a `IssuesService`) |
| POST | `/api/v1/requests/:id/timeline` | C (ownership), B (estate-scoped) | Añade mensaje al timeline de la `request` (solo para categorías no-Incidencia; para Incidencia se usa `POST /api/v1/issues/:id/timeline`) |
| PATCH | `/api/v1/requests/:id` | B (estate-scoped) | Actualiza `status` (solo aplica directamente cuando `category <> 'Incidencia'`; si tiene `linkedIssueId`, el estado se deriva del `issue` y este PATCH es rechazado con 409 indicando que debe gestionarse vía `/issues/:id`) |

### 4.6 Amenities / Bookings

| Método | Ruta | Roles | DTO |
|---|---|---|---|
| GET | `/api/v1/estates/:id/amenities` | C (ownership de alguna property de esa estate), B (estate-scoped) | Lista de `Amenity` (incluye `slots[]`, `rules`, `capacity`) |
| GET | `/api/v1/amenities/:id/availability?date=` | C, B | Slots ocupados ese día (combina `bookings` confirmadas de todos los usuarios, no solo el caller) |
| POST | `/api/v1/bookings` | C | `{ amenityId, date, startSlot, endSlot, guests, notes? }` → valida solapamiento (constraint `uq_bookings_no_overlap`) y `maxHours` |
| GET | `/api/v1/bookings` | C (ownership) | Lista paginada de bookings propias |
| PATCH | `/api/v1/bookings/:id/cancel` | C (ownership) | Pasa `status` a `'cancelled'` |

### 4.7 Communications / Documents / Alerts

| Método | Ruta | Roles | DTO |
|---|---|---|---|
| GET | `/api/v1/estates/:id/communications` | B (estate-scoped), C (ownership) | Lista paginada de `Communication`, incluye `unread` calculado para el caller vía `communication_reads` |
| POST | `/api/v1/estates/:id/communications` | B (estate-scoped) | `{ title, body }` → notifica (futuro, fase 11) a todos los `owner_properties` linked de la finca |
| POST | `/api/v1/communications/:id/read` | C | Marca como leída para el usuario actual |
| GET | `/api/v1/estates/:id/documents` | B (estate-scoped), C (ownership) | Lista paginada de `Document` |
| POST | `/api/v1/estates/:id/documents` | B (estate-scoped) | Sube documento (URL prefirmada S3, igual patrón que `issue_attachments`) |
| GET | `/api/v1/estates/:id/alerts` | B (estate-scoped), C (ownership) | Lista de `Alert` activas |
| POST | `/api/v1/estates/:id/alerts` | B (estate-scoped) | `{ title, body, severity }` |

### 4.8 Accounting / Movements / Receipts / Periods / Bank-Extracts

| Método | Ruta | Roles | DTO |
|---|---|---|---|
| GET | `/api/v1/estates/:id/accounting/summary` | B (estate-scoped) | `AccountingEstate`-shape: `{ balance, income, expenses, reserve, reserveTarget, delinquency, units, iban }` (calculado) |
| GET | `/api/v1/estates/:id/movements?type=&reconciled=&page=&pageSize=` | B (estate-scoped) | Lista paginada de `Movement` |
| POST | `/api/v1/estates/:id/movements` | B (estate-scoped) | `{ date, concept, accountCode, type, amount, supplierId? }` → recalcula `balance` en transacción |
| GET | `/api/v1/estates/:id/bank-extracts` | B (estate-scoped) | Lista de `BankExtractEntry` importadas, con `matchedMovementId` si conciliadas |
| POST | `/api/v1/estates/:id/bank-extracts/import` | B (estate-scoped) | Importa extracto (CSV/N43), crea filas `bank_extracts` sin conciliar |
| POST | `/api/v1/bank-extracts/:id/reconcile` | B (estate-scoped) | `{ movementId }` → vincula extracto con movimiento existente, marca `reconciled: true` |
| GET | `/api/v1/estates/:id/accounting/periods` | B (estate-scoped) | Lista de `AccountingPeriod` |
| GET | `/api/v1/estates/:id/receipts?periodKey=&status=&page=&pageSize=` | B (estate-scoped) | Lista paginada de `AccountingReceipt` |
| POST | `/api/v1/estates/:id/receipts/generate` | B (estate-scoped) | Genera recibos del periodo para todas las `owner_properties` activas |
| PATCH | `/api/v1/receipts/:id` | B (estate-scoped) | Actualiza `status, method, returnCode, returnReason` (registro manual de cobro/devolución) |
| GET | `/api/v1/owner-properties/:id/receipts` | C (ownership) | Vista simplificada `Receipt` (`month, amount, status, dueDate`) para Rol C |

### 4.9 SEPA / Remesas

| Método | Ruta | Roles | DTO |
|---|---|---|---|
| GET | `/api/v1/estates/:id/remesas/candidates?periodKey=` | B (estate-scoped) | Lista de `RemesaCandidate` (`owner, unit, iban, mandate, seq, amount, isNew?`) |
| POST | `/api/v1/estates/:id/remesas` | B (estate-scoped) | Crea remesa desde `RemesaConfig`: `{ period, chargeDate, scheme, concept, candidateIds[] }` → genera `remesas` + `remesa_lines`, status `'Borrador'` |
| POST | `/api/v1/remesas/:id/present` | B (estate-scoped) | Pasa a `'Presentada'`, genera fichero SEPA `pain.008.001.02` (ver riesgo abierto #3) |
| GET | `/api/v1/remesas/:id/file` | B (estate-scoped) | Descarga el fichero XML SEPA generado |
| GET | `/api/v1/estates/:id/remesas` | B (estate-scoped) | Lista paginada de `RemesaHistoryItem` |
| GET | `/api/v1/remesas/:id/lines` | B (estate-scoped) | Lista de `RemesaLine` (drill-down) |
| PATCH | `/api/v1/remesa-lines/:id` | B (estate-scoped) | Registra devolución: `{ status: 'Devuelto', returnCode, returnReason }` |
| POST | `/api/v1/owner-properties/:id/sepa-mandates` | B (estate-scoped) | Alta de `sepa_mandates`: `{ iban, seqType }` |

### 4.10 Suppliers / Budget

| Método | Ruta | Roles | DTO |
|---|---|---|---|
| GET | `/api/v1/estates/:id/suppliers` | B (estate-scoped) | Lista paginada de `Supplier` |
| POST | `/api/v1/estates/:id/suppliers` | B (estate-scoped) | `{ name, category }` |
| GET | `/api/v1/estates/:id/budget?fiscalYear=` | B (estate-scoped) | Lista de `BudgetItem` (`code, category, budgeted, executed`) |
| POST | `/api/v1/estates/:id/budget` | B (estate-scoped) | `{ accountCode, category, fiscalYear, budgeted }` |

### 4.11 Debtors

| Método | Ruta | Roles | DTO |
|---|---|---|---|
| GET | `/api/v1/estates/:id/debtors` | B (estate-scoped) | Lista paginada de `Debtor` |
| GET | `/api/v1/debtors/:id` | B (estate-scoped) | Detalle + `history: GestionEntry[]` |
| POST | `/api/v1/debtors/:id/gestiones` | B (estate-scoped) | `{ type, note, result }` → crea `GestionEntry`, autor inferido del JWT |
| PATCH | `/api/v1/debtors/:id` | B (estate-scoped) | Actualiza `step`, `reminders` (`l1`, `l2`, `bf`) |

### 4.12 Admin-Platform / Subscriptions

| Método | Ruta | Roles | DTO |
|---|---|---|---|
| GET | `/api/v1/admins` | A | Lista paginada de `Administrator` (todas las gestoras) |
| GET | `/api/v1/admins/:id` | A | Detalle completo: `billing, fincas[], invoices[], activity[]` |
| PATCH | `/api/v1/admins/:id` | A | Actualiza `plan, status, discountPct, discountReason, discountUntil, notes, blockReason` |
| GET | `/api/v1/admins/:id/invoices` | A, B (solo su propia gestora) | Lista de `AdminInvoice` |
| GET | `/api/v1/subscriptions/me` | B | Suscripción de la gestora del usuario autenticado: plan vigente, `usersActive/usersMax`, fecha de renovación |
| GET | `/api/v1/plans` | A, B | Catálogo de `plans` disponibles (`BASE/STANDARD/PREMIUM`) |

### 4.13 Settings

| Método | Ruta | Roles | DTO |
|---|---|---|---|
| GET | `/api/v1/users/me/notification-preferences` | A, B, C | `{ emailEnabled, pushEnabled, smsEnabled }` |
| PATCH | `/api/v1/users/me/notification-preferences` | A, B, C | Actualiza preferencias |
| PATCH | `/api/v1/users/me` | A, B, C | Actualiza datos básicos del usuario (`fullName, phone`) |
| POST | `/api/v1/users/me/change-password` | A, B, C | `{ currentPassword, newPassword }` |

---

# 5. Plan de integración frontend

### 5.1 Cambios en `StateService` y nuevo `AuthService`

`selectedEstate`/`selectedProperty` ya no son fuente de verdad: pasan a ser solo un cache de navegación (para evitar parpadeo al entrar al detalle), y la fuente real es siempre la llamada HTTP a `GET /estates/:id` o `GET /owner-properties/:id` en el `ngOnInit` del componente de detalle, usando el `:id` de la ruta. Esto corrige un bug latente de hoy: si se navega directo por URL (refresh de página), `state.selectedEstate()` es `null` y el componente cae al fallback de buscar en el mock array — con HTTP real no hay fallback posible, así que el patrón correcto es siempre `route.snapshot.paramMap.get('id')` → HTTP, y usar el signal de estado solo como optimización opcional.

Se introduce un nuevo **`AuthService`** (`core/auth.service.ts`) con signals: `currentUser = signal<User | null>(null)`, `accessToken = signal<string | null>(null)`, persistido en `localStorage` (refresh token) y memoria (access token, nunca en localStorage por seguridad XSS). `currentRole` de `StateService` se deriva de `currentUser().role` en producción; el `cycleRole()` actual se mantiene solo bajo un flag `environment.mockRoleSwitch` para desarrollo/demo, pero no se expone en producción.

### 5.2 Servicios Angular nuevos (HttpClient)

Cada uno vive en `core/services/` (carpeta nueva) o, si se prefiere alinear con el patrón actual del repo, junto a cada feature en una subcarpeta `services/`. Recomiendo `core/services/` para los de alcance transversal (auth, estates, owner-properties) y `features/<feature>/services/` para los específicos de un dominio (ej. `features/accounting/services/remesas.service.ts`).

| Servicio | Responsabilidad | Sustituye en mock-data.ts |
|---|---|---|
| `AuthService` | login, refresh, logout, perfil | — (no existía) |
| `EstatesService` | CRUD fincas, propiedades, adhesion-requests | `MOCK_ESTATES`, `MOCK_PROPERTIES`, `MOCK_REQUESTS` |
| `OwnerPropertiesService` | CRUD owner-properties, vinculación | `MOCK_OWNER_PROPERTIES`, `LINK_ESTATES` |
| `IssuesService` | CRUD incidencias + timeline + fotos | `ISSUE_CATALOG` |
| `RequestsService` | CRUD solicitudes Rol C (`category`: Incidencia/Documentación/Modificación/Consulta/Queja); para items con `category = 'Incidencia'` delega el detalle de gestión (estado, proveedor, timeline) en `IssuesService` vía `linkedIssueId` — no reimplementa ese flujo (ver 3.1.3/4.5) | constantes locales en `solicitudes-c.component.ts` (interfaz `Solicitud`, hoy no existe en `models.ts`) |
| `AmenitiesService` | catálogo amenities + disponibilidad | `AMENITY_CATALOG`, `OTHER_BOOKINGS` |
| `BookingsService` | CRUD reservas | `INITIAL_BOOKINGS` |
| `CommunicationsService` | comunicados + lectura | `MOCK_COMMUNICATIONS` |
| `DocumentsService` | documentos | `MOCK_DOCUMENTS` |
| `AlertsService` | alertas in-app | constante local en `alertas-c.component.ts` |
| `AccountingService` | resumen financiero por finca | `MOCK_ACCOUNTING_ESTATES` |
| `MovementsService` | movimientos + conciliación bancaria | `MOCK_MOVEMENTS`, `BANK_EXTRACT`, `CHART_ACCOUNTS` |
| `ReceiptsService` | recibos + periodos | `ACCT_PERIODS`, `ACCT_RECEIPTS`, `ACCT_PAY_METHODS` |
| `RemesasService` | remesas SEPA + candidatos | `REMESAS_HISTORY`, `REMESA_LINES_MAY`, `REMESA_CANDIDATES` |
| `SuppliersService` | proveedores + facturas | `MOCK_SUPPLIERS` |
| `BudgetService` | presupuesto | `MOCK_BUDGET` |
| `DebtorsService` | morosidad + gestiones + planes de pago | `MOCK_DEBTORS` |
| `AdminPlatformService` | gestoras (Rol A) | `MOCK_ADMINS` |
| `SubscriptionService` | plan, addons, facturas SaaS | constantes locales en `suscripcion.component.ts` |
| `SettingsService` | perfil, notificaciones, sesiones, integraciones | constantes locales en `ajustes*.component.ts` |

Patrón recomendado para cada servicio (ejemplo `EstatesService`):

```typescript
@Injectable({ providedIn: 'root' })
export class EstatesService {
  private http = inject(HttpClient);
  private base = `${environment.apiBaseUrl}/estates`;

  list(filters?: { type?: string; page?: number; pageSize?: number }): Observable<Page<Estate>> {
    return this.http.get<Page<Estate>>(this.base, { params: toHttpParams(filters) });
  }

  getById(id: string): Observable<Estate> {
    return this.http.get<Estate>(`${this.base}/${id}`);
  }

  create(dto: CreateEstateDto): Observable<Estate> {
    return this.http.post<Estate>(this.base, dto);
  }

  update(id: string, dto: Partial<CreateEstateDto>): Observable<Estate> {
    return this.http.patch<Estate>(`${this.base}/${id}`, dto);
  }
}
```

Cada componente feature reemplaza la asignación directa (`estates = MOCK_ESTATES`) por un signal alimentado vía `toSignal()` de `@angular/core/rxjs-interop` o por un `resource()`/llamada en `ngOnInit` con un signal local actualizado manualmente. Dado que el proyecto ya usa signals de forma consistente, se recomienda el patrón:

```typescript
estates = signal<Estate[]>([]);

ngOnInit(): void {
  this.estatesService.list().subscribe(page => this.estates.set(page.data));
}
```

### 5.3 Interceptors necesarios

Se registran en `app.config.ts` vía `provideHttpClient(withInterceptors([...]))`:

1. **`authInterceptor`**: añade `Authorization: Bearer <token>` desde `AuthService.accessToken()` a toda request hacia `environment.apiBaseUrl`. Si recibe `401`, intenta un refresh único y reintenta la request original; si el refresh también falla, hace logout y redirige a `/login`.
2. **`errorInterceptor`**: captura errores HTTP, los normaliza al formato `{ statusCode, message }` ya definido por el backend, y los expone vía un `ErrorService` (signal con el último error) para que los componentes muestren toasts consistentes (reemplazando los `showToast()` locales dispersos en casi todos los componentes, que hoy son simulaciones optimistas sin posibilidad real de fallo).
3. **`loadingInterceptor`**: incrementa/decrementa un contador global en un `LoadingService` (signal `activeRequests`), usado para mostrar un spinner global o por sección.

### 5.4 `environment.ts` / `environment.prod.ts`

Archivos nuevos (no existen hoy — confirmado, el repo no tiene carpeta `src/environments/`):

```typescript
// src/environments/environment.ts
export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000/api/v1',
  mockRoleSwitch: true, // habilita StateService.cycleRole() para QA/demo
};

// src/environments/environment.prod.ts
export const environment = {
  production: true,
  apiBaseUrl: 'https://api.domora.app/api/v1',
  mockRoleSwitch: false,
};
```

Requiere agregar `fileReplacements` en `angular.json` bajo la configuración `production` del builder (`@angular/build:application`), apuntando `environment.ts` → `environment.prod.ts`.

### 5.5 Orden recomendado de migración feature por feature

Se prioriza por: (a) bloqueo de todo lo demás (auth primero, sin excepción), (b) valor de negocio inmediato, (c) menor acoplamiento entre módulos.

1. **Auth + perfil** (`AuthService`, interceptors, `/settings/profile`) — bloqueante para todo lo demás.
2. **Estates + Owner Properties + vinculación** (`dashboard-b`, `dashboard-c`, `estate-detail` tab propiedades, `property-detail` tab resumen, `add-property`, vinculación) — es el corazón del modelo de datos, todo lo demás depende de tener `estate_id`/`owner_property_id` reales.
3. **Issues / Incidencias** (compartidas B↔C) — siguiente en valor porque ya tiene flujo bidireccional maduro en el frontend.
4. **Accounting: resumen + recibos** (`accounting-dashboard`, `accounting-detail` resumen, `recibos-tab`) — es el módulo de mayor complejidad de negocio, se separa en sub-fases.
5. **Accounting: movimientos + conciliación bancaria** (`movimientos-tab`).
6. **Accounting: remesas SEPA** (`remesas-tab`, `nueva-remesa`) — depende de recibos y mandatos ya existentes.
7. **Accounting: proveedores + presupuesto** (`proveedores-tab`, `presupuesto-tab`).
8. **Accounting: morosidad** (`morosidad-tab`) — depende de recibos impagados ya persistidos.
9. **Amenities / Reservas** (`property-detail` tab reservas) — independiente del resto, se puede paralelizar con el bloque de accounting si hay 2 personas.
10. **Comunicaciones + documentos + alertas** (`property-detail` tabs, `alertas-c`).
11. **Solicitudes** (`solicitudes-c`) — implementa `RequestsService`/tabla `requests` para las categorías Documentación/Modificación/Consulta/Queja; el subcaso `category = 'Incidencia'` no requiere trabajo de backend nuevo en este paso porque delega en `IssuesService`/`issues`, ya entregado en el paso 3 (ver decisión cerrada, sección 3.1.3 y riesgo #1 en sección 7).
12. **Rol A: gestoras + planes** (`dashboard-a`).
13. **Suscripción/billing del admin de finca** (`suscripcion`) — depende de planes ya definidos en el paso 12.
14. **Ajustes finales** (`ajustes`, `ajustes-c`: notificaciones, sesiones, integraciones) — bajo riesgo, se puede hacer en paralelo desde el paso 2 en adelante.

---

# 6. Roadmap por fases

| Fase | Alcance | Duración | Entregable verificable |
|---|---|---|---|
| 0 | Setup: repo backend NestJS+Prisma, Docker Compose (API+Postgres), CI básico (lint+test+build), esquema inicial de `users`/`administrators`/`estates` | 1 semana | `docker compose up` levanta API+DB; `POST /auth/login` funciona contra un usuario seed. |
| 1 | Auth completa + perfil + interceptors en frontend | 1 semana | Login real desde Angular, JWT persistido, ruta protegida redirige a `/login` si no hay sesión. |
| 2 | Estates + Properties + Owner Properties + vinculación + adhesion-requests | 2 semanas | Un propietario crea una `owner_property`, la vincula a una finca existente, el admin de finca la aprueba desde `estate-detail`. |
| 3 | Issues / Incidencias completo (CRUD + timeline + fotos S3) | 2 semanas | Un propietario reporta una incidencia con foto, el admin la gestiona (proveedor, presupuesto, estado) y el propietario ve la actualización en tiempo real (polling o refresh). |
| 4 | Accounting: resumen + periodos + recibos (generación masiva + manual) | 2 semanas | Admin genera recibos del mes para todos los propietarios de una finca; un propietario ve sus recibos reales en `property-detail`. |
| 5 | Accounting: movimientos + conciliación bancaria + plan contable | 1.5 semanas | Admin importa un extracto, ejecuta auto-match, concilia manualmente lo que falta. |
| 6 | Accounting: remesas SEPA (mandatos, generación, fichero pain.008, devoluciones) | 2 semanas | Admin genera una remesa real desde candidatos con mandato, descarga el XML SEPA, marca líneas como cobradas/devueltas. |
| 7 | Accounting: proveedores + presupuesto + morosidad (gestiones, planes de pago, reclamación masiva, recargos) | 2 semanas | Admin registra una factura de proveedor, define presupuesto anual, gestiona un moroso con historial y aplica recargos. |
| 8 | Amenities + reservas (con constraint anti-solapamiento) | 1 semana | Propietario reserva una pista de pádel; el sistema rechaza una reserva solapada con un 409. |
| 9 | Comunicaciones + documentos + alertas + solicitudes (categorías Documentación/Modificación/Consulta/Queja — las de categoría Incidencia ya quedan cubiertas desde la Fase 3 vía `issues`, ver sección 3.1.3) | 1.5 semanas | Admin publica un comunicado, todos los propietarios de la finca lo ven y queda registrado como leído/no leído; propietario abre una solicitud y recibe respuesta. |
| 10 | Rol A completo (gestoras, planes, facturación SaaS, actividad) + Suscripción Rol B + Ajustes finales (notificaciones, sesiones) | 2 semanas | Soporte (Rol A) aplica un descuento y cambia de plan a una gestora; el admin de finca (Rol B) ve reflejado su plan y cambia de addons. |

**Total: 15 semanas** (~3.5 meses) con 1 desarrollador backend full-time + el desarrollador frontend actual integrando en paralelo según el orden de la sección 5.5 (las fases de frontend pueden ir 1 fase por detrás de las de backend sin bloquear).

**Hitos de demo intermedios**:
- Semana 5: login + vinculación de propiedades + incidencias funcionando end-to-end (reemplaza el "Fase 1 crítica" del draft original, pero medido en semanas reales).
- Semana 11: contabilidad completa (recibos, movimientos, remesas, morosidad) operativa.
- Semana 15: plataforma completa, lista para onboarding de las primeras gestoras reales.

---

# 7. Riesgos y decisiones abiertas

Notas para el usuario — no bloquean el inicio del trabajo, pero conviene decidirlas antes de las fases que las afectan:

1. **(Cerrado) Unificación `requests` (Solicitudes Rol C) vs `issues` (Incidencias)**: verificado contra el código real — `solicitudes-c.component.ts` define `type: SolType = 'Incidencia' | 'Documentación' | 'Modificación' | 'Consulta' | 'Queja'`, es decir `'Incidencia'` es solo una de cinco categorías de "Solicitudes", y las otras cuatro son trámites administrativos sin proveedor/presupuesto/reparación (no son el mismo concepto que `Issue`). Además `Estate.requests`/`MOCK_REQUESTS` (`AdhesionRequest[]`, usado en `dashboard-b`/`estate-detail`) es una entidad no relacionada (solicitudes de adhesión a finca), no debe confundirse con `solicitudes-c`. Decisión tomada: **unificación parcial**, no fusión total. `requests` se mantiene como tabla propia con `category` (incluye `'Incidencia'`); cuando `category = 'Incidencia'`, se crea automáticamente un `issue` enlazado vía `linked_issue_id` y la gestión real (proveedor, presupuesto, estado de reparación, timeline) se delega íntegramente a `issues`/`IssuesService`, evitando duplicar ese flujo ya maduro en el frontend. Ver detalle en sección 3.1.3 y endpoints en sección 4.4/4.5.
2. **Proveedor de hosting**: cualquier PaaS con Postgres administrado (Railway, Render, Fly.io) es suficiente para el volumen actual; un VPS propio (Hetzner, DigitalOcean) da más control pero exige gestión de backups/parches manual. No es una decisión que cambie el diseño de la API.
3. **Generación del fichero SEPA pain.008.001.02**: se puede implementar con una librería npm existente o generar el XML a mano siguiendo el esquema oficial; conviene validar contra el validador de la entidad bancaria real antes de la Fase 6, ya que cada banco puede tener variaciones menores aceptadas.
4. **Cifrado de IBAN en reposo**: decidir si se usa `pgcrypto` (cifrado a nivel de columna en Postgres) o cifrado a nivel de aplicación (AES-256 antes de persistir) — ambos son válidos, el segundo es más portable si se cambia de motor de BD en el futuro.
5. **RLS de PostgreSQL**: queda descartado para el lanzamiento (sección 0) pero documentado como mejora de defensa en profundidad a reevaluar cuando haya datos reales de clientes en producción y el equipo de backend crezca a 2+ personas.
6. **Quién mantiene el backend a futuro**: si va a ser la misma persona que hoy mantiene el frontend, conviene priorizar simplicidad operativa (menos servicios, menos infraestructura) sobre escalabilidad teórica — coherente con las decisiones ya tomadas en este plan.
7. **Política de backups de PostgreSQL**: definir RPO/RTO objetivo antes de tener el primer cliente real con datos contables (no antes de la Fase 4); cualquier PaaS gestionado suele incluir backups automáticos diarios como punto de partida razonable.
8. **Notificaciones reales (email/SMS/push)**: el modelo de `notification_preferences` está listo desde el diseño, pero la implementación del envío efectivo (proveedor de email transaccional tipo Postmark/SendGrid, proveedor SMS) no está en el alcance de las 15 semanas — se recomienda tratarla como una fase 11 separada una vez la plataforma tenga usuarios reales.

---
