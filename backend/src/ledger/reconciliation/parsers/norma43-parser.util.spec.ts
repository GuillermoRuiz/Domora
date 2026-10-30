import { BadRequestException } from '@nestjs/common';
import { parseNorma43 } from './norma43-parser.util';

/**
 * Fixture real (no inventado) tomado del repo de referencia open source
 * `sergief/norma43parser` (github.com/sergief/norma43parser/blob/master/norma43parser/test/fixtures/movements.n43),
 * usado para verificar los offsets de campo de este parser byte a byte
 * antes de escribir el código. El registro de cierre (33) declara 15
 * cargos por 661,84 y 1 abono por 500,00 — coincide exacto con la suma de
 * los movimientos del fixture.
 */
const REAL_FIXTURE = [
  '111111222233334444122002032002102000000002463439783ACCOUNT NAME ************',
  '22    22222002032002041240810000000000239900000000000000000000001234567890123456',
  '2301COMPRA TARG 1234XXXXXXXX3456 SHOP TO BUY SEVERAL THINGS IN THERE.',
  '22    2222200203200203032041000000000070290000000000AHSOWMSOWI8765SJWISU76WU',
  '2301INSURANCE COMPANY ABC DEF GHI JKL MNO PQRS TUVWXYZ',
  '22    2222200203200203032041000000000070290000000000A224E4ERF000000000123FFF',
  '2301INSURANCE COMPANY ABC DEF GHI JKL MNO PQRS TUVWXYZ',
  '22    22222002032002061240810000000001385700000000000000000000001234567890123456',
  '2301CREDIT CARD 1234567890123456 1234 .SUPERMARKET WHATEVER NAME INC.',
  '22    22222002032002031240810000000000010000000000000000000000001234567890123456',
  '2301CREDIT CARD 1234567890123456 1234 .CAR GARAGE REPAIR.',
  '22    2222200205200205032271000000000096000000000000FFF111FFF111FFF1',
  '2301SCHOOL OF ENGLISH ABC INC',
  '22    2222200205200205032271000000000096000000000000FFF111FFF111FFF1',
  '2301SCHOOL OF ENGLISH ABC INC',
  '22    2222200205200205150302000000000500000000000000000000000000',
  '2301PAYROLL',
  '22    22222002102002101240810000000000432500000000000000000000001234567890123456',
  '2301CREDIT CARD 1234567890123456 1234 .CINEMA TICKETS.',
  '22    22222002102002101240810000000000051500000000000000000000001234567890123456',
  '2301CREDIT CARD 1234567890123456 1234 .CARK PARK SERVICE',
  '22    22222002102002111240810000000000046500000000000000000000001234567890123456',
  '2301CREDIT CARD 1234567890123456 1234 .CARK PARK SERVICE',
  '22    22222002102002111240810000000000360000000000000000000000001234567890123456',
  '2301CREDIT CARD 1234567890123456 1234 .LIVE CONCERT',
  '22    22222002102002111240810000000000193100000000000000000000001234567890123456',
  '2301CREDIT CARD 1234567890123456 1234 .RESTARUANT BON APETIT',
  '22    22222002102002121240810000000000267000000000000000000000001234567890123456',
  '2301CREDIT CARD 1234567890123456 1234 .FAST FOOD RESTAURANT',
  '22    2222200210200210032271000000000024200000000000ZZZWWDE53623609382735263',
  '2301LAWYERS SERVICE',
  '22    22222002102002131240810000000000064400000000000000000000001234567890123456',
  '2301CREDIT CARD 1234567890123456 SUPERMARKET',
  '3311112222333344441200015000000000661840000100000000050000200000000230159978',
  '88999999999999999999000034',
].join('\n');

function buf(text: string): Buffer {
  return Buffer.from(text, 'latin1');
}

describe('parseNorma43', () => {
  it('parsea los 16 movimientos del fixture real sin avisos (el cierre cuadra exacto)', () => {
    const result = parseNorma43(buf(REAL_FIXTURE));
    expect(result.movements).toHaveLength(16);
    expect(result.warnings).toEqual([]);
  });

  it('lee el saldo inicial, el final y el periodo; cuadran con los movimientos', () => {
    const result = parseNorma43(buf(REAL_FIXTURE));
    expect(result).toMatchObject({
      openingBalance: 2463.43,
      closingBalance: 2301.59,
      periodFrom: '2020-02-03',
      periodTo: '2020-02-10',
    });
  });

  it('avisa si el saldo final no cuadra con el inicial más los movimientos', () => {
    const tampered = REAL_FIXTURE.replace(
      '00000000230159978',
      '00000000230160978',
    );
    const result = parseNorma43(buf(tampered));
    expect(
      result.warnings.some((w) => w.includes('saldo final de 2301.60')),
    ).toBe(true);
  });

  it('el único abono (PAYROLL) queda positivo y los 15 cargos negativos', () => {
    const result = parseNorma43(buf(REAL_FIXTURE));
    const payroll = result.movements.find((m) => m.concept.includes('PAYROLL'));
    expect(payroll?.amount).toBe(500);
    const debits = result.movements.filter((m) => m.amount < 0);
    expect(debits).toHaveLength(15);
  });

  it('la suma de cargos y abonos coincide al céntimo con el registro de cierre', () => {
    const result = parseNorma43(buf(REAL_FIXTURE));
    const sumDebit = -result.movements
      .filter((m) => m.amount < 0)
      .reduce((a, m) => a + m.amount, 0);
    const sumCredit = result.movements
      .filter((m) => m.amount > 0)
      .reduce((a, m) => a + m.amount, 0);
    expect(sumDebit).toBeCloseTo(661.84, 2);
    expect(sumCredit).toBeCloseTo(500, 2);
  });

  it('concatena varias líneas 23 en el concepto y asigna la fecha en formato YYYY-MM-DD', () => {
    const result = parseNorma43(buf(REAL_FIXTURE));
    const purchase = result.movements[0];
    expect(purchase.date).toBe('2020-02-03');
    expect(purchase.concept).toContain('COMPRA TARG');
    expect(purchase.amount).toBe(-23.99);
  });

  it('avisa (sin bloquear) si el registro de cierre no cuadra con los movimientos parseados', () => {
    const lines = REAL_FIXTURE.split('\n');
    // Altero el importe de un movimiento para romper el cuadre del cierre.
    lines[1] = lines[1].replace('00000000002399', '00000000009999');
    const broken = lines.join('\n');
    const result = parseNorma43(buf(broken));
    expect(result.movements).toHaveLength(16);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('registro de cierre');
  });

  it('rechaza un fichero vacío', () => {
    expect(() => parseNorma43(buf(''))).toThrow(BadRequestException);
  });

  it('rechaza un fichero sin ningún registro de movimiento (tipo 22)', () => {
    const noMovements = [
      '111111222233334444122002032002102000000002463439783ACCOUNT NAME',
      '88999999999999999999000034',
    ].join('\n');
    expect(() => parseNorma43(buf(noMovements))).toThrow(BadRequestException);
  });

  it('una referencia formada solo por ceros no queda como bankRef "0" — se trata como sin referencia', () => {
    const result = parseNorma43(buf(REAL_FIXTURE));
    const payroll = result.movements.find((m) => m.concept.includes('PAYROLL'));
    expect(payroll?.bankRef).toBeUndefined();
  });

  it('usa la referencia numérica como concepto de respaldo si un movimiento no trae ningún registro 23', () => {
    const noConcept = [
      '22    2222200205200205150302000000000500000000000000000000000000123ABC',
      '3311112222333344441200000000000000000000010000000005000020000000000000978',
    ].join('\n');
    const result = parseNorma43(buf(noConcept));
    expect(result.movements[0].concept.length).toBeGreaterThan(0);
  });
});
