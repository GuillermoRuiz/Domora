-- La ocurrencia resuelta de una serie recuerda su fin: editar la serie después no reescribe lo que ya ocurrió.
-- Las filas anteriores quedan en NULL (no se inventa un fin histórico): se completa al editar la serie.
ALTER TABLE "agenda_task_occurrences" ADD COLUMN "occurrence_end" TIMESTAMPTZ;
