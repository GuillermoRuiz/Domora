# Operación y verificación

Usar exclusivamente backend autenticado o CLI administrativo con identidad ingestion. Domo no tiene comandos de administración ni herramientas de SQL/Blob.

## Documentos

1. Subir por endpoint app existente `POST /estates/:estateId/documents/upload` con sesión A/B. Los formatos/downloads existentes conservan comportamiento; no todos los uploads entran automáticamente al RAG.
2. Indexar explícitamente `POST /assistant/documents/<ID_REAL>/index` body `{}` con sesión actual A/B. Backend valida community/tenant/doc y carga original del StorageService, no path del navegador. Pipeline RAG conserva raw, valida/escanea, procesa y activa; revisar status indexed/quarantine/failed de respuesta. Endpoint ingestion es interno, no exponerlo al navegador.
3. Reprocesar: mismo endpoint body `{"reprocess":true}`; crea versión nueva y mantiene anterior hasta éxito. Idempotencia sin reprocess devuelve documento/versión existentes; si intento processing quedó abandonado, reprocess genera staging nuevo.
4. Corpus operador: dry-run/import `rag/manage.py` con manifiesto revisado, original checksum válido y credencial ingestion. No conservar credencial legacy admin en query. Reindexa solo datos aprobados, no remove_missing global.
5. Baja lógica: `DELETE /assistant/documents/<RAG_ID_REAL>/index` con sesión A/B (sin query param de finca; el backend lo deriva del registro Prisma). Documentos públicos globales sin registro Prisma requieren sesión A sin finca activa. No elimina el Document app ni rompe su descarga; excluye RAG inmediatamente. Eliminar Document app también lo excluye por fresh authorized_document_ids en consulta siguiente.
6. Retención/purga: añadir class/until proporcionados por política al manifiesto. `python rag/manage.py retention --manifest <MANIFEST> --root <ROOT>` primero dry-run, luego `--execute`; después `delete ... --execute --purge`. Public requiere además `--publish-public`. Retención desconocida/futura impide purge. Estado storage_retention_pending exige comprobar versiones soft-deleted/backups Azure antes de afirmar borrado definitivo. Los tombstones/audit y el historial necesitan política de borrado separada PENDING.

## Fallos y secretos

Sin ClamAV limpio, la ingesta queda quarantine/failed y nunca elegible. Con OCR_REQUIRED_PENDING, configurar un provider aprobado y reprocess; no aceptar página vacía como éxito. Fallo embeddings/DB/artifact conserva versión activa previa. Comprobar raw/quarantine y failure_code, correlation_id y auditoría; no pegar PDF/prompts/secrets en tickets/logs.

Rotar cada signing key en su Key Vault y referencia backend correspondiente conjuntamente; reiniciar workloads porque secrets están cacheados. Ventana sin coordinación produce 403 seguros. No reutilizar key query/ingestion. Rotar OpenAI/vault/RBAC por workload, revisar MI y logins PostgreSQL; preferir Entra para evitar password DB. No introducir .env producción.

GET privado `/health` solo informa liveness/workload, sin credenciales ni corpus. Readiness completa se prueba con query/ingest autorizado en staging, conectividad TLS/PG/Blob/KV y scanner; health por sí solo no prueba recursos disponibles.

## Telemetría

Eventos JSON `rag.queries`, `rag.retrieval`, `rag.indexing_started/completed/failed`, `rag.authorization.allowed/denied`, `rag.duplicates`, `rag.chunks`, `rag.provider_calls`, `rag.tokens`, `rag.errors`; latencia de query/retrieval, contadores y modelos reales. Tokens se registran únicamente si proveedor los devuelve, no estimaciones inventadas. Nest emite authorization/transport con IDs seguros. Log Analytics nativo recoge stdout/logs; no se añadió otra plataforma de observabilidad. Crear alertas/KQL/dashboard/rate limits de coste por actor externamente (**PENDING**).

Buscar por correlation_id para conectar decisión backend, retrieval, IDs de documentos usados y fallo/provider. Para investigar relevancia reproducir en staging con permisos actuales y originales controlados, no habilitar logs de prompts en producción. Los document IDs son audit fields, no labels de métricas de alta cardinalidad. Ajustar retención/acceso a logs fuera del código conforme a política.

## Pruebas y comandos

```powershell
python -m venv rag/.venv
.\rag\.venv\Scripts\python.exe -m pip install -r rag/requirements.txt
$env:DOMORA_ENVIRONMENT = 'test'
.\rag\.venv\Scripts\python.exe -m unittest discover -s rag -p 'test_*.py' -v
```

Base real aislada (Docker requerido, sin app volumes):

```powershell
docker compose -f rag/docker-compose.security-test.yml up -d --wait
$env:DOMORA_TEST_DATABASE_URL = 'postgresql://rag_test:disposable-test-password@localhost:55432/rag_security_test'
$env:DOMORA_RAG_ALLOW_TEST_SCHEMA = '1'
.\rag\.venv\Scripts\python.exe -m unittest discover -s rag -p 'test_*.py' -v
docker compose -f rag/docker-compose.security-test.yml down
```

La contraseña de fixture es ficticia, nunca producción. Tests se niegan a crear schema salvo DB *_test y flag; CI levanta pgvector limpio y ejecuta todos. Antes de go-live exigir tests sin skips y validar usuarios A/B en staging real vía API + repository; revisar un intento privado, deleted, versión parcial, MIME inconsistente y path manipulado.

Backend: desde backend `npx prisma generate`, `npx tsc -p tsconfig.json --noEmit`, `npm test -- --runInBand src/assistant`, `npm test -- --runInBand src/config/env.validation.spec.ts`; no prisma migrate/reset contra DB app. Windows requiere npm.cmd/npx.cmd si execution policy bloquea scripts. Si engine DLL está en uso, el comando generate puede fallar aunque actualice tipos; usar instalación de verificación aislada o reinicio coordinado del servidor dev, no matar procesos ajenos.

IaC compile: `az bicep build --file infra/main.bicep`, `infra/rag.bicep`, `infra/rag-workloads.bicep`. Un build correcto no verifica permisos, subnets, DNS ni que deployment vaya a funcionar: usar what-if y smoke privado.

## Evidencia de ejecución local

46 tests Python pasan sin skips usando PostgreSQL/pgvector WASM en memoria (PGlite, protocolo TCP local y psycopg). Incluyen diez pruebas de DB, API/repository, permisos SQL, procedencia revocada, PDF real parseado, deduplicación y fallo de una nueva versión. Sin DB configurada, las diez pruebas de DB se omiten explícitamente; CI/Docker ejecutan esas mismas fixtures contra PostgreSQL 16 nativo.

112 tests backend pasan sobre la base origin/main (assistant, env.validation, files y resources.service); TypeScript --noEmit correcto. Se preserva el bloqueo de servicios externos de DEMO_MODE y se extiende a las nuevas variables de ingesta RAG. Bicep main/foundation/workloads compilan sin errores; avisos de linter no impiden build. No se ejecutaron llamadas a modelos ni escrituras en bases de datos de aplicación/producción. Scanner/Blob/proveedor se sustituyeron por adaptadores de test; no se presenta esto como prueba de data-plane Azure ni validación de concurrencia de PostgreSQL nativo.

El helper PGlite estuvo en rag/.verification (gitignored), sin nueva dependencia de producción. Su protocolo usa un motor de sesión único; las conexiones admin de fixtures son independientes y reset role, no se aplica ese comportamiento a production. La validación adicional nativa y Azure sigue **PENDING**. Infraestructura desplegada, estado corpus real y políticas efectivas: **NO DETERMINADO**.
