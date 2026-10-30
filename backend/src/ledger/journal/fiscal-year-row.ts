import type { Prisma } from '../../prisma/client';

type Db = Prisma.TransactionClient;

/**
 * Crea la fila del ejercicio si no existe, con la configuración del fondo
 * de reserva por defecto de la finca (AccountingSettings). Única vía de
 * alta de ejercicios: la usan el diario al contabilizar y el servicio de
 * ejercicios al aprobar o cerrar. ON CONFLICT evita la carrera de dos altas
 * simultáneas del mismo año.
 */
export async function ensureFiscalYearRow(
  db: Db,
  estateId: string,
  year: number,
): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "fiscal_years" (
      "id", "estate_id", "year", "start_date", "end_date", "status",
      "reserve_mode", "reserve_share_pct",
      "reserve_allocation_rule", "reserve_allocation_value"
    )
    SELECT gen_random_uuid(), ${estateId}::uuid, ${year},
           make_date(${year}::int, 1, 1), make_date(${year}::int, 12, 31), 'Abierto',
           coalesce(s."default_reserve_mode", 'receipt_share'), s."default_reserve_share_pct",
           s."default_reserve_allocation_rule", s."default_reserve_allocation_value"
      FROM (SELECT 1) AS one
      LEFT JOIN "accounting_settings" s ON s."estate_id" = ${estateId}::uuid
    ON CONFLICT ("estate_id", "year") DO NOTHING
  `;
}
