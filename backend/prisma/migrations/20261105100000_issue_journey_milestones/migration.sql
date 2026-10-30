-- CreateTable
CREATE TABLE "issue_journey_milestones" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "template_key" VARCHAR(40),
    "label" VARCHAR(120),
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "done_at" TIMESTAMPTZ,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_journey_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "issue_journey_milestones_issue_id_template_key_key" ON "issue_journey_milestones"("issue_id", "template_key");

-- CreateIndex
CREATE INDEX "issue_journey_milestones_issue_id_idx" ON "issue_journey_milestones"("issue_id");

-- AddForeignKey
ALTER TABLE "issue_journey_milestones" ADD CONSTRAINT "issue_journey_milestones_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
