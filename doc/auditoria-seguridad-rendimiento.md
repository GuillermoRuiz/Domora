# Auditoría de seguridad y rendimiento — Domora

> Auditoría realizada sobre el código real (no sobre supuestos). Cada hallazgo
> lleva la referencia `fichero:línea` que lo demuestra. Ordenado por severidad,
> no por módulo: lo que hay que arreglar primero va primero.

> **Estado: seis fases ejecutadas.** Corregidos y verificados: C1, C2, C3,
> A1, A3, A4, A6, A7, M1, M2, M3, M5, E2 y E4. A2 se completa en la Fase 5
> —documentos y comunicados paginados; auditoría RGPD y tickets revisados y
> descartados a propósito, ver su apartado— salvo el log de actividad, que
> ya estaba correctamente acotado. E1 cubre el núcleo de negocio del
> backend (recibos, remesas SEPA, certificado de deuda) y, en la Fase 6, el
> frontend: `AuthService`, guards de ruta, `TenantContextService` y
> `DataService` casi completo (166/167 métodos) — queda solo tests de
> componentes con render real. Parcial: E3 (primera pestaña extraída). M4 queda instrumentado a la
> espera de datos de producción, y **A5 aplazado a propósito** por requerir
> verificación en navegador. El detalle de lo pendiente está al final. Los
> apartados corregidos conservan la descripción original del problema —es
> el registro de por qué se cambió—
> con una nota de estado al principio.

## Resumen ejecutivo

| Severidad | Nº | Titulares |
|-----------|----|-----------|
| **Crítico** | 3 | Secreto JWT por defecto en código · IBANs cifrados con clave derivable · IDOR en apoderamientos |
| **Alto** | 6 | Rate limiting de login roto en producción · sin paginación (86/94 consultas) · full scan en cada refresco de sesión · tablas de tokens sin purga · refresh token en `localStorage` · sin `helmet`/CSP |
| **Medio** | 6 | N+1 en proveedores · auditoría RGPD "fire and forget" · `decrypt()` acepta texto plano · carga innecesaria de `passwordHash` · índices incompletos · sin límite de tamaño de petición |
| **Estructural** | 4 | 0 tests en frontend, 1 en backend · sin CI · componentes-dios · código muerto |

El patrón de fondo: **la aplicación está bien construida en lo funcional y el
multi-tenancy está mayormente bien resuelto** (70 llamadas a `assertAccess`,
`passwordHash` correctamente excluido con `omit:`, cero sinks de XSS, rutas
lazy). Los problemas serios están concentrados en (a) **fallbacks silenciosos de
secretos**, (b) **ausencia de límites** (paginación, purga, tamaño) y (c)
**ausencia de red de seguridad** (tests, CI).

---

## CRÍTICO

### C1 · `JWT_SECRET` cae a un valor fijo publicado en el repositorio

> **CORREGIDO.** `config/env.validation.ts` aborta el arranque en producción
> si falta `JWT_SECRET`, si mide menos de 32 caracteres o si tiene el valor
> de desarrollo. El fallback desapareció de `auth.module.ts`
> (`getOrThrow`). Fuera de producción se inyecta el valor por defecto con un
> aviso explícito.

**Evidencia:** [auth.module.ts:21-22](../backend/src/auth/auth.module.ts#L21-L22)

```ts
secret: configService.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
```

Si la variable de entorno falta o llega vacía en producción, la aplicación
**arranca igual, sin avisar**, firmando tokens con un secreto que está en el
código fuente. Cualquiera que lea el repositorio puede forjar un JWT con
`role: 'A'` y `estateIds` arbitrarios, y el `RolesGuard`/`EstateScopeGuard` lo
aceptarán como legítimo — porque confían en los claims del token.

Esto es especialmente peligroso con el despliegue actual: el runbook
([deploy-azure.md:26](deploy-azure.md)) inyecta los secretos como variables de
entorno de Container Apps y el propio documento admite que moverlos a Key Vault
está pendiente. Un fallo de plantilla Bicep o un secreto mal nombrado no produce
un error de arranque: produce una aplicación abierta.

**Corrección:** validar el entorno en el arranque y **fallar duro**. Con
`ConfigModule.forRoot({ validationSchema })` o una función de validación
explícita: si `NODE_ENV === 'production'` y falta `JWT_SECRET` (o mide menos de
32 bytes), lanzar y abortar el arranque. El fallback de desarrollo puede
mantenerse, pero solo fuera de producción.

### C2 · Los IBAN se cifran con una clave derivable del secreto por defecto

> **CORREGIDO.** `SEPA_ENC_KEY` (64 hex) es obligatoria en producción vía
> `env.validation.ts`, y `CryptoService` lanza como segunda barrera si
> llegase a construirse sin ella con `NODE_ENV=production`. El mismo control
> se añadió a `prisma/seed.ts`, que duplicaba la derivación fuera del
> contenedor de Nest. Pendiente aparte: rotación de clave (M3).

**Evidencia:** [crypto.service.ts:29-36](../backend/src/sepa/crypto.service.ts#L29-L36)

```ts
const secret = configService.get<string>('JWT_SECRET') ?? 'dev-secret-change-me';
this.key = crypto.scryptSync(secret, 'domora-iban-at-rest', 32);
this.logger.warn('SEPA_ENC_KEY no configurada — ...');
```

El cifrado en reposo de IBANs (AES-256-GCM) es una decisión correcta y bien
implementada. Pero encadena con C1: si falta `SEPA_ENC_KEY`, la clave se deriva
de `JWT_SECRET`, que a su vez puede ser la cadena fija del repositorio. La sal
(`'domora-iban-at-rest'`) también es pública y fija. Resultado: **la clave de
cifrado de datos bancarios es completamente reproducible por cualquiera con
acceso al código**, y el único aviso es un `logger.warn` que en producción nadie
va a leer a tiempo.

El comentario del propio fichero dice "NUNCA usar ese fallback en producción" —
pero nada en el código lo impide. Un comentario no es un control.

**Corrección:** mismo criterio que C1 — en producción, si `SEPA_ENC_KEY` no es
válida (64 hex), abortar el arranque. Además, planificar rotación de clave
(versionar el prefijo: ya existe `enc:v1:`, así que la vía está abierta).

### C3 · IDOR: cualquier usuario lee los apoderamientos de cualquier otro

> **CORREGIDO.** `UserRepresentationsService.assertCanQuery()` exige
> `user.id === userId` (rol A mantiene su bypass), aplicado en el servicio
> como el resto del código. Verificado: un propietario recibe 403 al
> consultar las representaciones de otro usuario y 200 al consultar las
> suyas. El acceso del rol B, si llega a necesitarse, debe añadirse acotado
> a sus fincas.

**Evidencia:** [user-representations.controller.ts:10-13](../backend/src/user-representations/user-representations.controller.ts#L10-L13)
y [user-representations.service.ts:13](../backend/src/user-representations/user-representations.service.ts#L13)

```ts
@Get('active')
listActive(@Param('userId') userId: string) {          // ← sin @CurrentUser()
  return this.representationsService.listActiveFor(userId);
}
```

El controlador **no tiene `@Roles`, no tiene `EstateScopeGuard`, y no compara el
`:userId` de la ruta con el usuario autenticado**. El servicio tampoco: recibe un
`userId` suelto y consulta directamente. Está protegido únicamente por
`JwtAuthGuard`, es decir: *estar autenticado como cualquiera* basta.

Un propietario (rol C) puede iterar UUIDs y reconstruir el grafo de
representaciones legales de toda la plataforma: quién apodera a quién, sobre qué
finca y con qué vigencia. Son datos personales y de relación jurídica —
exactamente el tipo de dato que el propio proyecto trata con cuidado en
`doc/compliance/rgpd.md`. Lo mismo aplica a `canActOnBehalfOf`.

Es el único IDOR confirmado, y llama la atención precisamente porque el resto del
código **sí** hace las cosas bien (70 `assertAccess` repartidos por los
servicios). Este módulo se quedó fuera del patrón.

**Corrección:** inyectar `@CurrentUser()` y exigir `user.id === userId` salvo rol
A; o mejor, eliminar el `:userId` de la ruta y servir siempre `/me/representations`,
igual que hace `GdprController` (`gdpr/me`, que **sí** está bien resuelto).

---

## ALTO

### A1 · El rate limiting de login no funciona en producción

> **CORREGIDO.** `main.ts` configura `trust proxy` (número de saltos vía
> `TRUST_PROXY_HOPS`, por defecto 1), así que `req.ip` vuelve a ser la IP
> del cliente. Verificado: agotar los 5 intentos desde una IP no afecta al
> mismo email desde otra IP — que era el vector de bloqueo de cuentas
> ajenas. Pendiente de la corrección de fondo: separar límite por IP y por
> email con backoff, y moverlo a almacén compartido al escalar réplicas.

**Evidencia:** [login-throttle.guard.ts:27](../backend/src/auth/guards/login-throttle.guard.ts#L27)
· ausencia de `trust proxy` en [main.ts](../backend/src/main.ts)
· arquitectura en [deploy-azure.md:11](deploy-azure.md)

```ts
const key = `${request.ip}|${email.toLowerCase()}`;
```

En producción el tráfico entra por nginx (`domora-web`) y se reenvía por la red
interna al contenedor de la API. Como Express **no tiene `trust proxy`
configurado**, `request.ip` es la IP interna del proxy — **la misma para todas
las peticiones del mundo**.

Consecuencias, ambas malas:

1. **La protección por IP desaparece**: un atacante distribuido no se distingue
   de un usuario legítimo, porque la IP ya no discrimina nada.
2. **Se abre un vector de denegación de servicio por cuenta**: como la clave
   efectiva pasa a ser solo el email, cualquiera puede bloquear el acceso de
   cualquier usuario conocido gastando 5 intentos por minuto contra su email. El
   usuario legítimo recibe `429` indefinidamente.

El guard está bien escrito y el razonamiento del comentario (in-memory, sin Redis)
es defendible; lo que falla es la premisa de que `request.ip` es la IP del cliente.

**Corrección inmediata:** `app.set('trust proxy', 1)` en `main.ts` (y asegurar
que nginx envía `X-Forwarded-For`). **Corrección de fondo:** separar los dos
límites — uno por IP (anti fuerza bruta) y otro por email con backoff progresivo
en lugar de bloqueo duro (anti lockout). Al escalar a varias réplicas, mover el
contador a un almacén compartido.

### A2 · Sin paginación: 86 de 94 consultas devuelven la tabla entera

> **CORREGIDO (completado en la Fase 5).** Se centraliza el patrón en
> `common/pagination.ts` (`resolvePage`/`toPage`, por defecto 50 y tope de
> servidor 200 pase lo que pase el cliente) y se aplica al peor caso:
> `issues.listByEstate`, que además de no paginar arrastraba las fotos y el
> historial completo de cada incidencia. El frontend muestra "Mostrando X de
> Y" con "Cargar más", de modo que la truncación es **visible** en vez de
> silenciosa.
>
> **Fase 5**: `resources.listDocuments` y `listCommunications` ya paginan
> (mismo patrón `resolvePage`/`toPage`), con "Cargar más" en la pestaña de
> Documentos de `estate-detail` y en las pestañas de Comunicados/Documentos
> de `property-detail` (rol C) — de nuevo, truncación visible en vez de
> silenciosa.
>
> **Revisado y descartado a propósito**: `tickets.listByUser`. Parecía el
> siguiente candidato natural, pero es una colección **por usuario**, no por
> finca — un propietario acumula unas pocas solicitudes a lo largo de años
> de titularidad, no miles. Encaja en el mismo criterio de exclusión que
> proveedores o deudores (ver abajo), no en el de documentos/comunicados,
> que crecen con el histórico entero de la comunidad y son compartidos por
> todos sus propietarios. Sí queda anotado un problema distinto —de
> naturaleza M6, no A2—: `sidebar.component.ts` llama a
> `listTicketsByUser` (con el timeline completo de cada ticket) solo para
> calcular un contador de "abiertas" en el badge; un endpoint de solo
> conteo sería más barato, pero no es un problema de paginación.
>
> **No aplica todavía**: el log de auditoría RGPD no tiene, hoy, ningún
> endpoint que lo liste — `AuditService.logAccess` solo escribe — así que no
> hay nada que paginar todavía; sería relevante si se construye una pantalla
> de auditoría para el rol A. El feed de actividad (`resources.listActivity`)
> ya toma un `limit` explícito (por defecto 10) pensado como vista previa,
> no como tabla navegable completa, así que no aplica el mismo patrón de
> "Cargar más" — encaja mejor en el criterio de "acotado por naturaleza".
>
> Se dejan sin tocar a propósito las colecciones acotadas por naturaleza
> —propiedades, proveedores, personal, instalaciones, cuentas contables y
> deudores de una finca, tickets de un usuario; reservas, que ya filtra por
> `date >= hoy`—: paginarlas añadiría complejidad sin acotar nada real.

**Evidencia:** 94 `findMany` en `backend/src`, solo 8 con `take:`. Únicamente
`accounting`, `movements`, `direct-messages` y `resources` pagina.

Endpoints como `listStaff`, `listSuppliers`, `listDebtors`, `listPropertiesByEstate`
o `listDocumentsByEstate` devuelven **todo** lo que haya. Hoy, con datos de demo,
no se nota. Con una gestora real de 40 fincas y miles de recibos, cada carga de
pantalla arrastra la tabla completa a memoria del proceso, la serializa a JSON y
la manda por la red — y el frontend la vuelve a pintar entera.

Es simultáneamente un problema de **rendimiento** (memoria del contenedor,
latencia, coste de ancho de banda) y de **seguridad** (amplificación: una sola
petición autorizada extrae el conjunto completo, y facilita el volcado masivo si
una credencial se ve comprometida).

**Corrección:** adoptar el patrón que ya existe en `accounting.service.ts:164`
(`skip`/`take` con `page`/`pageSize`) como estándar transversal, con un
`pageSize` máximo por defecto (p. ej. 100) aplicado **en el servicio**, no
confiando en que el cliente lo pida. Priorizar las colecciones que crecen sin
techo: recibos, movimientos, incidencias, documentos.

### A3 · Cada refresco de sesión hace un escaneo completo de tabla

> **CORREGIDO.** `RefreshToken.tokenHash` es ahora `@unique` (migración
> `20260807194500_index_refresh_token_hash`), la consulta pasa a `findUnique`
> y el `include: { user: true }` se sustituye por un `select` de los tres
> campos que se usan, con lo que deja de cargarse el `passwordHash`. Se
> añade además la comprobación de `user.deletedAt`, para que un token vivo
> de una cuenta suprimida no renueve sesión venga la baja de donde venga.
> Verificado con `EXPLAIN ANALYZE`: `Index Scan using
> refresh_tokens_token_hash_key`, coste 8.29 y constante frente al tamaño de
> la tabla, en lugar del `Seq Scan` anterior.

**Evidencia:** [auth.service.ts:446-449](../backend/src/auth/auth.service.ts#L446-L449)
· [schema.prisma:583](../backend/prisma/schema.prisma#L583)

```ts
const stored = await this.prisma.refreshToken.findFirst({
  where: { tokenHash },          // ← columna SIN índice y SIN @unique
  include: { user: true },       // ← trae la fila completa, passwordHash incluido
});
```

`RefreshToken.tokenHash` no tiene ni `@unique` ni `@@index`; el único índice es
`@@index([userId])`. Postgres no puede hacer otra cosa que un *sequential scan*.

Y esta es la ruta **más caliente de toda la aplicación**: el access token dura
15 minutos, así que cada sesión activa golpea este endpoint 4 veces por hora. La
tabla, además, **crece con cada login y nunca se purga** (ver A4). Es un
problema que no se manifiesta en desarrollo y que degrada de forma no lineal en
producción justo cuando llegan usuarios.

Contrasta con `PasswordResetToken.tokenHash`, que **sí** es `@unique` — la
inconsistencia sugiere que fue un descuido, no una decisión.

**Corrección:** añadir `@unique` a `RefreshToken.tokenHash` (permite además usar
`findUnique`, semánticamente correcto: el hash identifica un token) y sustituir
`include: { user: true }` por un `select` de los campos que `issueTokens`
realmente necesita — hoy carga el `passwordHash` en memoria sin motivo.

### A4 · Las tablas de tokens crecen sin límite y sin purga

> **CORREGIDO.** `auth/token-cleanup.service.ts` purga a diario (`@Cron`,
> vía `@nestjs/schedule`) los tokens caducados, revocados o usados con más
> de 7 días — se conserva esa ventana por trazabilidad forense. Es
> idempotente, así que puede correr en varias réplicas sin coordinación.
> Verificado contra la base real: eliminó 129 filas y dejó intactas las 195
> sesiones vigentes.

**Evidencia:** ningún `deleteMany` de tokens caducados en `auth.service.ts`;
`@nestjs/schedule` no está en `package.json`.

`refresh_tokens` y `password_reset_tokens` acumulan filas para siempre: tokens
caducados, revocados y ya usados. Impacto doble:

- **Rendimiento:** agrava directamente A3 (cuanto más grande la tabla, peor el
  escaneo) y engorda backups.
- **Seguridad:** amplía el radio de exposición de un volcado de base de datos —
  se conserva indefinidamente el historial de sesiones de todos los usuarios.

**Corrección:** tarea programada (p. ej. `@nestjs/schedule`, diaria) que borre
tokens `expiresAt < now()` o `revokedAt`/`usedAt` no nulos con cierta antigüedad.
Conservar una ventana corta si se quiere trazabilidad forense, pero acotada.

### A5 · El refresh token vive en `localStorage`

> **APLAZADO A PROPÓSITO — requiere verificación en navegador.** Es el único
> punto de la auditoría que no se puede validar con las herramientas
> disponibles en esta sesión, y hacerlo a ciegas sería temerario: toca el
> flujo de autenticación del que depende toda la aplicación.
>
> El problema no es escribir el código, es que su corrección depende de
> semántica del navegador que `curl` no reproduce:
>
> - **Los entornos difieren.** En producción nginx sirve SPA y API bajo el
>   mismo origen, así que valdría `SameSite=Strict`, lo ideal. Pero en
>   desarrollo son orígenes distintos (`localhost:4200` → `localhost:3000`),
>   lo que obliga a `SameSite=None; Secure` y a `credentials: 'include'`. Es
>   decir, la configuración correcta no es la misma en los dos sitios, y la
>   que se pruebe en local no es la que correrá en producción.
> - **`curl` acepta cualquier cookie.** Guarda y reenvía lo que le manden sin
>   aplicar `SameSite` ni la política de orígenes, así que una verificación
>   con `curl` daría verde aunque el navegador rechazase la cookie. Sería una
>   prueba que no prueba nada.
> - **El modo de fallo es total.** Si la cookie no viaja, `restoreSession()`
>   deja de recuperar la sesión y todo el mundo aparece deslogueado al
>   recargar.
>
> Y conviene ponerlo en contexto: **el riesgo actual es bajo**. La auditoría
> confirmó cero sinks de XSS en el frontend, la CSP añadida en la Fase 2 es
> justamente la defensa en profundidad que hace tolerable el `localStorage`,
> y la rotación de un solo uso ya limita la reutilización de un token robado.
> Es endurecimiento, no un agujero abierto.
>
> **Para hacerlo**, con alguien que pueda probar en navegador: cookie
> `httpOnly` + `Secure` + `SameSite` dependiente del entorno, `credentials`
> en el `HttpClient` y en CORS, y comprobar en las DevTools que la cookie se
> envía en `/auth/refresh` tras un F5 y tras cerrar y reabrir la pestaña.

**Evidencia:** [auth.service.ts:151](../src/app/core/auth.service.ts#L151)

La decisión está razonada en el código (access token solo en memoria, refresh
token persistido para sobrevivir a un F5) y **el riesgo hoy es bajo**: no hay ni
un solo sink de XSS en el frontend (cero usos de `innerHTML`, `bypassSecurityTrust`
o `DomSanitizer` — comprobado), así que el escape por defecto de Angular está
intacto.

Pero es una apuesta a no equivocarse nunca: cualquier XSS futuro —o una
dependencia comprometida— pasa de "molestia" a **toma de control persistente de
la cuenta**, porque el refresh token permite reemitir sesiones indefinidamente.
La rotación de un solo uso que ya está implementada mitiga la reutilización, no
el robo inicial.

**Corrección (media prioridad, alta si se abre el producto):** mover el refresh
token a una cookie `httpOnly` + `Secure` + `SameSite=Strict`. Es viable
precisamente porque en producción **no hay CORS** (nginx sirve SPA y API bajo el
mismo origen, según `deploy-azure.md:22`), que es justo el escenario en el que
las cookies son cómodas.

### A6 · Sin `helmet` ni CSP — y la justificación para no usarlo es falsa

> **CORREGIDO.** El middleware a mano se sustituye por `helmet`, con
> `frameguard: { action: 'deny' }` explícito: su valor por defecto es
> `sameorigin`, así que adoptar la librería sin más habría **rebajado** la
> protección que ya había (se detectó al verificar las cabeceras). La CSP se
> emite desde `nginx.conf`, que es quien sirve el HTML — declararla en una
> API que solo devuelve JSON no protegería nada. De paso se corrigió un
> fallo del propio nginx: un `add_header` dentro de un `location` descarta
> los heredados, así que el JS y el CSS de la aplicación se estaban
> sirviendo **sin ninguna** cabecera de seguridad, `nosniff` incluida.

**Evidencia:** [main.ts:9-11](../backend/src/main.ts#L9-L11)

```
// Cabeceras de seguridad (Fase 15) — sin dependencia de helmet
// (node_modules está trackeado en git; un npm install añadiría miles de
// ficheros). Cubre lo esencial para una API JSON.
```

**`node_modules` no está trackeado en git** (verificado: 0 ficheros bajo
`node_modules/` en `git ls-files`). La razón que sostiene la decisión ya no es
cierta — probablemente lo fue en algún momento y el comentario se quedó.

Lo implementado a mano cubre `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `CORP` y HSTS. Falta lo más relevante para la SPA: **una
Content-Security-Policy**, que es la defensa en profundidad que hace que A5 sea
tolerable.

**Corrección:** instalar `helmet` y configurar CSP en nginx para el frontend
(donde realmente importa, ya que es quien sirve el HTML).

---

### A7 · Dependencias con vulnerabilidades altas conocidas *(hallazgo posterior)*

> **CORREGIDO.** Detectado al ejecutar `npm audit` durante la Fase 2, no en
> la revisión inicial de código.

`npm audit` reportaba **5 vulnerabilidades de severidad alta**: dos DoS en
`multer` (nombres de campo anidados en profundidad, y limpieza incompleta de
subidas abortadas) arrastradas por `@nestjs/platform-express`. Afectaban
directamente a las cuatro rutas de subida de la aplicación (documentos de
finca, facturas de proveedor, documentos de personal y justificantes de pago).

Resuelto con `npm audit fix` (actualización compatible con el rango de
versiones ya declarado): `found 0 vulnerabilities`.

La lección de fondo no es la actualización en sí, sino que **nadie estaba
mirando**: sin CI (E2), este tipo de aviso solo aparece si alguien ejecuta el
comando por casualidad. `npm audit` debe formar parte del pipeline.

---

## MEDIO

### M1 · N+1 en el listado de proveedores

> **CORREGIDO.** Sustituido por dos `groupBy` (gasto YTD y facturas
> pendientes) más una consulta de movimientos con `select` de tres columnas,
> resolviendo el último movimiento por proveedor en memoria — Prisma no
> expone `DISTINCT ON`. Pasa de `3×N` consultas secuenciales a 3 constantes.
> Verificado con datos sembrados a propósito: toma el movimiento más
> reciente, excluye del YTD el del año anterior y no cuenta las facturas ya
> pagadas.

**Evidencia:** [debtors.service.ts:64-92](../backend/src/debtors/debtors.service.ts#L64-L92)

```ts
for (const supplier of suppliers) {
  const [lastMovement, ytdAgg, pendingInvoices] = await Promise.all([ ...3 consultas... ]);
```

3 consultas por proveedor, y los `Promise.all` **no se solapan entre
proveedores** porque el `await` está dentro del bucle. Con 30 proveedores son 91
consultas secuenciales en 3 tandas cada una. El propio comentario reconoce que
los campos son "de display".

**Corrección:** dos `groupBy` (uno de `movement` por `supplierId`, otro de
`supplierInvoice` por `supplierId` filtrando `Pendiente`) y una consulta para el
último movimiento, resolviendo todo en 3 consultas totales en lugar de 3×N.

### M2 · La auditoría RGPD es "fire and forget"

> **CORREGIDO.** Los cuatro `void this.audit.logAccess(...)` pasan a
> `await`: la operación ya no puede responder antes de que la fila se
> escriba. Un rastro que "probablemente se guardó" no sirve como prueba, que
> es exactamente para lo que existe. Se mantiene a propósito que un fallo de
> escritura NO tumbe la operación —un problema en la tabla de auditoría no
> debe dejar sin recibos a una comunidad— pero se registra a nivel ERROR con
> el usuario y el recurso afectados, no como warning.

**Evidencia:** `void this.audit.logAccess(user, 'debtors', 'list')` en
[debtors.service.ts:228](../backend/src/debtors/debtors.service.ts#L228) y
en `debtCertificate`.

El `void` descarta la promesa: si la escritura del registro de auditoría falla,
**nadie se entera y la operación continúa**. Para datos que el propio proyecto
clasifica como especialmente delicados (morosidad, doctrina AEPD), un rastro de
auditoría que puede perderse en silencio no cumple su función probatoria.

**Corrección:** `await` en la escritura de auditoría dentro de la misma
transacción que la operación auditada, o como mínimo capturar y registrar el
fallo en un canal que sí se vigile.

### M3 · `decrypt()` acepta indefinidamente valores en texto plano

> **CORREGIDO.** `scripts/encrypt-plaintext-ibans.ts` cifra lo que quede en
> claro (con `--dry-run`, idempotente, y reutilizando el `CryptoService` real
> en lugar de duplicar el algoritmo por tercera vez). `decrypt()` sigue
> devolviendo el valor para no romper una lectura, pero ahora lo registra
> como ERROR indicando el script a ejecutar. Verificado sembrando un IBAN en
> claro: lo detecta, lo cifra, el original deja de ser visible en la columna
> y una segunda pasada no hace nada.

**Evidencia:** [crypto.service.ts:51-53](../backend/src/sepa/crypto.service.ts#L51-L53)

Tolerar valores sin el prefijo `enc:v1:` fue correcto para migrar, pero sin
fecha de caducidad se convierte en permanente: un IBAN escrito en claro por un
bug (o por una ruta que se olvide de cifrar) **nunca se detecta**, porque el
sistema lo lee tan feliz.

**Corrección:** script de migración que cifre lo que quede en claro, y después
convertir la tolerancia en un error registrado.

### M4 · Cobertura de índices incompleta

> **INSTRUMENTADO, NO "RESUELTO" — a propósito.** Al revisarlo con detalle, la
> cobertura real es mejor de lo que sugería el ratio 75/56: ya hay compuestos
> bien elegidos (`documents(estate_id, date DESC)`, `issues(property_id,
> status)`, `receipts(period_id, status)`, `activity_log(estate_id,
> occurred_at DESC)`…). Y con los datos de desarrollo —15 propiedades, 3
> movimientos— cualquier medición es ruido: Postgres elige *seq scan* en
> tablas diminutas haga lo que haga, así que no hay forma honesta de
> justificar índices nuevos. Añadirlos "por si acaso" cuesta en cada
> escritura.
>
> Lo que sí se hizo es **hacer posible el diagnóstico**: `PrismaService`
> registra ahora las consultas que superan `SLOW_QUERY_MS` (300 ms por
> defecto). Con eso, decidir qué indexar en producción pasa a ser una
> cuestión de evidencia y no de intuición.

75 relaciones declaradas frente a 56 `@@index`. Además del caso crítico de A3,
conviene revisar las columnas por las que realmente se filtra (`estateId`,
`propertyId`, `status`, `date`) en las tablas que más crecen: recibos,
movimientos, incidencias. Recomendación: activar `log: ['query']` de Prisma en
un entorno con volumen y perfilar, en lugar de añadir índices a ciegas —cada
índice cuesta en escritura.

### M5 · Sin límite explícito de tamaño de petición

> **CORREGIDO (Fase 5).** `main.ts` fija `useBodyParser('json'/'urlencoded',
> { limit: '2mb' })` explícito — no los 100 kb implícitos de Express. Se
> subió de 100 kb a 2 MB a propósito, no solo para declarar el mismo valor:
> `movements/import-bank-extract` manda el lote entero de un extracto
> bancario en un único JSON, y un año de movimientos de una finca grande
> supera los 100 kb sin esfuerzo — con el límite implícito, ese endpoint
> podía estar fallando en silencio para comunidades grandes sin que nadie lo
> hubiera detectado nunca. Además, `ThrottlerModule` (`@nestjs/throttler`,
> in-memory, mismo criterio sin Redis que `LoginThrottleGuard`) aplica un
> límite global de 300 peticiones/minuto por IP a toda la API vía
> `APP_GUARD`. No sustituye al límite de login (5/min por IP+email, mucho
> más estricto): es la capa por debajo, para que ningún endpoint se quede
> sin ningún tope. Verificado en vivo: un JSON de 3 MB devuelve `413`, y la
> respuesta trae cabeceras `X-RateLimit-*`.

El multipart está bien acotado (`StorageService.MAX_SIZE_BYTES`, 10 MB, con
validación de MIME y defensa contra *path traversal* — bien resuelto). Pero el
cuerpo JSON depende del defecto de Express (100 kb) sin declararlo, y no hay
límite global de peticiones por IP más allá del login.

**Corrección:** fijar `bodyParser` explícitamente y añadir un rate limit global
suave para toda la API, no solo para `/auth`.

### M6 · Carga de datos innecesarios en rutas calientes

Ya señalado en A3 (`include: { user: true }`). Merece una pasada general:
preferir `select` explícito sobre `include` completo en los servicios, que
además reduce el riesgo de exponer campos nuevos por accidente al añadirlos al
modelo.

---

## ESTRUCTURAL (escalabilidad a largo plazo)

### E1 · Prácticamente no hay tests

> **NÚCLEO DE NEGOCIO Y CAPA DE DATOS DEL FRONTEND CUBIERTOS.** Backend: 221
> pruebas en 21 suites. Frontend: 295 pruebas en 17 suites — de 0 a
> infraestructura montada y `DataService` (el fichero más grande del
> proyecto, ~130 métodos públicos) cubierto casi por completo: 166 de 167
> métodos ejercitados. La Fase 2 puso las primeras 41 del backend (guards, *scoping*
> multi-tenant y regresiones de la Fase 1: `env.validation.spec.ts`,
> `roles.guard.spec.ts` —incluida la prioridad del `@Roles` de método sobre
> el de clase—, `estate-access.service.spec.ts`,
> `user-representations.service.spec.ts` y `token-cleanup.service.spec.ts`).
> Una fase posterior añadió lo que el propio informe señalaba como "de mayor
> retorno": integración contra Postgres real de `generateReceipts`
> (resolución de titular con prioridad membresía > propietario externo >
> etiqueta de unidad, idempotencia, numeración correlativa sin colisión con
> recibos manuales), `RemesasService.create()` con mandatos SEPA cifrados de
> verdad (secuencia FRST/RCUR, regla de vigencia de 36 meses, consumo de
> enmiendas pendientes, el IBAN nunca en claro en lo persistido), y
> `DebtorsService.debtCertificate` (el documento legal art. 9.1.e LPH,
> incluido el caso de trampa de un deudor con intereses pero sin recibos
> pendientes). De paso aparecieron y se corrigieron dos bugs reales que un
> mock no habría detectado: un IBAN de mandato sin espacios eliminar en el
> XML pain.008, y `STORAGE_DIR=""` no activando su valor por defecto.
> `cálculo de cuotas` resultó no necesitar tests propios: `quotaMonthly` es
> un valor fijo introducido por el administrador, sin prorrateo ni
> coeficientes, ya ejercitado indirectamente por los tests de recibos.
>
> **Frontend — arrancado esta fase.** El proyecto ya traía `tsconfig.spec.json`
> apuntando a `vitest/globals` (de `ng new`), pero sin `vitest` instalado ni
> target `test` en `angular.json`: la infraestructura nunca se activó.
> Montada ahora (`@angular/build:unit-test`, runner Vitest, jsdom por
> defecto — sin navegador real). Primeros tests, elegidos por lo que este
> mismo informe señalaba como punto de partida (`AuthService`, guards de
> rutas):
> - `auth.service.spec.ts` — login/restoreSession/logout, normalización del
>   estado de suscripción, y la deduplicación de `refresh()` concurrente
>   (el refresh token es de un solo uso: dos llamadas simultáneas deben
>   compartir la misma petición en curso, no consumirlo dos veces).
> - `role.guard.spec.ts` / `tenant.guard.spec.ts` — guards funcionales de
>   ruta: exigencia de sesión y aislamiento cross-tenant por URL manipulada.
> - `tenant-context.service.spec.ts` — la defensa de tenant en la capa de
>   presentación; en particular, que un usuario sin fincas vinculadas
>   (`estateIds` vacío) no acceda a ninguna, nunca a "todas" por defecto —
>   la misma clase de error que C3 detectó en el backend.
>
> **`DataService` — cubierto en una fase posterior**, vía
> `HttpTestingController` (afirma URL/verbo/cuerpo exacto de cada petición
> y controla la respuesta cruda tal cual la manda la API — enums sin
> acentos, `Decimal` como string —, que es lo que hace falta para probar
> los mapeos de verdad). 13 ficheros agrupados por dominio, mismos bloques
> que ya separa el propio servicio. Encontró y corrigió un bug real:
> `mapReceipt()` nunca casteaba `amount` a número —a diferencia de todos
> los demás mappers del fichero—, así que `recibos-tab.component.ts` sumaba
> los totales del dashboard (facturado/cobrado/pendiente/devuelto) con
> `reduce((s, r) => s + r.amount, 0)`: con un string, `+` concatena en vez
> de sumar. Un test que afirmaba el *tipo* del resultado, no solo su valor,
> lo detectó. Aprendizaje de infraestructura: sin `zone.js` (app zoneless)
> no hay `fakeAsync`/`tick()` — los métodos que encadenan varias peticiones
> (p. ej. `listAccountingEstates`, que primero lista fincas y luego pide N
> resúmenes vía `Promise.all`) necesitan un tick real
> (`await new Promise(resolve => setTimeout(resolve))`) entre el `flush()`
> de la primera petición y la comprobación de las siguientes.
>
> **Sigue pendiente**: tests de componentes/integración con `TestBed` +
> render real — todo lo cubierto hasta ahora es lógica pura y peticiones
> HTTP, nada renderiza DOM todavía.
>
> **Sigue pendiente**: `DataService` (el mayor fichero, no cubierto salvo
> indirectamente) y tests de componentes/integración con `TestBed` +
> render real.

**Evidencia:** 0 ficheros `.spec.ts` en `src/` (frontend) al momento de la
auditoría original, 1 en `backend/src`, 2 ficheros en `backend/test`.

Este es, con diferencia, **el mayor riesgo a largo plazo** del proyecto — por
encima de cualquier hallazgo individual de seguridad, porque es el que impide
corregir los demás con confianza.

Estamos hablando de una aplicación que calcula cuotas, emite recibos con
numeración correlativa legalmente exigible (RD 1619/2012), genera remesas SEPA,
cifra IBANs, gestiona morosidad y emite certificados de deuda con validez legal
(art. 9.1.e LPH). Todo eso se está modificando hoy **sin ninguna red de
seguridad automatizada**. Cada refactor es una apuesta.

**Corrección, por orden de retorno:**
1. Tests de integración (e2e) del backend sobre lo irreversible y lo legal:
   emisión de recibos, generación de remesas, certificado de deuda, cálculo de
   cuotas.
2. Tests de los guards y del *scoping* multi-tenant — precisamente el tipo de
   test que habría detectado C3 automáticamente.
3. Tests unitarios de los servicios con lógica de negocio densa
   (`createAgreement` y su reparto de cuotas es el caso de manual).
4. Frontend: empezar por `AuthService`, `DataService` y los guards de rutas.

### E2 · Sin integración continua

> **CORREGIDO.** `.github/workflows/ci.yml` con tres jobs: backend
> (`prisma generate` + typecheck + tests + lint), frontend (typecheck con
> `tsconfig.app.json` —el de la raíz da siempre 0 errores— + build de
> producción) y auditoría de dependencias (`npm audit --audit-level=high` en
> ambos), en job aparte para no confundir un aviso de seguridad con un fallo
> de compilación. Ya se ganó el sueldo antes de ejecutarse: al probar sus
> pasos en local afloraron 127 errores de lint que nadie estaba viendo.

No existe `.github/workflows`. Los `tsc --noEmit` y los tests (cuando los haya)
dependen de que alguien se acuerde de ejecutarlos. Una vez exista E1, un CI que
corra typecheck + tests + `npm audit` en cada push es lo que convierte el
esfuerzo en garantía permanente.

### E3 · Componentes-dios en el frontend

> **EN CURSO.** La pestaña de documentos sale a
> `estate-detail/documentos-tab/`, con su propio estado, carga y modal,
> recibiendo por `@Input` solo lo que necesita. `estate-detail` baja de 2.289
> a 2.118 líneas entre `.ts` y `.html`. Quedan por extraer con el mismo
> patrón: instalaciones, facturación SEPA, incidencias, propiedades y
> solicitudes — la de incidencias es la que más aportaría, porque es también
> la que más estado concentra.

`estate-detail.component.ts` (1.172 líneas) + su plantilla (1.063), y
`property-detail.component.html` (822). Concentran 6-7 pestañas, más de 60
señales y todos sus modales en un único fichero.

El trabajo de esta misma sesión ya demuestra la dirección correcta: la pestaña
de Personal se construyó como componente aparte (`personal-tab/`) y
`ProveedoresTabComponent` se desacopló a `@Input() estateId`, lo que permitió
reutilizarlo fuera de Contabilidad sin tocar su lógica. **Ese es el patrón a
extender**: extraer cada pestaña a su propio componente con su `@Input`
mínimo. Reduce el tamaño del bundle inicial y hace el código testeable de E1.

### E4 · Código muerto y peso innecesario

> **CORREGIDO, y el hallazgo real resultó ser otro.** `mock-data.ts`
> eliminado (solo quedaban menciones en comentarios históricos).
>
> Al medir `icon.component.ts` apareció lo importante: de sus 103 KB, **84 KB
> (el 81%) eran un único "icono"** — el logo `domora`, un SVG trazado desde
> un bitmap con 158 `<path>` de coordenadas decimales y colores propios. No
> es un icono: es un activo de marca disfrazado de icono. Y como `app-icon`
> se usa en 31 plantillas, esos 84 KB viajaban en el JavaScript de toda la
> aplicación para usarse en exactamente dos sitios (login y cabecera del
> menú).
>
> Extraído a `public/domora-logo.svg` y referenciado con `<img>`. El
> componente pasa de 103 KB a 17 KB, y el logo ahora es un activo estático
> que el navegador cachea aparte y solo descarga donde hace falta. Verificado
> sobre el build de producción: ningún `.js` contiene ya el trazado.
>
> Los 43 iconos restantes se dejan como están: son SVG de línea que heredan
> `currentColor`, pesan poco y trocearlos añadiría complejidad sin ganancia
> apreciable.

---

## Plan de acción propuesto

**Fase 1 — Parar el sangrado (días, no semanas). ✅ COMPLETADA.** C1, C2, C3,
A1. Cambios pequeños y localizados: validación de entorno que aborta el
arranque, cierre del IDOR de apoderamientos y `trust proxy`.

> **Acción requerida en el despliegue** antes del próximo release a
> producción: definir `SEPA_ENC_KEY` (`openssl rand -hex 32`) y un
> `JWT_SECRET` de al menos 32 caracteres en Container Apps, y confirmar que
> `TRUST_PROXY_HOPS` coincide con el número real de proxies delante de la
> API. Si no, **el contenedor no arrancará** — que es exactamente el
> comportamiento buscado: es preferible un despliegue que falla a uno que
> queda abierto en silencio. Ojo: si `SEPA_ENC_KEY` no era la que se estaba
> usando hasta ahora, los IBAN ya cifrados con la clave derivada dejarán de
> descifrarse; hay que re-cifrarlos antes de rotar.

**Fase 2 — Límites y red de seguridad. ✅ COMPLETADA.** A3, A4, A6 (índice +
`@unique`, purga programada, `helmet`/CSP), más A7 (dependencias) y el
arranque de E1 con 41 pruebas sobre guards, *scoping* y regresiones de la
Fase 1.

> **Nota de despliegue:** la migración `20260807194500_index_refresh_token_hash`
> crea un índice ÚNICO sobre `refresh_tokens.token_hash`. Si en producción
> hubiera hashes duplicados la migración fallaría; en desarrollo se verificó
> que no los hay (son aleatorios de 32 bytes, así que un duplicado indicaría
> un problema mayor). Conviene comprobarlo antes de aplicarla:
> `SELECT token_hash, COUNT(*) FROM refresh_tokens GROUP BY token_hash HAVING COUNT(*) > 1;`

**Fase 3 — Escala. ✅ COMPLETADA** (A2 parcialmente, ver su apartado). M1
(N+1 resuelto), M4 (instrumentado para perfilar; no se añaden índices sin
evidencia), E2 (CI) y el patrón de paginación aplicado al peor caso.

**Fase 4 — Mantenibilidad y endurecimiento. ✅ COMPLETADA salvo A5.** M2, M3
y E4 corregidos; E3 iniciado con la primera pestaña extraída. **A5 queda
aplazado a propósito**: es el único punto que exige comprobación en
navegador (ver su apartado), y su riesgo actual es bajo.

**Fase 5 — Red de seguridad de negocio y límites restantes. ✅ COMPLETADA
salvo lo estructural.** E1 pasa de 41 a 221 pruebas cubriendo recibos,
remesas SEPA y certificado de deuda (con dos bugs reales encontrados y
corregidos en el camino); A2 paginado en documentos y comunicados; M5
(límite de cuerpo de petición + rate limit global) corregido.

**Fase 6 — Tests de frontend.** De 0 a infraestructura Vitest montada y
295 pruebas en verde (17 suites): `AuthService`, los guards de ruta,
`TenantContextService` y `DataService` casi completo (166/167 métodos,
vía `HttpTestingController`) — con un bug real encontrado y corregido de
paso (`mapReceipt()` no casteaba `amount` a número, rompiendo los totales
del dashboard de recibos). Sigue pendiente el render real de componentes.

### Qué queda, por si retomas esto más adelante

1. **Tests de componentes/integración con `TestBed` + render real** — todo
   lo cubierto hasta ahora es lógica pura y peticiones HTTP, nada monta un
   componente ni pinta DOM todavía.
2. **A5**, cuando haya alguien que pueda validarlo en navegador.
3. **Resto de E3** (pestañas restantes de `estate-detail` y
   `property-detail`: instalaciones, facturación SEPA, incidencias,
   propiedades y solicitudes).
4. **M4 con datos reales**: revisar los avisos de consulta lenta que ahora
   emite `PrismaService` y decidir índices con evidencia.
5. Si algún día se construye una pantalla de auditoría para el rol A,
   paginarla desde el primer commit (hoy no existe ningún endpoint que
   liste `data_access_log`, así que no hay nada pendiente todavía).

---

## Lo que está bien resuelto

Conviene decirlo, porque marca el estándar al que hay que llevar el resto:

- **Multi-tenancy**: `EstateAccessService` con `estateIds` del JWT como única
  fuente de verdad, y la nota explícita de no fiarse del `estateId` enviado por
  el cliente. 70 llamadas a `assertAccess` repartidas por los servicios.
- **Contraseñas y tokens**: bcrypt, tokens opacos con hash SHA-256 en base de
  datos, rotación de un solo uso del refresh token, revocación de todas las
  sesiones al restablecer contraseña, y respuesta genérica en
  `forgot-password` para no filtrar qué emails existen.
- **`passwordHash` nunca sale**: `omit: { passwordHash: true }` aplicado de forma
  consistente en todos los `include` de usuario.
- **Subida de ficheros**: allow-list de MIME, límite de tamaño, nombre saneado,
  clave generada por servidor (UUID) y comprobación de *path traversal* como
  defensa en profundidad.
- **Frontend**: cero sinks de XSS, rutas con carga diferida, access token solo en
  memoria, y protección de la reentrada concurrente en `refresh()`.
- **Validación**: `ValidationPipe` global con `whitelist` + `forbidNonWhitelisted`,
  que neutraliza de raíz el *mass assignment* de los `{ ...dto }` que aparecen
  en varios servicios.
