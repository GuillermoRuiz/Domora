# Diferencias respecto al objetivo — antes de implementación

Base: `CURRENT_RAG_ARCHITECTURE.md`, commit `f7df326`. Clasificación: ✅ correcto, 🟡 parcial, 🔴 ausente, ⚠️ inseguro, ❓ no verificable. La tabla es histórica: no debe interpretarse como el estado después de implementar.

| Requisito | Estado previo | Evidencia / cambio requerido |
|---|---|---|
| PostgreSQL + pgvector | ✅ | supabase_setup.sql; conservar vectores y proveedor, agregar migración compatible. Flexible Server de la app existe en Bicep; despliegue RAG allí PENDING. |
| Autenticación app | ✅ | JWT guards y DTO estricto. |
| Scope previo a vector/ranking | 🟡 | eligible SQL ya filtra comunidad/estado; falta tenant, ACL, versión y scope document/chunk coherente. |
| Permisos actuales por usuario | ⚠️ | JWT stale; revalidar usuario, rol, gestora, memberships y documentos desde Prisma en AssistantService. |
| AuthorizationContext determinista | 🔴 | crear contrato firmado por backend; ni navegador ni Domo pueden fabricar scope. |
| ACL por documento | 🔴 | targetPropertyId app sin reflejo en RAG; scope debe incluir documentos autorizados y publicación explícita. |
| Tenant explícito | 🔴 | gestora existente Administrator.id como tenant, nunca nombre de comunidad. Selección rol A acotada a comunidad existente. |
| Global explícito | ⚠️ | detect_community_id fallback global; migración requiere declaración revisada de corpus público, no inferencia por ruta. |
| Azure Blob raw/processed/quarantine | 🔴 | disco local; adapter DefaultAzureCredential y Azure obligatorio producción. Originals exactos, paths server-generated. |
| Validación bytes/tamaño/ext/MIME | ⚠️ | solo MIME declarado en app y extensión en CLI. Validación PDF real y rechazo/quarantine. |
| Antivirus | 🔴 | adapter fail-closed y scanner externo PENDING; no simular escaneo positivo. |
| Parsing/OCR | 🟡 | pypdf existente; páginas sin texto requieren OCR configurado o quarantine, sin extracción parcial silenciosa. |
| Normalización/chunking/embeddings | 🟡 | existente; conservar, validar cobertura/longitudes/dimensiones y límites. |
| Estados durables | 🔴 | uploaded/validating/processing/indexed/quarantine/failed. |
| Metadata obligatoria | 🟡 | IDs/hash/page/title ya existen; tenant, clasificación, version, storage, procesamiento, retention/deletion faltan. |
| Duplicados por bytes/scope/ACL | ⚠️ | solo misma relative_path; checksum no basta sin aislamiento ACL. |
| Versionado atómico | 🔴 | staging y activar en una transacción; jamás sustituir actual antes de éxito. |
| Borrado auditable/retención | ⚠️ | remove_missing global; nueva baja lógica + purge controlado artifacts/chunks, sin prometer borrado backups. |
| Query/ingestion identidades separadas | 🔴 | service_role compartido; roles DB distintos y MI separadas. |
| Managed Identity/Key Vault | 🔴 | abstracciones e IaC; credenciales exteriores PENDING. |
| OpenAI actual preservado | ✅ | OpenAI Responses; adapter Azure opcional, no cambiar default. |
| LLM nunca autoriza / sin tools | ✅ | ninguna decisión ACL ni tool calling RAG; mantener enforcement fuera del prompt. |
| Contexto mínimo sin datos personales innecesarios | ⚠️ | finanzas grupo64 inferible y etiquetas libres; historia no reautoriza fuentes. |
| Prompt injection | 🟡 | instrucciones y citas verificadas; añadir pruebas que aseguren scope inmutable, sin afirmar inmunidad total del LLM. |
| Structured citations | 🟡 | citas metadata sin version/section; agregar manteniendo citations existente. |
| Correlation/audit logs seguros | 🔴 | añadir eventos JSON seguros integrables Log Analytics, sin contenido/prompts. |
| Métricas RAG | 🔴 | consulta/retrieval/ingest/deny/duplicados/chunks/proveedor/tokens/latencias, límites cardinalidad. |
| Red VNET / snet-rag | 🔴 | adaptar Bicep como módulo opt-in, sin tocar despliegue actual; WAF/APIM/Firewall routing decisiones externas. |
| Private endpoints/DNS Blob/KV/PG/AzureOpenAI | 🔴 | crear IaC privado donde corresponda, topología/data-plane PENDING. |
| API RAG no pública | ❓ | clave API fail-closed sí; no plantilla RAG y red real NO DETERMINADO. |
| development/test/production | 🟡 | Bicep test/prod; configuración RAG separada, dev local explícito. |
| SAS mínima | 🔴 | no upload directo frontend existente; preferir backend streaming, no introducir SAS sin necesidad. |
| Origen de archivos ligado a comunidad / huérfanos | ⚠️ | DTO legacy acepta s3Key; startsWith root y descargas estateId=null son insuficientes. Validar clave/directorio y permisos actuales antes de upload/create/download/index. |
| Diez tests seguridad API/repository/DB | 🔴 | agregar fixtures aisladas y CI pgvector; nunca ejecutar contra DB de usuario. |
| Migración idempotente/rollback | 🔴 | conservar legacy; importer con manifest revisado, dry run, no deletes ni trust implícito. |
| RGPD retention_until/class/deletion | 🔴 | capacidad técnica, sin plazos legales inventados. |
| Permisos Azure efectivos / backups / scanner | ❓ | NO DETERMINADO; validación externa PENDING. |

## Decisiones previas a cambios

1. Conservar respuestas/citas, reranking, finanzas permitidas y proveedor OpenAI. Mantener corpus antiguo sin borrarlo; la ruta segura no consulta registros sin scope revisado.
2. Nueva capa de autorización consulta Prisma en cada operación; comunidad solicitada es selector validado, no autoridad. No cambiar globalmente autenticación de otros módulos.
3. PostgreSQL existente sigue siendo el motor; un repository directo permite roles query/ingestion sin depender de Supabase service role. Migración SQL separada/aditiva; sin ejecutar sobre datos reales.
4. Reusar parsing/chunking/generación, separar storage, provider, repository, API e ingesta. Acceso global requiere publicación explícita y revisada; historial legacy sin referencias verificables se oculta por seguridad, no se borra.
5. Toda dependencia externa no configurada queda PENDING y falla cerrada. IaC se prepara, no se presenta como desplegado. No se inventan IDs de Azure ni periodos legales.
