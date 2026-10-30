# Controles y evidencias

| Control | Implementación | Límite / evidencia |
|---|---|---|
| Identidad actual | RagAuthorizationService.current/resolveCurrent | Revalida Prisma en cada operación; permisos del JWT no autorizan RAG. Snapshot por request, no cancelación continua de revocaciones concurrentes. `deleteRagDocument` deriva `estateId` del registro Prisma en lugar de aceptarlo del cliente; documentos públicos globales sin registro Prisma solo los puede gestionar Rol A sin finca activa. |
| Scope firmado | security.verify_context; AssistantService.callRag | HMAC constante, TTL 60 s, nonce DB, método/path/body hash. Claves distintas por workload, TLS producción. |
| Tenant/comunidad/ACL | visible_documents/search_authorized | Scope en eligible MATERIALIZED antes de ranking. Estado/clasificación/versión/coherencia chunk obligatorios. Public solo publicación explícita con scope null. |
| Documentos app dirigidos/eliminados | authorized_document_ids + property IDs derivados DB | Ausencia/eliminación/destinatario actual de Prisma excluye fuentes app en nueva consulta/historial. Corpus operador depende ACL revisada. |
| Originales app | autorización compartida + assertDocumentKey/filePath | Upload/metadata/download/index validan permisos actuales; download niega orphan estateId=null; clave debe pertenecer a su comunidad. Tests usan directorios temporales, nunca limpian storage real. |
| Privilegios DB | migrations 001/002 | Query sin grants tablas; funciones SECURITY DEFINER con search_path fijo/owner separado. Ingestion CRUD corpus y INSERT auditoría; no historial. No login/secret creado por SQL. |
| Storage | paths derivados + verify_path; Blob privados | Query sin Blob role; ingestion contributor solo raw/processed/quarantine. Azure keys y public blobs deshabilitados en IaC. Red efectiva PENDING. |
| Validación | validate_pdf/parse_pdf/ClamAVScanner | Tamaño/ext/MIME magic + parser estricto, límites páginas/texto/chunks, antivirus fail-closed. Scanner/TLS/OCR externos PENDING. PDF complejo/DoS requiere validación de resource limits y sandbox de parsing. |
| Versionado | IngestionRepository.begin/activate | Locks/version monotónica, chunk coverage, transacción staging→active; anterior conservada tras fallo. |
| Historial | provenance independiente de citations | Fuentes completas/transitivas, no solo las elegidas por modelo; recheck antes de respuesta. Respuestas financieras se excluyen del contexto histórico. Legacy no expuesto por falta de procedencia. |
| Citas | build_context + marker/article validation | Metadata real document_id/version/page/section; no tools. Section null cuando no se identifica encabezado real. |
| Injection | instrucciones y datos separados; scope fuera LLM | Documentos/pregunta/historia no cambian permisos ni acceden a SQL/Blob/secrets. Calidad de redacción puede seguir afectada: no garantía de inmunidad semántica. |
| Secretos | providers.secret + DefaultAzureCredential; dos vaults | Producción exige Key Vault para claves/URLs secretas, nunca .env. Backend usa referencias plataforma. RBAC/login/network reales PENDING. |
| Finanzas | códigos + filtrado grupo64 | Totales excluyen personal, saldo null cuando hay personal; no etiquetas libres. No se afirma anonimización formal de todo agregado. |
| Minimización | minimization.py antes de embeddings/modelos | Redacta IBAN comunes, sk-keys, Bearer/JWT y conexiones PostgreSQL; no sustituye clasificación/DLP ni detecta todos los formatos personales/secretos. Raw conserva originales exactos. |
| Auditoría | telemetry.event + rag.audit + Nest Logger | IDs/actor/scope/correlation/status/tiempos, nunca prompts/chunks/documentos. Historial persiste contenido y requiere política propia de retención (PENDING). Logs de acceso Uvicorn desactivados en Docker. |
| Borrado | delete/retention CLI | Baja lógica inmediata; purge solo tras class+until explícitos. Retención desconocida bloquea purge. Versiones Blob vivas se eliminan, soft-delete/backups quedan storage_retention_pending. Metadata/audit tombstone retenidas según política PENDING. |

## Pruebas

`rag/test_security.py`: casos 1–4 y 6–8/10 del prompt mediante HTTP/contexto/ingesta, firma modificada, expiración, replay, binding, scanner inexistente, routes query sin ingesta. `rag/test_database_security.py`: fixtures reales tenant A/B, repository y API, ACL privada, borrado, versión parcial, permisos negativos SQL e historia revocada. Requiere DB aislada *_test y flag específico; CI usa pgvector y falla si una prueba real falla. Ninguna DB de app se usa para estas fixtures.

`backend/src/assistant/rag-authorization.service.spec.ts`: rol/tenant/membership actuales, JWT stale/forjado, comunidad ajena, revocación y denegación de ingesta. Tests existentes de puente y finanzas se conservan/adaptan al contrato firmado y privacidad. Resultado exacto de la última ejecución se registra en OPERATIONS; un skip de DB no se presenta como aislamiento probado sobre servidor real.

## Revisión adversarial

Primera revisión independiente (solo lectura) encontró siete riesgos del baseline. Acción: scope DB actual, ACL, versiones, eliminación fallback global, procedencia historia y agregados financieros. Segunda revisión de implementación encontró tres defectos: citas insuficientes para revocación transitoria/transitiva; CA PostgreSQL ausente; purga Blob con versionado incompleta. Se corrigieron guardando procedencia separada, raíces certifi/override y borrado de versiones vivas + estado retention_pending. URL Blob con slash final normalizada. Oferta entre modelos presentada al usuario; no se ejecutó CLI externa sin autorización. Esto no equivale a pentest ni auditoría de recursos Azure desplegados.

Tercera revisión focalizada del envelope/originales encontró descarga de huérfanos y permisos JWT antiguos en originales. Acción: original download/upload/alta de metadata reutilizan autorización actual; se deniega estateId=null y se valida origen de clave. No encontró otros defectos del envelope/body hash/GET→POST en lectura estática. Las fuentes sin scope se conservan en disco/legacy, pero no se exponen por asumir que sean públicas.

Cuarta revisión de la cadena de autorización completa (consulta y borrado) encontró tres defectos: (1) permiso `rag:publish:public` nunca incluido en ningún contexto — documentos `classification=public` eran indelebles por cualquier rol, incluido A; (2) `deleteRagDocument` aceptaba `estateId` del cliente como query param, permitiendo spoofing de comunidad aunque `can_manage` lo bloqueara como segunda línea; (3) mensaje de error unificado en `indexDocument` para dos condiciones distintas (tamaño excedido vs. formato no PDF). Acciones: `rag:publish:public` concedido a Rol A cuando opera sin finca activa (contexto global, único caso donde `tenant_id=null` tiene acceso a documentos `public`); `deleteRagDocument` consulta Prisma para derivar la finca real antes de firmar el contexto; se eliminó el parámetro `estateId` del endpoint; mensajes de error diferenciados. 27 tests backend verificados tras los cambios. Ninguna de las tres situaciones permitía acceso no autorizado a documentos privados: la cadena de defensa en capas (Prisma + `can_manage` + SQL) los bloqueaba en cualquier caso.

## Privilegios de workloads

| Workload | PostgreSQL read | PostgreSQL write | raw read | raw write | processed read | processed write | Key Vault | LLM | APIs externas |
|---|---|---|---|---|---|---|---|---|---|
| backend | Prisma: usuario/estate/memberships/documentos/finanzas | Funciones app existentes; no tablas vectoriales | No acceso Blob RAG | No | No | No | Solo signing secrets query/ingestion por scope secreto | Funciones AI app existentes, sin cambio | Solo APIs privadas RAG; integraciones app existentes sin ampliar |
| domo | No acceso directo; backend autorizado | No acceso directo | No | No | No | No | No | Mediante RAG/backend; nunca credenciales en navegador | Operación ask/history acotada; no SQL/blob arbitrarios |
| rag-query | Funciones corpus autorizado/historia | consume_nonce/save_messages controlados | No | No | No | No | Vault query (solo sus claves/proveedor) | Embeddings pregunta, rerank, respuesta | Proveedor elegido + KV/PG privados; no otras tools |
| rag-ingestion | Metadata/versiones/chunks propias del workload | Metadata/chunks/audit; no historial | Sí, container scope | Sí, container scope | Sí | Sí | Vault ingestion | Embeddings exclusivamente | Scanner privado; OCR solo provider aprobado PENDING |

Ingestion es un servicio técnico confiable con acceso corpus para procesar múltiples tenants; su API exige autorización tenant/doc. No se concede wildcard de Azure role assignment; las tres concesiones Blob son a containers concretos. La autorización por usuario no sustituye el aislamiento de red/workloads ni resuelve compromiso de backend/ingestion.

## Riesgos abiertos

**PENDING:** despliegue/red/RBAC efectivos, WAF/APIM/Firewall/rutas y backend connectivity; configuración/actualización scanner, OCR y sandbox/aislamiento de parsing; aprobación corpus public/ACL; retención legal/de backups/historial/logs; validación adicional en PostgreSQL nativo/CI/Azure; validación OpenAI/Azure modelos/coste/calidad; mapeo legacy/app y tratamiento de documentos personales/bancarios mediante política de minimización. El scope se transporta firmado en body para evitar el límite de headers; límites de body/contexto fallan cerrados sin truncar ACL. No se afirma clasificación automática ni DLP que elimine PII contenida en PDFs autorizados. .env y valores reales/deployed state **NO DETERMINADO**.

Referencias oficiales: [Blob con DefaultAzureCredential](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-upload-python), [Key Vault Python](https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-python), [pgvector](https://github.com/pgvector/pgvector), [PostgreSQL TLS](https://www.postgresql.org/docs/current/libpq-ssl.html), [Blob versioning y borrado](https://learn.microsoft.com/en-us/azure/storage/blobs/versioning-overview#versioning-on-delete-operations), [Entra PostgreSQL MI](https://learn.microsoft.com/en-us/azure/postgresql/security/security-connect-with-managed-identity).
