-- CreateEnum
CREATE TYPE "MeetingAttendanceSource" AS ENUM ('jitsi', 'manual');

-- AlterTable: meeting_attendance gana property_id (el quorum se calcula por
-- vivienda, art. 16 LPH), source (jitsi vs pase de lista manual) y
-- marked_by_user_id (quien la marco en el pase de lista).
ALTER TABLE "meeting_attendance" ADD COLUMN     "property_id" UUID,
ADD COLUMN     "source" "MeetingAttendanceSource" NOT NULL DEFAULT 'jitsi',
ADD COLUMN     "marked_by_user_id" UUID;

-- Guardia de seguridad: property_id no puede rellenarse por backfill (las
-- filas existentes nunca registraron que propiedad representaba cada
-- asistencia) — si la tabla ya tiene datos reales, la migracion aborta en
-- vez de truncar en silencio. En desarrollo/test se espera 0 filas (el seed
-- nunca escribe en meeting_attendance).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "meeting_attendance" LIMIT 1) THEN
    RAISE EXCEPTION 'meeting_attendance tiene filas existentes sin property_id asignable — esta migracion no puede aplicarse a ciegas. Decide con el equipo si truncar la tabla (solo si es dev/test, sin valor real) o backfillear manualmente antes de continuar.';
  END IF;
END $$;

ALTER TABLE "meeting_attendance" ALTER COLUMN "property_id" SET NOT NULL;

-- DropIndex (unicidad antigua, por persona sin importar la propiedad)
DROP INDEX "meeting_attendance_meeting_id_user_id_key";

-- CreateIndex (nueva unicidad: una fila por junta+propiedad+persona)
CREATE UNIQUE INDEX "meeting_attendance_meeting_id_property_id_user_id_key" ON "meeting_attendance"("meeting_id", "property_id", "user_id");

-- CreateIndex
CREATE INDEX "meeting_attendance_meeting_id_property_id_idx" ON "meeting_attendance"("meeting_id", "property_id");

-- AddForeignKey
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_marked_by_user_id_fkey" FOREIGN KEY ("marked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: delegacion de voto para una junta y una propiedad concretas
-- (art. 15.1 LPH) — deliberadamente separada de user_representations
-- (representacion legal pesada, tutela/poder notarial, sin relacion con esto).
CREATE TABLE "meeting_vote_delegations" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "delegator_user_id" UUID NOT NULL,
    "representative_user_id" UUID NOT NULL,
    "document_s3_key" TEXT,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by_user_id" UUID,
    "revocation_reason" TEXT,

    CONSTRAINT "meeting_vote_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_vote_delegations_meeting_id_property_id_idx" ON "meeting_vote_delegations"("meeting_id", "property_id");

-- CreateIndex
CREATE INDEX "meeting_vote_delegations_representative_user_id_idx" ON "meeting_vote_delegations"("representative_user_id");

-- AddForeignKey
ALTER TABLE "meeting_vote_delegations" ADD CONSTRAINT "meeting_vote_delegations_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_vote_delegations" ADD CONSTRAINT "meeting_vote_delegations_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_vote_delegations" ADD CONSTRAINT "meeting_vote_delegations_delegator_user_id_fkey" FOREIGN KEY ("delegator_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_vote_delegations" ADD CONSTRAINT "meeting_vote_delegations_representative_user_id_fkey" FOREIGN KEY ("representative_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_vote_delegations" ADD CONSTRAINT "meeting_vote_delegations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_vote_delegations" ADD CONSTRAINT "meeting_vote_delegations_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
