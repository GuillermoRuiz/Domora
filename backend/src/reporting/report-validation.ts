import { BadRequestException } from '@nestjs/common';
import type { ReportDefinition, ReportInput } from './reporting.types';

export function reportDay(value: string): Date {
  const day = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('La fecha indicada no es válida.');
  }
  return day;
}

export function validateReportInput(
  definition: ReportDefinition,
  input: ReportInput,
  estateCount: number,
): void {
  if (definition.scopeMode === 'single' && estateCount !== 1)
    throw new BadRequestException('Este informe requiere una comunidad.');
  for (const value of [
    input.from,
    input.to,
    input.asOf,
    input.compareFrom,
    input.compareTo,
  ])
    if (value) reportDay(value);
  const range = (from?: string, to?: string) => {
    if (!from || !to)
      throw new BadRequestException('Indica las dos fechas del periodo.');
    if (from > to)
      throw new BadRequestException(
        'La fecha inicial no puede ser posterior a la final.',
      );
    if (reportDay(to).getTime() - reportDay(from).getTime() > 3660 * 86400000)
      throw new BadRequestException('El periodo máximo es de diez años.');
  };
  if (['range', 'comparison'].includes(definition.periodMode))
    range(input.from, input.to);
  if (definition.periodMode === 'comparison')
    range(input.compareFrom, input.compareTo);
  if (['year', 'quarter'].includes(definition.periodMode) && !input.fiscalYear)
    throw new BadRequestException('Selecciona un ejercicio.');
  if (definition.periodMode === 'quarter' && !input.quarter)
    throw new BadRequestException('Selecciona un trimestre.');
  if (definition.periodMode === 'asOf' && !input.asOf)
    throw new BadRequestException('Selecciona una fecha de corte.');
  for (const field of Object.keys(input.filters ?? {})) {
    if (
      input.filters?.[field as keyof NonNullable<ReportInput['filters']>] !=
        null &&
      !definition.filters.includes(field as ReportDefinition['filters'][number])
    )
      throw new BadRequestException('Este filtro no corresponde al informe.');
  }
  if (definition.filters.includes('accountCode') && !input.filters?.accountCode)
    throw new BadRequestException('Indica el código contable.');
  if (definition.key === 'monthly-executive') {
    const last = new Date(
      Date.UTC(
        reportDay(input.from!).getUTCFullYear(),
        reportDay(input.from!).getUTCMonth() + 1,
        0,
      ),
    )
      .toISOString()
      .slice(0, 10);
    if (!input.from!.endsWith('-01') || input.to !== last)
      throw new BadRequestException(
        'El informe mensual requiere un mes natural completo.',
      );
  }
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
  }).format(new Date());
  if (
    (input.asOf && input.asOf > today) ||
    (['meeting-finance', 'monthly-executive'].includes(definition.key) &&
      input.to &&
      input.to > today)
  ) {
    throw new BadRequestException('La fecha de corte no puede ser futura.');
  }
}
