-- Tarea "Legal pages & consent" (ID 32 del MVP Tracker). Registra el momento
-- en que el usuario aceptó Términos y Condiciones + Política de Privacidad al
-- crear su cuenta (registro, alta por invitación de admin o de equipo).
-- Nullable: las cuentas creadas antes de esta migración no tienen fecha, y
-- eso es correcto — no se puede fabricar un consentimiento retroactivo.
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" TIMESTAMPTZ;
