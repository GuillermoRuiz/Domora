# Centro de Informes — seguimiento

- [x] 1. Modelos, migración, scope, catálogo y auditoría
- [x] 2. Sidebar, rutas, hub, categorías, selector y visor
- [x] 3. Informes ya soportados conectados
- [x] 4. Agregados y reglas de aging/identidad
- [x] 5. Presidentes, transiciones, contratos e issuedAt mantenibles
- [x] 6. Junta, ejecutivo mensual y 347 borrador
- [x] 7. Prisma/builds/tests/tenant/exports/E2E/temas/responsive/diff ejecutados; límites ambientales registrados

Cada casilla solo se cierra con evidencia. Los fallos y limitaciones se registran en docs/reporting.md y en la entrega final.

Evidencia de la validación inicial: 72 migraciones consecutivas aplicadas en una DB nueva desechable;
Prisma validate y generate aislado PASS; typechecks y builds PASS; 17 suites
backend / 106 tests PASS; 11 archivos frontend / 169 tests PASS; 4 E2E Chromium
escritorio y móvil PASS; consultas y ambos exports de los 47 informes PASS.
Capturas dark/light en 1440/900/640/320 revisadas. git diff --check PASS.

La generación Prisma estándar encuentra EPERM por la DLL cargada por la API
anterior; se verificó generación equivalente sin detenerla. No se declara
validada la suite previa receipts-posting en PostgreSQL nativo: su ejecución
PGlite tuvo cuatro fallos de transporte en errores esperados de constraints.
No se modificó ni migró la DB habitual del usuario. Ver docs/reporting.md.

Verificación local posterior completada: 75 migraciones aplicadas y tres alias
históricos reconciliados y documentados; datos existentes conservados. Prisma
generate y builds estándar PASS. PostgreSQL nativo: 18 suites / 126 tests PASS,
incluidos los 20 tests de recibos. Frontend relevante: 47 tests PASS. Playwright:
5 tests PASS después de las migraciones finales. Recorrido real de Carlos:
10 informes, 16 descargas y aislamiento entre administradores verificado.
Esta verificación posterior sustituye las limitaciones ambientales anteriores.
Detalles: docs/reporting-local-verification.md.

# PR review follow-up — 17/10/2026

- [x] Preserve original branch and pending community-header work with recovery copy.
- [x] Reproduce and fix the AI function/trigger and enum deployment failures.
- [x] Verify full migration replay, populated legacy cases and five-table tenant isolation.
- [x] Verify Reports build, 1545 frontend tests and 92 backend/domain tests.
- [x] Reconstruct and verify Dropdowns, Menu and Operations on their explicit parents.
- [x] Publish the four scoped PRs and document merge order (#19 → #20 → #21 → #22; #17 retained as draft).


## Juntas e Incidencias globales (2026-10-17)

- [x] Listados globales con ámbito, paginación e indicadores reales.
- [x] Vistas de Juntas e Incidencias según las referencias.
- [x] Navegación lateral y compatibilidad de enlaces antiguos.
- [x] Unitarios, builds y verificación visual responsive.

Validación: 5 pruebas backend y 209 frontend aprobadas; 13 recorridos Chromium aprobados, incluidos roles A/C, Fincas, formularios y enlaces históricos. Builds backend y frontend correctos. Capturas claro/oscuro en 1440 y 320; comprobación de desbordamiento también en 640 y 900. Revisión sin hallazgos Required/Critical pendientes. Ver docs/operations-workspaces.md para límites y evidencias.

## Selector de comunidades en Informes y Tareas (2026-10-17)

- [x] Selector contextual en el header de centro, categorías y visor de Informes, y en Tareas.
- [x] Retirar filtros interiores duplicados y mantener ámbito al navegar o limpiar filtros.
- [x] Pruebas de consulta, selección y respuestas antiguas; PDF/Excel reales; revisión responsive y claro/oscuro.

Evidencias y decisiones: docs/community-header-scopes.md. Publicación autorizada en bru_sidemenu junto a la revisión de alineación del header.

## Altura común y alineación del header (2026-10-17)

- [x] Unificar alturas por ancho de pantalla en todos los roles y secciones, incluida Contabilidad.
- [x] Alinear el borde del logo con el header, también con avisos de suscripción.
- [x] Verificar 117 pantallas y variantes en seis anchos y dos temas: 1410 mediciones, diferencia máxima 0 px.
- [x] Build, 1608 tests frontend, cobertura de desplegables y cinco recorridos Chromium aprobados.
- [x] Revisar el comentario de PR #17 y documentar la separación en PR #19–22 y las correcciones de migraciones.

Evidencias y explicación: docs/header-alignment.md. Commit y push autorizados en bru_sidemenu.

## Aspecto común de headers e iconos (2026-10-17)

- [x] Compartir el estilo de Fincas entre los seis tipos de selector del header.
- [x] Comprobar iconos, colores, tipografía, borde, flecha y espaciados en todos los roles y subsecciones.
- [x] Abrir desde la flecha con ratón/toque y probar teclado/Escape en cada implementación.
- [x] Build, 1608 tests, cobertura de desplegables y recorridos Chromium aprobados; capturas comparadas.

117 pantallas y variantes, 1410 mediciones sin diferencias de alineación. Evidencias en docs/header-alignment.md. Commit y push autorizados por el usuario en bru_sidemenu.

## Títulos, subtítulos y acciones de página (2026-10-17)

- [x] Tomar Juntas como referencia: título 28 px y subtítulo 14 px.
- [x] Unificar el origen del título y el subtítulo, y la posición de la acción principal en los tres roles.
- [x] Incluir las acciones de las subsecciones de finca/contabilidad, conservando contexto, disabled y handlers.
- [x] Verificar 117 pantallas y variantes, seis anchos y dos temas; ocho formularios de subsección y los de Juntas/Incidencias.
- [x] Build, 158 suites / 1611 tests frontend y cobertura de desplegables aprobados; revisión sin Required/Critical.

Evidencias y decisiones: docs/page-introductions.md. Commit y push autorizados por el usuario en bru_sidemenu.

# Mensajes

- [x] Contrato de ámbito opcional y pruebas de acceso.
- [x] Selector exacto de `bru_sidemenu` en la cabecera.
- [x] Filtros, listado, hilo y editor adaptados a la referencia.
- [x] Domo, enlaces, envíos y errores verificados.
- [x] Adjuntos persistentes y descarga exclusiva para participantes.
- [x] Pruebas, compilación, revisión y push.
