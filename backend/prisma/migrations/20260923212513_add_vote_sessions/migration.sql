-- CreateEnum
CREATE TYPE "VoteMajorityType" AS ENUM ('unanimidad', 'tresQuintos', 'mayoriaSimple');

-- CreateEnum
CREATE TYPE "VoteSessionStatus" AS ENUM ('abierta', 'cerrada');

-- CreateTable
CREATE TABLE "vote_sessions" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "agenda_item_id" VARCHAR(100) NOT NULL,
    "question_index" INTEGER NOT NULL,
    "majority_type" "VoteMajorityType" NOT NULL,
    "status" "VoteSessionStatus" NOT NULL DEFAULT 'abierta',
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by_user_id" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ,
    "closed_by_user_id" UUID,
    "require_2fa" BOOLEAN NOT NULL DEFAULT false,
    "result_summary" JSONB,

    CONSTRAINT "vote_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vote_responses" (
    "id" UUID NOT NULL,
    "vote_session_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "option_index" INTEGER,
    "option_indexes" INTEGER[],
    "cast_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vote_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vote_sessions_meeting_id_idx" ON "vote_sessions"("meeting_id");

-- CreateIndex
CREATE UNIQUE INDEX "vote_sessions_meeting_id_agenda_item_id_question_index_key" ON "vote_sessions"("meeting_id", "agenda_item_id", "question_index");

-- CreateIndex
CREATE INDEX "vote_responses_vote_session_id_idx" ON "vote_responses"("vote_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "vote_responses_vote_session_id_property_id_key" ON "vote_responses"("vote_session_id", "property_id");

-- AddForeignKey
ALTER TABLE "vote_sessions" ADD CONSTRAINT "vote_sessions_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_sessions" ADD CONSTRAINT "vote_sessions_opened_by_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_sessions" ADD CONSTRAINT "vote_sessions_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_responses" ADD CONSTRAINT "vote_responses_vote_session_id_fkey" FOREIGN KEY ("vote_session_id") REFERENCES "vote_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_responses" ADD CONSTRAINT "vote_responses_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vote_responses" ADD CONSTRAINT "vote_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
