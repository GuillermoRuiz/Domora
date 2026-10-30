# Entitlements: retirados

> Estado: **no existe ninguna capacidad por gestora.** El único entitlement que hubo, `incident_ai` (Incidencias con IA), se
> retiró junto con la automatización de Incidencias. Con él se eliminaron `FeatureEntitlementService`, los endpoints
> `/admins/:id/features/*` y `/estates/:id/features`, el catálogo `PLAN_FEATURE_DEFAULTS` y la tabla `administrator_features`
> (migración `20261106110000_remove_incident_automation`).

## Qué queda

| | Qué es | Dónde vive |
|---|---|---|
| **Plan** | El paquete comercial: `BASE`/`STANDARD`/`PREMIUM` en código = **Start / Pro / Scale** | `Administrator.plan`, Stripe |
| **Infraestructura de IA** | ¿Puede esta instalación usar IA? (Contabilidad, Juntas, Asistente) | `AI_ENABLED`, clave, región (`AiConfigService`) |

Incidencias es igual en todos los planes y no usa IA (ver `docs/issue-workflow.md`). La IA que sigue viva (facturas y
conciliación, redacción del acta, resumen semanal) depende solo de la infraestructura: no consulta ninguna capacidad por gestora.

## Si hiciera falta una capacidad por gestora

`administrator_features` era una tabla genérica (gestora + clave + `enabled` + origen + vigencia) con una única clave. Se borró
porque ningún consumidor la usaba; está en el historial de migraciones (`20261029100000_ai_result_retention_and_assigned_by_kind`)
y en `git` (`backend/src/entitlements/`) si se quiere recuperar el diseño. La lógica de negocio nunca debe comparar el plan
(`if plan === PREMIUM`): debería preguntar por una capacidad resuelta en un único servicio.
