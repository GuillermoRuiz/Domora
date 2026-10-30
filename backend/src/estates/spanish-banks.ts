/**
 * Bank name from a Spanish IBAN (entity code = digits 5-8). Only the most
 * common entities: an unknown code returns null and the card shows nothing.
 */
const SPANISH_BANKS: Record<string, string> = {
  '0049': 'Banco Santander',
  '0075': 'Banco Santander',
  '0073': 'Openbank',
  '2100': 'CaixaBank',
  '2038': 'CaixaBank',
  '0182': 'BBVA',
  '0081': 'Banco Sabadell',
  '0128': 'Bankinter',
  '2085': 'Ibercaja',
  '1465': 'ING',
  '2080': 'Abanca',
  '2095': 'Kutxabank',
  '3058': 'Cajamar',
  '0239': 'EVO Banco',
  '0186': 'Banco Mediolanum',
  '0019': 'Deutsche Bank',
  '3035': 'Laboral Kutxa',
  '2103': 'Unicaja',
};

export function bankNameFromIban(iban: string | null | undefined): string | null {
  const clean = (iban ?? '').replace(/\s/g, '').toUpperCase();
  if (!clean.startsWith('ES') || clean.length < 8) return null;
  return SPANISH_BANKS[clean.slice(4, 8)] ?? null;
}
