-- Referencia de incidencia `#INC-AAAA-NNN` con contador atómico por año (antes: COUNT(*) + 1, que colisionaba con altas
-- simultáneas y, tras borrar una incidencia, con una referencia ya existente).
CREATE TABLE "issue_reference_counters" (
  "year" INTEGER NOT NULL,
  "last_value" INTEGER NOT NULL,
  CONSTRAINT "issue_reference_counters_pkey" PRIMARY KEY ("year"),
  CONSTRAINT "issue_reference_counters_last_value_chk" CHECK ("last_value" >= 0)
);

-- Se parte del mayor número ya usado en cada año (las referencias de incidencias borradas no se pueden recuperar).
INSERT INTO "issue_reference_counters" ("year", "last_value")
SELECT substring("ref" FROM 6 FOR 4)::integer, max(substring("ref" FROM 11)::integer)
FROM "issues"
WHERE "ref" ~ '^#INC-[0-9]{4}-[0-9]{1,9}$'
GROUP BY 1;
