-- Texto libre de la gestora para el acta: comentarios generales y próximos pasos.
ALTER TABLE "meetings"
  ADD COLUMN "acta_general_comments" TEXT,
  ADD COLUMN "acta_next_steps" TEXT;
