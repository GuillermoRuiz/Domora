# Probar una incidencia de extremo a extremo en local

Incidencias es 100 % manual: no hay IA, correos automáticos ni simuladores. Este recorrido prueba el flujo completo con
`backend/scripts/local-preview.cjs` (la IA compartida de Contabilidad, Juntas y Asistente no interviene).

## Qué hay que levantar

1. **Base de datos** PGlite (puerto 55433) reiniciada, para que aplique las migraciones.
2. `cd backend && npm run build`.
3. **Backend**: `node scripts/local-preview.cjs`. Solo corre el barrido de incidencias (esperas vencidas, visitas pasadas,
   estancadas) y, si hay `OPENAI_API_KEY` real, el worker de IA compartido; el resto de cron siguen parados.
   `LOCAL_PREVIEW_AI_WORKER=false` apaga siempre el worker.

## Recorrido

1. Crea la incidencia desde el formulario (gestión o propietario). No se crea ningún job de IA; la incidencia queda sin vía y
   la ficha pide «Definir siguiente paso».
2. Decide la vía (`PUT /api/v1/issues/:id/resolution-route`, o «Cambiar vía» en la ficha): se abre la tarea humana de esa vía
   en `/b/tasks`.
3. Registra gestiones (`POST /api/v1/issues/:id/interactions`, ver `docs/issue-workflow.md`): esperas, visitas, siniestros,
   avisos al solicitante.
4. **Proveedor sin respuesta**: adelanta la espera en BD
   (`UPDATE issue_waits SET due_at = now() - interval '1 hour', due_handled_at = NULL WHERE ended_at IS NULL;`) y espera al
   barrido (cada 10 min) o ejecútalo ya con `node scripts/dev-sweep-now.cjs`: se abre la tarea «reclamar».
5. **Incidencia estancada**: sin tarea, espera ni visita y sin actividad pasado `ISSUE_STALLED_GRACE_MINUTES`, el barrido abre
   «sin siguiente paso».
6. Resolver y cerrar: `PATCH /api/v1/issues/:id/status`. Cerrar se rechaza con un siniestro abierto o un aviso al solicitante
   pendiente.

La situación y el siguiente paso salen de `GET /api/v1/issues/:id/situation` (`IssueSituationService`) y el recorrido de
`GET /api/v1/issues/:id/journey`.
