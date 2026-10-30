-- Biblioteca de documentos de la finca (odd/tasks/documentos-finca.md, T1).
-- Visibilidad por carpeta heredada, con excepción por documento; todo nace
-- «Solo gestora» (MANAGER). `effective_visibility` es la que leen las consultas.

CREATE TYPE "DocumentVisibility" AS ENUM ('MANAGER', 'BOARD', 'OWNERS', 'PROPERTY');
CREATE TYPE "DocumentSource" AS ENUM ('upload', 'generated');

CREATE TABLE "document_folders" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "visibility" "DocumentVisibility",
    "system_key" VARCHAR(40),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,
    CONSTRAINT "document_folders_pkey" PRIMARY KEY ("id"),
    -- «Una propiedad» es una visibilidad de documento, nunca de carpeta.
    CONSTRAINT "document_folders_visibility_not_property" CHECK ("visibility" IS DISTINCT FROM 'PROPERTY'),
    CONSTRAINT "document_folders_name_not_blank" CHECK (length(trim("name")) > 0),
    CONSTRAINT "document_folders_not_own_parent" CHECK ("parent_id" IS DISTINCT FROM "id")
);
CREATE INDEX "document_folders_estate_id_parent_id_idx" ON "document_folders"("estate_id", "parent_id");
CREATE UNIQUE INDEX "document_folders_estate_id_system_key_key" ON "document_folders"("estate_id", "system_key");
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "document_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "documents"
    ADD COLUMN "folder_id" UUID,
    ADD COLUMN "visibility" "DocumentVisibility",
    ADD COLUMN "effective_visibility" "DocumentVisibility" NOT NULL DEFAULT 'MANAGER',
    ADD COLUMN "mime_type" VARCHAR(100),
    ADD COLUMN "size_bytes" INTEGER,
    ADD COLUMN "uploaded_by_user_id" UUID,
    ADD COLUMN "source" "DocumentSource" NOT NULL DEFAULT 'upload',
    ADD COLUMN "source_ref" VARCHAR(100),
    ADD COLUMN "description" VARCHAR(500),
    ADD COLUMN "visibility_review_pending" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "deleted_at" TIMESTAMPTZ,
    ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- «Una propiedad» exige la propiedad destinataria.
    ADD CONSTRAINT "documents_property_visibility_has_target" CHECK (
        ("visibility" IS DISTINCT FROM 'PROPERTY' OR "target_property_id" IS NOT NULL)
        AND ("effective_visibility" <> 'PROPERTY' OR "target_property_id" IS NOT NULL)
    );
CREATE INDEX "documents_estate_id_folder_id_idx" ON "documents"("estate_id", "folder_id");
CREATE INDEX "documents_estate_id_effective_visibility_idx" ON "documents"("estate_id", "effective_visibility");
-- Un documento generado por origen y finca (idempotencia de p. ej. el acta firmada).
CREATE UNIQUE INDEX "documents_estate_id_source_ref_key" ON "documents"("estate_id", "source_ref") WHERE "source_ref" IS NOT NULL;
ALTER TABLE "documents" ADD CONSTRAINT "documents_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "document_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Datos existentes ──────────────────────────────────────────────────
-- Plantilla de carpetas (D3) en todas las fincas, todas «Solo gestora» (S7).
INSERT INTO "document_folders" ("id", "estate_id", "name", "visibility", "system_key", "sort_order", "updated_at")
SELECT gen_random_uuid(), e."id", t."name", 'MANAGER', t."key", t."ord", CURRENT_TIMESTAMP
FROM "estates" e
CROSS JOIN (VALUES
    ('legal', 'Documentación legal', 1),
    ('actas', 'Actas y juntas', 2),
    ('contabilidad', 'Contabilidad y presupuestos', 3),
    ('seguros', 'Seguros', 4),
    ('contratos', 'Contratos y mantenimiento', 5),
    ('certificados', 'Certificados e inspecciones', 6),
    ('interno', 'Interno de la gestora', 7)
) AS t("key", "name", "ord");

-- Reparto por tipo; el resto queda en la raíz de la biblioteca.
UPDATE "documents" d
SET "folder_id" = f."id"
FROM "document_folders" f
WHERE f."estate_id" = d."estate_id"
  AND f."system_key" = CASE
      WHEN d."type" IN ('Escritura de constitución', 'Estatutos', 'CIF de la comunidad') THEN 'legal'
      WHEN d."type" IN ('Acta') THEN 'actas'
      WHEN d."type" IN ('Presupuesto', 'IBI') THEN 'contabilidad'
      WHEN d."type" IN ('Póliza de seguro') THEN 'seguros'
      ELSE NULL
  END;

-- D5: lo dirigido a una propiedad se compartió de forma explícita y lo conserva (L4).
UPDATE "documents"
SET "visibility" = 'PROPERTY', "effective_visibility" = 'PROPERTY'
WHERE "target_property_id" IS NOT NULL;

-- D5: lo que antes veía cualquier propietario pasa a «Solo gestora» y queda pendiente de revisar.
UPDATE "documents"
SET "visibility_review_pending" = true
WHERE "target_property_id" IS NULL AND "estate_id" IS NOT NULL;
