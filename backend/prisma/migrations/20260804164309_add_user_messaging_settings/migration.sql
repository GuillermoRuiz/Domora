-- CreateTable
CREATE TABLE "user_messaging_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "allow_direct_messages" "DirectMessagePolicy" NOT NULL DEFAULT 'anyone_linked',
    "display_name_policy" "DisplayNamePolicy" NOT NULL DEFAULT 'full_name',
    "display_alias" VARCHAR(100),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_messaging_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_messaging_settings_user_id_key" ON "user_messaging_settings"("user_id");

-- AddForeignKey
ALTER TABLE "user_messaging_settings" ADD CONSTRAINT "user_messaging_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
