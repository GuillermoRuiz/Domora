-- Contador de numeración por serie y ejercicio. Sustituye al count() de
-- filas, que ni es atómico ni sobrevive a un borrado sin dejar huecos.
CREATE TABLE "invoice_series" (
    "series" VARCHAR(10) NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "invoice_series_pkey" PRIMARY KEY ("series","year")
);

-- Desglose fiscal, snapshot del destinatario y trazabilidad de la serie.
-- Las columnas se crean con DEFAULT para poder aplicarse sobre tablas con
-- datos; los defaults de las que no admiten valor vacío se retiran después.
ALTER TABLE "admin_invoices"
    ADD COLUMN "series"            VARCHAR(10)   NOT NULL DEFAULT 'DOM',
    ADD COLUMN "fiscal_year"       INTEGER       NOT NULL DEFAULT 0,
    ADD COLUMN "sequence"          INTEGER       NOT NULL DEFAULT 0,
    ADD COLUMN "operation_date"    DATE          NOT NULL DEFAULT CURRENT_DATE,
    ADD COLUMN "concept"           VARCHAR(300)  NOT NULL DEFAULT '',
    ADD COLUMN "tax_base"          DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN "tax_rate"          DECIMAL(5,2)  NOT NULL DEFAULT 21,
    ADD COLUMN "tax_amount"        DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN "total"             DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN "recipient_name"    VARCHAR(200)  NOT NULL DEFAULT '',
    ADD COLUMN "recipient_tax_id"  VARCHAR(20)   NOT NULL DEFAULT '',
    ADD COLUMN "recipient_address" VARCHAR(255)  NOT NULL DEFAULT '';

-- Reconstruye el desglose de las facturas ya emitidas a partir del total
-- (base = total / 1,21) para no dejarlas a cero.
UPDATE "admin_invoices"
   SET "total"      = "amount",
       "tax_base"   = ROUND("amount" / 1.21, 2),
       "tax_amount" = "amount" - ROUND("amount" / 1.21, 2),
       "fiscal_year" = EXTRACT(YEAR FROM "issue_date")::INTEGER;

-- `amount` queda sustituida por `total` (base + cuota), sin duplicar dato.
ALTER TABLE "admin_invoices" DROP COLUMN "amount";

-- Los defaults eran solo para la migración: una factura nueva debe traer
-- estos valores explícitos, nunca heredar un 0 silencioso.
ALTER TABLE "admin_invoices"
    ALTER COLUMN "operation_date"    DROP DEFAULT,
    ALTER COLUMN "tax_base"          DROP DEFAULT,
    ALTER COLUMN "tax_amount"        DROP DEFAULT,
    ALTER COLUMN "total"             DROP DEFAULT,
    ALTER COLUMN "recipient_name"    DROP DEFAULT,
    ALTER COLUMN "recipient_tax_id"  DROP DEFAULT,
    ALTER COLUMN "recipient_address" DROP DEFAULT;

CREATE UNIQUE INDEX "admin_invoices_series_fiscal_year_sequence_key"
    ON "admin_invoices"("series","fiscal_year","sequence");
