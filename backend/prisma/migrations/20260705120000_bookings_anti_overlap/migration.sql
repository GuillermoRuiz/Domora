-- Fase 8 (Amenities/Reservas): constraint anti-solapamiento real.
--
-- El plan original (doc/plan.md, DDL §3) proponía un índice único parcial
-- sobre (amenity_id, date, start_slot), pero eso solo bloquea dos reservas
-- con el MISMO slot inicial — no un solape de rangos (10-12 vs 11-13).
-- La pieza correcta es una exclusion constraint GiST sobre el rango
-- horario: dos reservas no canceladas del mismo amenity y día no pueden
-- tener rangos [start, end) que se intersequen.
--
-- btree_gist permite mezclar igualdad (uuid, date) con rangos en el mismo
-- índice GiST. Los slots son VarChar 'HH:00', de ahí la expresión
-- split_part(...)::int (inmutable, válida en exclusion constraints).

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
  ADD CONSTRAINT "chk_booking_slots" CHECK (
    split_part("end_slot", ':', 1)::int > split_part("start_slot", ':', 1)::int
  );

ALTER TABLE "bookings"
  ADD CONSTRAINT "excl_bookings_no_overlap" EXCLUDE USING gist (
    "amenity_id" WITH =,
    "date" WITH =,
    int4range(
      split_part("start_slot", ':', 1)::int,
      split_part("end_slot", ':', 1)::int
    ) WITH &&
  ) WHERE (status <> 'cancelled');
