import { AccountingEstate } from '../../core/models';

function csvText(value: string): string {
  const safe = /^[\s]*[=+@\-]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function accountingCsv(estates: AccountingEstate[]): string {
  const header =
    'Comunidad;Dirección;Saldo actual;Ingresos del mes;Gastos del mes;Fondo de reserva;Morosidad';
  const rows = estates.map((estate) =>
    [
      csvText(estate.name),
      csvText(
        [
          [estate.address, estate.streetNumber].filter(Boolean).join(' '),
          estate.location,
        ]
          .filter(Boolean)
          .join(', '),
      ),
      ...[
        estate.balance,
        estate.income,
        estate.expenses,
        estate.reserve,
        estate.delinquency,
      ].map((value) => value.toFixed(2).replace('.', ',')),
    ].join(';'),
  );
  return '\uFEFF' + [header, ...rows].join('\r\n');
}
