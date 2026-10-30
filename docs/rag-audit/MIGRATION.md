# Migración y despliegue

No se ejecutaron migrations sobre bases de datos reales. La migración es aditiva: conserva tablas Supabase legacy, archivos app y proveedor OpenAI. El backend y RAG v3 se deben desplegar coordinadamente: v3 rechaza solicitudes antiguas sin contexto firmado. No volver al API legacy para resolver un fallo de configuración.

## Decisiones/configuración que debe proporcionar el developer

- Tenant = Administrator.id propietario de cada Estate, comunidad = Estate.id, destinatarios desde Prisma. Corpus fuera de Prisma: mapping revisado por operador, sin fallback por carpeta/nombre.
- Región/RG/subscription, CIDRs libres para las ocho subredes, Entra admin real, SKU/storage PostgreSQL, ACR e imágenes reales. No hay IDs/endpoints inventados; usar outputs de deployment.
- Claves distintas query/ingestion, generadas de forma segura (>=32 caracteres); Key Vault separados. Modelos/deployments reales compatibles con Responses y embeddings 512. OpenAI actual default; Azure opcional.
- Scanner ClamAV privado detrás de TLS validado (host/port/CA reales). OCR provider **PENDING** si hay páginas escaneadas. No habilitar indexación aceptando scan inexistente.
- Política de publicación public/ACL, retention_class/retention_until y retención Azure/backup conforme a negocio. Ningún periodo legal fijado en código.
- Acceso privado del backend/runner/operador a VNet/DNS/Key Vault/PG; protección y retención de logs y exportaciones.

Variables Python: `DOMORA_ENVIRONMENT` development/test/production, `DOMORA_RAG_WORKLOAD` query/ingestion; `DOMORA_KEY_VAULT_URL`, `DOMORA_RAG_INTERNAL_KEY_SECRET_NAME`, `OPENAI_API_KEY_SECRET_NAME`; `AZURE_CLIENT_ID`; `DOMORA_PG_HOST/DOMORA_PG_DATABASE`, `DOMORA_QUERY_PG_USER` o `DOMORA_INGESTION_PG_USER`, opcional `DOMORA_PG_SSLROOTCERT`; alternativamente URLs DATABASE_URL independientes en Key Vault (development puede usar env). Ingestion añade `DOMORA_BLOB_ACCOUNT_URL`, scanner y CA. `DOMORA_LOCAL_STORAGE_DIR` solo development. `DOMORA_LLM_PROVIDER`, `DOMORA_CHAT_MODEL`, `DOMORA_RERANK_MODEL`, `DOMORA_EMBED_MODEL`, `DOMORA_EMBED_DIMENSIONS=512`, Azure endpoint/API version si se selecciona Azure. Ver `rag/.env.example`.

Backend: `RAG_API_URL`, `RAG_INTERNAL_KEY`, `RAG_INGESTION_API_URL`, `RAG_INGESTION_INTERNAL_KEY`. En producción keys mediante referencias Key Vault de Container Apps y MI backend, URLs HTTPS privadas. ConfigService actual consume env resuelto por plataforma, no se incrustan secretos en Bicep. Permitir al backend únicamente las dos signing secrets, no ambas bóvedas completas.

## Orden exacto

1. Ejecutar tests aislados (OPERATIONS), revisar manifiesto/scope, crear respaldo/export controlado del legacy. No colocar corpus o credenciales en logs/git.
2. Compilar `az bicep build --file infra/main.bicep` y `infra/rag-workloads.bicep`; preparar parameter files privados con valores reales. `az deployment group what-if --resource-group <RG_REAL> --template-file infra/rag.bicep --parameters @<FOUNDATION_PARAMETERS>` y revisar cambios. No ejecutar create sin validación de red/coste por operador.
3. Desplegar foundation con `az deployment group create --resource-group <RG_REAL> --template-file infra/rag.bicep --parameters @<FOUNDATION_PARAMETERS>`. Alternativa: main existente con enableRagFoundation=true y ragFoundation, sin alterar parámetros del despliegue anterior. Obtener outputs.
4. Desde runner privado con Entra admin, habilitar/pruebar vector. Ejecutar en DB RAG, no app: `psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f rag/migrations/001_authorized_rag.sql`, después `002_workload_roles.sql`. Vector debe estar en schema extensions; si ya existe en otra schema, **PENDING** adaptar referencias tras revisar, no mover extensión automáticamente. Cuenta migration owner permanente protegida: las funciones SECURITY DEFINER deben pertenecer a ese owner, nunca a query.
5. Provisionar principales Entra de ambas MI mediante `pgaadauth_create_principal_with_oid` como admin, usando nombres/object IDs de outputs y tipo service; después `GRANT domora_rag_query TO "<QUERY_PRINCIPAL_REAL>"`, `GRANT domora_rag_ingestion TO "<INGESTION_PRINCIPAL_REAL>"`. No conceder SUPERUSER/BYPASSRLS ni roles legacy service_role. Comprobar permisos negativos con SET ROLE.
6. Poner `rag-signing-key` distinta en cada Key Vault y `openai-api-key` por workload si OpenAI. Configurar RBAC secreto específico backend, MI y referencias Key Vault de Container Apps. Secrets se cargan desde equipo/runner privado autorizado, nunca en argumentos impresos. Rotación requiere restart de procesos por caché del cliente.
7. Build image: `docker build -t <ACR_REAL>/domora-rag:<TAG_REAL> rag`; push desde CI autorizado. Preparar workloads parameters con outputs foundation + imágenes/modelos/registro/scanner. Desplegar `infra/rag-workloads.bicep` mediante what-if/create. Query no recibe Blob ni credencial ingestion.
8. Configurar peering/DNS/rutas del backend a la VNet nueva o migrar su entorno a snet-app por un proyecto separado. RAG ILB no es accesible desde backend actual sin esa conectividad. Configurar Firewall/egress/NSG y comprobar que RAG, Blob/KV/PG no son públicos. No redirigir producción todavía.
9. Migrar corpus mediante manifiesto revisado (abajo). Validar scanner/estado indexed, fuentes, permisos y pruebas contra staging real. Conservar corpus anterior para trazabilidad.
10. Desplegar backend actualizado y configurar sus cuatro variables coordinadamente con RAG v3; smoke ask/historial/ingest/delete con usuarios A/B/C reales de staging. Monitorizar deny/latencias/fallos. Solo después redirigir producción.

Todos los `<...>` son placeholders, no comandos listos para ejecutar con IDs inventados. Credenciales/infra reales y despliegue son **PENDING**.

## Importar corpus existente y embeddings

`rag/manage.py` es herramienta administrativa con credencial ingestion, no ruta de usuario ni herramienta Domo. La identidad uploaded_by procede del manifiesto revisado: no es una sesión de usuario; restringir ejecución a operador de migración y auditar su identidad de plataforma externamente.

Manifiesto JSON: schema_version=1, reviewed=true y documents[] con file (relativo a root), document_id UUID opaco estable, uploaded_by UUID real, tenant_id/community_id UUID o null para publicación public, classification public/community/restricted, title, doc_type, checksum SHA256 real, acl `{community:boolean, roles:[], users:[], properties:[]}`. Añadir source_document_id si corresponde a un Document Prisma; nunca inventar ese mapping. Public requiere revisión de datos y flag explícito. Restricted no permite community=true. No publicar automáticamente PDFs de carpetas desconocidas.

Primero dry-run: `python rag/manage.py import --manifest <MANIFEST_REAL> --root <ORIGINALES_REAL>`. Luego, como workload ingestion y solo tras validar: añadir `--execute`; corpus public exige además `--publish-public`. Checksum/path/UUID se validan antes de escribir. Idempotencia checksum+tenant+community+ACL+source ID evita duplicar intentos; mismo filename no es identidad. Dos documentos app distintos conservan sus identidades para que revocar uno no afecte el permiso del otro. Un intento processing abandonado se recupera con `--reprocess`.

Embeddings legacy: export administrado JSON opcional por documento (`embedding_export` en manifiesto), con document_id/checksum/embedding_model/embedding_dimensions y chunks content/embedding. Reutilizar solo modelo y dimensión exactos, original checksum coincidente y texto exacto. Texto que cambie por normalización/chunking se reembebe. No copiar vectores de documentos no clasificados ni saltarse scan/parsing. La herramienta no genera una exportación masiva automática ni borra el sistema origen. Cambio de dimensiones/modelo requiere migración separada y evaluación de relevancia.

## Rollback

Mantener backup y legacy sin cambios. Antes de tráfico, revertir despliegue/config del backend conjuntamente con servicio correspondiente; nunca aceptar API legacy pública ni restituir alcance global implícito. Si falla una ingesta v3, la versión activa anterior sigue disponible; reprocess crea staging nuevo. Para retirar corpus v3, usar baja lógica scopeada, no DROP/TRUNCATE. Infra foundation es opt-in; deshabilitar módulo no destruye recursos ya creados con deployment incremental. Borrar recursos Azure requiere proceso externo de conservación/retención, no está automatizado aquí.

Antes del backend, revisar Document.s3Key: documentos válidos del upload estándar usan documents/estateId/archivo. Claves ajenas, paths no estándar y documentos sin estateId se bloquean; no se reasignan ni publican automáticamente. Recuperar huérfanos mediante operador y mapping aprobado. El borrado de RAG no borra originales adicionales en StorageService/disco de migración/git/exports; esas copias y su política de conservación siguen PENDING y deben incluirse en el proceso RGPD externo.
