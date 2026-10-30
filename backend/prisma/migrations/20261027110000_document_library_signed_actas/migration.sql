-- Actas firmadas antes de la biblioteca (odd/tasks/documentos-finca.md, T3):
-- entran en «Actas y juntas» como documento generado que apunta a su fichero.
-- D4: las ya enviadas a los vecinos quedan abiertas a los propietarios; el resto, «Solo gestora».
INSERT INTO "documents" (
    "id", "estate_id", "folder_id", "title", "type", "date", "size", "size_bytes", "mime_type", "s3_key",
    "source", "source_ref", "visibility", "effective_visibility", "created_at", "updated_at"
)
SELECT
    gen_random_uuid(), m."estate_id", f."id",
    left('Acta — ' || m."title", 255), 'Acta', m."scheduled_at_1"::date,
    CASE
        WHEN m."acta_origin" = 'uploaded' AND m."acta_upload_size_bytes" >= 1048576 THEN round(m."acta_upload_size_bytes" / 1048576.0, 1)::text || ' MB'
        WHEN m."acta_origin" = 'uploaded' AND m."acta_upload_size_bytes" IS NOT NULL THEN greatest(1, round(m."acta_upload_size_bytes" / 1024.0))::text || ' KB'
        ELSE '—'
    END,
    CASE WHEN m."acta_origin" = 'uploaded' THEN m."acta_upload_size_bytes" END,
    CASE WHEN m."acta_origin" = 'uploaded' THEN m."acta_upload_mime_type"
         ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' END,
    m."acta_s3_key",
    'generated', 'meeting:' || m."id",
    CASE WHEN m."acta_distributed_at" IS NOT NULL THEN 'OWNERS'::"DocumentVisibility" END,
    CASE WHEN m."acta_distributed_at" IS NOT NULL THEN 'OWNERS'::"DocumentVisibility" ELSE 'MANAGER'::"DocumentVisibility" END,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "meetings" m
JOIN "document_folders" f ON f."estate_id" = m."estate_id" AND f."system_key" = 'actas'
WHERE m."status" = 'firmada' AND m."acta_s3_key" IS NOT NULL
ON CONFLICT ("estate_id", "source_ref") WHERE "source_ref" IS NOT NULL DO NOTHING;
