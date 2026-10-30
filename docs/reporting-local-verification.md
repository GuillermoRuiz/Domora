# Root cause

> Registro histórico de la verificación del 15/10. Las migraciones 190000/200000
> fueron corregidas posteriormente antes de integrar la PR: véase
> [la revisión del 17/10](pr-review-split.md). No se ha reescrito el historial de
> la base local ni se deben aplicar automáticamente cambios de checksum.

Verificación local del 15 de octubre de 2026, posterior a la implementación descrita en [reporting.md](reporting.md).

La API que escuchaba en localhost:3000 era el proceso antiguo 10320, ejecutando dist/src/main.js ya cargado en memoria. GET /api/v1/reports/catalog y GET /api/v1/reports/estates devolvían 404 (Cannot GET). GET /api/v1/health y la sesión B existente sí funcionaban. La pantalla /b/reports solicitaba únicamente el catálogo: fallaba antes de mostrar las categorías. No era un error al generar un informe ni una consulta anticipada a comunidades. El texto de error compartido ocultaba esa distinción.

Al actualizar la API apareció un segundo impedimento real: el esquema local tenía ocho migraciones pendientes y tres nombres históricos ausentes del directorio actual. La columna estates.catastro_facade_url todavía faltaba. Se detuvo el despliegue para revisar y reconciliar el historial con la autorización expresa del usuario.

# Environment before fix

| Componente | Estado observado |
|---|---|
| Frontend | Angular ng serve, puerto 4200, PID 33644; conservado |
| Backend | Node dist/src/main.js, puerto 3000, PID 10320; build anterior en memoria |
| PostgreSQL | Servidor nativo, PID 25932, localhost:54329, base domora; conservado |
| Configuración API | No había backend/.env; el proceso anterior tenía la configuración necesaria en su entorno |
| Migraciones | Ocho pendientes y tres nombres históricos incompatibles |

Se conservaron DATABASE_URL, JWT_SECRET, NODE_ENV y STORAGE_DIR del proceso identificado en backend/.env, ignorado por Git. No se regeneraron secretos ni se cambió la base de datos objetivo. No se publican sus valores. No se modificaron RAG, proveedores de IA, manifiestos ni lockfiles.

# Migration safety review

Se leyó individualmente el SQL completo de las ocho pendientes y se contrastó con pg_catalog e information_schema de la base real. No se ejecutó automáticamente el primer migrate deploy fallido.

| Migration | Safe / clasificación | Changes | Destructive operations |
|---|---|---|---|
| 20261004120000_notifications_tickets_bookings_receipts_push | SAFE TO APPLY | Valores de enum de notificaciones, receipts.reminder_sent_at, push_subscriptions con índices y FK; efectos ausentes | Ningún borrado de datos, tablas o columnas |
| 20261005090000_billing_grace_period | SAFE TO APPLY | Enum de facturación y administrator_subscriptions.past_due_since; ausentes | Ninguna |
| 20261010140000_ai_workflows | NEEDS REVIEW inicialmente; HISTORY ONLY tras alineación demostrada | Las tablas AI ya existían con diferencias en defaults y constraints | No se repitió su SQL CREATE |
| 20261014120000_estate_catastro_facade | SAFE TO APPLY | Dos columnas opcionales de fachada/catastro de estates; ausentes | Ninguna |
| 20261015130000_agenda_tasks | ALREADY PRESENT / HISTORY ONLY | Tabla, columnas, índices y constraints ya presentes; mismo checksum que la versión antigua | No se repitió su SQL |
| 20261015140000_agenda_task_status_before_completion | ALREADY PRESENT / HISTORY ONLY | Columna nullable de enum ya existente; misma operación ALTER histórica | No se repitió su SQL |
| 20261015160000_reporting_domain_foundations | SAFE TO APPLY | Cargos comunitarios, prevención de solapes de presidencia, marcadores de incidencias, datos opcionales de contratos/recibos y metadata de auditoría | Aditiva; sin backfill ni borrado |
| 20261015170000_report_snapshots | SAFE TO APPLY | Tabla de versiones privadas, índices y FK | Aditiva; sin backfill ni borrado |

La extensión btree_gist 1.8 ya estaba instalada. Se revisaron restricciones de fecha, importes no negativos, moneda y rangos de presidencia. Los valores legacy desconocidos siguen siendo NULL. No hubo migraciones clasificadas UNSAFE después de resolver la discrepancia AI; la migración AI nunca se ejecutó de nuevo.

## Las tres entradas antiguas y la evidencia

Se recuperó el SQL original de Git y se verificó su SHA-256 contra el registro de Prisma, considerando únicamente las variantes de finales de línea del archivo. Las tres constaban terminadas con éxito. Los checksums completos y los commits están versionados en [legacy-aliases.json](../backend/prisma/migrations/legacy-aliases.json).

| Entrada antigua registrada | Migración actual equivalente | Objetos y evidencia física | Acción realizada |
|---|---|---|---|
| 20261003120000_ai_workflows | 20261010140000_ai_workflows | SQL original de bc64b89; tablas AI existentes. La comparación detectó diferencias reales en defaults, arrays, checks, unique constraints y tres FK | Alineación versionada; comparación sin diferencias; después migrate resolve --applied de la actual |
| 20261014100000_agenda_tasks | 20261015130000_agenda_tasks | SQL de 697a611 con checksum idéntico al archivo actual; agenda_tasks, enum, columnas, índices y constraints equivalentes a una base nueva | migrate resolve --applied de la actual; sin ejecutar CREATE |
| 20261015100000_agenda_task_status_before_completion | 20261015140000_agenda_task_status_before_completion | SQL de 697a611, mismo ALTER; status_before_completion nullable con el enum esperado, físicamente presente | migrate resolve --applied de la actual; sin ejecutar ALTER |

Se comunicaron estas correspondencias, los objetos, la evidencia y las acciones antes de modificar el historial. No se consideró que las migraciones AI fueran equivalentes mientras persistieron diferencias físicas.

## Alineación versionada y prueba de equivalencia

Se añadió [20261015180000_reconcile_legacy_schema](../backend/prisma/migrations/20261015180000_reconcile_legacy_schema/migration.sql). No se editó ni renombró ninguna migración histórica. Esta reparación no es estrictamente aditiva: retira defaults redundantes, homogeneiza metadata de constraints y hace explícita la nulabilidad requerida, sin modificar filas.

La transacción retira los defaults UUID/updated_at adicionales legacy, conserva NOT NULL en tres arrays AI, adopta seis índices únicos como constraints equivalentes, renombra dos checks equivalentes y sustituye atómicamente tres FK NO ACTION no diferibles por RESTRICT con las mismas referencias validadas. Ninguna unicidad se debilita. Un array NULL inesperado hace fallar la transacción; no se inventa un valor para corregirlo.

Antes de modificar la base local se construyó domora_reports_verify_20261015_1a1567 en el mismo PostgreSQL nativo desde cero, usando exclusivamente las migraciones del repositorio, sin seed. También se aplicó allí la reparación versionada por migrate deploy.

En la base local se ejecutó la reparación mediante prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20261015180000_reconcile_legacy_schema/migration.sql. Antes de cualquier resolve se volvió a comparar columnas, tipos, nulabilidad, defaults, índices y constraints de AI/Agenda: cero diferencias. El fingerprint de las 133 tablas anteriores, 372 filas, permaneció idéntico. Después se marcaron como aplicadas únicamente las tres migraciones actuales equivalentes y la reparación ya ejecutada, mediante el [mecanismo oficial de baselining de Prisma](https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining).

Finalmente migrate deploy aplicó las cinco pendientes seguras. La comparación de todo el esquema público con la base nueva dio cero diferencias en columnas, índices y constraints. El fingerprint de todos los datos originales volvió a coincidir antes de comenzar las pruebas funcionales.

La revisión final amplió la comparación a funciones, triggers, etiquetas y orden de enums, vistas, políticas RLS y extensiones. Detectó dos diferencias adicionales que la comparación inicial de columnas/índices/constraints no cubría: el SQL AI histórico tenía ai_check_tenant y cinco triggers omitidos en la migración AI actual, y NotificationCategory tenía las mismas etiquetas con task en otra posición por el orden de aplicación de Agenda. Se corrigieron mediante nuevas migraciones, sin cambiar SQL ya aplicado:

| Migration | Safe / clasificación | Changes | Destructive operations |
|---|---|---|---|
| 20261015180000_reconcile_legacy_schema | SAFE TO APPLY tras revisión y prueba en DB separada | Alineación de defaults, arrays y constraints descrita arriba | Sin borrado de filas, tablas o columnas; sustitución transaccional de tres FK |
| 20261015190000_restore_ai_tenant_guards | SAFE TO APPLY | Conserva el cuerpo histórico de ai_check_tenant y crea los cinco triggers solo donde faltan; la base local conserva sus mismas definiciones | Ninguna; no cambia filas |
| 20261015200000_align_notification_category_order | SAFE TO APPLY solo bajo la precondición verificada | Alinea el enum únicamente si difiere de orden, sus etiquetas son exactamente las esperadas y notifications/user_notification_preferences están vacías; la base canónica no requiere conversión | Sustituye únicamente el tipo enum sin referencias usando un tipo temporal; no borra tablas ni filas |

Antes del último paso se inspeccionaron todas las dependencias del enum: solo las dos columnas NOT NULL indicadas y su tipo array interno, sin defaults. La migración bloquea ambas tablas y falla si descubre filas o etiquetas inesperadas. No se utiliza CASCADE, no se modifica pg_enum manualmente y no se reconstruye el schema. En otra instalación con orden legacy y filas se detendrá para una revisión específica; no se aplicará automáticamente una conversión de datos no revisada.

Las dos nuevas migraciones se aplicaron primero en la base de verificación y después por migrate deploy en domora. Se compararon de nuevo todos los objetos ampliados: cero diferencias, incluido el orden del enum. Los cinco triggers se probaron realmente en la base separada: cada inserción con referencias de comunidad inválidas produjo SQLSTATE 23514 con su mensaje esperado y cero filas persistidas. El segundo fingerprint, tomado tras las pruebas funcionales y antes de estas dos migraciones, confirmó que sus 136 tablas y 489 filas conservaron todos sus valores.

Resultado final del historial: 75 migraciones canónicas aplicadas, 78 registros terminados correctamente, de los cuales tres son los alias históricos documentados. No hay nombres desconocidos adicionales, checksums actuales alterados ni registros originales modificados. Los tres registros antiguos se conservan intactos; no se oculta su existencia ni se eliminan filas de _prisma_migrations. El manifiesto documenta alias; los archivos migration.sql son el historial ejecutable para bases nuevas. La base nueva ha completado la cadena de 75 migraciones con el flujo Prisma normal, sin seed.

Las pruebas funcionales posteriores añaden únicamente los efectos normales de acceso: sesiones de prueba, auditoría y snapshots de informes. No se utilizaron seeds, resets, borrado de datos, backfills especulativos ni recreación del schema local. Los tests de integración con fixtures se ejecutaron exclusivamente en la base separada de verificación.

# Prisma before

- migrate status: ocho pendientes y tres nombres antiguos no presentes como directorios actuales; se detuvo el deploy y se revisó cada caso.
- generate estándar: inicialmente EPERM porque la API antigua tenía cargada la DLL. Tras conservar su configuración y detener únicamente ese proceso, npx.cmd prisma generate terminó correctamente con Prisma 6.19.3.
- migrate status final: Database schema is up to date!; 75 migraciones del repositorio.
- npm.cmd run build del backend, incluido prebuild prisma generate y build:seed: correcto. build:seed compila el código; no ejecuta ningún seed.

# Changes performed

1. Sustitución de la API antigua por el build actual, conservando configuración, PostgreSQL y servidor Angular.
2. Reconciliación y actualización local descritas arriba, con SQL de reparación versionado y evidencias previas al resolve.
3. Error específico de carga del catálogo, detalle de autorización cuando procede y Reintentar. Un HTTP 200 con [] se normaliza como catálogo vacío; HTTP 401/403/404/500 y fallos de red siguen siendo errores.
4. Respuestas HTTP 200 explícitas para query y export de lectura. No se cambiaron guards ni reglas de permisos.
5. Corrección de una carrera real: seleccionar una comunidad y editar rápidamente el ejercicio podía reemplazar la selección por el estado anterior del formulario hijo. El formulario emite cambios parciales y el visor los fusiona con su estado actual. La prueba de regresión falló antes de la corrección.
6. Pruebas de regresión, navegación de las siete categorías, error/reintento y selección seguida de exportación mediante navegador real.

# API verification

Contra localhost:3000/api/v1 y la base habitual, con una sesión propia de Carlos Ruiz, rol B:

| Endpoint | HTTP | Result |
|---|---|---|
| GET /health | 200 | API actual disponible |
| GET /auth/me | 200 | Carlos Ruiz, rol B; restauración de sesión del navegador correcta |
| GET /reports/catalog sin sesión | 401 | Autenticación exigida |
| GET /reports/catalog autenticado | 200 | 47 informes y siete categorías |
| GET /reports/estates | 200 | Solo las dos comunidades propias de Carlos |
| POST /reports/communities/query | 200 | Dos filas para su cartera; una para selección individual |
| POST /reports/communities/export, PDF | 200 | Archivo PDF válido, attachment y no-store |
| POST /reports/communities/export, XLSX | 200 | Libro XLSX válido, attachment y no-store |

Las otras consultas y exportaciones verificadas se detallan a continuación. No se cambiaron prefijo, base URL ni CORS para simular el resultado.

# Catalog verification

Available reports: 47. Disabled reports: 2, ocultos en la respuesta y la navegación. Visible categories: 7.

| Categoría | Disponibles |
|---|---:|
| Cartera y comunidades | 5 |
| Contabilidad y finanzas | 12 |
| Cobros y morosidad | 8 |
| Presupuestos, cuotas y fondos | 5 |
| Operaciones | 10 |
| Juntas, legal y fiscal | 6 |
| Informes inteligentes | 1 |

Los contadores se derivan de las definiciones disponibles de la API. Permanecen deshabilitados Incumplimientos SLA y Saldo individual del fondo de reserva, por sus limitaciones funcionales ya documentadas. No se anuncia Word ni una presentación oficial de impuestos.

# UI verification

Navegador Chromium aislado, sesión B real, Angular en 4200 y API/DB habituales. No se utilizaron respuestas ficticias para demostrar las consultas o descargas.

| Check | Result |
|---|---|
| Landing | PASS: /b/reports carga el catálogo sin solicitar estates ni generar informes |
| Search | PASS: búsquedas por informe/categoría y equivalencia de mayúsculas/tildes |
| 7 cards | PASS: siete enlaces de categoría reales |
| Counts | PASS: 5 / 12 / 8 / 5 / 10 / 6 / 1 |
| Category navigation | PASS: las siete rutas, breadcrumbs, formatos, alcance y CTA corresponden al catálogo real |
| Viewer | PASS: generar explícitamente; una comunidad y selección explícita de dos comunidades; edición rápida de ejercicio conserva el scope |
| Empty | PASS: contratos sin datos muestran No hay datos para estos filtros; los informes vacíos conservan metadata y advertencias |
| Error | PASS: prueba controlada de un único GET catalog con HTTP 500; muestra error de carga, no de generación |
| Retry | PASS: tras ese fallo controlado, Reintentar solicita la API real y recupera las siete cards |
| Dark | PASS: capturas reales revisadas |
| Light | PASS: capturas reales revisadas |
| Desktop | PASS: 1440 y 900 px, tres/dos columnas |
| Mobile | PASS: 640 y 320 px, una columna, sin desbordamiento horizontal; Pixel 5 táctil 393 × 727 con búsqueda y navegación de las siete categorías en ambos temas |

La prueba de error usa interceptación de una sola petición dentro del test de navegador. No altera el servidor ni introduce fixtures en producción. Los estados 200 [] y catálogo vacío tipado también se comprueban con tests unitarios; los errores HTTP y de red no se convierten en éxito vacío.

# Reports manually tested

Recorrido con eventos de UI real y datos existentes de Carlos; todos con HTTP 200. No se creó contenido de negocio para hacer que un resultado vacío pareciera poblado.

| Informe / key | Filas | PDF/XLSX | Observación |
|---|---:|---|---|
| Listado de comunidades / communities | 2 | Ambos, UI | Cartera propia; selección explícita de las dos comunidades también verificada |
| Balance de sumas y saldos / trial-balance | 0 | Ambos, UI | Estado vacío legítimo; edición rápida del ejercicio después de seleccionar comunidad |
| Listado de recibos / receipts | 0 | Ambos, UI | Cartera de Carlos sin recibos; advertencia legacy conservada |
| Presupuesto vs real / budget-vs-actual | 0 | Ambos, UI | Sin presupuesto configurado; no se inventa ejecución |
| Listado de incidencias / issues | 1 | Ambos, UI | Resultado no vacío de operaciones |
| Histórico de participación / meeting-participation | 0 | Ambos, UI | Sin juntas de la comunidad elegida |
| Ejecutivo mensual / monthly-executive | 3 | Ambos, UI | Septiembre de 2026, mes natural cerrado; misma versión en preview y exports |
| Contratos activos / contracts-active | 0 | No solicitados | Empty state real y advertencia, sin crear contratos |
| Presidentes / presidents | 0 | No solicitados | Cargos desconocidos no inventados |
| Económico para junta / meeting-finance | 3 | Ambos, API real | Verificación adicional del segundo tipo de snapshot |

Total del recorrido de Carlos: 10 informes consultados, 16 archivos descargados, cero excepciones JavaScript. Los tests de integración separados ejercitan los 47 handlers disponibles y sus formatos sobre PostgreSQL nativo, con fixtures limitados a esa base de verificación.

# Tenant security regression

Dos administradores B reales y diferentes. La segunda gestora tiene una comunidad que no pertenece a Carlos.

| Caso | HTTP | Resultado |
|---|---:|---|
| Comunidad propia | 200 | PASS |
| Comunidad ajena | 403 | PASS |
| Scope mixto propio + ajeno | 403 | PASS, se rechaza toda la petición |
| UUID inexistente | 403 | PASS |
| Exportación de comunidad ajena | 403 | PASS |
| Selección explícita de las dos comunidades propias, desde UI | 200 | PASS, ambos IDs y dos filas |

Los tests separados también comprueban claims de tenant falsos, roles A/C, filtros ajenos, bloqueo/borrado, snapshots de otro actor y caducidad. No se aflojaron guards para las pruebas.

# Export verification

PDF: PASS. XLSX: PASS. Las 14 descargas desde las siete categorías se activaron mediante sus botones reales; las otras dos corresponden al segundo snapshot por API.

Se verificaron HTTP 200, MIME, Content-Disposition, nombre de archivo, Cache-Control: no-store y contenido binario. Los XLSX se abrieron con ExcelJS: contienen los totales de la preview y ninguna celda de tipo fórmula. Los siete PDF descargados por UI se abrieron con pypdf, se renderizaron con PDFium instalado únicamente en tmp y se inspeccionaron visualmente sus ocho páginas, incluidos versión, caducidad y advertencias.

En monthly-executive se comprobó que los dos POST export envían el snapshotId recibido por la preview. En meeting-finance se exportó la misma referencia y el XLSX conserva referencia y totales. La integración verifica igualdad de secciones/resumen con la misma versión.

Los límites de login y exportación se respetaron. Una primera tanda demasiado rápida recibió 429; se espaciaron las peticiones y se repitió correctamente el recorrido completo, sin cambiar la protección.

# Tests

| Command / comprobación | Tests | Resultado |
|---|---:|---|
| npx.cmd prisma generate, API anterior detenida | Cliente estándar 6.19.3 | PASS |
| npm.cmd run build, backend | Nest + compilación de seed, sin ejecutarlo | PASS |
| npx.cmd tsc --noEmit -p tsconfig.app.json y tsconfig.spec.json | Tipos app/spec | PASS |
| npm.cmd run build, frontend | Producción, código de salida 0 | PASS |
| npm.cmd test -- --watch=false --include=src/app/**/report*.spec.ts | 8 archivos, 47 tests, código de salida 0 | PASS |
| node node_modules/jest/bin/jest.js --runInBand --testPathPatterns=SELECCION, backend con DATABASE_URL de verificación | 18 suites, 126 tests, código de salida 0 | PASS |
| npm.cmd run e2e -- e2e/smoke/reports.spec.ts --project=chromium --workers=1 --reporter=line | 5 tests, código de salida 0; repetidos después de las dos migraciones finales | PASS |
| Recorrido adicional Chromium, Carlos, API/DB habituales | 10 informes, 16 descargas, cinco casos de autorización | PASS |
| Navegador táctil Pixel 5, sesión propia de Carlos | Siete categorías, búsqueda, dark/light | PASS |
| migrate deploy desde una base nueva vacía | 75 migraciones, sin seed | PASS |
| npx.cmd prisma migrate status, DB habitual | Database schema is up to date! | PASS |
| Comparación física con base nueva | Columnas, índices, constraints, funciones, triggers, enums/orden, vistas, políticas RLS y extensiones | PASS, cero diferencias |
| Fingerprints antes/después de actualización | 133 tablas, 372 filas existentes | PASS, cero cambios |
| Fingerprints de las dos migraciones finales | 136 tablas, 489 filas presentes tras las pruebas funcionales | PASS, cero cambios |
| Triggers AI sobre la base separada | Cinco rechazos nativos SQLSTATE 23514, cero filas persistidas | PASS |
| Verificación de historial | 75 canónicas + 3 alias, checksums y registros originales | PASS |
| git diff --check | Diff de trabajo | PASS |

SELECCION es la expresión regular reporting\|estate-governance\|estate-office-term\|issue-status\|issues-status-history\|receipt-issued-at\|contract-rules\|contract-validation\|ledger-reports\|receipts-posting. Se pasó como argumento directo de Node para evitar que npm.cmd interprete los caracteres de pipe como comandos en Windows. La DB de integración se comprobó por nombre antes de asignarla al proceso de Jest; nunca se apuntó esa suite a domora.

Se observaron fallos RED de las pruebas de catálogo, HTTP 201/200 y carrera del filtro antes de sus respectivas correcciones. Los cuatro fallos previos de recibos con el adaptador PGlite ya no se reproducen: la suite completa de 20 tests pasa en PostgreSQL nativo y está incluida en los 126.

# Files changed in this fix

Solo cambios de esta corrección, comparados con los hashes capturados al iniciarla; se conservó la implementación previa de 99 archivos:

- backend/src/reporting/reporting.controller.ts
- backend/src/reporting/reporting.integration.spec.ts
- src/app/core/reporting.service.ts
- src/app/core/reporting.service.spec.ts
- src/app/features/reports/reports-catalog.component.ts
- src/app/features/reports/reports-catalog.component.html
- src/app/features/reports/reports-catalog.component.spec.ts
- src/app/features/reports/report-filters.component.ts
- src/app/features/reports/report-viewer.component.ts
- src/app/features/reports/report-viewer.component.html
- src/app/features/reports/report-viewer.component.spec.ts
- e2e/smoke/reports.spec.ts
- backend/prisma/migrations/20261015180000_reconcile_legacy_schema/migration.sql (nuevo)
- backend/prisma/migrations/20261015190000_restore_ai_tenant_guards/migration.sql (nuevo)
- backend/prisma/migrations/20261015200000_align_notification_category_order/migration.sql (nuevo)
- backend/prisma/migrations/legacy-aliases.json (nuevo)
- docs/reporting-local-verification.md (nuevo)
- docs/reporting.md (enlace a esta verificación posterior)

Configuración local adicional: backend/.env, ignorado por Git, conservando valores previos. Evidencias, capturas, utilidades de inspección y renderizador PDF permanecen bajo tmp, también ignorado. No hay cambios de dependencias declaradas, lockfiles, RAG ni migraciones históricas. No se crearon commits.

# Database migrations applied

SQL ejecutado por migrate deploy en la base local:

- 20261004120000_notifications_tickets_bookings_receipts_push
- 20261005090000_billing_grace_period
- 20261014120000_estate_catastro_facade
- 20261015160000_reporting_domain_foundations
- 20261015170000_report_snapshots
- 20261015190000_restore_ai_tenant_guards
- 20261015200000_align_notification_category_order

SQL de reparación versionado ejecutado previamente, transaccionalmente:

- 20261015180000_reconcile_legacy_schema

Marcadas mediante migrate resolve --applied solo después de demostrar sus efectos:

- 20261010140000_ai_workflows
- 20261015130000_agenda_tasks
- 20261015140000_agenda_task_status_before_completion
- 20261015180000_reconcile_legacy_schema

No se ejecutaron de nuevo los SQL originales de AI ni de Agenda.

# Snapshot privacy observations

ReportSnapshot persiste el resultado canónico completo en JSON de meeting-finance y monthly-executive: metadata, comunidades, periodos, secciones, filas, totales, advertencias y, cuando existen, nombres de proveedores, cuentas/referencias, importes y datos de contratos. Es información empresarial sensible y puede contener datos personales; no se trata como una caché pública ni como información anónima.

Incluye actor, administrador, IDs exactos de comunidades, hash de filtros, fecha de generación y caducidad de 30 días. Cada carga/exportación vuelve a resolver el usuario y su ámbito en la DB; exige mismo actor, administrador, comunidades, informe y hash de filtros. Los documentos exportados llevan la misma referencia de versión de la vista previa. Se rechazan versiones caducadas; la limpieza física está programada diariamente a las 03:00 Europe/Madrid y al crear otra versión del administrador. La auditoría no copia el contenido del informe ni el de sus filtros. No se modificó esta política para la corrección local.

# Remaining issues

No quedan bloqueos detectados para el Centro de Informes en este entorno. No se probó un despliegue Azure; sí la reconstrucción desde el historial del repositorio en PostgreSQL nativo. Los tres registros históricos adicionales siguen presentes, documentados como alias; no se han eliminado ni reescrito para aparentar una correspondencia uno a uno. El status oficial de Prisma es limpio.

Permanecen los avisos existentes de Angular NG8113 en Tasks y presupuestos CSS de componentes ajenos, y la deprecación package.json#prisma. El entorno de desarrollo conserva sus avisos anteriores de Stripe sin configurar y derivación SEPA desde JWT_SECRET; no se cambió esa configuración. No se ejecutaron llamadas externas de IA ni se habilitaron workers para esta tarea. Firefox y WebKit no se ejecutaron en esta corrección; la evidencia de navegador corresponde a Chromium de escritorio, tamaños responsive y emulación táctil Pixel 5.

La reparación del orden del enum exige tablas de notificaciones vacías cuando detecta orden legacy. En staging/producción con datos y ese orden distinto, esa precondición detendrá el despliegue y requerirá revisar una migración de conversión específica. Una base nueva con el orden canónico pasa sin sustituir el tipo.

# Final confirmation

http://localhost:4200/b/reports muestra realmente el buscador, siete cards, contadores 5/12/8/5/10/6/1 y navegación funcional. Se comprobó con Carlos Ruiz, rol B, usando la API y DB habituales, y se repitió la suite E2E después de las migraciones finales. Ya no aparece el error inicial de la captura.

Se dejan activos Angular en 4200, la API actual en 3000 y PostgreSQL en 54329. Se conservaron las filas originales. No se ejecutaron reset, seed, DROP TABLE, borrado de datos ni backfills especulativos; tampoco se renombraron o editaron migraciones publicadas.

Evidencias locales ignoradas por Git: tmp/reports-local-before-evidence.json, tmp/reports-local-live-evidence.json, tmp/reports-multiscope-evidence.json, tmp/reports-touch-evidence.json, tmp/reports-pdf-validation.json, tmp/reports-history-verification.json, tmp/reports-legacy-schema-comparison.json, tmp/reports-additional-schema-comparison.json, tmp/reports-data-after.json, tmp/reports-additional-data-after.json y los logs finales de pruebas bajo tmp/reports-*.log. Las capturas y documentos de verificación también permanecen en tmp, sin publicarse.
