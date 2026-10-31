import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Prisma } from '../prisma/client';

export interface BalanceRow {
  property: {
    ref: string | null;
    staircase: string | null;
    floor: string | null;
    door: string | null;
  };
  titular: string | null;
  email: string | null;
  phone: string | null;
  balance: Prisma.Decimal;
  isUpToDate: boolean;
  monthsOverdue: number;
  step: string | null;
  lastContact: Date | null;
}

function propertyLabel(p: BalanceRow['property']): string {
  const parts = [
    p.ref,
    p.staircase && `esc. ${p.staircase}`,
    p.floor && `${p.floor}º`,
    p.door,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '—';
}

/**
 * Genera el `.xlsx` de saldo por vecino PROGRAMÁTICAMENTE (librería
 * `exceljs`, ya instalada en el proyecto pero hasta ahora usada solo para
 * LEER ficheros subidos en `imports/`) — nunca escrita. Mismo criterio de
 * diseño que `ConvocatoriaDocxService`: se genera al vuelo y no se
 * persiste, porque los datos ya viven en `AccountingReceipt`/`Debtor` y
 * siempre se pueden reproducir idénticos.
 */
@Injectable()
export class DebtorBalancesExcelService {
  async generate(
    rows: BalanceRow[],
    estateName: string,
  ): Promise<{ fileName: string; content: Buffer }> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Domora';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Saldo por vecino', {
      views: [{ state: 'frozen', ySplit: 3 }],
    });

    const totalDebt = rows.reduce((s, r) => s + r.balance.toNumber(), 0);

    sheet.mergeCells('A1:F1');
    sheet.getCell('A1').value = estateName;
    sheet.getCell('A1').font = { bold: true, size: 14 };

    sheet.mergeCells('A2:F2');
    sheet.getCell('A2').value =
      `Generado el ${new Date().toLocaleDateString('es-ES')} — deuda total: ${totalDebt.toFixed(2)} €`;
    sheet.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };

    const headerRow = sheet.getRow(3);
    headerRow.values = [
      'Propiedad',
      'Titular',
      'Email',
      'Teléfono',
      'Saldo',
      'Meses de retraso',
      'Estado de gestión',
      'Último contacto',
    ];
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8E8E8' },
      };
    });

    for (const r of rows) {
      const row = sheet.addRow([
        propertyLabel(r.property),
        r.titular ?? '—',
        r.email ?? '—',
        r.phone ?? '—',
        r.balance.toNumber(),
        r.monthsOverdue,
        r.isUpToDate ? 'Al día' : (r.step ?? 'Sin gestionar'),
        r.lastContact ? r.lastContact.toLocaleDateString('es-ES') : '—',
      ]);
      const balanceCell = row.getCell(5);
      balanceCell.numFmt = '#,##0.00 €';
      if (!r.isUpToDate) {
        balanceCell.font = { color: { argb: 'FFB00020' } };
      }
    }

    sheet.columns.forEach((col) => {
      col.width = 18;
    });
    sheet.getColumn(1).width = 22;
    sheet.getColumn(2).width = 26;
    sheet.getColumn(3).width = 26;

    const content = Buffer.from(await workbook.xlsx.writeBuffer());
    const safeName = estateName.trim().replace(/\s+/g, '-') || 'finca';
    return { fileName: `saldo-vecinos-${safeName}.xlsx`, content };
  }
}
