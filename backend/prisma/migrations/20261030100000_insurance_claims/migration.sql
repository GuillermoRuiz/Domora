-- Siniestros de seguro de una incidencia (`InsuranceClaim`) y las dos columnas que los enlazan con lo que ya existía:
--  - `insurance_claims`: SOLO el expediente del seguro (aseguradora, póliza, nº de siniestro, estado). La próxima
--    actuación, las esperas, las visitas, el profesional enviado y las comunicaciones siguen en `agenda_tasks`,
--    `issue_waits`, `supplier_visits`, `issue_providers` y el historial.
--  - `issue_providers.claim_id`: siniestro por el que la aseguradora envió a ese profesional (nulo = lo asignó la comunidad).
--  - `supplier_visits.assignment_id`: la visita de un profesional externo (sin ser proveedor de la comunidad) se apoya en su
--    asignación; nombre y teléfono salen del snapshot de la asignación. Exactamente uno de `supplier_id` / `assignment_id`.
-- Todo es aditivo: no hay datos que migrar (las visitas existentes siguen con `supplier_id`).

CREATE TABLE "insurance_claims" (
  "id" UUID NOT NULL,
  "issue_id" UUID NOT NULL,
  "insurer_supplier_id" UUID,
  "insurer_name" VARCHAR(200) NOT NULL,
  "contract_id" UUID,
  "policy_number" VARCHAR(50),
  "reference" VARCHAR(100),
  "status" VARCHAR(20) NOT NULL DEFAULT 'open',
  "opened_at" TIMESTAMPTZ NOT NULL,
  "opened_by_kind" "ActorKind" NOT NULL DEFAULT 'person',
  "opened_by_user_id" UUID,
  "contact_name" VARCHAR(200),
  "contact_phone" VARCHAR(30),
  "closed_at" TIMESTAMPTZ,
  CONSTRAINT "insurance_claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "insurance_claims_issue_id_closed_at_idx" ON "insurance_claims"("issue_id", "closed_at");

-- Un mismo nº de siniestro no se repite para la MISMA aseguradora en la misma incidencia. Dos aseguradoras distintas sí
-- pueden usar la misma referencia. La identidad de la aseguradora es su proveedor del directorio o, si no lo hay, su
-- nombre normalizado. Sin referencia no hay restricción: puede haber varios siniestros abiertos de la misma aseguradora.
CREATE UNIQUE INDEX "insurance_claims_reference_key" ON "insurance_claims" (
  "issue_id",
  (COALESCE("insurer_supplier_id"::text, 'name:' || lower(btrim("insurer_name")))),
  (lower(btrim("reference")))
) WHERE "reference" IS NOT NULL;

ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_insurer_supplier_id_fkey" FOREIGN KEY ("insurer_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "supplier_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "issue_providers" ADD COLUMN "claim_id" UUID;
CREATE INDEX "issue_providers_claim_id_idx" ON "issue_providers"("claim_id");
ALTER TABLE "issue_providers" ADD CONSTRAINT "issue_providers_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_visits" ALTER COLUMN "supplier_id" DROP NOT NULL;
ALTER TABLE "supplier_visits" ADD COLUMN "assignment_id" UUID;
CREATE INDEX "supplier_visits_assignment_id_idx" ON "supplier_visits"("assignment_id");
-- La visita de un profesional externo muere con su asignación (solo ellas la usan); la de un proveedor del directorio
-- sigue dependiendo únicamente del proveedor.
ALTER TABLE "supplier_visits" ADD CONSTRAINT "supplier_visits_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "issue_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_visits" ADD CONSTRAINT "supplier_visits_one_party_check" CHECK (("supplier_id" IS NULL) <> ("assignment_id" IS NULL));
