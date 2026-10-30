# Domora RAG

> RAG v3 utiliza autorización firmada, PostgreSQL directo con roles separados y Blob.
> La documentación operativa vigente está en [docs/rag-audit](../docs/rag-audit/IMPLEMENTED_ARCHITECTURE.md).
> Las instrucciones Supabase/CLI/web de abajo describen el legacy, conservado para migración.
> CLI legacy requiere DOMORA_ALLOW_LEGACY=1 y environment=development; nunca producción.
> `serve` y `uvicorn domora_rag:create_app --factory` arrancan el API v3, sin web/debug públicos.

RAG multi-tenant para Domora usando:

- OpenAI para embeddings, reranking y respuesta grounded
- Supabase/Postgres + pgvector para almacenamiento y búsqueda
- PDFs como fuente documental
- Búsqueda híbrida: vectorial + full-text
- Filtro por `community_id`
- Máximo 3 llamadas a OpenAI por pregunta:
  1. embedding de la pregunta
  2. reranking
  3. respuesta final + auto-verificación

## 1. Instalar dependencias

```bash
pip install -r requirements.txt
```

## 2. Configurar Supabase

Abre:

Supabase > SQL Editor

y ejecuta el contenido de:

```text
supabase_setup.sql
```

Esto crea:

- `domora_rag_documents`
- `domora_rag_chunks`
- índices pgvector/HNSW
- full-text search
- función RPC `domora_hybrid_search`
- RLS y permisos de backend

## 3. Variables de entorno

Toda la configuración está en un único archivo, `.env`, junto a `domora_rag.py`.
El script lo lee automáticamente (no hace falta exportar nada). Las variables ya
definidas en el entorno tienen prioridad sobre el archivo.

Necesarias:

```text
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
DOMORA_CHAT_MODEL
DOMORA_RERANK_MODEL
```

El resto (búsqueda, coste, historial) son opcionales y están documentadas en el
propio `.env`.

No pongas `OPENAI_API_KEY` ni `SUPABASE_SERVICE_ROLE_KEY` en frontend o variables públicas,
y no subas `.env` a git.

## 4. Estructura recomendada de documentos

```text
/doc/
  global/
    ley_propiedad_horizontal.pdf
    codigo_civil.pdf

  communities/
    comunidad_123/
      estatutos.pdf
      acta_2026_03_20.pdf

    comunidad_456/
      estatutos.pdf
```

Los documentos de `global/` pueden utilizarse para todas las comunidades.

Los documentos de:

```text
communities/<community_id>/
```

solo se recuperan para esa comunidad.

## 5. Metadata opcional

Puedes añadir:

```text
/doc/metadata.csv
```

Ejemplo:

```csv
relative_path,title,doc_type,status,effective_date,community_id
global/ley_propiedad_horizontal.pdf,Ley de Propiedad Horizontal,law,effective,2025-04-03,global
communities/comunidad_123/estatutos.pdf,Estatutos,statutes,effective,2021-06-14,comunidad_123
```

Estados como:

```text
superseded
archived
draft
obsolete
revoked
repealed
inactive
```

se excluyen automáticamente del RAG.

## 6. Indexar PDFs

```bash
python domora_rag.py index --docs /doc
```

Para forzar reindexación:

```bash
python domora_rag.py index --docs /doc --force
```

## 7. Probar una pregunta

```bash
python domora_rag.py ask --community comunidad_123 "¿Puedo instalar aire acondicionado en la fachada?"
```

## 8. Chat en la terminal

```bash
python -X utf8 domora_rag.py chat --user mi_usuario
```

Mantiene la conversación (se guarda en Supabase). Solo responde sobre comunidades
de vecinos; otros temas se rechazan con un mensaje fijo.

## 9. Levantar como API y web

```bash
python domora_rag.py serve --host 0.0.0.0 --port 8000
```

Abre `http://127.0.0.1:8000` para el chat web (`web/index.html`).

Endpoints:

```text
POST /ask
GET  /conversations/{conversation_id}/messages?user_id=...&community_id=...
GET  /health
```

Body de `/ask`:

```json
{
  "question": "¿Puede la comunidad prohibir el alquiler turístico?",
  "community_id": "comunidad_123",
  "user_id": "usuario_42",
  "conversation_id": null
}
```

Con `user_id` se guarda la conversación y la respuesta trae un `conversation_id` para
las siguientes preguntas. Sin `user_id` la pregunta es independiente y no se guarda.

## Seguridad importante

En producción, NO confíes en `community_id` enviado directamente por el navegador.

El backend de Domora debe obtener la comunidad **y el `user_id`** del usuario autenticado y pasarlos
internamente al RAG. La página web incluida genera un `user_id` aleatorio y es solo para pruebas.

La `SUPABASE_SERVICE_ROLE_KEY` debe existir solamente en backend.

## Integración con la app de Domora

El RAG se usa desde la app de dos formas, siempre a través del backend NestJS
(`backend/src/assistant/`), nunca desde el navegador:

1. **Domora Intelligence** (panel de la ficha de la finca): canal `intelligence`,
   integrado como "Pregunta a Domora Intelligence" dentro del panel (ficha de finca, rol B).
2. **Domo, el agente de Domora**, fijo arriba de la lista en **Mensajes**: los
   usuarios le preguntan sobre su comunidad. Canal `domo`.

Cada canal tiene su propio historial (`user_id = <userId>:<canal>`) y el
`community_id` enviado al RAG es el id de la finca (`Estate.id`), siempre
validado contra las fincas del JWT. Los documentos de una comunidad se indexan
en `communities/<estateId>/`.

Las fuentes aparecen al final con `📚 Fuente:` o una lista bajo `📚 Fuentes`.
Las leyes, decretos y códigos citan los artículos utilizados, comprobados contra
los encabezados del documento indexado; los demás documentos conservan su página.
Si un artículo no se puede identificar, se cita la norma sin inventar un número.

Para activarlo:

```text
# rag/.env
DOMORA_RAG_INTERNAL_KEY=<clave larga aleatoria>

# backend/.env
RAG_API_URL=http://127.0.0.1:8000
RAG_INTERNAL_KEY=<la misma clave>
```

```bash
python domora_rag.py serve --host 127.0.0.1 --port 8000
```

Sin `RAG_API_URL` el backend responde 503 al asistente y el resto de la app
funciona con normalidad.

## Cuentas agregadas de la comunidad (Domo)

Además de los documentos, Domo responde sobre las cuentas de la comunidad. El
backend (`backend/src/assistant/community-finance.service.ts`) calcula un JSON
con cifras **agregadas** del ejercicio —gasto e ingresos por partida,
presupuesto, evolución de los últimos 30 días y saldo total— y lo envía al RAG en
el campo opcional `community_finance` de `/ask`. El RAG lo usa como contexto, no
lo guarda en la conversación y cita "cuentas agregadas de la comunidad".

Privacidad por construcción: solo se agrupa por cuenta contable (nunca por
vivienda, vecino, proveedor, recibo, factura ni concepto), se excluye el grupo 64
(gastos de personal, donde una partida podría ser el sueldo de una persona) y el
RAG tiene instrucciones de negarse a cualquier dato personal o individual.
