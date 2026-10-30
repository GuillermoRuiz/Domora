-- Una visita puede ser de alguien que no es proveedor del directorio ni el profesional asignado a la incidencia (la que cuenta el
-- propietario, un tercero…): se guarda solo su nombre. Sigue habiendo exactamente un responsable: el proveedor, la asignación o ese nombre.
ALTER TABLE "supplier_visits" ADD COLUMN "visitor_label" VARCHAR(200);
ALTER TABLE "supplier_visits" DROP CONSTRAINT "supplier_visits_one_party_check";
ALTER TABLE "supplier_visits" ADD CONSTRAINT "supplier_visits_one_party_check" CHECK (
  (("supplier_id" IS NOT NULL)::int + ("assignment_id" IS NOT NULL)::int + ("visitor_label" IS NOT NULL)::int) = 1
);
