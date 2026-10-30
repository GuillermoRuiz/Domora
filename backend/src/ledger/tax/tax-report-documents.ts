import type { TableReport } from '../../common/reports/table-report';
import type { TaxReportsService } from './tax-reports.service';

type Report111 = Awaited<ReturnType<TaxReportsService['model111']>>;
type Report190 = Awaited<ReturnType<TaxReportsService['model190']>>;
type Report347 = Awaited<ReturnType<TaxReportsService['model347']>>;

const esDate = (iso: string) => iso.split('-').reverse().join('/');

function header(estate: {
  name: string;
  cif: string | null;
  address: string;
  location: string;
}): string[] {
  return [
    `${estate.name}${estate.cif ? ` · CIF ${estate.cif}` : ' · sin CIF registrado'}`,
    `${estate.address}, ${estate.location}`,
  ];
}

const KEY_LABELS: Record<string, string> = {
  A: 'A · Trabajo',
  G: 'G · Actividades profesionales',
  other: 'Otra (revisar)',
};

/** Documento del modelo 111 (casillas y detalle) para Excel o PDF. */
export function document111(r: Report111): TableReport {
  return {
    title: `Modelo 111 · ${r.quarter}.º trimestre ${r.year}`,
    fileName: `modelo-111-${r.year}-T${r.quarter}-${r.estate.name}`,
    subtitle: [
      ...header(r.estate),
      `Periodo: ${esDate(r.from)} a ${esDate(r.to)} · Plazo de presentación: hasta el ${esDate(r.deadline)}`,
    ],
    sections: [
      {
        title: 'Liquidación',
        columns: [
          { key: 'box', header: 'Casilla', width: 0.6 },
          { key: 'label', header: 'Concepto', width: 3 },
          { key: 'count', header: 'Nº', kind: 'int', width: 0.6 },
          { key: 'amount', header: 'Importe', kind: 'money', width: 1.2 },
        ],
        rows: [
          {
            box: '01',
            label: 'Rendimientos del trabajo · nº de perceptores',
            count: r.boxes['01'],
          },
          {
            box: '02',
            label: 'Rendimientos del trabajo · importe de las percepciones',
            amount: r.boxes['02'],
          },
          {
            box: '03',
            label: 'Rendimientos del trabajo · importe de las retenciones',
            amount: r.boxes['03'],
          },
          {
            box: '07',
            label: 'Actividades económicas · nº de perceptores',
            count: r.boxes['07'],
          },
          {
            box: '08',
            label: 'Actividades económicas · importe de las percepciones',
            amount: r.boxes['08'],
          },
          {
            box: '09',
            label: 'Actividades económicas · importe de las retenciones',
            amount: r.boxes['09'],
          },
        ],
        totals: {
          box: '28',
          label: 'Suma de retenciones',
          amount: r.boxes['28'],
        },
      },
      {
        title: 'Detalle de las retenciones pagadas en el trimestre',
        empty: 'Sin retenciones pagadas en el trimestre.',
        columns: [
          { key: 'date', header: 'Fecha de pago', width: 1 },
          { key: 'name', header: 'Perceptor', width: 2 },
          { key: 'nif', header: 'NIF', width: 1 },
          { key: 'key', header: 'Clave', width: 1.4 },
          { key: 'doc', header: 'Documento', width: 1.4 },
          {
            key: 'perception',
            header: 'Percepción',
            kind: 'money',
            width: 1.1,
          },
          {
            key: 'withholding',
            header: 'Retención',
            kind: 'money',
            width: 1.1,
          },
        ],
        rows: r.detail.map((d) => ({
          date: esDate(d.date),
          name: d.name,
          nif: d.nif ?? 'Falta NIF',
          key: KEY_LABELS[d.key],
          doc: d.documentRef,
          perception: d.perception,
          withholding: d.withholding,
        })),
      },
    ],
    notes: [
      'Retenciones por fecha de pago: en los pagos parciales se prorratean la base y la retención.',
      `Ingresado en Hacienda para este trimestre: ${r.settled.toFixed(2)} €. Pendiente: ${r.pending.toFixed(2)} €.`,
      ...(r.unclassified.withholdings > 0
        ? [
            `Hay ${r.unclassified.withholdings.toFixed(2)} € retenidos con clave "otra" que no se suman: si son de un alquiler van al modelo 115.`,
          ]
        : []),
      'Documento de trabajo para preparar la declaración; la presentación la hace la gestora en la sede de la AEAT.',
    ],
  };
}

/** Documento del modelo 190 (resumen anual por perceptor). */
export function document190(r: Report190): TableReport {
  return {
    title: `Modelo 190 · resumen anual ${r.year}`,
    fileName: `modelo-190-${r.year}-${r.estate.name}`,
    subtitle: header(r.estate),
    sections: [
      {
        empty: 'Sin retenciones pagadas en el año.',
        columns: [
          { key: 'nif', header: 'NIF', width: 1 },
          { key: 'name', header: 'Perceptor', width: 2.4 },
          { key: 'key', header: 'Clave', width: 0.6 },
          { key: 'subkey', header: 'Subclave', width: 0.7 },
          {
            key: 'perceptions',
            header: 'Percepciones íntegras',
            kind: 'money',
            width: 1.3,
          },
          {
            key: 'withholdings',
            header: 'Retenciones',
            kind: 'money',
            width: 1.2,
          },
        ],
        rows: r.rows.map((x) => ({
          ...x,
          nif: x.nif ?? 'Falta NIF',
          key: x.key === 'other' ? 'Otra' : x.key,
          subkey: x.subkey ?? '',
        })),
        totals: {
          name: `${r.totals.recipients} perceptores`,
          perceptions: r.totals.perceptions,
          withholdings: r.totals.withholdings,
        },
      },
    ],
    notes: [
      'Se presenta del 1 al 31 de enero del año siguiente. Debe cuadrar con la suma de los cuatro modelos 111 del año.',
      ...(r.missingNif.length
        ? [
            `Falta el NIF de: ${r.missingNif.join(', ')}. Sin él no se puede presentar.`,
          ]
        : []),
    ],
  };
}

const REASONS: Record<string, string> = {
  art_33_5: 'Excluido (art. 33.5 RGAT: suministros y seguros)',
  retencion: 'Con retención: se declara en el 190',
  umbral: 'No supera 3.005,06 €',
};

/** Documento del modelo 347 (operaciones con terceros). */
export function document347(r: Report347): TableReport {
  return {
    title: `Modelo 347 · operaciones con terceros ${r.year}`,
    fileName: `modelo-347-${r.year}-${r.estate.name}`,
    subtitle: header(r.estate),
    sections: [
      {
        title: 'Adquisiciones (clave A) que superan 3.005,06 € con IVA',
        empty: 'Ningún proveedor supera el umbral.',
        columns: [
          { key: 'nif', header: 'NIF', width: 1 },
          { key: 'name', header: 'Proveedor', width: 2.2 },
          { key: 'q1', header: '1T', kind: 'money', width: 1 },
          { key: 'q2', header: '2T', kind: 'money', width: 1 },
          { key: 'q3', header: '3T', kind: 'money', width: 1 },
          { key: 'q4', header: '4T', kind: 'money', width: 1 },
          { key: 'total', header: 'Total anual', kind: 'money', width: 1.1 },
        ],
        rows: r.purchases.map((p) => ({
          nif: p.nif ?? 'Falta NIF',
          name: p.name,
          q1: p.quarters[0],
          q2: p.quarters[1],
          q3: p.quarters[2],
          q4: p.quarters[3],
          total: p.total,
        })),
      },
      {
        title: 'Terceros que no se declaran',
        empty: 'Ninguno.',
        columns: [
          { key: 'name', header: 'Proveedor', width: 2.2 },
          { key: 'reason', header: 'Motivo', width: 2.6 },
          { key: 'total', header: 'Importe', kind: 'money', width: 1.1 },
        ],
        rows: r.excluded.map((e) => ({
          name: e.name,
          reason: REASONS[e.reason],
          total: e.total,
        })),
      },
    ],
    notes: [
      'Operaciones imputadas por la fecha de la factura. Se presenta en febrero del año siguiente.',
      'Ingresos de terceros (alquileres de elementos comunes): todavía no se registran con su tercero; se incluirán cuando la tesorería lo permita.',
      ...(r.missingNif.length
        ? [
            `Falta el NIF de: ${r.missingNif.join(', ')}. Sin él no se puede presentar.`,
          ]
        : []),
    ],
  };
}
