-- Owner issues: tickets are folded into issues (category, scope, location, reporter,
-- request-for-information status, withdrawal, rating, «Me afecta también», generic
-- attachments, internal timeline notes). There is no real data yet, so tickets are
-- dropped instead of migrated (user decision, odd/tasks/owner-issues.md S2).

-- CreateEnum
CREATE TYPE "IssueCategory" AS ENUM ('Incidencia', 'Solicitud', 'Consulta', 'Sugerencia');

-- CreateEnum
CREATE TYPE "IssueScope" AS ENUM ('Privada', 'Zona común');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IssueStatus" ADD VALUE 'Pendiente de información';
ALTER TYPE "IssueStatus" ADD VALUE 'Retirada';

-- Ticket notifications and preferences go with the tickets.
DELETE FROM "notifications" WHERE "category" = 'ticket';
DELETE FROM "user_notification_preferences" WHERE "category" = 'ticket';

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationCategory_new" AS ENUM ('adhesion', 'onboarding', 'issue', 'direct_message', 'inspection', 'meeting', 'communication', 'booking', 'receipt', 'billing', 'task', 'document');
ALTER TABLE "notifications" ALTER COLUMN "category" TYPE "NotificationCategory_new" USING ("category"::text::"NotificationCategory_new");
ALTER TABLE "user_notification_preferences" ALTER COLUMN "category" TYPE "NotificationCategory_new" USING ("category"::text::"NotificationCategory_new");
ALTER TYPE "NotificationCategory" RENAME TO "NotificationCategory_old";
ALTER TYPE "NotificationCategory_new" RENAME TO "NotificationCategory";
DROP TYPE "public"."NotificationCategory_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "ticket_timeline_entries" DROP CONSTRAINT "ticket_timeline_entries_author_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ticket_timeline_entries" DROP CONSTRAINT "ticket_timeline_entries_ticket_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_assigned_to_user_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_property_id_fkey";

-- AlterTable
ALTER TABLE "issue_photos" ADD COLUMN     "file_name" VARCHAR(255),
ADD COLUMN     "mime_type" VARCHAR(100),
ADD COLUMN     "size" INTEGER;

-- AlterTable
ALTER TABLE "issue_timeline_entries" ADD COLUMN     "internal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "issues" ADD COLUMN     "category" "IssueCategory" NOT NULL DEFAULT 'Incidencia',
ADD COLUMN     "location" VARCHAR(120),
ADD COLUMN     "rating" SMALLINT,
ADD COLUMN     "rating_comment" TEXT,
ADD COLUMN     "reporter_user_id" UUID,
ADD COLUMN     "scope" "IssueScope" NOT NULL DEFAULT 'Privada',
ADD COLUMN     "status_before_info_request" "IssueStatus",
ALTER COLUMN "type" SET DEFAULT 'Otro';

-- AlterTable
ALTER TABLE "property_membership_settings" DROP COLUMN "notify_tickets";

-- DropTable
DROP TABLE "ticket_timeline_entries";

-- DropTable
DROP TABLE "tickets";

-- DropEnum
DROP TYPE "TicketStatus";

-- DropEnum
DROP TYPE "TicketTimelineKind";

-- DropEnum
DROP TYPE "TicketType";

-- CreateTable
CREATE TABLE "issue_affected_users" (
    "issue_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_affected_users_pkey" PRIMARY KEY ("issue_id","user_id")
);

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_affected_users" ADD CONSTRAINT "issue_affected_users_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_affected_users" ADD CONSTRAINT "issue_affected_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
