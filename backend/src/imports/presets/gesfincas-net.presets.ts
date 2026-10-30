import type { ImportSourcePlatform } from '../../prisma/client';

export type ImportEntityType =
  | 'property'
  | 'owner'
  | 'movement'
  | 'receipt'
  | 'remesa'
  | 'opening-balance'
  | 'supplier-invoice';

export interface ColumnPreset {
  targetField: string;
  label: string;
  required: boolean;
  /**
   * Cabeceras probables en el origen — SOLO para prerrellenar el mapeo en
   * el asistente, nunca para asumir la columna a ciegas. Ni Gesfincas ni
   * Fynkus publican un mapeo de campos exacto (verificado por
   * investigación externa al planear esta funcionalidad); estas listas son
   * la mejor aproximación disponible sin un fichero de muestra real y
   * deberán afinarse contra exports reales de gestoras piloto.
   */
  headerGuesses: string[];
}

const PROPERTY_PRESETS: ColumnPreset[] = [
  {
    targetField: 'ref',
    label: 'Referencia de la unidad',
    required: false,
    headerGuesses: ['Referencia', 'Nº Finca', 'Numero Finca', 'Elemento', 'Finca Registral'],
  },
  {
    targetField: 'type',
    label: 'Tipo (Piso/Casa/Parking/Trastero/Local)',
    required: false,
    headerGuesses: ['Tipo', 'Tipo Elemento', 'Naturaleza', 'Uso'],
  },
  {
    targetField: 'participationQuota',
    label: 'Coeficiente de participación (%)',
    required: false,
    headerGuesses: ['Coeficiente', '% Participación', '% Participacion', 'Coef.', 'Coef'],
  },
  {
    targetField: 'floor',
    label: 'Piso',
    required: false,
    headerGuesses: ['Piso', 'Planta'],
  },
  {
    targetField: 'door',
    label: 'Puerta',
    required: false,
    headerGuesses: ['Puerta', 'Letra'],
  },
  {
    targetField: 'quotaMonthly',
    label: 'Cuota mensual',
    required: false,
    headerGuesses: ['Cuota', 'Cuota Mensual', 'Importe Cuota'],
  },
];

const OWNER_PRESETS: ColumnPreset[] = [
  {
    targetField: 'fullName',
    label: 'Nombre completo',
    required: true,
    headerGuesses: ['Nombre', 'Propietario', 'Titular', 'Nombre y Apellidos'],
  },
  {
    targetField: 'propertyRef',
    label: 'Referencia de la unidad (para vincular)',
    required: true,
    headerGuesses: ['Referencia', 'Nº Finca', 'Numero Finca', 'Elemento'],
  },
  {
    targetField: 'taxId',
    label: 'NIF/CIF',
    required: false,
    headerGuesses: ['NIF', 'CIF', 'DNI', 'Tax Id'],
  },
  {
    targetField: 'email',
    label: 'Email',
    required: false,
    headerGuesses: ['Email', 'Correo', 'E-mail', 'Correo Electrónico'],
  },
  {
    targetField: 'phone',
    label: 'Teléfono',
    required: false,
    headerGuesses: ['Teléfono', 'Telefono', 'Móvil', 'Movil'],
  },
  {
    targetField: 'postalAddress',
    label: 'Dirección de correspondencia',
    required: false,
    headerGuesses: ['Dirección', 'Direccion', 'Correspondencia', 'Dirección Postal'],
  },
];

/**
 * Movimientos (libro mayor histórico) — Fase 3. `accountCode` dispara un
 * find-or-create de `ChartAccount`: el histórico de otro programa suele
 * traer subcuentas (6280001…) que no están en la plantilla de la finca
 * (ledger/chart/chart-template.ts).
 */
const MOVEMENT_PRESETS: ColumnPreset[] = [
  {
    targetField: 'date',
    label: 'Fecha',
    required: true,
    headerGuesses: ['Fecha', 'Fecha Movimiento'],
  },
  {
    targetField: 'concept',
    label: 'Concepto',
    required: true,
    headerGuesses: ['Concepto', 'Descripción', 'Descripcion'],
  },
  {
    targetField: 'accountCode',
    label: 'Código de cuenta contable',
    required: true,
    headerGuesses: ['Cuenta', 'Código Cuenta', 'Codigo Cuenta', 'Cta.'],
  },
  {
    targetField: 'accountName',
    label: 'Nombre de la cuenta (si hay que crearla)',
    required: false,
    headerGuesses: ['Nombre Cuenta', 'Descripción Cuenta'],
  },
  {
    targetField: 'type',
    label: 'Tipo (income/expense/transfer)',
    required: true,
    headerGuesses: ['Tipo', 'Tipo Movimiento', 'Debe/Haber'],
  },
  {
    targetField: 'amount',
    label: 'Importe',
    required: true,
    headerGuesses: ['Importe', 'Importe Movimiento'],
  },
  {
    targetField: 'reference',
    label: 'Referencia',
    required: false,
    headerGuesses: ['Referencia', 'Nº Factura', 'Numero Factura'],
  },
];

/**
 * Recibos históricos — Fase 3. Los snapshots (nombre/NIF/IBAN del
 * propietario en el momento de emisión) se toman DIRECTAMENTE de las
 * columnas de esta fila, nunca del propietario actual — ver el comentario
 * legal en `AccountingReceipt` (schema.prisma).
 */
const RECEIPT_PRESETS: ColumnPreset[] = [
  {
    targetField: 'no',
    label: 'Número de recibo (del origen)',
    required: true,
    headerGuesses: ['Nº Recibo', 'Numero Recibo', 'Recibo', 'Nº'],
  },
  {
    targetField: 'periodKey',
    label: 'Periodo (AAAA-MM)',
    required: true,
    headerGuesses: ['Periodo', 'Período', 'Mes'],
  },
  {
    targetField: 'propertyRef',
    label: 'Referencia de la unidad',
    required: true,
    headerGuesses: ['Referencia', 'Nº Finca', 'Numero Finca', 'Elemento'],
  },
  {
    targetField: 'ownerName',
    label: 'Nombre del propietario (en el momento de emisión)',
    required: false,
    headerGuesses: ['Propietario', 'Titular', 'Nombre'],
  },
  {
    targetField: 'ownerTaxId',
    label: 'NIF/CIF del propietario',
    required: false,
    headerGuesses: ['NIF', 'CIF', 'DNI'],
  },
  {
    targetField: 'iban',
    label: 'IBAN (si era domiciliado)',
    required: false,
    headerGuesses: ['IBAN', 'Cuenta Bancaria'],
  },
  {
    targetField: 'concept',
    label: 'Concepto',
    required: true,
    headerGuesses: ['Concepto', 'Descripción'],
  },
  {
    targetField: 'kind',
    label: 'Tipo de recibo',
    required: false,
    headerGuesses: ['Tipo Recibo', 'Naturaleza'],
  },
  {
    targetField: 'amount',
    label: 'Importe',
    required: true,
    headerGuesses: ['Importe', 'Importe Recibo'],
  },
  {
    targetField: 'dueDate',
    label: 'Fecha de vencimiento',
    required: false,
    headerGuesses: ['Vencimiento', 'Fecha Vencimiento'],
  },
  {
    targetField: 'status',
    label: 'Estado (Pagada/Pendiente/Devuelto)',
    required: true,
    headerGuesses: ['Estado', 'Situación'],
  },
  {
    targetField: 'date',
    label: 'Fecha de emisión',
    required: true,
    headerGuesses: ['Fecha', 'Fecha Emisión'],
  },
  {
    targetField: 'method',
    label: 'Forma de pago',
    required: true,
    headerGuesses: ['Forma de Pago', 'Método de Pago', 'Metodo de Pago'],
  },
  {
    targetField: 'returnCode',
    label: 'Código de devolución (si aplica)',
    required: false,
    headerGuesses: ['Código Devolución', 'Codigo Devolucion'],
  },
  {
    targetField: 'returnReason',
    label: 'Motivo de devolución (si aplica)',
    required: false,
    headerGuesses: ['Motivo Devolución', 'Motivo Devolucion'],
  },
];

/**
 * Remesas ya presentadas — Fase 3, la más especulativa (el plan ya
 * advertía que suele venir escaso en un export real). Cada fila es una
 * LÍNEA que se vincula a un recibo ya importado por `periodKey`+`receiptNo`
 * — NO se importan mandatos SEPA (decisión del proyecto: `Mandate` exige un
 * `titularUserId` real y una firma legal, ninguna de las dos cosas viene de
 * un Excel), así que `RemesaLine.mandateId` queda siempre null y el IBAN se
 * hereda del propio recibo si no se mapea aparte.
 */
const REMESA_PRESETS: ColumnPreset[] = [
  {
    targetField: 'remesaRef',
    label: 'Referencia de la remesa (agrupa líneas)',
    required: true,
    headerGuesses: ['Remesa', 'Nº Remesa', 'Numero Remesa', 'Referencia Remesa'],
  },
  {
    targetField: 'periodKey',
    label: 'Periodo del recibo (AAAA-MM)',
    required: true,
    headerGuesses: ['Periodo', 'Período'],
  },
  {
    targetField: 'receiptNo',
    label: 'Número de recibo (para vincular)',
    required: true,
    headerGuesses: ['Nº Recibo', 'Numero Recibo', 'Recibo'],
  },
  {
    targetField: 'amount',
    label: 'Importe de la línea',
    required: true,
    headerGuesses: ['Importe'],
  },
  {
    targetField: 'status',
    label: 'Estado de la línea (Cobrado/Pendiente/Devuelto)',
    required: true,
    headerGuesses: ['Estado', 'Situación'],
  },
  {
    targetField: 'mandateSeq',
    label: 'Secuencia SEPA (FRST/RCUR/OOFF/FNAL)',
    required: false,
    headerGuesses: ['Secuencia', 'Seq'],
  },
  {
    targetField: 'scheme',
    label: 'Esquema (CORE/B2B)',
    required: false,
    headerGuesses: ['Esquema', 'Scheme'],
  },
  {
    targetField: 'remesaConcept',
    label: 'Concepto de la remesa',
    required: false,
    headerGuesses: ['Concepto Remesa'],
  },
  {
    targetField: 'presentedAt',
    label: 'Fecha de presentación',
    required: false,
    headerGuesses: ['Fecha Presentación', 'Fecha Presentacion'],
  },
  {
    targetField: 'chargeDate',
    label: 'Fecha de cargo',
    required: false,
    headerGuesses: ['Fecha Cargo', 'Fecha Cobro'],
  },
  {
    targetField: 'returnCode',
    label: 'Código de devolución (si aplica)',
    required: false,
    headerGuesses: ['Código Devolución', 'Codigo Devolucion'],
  },
  {
    targetField: 'returnReason',
    label: 'Motivo de devolución (si aplica)',
    required: false,
    headerGuesses: ['Motivo Devolución', 'Motivo Devolucion'],
  },
];

/**
 * Saldos iniciales (fase 9) — bancos, deudas por propiedad y año, anticipos
 * y otros saldos (555/117/4751…) en una sola hoja con columna `tipo`. Solo
 * rellena el borrador de `OpeningBalanceSet`: no contabiliza nada por sí
 * misma, la gestora revisa y contabiliza desde el asistente.
 */
const OPENING_BALANCE_PRESETS: ColumnPreset[] = [
  {
    targetField: 'tipo',
    label: 'Tipo de saldo (banco/deuda/anticipo/otro)',
    required: true,
    headerGuesses: ['Tipo', 'Tipo Saldo'],
  },
  {
    targetField: 'ref',
    label: 'Referencia (alias del banco o de la propiedad)',
    required: false,
    headerGuesses: ['Referencia', 'Cuenta', 'Nº Finca', 'Numero Finca'],
  },
  {
    targetField: 'concept',
    label: 'Concepto',
    required: true,
    headerGuesses: ['Concepto', 'Descripción'],
  },
  {
    targetField: 'amount',
    label: 'Importe',
    required: true,
    headerGuesses: ['Importe'],
  },
  {
    targetField: 'originYear',
    label: 'Año de origen (solo deuda)',
    required: false,
    headerGuesses: ['Año', 'Año Origen', 'Ejercicio'],
  },
  {
    targetField: 'dueDate',
    label: 'Fecha de vencimiento (solo deuda)',
    required: false,
    headerGuesses: ['Vencimiento', 'Fecha Vencimiento'],
  },
  {
    targetField: 'role',
    label: 'Cuenta destino (solo otro: reserva/remanente/retenciones…)',
    required: false,
    headerGuesses: ['Cuenta Destino', 'Cuenta'],
  },
  {
    targetField: 'side',
    label: 'Debe/Haber (solo otro)',
    required: false,
    headerGuesses: ['Debe/Haber', 'Lado'],
  },
];

/**
 * Facturas de proveedor pendientes al arrancar la contabilidad (fase 9) —
 * van al borrador de saldos iniciales (`OpeningSupplierInvoice`), igual que
 * `opening-balance`: no contabilizan nada por sí mismas.
 */
const SUPPLIER_INVOICE_PRESETS: ColumnPreset[] = [
  {
    targetField: 'supplierName',
    label: 'Nombre del proveedor (debe existir ya en la finca)',
    required: true,
    headerGuesses: ['Proveedor', 'Nombre Proveedor'],
  },
  {
    targetField: 'number',
    label: 'Número de factura',
    required: true,
    headerGuesses: ['Nº Factura', 'Numero Factura', 'Factura'],
  },
  {
    targetField: 'concept',
    label: 'Concepto',
    required: true,
    headerGuesses: ['Concepto', 'Descripción'],
  },
  {
    targetField: 'issueDate',
    label: 'Fecha de factura',
    required: true,
    headerGuesses: ['Fecha', 'Fecha Factura'],
  },
  {
    targetField: 'dueDate',
    label: 'Fecha de vencimiento',
    required: false,
    headerGuesses: ['Vencimiento', 'Fecha Vencimiento'],
  },
  {
    targetField: 'amount',
    label: 'Importe pendiente de pago',
    required: true,
    headerGuesses: ['Importe', 'Pendiente', 'Importe Pendiente'],
  },
];

const PRESETS_BY_ENTITY: Record<ImportEntityType, ColumnPreset[]> = {
  property: PROPERTY_PRESETS,
  owner: OWNER_PRESETS,
  movement: MOVEMENT_PRESETS,
  receipt: RECEIPT_PRESETS,
  remesa: REMESA_PRESETS,
  'opening-balance': OPENING_BALANCE_PRESETS,
  'supplier-invoice': SUPPLIER_INVOICE_PRESETS,
};

/** Perfil genérico: mismos campos destino, sin cabeceras-guess (el usuario mapea todo a mano). */
function withoutGuesses(presets: ColumnPreset[]): ColumnPreset[] {
  return presets.map((p) => ({ ...p, headerGuesses: [] }));
}

export function presetsFor(
  platform: ImportSourcePlatform,
  entityType: ImportEntityType,
): ColumnPreset[] {
  const base = PRESETS_BY_ENTITY[entityType];
  return platform === 'GESFINCAS_NET' ? base : withoutGuesses(base);
}

const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizeHeader(value: string): string {
  return value.toLowerCase().trim().normalize('NFD').replace(COMBINING_DIACRITICS, '');
}

/** Compara cabeceras reales del fichero contra los `headerGuesses` de cada campo — coincidencia exacta tras normalizar acentos/mayúsculas. */
export function suggestMapping(
  headers: string[],
  presets: ColumnPreset[],
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const preset of presets) {
    const guesses = new Set(preset.headerGuesses.map(normalizeHeader));
    const match = headers.find((h) => guesses.has(normalizeHeader(h)));
    if (match) mapping[preset.targetField] = match;
  }
  return mapping;
}
