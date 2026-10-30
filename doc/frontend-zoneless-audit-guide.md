# Guía: auditar reactividad zoneless y restos de mock-data en el frontend

> Contexto: al depurar por qué una propiedad recién creada no sobrevivía a un
> refresh de página (fix en `dashboard-c.component.ts`, ver commit
> `f75cf72`), aparecieron dos problemas estructurales que probablemente se
> repiten en otras pantallas. Este documento describe cómo detectarlos y
> corregirlos, para no tener que re-descubrirlos pantalla por pantalla.

## 1. El bug: campos planos mutados tras un `await`, en una app zoneless

### 1.1 Por qué pasa

Este frontend **no usa zone.js** (no está en `package.json`, no hay
`zone.js` en los polyfills) — la detección de cambios es 100% zoneless,
basada en signals. Confirmarlo en cualquier momento con:

```bash
grep -n "zone.js" package.json angular.json   # sin resultados = zoneless
```

En una app *con* zone.js, cualquier callback async (una promesa resuelta de
`HttpClient`, un `setTimeout`, un evento DOM) re-entra en la zona parcheada
y dispara una pasada de detección de cambios automáticamente — no importa
si mutás un signal o un campo plano (`this.foo = x`), el framework se entera
igual.

En zoneless, **nada** dispara esa pasada salvo que el propio framework sepa
que algo relevante cambió: una escritura a un `signal` que el template lee,
un evento DOM manejado dentro del árbol del componente, o una llamada
explícita a `ChangeDetectorRef.markForCheck()`. Si un método `async`
mutasu un campo de clase plano *después* de un `await` — típicamente en
`ngOnInit()` cargando datos de la API — **el dato llega bien, pero la
plantilla nunca se repinta** hasta que algún otro evento no relacionado
fuerce una pasada de CD.

### 1.2 Por qué es tan fácil no notarlo

El síntoma solo aparece en una **carga fría** del componente (primer mount,
o un refresh de página completo). Si estás desarrollando y navegás de un
lado a otro con el router, o hacés clic en algo que sí dispara un evento
manejado por Angular (lo cual reevalúa CD para toda la app en la mayoría de
los casos), el dato "aparece igual" — parece que funciona. El caso real
que se rompió (`dashboard-c`) pasó exactamente esto: crear una propiedad
DENTRO de la sesión viva se veía bien (el clic en "Cerrar" del modal
disparaba una pasada de CD que de rebote pintaba el dato ya cargado);
recién con un `page.reload()` real quedó en blanco incluso la propiedad
sembrada originalmente, que llevaba ahí desde el principio.

**Conclusión práctica: no confíes en "lo probé y aparece" si solo probaste
navegando dentro de la SPA. Hay que probar con un refresh real (F5) del
navegador.**

### 1.3 El patrón roto (antes)

```ts
export class XComponent implements OnInit {
  items: Item[] = [];               // campo plano

  async ngOnInit(): Promise<void> {
    this.items = await this.data.listItems();   // mutación tras await
  }
}
```

```html
@for (item of items; track item.id) { ... }   <!-- lee el campo plano -->
```

### 1.4 El fix (después)

```ts
export class XComponent {
  items = signal<Item[]>([]);

  constructor() {
    effect(() => { void this.load(); });   // o seguí usando ngOnInit si no
                                            // necesitás recargar por señal
  }

  private async load(): Promise<void> {
    this.items.set(await this.data.listItems());   // escritura a signal
  }
}
```

```html
@for (item of items(); track item.id) { ... }   <!-- lee el signal -->
```

Si el componente tiene `get`/computed que leen esos campos (p. ej.
`get total() { return this.items.reduce(...) }`), acordate de cambiar
`this.items` por `this.items()` ahí también.

### 1.5 Cómo encontrar candidatos

No hay un lint rule para esto (sería ideal, pero no está configurado). El
grep más útil es buscar componentes que implementan `OnInit` (o tienen un
método async invocado desde el constructor/lifecycle) y mutan un campo que
NO es un signal:

```bash
# Componentes con OnInit — candidatos a revisar uno por uno
grep -rl "implements OnInit" src/app/features src/app/layout

# Dentro de cada uno, buscar mutaciones "this.algo = " que no sean
# ".set(" ni ".update(" — esas son las sospechosas
grep -n "this\.[a-zA-Z]* = " src/app/features/<componente>/*.component.ts
```

Heurística rápida: si el campo se declara como `campo: Tipo[] = []` (o
`Tipo | null = null`) en vez de `campo = signal<Tipo[]>([])`, y se reasigna
dentro de un método `async`, es sospechoso.

### 1.6 Verificación — no te fíes del build

`tsc`/`ng build` no detectan este bug (es correcto en tipos, solo está mal
en reactividad). La única forma confiable de confirmarlo es:

1. Levantar `ng serve` + backend real (ver `backend/docker-compose.yml`
   para Postgres local).
2. Loguearse, navegar a la pantalla.
3. **Hacer un refresh real del navegador** (no solo re-navegar con el
   router) y confirmar que los datos siguen apareciendo.

Con Playwright (headless, útil para automatizar esto):

```js
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('text=algo que debería seguir ahí');
```

Ver `f75cf72` para el caso resuelto completo (dashboard-c.component.ts).

### 1.7 Arreglados (28 jul 2026)

Los dos casos que quedaban confirmados-pero-sin-arreglar de la ronda
anterior ya están corregidos (commit `609dbfb`):

- `src/app/features/property-detail/property-detail.component.ts` —
  `receipts`, `communications`, `documents` ahora son signals.
- `src/app/features/suscripcion/suscripcion.component.ts` — `usedFincas`
  y `usedProps` ahora son signals.

De paso apareció un tercer caso al correr `ng build --configuration
production`: el compilador tira el diagnóstico **NG8109** cuando un
template lee un signal sin invocarlo (`{{ foo.length }}` en vez de
`{{ foo().length }}`) — es gratis, no hace falta gastar tiempo grepeando
a mano. `estate-detail.component.html` tenía uno (`properties.length`),
arreglado en el mismo commit. Agregalo al checklist: **correr el build de
producción y revisar los warnings antes de dar por cerrada cualquier
migración a signals** — no es solo para tipos, también avisa de esto.

Revisados y **limpios** (ya usan signals o no cargan datos async de esta
forma): `ajustes-c`, `alertas-c`, `solicitudes-c`, `dashboard-b`,
`morosidad-tab`, `proveedores-tab`, y el resto de Contabilidad (fix de
hoy, sección 2).

---

## 2. Restos de `mock-data.ts` sin migrar al backend real

Problema relacionado pero distinto: varios componentes todavía importan
datos directamente de `src/app/core/mock-data.ts` en vez de llamar a
`DataService` (que sí pega contra la API real). Esto ya causó dos bugs
reales arreglados hoy:

- `tenant.guard.ts` comparaba ids reales (UUID de Postgres) contra
  `MOCK_ESTATES`/`MOCK_ACCOUNTING_ESTATES` — nunca matcheaba, rebotaba
  navegación legítima (commit `ad1aa75`).
- `add-property.component.ts` escribía altas directo a
  `MOCK_OWNER_PROPERTIES` (un array en memoria) — nunca persistía nada
  (commit `f75cf72`).

Lista actualizada de archivos que **todavía** importan de `mock-data.ts`
(volvé a correr el grep antes de confiar en esta lista, cambia con cada
fix):

```bash
grep -rl "from '.*mock-data'" src/app --include=*.ts
```

A la fecha de este documento (actualizado tras arreglar Contabilidad
completa, commits `d16781a`/`a578985`):

- `src/app/core/sepa-pain008.service.ts` — ya no lo usa
  `nueva-remesa.component.ts` (el backend genera el pain.008 server-side
  ahora), pero SÍ lo sigue usando `recibos-tab.component.ts` en
  `downloadSepaFile()`, una descarga SEPA distinta (por recibo/periodo,
  no por remesa). Sin auditar todavía si ESE flujo tiene contrapartida
  real en el backend o genera el XML client-side con datos aproximados
  como hacía `nueva-remesa` antes del fix.
- `src/app/features/dashboard-a/dashboard-a.component.ts` — todavía sin
  auditar, pendiente.

**No asumas que todos son bugs** — algunos usos de `mock-data.ts` pueden
ser catálogos legítimamente estáticos (p. ej. listas de opciones fijas) sin
contrapartida en el backend. Para cada archivo de la lista, la pregunta a
responder es: *¿este dato debería venir de Postgres (y hoy no llega porque
nadie migró el componente), o es un catálogo que nunca tuvo sentido
persistir?* Solo el primer caso es un bug a arreglar.

## 3. Campos `Decimal` de Prisma que llegan como string por JSON

Encontrado al auditar Contabilidad (commit `a578985`): los campos
`Decimal` de Prisma (`balance`, `income`, `amount`, `reserveTarget`...) se
serializan por JSON como **string** (`"1234.56"`, no `1234.56`) — es cómo
`Decimal.js` preserva precisión al pasar por `JSON.stringify`. Nada en el
pipeline HTTP los convierte de vuelta a `number` automáticamente.

Si un método de `data.service.ts` hace un passthrough directo
(`return this.get<Foo[]>(...)` sin mapear campos, o tipado como `any[]`
"para simplificar") y luego un componente hace `list.reduce((s, x) => s + x.campoDecimal, 0)`,
el resultado es **concatenación de strings**, no suma — `"0" + "0"` da
`"00"`, no `0`. El síntoma final suele ser un `NaN` río abajo, en el
primer sitio que hace una operación aritmética real (una división, un
`.toFixed()`) sobre ese string acumulado — no en el `reduce` mismo, lo
que lo hace más difícil de rastrear a simple vista.

**Cómo detectarlo**: cualquier método de `data.service.ts` con firma
`Promise<any[]>` (en vez del tipo real del modelo) es sospechoso — el
tipado laxo es precisamente lo que deja pasar este bug sin que `tsc` se
queje. Grep rápido:

```bash
grep -n "): Promise<any\[\]>" src/app/core/data.service.ts
```

Para cada uno, comparar el `select`/return del service NestJS
correspondiente contra el mapeo (o falta de mapeo) en el wrapper del
frontend — especialmente campos `Decimal` en el schema de Prisma.

**El fix** es explícito: `Number(raw.campo)` en el wrapper de
`data.service.ts`, igual que ya se hace en `listMovements`/
`listBankExtract`/`listBudget` (esos si estaban bien escritos). De paso,
tipar el return real (`Promise<Foo[]>`, no `Promise<any[]>`) para que la
próxima vez que cambie el contrato del backend, `tsc` lo detecte en vez
de fallar en producción.

**Prima hermana**: los enums de Prisma sin acento (`ConDevoluciones`)
necesitan la misma tabla de traducción `_FROM_API` que ya existe para
`TicketStatus`/`PayMethod` — buscá el enum en `schema.prisma`, comparalo
contra el `type` de `models.ts`, y si difieren en acentos/espacios, agregá
la traducción en vez de pasar el valor crudo.

## 4. Checklist para auditar una pantalla

1. ¿Importa algo de `mock-data.ts`? → sección 2.
2. ¿Tiene `ngOnInit`/constructor con una llamada `async` que mute un campo
   de clase? → ¿ese campo es un `signal`? Si no, sección 1.
3. Probar con refresh real del navegador (F5), no solo navegación interna.
4. Si el componente tiene un guard de ruta asociado (`canActivate`), ¿ese
   guard compara ids/campos contra `mock-data.ts` en vez de contra el
   estado real de sesión (`AuthService`/JWT)? (Fue el caso de
   `tenant.guard.ts`.)
5. ¿El método de `data.service.ts` que alimenta la pantalla está tipado
   `Promise<any[]>` o mapea explícitamente cada campo `Decimal`/enum? →
   sección 3. Probar con datos reales que sumen a algo no-cero (no solo
   con el estado semilla vacío) y con una lista vacía (el caso "0
   resultados" también rompe cosas — ver `maxMonths()` en morosidad-tab).
6. Si la pantalla tiene un botón de acción (editar/eliminar/menú "⋮"),
   ¿tiene de verdad un `(click)`/`(clicked)` handler, o es un botón
   decorativo sin nada detrás? Pasó dos veces hoy (el "⋮" de la tabla de
   propiedades y el "Editar" del header de finca, sección 5) — un botón
   que compila y se ve bien en un mock visual no implica que haga algo.
7. Si el menú/dropdown se renderiza dentro de un contenedor con
   `overflow: hidden` (común para redondear esquinas de tablas/cards) y
   usa `position: absolute`, probar con **pocas filas** — se recorta en
   cuanto el contenedor es más bajo que posición-del-botón + alto-del-menú.
   Fix: `position: fixed` con coordenadas de `getBoundingClientRect()`
   calculadas al abrir (ver `togglePropertyMenu()` en
   `estate-detail.component.ts`, commit `31c06dc`).

## 5. Estado actual y próximos pasos

### 5.1 Hecho (sesión del 27-28 jul 2026)

| Área | Qué se hizo | Commits |
|---|---|---|
| Propiedades | CRUD completo (backend + frontend), reactividad de `dashboard-c` | `1d97262`, `f75cf72` |
| Fincas — KPIs | `NaN` por campos inexistentes/no calculados | `c2f7bad` |
| Contabilidad | Las 9 pantallas conectadas a la API real, reactividad, Decimal/enum | `d16781a`, `a578985` |
| Menú de propiedad | "⋮" sin handler → editar/eliminar reales, fix de recorte del menú | `1caf38d`, `31c06dc` |
| Editar finca | Botón sin handler, backend sin endpoint → `PATCH /estates/:id` completo | `84798ee` |
| Reactividad restante | `property-detail`, `suscripcion`, `estate-detail` (NG8109) → signals | `609dbfb` |
| Presupuesto | "Editar presupuesto" wireado a `upsertBudgetItem` (ya existía), modal nuevo | `cbaab7c`/`5feddf5` |
| Remesas — detalle | `GET /remesas/:id/lines` nuevo + wiring de `remesas-tab` | `cbaab7c`/`5feddf5` |
| Remesas — exclusión | `CreateRemesaDto.excludeReceiptIds` + `RemesasService.create` filtra | `cbaab7c`/`5feddf5` |
| Movimientos — editar/eliminar | `PATCH`/`DELETE /estates/:estateId/movements/:id`, solo el último de la cadena de saldo (409 si no) | `cbaab7c`/`5feddf5` |
| Alta de comunidad nueva | Modelo `EstateOnboardingRequest` + `POST/GET /estate-onboarding-requests`, wireado en `add-property` | `cbaab7c`/`5feddf5` |
| SEPA de recibos | `recibos-tab.downloadSepaFile()` creaba una remesa NUEVA en cada click (sin idempotencia, sin validar creditorId) — ahora descarga el XML de la remesa YA presentada del periodo, o manda a "Nueva remesa" si no existe ninguna. `sepa-pain008.service.ts` (client-side, dead code) eliminado. | `1206676` |
| Dashboard-a (rol A) | Las 9 acciones del panel de gestoras (alta, descuento, ampliar usuarios, cambiar plan, extender, facturación, bloquear, notas) wireadas al backend real (`AdminsController`, ya existía casi completo). "Enviar mensaje" queda honestamente sin backend. | `1206676` |
| Solicitudes de alta — UI | Nueva pestaña de página en `dashboard-a` ("Solicitudes de alta") que lista y resuelve (`contacted`/`dismissed`) las `EstateOnboardingRequest` — antes el endpoint existía pero nada lo consumía. Nuevo `PATCH /estate-onboarding-requests/:id`. | — |
| Catálogo de planes | `dashboard-a` ya no tiene `PLAN_PRICE`/`PLAN_TIERS` hardcodeados — consume `GET /plans` real (`getPlansCatalog()`). `suscripcion.component.ts` queda pendiente (tiene campos que el backend no expone todavía: anual, fincasMax, propsMax, storageGB). | — |
| Facturación SEPA (acreedor) | Nueva pestaña en `estate-detail` para configurar `creditorId`/`creditorIban`/`creditorBic`/`creditorPostalAddress` de la finca. `GET`/`PATCH /estates/:id/sepa-billing` nuevos (`EstatesModule` ahora importa `SepaModule` para `CryptoService`). El IBAN viaja **siempre enmascarado** — "editar" reemplaza, nunca revela el guardado. | — |
| Fixtures SEPA en el seed | `backend/prisma/seed.ts` ahora crea 2 `chart_accounts`, un `AccountingPeriod` del mes actual, un `Mandate` activo y un `AccountingReceipt` pendiente domiciliado — sin esto, "Nueva remesa" nunca tenía ningún candidato real que procesar. | — |

**Dos bugs graves encontrados persiguiendo la verificación end-to-end de remesas (no se habrían visto solo leyendo código):**

1. **`data.service.ts`'s `listAccountingPeriods()` nunca mapeaba el campo real.** El backend devuelve `AccountingPeriod` crudo (`periodKey`, no `key`), pero el wrapper del frontend hacía un passthrough sin transformar nada pese a estar tipado como `Promise<{key, label, monthAbbrev}[]>` — el tipo mentía. Cada `period.key` era `undefined` en **todos** los consumidores (`nueva-remesa.component.ts`, `recibos-tab.component.ts`). Consecuencia real: **nunca, en ningún momento de este proyecto, se pudo generar una remesa SEPA real desde la UI** para una finca con un solo periodo — el wizard mostraba "Julio 2026" correctamente en pantalla, pero el `POST /remesas` fallaba silenciosamente con "periodKey inválido" porque el campo llegaba vacío. Detectado recién al forzar la generación real de punta a punta con Playwright, no por lectura de código ni por build. Fix: mapear `key: r.periodKey` explícitamente.
2. **`nueva-remesa.component.ts` usaba un objeto plano `cfg` con `[(ngModel)]`** para un `<select>` cuyas `<option>` se pueblan de forma asíncrona — patrón fragil ante el timing de Angular (aunque en este caso el síntoma real era el bug #1, el objeto plano seguía siendo el patrón de riesgo ya documentado en §1). Se migró a signals individuales (`cfgPeriod`, `cfgChargeDate`, `cfgScheme`, `cfgConcept`) con `[ngModel]`/`(ngModelChange)` explícito, consistente con el resto de la app. `RemesaConfig` (interfaz ya sin uso) se eliminó de `models.ts`.

**Bugs de backend encontrados y arreglados al auditar `dashboard-a` (mismo patrón de §3, aplicado a un módulo nuevo):**
- `AdminsService.findById()` no incluía `authorUser` en el `include` de `activity` — el historial de actividad SOLO tenía `authorUserId` (uuid), nunca el nombre. El frontend esperaba `author: string` y lo dejaba `undefined` en el template.
- Mismo método: el campo Prisma es `occurredAt`, pero el frontend leía `x.date` (inexistente) — cada entrada de actividad mostraba una fecha vacía. Se corrigió mapeando `date: a.occurredAt` explícitamente en el backend en vez de fiarse del spread `...a`.
- `Administrator.mrr` y `.discountPct` son `Decimal` de Prisma (llegan como string) y `mapAdministrator()` no los coercionaba — `totalMrr`/`filteredMrr` (`reduce((s,a) => s + a.mrr, 0)`) concatenaban strings en vez de sumar. `AdminInvoice.amount` tenía el mismo problema, y encima `fmtEur()` llama a `.toLocaleString()` — un método que NO existe en `String.prototype`, así que hubiera sido un **crash en runtime**, no solo un NaN silencioso, en cuanto se abriera la pestaña de Facturación con al menos una factura.
- `Administrator.billing` está tipado como no-nulo pero es una relación 1:1 **opcional** en Prisma (`admin_billing`) — la gestora del seed no tiene ninguna fila ahí. `openBillingModal()` hacía `admin.billing.businessName` sin guardas → crash silencioso al abrir el modal (el drawer ya estaba renderizado, así que no rompía toda la app, pero el modal nunca se abría y no había ningún error visible en pantalla). Se tipó `billing: AdminBilling | null` y se agregaron guardas tanto en `openBillingModal()` como en el template (bloque `@if (billing; as b)`).

**Dead button arreglado**: el "⋮" de la fila de administradores en la tabla solo hacía `$event.stopPropagation()` — no abría nada, ni siquiera el drawer que sí abre un click en cualquier otra parte de la fila. Ahora llama a `selectAdmin()` explícitamente.

**Verificación empírica (Playwright) — TODO lo documentado como pendiente en rondas anteriores quedó confirmado esta vez:**
- ✅ Presupuesto: añadir partida + guardar → `POST /budget` 201, recarga, importe visible.
- ✅ Movimientos: crear → editar → eliminar, todo contra el último de la cadena, sin errores de consola.
- ✅ Alta de comunidad nueva: `POST /properties` 201 + `POST /estate-onboarding-requests` 201, persistido en DB, mensaje de éxito correcto. Cola de revisión (`dashboard-a`) probada de punta a punta: alta como rol C → aparece en la cola → "Marcar contactada" → `PATCH` 200 → estado actualizado.
- ✅ Dashboard-a: MRR sin `NaN` (confirma el fix de Decimal), descuento aplicado con actividad mostrando fecha y autor reales, facturación (`PUT`, con guarda para billing nulo), bloqueo/desbloqueo, catálogo de planes real (`GET /plans`, precios 49/99/199 confirmados en pantalla) — todo verificado con requests reales contra la API.
- ✅ Facturación SEPA: configurar CID/IBAN en `estate-detail` → guarda cifrado → se muestra enmascarado ("ES91 ···· 1332") → `nueva-remesa` lo detecta correctamente.
- ✅ **Remesa SEPA real de punta a punta** (el hito de esta ronda): generar una remesa con un recibo real → `POST /remesas` 201, `linesCount: 1`, `hasXml: true` → aparece en el historial de `remesas-tab` → el detalle de líneas (`GET /remesas/:id/lines`) muestra el propietario e IBAN enmascarado correctamente → `recibos-tab` "Descargar SEPA" encuentra la remesa recién presentada. Los dos bugs de arriba son los que lo bloqueaban; con el seed + los fixes, todo el camino feliz de SEPA funciona.

### 5.2 Próximos pasos — por prioridad

**Resuelto en esta ronda:**
1. ~~`suscripcion.component.ts` con catálogo de planes hardcodeado~~ —
   resuelto parcialmente: el **precio** (dato de facturación real, antes
   29/49/79€ sin relación con el catálogo real de 49/129/249€) ahora sale
   de `GET /plans`. `fincasMax`/`propsMax`/`storageGB`/`features` siguen
   siendo copy local — igual que `PLAN_FEATURES` en `dashboard-a`, no
   tienen contrapartida ni enforcement en el backend, así que no eran el
   problema real (el precio sí lo era, por ser lo que se factura de
   verdad). El "plan actual" y las facturas ahora salen de
   `GET /subscriptions/me` y `GET /admins/:id/invoices` — antes eran
   100% mock (`currentPlanId` fijo en `'PREMIUM'`, facturas inventadas).
   `confirmPlanChange()` dejó de fingir "procesado correctamente": no
   existe autoservicio de cambio de plan (`PATCH /admins/:id` es solo
   rol A), ahora dice honestamente que se enviará una solicitud.
2. ~~`/a/settings` sin construir~~ — resuelto: nuevo
   `AjustesAComponent` propio (antes aliaseaba a `DashboardAComponent`,
   así que clickear "Ajustes" mostraba la tabla de "Administradores").
   Muestra la cuenta del super-admin logueado y dice honestamente que
   la configuración de plataforma (catálogo de planes, políticas
   globales) no tiene UI todavía — se gestiona en
   `backend/src/admins/plans.catalog.ts` directamente.

**Pendiente (fuera de alcance, requiere decisión de producto):**
3. Anual real, `fincasMax`/`propsMax`/`storageGB` como límites
   *aplicados* (no solo copy), y edición del catálogo de planes desde
   una UI — todo esto necesitaría extender el modelo de datos del
   backend (`Administrator`/`plans.catalog.ts` no tienen estos campos
   hoy). El `-20%` anual en `suscripcion.component.ts` es un cálculo
   local sobre el MRR real, no un ciclo de facturación anual de verdad.
4. `changePlanTiming` ('inmediato' / 'próximo ciclo') en `dashboard-a`
   es solo cosmético — el backend siempre aplica el cambio de plan de
   inmediato (no hay soporte para diferirlo a fin de ciclo, requeriría
   un job programado). El toggle sigue en la UI pero con un comentario
   explícito de la limitación.

**Higiene de datos de demo (ya resuelto, dejar como referencia):**
5. ~~`chart_accounts` vacío~~ — resuelto: el seed ahora crea `622`/`700`.
6. ~~`admin_billing` vacío~~ — resuelto en el código (guardas contra
   null), pero la gestora del seed sigue sin fila propia; no bloquea
   nada, solo significa que la pestaña de Facturación arranca vacía la
   primera vez.
7. ~~Sin `creditorId`/`creditorIban`/mandato/recibo de prueba~~ —
   resuelto: el seed crea mandato + recibo pendiente; el CID/IBAN de la
   finca hay que configurarlo una vez a mano desde "Facturación SEPA"
   (dato sensible, cifrado — no vive en el seed a propósito). Un CID
   español válido de prueba: `ES00ZZZB12345678` (ISO 7064 mod 97-10,
   ver `backend/src/sepa/sepa-pain008.service.ts`).

### 5.3 Sesión del 30-31 jul 2026

**Hecho:**
- Sidebar rol B: eliminados "Propiedades" y "Clientes" — ambas rutas
  (`/b/properties`, `/b/clients`) aliaseaban al mismo
  `DashboardBComponent` que "Fincas", sin contenido propio. Rutas
  muertas eliminadas también (`app.routes.ts`).
- Login/sesión: no había forma de cerrar sesión desde la UI pese a que
  `AuthService.logout()` ya estaba bien implementado — se agregó el
  botón en el sidebar. De paso se encontró que `POST /auth/logout` no
  era `@Public()`, así que el frontend (que borra su access token
  ANTES de llamar al endpoint) siempre recibía 401 y el refresh token
  **nunca se revocaba en el servidor** pese a que la UI mostraba
  "sesión cerrada" — el `catch{}` del frontend lo ocultaba. Corregido
  marcando el endpoint público (mismo modelo de confianza que
  `/auth/refresh`: el refresh token del body ES la credencial).
  También se corrigió que el sidebar mostraba nombres hardcodeados por
  rol ("Admin Fincas", "Ana Pujol", "Super Admin") en vez del usuario
  real logueado. Política de expiración (30 días, se renueva en cada
  uso, sin tope absoluto) queda igual — decisión explícita del usuario.
- `estate-detail`: el botón "+ Nueva propiedad" del header no tenía
  ningún handler (mismo patrón de botón muerto, checklist punto 6).
  El `POST /properties` existente es el alta de autoservicio de rol C
  (crea la propiedad desvinculada + `AdhesionRequest` a aprobar
  después) — no sirve para que una gestora dé de alta una unidad
  directamente en su propia finca. Se agregó
  `POST /estates/:estateId/properties`, que fija `estateId`/
  `administratorId` de inmediato, sin titular todavía (`status: 'Vacío'`).

**Hallazgo nuevo, sin arreglar (anotar para más adelante):**
- `AdhesionRequestsService.approve()` marca la `PropertyMembership`
  como `linked` pero **nunca escribe `property.estateId`/
  `.administratorId`** — el registro de `Property` en sí queda
  `estateId: null` para siempre, incluso después de "aprobar" la
  adhesión. Como `PropertiesService.listByEstate()` filtra por
  `property.estateId` directo, esto significa que una propiedad dada
  de alta por un rol C y aprobada por su gestora **nunca aparece** en
  la pestaña "Propiedades" de `estate-detail` (solo en la vista del
  propio propietario, vía `PropertyMembership`). No se tocó esta
  ronda — es un bug estructural preexistente, no relacionado al
  pedido original, y su fix (decidir si `Property.estateId` debe
  reflejar la adhesión aprobada, y migrar los datos ya afectados) es
  su propio alcance.

### 5.4 Sesión del 31 jul 2026 — wizard de alta unificado

**Hecho:**
- El fix de "+ Nueva propiedad" de la sesión anterior había dejado dos
  implementaciones divergentes de la misma operación: `AddPropertyComponent`
  (rol C, wizard de 3 pasos) vs. un formulario plano ad-hoc metido en
  `estate-detail` (rol B/A) que le pedía al admin reescribir a mano la
  dirección completa de una finca que ya la tiene guardada.
- Unificado en un solo `AddPropertyComponent`, parametrizado por
  `StateService.addPropertyEstateContext` (signal opcional con
  `{ id, name, address, location }`, seteado por `estate-detail` antes
  de abrir el modal global montado en `app.html`). El wizard queda
  igual en su esqueleto (3 pasos + éxito) para los dos roles, pero:
  - Paso 2 (Ubicación): en modo finca viene **precargado** con
    `address`/`location` de la finca pero sigue siendo editable
    (decisión explícita del usuario — cubre el caso de un anexo o
    edificio secundario dentro de la misma finca).
  - Paso 3: rol C ve "Rol y comunidad" (sin cambios); modo finca ve
    "Datos de administración" con la cuota mensual — no hace falta
    vincular nada porque la propiedad ya nace dentro de la finca.
  - Bonus: el selector de "Tipo de vía" (Calle/Avenida/…) que solo
    existía en el formulario admin ahora está disponible para los dos
    roles — el flujo de rol C tenía `viaType: 'Calle'` hardcodeado sin
    que el usuario pudiera elegirlo.
- `estate-detail` perdió sus signals `np*`/`showNewProperty` y ahora
  solo setea el contexto y abre el modal global; un `effect()` sobre
  `state.propertiesVersion()` recarga la tabla de propiedades cuando
  el wizard crea una unidad (mismo mecanismo ya usado por otras
  pantallas de "mis fincas", solo que antes `estate-detail` no lo
  escuchaba).
- Verificado con Playwright en los dos roles: alta admin con dirección
  heredada+editable, `POST /estates/:id/properties` en `201`, tabla de
  propiedades pasa de 2→3 sin recargar la página y persiste tras
  reload; alta propietario sigue funcionando igual que antes
  (`POST /properties` en `201`, selector de tipo de vía nuevo
  disponible), cero errores de consola en ambos casos.

### 5.5 Sesión del 1 ago 2026 — Nº de finca opcional, heredable en el alta de propiedad

**Hecho:**
- `Estate` no tenía forma de guardar el número de calle por separado —
  `address` era un único string libre (`"Carrer de Provença, 248"`),
  así que el paso 2 del wizard unificado (§5.4) solo podía precargar
  el campo "Nombre de la vía" con el string completo, dejando
  "Número" siempre vacío.
- Agregada columna opcional `Estate.streetNumber` (migración
  `20260801172915_estate_street_number`, `String? @db.VarChar(20)`,
  nullable — no rompe fincas existentes). Recorrido el CRUD completo:
  - Backend: `CreateEstateDto`/`UpdateEstateDto` (opcional en los
    dos); `EstatesService.create()`/`.update()` no necesitaron
    cambios (ya spreadean el DTO). `search()` (alta de propiedad rol
    C, "vincular a comunidad existente") no lo necesita — solo
    identifica la finca, no alimenta ningún prefill.
    `EstateOnboardingRequestsService` no crea `Estate` reales todavía
    (soporte lo hace a mano, ver nota en `properties.service.ts`) —
    no aplica.
  - Frontend: `Estate` (`models.ts`), `DataService.createEstate()`
    (destructura campos explícitos — el nuevo hay que agregarlo a
    mano, no alcanza con extender el tipo). `updateEstate()` ya
    spreadea el patch, sin cambios.
  - "Nueva finca" (`dashboard-b`) y "Editar finca" (`estate-detail`):
    nuevo campo "Nº (opcional)" en los dos modales.
  - `StateService.addPropertyEstateContext` y
    `estate-detail.openNewProperty()`: el contexto que arma el wizard
    unificado ahora incluye `streetNumber`; `AddPropertyComponent`
    precarga el campo "Número" del paso 2 con ese valor (sigue
    editable, igual que la dirección — mismo criterio de §5.4).
  - `seed.ts`: la finca demo pasa a `address: 'Calle Falsa'` +
    `streetNumber: '123'` (antes el número estaba embebido en
    `address`) — el seed es idempotente (`findFirst` antes de
    `create`), así que una BD ya sembrada no se actualiza sola; hay
    que setear el Nº a mano desde "Editar" si se quiere probar sobre
    datos viejos.
- Verificado con Playwright: "Editar finca" con Nº guardado → el
  wizard de nueva propiedad trae "Número" precargado con ese valor;
  "Nueva finca" con Nº en el alta → `201 POST /estates`, campo
  presente y enviado. Cero errores de consola en ambos casos.

### 5.6 Sesión del 1 ago 2026 — búsqueda y orden en el panel de Contabilidad

**Hecho:**
- `AccountingDashboardComponent` (`/b/accounting`, tabla "Fincas") no
  tenía forma de localizar una finca puntual ni de reordenar los
  resultados — solo el orden que devolvía la API.
- Agregada barra de filtros sobre la tabla: búsqueda por nombre
  (`searchName`, contains case-insensitive), tipo de inmueble
  (`filterType`, mismo catálogo `EstateType` que "Nueva finca") y
  situación de morosidad (`filterDelinquency`: Al corriente /
  Con morosidad — reusa el criterio `delinquency > 0` que ya pintaba
  el badge de la fila). `filteredEstates` es un `computed()` que
  combina los tres; estado vacío explícito
  ("Ninguna finca coincide con los filtros.") en vez de una tabla en
  blanco.
- Encabezados de columna clicables (Finca/Saldo/Ingresos/Gastos/Fondo
  reserva/Morosidad) — `setSort(col)` alterna asc/desc si se repite
  la misma columna, o resetea a asc en una nueva. `sortedEstates`
  (`computed()` sobre `filteredEstates`) es lo que efectivamente
  pinta la tabla. La columna "Fondo reserva" (que se muestra como %)
  ordena por el mismo `reservePercent()` que ya se usaba para la
  barra de progreso, no por el saldo bruto de reserva.
- `AccountingEstate` no traía `type` — lo agrega
  `AccountingService.summary()` (backend, un campo más en el
  `return`) y `mapAccountingEstate()` (frontend, mismo mapeo
  `ESTATE_TYPE_FROM_API` que ya usa `mapEstate()`). Sin esto el
  filtro por tipo no tenía con qué comparar.
- Los paneles laterales ("Morosos", "Fondos de reserva") siguen
  usando `estates()` completo a propósito — el pedido era sobre "el
  listado de resultados" (la tabla principal), no sobre los widgets.
- Verificado con Playwright: filtro por nombre, por tipo y por
  morosidad (cada uno reduce la tabla al subconjunto esperado);
  estado vacío se muestra con un filtro sin coincidencias; orden por
  Saldo asc/desc invierte la lista visiblemente; orden por Finca
  vuelve al alfabético. Cero errores de consola.

### 5.8 Sesión del 1 ago 2026 — configuración contable por finca (cuentas, proveedores, periodos)

**Contexto:** pruebas manuales encontraron 4 flujos rotos en Contabilidad:
no se puede elegir el Periodo al crear un recibo; el selector de cuenta
contable en "Nuevo apunte" está vacío para Traspaso; no se pueden agregar
cuentas nuevas para Gasto/Ingreso. Causa raíz común: los catálogos de
configuración (cuentas contables, proveedores) nunca tuvieron endpoints de
escritura — solo 2 cuentas hardcodeadas en el seed (ninguna `transfer`) y
proveedores 100% mock de frontend que nunca persistía.

**Decisión de producto (verificada contra el schema antes de aplicarla,
ver hilo de la conversación):** cuentas contables y proveedores pasan de
ser *por gestora* a ser *por finca* — cada finca tiene su propia
configuración, sin compartirla con otras fincas de la misma
administradora. `AccountingPeriod` ya era por finca desde antes, no
necesitó migración.

**Hecho:**
- Migración `20260801180000_chart_accounts_suppliers_per_estate`:
  `ChartAccount.estateId` pasa a obligatorio (antes solo tenía
  `administratorId` nullable = catálogo global). Backfill: cada finca
  existente recibe copias PROPIAS de las cuentas globales (no una
  referencia compartida); movimientos/budget_items que apuntaban a la
  fila global vieja se re-apuntan a la copia de su propia finca antes
  de borrar las filas globales. `Supplier.estateId` (ya existía,
  nullable, sin usarse) pasa a obligatorio — tabla vacía en dev, sin
  backfill necesario.
  - Gotcha de migración: Postgres no permite referenciar la tabla del
    `UPDATE` dentro del `ON` de un `JOIN` en su `FROM` — hubo que
    reescribir el backfill de `movements`/`budget_items` con subqueries
    correlacionadas en vez de `UPDATE ... FROM x JOIN y ON ...target...`.
  - Gotcha de mapeo: `Supplier.estateId` en la DB real es la columna
    `"estateId"` (camelCase, sin `@map`, heredada de antes de que el
    campo fuera obligatorio) — al principio le puse `@map("estate_id")`
    por consistencia con el resto del schema, y rompió en runtime
    (`P2022`, columna inexistente) porque el `@map` no renombra la
    columna física por sí solo. Se sacó el `@map` en vez de migrar la
    columna, más simple y de riesgo cero.
  - `prisma migrate dev` se niega a generar el diff en modo no
    interactivo cuando detecta pérdida de datos potencial — la
    migración se escribió a mano y se aplicó con
    `prisma db execute --file` (o, cuando eso dio un `P1014` sin causa
    clara, ejecutando el SQL directo vía `PrismaClient.$transaction` +
    `$executeRawUnsafe`), y se sincronizó el historial con
    `prisma migrate resolve --applied`.
- `chart-accounts.constants.ts` (nuevo): catálogo por defecto
  (622 gasto, 700 ingreso, **113 traspaso** — antes no existía NINGUNA
  cuenta `transfer` en todo el proyecto, causa raíz directa del bug de
  Traspaso). `EstatesService.create()` copia este catálogo dentro de la
  misma transacción al crear una finca nueva — cada finca arranca con
  cuentas propias editables sin afectar a otras.
- Backend: `ChartAccountsController`/`SuppliersController` pasan de
  rutas planas (`/chart-accounts`, `/suppliers`) a anidadas
  (`estates/:estateId/chart-accounts`, `estates/:estateId/suppliers`,
  mismo patrón que `EstateMovementsController`), con `POST` nuevo en
  los dos. `MovementsService.resolveAccount()` pierde el fallback
  "cuenta propia de la gestora, si no cae a la global" (ya no aplica,
  todo es por finca) — código más simple que antes.
- Nuevo endpoint `POST /estates/:estateId/receipts` (recibo suelto,
  junto al `generateReceipts` masivo existente) — mismo patrón de
  upsert de `AccountingPeriod` que ya usaba la generación masiva, así
  que definir un periodo que todavía no existe para la finca ya no
  bloquea nada. Usa la columna `manual: true` del schema, que existía
  desde siempre pero ningún endpoint seteaba.
- Frontend: nueva pestaña "Cuentas contables" en `accounting-detail`
  (listar + crear, calcada de `proveedores-tab`); "+ Nueva cuenta
  contable…" inline dentro del propio modal "Nuevo apunte" (no hace
  falta salir del flujo cuando falta una cuenta); `proveedores-tab`
  conectado al backend real (antes el alta era 100% local, se perdía
  al recargar); modal "Recibo manual" reescrito — `Propietario`/`Unidad`
  (texto libre, sin relación real) pasan a un selector de propiedad
  real de la finca, y el periodo pasa de un `<select>` limitado a las
  ya existentes a un `<input type="month">` que admite cualquier mes.
- Bug preexistente encontrado y corregido de paso:
  `DataService.mapReceipt()` leía `r.period?.key` pero el objeto crudo
  del backend anida el periodo como `period.periodKey` (no `.key`) —
  todo recibo tenía `periodKey` vacío tras el mapeo, así que filtrar
  por un periodo específico en `recibos-tab` nunca mostraba nada (solo
  "Todos los periodos" funcionaba). No relacionado al pedido original,
  pero bloqueaba verificar el fix del recibo manual, así que se corrigió.
- Gotcha de verificación: `npx tsc -p tsconfig.json --noEmit` en el
  frontend daba SIEMPRE "0 errores" sin importar qué tan roto estuviera
  el código — el `tsconfig.json` raíz tiene `"files": []` y solo
  referencia a `tsconfig.app.json` (patrón estándar de Angular
  multi-proyecto), así que no compilaba nada en absoluto. Hay que usar
  `npx tsc -p tsconfig.app.json --noEmit` (o `ng build`) para que el
  chequeo de tipos sea real en este repo — varios "clean" reportados en
  sesiones anteriores de este documento probablemente sufrieron el
  mismo falso positivo.
- Verificado con Playwright de punta a punta: finca nueva hereda
  622/700/113 automáticamente; Traspaso en una finca sin cuenta
  `transfer` (finca vieja) se resuelve con el alta inline, que
  autoselecciona la cuenta recién creada; recibo manual con propiedad
  real + periodo nunca usado antes → `201`, el periodo nuevo aparece en
  el filtro y el recibo se ve al seleccionarlo, sobrevive a un reload;
  alta de proveedor persiste tras reload. Cero errores de consola en
  todos los flujos.
