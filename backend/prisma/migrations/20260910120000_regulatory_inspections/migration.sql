-- CreateEnum
CREATE TYPE "RegulatoryInspectionStatus" AS ENUM ('planificada', 'citada', 'realizada', 'desfavorable', 'vencida', 'exenta');

-- CreateEnum
CREATE TYPE "InspectionOutcome" AS ENUM ('favorable', 'desfavorable');

-- CreateEnum
CREATE TYPE "CorrectiveActionStatus" AS ENUM ('abierta', 'en_progreso', 'cerrada', 'vencida');

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "location" VARCHAR(200),
    "manufacturer" VARCHAR(150),
    "serial_number" VARCHAR(100),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_types" (
    "id" UUID NOT NULL,
    "estate_id" UUID,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "legal_basis" VARCHAR(255),
    "requires_oca" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_inspections" (
    "id" UUID NOT NULL,
    "estate_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "inspection_type_id" UUID NOT NULL,
    "status" "RegulatoryInspectionStatus" NOT NULL DEFAULT 'planificada',
    "next_due_date" DATE,
    "appointment_date" DATE,
    "last_done_date" DATE,
    "reminder_days_before" INTEGER NOT NULL DEFAULT 30,
    "last_reminder_sent_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "regulatory_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_results" (
    "id" UUID NOT NULL,
    "inspection_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "outcome" "InspectionOutcome" NOT NULL,
    "defects" TEXT,
    "certificate_key" VARCHAR(500),
    "report_key" VARCHAR(500),
    "cost" DECIMAL(10,2),
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrective_actions" (
    "id" UUID NOT NULL,
    "inspection_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 2,
    "due_date" DATE,
    "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'abierta',
    "assignee_user_id" UUID,
    "supplier_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "corrective_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_estate_id_idx" ON "assets"("estate_id");

-- CreateIndex
-- `code` único dentro de su ámbito, no globalmente: dos fincas distintas
-- pueden personalizar cada una un tipo con el mismo `code`. Dos índices
-- únicos PARCIALES en vez de un @@unique([code, estate_id]) declarativo,
-- porque Postgres no considera iguales dos NULL en un índice único normal
-- — eso dejaría duplicar libremente el catálogo global (estate_id NULL).
CREATE UNIQUE INDEX "inspection_types_code_global_key" ON "inspection_types"("code") WHERE "estate_id" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "inspection_types_code_estate_key" ON "inspection_types"("code", "estate_id") WHERE "estate_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "inspection_types_estate_id_idx" ON "inspection_types"("estate_id");

-- CreateIndex
CREATE INDEX "regulatory_inspections_estate_id_next_due_date_idx" ON "regulatory_inspections"("estate_id", "next_due_date");

-- CreateIndex
CREATE INDEX "regulatory_inspections_status_idx" ON "regulatory_inspections"("status");

-- CreateIndex
CREATE INDEX "inspection_results_inspection_id_idx" ON "inspection_results"("inspection_id");

-- CreateIndex
CREATE INDEX "corrective_actions_status_due_date_idx" ON "corrective_actions"("status", "due_date");

-- CreateIndex
CREATE INDEX "corrective_actions_inspection_id_idx" ON "corrective_actions"("inspection_id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_types" ADD CONSTRAINT "inspection_types_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_inspections" ADD CONSTRAINT "regulatory_inspections_estate_id_fkey" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_inspections" ADD CONSTRAINT "regulatory_inspections_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_inspections" ADD CONSTRAINT "regulatory_inspections_inspection_type_id_fkey" FOREIGN KEY ("inspection_type_id") REFERENCES "inspection_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regulatory_inspections" ADD CONSTRAINT "regulatory_inspections_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "regulatory_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "regulatory_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Catálogo global de tipos de inspección (estate_id NULL) — reconciliado desde
-- domora-es (supabase/migrations/20251009210545_*.sql). ON CONFLICT DO NOTHING
-- para que sea seguro reaplicar el INSERT si esta migración se ejecuta más de
-- una vez en distintos entornos.
INSERT INTO "inspection_types" ("id", "code", "name", "legal_basis", "requires_oca") VALUES
  (gen_random_uuid(), 'ASCENSOR_ITC_AEM1', 'Ascensores — ITC AEM 1', 'RD 355/2024 (ITC AEM 1)', true),
  (gen_random_uuid(), 'MONTA_COCHES', 'Montacoches / elevadores de vehículos', 'ITC AEM 1 / normativa autonómica', true),
  (gen_random_uuid(), 'PLATAFORMA_SALVAESC', 'Plataformas/salvaescaleras', 'Marcado CE / manual fabricante', false),
  (gen_random_uuid(), 'PCI_EXTINTORES', 'PCI — Extintores portátiles', 'RD 513/2017 (RIPCI)', false),
  (gen_random_uuid(), 'PCI_BIE', 'PCI — Bocas de Incendio Equipadas (BIE)', 'RD 513/2017 (RIPCI)', false),
  (gen_random_uuid(), 'PCI_DETECCION', 'PCI — Detección y alarma de incendios', 'RD 513/2017 (RIPCI)', false),
  (gen_random_uuid(), 'PCI_ROCIADORES', 'PCI — Rociadores automáticos (sprinklers)', 'RD 513/2017 (RIPCI)', true),
  (gen_random_uuid(), 'PCI_HIDRANTES', 'PCI — Hidrantes exteriores', 'RD 513/2017 (RIPCI)', false),
  (gen_random_uuid(), 'PCI_CENTRAL', 'PCI — Central/puestos de control', 'RD 513/2017 (RIPCI)', false),
  (gen_random_uuid(), 'PCI_GRUPO_PRESION', 'PCI — Grupo de presión/ACI', 'RD 513/2017 (RIPCI)', false),
  (gen_random_uuid(), 'PCI_COLUMNAS_SECAS', 'PCI — Columnas secas', 'RD 513/2017 (RIPCI) / Ordenanzas', false),
  (gen_random_uuid(), 'PCI_PUERTAS_CORTAFUEGO', 'PCI — Puertas cortafuego', 'EN 1634 / RIPCI', false),
  (gen_random_uuid(), 'PCI_SENAL_ALUM_EMERG', 'Señalización y alumbrado de emergencia', 'UNE / BT', false),
  (gen_random_uuid(), 'BT_PUB_CONC', 'Eléctrica BT — Pública concurrencia', 'REBT (RD 842/2002)', true),
  (gen_random_uuid(), 'BT_GARAJE_GT25', 'Eléctrica BT — Garajes > 25 plazas', 'REBT (RD 842/2002)', true),
  (gen_random_uuid(), 'BT_ZC_GT100KW', 'Eléctrica BT — Zonas comunes >100 kW', 'REBT (RD 842/2002)', true),
  (gen_random_uuid(), 'PARARRAYOS_LPS', 'Protección contra el rayo (LPS)', 'EN 62305 / UNE 21186', false),
  (gen_random_uuid(), 'CT_RAT', 'Centro de transformación (AT)', 'ITC-RAT / Regl. AT', true),
  (gen_random_uuid(), 'GRUPO_ELECTROGENO', 'Grupo electrógeno', 'REBT / fabricante', false),
  (gen_random_uuid(), 'RITE_CALOR_ACS', 'RITE — Calefacción/ACS/Ventilación', 'RITE (RD 1027/2007 mod. RD 178/2021)', false),
  (gen_random_uuid(), 'RITE_FRIO', 'RITE — Aire acondicionado/Ventilación', 'RITE (RD 1027/2007 mod. RD 178/2021)', false),
  (gen_random_uuid(), 'RITE_COMPLETA', 'RITE — Instalación térmica completa', 'RITE (IT 4.x)', false),
  (gen_random_uuid(), 'RITE_SALA_CALDERAS', 'RITE — Sala de calderas', 'RITE IT 3.x / fabricante', false),
  (gen_random_uuid(), 'RITE_VENT_APARC', 'RITE — Ventilación aparcamientos', 'RITE / Ordenanzas', false),
  (gen_random_uuid(), 'LEGIONELLA_ACS', 'Legionella — ACS (acumulación/red)', 'RD 487/2022', false),
  (gen_random_uuid(), 'LEGIONELLA_TORRES', 'Legionella — Torres de refrigeración', 'RD 487/2022', false),
  (gen_random_uuid(), 'LEGIONELLA_ALJIBE', 'Legionella — Aljibes/depósitos AFCH', 'RD 487/2022', false),
  (gen_random_uuid(), 'GAS_IRG', 'Gas — Instalación receptora (IRG)', 'Reglamentación gas / distribuidora', false),
  (gen_random_uuid(), 'GAS_SALA_CALDERAS', 'Gas — Sala de calderas', 'RITE / Regl. Gas', false),
  (gen_random_uuid(), 'EP_CALDERIN_AIRE', 'Equipos a presión — Calderín/aire comprimido', 'RD 809/2021', true),
  (gen_random_uuid(), 'EP_APARATOS_PRESION', 'Equipos a presión — Aparatos (varios)', 'RD 809/2021', true),
  (gen_random_uuid(), 'ITE_IEE', 'Inspección Técnica / Informe Evaluación Edificio', 'Normativa autonómica/municipal', false),
  (gen_random_uuid(), 'PUERTAS_GARAJE', 'Puertas/portones motorizados', 'EN 13241 / RD 1215/1997', false),
  (gen_random_uuid(), 'GARAJE_DETECCION_CO', 'Detección CO y ventilación aparcamiento', 'RITE / Ordenanzas', false),
  (gen_random_uuid(), 'GARAJE_EXTINCION', 'Sistemas de extinción en garaje', 'RIPCI', false),
  (gen_random_uuid(), 'FV_INSTALACION', 'Fotovoltaica — Inspección y rendimiento', 'REBT ITC-BT-40/52 / Guías IDAE', false),
  (gen_random_uuid(), 'VE_CARGADORES', 'Recarga vehículo eléctrico (IRVE)', 'REBT ITC-BT-52', false),
  (gen_random_uuid(), 'ICT_ANTENAS', 'Infraestructura Común de Telecomunicaciones', 'RD 346/2011 (ICT)', false)
ON CONFLICT ("code") WHERE "estate_id" IS NULL DO NOTHING;
