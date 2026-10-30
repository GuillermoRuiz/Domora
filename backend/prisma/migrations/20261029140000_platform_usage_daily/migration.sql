-- CreateTable
CREATE TABLE "user_daily_activity" (
    "day" DATE NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "administrator_id" UUID,
    "modules" TEXT[],
    "requests" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_daily_activity_pkey" PRIMARY KEY ("day","user_id")
);

-- CreateIndex
CREATE INDEX "user_daily_activity_administrator_id_day_idx" ON "user_daily_activity"("administrator_id", "day");

-- CreateIndex
CREATE INDEX "user_daily_activity_day_idx" ON "user_daily_activity"("day");

-- AddForeignKey
ALTER TABLE "user_daily_activity" ADD CONSTRAINT "user_daily_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

