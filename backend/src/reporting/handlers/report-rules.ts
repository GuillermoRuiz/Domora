import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import type {
  ReportColumn,
  ReportSection,
  ReportCell,
} from '../../common/reports/table-report';

export const REPORT_LIMIT = 20000;
export function checkLimit<T>(rows: T[], limit = REPORT_LIMIT): T[] {
  if (rows.length > limit)
    throw new UnprocessableEntityException(
      `El informe supera ${limit} filas. Reduce el periodo o las comunidades.`,
    );
  return rows;
}
export const day = (value: Date | null | undefined): string =>
  value?.toISOString().slice(0, 10) ?? '';
export const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
export const endDay = (value: string): Date =>
  new Date(`${value}T23:59:59.999Z`);
export const dateRange = (from?: string, to?: string) => ({
  ...(from ? { gte: date(from) } : {}),
  ...(to ? { lte: endDay(to) } : {}),
});
export function table(
  columns: ReportColumn[],
  rows: Record<string, ReportCell>[],
  title?: string,
): ReportSection {
  return {
    columns,
    rows: checkLimit(rows),
    title,
    empty: 'No hay registros para los filtros seleccionados.',
  };
}
export const text = (key: string, header: string): ReportColumn => ({
  key,
  header,
});
export const money = (key: string, header: string): ReportColumn => ({
  key,
  header,
  kind: 'money',
});
export const int = (key: string, header: string): ReportColumn => ({
  key,
  header,
  kind: 'int',
});
export function sum(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((a, b) => a.plus(b), new Prisma.Decimal(0));
}

export function agingBucket(
  due: Date | null,
  asOf: Date,
  balance: Prisma.Decimal,
): string | null {
  if (!balance.gt(0)) return null;
  if (!due) return 'unknown';
  const days = Math.floor(
    (date(day(asOf)).getTime() - date(day(due)).getTime()) / 86400000,
  );
  if (days <= 0) return 'notDue';
  return days < 30
    ? 'under30'
    : days <= 60
      ? '30to60'
      : days <= 90
        ? '61to90'
        : 'over90';
}

/** Only checked Spanish NIF/NIE/CIF identities are consolidated. Foreign IDs
 * without a supported checksum remain distinct; a name never proves identity. */
export function validFiscalIdentity(
  country?: string | null,
  value?: string | null,
): string | null {
  if (country !== 'ES' || !value) return null;
  const id = value.replace(/[\s.-]/g, '').toUpperCase();
  const dni = /^[XYZ]/.test(id)
    ? id.replace('X', '0').replace('Y', '1').replace('Z', '2')
    : id;
  if (
    /^\d{8}[A-Z]$/.test(dni) &&
    'TRWAGMYFPDXBNJZSQVHLCKE'[Number(dni.slice(0, 8)) % 23] === dni[8]
  )
    return `tax:ES:${id}`;
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(id)) {
    const digits = id.slice(1, 8).split('').map(Number);
    const total = digits.reduce(
      (n, d, i) => n + (i % 2 ? d : Math.floor((d * 2) / 10) + ((d * 2) % 10)),
      0,
    );
    const check = (10 - (total % 10)) % 10;
    const expected = /^[PQRSNW]/.test(id)
      ? 'JABCDEFGHI'[check]
      : /^[ABEH]/.test(id)
        ? String(check)
        : `${check}${'JABCDEFGHI'[check]}`;
    if (expected.includes(id[8])) return `tax:ES:${id}`;
  }
  return null;
}
export function ownerIdentity(owner: {
  id: string;
  userId?: string | null;
  name?: string;
  taxCountry?: string | null;
  taxId?: string | null;
}): string {
  return owner.userId
    ? `user:${owner.userId}`
    : (validFiscalIdentity(owner.taxCountry, owner.taxId) ??
        `record:${owner.id}`);
}
export interface StatusEvent {
  date: Date;
  fromStatus: string | null;
  toStatus: string | null;
}
export function resolutionDurationDays(
  createdAt: Date,
  events: StatusEvent[],
): number | null {
  const changes = events
    .filter((e) => e.fromStatus && e.toStatus)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const last = changes.at(-1);
  if (!last || !['Resuelta', 'Cerrada'].includes(last.toStatus!)) return null;
  // Resuelta -> Cerrada is administrative closure, not another resolution.
  let terminal = last;
  for (
    let i = changes.length - 2;
    i >= 0 && ['Resuelta', 'Cerrada'].includes(changes[i].toStatus!);
    i--
  )
    terminal = changes[i];
  const elapsed = (terminal.date.getTime() - createdAt.getTime()) / 86400000;
  return elapsed >= 0 ? elapsed : null;
}
