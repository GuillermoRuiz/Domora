import ExcelJS from 'exceljs';
import {
  detectCsvDelimiter,
  parseSpreadsheet,
} from './spreadsheet-parser.util';

describe('parseSpreadsheet', () => {
  it('parsea un CSV real (cabeceras + filas)', async () => {
    const csv = 'Nombre,Referencia\nMaría García,A-101\nJuan Pérez,A-102\n';
    const result = await parseSpreadsheet(
      Buffer.from(csv, 'utf-8'),
      'propietarios.csv',
    );

    expect(result.headers).toEqual(['Nombre', 'Referencia']);
    expect(result.rows).toEqual([
      { Nombre: 'María García', Referencia: 'A-101' },
      { Nombre: 'Juan Pérez', Referencia: 'A-102' },
    ]);
  });

  const LF = String.fromCharCode(10);

  it('parsea un CSV con punto y coma, el separador habitual de la banca y el Excel en español', async () => {
    const csv = Buffer.from(
      ['Fecha;Concepto;Importe', '05/03/2026;TRANSF, GARAJE;50,00', ''].join(
        LF,
      ),
      'utf8',
    );
    const { headers, rows } = await parseSpreadsheet(csv, 'extracto.csv');
    expect(headers).toEqual(['Fecha', 'Concepto', 'Importe']);
    expect(rows[0].Concepto).toBe('TRANSF, GARAJE');
    expect(rows[0].Importe).toBe('50,00');
  });

  it('detecta el separador de la primera línea, sin contar lo que va entre comillas', () => {
    expect(detectCsvDelimiter(Buffer.from(['a;b;c', '1,2,3'].join(LF)))).toBe(
      ';',
    );
    expect(detectCsvDelimiter(Buffer.from('a,b,c'))).toBe(',');
    expect(detectCsvDelimiter(Buffer.from(['"x;y;z",b', ''].join(LF)))).toBe(
      ',',
    );
    expect(
      detectCsvDelimiter(Buffer.from('a' + String.fromCharCode(9) + 'b')),
    ).toBe(String.fromCharCode(9));
    expect(detectCsvDelimiter(Buffer.from('sin separador'))).toBe(',');
  });

  it('parsea un XLSX real generado con exceljs', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Propietarios');
    sheet.addRow(['Nombre', 'Referencia']);
    sheet.addRow(['María García', 'A-101']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseSpreadsheet(
      buffer,
      'imports/e1/uuid-propietarios.xlsx',
    );

    expect(result.headers).toEqual(['Nombre', 'Referencia']);
    expect(result.rows).toEqual([
      { Nombre: 'María García', Referencia: 'A-101' },
    ]);
  });

  it('ignora filas completamente vacías', async () => {
    const csv = 'Nombre,Referencia\nMaría García,A-101\n,\nJuan Pérez,A-102\n';
    const result = await parseSpreadsheet(
      Buffer.from(csv, 'utf-8'),
      'propietarios.csv',
    );
    expect(result.rows).toHaveLength(2);
  });

  it('rechaza un formato de fichero no soportado', async () => {
    await expect(
      parseSpreadsheet(Buffer.from('contenido'), 'documento.pdf'),
    ).rejects.toThrow('Formato de fichero no soportado');
  });

  it('rechaza un fichero sin cabeceras (vacío)', async () => {
    await expect(
      parseSpreadsheet(Buffer.from(''), 'vacio.csv'),
    ).rejects.toThrow('no tiene cabeceras');
  });
});
