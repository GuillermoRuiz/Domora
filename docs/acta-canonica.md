# Acta canónica de las juntas

Una única fuente del contenido del acta, congelada y versionada. La vista previa, el PDF y el
`.docx` solo la **representan**; ninguno recalcula asistencia, votos, acuerdos ni resultados.

```
Meeting + asistencia + delegaciones + votaciones + comentarios
                       │  (ActaSnapshotService.capture — única lectura de datos vivos)
                       ▼
              ActaSourceSnapshot            ← JSON congelado en la versión
                       │  (buildActaDocument — función pura)
                       ▼
              ActaDocumentModel             ← JSON en la versión; NO es un modelo Prisma
              ┌────────┼───────────┐
              ▼        ▼           ▼
        Visor A4     PDF        .docx   (todos pintan el mismo modelo)
        (Angular)  (pdfkit)    (docx)
```

Código: `backend/src/meetings/acta/` · frontend: `src/app/features/operations/meeting-workspace/acta-viewer/`.

## Datos nuevos (migración `20261024120000_acta_canonical_versions`)

Todo es nullable o con valor por defecto: las juntas y actas anteriores no cambian y **no** se
reconstruyen snapshots que nunca existieron.

| Tabla | Campo | Para qué |
|---|---|---|
| `meetings` | `actual_start_at`, `actual_end_at` | Horas reales, **confirmadas por la gestora**. `celebrated_at` (instante de pulsar «celebrada») es solo una sugerencia para la de fin. |
| `meetings` | `effective_convocation` (`primera`/`segunda`) | Convocatoria en que se constituyó la junta. |
| `meeting_acta_versions` | `status`, `generated_at`, `source_snapshot`, `document_model`, `narrative`, `version_hash`, `pdf_s3_key`, `prepared_at` | Evoluciona el histórico de textos hacia versiones de acta reproducibles. |

`meeting_acta_versions` guarda **dos tipos de fila** con la misma numeración: las de solo textos
(botón «Guardar» de la pestaña Acta, `generated_at` null) y las de documento (`generated_at` no
null). `status`: `draft → readyForSignature → signed`; `superseded` cuando una versión posterior la
sustituye.

## Quórum

`MeetingQuorumService.computeQuorum` ya no usa `now()` para una junta cerrada. La convocatoria se
resuelve con `resolveConvocation`: (1) la indicada, (2) la confirmada, (3) junta convocada → por la
hora indicada o la actual, (4) junta cerrada sin confirmar → por `celebratedAt` (deducción; el
resultado lleva `convocatoriaSource`). El cálculo es la función pura `buildQuorum`, que también usa
el snapshot.

## Endpoints (`ActaController`, roles A/B)

| Método y ruta | Qué hace |
|---|---|
| `GET /meetings/:id/acta` | Versión actual (o `null`) y estado del acta heredada. **No crea versión.** |
| `GET /meetings/:id/acta/validation` | Errores, avisos y datos de la reunión que faltan. |
| `POST /meetings/:id/acta/generate` | Confirma los datos de la reunión y crea el borrador. Idempotente: si ya existe lo devuelve; `refresh` o datos confirmados distintos vuelven a congelar. 422 con la validación si faltan datos. |
| `PATCH /meetings/:id/acta` | Guarda ediciones de los bloques redactables (con `baseVersionId`) como versión nueva. |
| `POST /meetings/:id/acta/regenerate-narrative` | Vuelve a redactar las notas (recoge las que cambiaron); no toca los datos congelados. |
| `POST /meetings/:id/acta/prepare-for-signature` | Marca la versión `readyForSignature`, guarda su PDF y conserva su huella. **No firma.** |
| `GET /meetings/:id/acta.pdf[?version=]` | PDF de la versión (el guardado, o renderizado desde su modelo). |

Heredados sin cambios: `POST acta/sign`, `POST acta/send`, `GET acta.docx`, `GET/POST acta-versions`.

## Redacción

`ActaNarrativeService` reutiliza `OpenAiService` (nuevo `AiKind` `meeting-minutes`, prompt y esquema
en `ai/meeting-minutes.contract.ts`). La IA solo recibe título y notas de cada sección y devuelve
JSON validado; ninguna cifra, voto, fecha ni resultado pasa por ella. El texto devuelto se rechaza
si trae cifras que no estaban en las notas. Con la IA desactivada, caída o desviada, el acta se genera
igual con las notas de la gestora (mayúscula inicial y punto final, sin tocar palabras).

## Compatibilidad

- Actas ya firmadas con `actaS3Key`: siguen descargándose (`acta.docx`); `GET acta` indica
  `legacy.signed`. No se les crea snapshot.
- `signActa` (firma heredada): si hay versión canónica, el `.docx` sale de **su** modelo
  (`ActaDocxService.generateFromModel`) y la versión pasa a `signed`; si no, usa el generador
  heredado (`generate`, marcado `@deprecated`).

## Puntos de integración para la firma avanzada (fase posterior)

La firma debe apuntar a una `MeetingActaVersion` concreta: `id`, `version_hash` (SHA-256 del
`document_model` canónico), `pdf_s3_key` y `status = readyForSignature`. Hoy `signActa` solo marca
`signed`; la firma criptográfica, los firmantes y las evidencias se añadirán sobre esos campos.
