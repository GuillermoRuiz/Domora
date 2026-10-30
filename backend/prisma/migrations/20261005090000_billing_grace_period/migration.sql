-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'billing';

-- AlterTable
ALTER TABLE "administrator_subscriptions" ADD COLUMN     "past_due_since" TIMESTAMPTZ;
