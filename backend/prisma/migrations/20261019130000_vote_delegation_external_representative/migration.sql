-- Representante externo sin cuenta en Domora: se identifica por nombre + DNI.
ALTER TABLE "meeting_vote_delegations"
  ALTER COLUMN "representative_user_id" DROP NOT NULL,
  ADD COLUMN "representative_name" VARCHAR(200),
  ADD COLUMN "representative_dni" VARCHAR(20);

-- Cada delegación identifica a su representante: o una cuenta, o nombre + DNI.
ALTER TABLE "meeting_vote_delegations"
  ADD CONSTRAINT "meeting_vote_delegations_representative_check"
  CHECK ("representative_user_id" IS NOT NULL OR ("representative_name" IS NOT NULL AND "representative_dni" IS NOT NULL));
