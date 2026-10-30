-- Título de la entidad al vincularla, para mostrar el vínculo si la entidad desaparece. Los vínculos anteriores quedan en NULL
-- (se muestran como «Entidad eliminada» si falta la entidad); no se reconstruye ningún título histórico.
ALTER TABLE "agenda_task_links" ADD COLUMN "label" VARCHAR(200);
