-- A person holds at most one community office at a time (LPH art. 13):
-- no president who is also vice-president, no repeated vice-presidency.
-- Vice-presidents may be several; their order derives from appointment date.
-- Holder ids are logical references (no FKs, see estate_office_terms).
ALTER TABLE "estate_office_terms" ADD CONSTRAINT "estate_office_holder_no_overlap"
  EXCLUDE USING gist (
    estate_id WITH =,
    (COALESCE(user_id, external_owner_id)) WITH =,
    daterange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (user_id IS NOT NULL OR external_owner_id IS NOT NULL);
