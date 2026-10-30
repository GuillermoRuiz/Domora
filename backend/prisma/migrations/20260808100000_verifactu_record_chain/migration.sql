-- Tipos de registro y estados de remisión (RD 1007/2023).
CREATE TYPE "VerifactuRecordType" AS ENUM ('alta', 'anulacion', 'subsanacion');
CREATE TYPE "VerifactuSubmissionState" AS ENUM ('pendiente', 'aceptado', 'aceptado_con_errores', 'rechazado');

-- Una factura anulada no se borra: su registro ya está en la cadena.
ALTER TYPE "AdminInvoiceStatus" ADD VALUE 'Anulada';

-- Cabeza de cadena, una por NIF de obligado tributario.
CREATE TABLE "verifactu_chain" (
    "issuer_tax_id" VARCHAR(20) NOT NULL,
    "last_seq"      INTEGER NOT NULL DEFAULT 0,
    "last_hash"     VARCHAR(64),
    CONSTRAINT "verifactu_chain_pkey" PRIMARY KEY ("issuer_tax_id")
);

CREATE TABLE "verifactu_records" (
    "id"               UUID NOT NULL,
    "issuer_tax_id"    VARCHAR(20) NOT NULL,
    "chain_seq"        INTEGER NOT NULL,
    "type"             "VerifactuRecordType" NOT NULL,
    "invoice_id"       UUID,
    "payload"          JSONB NOT NULL,
    "hash"             VARCHAR(64) NOT NULL,
    "previous_hash"    VARCHAR(64),
    "generated_at"     TIMESTAMPTZ NOT NULL,
    "submission_state" "VerifactuSubmissionState" NOT NULL DEFAULT 'pendiente',
    "aeat_csv"         VARCHAR(100),
    "aeat_response"    JSONB,
    "submitted_at"     TIMESTAMPTZ,
    "attempts"         INTEGER NOT NULL DEFAULT 0,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "verifactu_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "verifactu_records_issuer_tax_id_chain_seq_key" ON "verifactu_records"("issuer_tax_id","chain_seq");
CREATE UNIQUE INDEX "verifactu_records_issuer_tax_id_hash_key"      ON "verifactu_records"("issuer_tax_id","hash");
CREATE INDEX "verifactu_records_submission_state_idx" ON "verifactu_records"("submission_state");
CREATE INDEX "verifactu_records_invoice_id_idx"       ON "verifactu_records"("invoice_id");

-- Restrict, no Cascade: una factura con registro de facturación emitido no
-- puede borrarse. Si la operación se cancela, se anula; no se borra.
ALTER TABLE "verifactu_records"
    ADD CONSTRAINT "verifactu_records_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "admin_invoices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Inmutabilidad, garantizada por la base de datos ──────────────────────
--
-- La cadena solo vale si es infalsificable, y confiar en que ningún código
-- futuro haga un update o un delete no es una garantía. Se permite modificar
-- ÚNICAMENTE el seguimiento del envío (estado, CSV, respuesta, intentos):
-- eso es administración del envío, no el registro fiscal.
CREATE OR REPLACE FUNCTION verifactu_records_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Los registros de facturación no se pueden borrar (RD 1007/2023). Para dejar sin efecto una factura, emite un registro de anulación.';
    END IF;

    IF NEW."issuer_tax_id" IS DISTINCT FROM OLD."issuer_tax_id"
       OR NEW."chain_seq"     IS DISTINCT FROM OLD."chain_seq"
       OR NEW."type"          IS DISTINCT FROM OLD."type"
       OR NEW."invoice_id"    IS DISTINCT FROM OLD."invoice_id"
       OR NEW."payload"::text IS DISTINCT FROM OLD."payload"::text
       OR NEW."hash"          IS DISTINCT FROM OLD."hash"
       OR NEW."previous_hash" IS DISTINCT FROM OLD."previous_hash"
       OR NEW."generated_at"  IS DISTINCT FROM OLD."generated_at"
    THEN
        RAISE EXCEPTION 'Los campos fiscales y de encadenamiento de un registro de facturación son inmutables (RD 1007/2023). Solo puede actualizarse el seguimiento del envío.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "verifactu_records_immutable"
    BEFORE UPDATE OR DELETE ON "verifactu_records"
    FOR EACH ROW EXECUTE FUNCTION verifactu_records_guard();
