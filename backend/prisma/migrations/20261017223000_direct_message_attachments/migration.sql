CREATE TABLE "direct_message_attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "size_bytes" INTEGER NOT NULL CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760),
    "s3_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "direct_message_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "direct_message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "direct_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "direct_message_attachments_message_id_idx" ON "direct_message_attachments"("message_id");
