> Verificación local posterior: [reporting-local-verification.md](reporting-local-verification.md). La API habitual ya está actualizada, el historial está reconciliado y las 75 migraciones están aplicadas. Ese informe sustituye las limitaciones ambientales de la primera validación descritas más abajo: generate/build estándar y las pruebas de recibos sobre PostgreSQL nativo ya pasan.

# Implemented

Centro de Informes nativo: 47 informes disponibles, siete categorías, tres rutas lazy, sidebar B, búsqueda sin acentos, selector una/varias/todas, filtros, generación explícita, vista previa y exportaciones PDF/XLSX reales. Sin nuevos datos mock de producción, dependencias declaradas, servicios cloud, llamadas LLM ni cambios RAG.

# Architecture

Angular standalone reutiliza shell, Topbar, Btn, Badge, EmptyState y ReportTable. ReportingModule orquesta ledger/reports, BudgetService, JournalBookService, EstateOverviewService y MeetingsService. Los agregados contables nuevos viven en LedgerQueryService; los criterios de gasto proveedor están en suppliers y la deuda a fecha en debtors. Prisma.Decimal conserva los importes hasta serializar; el frontend solo presenta valores.

# New routes

- /b/reports
- /b/reports/category/:categoryKey
- /b/reports/view/:reportKey
- GET /api/v1/reports/catalog
- GET /api/v1/reports/estates
- POST /api/v1/reports/:reportKey/query
- POST /api/v1/reports/:reportKey/export
- GET/POST /api/v1/estates/:estateId/office-terms
- GET /api/v1/estates/:estateId/office-terms/candidates
- PATCH /api/v1/estates/:estateId/office-terms/:termId/end

Las rutas existentes permanecen disponibles. Reporting exige autenticación y rol B. El mantenimiento de cargos conserva el acceso de gestión A/B de Fincas y revalida su rol y ámbito reales desde DB.

# Report catalog

| Category | Report | Scope | Formats | Status |
|---|---|---|---|---|
| Cartera y comunidades | Listado de comunidades (communities) | Una/varias/todas | PDF, XLSX | available |
| Cartera y comunidades | Listado de presidentes (presidents) | Una/varias/todas | PDF, XLSX | available |
| Cartera y comunidades | Listado de propiedades (properties) | Una/varias/todas | PDF, XLSX | available |
| Cartera y comunidades | Listado de propietarios (owners) | Una/varias/todas | PDF, XLSX | available |
| Cartera y comunidades | Resumen de cartera (portfolio-summary) | Una/varias/todas | PDF, XLSX | available |
| Contabilidad y finanzas | Ingresos y gastos (income-expenses) | Una/varias/todas | PDF, XLSX | available |
| Contabilidad y finanzas | Ingresos y gastos abreviado (income-expenses-summary) | Una/varias/todas | PDF, XLSX | available |
| Contabilidad y finanzas | Ingresos y gastos por meses (income-expenses-monthly) | Una/varias/todas | PDF, XLSX | available |
| Contabilidad y finanzas | Gastos vs presupuesto (budget-comparison) | Una | PDF, XLSX | available |
| Contabilidad y finanzas | Comparativa entre periodos (period-comparison) | Una/varias/todas | PDF, XLSX | available |
| Contabilidad y finanzas | Saldos y fondo de reserva (balances-reserve) | Una/varias/todas | PDF, XLSX | available |
| Contabilidad y finanzas | Balance de sumas y saldos (trial-balance) | Una | PDF, XLSX | available |
| Contabilidad y finanzas | Aportaciones al fondo de reserva por propiedad (reserve-contributions) | Una/varias/todas | PDF, XLSX | available |
| Contabilidad y finanzas | Cuenta contable por comunidades (account-by-estate) | Una/varias/todas | PDF, XLSX | available |
| Contabilidad y finanzas | Libro Diario (journal) | Una | PDF, XLSX | available |
| Contabilidad y finanzas | Libro Mayor (general-ledger) | Una | PDF, XLSX | available |
| Contabilidad y finanzas | Balance de situación (balance-sheet) | Una | PDF, XLSX | available |
| Cobros y morosidad | Listado de recibos (receipts) | Una/varias/todas | PDF, XLSX | available |
| Cobros y morosidad | Recibos pendientes (receipts-pending) | Una/varias/todas | PDF, XLSX | available |
| Cobros y morosidad | Recibos por tipo de cuota (receipts-by-kind) | Una/varias/todas | PDF, XLSX | available |
| Cobros y morosidad | Listado de morosos (debtors) | Una/varias/todas | PDF, XLSX | available |
| Cobros y morosidad | Extracto de deuda por propiedad (property-debt) | Una/varias/todas | PDF, XLSX | available |
| Cobros y morosidad | Deuda consolidada por propietario (owner-debt) | Una/varias/todas | PDF, XLSX | available |
| Cobros y morosidad | Aging de morosidad (debt-aging) | Una/varias/todas | PDF, XLSX | available |
| Cobros y morosidad | Morosidad por comunidad (debt-by-estate) | Una/varias/todas | PDF, XLSX | available |
| Presupuestos, cuotas y fondos | Presupuesto (budget) | Una | PDF, XLSX | available |
| Presupuestos, cuotas y fondos | Presupuesto vs real (budget-vs-actual) | Una | PDF, XLSX | available |
| Presupuestos, cuotas y fondos | Cuotas actuales (fees-current) | Una/varias/todas | PDF, XLSX | available |
| Presupuestos, cuotas y fondos | Cuotas emitidas por mes (fees-issued-monthly) | Una/varias/todas | PDF, XLSX | available |
| Presupuestos, cuotas y fondos | Liquidación de caja (cash-settlement) | Una | PDF, XLSX | available |
| Operaciones | Listado de incidencias (issues) | Una/varias/todas | PDF, XLSX | available |
| Operaciones | Incidencias por comunidad (issues-by-estate) | Una/varias/todas | PDF, XLSX | available |
| Operaciones | Incidencias por categoría (issues-by-category) | Una/varias/todas | PDF, XLSX | available |
| Operaciones | Incidencias por proveedor (issues-by-supplier) | Una/varias/todas | PDF, XLSX | available |
| Operaciones | Tiempo medio de resolución (issue-resolution) | Una/varias/todas | PDF, XLSX | available |
| Operaciones | Importes por proveedor (supplier-spend) | Una/varias/todas | PDF, XLSX | available |
| Operaciones | Proveedores por comunidad (suppliers) | Una/varias/todas | PDF, XLSX | available |
| Operaciones | Facturas por proveedor (supplier-invoices) | Una/varias/todas | PDF, XLSX | available |
| Operaciones | Contratos activos (contracts-active) | Una/varias/todas | PDF, XLSX | available |
| Operaciones | Contratos próximos a vencer (contracts-expiring) | Una/varias/todas | PDF, XLSX | available |
| Juntas, legal y fiscal | Propietarios y coeficientes (owners-coefficients) | Una/varias/todas | PDF, XLSX | available |
| Juntas, legal y fiscal | Resumen económico para junta (meeting-finance) | Una | PDF, XLSX | available |
| Juntas, legal y fiscal | Modelo 111 — preparatorio (tax-111) | Una | PDF, XLSX | available |
| Juntas, legal y fiscal | Modelo 190 — preparatorio (tax-190) | Una | PDF, XLSX | available |
| Juntas, legal y fiscal | Modelo 347 — borrador (tax-347-draft) | Una | PDF, XLSX | available |
| Juntas, legal y fiscal | Histórico de participación en juntas (meeting-participation) | Una | PDF, XLSX | available |
| Informes inteligentes | Informe ejecutivo mensual de comunidad (monthly-executive) | Una | PDF, XLSX | available |
| Operaciones | Incumplimientos SLA (sla-breaches) | Una/varias/todas | — | disabled |
| Presupuestos, cuotas y fondos | Saldo individual del fondo de reserva (individual-reserve-balance) | Una/varias/todas | — | disabled |

# Database changes

| Model | Change | Reason |
|---|---|---|
| EstateOfficeTerm | Histórico, snapshots de titular y exclusión PostgreSQL de presidentes solapados | Mantener cargos sin perder historia |
| Issue | resolvedAt/closedAt nullable | Ciclo actual de resolución/cierre |
| IssueTimelineEntry | fromStatus/toStatus nullable y constraint conjunta | Transiciones estructuradas atómicas |
| SupplierContract | costAmount Decimal opcional, frecuencia opcional, moneda EUR por defecto | Costes mantenibles sin cifras inventadas |
| AccountingReceipt | issuedAt nullable | Emisión real separada del devengo/importación |
| DataAccessLog | metadata JSON opcional | Reutilizar auditoría técnica sin contenido personal |
| ReportSnapshot | Resultado JSON privado, actor, tenant, scope exacto, hash y caducidad | Reproducir junta/ejecutivo durante 30 días |

# Security controls

JWT y RolesGuard existentes, CurrentUser, DTOs class-validator con whitelist/forbidNonWhitelisted/transform, fechas reales y rangos inclusivos, filtros tipados, SQL parametrizado y claves de catálogo cerradas. Identidad financiera por código exacto; propietarios por User.id o identificador fiscal validado, nunca por nombre/email aproximado. Sensitivity se usa en UI y auditoría. Límites explícitos: 50.000 filas globales, 10.000 en PDF, 20.000 en listados, 10.000 asientos y 500 juntas. No hay truncamiento silencioso; el servidor rechaza resultados excesivos.

Consultas y exports registran VIEW/EXPORT y outcome en DataAccessLog. No almacenan contenidos, nombres, NIF, IBAN, emails ni filtros completos en el audit. Un fallo de auditoría impide entregar el informe. Las consultas lentas conservan SQL parametrizado y duración, sin valores de parámetros.

# Tenant isolation

Cada catálogo, scope, consulta y export vuelve a leer usuario, rol, gestora y comunidades vigentes desde DB. Los claims administratorId/estateIds del JWT no conceden acceso. Una selección mixta, ajena o inexistente produce 403 completo. Los filtros propertyId/supplierId también se validan contra el scope. La carga de snapshots vuelve a comprobar actor, gestora, scope exacto, parámetros y caducidad.

# Exports

PDFKit/ExcelJS existentes reciben las mismas secciones, totales, resúmenes y advertencias del resultado JSON. MIME y Content-Disposition correctos, Cache-Control no-store, nombres técnicos seguros sin PII, buffers en memoria sin ficheros temporales. ExcelJS recibe textos como strings, sin interpretar fórmulas; la prueba abre el XLSX y comprueba el tipo de sus celdas. DOCX no se anuncia.

Junta y ejecutivo mensual guardan una versión privada al generar. El visor transmite snapshotId al exportar: nuevas anotaciones/correcciones no alteran esa versión. Generar otra vez crea otra. Caduca a los 30 días; limpieza física diaria a las 03:00 de Madrid y limpieza de expirados de la gestora al crear versiones. En instalaciones sin scheduler la limpieza global debe ejecutarse externamente; las versiones caducadas nunca son accesibles.

# UI structure

Hub de siete cards semánticas; categoría con informes/formatos/scope; visor con scope, periodo, filtros, botón Generar, resumen, tablas, advertencias y exportación. Cambiar filtros invalida resultados/export anterior. Estados loading/error/empty. Selector con búsqueda, selección múltiple, limpiar, seleccionar todas, Escape, foco y teclado. Temas con tokens; grid 3/2/1; pruebas reales a 1440/900/640/320 px. Presidencia se mantiene en Finca → Propiedades → Órganos de gobierno; costes en el formulario existente de contratos.

# Files created

- [backend/prisma/migrations/20261015160000_reporting_domain_foundations/migration.sql](../backend/prisma/migrations/20261015160000_reporting_domain_foundations/migration.sql)
- [backend/prisma/migrations/20261015170000_report_snapshots/migration.sql](../backend/prisma/migrations/20261015170000_report_snapshots/migration.sql)
- [backend/src/debtors/receipt-debt-query.ts](../backend/src/debtors/receipt-debt-query.ts)
- [backend/src/estates/dto/estate-office-term.dto.ts](../backend/src/estates/dto/estate-office-term.dto.ts)
- [backend/src/estates/estate-governance.controller.ts](../backend/src/estates/estate-governance.controller.ts)
- [backend/src/estates/estate-governance.service.ts](../backend/src/estates/estate-governance.service.ts)
- [backend/src/estates/estate-governance.spec.ts](../backend/src/estates/estate-governance.spec.ts)
- [backend/src/estates/estate-office-term.integration.spec.ts](../backend/src/estates/estate-office-term.integration.spec.ts)
- [backend/src/issues/issue-status.spec.ts](../backend/src/issues/issue-status.spec.ts)
- [backend/src/issues/issue-status.ts](../backend/src/issues/issue-status.ts)
- [backend/src/issues/issues-status-history.spec.ts](../backend/src/issues/issues-status-history.spec.ts)
- [backend/src/ledger/posting/receipt-issued-at.spec.ts](../backend/src/ledger/posting/receipt-issued-at.spec.ts)
- [backend/src/reporting/definitions/report-catalog.ts](../backend/src/reporting/definitions/report-catalog.ts)
- [backend/src/reporting/dto/report-query.dto.ts](../backend/src/reporting/dto/report-query.dto.ts)
- [backend/src/reporting/handlers/composite-reports.service.ts](../backend/src/reporting/handlers/composite-reports.service.ts)
- [backend/src/reporting/handlers/financial-reports.service.ts](../backend/src/reporting/handlers/financial-reports.service.ts)
- [backend/src/reporting/handlers/operations-reports.integration.spec.ts](../backend/src/reporting/handlers/operations-reports.integration.spec.ts)
- [backend/src/reporting/handlers/operations-reports.service.spec.ts](../backend/src/reporting/handlers/operations-reports.service.spec.ts)
- [backend/src/reporting/handlers/operations-reports.service.ts](../backend/src/reporting/handlers/operations-reports.service.ts)
- [backend/src/reporting/handlers/portfolio-reports.integration.spec.ts](../backend/src/reporting/handlers/portfolio-reports.integration.spec.ts)
- [backend/src/reporting/handlers/portfolio-reports.service.ts](../backend/src/reporting/handlers/portfolio-reports.service.ts)
- [backend/src/reporting/handlers/receipt-reports.integration.spec.ts](../backend/src/reporting/handlers/receipt-reports.integration.spec.ts)
- [backend/src/reporting/handlers/receipt-reports.service.ts](../backend/src/reporting/handlers/receipt-reports.service.ts)
- [backend/src/reporting/handlers/report-rules.spec.ts](../backend/src/reporting/handlers/report-rules.spec.ts)
- [backend/src/reporting/handlers/report-rules.ts](../backend/src/reporting/handlers/report-rules.ts)
- [backend/src/reporting/report-audit.service.ts](../backend/src/reporting/report-audit.service.ts)
- [backend/src/reporting/report-scope.service.spec.ts](../backend/src/reporting/report-scope.service.spec.ts)
- [backend/src/reporting/report-scope.service.ts](../backend/src/reporting/report-scope.service.ts)
- [backend/src/reporting/report-snapshot.service.spec.ts](../backend/src/reporting/report-snapshot.service.spec.ts)
- [backend/src/reporting/report-snapshot.service.ts](../backend/src/reporting/report-snapshot.service.ts)
- [backend/src/reporting/report-validation.spec.ts](../backend/src/reporting/report-validation.spec.ts)
- [backend/src/reporting/report-validation.ts](../backend/src/reporting/report-validation.ts)
- [backend/src/reporting/reporting.controller.ts](../backend/src/reporting/reporting.controller.ts)
- [backend/src/reporting/reporting.integration.spec.ts](../backend/src/reporting/reporting.integration.spec.ts)
- [backend/src/reporting/reporting.module.ts](../backend/src/reporting/reporting.module.ts)
- [backend/src/reporting/reporting.service.ts](../backend/src/reporting/reporting.service.ts)
- [backend/src/reporting/reporting.types.ts](../backend/src/reporting/reporting.types.ts)
- [backend/src/suppliers/contract-rules.spec.ts](../backend/src/suppliers/contract-rules.spec.ts)
- [backend/src/suppliers/contract-rules.ts](../backend/src/suppliers/contract-rules.ts)
- [backend/src/suppliers/contract-validation.spec.ts](../backend/src/suppliers/contract-validation.spec.ts)
- [backend/src/suppliers/supplier-report-query.ts](../backend/src/suppliers/supplier-report-query.ts)
- [docs/reporting.md](../docs/reporting.md)
- [docs/reports-domain-foundations.md](../docs/reports-domain-foundations.md)
- [e2e/smoke/reports.spec.ts](../e2e/smoke/reports.spec.ts)
- [src/app/core/estate-governance.service.ts](../src/app/core/estate-governance.service.ts)
- [src/app/core/reporting.models.ts](../src/app/core/reporting.models.ts)
- [src/app/core/reporting.service.spec.ts](../src/app/core/reporting.service.spec.ts)
- [src/app/core/reporting.service.ts](../src/app/core/reporting.service.ts)
- [src/app/features/estate-detail/estate-governance/estate-governance.component.html](../src/app/features/estate-detail/estate-governance/estate-governance.component.html)
- [src/app/features/estate-detail/estate-governance/estate-governance.component.scss](../src/app/features/estate-detail/estate-governance/estate-governance.component.scss)
- [src/app/features/estate-detail/estate-governance/estate-governance.component.spec.ts](../src/app/features/estate-detail/estate-governance/estate-governance.component.spec.ts)
- [src/app/features/estate-detail/estate-governance/estate-governance.component.ts](../src/app/features/estate-detail/estate-governance/estate-governance.component.ts)
- [src/app/features/reports/report-estate-scope-selector.component.html](../src/app/features/reports/report-estate-scope-selector.component.html)
- [src/app/features/reports/report-estate-scope-selector.component.scss](../src/app/features/reports/report-estate-scope-selector.component.scss)
- [src/app/features/reports/report-estate-scope-selector.component.spec.ts](../src/app/features/reports/report-estate-scope-selector.component.spec.ts)
- [src/app/features/reports/report-estate-scope-selector.component.ts](../src/app/features/reports/report-estate-scope-selector.component.ts)
- [src/app/features/reports/report-filters.component.html](../src/app/features/reports/report-filters.component.html)
- [src/app/features/reports/report-filters.component.scss](../src/app/features/reports/report-filters.component.scss)
- [src/app/features/reports/report-filters.component.spec.ts](../src/app/features/reports/report-filters.component.spec.ts)
- [src/app/features/reports/report-filters.component.ts](../src/app/features/reports/report-filters.component.ts)
- [src/app/features/reports/report-viewer.component.html](../src/app/features/reports/report-viewer.component.html)
- [src/app/features/reports/report-viewer.component.spec.ts](../src/app/features/reports/report-viewer.component.spec.ts)
- [src/app/features/reports/report-viewer.component.ts](../src/app/features/reports/report-viewer.component.ts)
- [src/app/features/reports/reporting.fixtures.spec-helper.ts](../src/app/features/reports/reporting.fixtures.spec-helper.ts)
- [src/app/features/reports/reporting.utils.ts](../src/app/features/reports/reporting.utils.ts)
- [src/app/features/reports/reports-catalog.component.html](../src/app/features/reports/reports-catalog.component.html)
- [src/app/features/reports/reports-catalog.component.spec.ts](../src/app/features/reports/reports-catalog.component.spec.ts)
- [src/app/features/reports/reports-catalog.component.ts](../src/app/features/reports/reports-catalog.component.ts)
- [src/app/features/reports/reports.guard.spec.ts](../src/app/features/reports/reports.guard.spec.ts)
- [src/app/features/reports/reports.guard.ts](../src/app/features/reports/reports.guard.ts)
- [src/app/features/reports/reports.scss](../src/app/features/reports/reports.scss)
- [tasks/plan.md](../tasks/plan.md)
- [tasks/todo.md](../tasks/todo.md)

# Files modified

- [backend/prisma/schema.prisma](../backend/prisma/schema.prisma)
- [backend/src/app.module.ts](../backend/src/app.module.ts)
- [backend/src/estates/estates.module.ts](../backend/src/estates/estates.module.ts)
- [backend/src/imports/imports.service.spec.ts](../backend/src/imports/imports.service.spec.ts)
- [backend/src/imports/imports.service.ts](../backend/src/imports/imports.service.ts)
- [backend/src/issues/issues.service.ts](../backend/src/issues/issues.service.ts)
- [backend/src/ledger/ledger-query.service.ts](../backend/src/ledger/ledger-query.service.ts)
- [backend/src/ledger/ledger.module.ts](../backend/src/ledger/ledger.module.ts)
- [backend/src/ledger/posting/receipt-posting.service.ts](../backend/src/ledger/posting/receipt-posting.service.ts)
- [backend/src/ledger/reports/ledger-reports.service.ts](../backend/src/ledger/reports/ledger-reports.service.ts)
- [backend/src/meetings/meetings.service.ts](../backend/src/meetings/meetings.service.ts)
- [backend/src/prisma/prisma.service.ts](../backend/src/prisma/prisma.service.ts)
- [backend/src/suppliers/dto/create-supplier-contract.dto.ts](../backend/src/suppliers/dto/create-supplier-contract.dto.ts)
- [backend/src/suppliers/dto/update-supplier-contract.dto.ts](../backend/src/suppliers/dto/update-supplier-contract.dto.ts)
- [backend/src/suppliers/suppliers.service.ts](../backend/src/suppliers/suppliers.service.ts)
- [src/app/app.routes.ts](../src/app/app.routes.ts)
- [src/app/core/api-client.service.ts](../src/app/core/api-client.service.ts)
- [src/app/core/models.ts](../src/app/core/models.ts)
- [src/app/core/suppliers-staff.service.ts](../src/app/core/suppliers-staff.service.ts)
- [src/app/features/accounting/proveedores-tab/proveedores-tab.component.html](../src/app/features/accounting/proveedores-tab/proveedores-tab.component.html)
- [src/app/features/accounting/proveedores-tab/proveedores-tab.component.spec.ts](../src/app/features/accounting/proveedores-tab/proveedores-tab.component.spec.ts)
- [src/app/features/accounting/proveedores-tab/proveedores-tab.component.ts](../src/app/features/accounting/proveedores-tab/proveedores-tab.component.ts)
- [src/app/features/estate-detail/estate-detail.component.html](../src/app/features/estate-detail/estate-detail.component.html)
- [src/app/features/estate-detail/estate-detail.component.spec.ts](../src/app/features/estate-detail/estate-detail.component.spec.ts)
- [src/app/features/estate-detail/estate-detail.component.ts](../src/app/features/estate-detail/estate-detail.component.ts)
- [src/app/layout/sidebar/sidebar.component.ts](../src/app/layout/sidebar/sidebar.component.ts)

# Tests added

Scope fresco e IDOR, DTO y catálogo, todos los handlers, formatos de los 47 informes, deuda histórica/aging/pagos/devoluciones/anulación, identidad y coeficientes, presidentes/constraints, incidencias/reaperturas, contratos/costes, emisión/importación, snapshots y caducidad. Frontend: servicio, guard, catálogo/búsqueda, selector, filtros, visor/export/versiones y mantenimiento de dominio. E2E con API real y navegador aislado.

# Tests run

| Check | Result |
|---|---|
| 72 migraciones consecutivas en DB nueva desechable | PASS |
| Prisma generate a salida temporal equivalente | PASS |
| Prisma generate estándar, DLL usada por API anterior | FAIL ambiental: EPERM al reemplazar DLL |
| Typecheck backend | PASS |
| Build backend (sin repetir prebuild bloqueado) y build:seed | PASS |
| Typecheck app/spec frontend | PASS |
| Build frontend producción | PASS; warnings previos |
| Backend relevante, 17 suites / 106 tests | PASS |
| Frontend relevante, 11 archivos / 169 tests | PASS |
| E2E Chromium escritorio+móvil, 4 tests | PASS |
| Dark/light y 4 anchuras, capturas revisadas | PASS |
| git diff --check | PASS |

Se usó PostgreSQL compatible PGlite ya instalado en el entorno de verificación, con DBs temporales aisladas; no se migró ni reseteó la base habitual del usuario. El cliente Prisma temporal utiliza exactamente la versión instalada 6.19.3 y el schema del repositorio. No cambia dependencias ni archivos de configuración del proyecto. Se adaptaron solo archivos generados locales para reutilizar el runtime instalado, conservando el engine bloqueado de la misma versión.

# Existing failures not caused by this change

La suite anterior receipts-posting.spec.ts tuvo cuatro fallos al verificar errores esperados de constraints: el adaptador wire de PGlite cerró la conexión después del primero y no devolvió el código esperado (DM032). Se conservaron las aserciones. Requiere repetir esa suite en PostgreSQL nativo; no se declara validada. Las otras cuatro suites existentes del mismo grupo (suppliers, issue notifications, imports, estates) pasaron. La suite contable ledger-reports incluida en las 106 pruebas pasó.

Prisma generate estándar encuentra EPERM por la DLL cargada por el proceso API previo de :3000; no se detuvo ese proceso ni se perdió su configuración. La generación aislada, typechecks y compilación funcionaron. Angular mantiene NG8113 de Tasks y avisos de presupuesto CSS de componentes existentes. Ninguno se ocultó.

# Deferred reports

- Incumplimientos SLA: disabled y oculto; falta política funcional.
- Saldo individual del fondo de reserva: disabled y oculto; faltan reglas de imputación de usos/ajustes. Se muestran aportaciones identificadas y fondo comunitario sin llamarlos saldo individual.
- Word y declaraciones oficiales AEAT no se anuncian. El 347 es borrador parcial de compras/proveedores y lo indica en preview y documentos.

# Important decisions

Los cortes históricos de deuda se calculan desde diario, nunca desde outstanding actual. Buckets: no vencido, menos de 30, 30–60, 61–90, más de 90 y sin fecha; sin fecha se separa de vencido. No se inventa issuedAt legacy ni resolución desde updatedAt/textos. Los contratos sin coste continúan sin coste; OTHER/ONE_OFF no se anualizan y no se convierten monedas. La participación reutiliza el motor de juntas existente, con límites explícitos. El presupuesto anual se etiqueta como anual: no se inventa prorrateo mensual. La ejecución sin presupuesto se detalla/advierte. El ejecutivo usa el último mes natural completo como valor inicial y no admite cierres futuros.

Presidencias usan intervalos [inicio, fin); contratos conservan fin inclusivo. Las reaperturas limpian los marcadores del ciclo actual y conservan eventos previos. El doble asiento, deuda y servicios contables siguen siendo las fuentes de verdad. La implementación no supone certificación ISO/ENS/RGPD/SOC2.

# Migration notes

Aplicar en orden las migraciones 20261015160000_reporting_domain_foundations y 20261015170000_report_snapshots con el flujo Prisma normal. Son aditivas, sin borrado ni backfill especulativo. btree_gist ya forma parte de las dependencias SQL existentes. Importes/fechas legacy permanecen null donde se desconocen. Detalles de modelo en [reports-domain-foundations.md](reports-domain-foundations.md).

# How to run locally

Configurar backend/.env siguiendo la configuración existente, con DATABASE_URL para una DB PostgreSQL local y secretos de desarrollo. En Windows usar npm.cmd/npx.cmd si PowerShell bloquea npm.ps1. Desde backend:

~~~powershell
npm.cmd ci
npx.cmd prisma migrate deploy
npx.cmd prisma generate
npm.cmd run build
npm.cmd run start:dev
~~~

Desde la raíz, en otra terminal:

~~~powershell
npm.cmd ci
npm.cmd start
~~~

Entrar con un usuario B y abrir /b/reports. Si hay una API anterior usando el engine Prisma de Windows, detener/reiniciar esa instancia conocida antes de regenerar. No ejecutar seed/reset sobre datos reales. Para tests de integración usar DATABASE_URL de una DB desechable migrada, ejecutar npm.cmd test -- --runInBand --testPathPatterns=reporting desde backend. E2E: npm.cmd run e2e -- e2e/smoke/reports.spec.ts --project=chromium --workers=1 con frontend y backend locales arrancados. Los fixtures de E2E usan exclusivamente la cuenta de pruebas ya definida en e2e/fixtures/auth.ts.

# Final git diff summary

73 archivos nuevos y 26 modificados; sin borrados, commits, cambios en manifests/lockfiles ni RAG. El inventario anterior incluye tests/documentación/plan. git diff --stat no incluye por sí solo archivos sin seguimiento; se revisaron ambos grupos.
