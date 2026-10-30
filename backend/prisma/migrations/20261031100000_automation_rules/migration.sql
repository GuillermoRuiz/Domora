-- Reglas de automatización por comunidad (`AutomationRule`): hasta dónde puede actuar Domora, por ACCIÓN y por PARTE.
--  - Se consultan SOLO desde `AutomationDecisionService.decide()`. Una regla coincidente sustituye a `ai_policies` para esa
--    acción; sin regla, `ai_policies` sigue valiendo exactamente como hasta ahora. Esta migración no toca `ai_policies`.
--  - `action` es el vocabulario nuevo (`contact`, `chase`, `notify_requester`, `merge_duplicate`) + `party`; los tipos
--    heredados (`contact_provider`, `chase_provider`, `chase_party`) no se renombran ni se guardan aquí.
--  - Tabla tipada, sin JSON. Máximo UN discriminador (`issue_type` o `provider_category`); sin ninguno = regla general.
--  - Los techos estructurales (fusión nunca automática, reclamar a una aseguradora/propietario/otro nunca automático y sin
--    recordatorios, contactar solo a proveedores) y los rangos viven también aquí: ni una escritura directa puede guardar
--    una regla que el código no permitiría. `decide()` los vuelve a aplicar (defensa en profundidad).
-- Aditiva: no hay datos que migrar y no se modifica ninguna tabla existente.

CREATE TABLE "automation_rules" (
  "id" UUID NOT NULL,
  "estate_id" UUID NOT NULL,
  "action" VARCHAR(30) NOT NULL,
  "party" VARCHAR(20),
  "issue_type" VARCHAR(100),
  "provider_category" VARCHAR(100),
  "mode" VARCHAR(10) NOT NULL,
  "supplier_id" UUID,
  "cc_administrator" BOOLEAN,
  "max_auto_reminders" SMALLINT,
  "first_chase_after_hours" INTEGER,
  "interval_hours" INTEGER,
  "duplicate_threshold" DOUBLE PRECISION,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_user_id" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- Una sola regla por (comunidad, acción, parte, discriminador). Los NULL se normalizan con COALESCE para que dos reglas
-- «generales» (o dos con el mismo discriminador) no convivan por el comportamiento de NULL. Una regla deshabilitada sigue
-- ocupando su clave: se reactiva, no se duplica.
CREATE UNIQUE INDEX "automation_rules_key" ON "automation_rules" (
  "estate_id",
  "action",
  (COALESCE("party", '')),
  (COALESCE("issue_type", '')),
  (COALESCE("provider_category", ''))
);

ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_estate_fk" FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
-- Si el proveedor desaparece, la regla pierde su proveedor (y con él la autorización de envío automático): nunca al revés.
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_supplier_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Catálogo.
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_action_check" CHECK ("action" IN ('contact', 'chase', 'notify_requester', 'merge_duplicate'));
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_party_check" CHECK ("party" IS NULL OR "party" IN ('provider', 'insurer', 'owner', 'other'));
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_mode_check" CHECK ("mode" IN ('manual', 'propose', 'auto'));

-- Forma: `party` obligatorio en contactar y reclamar, nulo en el resto; contactar solo a proveedores; un discriminador como máximo.
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_party_shape_check" CHECK (("action" IN ('contact', 'chase')) = ("party" IS NOT NULL));
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_contact_provider_check" CHECK ("action" <> 'contact' OR "party" = 'provider');
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_one_discriminator_check" CHECK ("issue_type" IS NULL OR "provider_category" IS NULL);

-- Parámetros que admite cada acción (el resto, nulos).
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_params_check" CHECK (
  CASE "action"
    WHEN 'contact' THEN "max_auto_reminders" IS NULL AND "first_chase_after_hours" IS NULL AND "interval_hours" IS NULL AND "duplicate_threshold" IS NULL
    WHEN 'chase' THEN "supplier_id" IS NULL AND "duplicate_threshold" IS NULL
    WHEN 'notify_requester' THEN "supplier_id" IS NULL AND "cc_administrator" IS NULL AND "max_auto_reminders" IS NULL AND "first_chase_after_hours" IS NULL AND "interval_hours" IS NULL AND "duplicate_threshold" IS NULL
    WHEN 'merge_duplicate' THEN "supplier_id" IS NULL AND "cc_administrator" IS NULL AND "max_auto_reminders" IS NULL AND "first_chase_after_hours" IS NULL AND "interval_hours" IS NULL
  END
);

-- Techos estructurales.
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_merge_never_auto_check" CHECK ("action" <> 'merge_duplicate' OR "mode" <> 'auto');
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_chase_party_never_auto_check" CHECK ("action" <> 'chase' OR "party" = 'provider' OR ("mode" <> 'auto' AND COALESCE("max_auto_reminders", 0) = 0));

-- Rangos.
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_max_auto_reminders_check" CHECK ("max_auto_reminders" BETWEEN 0 AND 3);
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_first_chase_hours_check" CHECK ("first_chase_after_hours" BETWEEN 12 AND 720);
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_interval_hours_check" CHECK ("interval_hours" BETWEEN 12 AND 720);
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_duplicate_threshold_check" CHECK ("duplicate_threshold" BETWEEN 0.5 AND 1);

-- `version` identifica la configuración que autorizó una acción (`policyStamp` = `rule:<id>@<version>`): sube con CUALQUIER
-- cambio de contenido, lo escriba quien lo escriba. Un UPDATE que no cambia nada no la sube; quién editó o cuándo, tampoco cuenta.
CREATE FUNCTION "automation_rules_bump_version"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'version' - 'updated_at' - 'updated_by_user_id') IS DISTINCT FROM (to_jsonb(OLD) - 'version' - 'updated_at' - 'updated_by_user_id') THEN
    NEW."version" := OLD."version" + 1;
  ELSE
    NEW."version" := OLD."version";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "automation_rules_bump_version" BEFORE UPDATE ON "automation_rules" FOR EACH ROW EXECUTE FUNCTION "automation_rules_bump_version"();
