-- La gestora puede registrar el voto de quien está presente o representado: lo emite un
-- representante externo (sin cuenta) y consta quién lo registró.
ALTER TABLE "vote_responses"
  ALTER COLUMN "user_id" DROP NOT NULL,
  ADD COLUMN "voter_name" VARCHAR(200),
  ADD COLUMN "registered_by_user_id" UUID;

ALTER TABLE "vote_responses"
  ADD CONSTRAINT "vote_responses_registered_by_user_id_fkey"
  FOREIGN KEY ("registered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Todo voto identifica a quien lo emitió: una cuenta o, para un externo, su nombre.
ALTER TABLE "vote_responses"
  ADD CONSTRAINT "vote_responses_voter_check"
  CHECK ("user_id" IS NOT NULL OR "voter_name" IS NOT NULL);
