-- CreateEnum
CREATE TYPE "CommunicationCategory" AS ENUM ('General', 'Urgente', 'Mercadillo', 'ObjetosPerdidos', 'Evento');

-- AlterTable
ALTER TABLE "communications" ADD COLUMN     "category" "CommunicationCategory" NOT NULL DEFAULT 'General',
ADD COLUMN     "is_legal_notice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legal_notice_countersigned_by_president" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legal_notice_reason" VARCHAR(500),
ADD COLUMN     "legal_notice_signer_name" VARCHAR(200),
ADD COLUMN     "legal_notice_signer_role" "MeetingSignerRole",
ADD COLUMN     "pinned_at" TIMESTAMPTZ,
ADD COLUMN     "target_property_id" UUID;

-- CreateTable
CREATE TABLE "communication_replies" (
    "id" UUID NOT NULL,
    "communication_id" UUID NOT NULL,
    "author_user_id" UUID,
    "role" "TimelineAuthorRole" NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "communication_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_attachments" (
    "id" UUID NOT NULL,
    "communication_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "s3_key" VARCHAR(500) NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "communication_replies_communication_id_created_at_idx" ON "communication_replies"("communication_id", "created_at");

-- CreateIndex
CREATE INDEX "communications_target_property_id_idx" ON "communications"("target_property_id");

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_target_property_id_fkey" FOREIGN KEY ("target_property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_replies" ADD CONSTRAINT "communication_replies_communication_id_fkey" FOREIGN KEY ("communication_id") REFERENCES "communications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_replies" ADD CONSTRAINT "communication_replies_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_attachments" ADD CONSTRAINT "communication_attachments_communication_id_fkey" FOREIGN KEY ("communication_id") REFERENCES "communications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
