import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  amountToCents,
  parseReturnFile,
  ReturnFileParseError,
} from './return-file-parser';
import { returnReasonText } from './sepa-return-reasons';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('parseReturnFile — pain.002', () => {
  it('saca solo las operaciones rechazadas, con motivo, importe y fecha de cargo', () => {
    const parsed = parseReturnFile(fixture('pain002-rechazos.xml'));
    expect(parsed.format).toBe('pain002');
    expect(parsed.messageId).toBe('BANCO-STS-20260305-0001');
    expect(parsed.ignored).toBe(1);
    expect(parsed.items).toEqual([
      {
        scope: 'transaction',
        endToEndId: 'REM-2026-03-ABCDEF-0001',
        originalMessageId: 'REM-2026-03-ABCDEF',
        amount: 10000,
        date: '2026-03-05',
        returnCode: 'AC04',
        feeAmount: null,
      },
      {
        scope: 'transaction',
        endToEndId: 'REM-2026-03-ABCDEF-0003',
        originalMessageId: 'REM-2026-03-ABCDEF',
        amount: 15050,
        date: '2026-03-05',
        returnCode: 'X99',
        feeAmount: null,
      },
    ]);
  });

  it('el rechazo de la remesa entera es una partida de grupo, aunque el fichero use prefijos de namespace', () => {
    const parsed = parseReturnFile(fixture('pain002-remesa-rechazada.xml'));
    expect(parsed.items).toEqual([
      {
        scope: 'group',
        endToEndId: null,
        originalMessageId: 'REM-2026-03-ABCDEF',
        amount: null,
        date: '2026-03-03',
        returnCode: 'FF01',
        feeAmount: null,
      },
    ]);
  });
});

describe('parseReturnFile — camt.054', () => {
  it('versión 02: devoluciones de un apunte agrupado, con comisión; el abono no cuenta', () => {
    const parsed = parseReturnFile(fixture('camt054-v02-devoluciones.xml'));
    expect(parsed.format).toBe('camt054');
    expect(parsed.messageId).toBe('CAMT054-20260312-77');
    expect(parsed.ignored).toBe(1);
    expect(parsed.items).toEqual([
      {
        scope: 'transaction',
        endToEndId: 'REM-2026-03-ABCDEF-0001',
        originalMessageId: null,
        amount: 10000,
        date: '2026-03-12',
        returnCode: 'AM04',
        feeAmount: 250,
      },
      {
        scope: 'transaction',
        endToEndId: 'REM-2026-03-ABCDEF-0002',
        originalMessageId: null,
        amount: 15000,
        date: '2026-03-12',
        returnCode: 'MD06',
        feeAmount: null,
      },
    ]);
  });

  it('versión 08: importe por operación, total de comisiones y fecha con hora', () => {
    const parsed = parseReturnFile(fixture('camt054-v08-devolucion.xml'));
    expect(parsed.items).toEqual([
      {
        scope: 'transaction',
        endToEndId: 'REM-2026-03-ABCDEF-0004',
        originalMessageId: null,
        amount: 6000,
        date: '2026-03-20',
        returnCode: 'MS02',
        feeAmount: 121,
      },
    ]);
  });
});

describe('parseReturnFile — errores', () => {
  it.each([
    [
      'no es XML',
      'esto no es xml <',
      /no es un mensaje ISO 20022|no es un XML/,
    ],
    ['XML sin Document', '<Foo/>', /ISO 20022/],
    ['extracto camt.053', '<Document><BkToCstmrStmt/></Document>', /camt\.053/],
    [
      'otro mensaje',
      '<Document><CstmrDrctDbtInitn/></Document>',
      /Formato no reconocido/,
    ],
  ])('%s', (_label, xml, message) => {
    expect(() => parseReturnFile(xml)).toThrow(ReturnFileParseError);
    expect(() => parseReturnFile(xml)).toThrow(message);
  });

  it('admite ficheros con BOM al principio', () => {
    const xml = String.fromCharCode(0xfeff) + fixture('pain002-rechazos.xml');
    expect(parseReturnFile(xml).items).toHaveLength(2);
  });

  it('no expande entidades XML', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "AAAAAAAAAA">]>
      <Document><CstmrPmtStsRpt><GrpHdr><MsgId>&a;</MsgId></GrpHdr></CstmrPmtStsRpt></Document>`;
    expect(parseReturnFile(xml).messageId).toBe('&a;');
  });
});

describe('amountToCents y motivos', () => {
  it.each([
    ['100', 10000],
    ['100.1', 10010],
    ['100.10', 10010],
    ['0.07', 7],
    ['1.005', null],
    ['-5.00', null],
    ['abc', null],
  ])('%s → %s', (value, cents) => {
    expect(amountToCents(value)).toBe(cents);
  });

  it('traduce los códigos SEPA y deja visible uno desconocido', () => {
    expect(returnReasonText('AM04')).toBe('Fondos insuficientes');
    expect(returnReasonText('MD06')).toBe(
      'Devolución solicitada por el deudor',
    );
    expect(returnReasonText('X99')).toBe('Motivo X99');
    expect(returnReasonText(null)).toBeNull();
  });
});
