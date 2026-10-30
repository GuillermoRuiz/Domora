-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('ordinaria', 'extraordinaria');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('convocada', 'celebrada', 'cancelada');

-- CreateEnum
CREATE TYPE "MeetingConvokedBy" AS ENUM ('presidente', 'cuotas25', 'propietarios25', 'mandatoJudicial');

-- CreateEnum
CREATE TYPE "MeetingSignerRole" AS ENUM ('administrador', 'presidente', 'secretario');

-- CreateEnum
CREATE TYPE "MeetingAttendanceRole" AS ENUM ('attendee', 'admin');

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "type" "MeetingType" NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'convocada',
    "scheduled_at_1" TIMESTAMPTZ NOT NULL,
    "scheduled_at_2" TIMESTAMPTZ NOT NULL,
    "agenda" JSONB NOT NULL,
    "convoked_by" "MeetingConvokedBy" NOT NULL,
    "location" VARCHAR(255),
    "location_place_id" VARCHAR(200),
    "location_lat" DOUBLE PRECISION,
    "location_lng" DOUBLE PRECISION,
    "signer_role" "MeetingSignerRole" NOT NULL,
    "signer_name" VARCHAR(200),
    "attendee_emails" TEXT[],
    "include_jitsi" BOOLEAN NOT NULL DEFAULT false,
    "jitsi_room_name" VARCHAR(80),
    "jitsi_access_password" VARCHAR(20),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_state" (
    "meeting_id" UUID NOT NULL,
    "admin_ready" BOOLEAN NOT NULL DEFAULT false,
    "admin_last_seen_at" TIMESTAMPTZ,
    "scheduled_start_at" TIMESTAMPTZ,
    "announcement" VARCHAR(255),
    "announcement_set_at" TIMESTAMPTZ,
    "redirect_requested_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "meeting_state_pkey" PRIMARY KEY ("meeting_id")
);

-- CreateTable
CREATE TABLE "meeting_attendance" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "role" "MeetingAttendanceRole" NOT NULL DEFAULT 'attendee',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_chat_messages" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "sender_name" VARCHAR(200) NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_presence" (
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "username" VARCHAR(150) NOT NULL,
    "building" VARCHAR(150),
    "unit" VARCHAR(50),
    "floor" VARCHAR(20),
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_presence_pkey" PRIMARY KEY ("meeting_id","user_id")
);

-- CreateTable
CREATE TABLE "meeting_attachments" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "s3_key" VARCHAR(500) NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_estate_id_idx" ON "meetings"("estate_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_attendance_meeting_id_user_id_key" ON "meeting_attendance"("meeting_id", "user_id");

-- CreateIndex
CREATE INDEX "meeting_attendance_meeting_id_idx" ON "meeting_attendance"("meeting_id");

-- CreateIndex
CREATE INDEX "meeting_chat_messages_meeting_id_sent_at_idx" ON "meeting_chat_messages"("meeting_id", "sent_at");

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_state" ADD CONSTRAINT "meeting_state_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attendance" ADD CONSTRAINT "meeting_attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_chat_messages" ADD CONSTRAINT "meeting_chat_messages_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_chat_messages" ADD CONSTRAINT "meeting_chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_presence" ADD CONSTRAINT "meeting_presence_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_presence" ADD CONSTRAINT "meeting_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_attachments" ADD CONSTRAINT "meeting_attachments_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
