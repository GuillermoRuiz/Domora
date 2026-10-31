import { Prisma } from '../prisma/client';

export type SupplierContractStatus =
  'Programado' | 'Activo' | 'PorVencer' | 'Vencido' | 'Cancelado';

/** Business dates are UTC days; the end date is inclusive. */
export function contractStatus(
  contract: {
    startDate?: Date;
    endDate: Date | null;
    cancelledAt: Date | null;
  },
  now = new Date(),
): SupplierContractStatus {
  if (contract.cancelledAt) return 'Cancelado';
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  if (contract.startDate && contract.startDate.getTime() > today)
    return 'Programado';
  if (!contract.endDate) return 'Activo';
  const days = (contract.endDate.getTime() - today) / 86400000;
  if (days < 0) return 'Vencido';
  return days <= 30 ? 'PorVencer' : 'Activo';
}

/** No conversion across currencies, extrapolation of one-off payments or OTHER. */
export function annualizedContractCost(
  amount: string | number | Prisma.Decimal | null | undefined,
  frequency: string | null | undefined,
): Prisma.Decimal | null {
  if (amount == null) return null;
  const multiplier = { MONTHLY: 12, QUARTERLY: 4, SEMIANNUAL: 2, ANNUAL: 1 }[
    frequency ?? ''
  ];
  return multiplier ? new Prisma.Decimal(amount).mul(multiplier) : null;
}
