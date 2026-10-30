-- Convocatoria editable de la junta: texto que la gestora revisa al crearla. Nullable: las juntas anteriores
-- siguen generando la convocatoria habitual a partir de sus datos.
ALTER TABLE "meetings" ADD COLUMN "convocatoria_doc" JSONB;
