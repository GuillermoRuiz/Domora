# Centro de Informes de Domora

## Revisión y separación del 17/10/2026

Preservar `bru_sidemenu` y sus cambios locales; corregir las migraciones señaladas
en PR 18 mediante pruebas reales en bases desechables. Separar Informes,
Dropdowns, Menú y Operaciones en PR apiladas, con su base y orden documentados
en `docs/pr-review-split.md`. Verificar cada base, publicar las nuevas ramas/PR
y comparar el árbol final con el original para detectar pérdidas.

## Alcance y decisiones

Implementar las siete fases de la solicitud del 15/10/2026 sobre Angular/Nest/Prisma existentes. Sin servicios cloud, dependencias nuevas, llamadas LLM ni datos ficticios de producción. Git limpio al comenzar. Los cambios quedan revisables sin commits automáticos.

La API transversal será GET /reports/catalog, GET /reports/estates, POST /reports/:reportKey/query y POST /reports/:reportKey/export. El scope se resuelve desde usuario y gestora actuales en DB en cada operación. IDs ajenos, inexistentes o mezclados producen 403. Los handlers reciben únicamente el scope ya autorizado. Se reutiliza DataAccessLog mediante ReportAuditService; metadata técnica acotada, sin contenidos ni PII.

Contrato de petición: scopeMode all|selected, estateIds opcionales, from/to inclusivos (YYYY-MM-DD), asOf, fiscalYear, compareFrom/compareTo y filtros tipados. Export añade format pdf|xlsx. Los informes contables que reutilizan motores individuales se limitan explícitamente a una comunidad; los informes de agregación admiten varias/todas. No se suman importes flotantes.

Resultado: metadata (reportKey/title/generatedAt/scope/period/currency/warnings/sensitivity), summary, sections compatibles con TableReport, rowCount. JSON y exports parten del mismo resultado. No se guardan archivos de exportación. Cambiar filtros invalida la posibilidad de exportar una vista anterior.

Datos legacy sin emisión/cierre/coste permanecen null. No se reconstruye deuda histórica desde outstanding actual: los cortes históricos deben usar diario o advertir/excluir datos sin trazabilidad. No hay saldo individual de reserva ni SLA inventado.

## Fases y aceptación

1. Fundamentos: migración aditiva y constraints; scope fresco; catálogo tipado; auditoría reutilizada. Verificar aislamiento y DTOs.
2. Navegación/UI: sidebar B, tres rutas lazy, hub por categorías, búsqueda, cards semánticas, selector multi y visor común. Verificar accesibilidad, errores y filtros.
3. Motores existentes: conectar ledger/budget/tax y listados sin duplicar reglas contables. Contrastar resultados con servicios actuales.
4. Agregados: periodos, cuenta semántica, aging, deuda/proveedor/incidencias. Verificar bordes de fecha, nulls, parciales y devoluciones.
5. Datos mantenibles: cargos históricos y UI en Finca, transiciones de incidencia y coste en contratos reales, issuedAt nuevo. Verificar concurrencia e historial.
6. Compuestos: junta, ejecutivo determinista y 347 borrador con límites visibles y exportados.
7. Verificación: Prisma generate, typecheck/builds, tests backend/frontend/tenant/exports, E2E local, temas y responsive, diff final. Registrar fallos previos aparte.

## Coordinación

Trabajo paralelo según la habilidad planning-and-task-breakdown: el agente domain posee schema/migración y cambios de datos/flujos existentes; el agente de handlers posee agregaciones no contables; el agente frontend posee exclusivamente la nueva feature Reports y su navegación. Root posee contratos, scope, auditoría, controller, renderer común, motores financieros, integración y verificaciones finales. No ejecutar migraciones/generación Prisma simultáneamente.

## Riesgos

- Resultados históricos: documentar fecha contable frente a fecha real de emisión y cambios posteriores.
- Reglas compartidas: extender servicios contables agregados, no copiar fórmulas a UI.
- Exportaciones grandes: límites explícitos con rechazo, nunca truncamiento silencioso.
- Legacy: advertencias de datos ausentes en preview y documento.
- Seguridad: mismo control fresco para catálogo, scope, consulta y exportación.

## Juntas e Incidencias globales (2026-10-17)

1. Añadir listados globales paginados y resúmenes con ámbito de gestora; probar aislamiento.
2. Crear vistas independientes con selector, indicadores, filtros, lista y detalle, reutilizando las acciones existentes.
3. Mover accesos al lateral B y retirar ambas pestañas de Fincas; preservar enlaces anteriores.
4. Verificar unitarios, builds y navegador en escritorio/móvil y claro/oscuro.

Contrato y decisiones: docs/operations-workspaces.md. No crear commits ni hacer push sin permiso explícito.

# Plan: rediseño de Mensajes

La referencia visual y la indicación de reutilizar el selector de `bru_sidemenu` son los requisitos autorizados por el usuario. Alcance y límites en `docs/messages-redesign.md`.

1. Probar e implementar el ámbito de comunidad en conversaciones y contactos. Verificar restricciones de acceso y compatibilidad sin filtro.
2. Reutilizar los archivos del selector de `bru_sidemenu`, crear filtros de bandeja y rediseñar lista, hilo y editor. Mantener Domo y enlaces de contacto.
3. Verificar los flujos de mensajes, respuestas tardías, errores, teclado y tamaños móviles. Compilar, revisar el diff, guardar y subir a `bru_messages`.

Cada paso conserva una aplicación compilable. No se integran cambios de navegación, informes, migraciones ni otras funciones de `bru_sidemenu`.
