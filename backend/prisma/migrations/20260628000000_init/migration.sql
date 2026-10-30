-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('BASE', 'STANDARD', 'PREMIUM');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('Activa', 'Periodo de gracia', 'Vencida', 'Bloqueada');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "EstateType" AS ENUM ('Edificio', 'Urbanización', 'Garaje', 'Trasteros', 'Local');

-- CreateTable
CREATE TABLE "administrators" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "cif" VARCHAR(20) NOT NULL,
    "plan" "PlanTier" NOT NULL,
    "tier" VARCHAR(20) NOT NULL,
    "end_date" DATE,
    "users_active" INTEGER NOT NULL DEFAULT 0,
    "users_max" INTEGER NOT NULL,
    "status" "AdminStatus" NOT NULL,
    "phone" VARCHAR(30),
    "contact_name" VARCHAR(150),
    "contact_email" VARCHAR(200),
    "mrr" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discount_reason" VARCHAR(200),
    "discount_until" DATE,
    "notes" TEXT,
    "block_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "administrators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "role" "UserRole" NOT NULL,
    "administrator_id" UUID,
    "phone" VARCHAR(30),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estates" (
    "id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "EstateType" NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "location" VARCHAR(150) NOT NULL,
    "reserve_target" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "iban" VARCHAR(34),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "estates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "administrators_cif_key" ON "administrators"("cif");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "estates_administrator_id_idx" ON "estates"("administrator_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estates" ADD CONSTRAINT "estates_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

