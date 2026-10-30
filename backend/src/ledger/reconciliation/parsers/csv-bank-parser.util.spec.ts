import { BadRequestException } from '@nestjs/common';
import { parseCsvBankExtract } from './csv-bank-parser.util';

function csvBuf(text: string): Buffer {
  return Buffer.from(text, 'utf-8');
}

describe('parseCsvBankExtract', () => {
  it('reconoce cabeceras españolas típicas y parsea fecha dd/mm/aaaa e importe con coma decimal', async () => {
    const csv = [
      'Fecha,Concepto,Importe',
      '03/02/2020,COMPRA TARG SHOP,"-23,99"',
      '05/02/2020,PAYROLL,"1.234,56"',
    ].join('\n');
    const result = await parseCsvBankExtract(csvBuf(csv), 'extracto.csv');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      date: '2020-02-03',
      concept: 'COMPRA TARG SHOP',
      amount: -23.99,
      bankRef: undefined,
    });
    expect(result[1].amount).toBe(1234.56);
  });

  it('reconoce cabeceras en inglés y fecha ISO', async () => {
    const csv = ['Date,Description,Amount', '2020-02-03,Purchase,-10.50'].join(
      '\n',
    );
    const result = await parseCsvBankExtract(csvBuf(csv), 'extracto.csv');
    expect(result[0]).toEqual({
      date: '2020-02-03',
      concept: 'Purchase',
      amount: -10.5,
      bankRef: undefined,
    });
  });

  it('toma la columna de referencia cuando existe', async () => {
    const csv = [
      'Fecha,Concepto,Importe,Referencia',
      '03/02/2020,Compra,-1,ABC123',
    ].join('\n');
    const result = await parseCsvBankExtract(csvBuf(csv), 'extracto.csv');
    expect(result[0].bankRef).toBe('ABC123');
  });

  it('rechaza un CSV cuyas cabeceras no se reconocen', async () => {
    const csv = ['Columna1,Columna2', 'a,b'].join('\n');
    await expect(
      parseCsvBankExtract(csvBuf(csv), 'extracto.csv'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza un importe no numérico', async () => {
    const csv = ['Fecha,Concepto,Importe', '03/02/2020,Compra,no-numero'].join(
      '\n',
    );
    await expect(
      parseCsvBankExtract(csvBuf(csv), 'extracto.csv'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza una fecha con formato no reconocido', async () => {
    const csv = ['Fecha,Concepto,Importe', 'no-es-fecha,Compra,-1'].join('\n');
    await expect(
      parseCsvBankExtract(csvBuf(csv), 'extracto.csv'),
    ).rejects.toThrow(BadRequestException);
  });
});
