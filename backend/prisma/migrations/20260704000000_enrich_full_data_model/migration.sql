-- Fase 0.5 — Reconciliación de schema (ver doc/backend-execution-plan.md).
--
-- Esta migración amplía el schema "Fase 0" (administrators/users/
-- refresh_tokens/estates) con el modelo de datos completo descrito en
-- docs/data-model.md (cuerpo + Apéndices A-H), transcrito desde
-- src/app/core/models.ts.
--
-- Generada manualmente combinando:
--   1. `prisma migrate diff --from-empty --to-schema-datamodel` (para
--      obtener el DDL completo y correcto de las tablas/tipos NUEVOS), y
--   2. ALTER TABLE explícitos para los cambios sobre las 4 tablas que ya
--      existían.
--
-- CONFIRMADA: `prisma migrate deploy` aplica limpiamente contra una
-- instancia real de PostgreSQL 16, y `prisma/seed.ts` corre sin errores
-- contra el esquema resultante. Esta verificación detectó y corrigió dos
-- errores que la validación estática no había detectado: orden incorrecto
-- de CREATE TYPE frente a los ALTER TABLE que los referencian, y un índice
-- doble (administrators_status_idx/administrators_end_date_idx) más una FK
-- duplicada (administrators_primary_user_id_fkey) entre la sección manual
-- y la autogenerada.

-- ── Tipos nuevos (deben crearse antes de las ALTER TABLE que los usan) ─

-- CreateEnum
CREATE TYPE "TaxIdCountry" AS ENUM ('ES', 'PT', 'FR', 'DE', 'IT', 'AD', 'NL', 'BE', 'OTHER');

-- CreateEnum
CREATE TYPE "AdminInvoiceStatus" AS ENUM ('Pagada', 'Pendiente', 'Vencida');

-- CreateEnum
CREATE TYPE "AdminActivityType" AS ENUM ('login', 'plan_change', 'discount', 'invoice', 'signup', 'block', 'message');

-- CreateEnum
CREATE TYPE "AdminPayMethod" AS ENUM ('Domiciliación', 'Tarjeta', 'Transferencia');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('Ocupado', 'Vacío', 'Reservado');

-- CreateEnum
CREATE TYPE "MembershipRoleType" AS ENUM ('Propietario', 'Inquilino', 'Representante', 'Ocupante', 'Otro');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('pending', 'linked', 'revoked');

-- CreateEnum
CREATE TYPE "RepresentationType" AS ENUM ('tutela', 'curatela', 'apoderamiento_general', 'apoderamiento_especifico', 'herencia_yacente', 'representacion_legal');

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('active', 'dormant', 'revoked', 'pending_signature', 'expired');

-- CreateEnum
CREATE TYPE "SepaScheme" AS ENUM ('CORE', 'B2B');

-- CreateEnum
CREATE TYPE "MandatePaymentType" AS ENUM ('recurrent', 'oneOff');

-- CreateEnum
CREATE TYPE "MandateAmendmentField" AS ENUM ('debtor_iban', 'debtor_bic', 'debtor_name', 'debtor_tax_id', 'creditor_id', 'umr');

-- CreateEnum
CREATE TYPE "MandateSeq" AS ENUM ('FRST', 'RCUR', 'OOFF', 'FNAL');

-- CreateEnum
CREATE TYPE "AdhesionStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "AdhesionDecision" AS ENUM ('approved', 'rejected');

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('Incidencia', 'Documentación', 'Modificación', 'Consulta', 'Queja');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('Abierta', 'En curso', 'Resuelta', 'Cerrada');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('Normal', 'Urgente');

-- CreateEnum
CREATE TYPE "TimelineAuthorRole" AS ENUM ('Propietario', 'Administrador', 'Sistema');

-- CreateEnum
CREATE TYPE "TicketTimelineKind" AS ENUM ('comment', 'status_change', 'system');

-- CreateEnum
CREATE TYPE "AlertSourceType" AS ENUM ('issue', 'receipt', 'communication', 'document', 'event');

-- CreateEnum
CREATE TYPE "ActivitySubjectType" AS ENUM ('issue', 'receipt', 'communication', 'document', 'ticket', 'membership');

-- CreateEnum
CREATE TYPE "ActivityVerb" AS ENUM ('created', 'updated', 'status_changed', 'paid', 'published', 'uploaded');

-- CreateEnum
CREATE TYPE "OwnerPropertyType" AS ENUM ('Piso', 'Casa', 'Parking', 'Trastero', 'Local');

-- CreateEnum
CREATE TYPE "ViaType" AS ENUM ('Calle', 'Avenida', 'Plaza', 'Paseo', 'Camino', 'Carretera', 'Travesía', 'Pasaje', 'Ronda', 'Glorieta', 'Vía', 'Polígono', 'Urbanización', 'Lugar', 'Otro');

-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('Avería', 'Ruido', 'Daño estructural', 'Fuga', 'Seguridad', 'Limpieza', 'Otro');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('Abierta', 'En reparación', 'Pendiente proveedor', 'Resuelta', 'Cerrada');

-- CreateEnum
CREATE TYPE "IssueSource" AS ENUM ('Propietario', 'Comunidad');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'push', 'sms', 'mixed');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('income', 'expense', 'transfer');

-- CreateEnum
CREATE TYPE "ChartAccountType" AS ENUM ('income', 'expense', 'transfer', 'all');

-- CreateEnum
CREATE TYPE "ReconciliationMatchMethod" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "GestionType" AS ENUM ('Llamada', 'Email', 'Carta amistosa', 'Carta formal', 'Burofax', 'Acción judicial');

-- CreateEnum
CREATE TYPE "PaymentAgreementStatus" AS ENUM ('active', 'completed', 'breached', 'cancelled');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('Pagada', 'Pendiente', 'Devuelto');

-- CreateEnum
CREATE TYPE "PayMethod" AS ENUM ('Domiciliación', 'Transferencia', 'Efectivo', 'Pago en oficina', 'Bizum', 'Devolución', 'Pendiente');

-- CreateEnum
CREATE TYPE "RemesaStatus" AS ENUM ('Borrador', 'Presentada', 'Cobrada', 'Con devoluciones');

-- CreateEnum
CREATE TYPE "RemesaLineStatus" AS ENUM ('Cobrado', 'Pendiente', 'Devuelto');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('confirmed', 'completed', 'cancelled');

-- ── Cambios sobre tablas existentes (Fase 0) ────────────────────────────

-- AlterTable: administrators
-- `users_active` se elimina — pasa a calcularse al vuelo
-- (DataService.countActiveUsersForAdministrator en el frontend; solo las
-- membresías `linked` computan, Apéndice H). Mantenerlo como columna
-- almacenada permitía que se desincronizara del recuento real.
ALTER TABLE "administrators" DROP COLUMN "users_active";
ALTER TABLE "administrators" ADD COLUMN "vat_number" VARCHAR(20);
ALTER TABLE "administrators" ADD COLUMN "primary_user_id" UUID;

-- AlterTable: users
ALTER TABLE "users" ADD COLUMN "tax_id_country" "TaxIdCountry";
ALTER TABLE "users" ADD COLUMN "tax_id" VARCHAR(20);

-- AlterTable: estates
-- La comunidad de propietarios (no la gestora) es el acreedor SEPA —
-- Apéndice F. Cada finca tiene su propio CIF y su propio CID.
ALTER TABLE "estates" ADD COLUMN "cif" VARCHAR(20);
ALTER TABLE "estates" ADD COLUMN "creditor_id" VARCHAR(16);
ALTER TABLE "estates" ADD COLUMN "creditor_iban" VARCHAR(34);
ALTER TABLE "estates" ADD COLUMN "creditor_bic" VARCHAR(11);
ALTER TABLE "estates" ADD COLUMN "creditor_postal_address" VARCHAR(255);

-- ── Entidades nuevas (todo lo que sigue no existía en Fase 0) ───────────
-- CreateTable
CREATE TABLE "admin_billing" (
    "administrator_id" UUID NOT NULL,
    "business_name" VARCHAR(200) NOT NULL,
    "cif" VARCHAR(20) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "payment_method" "AdminPayMethod" NOT NULL,
    "iban" VARCHAR(34),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_billing_pkey" PRIMARY KEY ("administrator_id")
);
-- CreateTable
CREATE TABLE "admin_invoices" (
    "id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "invoice_no" VARCHAR(30) NOT NULL,
    "issue_date" DATE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "AdminInvoiceStatus" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_invoices_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "admin_activity_log" (
    "id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "type" "AdminActivityType" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "author_user_id" UUID,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_activity_log_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "property_events" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "date" DATE NOT NULL,
    "location" VARCHAR(200) NOT NULL,
    "room" VARCHAR(150),
    "time" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_events_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "estate_id" UUID,
    "administrator_id" UUID,
    "type" "OwnerPropertyType" NOT NULL,
    "status" "PropertyStatus" NOT NULL,
    "via_type" "ViaType",
    "via_name" VARCHAR(150),
    "street_number" VARCHAR(20),
    "street_number_suffix" VARCHAR(20),
    "block" VARCHAR(20),
    "staircase" VARCHAR(10),
    "floor" VARCHAR(10),
    "door" VARCHAR(10),
    "postal_code" VARCHAR(10),
    "municipality" VARCHAR(150),
    "province" VARCHAR(100),
    "country" VARCHAR(2) DEFAULT 'ES',
    "cadastral_reference" VARCHAR(20),
    "ref" VARCHAR(20),
    "quota_monthly" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "iban" VARCHAR(34),
    "primary_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "property_memberships" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_type" "MembershipRoleType" NOT NULL,
    "status" "MembershipStatus" NOT NULL,
    "is_primary_contact" BOOLEAN NOT NULL DEFAULT false,
    "nickname" VARCHAR(150),
    "linked_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "approved_by_user_id" UUID,
    "notes" TEXT,

    CONSTRAINT "property_memberships_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "external_owners" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "tax_id_country" "TaxIdCountry",
    "tax_id" VARCHAR(20),
    "email" VARCHAR(200),
    "phone" VARCHAR(30),
    "postal_address" VARCHAR(255),
    "role_type" "MembershipRoleType",
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID NOT NULL,
    "promoted_to_user_id" UUID,
    "promoted_at" TIMESTAMPTZ,

    CONSTRAINT "external_owners_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "user_representations" (
    "id" UUID NOT NULL,
    "representative_user_id" UUID NOT NULL,
    "represented_user_id" UUID NOT NULL,
    "type" "RepresentationType" NOT NULL,
    "scope" TEXT,
    "document_ref" VARCHAR(255),
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "granted_estate_id" UUID,
    "granted_property_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "revoked_at" TIMESTAMPTZ,
    "revoked_by_user_id" UUID,
    "revocation_reason" TEXT,

    CONSTRAINT "user_representations_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "adhesion_requests" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "property_id" UUID,
    "user_id" UUID NOT NULL,
    "role_type" "MembershipRoleType" NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL,
    "status" "AdhesionStatus" NOT NULL,
    "resolved_at" TIMESTAMPTZ,
    "resolved_by_user_id" UUID,
    "decision" "AdhesionDecision",
    "notes" TEXT,

    CONSTRAINT "adhesion_requests_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "ref" VARCHAR(30) NOT NULL,
    "property_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "assigned_to_user_id" UUID,
    "type" "TicketType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "status" "TicketStatus" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ticket_timeline_entries" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "date" TIMESTAMPTZ NOT NULL,
    "author_user_id" UUID NOT NULL,
    "author_role" "TimelineAuthorRole" NOT NULL,
    "text" TEXT NOT NULL,
    "kind" "TicketTimelineKind",

    CONSTRAINT "ticket_timeline_entries_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "ref" VARCHAR(30) NOT NULL,
    "property_id" UUID NOT NULL,
    "type" "IssueType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IssueStatus" NOT NULL,
    "priority" "Priority" NOT NULL,
    "source" "IssueSource" NOT NULL,
    "date" DATE NOT NULL,
    "owner_name" VARCHAR(200),
    "budget_amount" DECIMAL(10,2),
    "budget_description" TEXT,
    "budget_approved" BOOLEAN,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "issue_photos" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "s3_key" VARCHAR(500) NOT NULL,
    "url" VARCHAR(500),
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_photos_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "issue_timeline_entries" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "date" TIMESTAMPTZ NOT NULL,
    "author_user_id" UUID,
    "role" "TimelineAuthorRole" NOT NULL,
    "text" TEXT NOT NULL,
    "on_behalf_of_user_id" UUID,

    CONSTRAINT "issue_timeline_entries_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "issue_providers" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "supplier_id" UUID,
    "provider_name_snapshot" VARCHAR(200) NOT NULL,
    "category_snapshot" VARCHAR(150),
    "phone_snapshot" VARCHAR(30),
    "estimated_resolution_date" DATE,
    "assigned_at" TIMESTAMPTZ NOT NULL,
    "assigned_by_user_id" UUID NOT NULL,
    "unassigned_at" TIMESTAMPTZ,

    CONSTRAINT "issue_providers_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "issue_notifications" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL,
    "recipients_count" INTEGER NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "sent_by_user_id" UUID NOT NULL,
    "subject" VARCHAR(255),
    "body" TEXT,

    CONSTRAINT "issue_notifications_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "communications" (
    "id" UUID NOT NULL,
    "estate_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "date" TIMESTAMPTZ NOT NULL,
    "from" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "estate_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "date" DATE NOT NULL,
    "size" VARCHAR(20) NOT NULL,
    "s3_key" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "resource_reads" (
    "user_id" UUID NOT NULL,
    "source_type" "AlertSourceType" NOT NULL,
    "source_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "resource_reads_pkey" PRIMARY KEY ("user_id","source_type","source_id")
);
-- CreateTable
CREATE TABLE "chart_accounts" (
    "id" UUID NOT NULL,
    "administrator_id" UUID,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "short_name" VARCHAR(60),
    "type" "ChartAccountType" NOT NULL,
    "parent_code" VARCHAR(10),

    CONSTRAINT "chart_accounts_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "tax_id_country" "TaxIdCountry",
    "tax_id" VARCHAR(20),
    "vat_number" VARCHAR(20),
    "category" VARCHAR(100) NOT NULL,
    "email" VARCHAR(200),
    "phone" VARCHAR(30),
    "iban" VARCHAR(34),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estateId" UUID,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "movements" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "concept" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "supplier_id" UUID,
    "reference" VARCHAR(100),
    "notes" TEXT,
    "reversal" BOOLEAN NOT NULL DEFAULT false,
    "reversed_movement_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "movements_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "bank_extract_entries" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "concept" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "bank_ref" VARCHAR(100),
    "imported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "import_batch_id" UUID,

    CONSTRAINT "bank_extract_entries_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "reconciliations" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "bank_entry_id" UUID NOT NULL,
    "movement_id" UUID NOT NULL,
    "matched_at" TIMESTAMPTZ NOT NULL,
    "matched_by_user_id" UUID,
    "match_method" "ReconciliationMatchMethod" NOT NULL,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "budget_items" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "category" VARCHAR(150) NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "budgeted" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "period_key" VARCHAR(7) NOT NULL,
    "label" VARCHAR(50) NOT NULL,
    "month_abbrev" VARCHAR(5) NOT NULL,
    "issued_at" DATE,
    "closed_at" DATE,

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "no" VARCHAR(30) NOT NULL,
    "period_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "owner_user_id" UUID,
    "mandate_id" UUID,
    "concept" VARCHAR(255) NOT NULL,
    "kind" VARCHAR(50) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "due_date" DATE,
    "status" "ReceiptStatus" NOT NULL,
    "date" DATE NOT NULL,
    "method" "PayMethod" NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "include_in_remesa" BOOLEAN NOT NULL DEFAULT true,
    "return_code" VARCHAR(10),
    "return_reason" VARCHAR(150),
    "owner_name_snapshot" VARCHAR(200),
    "owner_tax_id_snapshot" VARCHAR(20),
    "owner_tax_id_country_snapshot" "TaxIdCountry",
    "iban_snapshot" VARCHAR(34),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "mandates" (
    "id" UUID NOT NULL,
    "umr" VARCHAR(35) NOT NULL,
    "creditor_estate_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "titular_user_id" UUID NOT NULL,
    "scheme" "SepaScheme" NOT NULL,
    "payment_type" "MandatePaymentType" NOT NULL,
    "debtor_iban" VARCHAR(34) NOT NULL,
    "debtor_bic" VARCHAR(11),
    "signed_at" DATE NOT NULL,
    "first_use_at" DATE,
    "last_use_at" DATE,
    "revoked_at" TIMESTAMPTZ,
    "revoked_reason" TEXT,
    "status" "MandateStatus" NOT NULL,

    CONSTRAINT "mandates_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "mandate_amendments" (
    "id" UUID NOT NULL,
    "mandate_id" UUID NOT NULL,
    "field" "MandateAmendmentField" NOT NULL,
    "old_value" TEXT NOT NULL,
    "new_value" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "pending_in_first_next_remesa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "mandate_amendments_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "remesas" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "period_id" UUID,
    "scheme" "SepaScheme" NOT NULL,
    "concept" VARCHAR(255) NOT NULL,
    "status" "RemesaStatus" NOT NULL,
    "lines_count" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "presented_at" DATE,
    "charge_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "remesas_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "remesa_lines" (
    "id" UUID NOT NULL,
    "remesa_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "owner_user_id" UUID,
    "mandate_id" UUID,
    "iban" VARCHAR(34) NOT NULL,
    "mandate_seq" "MandateSeq" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "RemesaLineStatus" NOT NULL,
    "return_code" VARCHAR(10),
    "return_reason" VARCHAR(150),
    "owner_name_snapshot" VARCHAR(200),
    "owner_tax_id_snapshot" VARCHAR(20),
    "owner_tax_id_country_snapshot" "TaxIdCountry",
    "iban_snapshot" VARCHAR(34),

    CONSTRAINT "remesa_lines_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "debtors" (
    "id" UUID NOT NULL,
    "administrator_id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "property_id" UUID,
    "amount" DECIMAL(10,2) NOT NULL,
    "interest" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "months_overdue" INTEGER NOT NULL,
    "oldest" VARCHAR(20) NOT NULL,
    "last_contact" TIMESTAMPTZ,
    "reminder_l1" BOOLEAN NOT NULL DEFAULT false,
    "reminder_l2" BOOLEAN NOT NULL DEFAULT false,
    "reminder_bf" BOOLEAN NOT NULL DEFAULT false,
    "step" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "debtors_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "debtor_actions" (
    "id" UUID NOT NULL,
    "debtor_id" UUID NOT NULL,
    "type" "GestionType" NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "result" VARCHAR(200),
    "author_user_id" UUID,
    "on_behalf_of_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debtor_actions_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "payment_agreements" (
    "id" UUID NOT NULL,
    "debtor_id" UUID NOT NULL,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "down_payment_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "installments_count" INTEGER NOT NULL,
    "first_due_date" DATE NOT NULL,
    "status" "PaymentAgreementStatus" NOT NULL,
    "signed_at" TIMESTAMPTZ NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_reason" TEXT,

    CONSTRAINT "payment_agreements_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "payment_agreement_installments" (
    "id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paid_at" TIMESTAMPTZ,
    "receipt_id" UUID,

    CONSTRAINT "payment_agreement_installments_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "amenities" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "icon" VARCHAR(10),
    "color" VARCHAR(50),
    "bg" VARCHAR(50),
    "max_hours" INTEGER NOT NULL,
    "slots" TEXT[],
    "rules" TEXT,
    "capacity" INTEGER NOT NULL,
    "seasonal" BOOLEAN NOT NULL DEFAULT false,
    "season_label" VARCHAR(50),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amenities_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "amenity_id" UUID NOT NULL,
    "property_id" UUID,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_slot" VARCHAR(5) NOT NULL,
    "end_slot" VARCHAR(5) NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guests" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "cancelled_at" TIMESTAMPTZ,
    "cancellation_reason" TEXT,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "activity_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "subject_type" "ActivitySubjectType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "verb" "ActivityVerb" NOT NULL,
    "summary" VARCHAR(255) NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "estate_id" UUID,
    "property_id" UUID,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "administrators_status_idx" ON "administrators"("status");
-- CreateIndex
CREATE INDEX "administrators_end_date_idx" ON "administrators"("end_date");
-- CreateIndex
CREATE UNIQUE INDEX "admin_invoices_invoice_no_key" ON "admin_invoices"("invoice_no");
-- CreateIndex
CREATE INDEX "admin_invoices_administrator_id_idx" ON "admin_invoices"("administrator_id");
-- CreateIndex
CREATE INDEX "admin_activity_log_administrator_id_occurred_at_idx" ON "admin_activity_log"("administrator_id", "occurred_at" DESC);
-- CreateIndex
CREATE INDEX "property_events_estate_id_date_idx" ON "property_events"("estate_id", "date");
-- CreateIndex
CREATE INDEX "properties_estate_id_idx" ON "properties"("estate_id");
-- CreateIndex
CREATE INDEX "properties_administrator_id_idx" ON "properties"("administrator_id");
-- CreateIndex
CREATE UNIQUE INDEX "properties_estate_id_ref_key" ON "properties"("estate_id", "ref");
-- CreateIndex
CREATE INDEX "property_memberships_user_id_idx" ON "property_memberships"("user_id");
-- CreateIndex
CREATE INDEX "property_memberships_property_id_status_idx" ON "property_memberships"("property_id", "status");
-- CreateIndex
CREATE UNIQUE INDEX "property_memberships_property_id_user_id_role_type_key" ON "property_memberships"("property_id", "user_id", "role_type");
-- CreateIndex
CREATE INDEX "external_owners_property_id_idx" ON "external_owners"("property_id");
-- CreateIndex
CREATE INDEX "user_representations_representative_user_id_idx" ON "user_representations"("representative_user_id");
-- CreateIndex
CREATE INDEX "user_representations_represented_user_id_idx" ON "user_representations"("represented_user_id");
-- CreateIndex
CREATE INDEX "adhesion_requests_estate_id_status_idx" ON "adhesion_requests"("estate_id", "status");
-- CreateIndex
CREATE UNIQUE INDEX "tickets_ref_key" ON "tickets"("ref");
-- CreateIndex
CREATE INDEX "tickets_property_id_status_idx" ON "tickets"("property_id", "status");
-- CreateIndex
CREATE INDEX "ticket_timeline_entries_ticket_id_date_idx" ON "ticket_timeline_entries"("ticket_id", "date");
-- CreateIndex
CREATE UNIQUE INDEX "issues_ref_key" ON "issues"("ref");
-- CreateIndex
CREATE INDEX "issues_property_id_status_idx" ON "issues"("property_id", "status");
-- CreateIndex
CREATE INDEX "issue_timeline_entries_issue_id_date_idx" ON "issue_timeline_entries"("issue_id", "date");
-- CreateIndex
CREATE INDEX "issue_providers_issue_id_unassigned_at_idx" ON "issue_providers"("issue_id", "unassigned_at");
-- CreateIndex
CREATE INDEX "issue_notifications_issue_id_sent_at_idx" ON "issue_notifications"("issue_id", "sent_at");
-- CreateIndex
CREATE INDEX "communications_estate_id_date_idx" ON "communications"("estate_id", "date" DESC);
-- CreateIndex
CREATE INDEX "documents_estate_id_date_idx" ON "documents"("estate_id", "date" DESC);
-- CreateIndex
CREATE UNIQUE INDEX "chart_accounts_administrator_id_code_key" ON "chart_accounts"("administrator_id", "code");
-- CreateIndex
CREATE INDEX "suppliers_administrator_id_idx" ON "suppliers"("administrator_id");
-- CreateIndex
CREATE INDEX "movements_estate_id_date_idx" ON "movements"("estate_id", "date" DESC);
-- CreateIndex
CREATE INDEX "bank_extract_entries_estate_id_date_idx" ON "bank_extract_entries"("estate_id", "date" DESC);
-- CreateIndex
CREATE UNIQUE INDEX "reconciliations_bank_entry_id_key" ON "reconciliations"("bank_entry_id");
-- CreateIndex
CREATE UNIQUE INDEX "reconciliations_movement_id_key" ON "reconciliations"("movement_id");
-- CreateIndex
CREATE UNIQUE INDEX "budget_items_estate_id_account_id_fiscal_year_key" ON "budget_items"("estate_id", "account_id", "fiscal_year");
-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_estate_id_period_key_key" ON "accounting_periods"("estate_id", "period_key");
-- CreateIndex
CREATE INDEX "receipts_property_id_idx" ON "receipts"("property_id");
-- CreateIndex
CREATE INDEX "receipts_period_id_status_idx" ON "receipts"("period_id", "status");
-- CreateIndex
CREATE INDEX "receipts_owner_user_id_status_idx" ON "receipts"("owner_user_id", "status");
-- CreateIndex
CREATE UNIQUE INDEX "receipts_period_id_no_key" ON "receipts"("period_id", "no");
-- CreateIndex
CREATE UNIQUE INDEX "mandates_umr_key" ON "mandates"("umr");
-- CreateIndex
CREATE INDEX "mandates_property_id_idx" ON "mandates"("property_id");
-- CreateIndex
CREATE INDEX "mandates_status_idx" ON "mandates"("status");
-- CreateIndex
CREATE INDEX "remesas_estate_id_idx" ON "remesas"("estate_id");
-- CreateIndex
CREATE INDEX "remesa_lines_remesa_id_idx" ON "remesa_lines"("remesa_id");
-- CreateIndex
CREATE UNIQUE INDEX "remesa_lines_remesa_id_receipt_id_key" ON "remesa_lines"("remesa_id", "receipt_id");
-- CreateIndex
CREATE INDEX "debtors_administrator_id_idx" ON "debtors"("administrator_id");
-- CreateIndex
CREATE INDEX "debtors_estate_id_idx" ON "debtors"("estate_id");
-- CreateIndex
CREATE INDEX "debtor_actions_debtor_id_date_idx" ON "debtor_actions"("debtor_id", "date" DESC);
-- CreateIndex
CREATE INDEX "payment_agreements_debtor_id_status_idx" ON "payment_agreements"("debtor_id", "status");
-- CreateIndex
CREATE UNIQUE INDEX "payment_agreement_installments_agreement_id_seq_key" ON "payment_agreement_installments"("agreement_id", "seq");
-- CreateIndex
CREATE INDEX "amenities_estate_id_idx" ON "amenities"("estate_id");
-- CreateIndex
CREATE INDEX "bookings_amenity_id_date_idx" ON "bookings"("amenity_id", "date");
-- CreateIndex
CREATE INDEX "activity_log_estate_id_occurred_at_idx" ON "activity_log"("estate_id", "occurred_at" DESC);
-- CreateIndex
CREATE INDEX "activity_log_property_id_occurred_at_idx" ON "activity_log"("property_id", "occurred_at" DESC);
-- CreateIndex
CREATE INDEX "activity_log_subject_type_subject_id_idx" ON "activity_log"("subject_type", "subject_id");

-- AddForeignKey
ALTER TABLE "administrators" ADD CONSTRAINT "administrators_primary_user_id_fkey" FOREIGN KEY ("primary_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_billing" ADD CONSTRAINT "admin_billing_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invoices" ADD CONSTRAINT "admin_invoices_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_activity_log" ADD CONSTRAINT "admin_activity_log_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_activity_log" ADD CONSTRAINT "admin_activity_log_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_events" ADD CONSTRAINT "property_events_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_primary_user_id_fkey" FOREIGN KEY ("primary_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_memberships" ADD CONSTRAINT "property_memberships_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_memberships" ADD CONSTRAINT "property_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_memberships" ADD CONSTRAINT "property_memberships_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_owners" ADD CONSTRAINT "external_owners_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_owners" ADD CONSTRAINT "external_owners_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_owners" ADD CONSTRAINT "external_owners_promoted_to_user_id_fkey" FOREIGN KEY ("promoted_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_representations" ADD CONSTRAINT "user_representations_representative_user_id_fkey" FOREIGN KEY ("representative_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_representations" ADD CONSTRAINT "user_representations_represented_user_id_fkey" FOREIGN KEY ("represented_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_representations" ADD CONSTRAINT "user_representations_granted_estate_id_fkey" FOREIGN KEY ("granted_estate_id") REFERENCES "estates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_representations" ADD CONSTRAINT "user_representations_granted_property_id_fkey" FOREIGN KEY ("granted_property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_representations" ADD CONSTRAINT "user_representations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_representations" ADD CONSTRAINT "user_representations_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhesion_requests" ADD CONSTRAINT "adhesion_requests_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhesion_requests" ADD CONSTRAINT "adhesion_requests_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhesion_requests" ADD CONSTRAINT "adhesion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhesion_requests" ADD CONSTRAINT "adhesion_requests_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_timeline_entries" ADD CONSTRAINT "ticket_timeline_entries_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_timeline_entries" ADD CONSTRAINT "ticket_timeline_entries_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_photos" ADD CONSTRAINT "issue_photos_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_timeline_entries" ADD CONSTRAINT "issue_timeline_entries_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_timeline_entries" ADD CONSTRAINT "issue_timeline_entries_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_providers" ADD CONSTRAINT "issue_providers_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_providers" ADD CONSTRAINT "issue_providers_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_providers" ADD CONSTRAINT "issue_providers_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_notifications" ADD CONSTRAINT "issue_notifications_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_notifications" ADD CONSTRAINT "issue_notifications_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_reads" ADD CONSTRAINT "resource_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_administrator_id_fkey" FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_estateId_fkey" FOREIGN KEY ("estateId") REFERENCES "estates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movements" ADD CONSTRAINT "movements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_extract_entries" ADD CONSTRAINT "bank_extract_entries_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_bank_entry_id_fkey" FOREIGN KEY ("bank_entry_id") REFERENCES "bank_extract_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_matched_by_user_id_fkey" FOREIGN KEY ("matched_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_mandate_id_fkey" FOREIGN KEY ("mandate_id") REFERENCES "mandates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_creditor_estate_id_fkey" FOREIGN KEY ("creditor_estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_titular_user_id_fkey" FOREIGN KEY ("titular_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_amendments" ADD CONSTRAINT "mandate_amendments_mandate_id_fkey" FOREIGN KEY ("mandate_id") REFERENCES "mandates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_amendments" ADD CONSTRAINT "mandate_amendments_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remesas" ADD CONSTRAINT "remesas_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remesas" ADD CONSTRAINT "remesas_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "accounting_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remesa_lines" ADD CONSTRAINT "remesa_lines_remesa_id_fkey" FOREIGN KEY ("remesa_id") REFERENCES "remesas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remesa_lines" ADD CONSTRAINT "remesa_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remesa_lines" ADD CONSTRAINT "remesa_lines_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remesa_lines" ADD CONSTRAINT "remesa_lines_mandate_id_fkey" FOREIGN KEY ("mandate_id") REFERENCES "mandates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debtors" ADD CONSTRAINT "debtors_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debtors" ADD CONSTRAINT "debtors_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debtor_actions" ADD CONSTRAINT "debtor_actions_debtor_id_fkey" FOREIGN KEY ("debtor_id") REFERENCES "debtors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debtor_actions" ADD CONSTRAINT "debtor_actions_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_agreements" ADD CONSTRAINT "payment_agreements_debtor_id_fkey" FOREIGN KEY ("debtor_id") REFERENCES "debtors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_agreements" ADD CONSTRAINT "payment_agreements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_agreement_installments" ADD CONSTRAINT "payment_agreement_installments_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "payment_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_agreement_installments" ADD CONSTRAINT "payment_agreement_installments_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amenities" ADD CONSTRAINT "amenities_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_amenity_id_fkey" FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
