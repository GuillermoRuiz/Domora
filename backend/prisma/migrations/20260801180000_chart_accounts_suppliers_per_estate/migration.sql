-- Decisión de producto: las cuentas contables y los proveedores pasan de
-- ser "por gestora" a ser "por finca" -- cada finca tiene su propia
-- configuración contable, sin compartirla con otras fincas de la misma
-- administradora (ver doc/frontend-zoneless-audit-guide.md).

-- ── ChartAccount ──────────────────────────────────────────────────────────
-- 1) Agregar la columna nullable primero (hay 2 filas globales existentes,
--    administrator_id NULL, que se van a migrar antes de forzar NOT NULL).
ALTER TABLE "chart_accounts" ADD COLUMN "estate_id" UUID;

-- 2) El índice único viejo (administrator_id, code) choca con el backfill de
--    abajo -- todas las fincas de esta DB comparten gestora, así que
--    insertar el mismo code (622/700) por cada finca viola esa constraint
--    vieja si sigue activa. Se elimina antes de insertar.
DROP INDEX IF EXISTS "chart_accounts_administrator_id_code_key";

-- 3) Backfill: copiar cada cuenta global existente como una fila PROPIA por
--    cada finca (no una referencia compartida -- filas independientes que a
--    partir de acá se pueden editar por separado sin afectarse entre sí).
INSERT INTO "chart_accounts" (id, estate_id, administrator_id, code, name, short_name, type, parent_code)
SELECT gen_random_uuid(), e.id, e.administrator_id, ca.code, ca.name, ca.short_name, ca.type, ca.parent_code
FROM "chart_accounts" ca
CROSS JOIN "estates" e
WHERE ca.estate_id IS NULL;

-- 4) Movements/budget_items que referenciaban la fila global vieja se
--    re-apuntan a la copia nueva de su propia finca (mismo code). Subquery
--    correlacionada en vez de JOIN dentro del FROM -- Postgres no permite
--    referenciar la tabla del UPDATE dentro del ON de un JOIN en su FROM.
UPDATE "movements" m
SET account_id = (
  SELECT new_ca.id FROM "chart_accounts" new_ca
  WHERE new_ca.estate_id = m.estate_id
    AND new_ca.code = (SELECT code FROM "chart_accounts" WHERE id = m.account_id)
)
WHERE m.account_id IN (SELECT id FROM "chart_accounts" WHERE estate_id IS NULL);

UPDATE "budget_items" b
SET account_id = (
  SELECT new_ca.id FROM "chart_accounts" new_ca
  WHERE new_ca.estate_id = b.estate_id
    AND new_ca.code = (SELECT code FROM "chart_accounts" WHERE id = b.account_id)
)
WHERE b.account_id IN (SELECT id FROM "chart_accounts" WHERE estate_id IS NULL);

-- 5) Las filas globales originales quedan huérfanas (el código deja de usar
--    el fallback administrator_id IS NULL) -- se eliminan.
DELETE FROM "chart_accounts" WHERE estate_id IS NULL;

-- 6) Forzar NOT NULL ahora que toda fila remanente tiene estate_id.
ALTER TABLE "chart_accounts" ALTER COLUMN "estate_id" SET NOT NULL;
ALTER TABLE "chart_accounts" ALTER COLUMN "administrator_id" SET NOT NULL;

-- 7) FK a estates + nuevo índice único (estate_id, code) -- la finca es
--    ahora el scope real de unicidad (el índice viejo ya se eliminó en 2).
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_estate_id_fkey"
  FOREIGN KEY ("estate_id") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "chart_accounts_estate_id_code_key" ON "chart_accounts"("estate_id", "code");

-- 8) administrator_id ya no es nullable -- la FK original tenía ON DELETE
--    SET NULL (coherente con una columna nullable); se recrea sin eso.
ALTER TABLE "chart_accounts" DROP CONSTRAINT IF EXISTS "chart_accounts_administrator_id_fkey";
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_administrator_id_fkey"
  FOREIGN KEY ("administrator_id") REFERENCES "administrators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Supplier ──────────────────────────────────────────────────────────────
-- "estateId" (camelCase, sin @map) ya existía como columna nullable pero
-- nunca se usaba para filtrar -- tabla vacía en desarrollo (confirmado antes
-- de aplicar esta migración), así que no hace falta backfill.
ALTER TABLE "suppliers" ALTER COLUMN "estateId" SET NOT NULL;
