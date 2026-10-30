import type { AccountNature, AccountRole } from '../../prisma/client';

/**
 * Plantilla del plan de cuentas de una comunidad de propietarios
 * (doc/contabilidad/adr-partida-doble.md, decisión D2).
 *
 * Se copia como filas PROPIAS de cada finca y marcadas como de sistema: no
 * se borran ni cambian de código (lo impide la base de datos), pero la
 * gestora puede renombrarlas, archivarlas o colgarles subcuentas. Las reglas
 * de contabilización las localizan por `systemRole`, nunca por código.
 */
export interface TemplateAccount {
  code: string;
  name: string;
  shortName?: string;
  nature: AccountNature;
  systemRole?: AccountRole;
  /** false = cuenta agrupadora (p. ej. 572, que tiene un banco por subcuenta). */
  postable?: boolean;
  requiresProperty?: boolean;
  requiresSupplier?: boolean;
}

const expense = (
  code: string,
  name: string,
  systemRole?: AccountRole,
  shortName?: string,
): TemplateAccount => ({
  code,
  name,
  shortName,
  nature: 'expense',
  systemRole,
});
const income = (
  code: string,
  name: string,
  systemRole?: AccountRole,
  shortName?: string,
): TemplateAccount => ({
  code,
  name,
  shortName,
  nature: 'income',
  systemRole,
});

export const COMMUNITY_CHART_TEMPLATE: readonly TemplateAccount[] = [
  // ── Grupo 1: patrimonio de la comunidad ────────────────────────────────
  {
    code: '117',
    name: 'Fondo de reserva',
    nature: 'equity',
    systemRole: 'reserve_fund',
  },
  { code: '120', name: 'Remanente', nature: 'equity', systemRole: 'retained' },
  {
    code: '121',
    name: 'Resultados negativos de ejercicios anteriores',
    shortName: 'Resultados negativos ant.',
    nature: 'equity',
    systemRole: 'prior_losses',
  },
  {
    code: '129',
    name: 'Resultado del ejercicio',
    nature: 'equity',
    systemRole: 'result',
  },

  // ── Grupo 4: propietarios, proveedores y administraciones ─────────────
  {
    code: '400',
    name: 'Proveedores',
    nature: 'liability',
    systemRole: 'suppliers_payable',
    requiresSupplier: true,
  },
  {
    code: '410',
    name: 'Acreedores por prestaciones de servicios',
    shortName: 'Acreedores',
    nature: 'liability',
    systemRole: 'creditors_payable',
    requiresSupplier: true,
  },
  {
    code: '430',
    name: 'Propietarios',
    nature: 'asset',
    systemRole: 'owners_receivable',
    requiresProperty: true,
  },
  {
    code: '465',
    name: 'Remuneraciones pendientes de pago',
    shortName: 'Nóminas pendientes',
    nature: 'liability',
    systemRole: 'salaries_payable',
  },
  {
    code: '4751',
    name: 'Hacienda Pública, acreedora por retenciones practicadas',
    shortName: 'HP retenciones',
    nature: 'liability',
    systemRole: 'withholding_payable',
  },
  {
    code: '476',
    name: 'Organismos de la Seguridad Social, acreedores',
    shortName: 'Seguridad Social',
    nature: 'liability',
    systemRole: 'social_security_payable',
  },

  // ── Grupo 5: tesorería ─────────────────────────────────────────────────
  {
    code: '555',
    name: 'Partidas pendientes de aplicación',
    shortName: 'Pendiente de aplicar',
    nature: 'liability',
    systemRole: 'suspense',
  },
  { code: '570', name: 'Caja', nature: 'asset', systemRole: 'cash' },
  // Agrupadora: cada cuenta bancaria es una subcuenta 572xxxx (BankAccount).
  { code: '572', name: 'Bancos', nature: 'asset', postable: false },

  // ── Grupo 6: gastos ────────────────────────────────────────────────────
  expense('621', 'Arrendamientos y cánones', undefined, 'Arrendamientos'),
  expense(
    '622',
    'Reparaciones y conservación',
    undefined,
    'Reparac. y conservac.',
  ),
  expense(
    '623',
    'Servicios de profesionales independientes',
    undefined,
    'Servicios profesionales',
  ),
  expense('625', 'Primas de seguros', undefined, 'Seguros'),
  expense(
    '626',
    'Servicios bancarios y similares',
    'bank_fees',
    'Servicios bancarios',
  ),
  expense('628', 'Suministros'),
  expense('629', 'Otros servicios'),
  expense('631', 'Otros tributos', undefined, 'Tributos'),
  expense('640', 'Sueldos y salarios', 'wages'),
  expense(
    '642',
    'Seguridad Social a cargo de la comunidad',
    'employer_ss',
    'Seg. Social comunidad',
  ),
  expense(
    '650',
    'Pérdidas de créditos incobrables',
    'bad_debts',
    'Incobrables',
  ),
  expense('669', 'Otros gastos financieros', undefined, 'Gastos financieros'),
  expense('678', 'Gastos excepcionales'),

  // ── Grupo 7: ingresos ──────────────────────────────────────────────────
  income('700', 'Cuotas ordinarias', 'income_ordinary', 'Cuotas'),
  income('701', 'Derramas', 'income_extraordinary'),
  income(
    '746',
    'Fondo de reserva aplicado',
    'reserve_applied',
    'Reserva aplicada',
  ),
  income(
    '752',
    'Ingresos por arrendamientos',
    'income_rentals',
    'Arrendamientos',
  ),
  income(
    '759',
    'Ingresos por servicios diversos',
    'income_recharges',
    'Servicios diversos',
  ),
  income(
    '769',
    'Otros ingresos financieros',
    'interest_income',
    'Ingresos financieros',
  ),
  income('778', 'Ingresos excepcionales'),
];

/**
 * Naturaleza de una cuenta a partir de su código, para las cuentas que no
 * vienen de la plantilla (altas manuales, importaciones). Sigue los grupos
 * del Plan General Contable en lo que usa una comunidad.
 */
export function natureForCode(code: string): AccountNature {
  const first = code.charAt(0);
  if (first === '6') return 'expense';
  if (first === '7') return 'income';
  if (first === '1')
    return code.startsWith('17') || code.startsWith('18')
      ? 'liability'
      : 'equity';
  if (first === '4') {
    const liabilityPrefixes = [
      '40',
      '41',
      '465',
      '475',
      '476',
      '477',
      '479',
      '48',
    ];
    return liabilityPrefixes.some((p) => code.startsWith(p))
      ? 'liability'
      : 'asset';
  }
  if (first === '5')
    return code.startsWith('52') || code.startsWith('55')
      ? 'liability'
      : 'asset';
  if (first === '2' || first === '3') return 'asset';
  return 'equity';
}
