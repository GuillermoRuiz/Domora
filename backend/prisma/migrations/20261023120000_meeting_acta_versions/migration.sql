-- Histórico de versiones del texto del acta, guardadas a mano por la gestora.
CREATE TABLE "meeting_acta_versions" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "general_comments" TEXT,
    "next_steps" TEXT,
    "point_comments" JSONB NOT NULL,
    "saved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_acta_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meeting_acta_versions_meeting_id_version_number_key" ON "meeting_acta_versions"("meeting_id", "version_number");

ALTER TABLE "meeting_acta_versions" ADD CONSTRAINT "meeting_acta_versions_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_acta_versions" ADD CONSTRAINT "meeting_acta_versions_saved_by_user_id_fkey" FOREIGN KEY ("saved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
