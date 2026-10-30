-- CreateEnum
CREATE TYPE "DisplayNamePolicy" AS ENUM ('full_name', 'alias', 'address');

-- AlterTable
ALTER TABLE "property_membership_settings" ADD COLUMN     "display_alias" VARCHAR(100),
ADD COLUMN     "display_name_policy" "DisplayNamePolicy" NOT NULL DEFAULT 'full_name';

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_message_participants" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ,

    CONSTRAINT "direct_message_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "direct_message_participants_user_id_idx" ON "direct_message_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "direct_message_participants_conversation_id_user_id_key" ON "direct_message_participants"("conversation_id", "user_id");

-- CreateIndex
CREATE INDEX "direct_messages_conversation_id_created_at_idx" ON "direct_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "direct_message_participants" ADD CONSTRAINT "direct_message_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message_participants" ADD CONSTRAINT "direct_message_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
