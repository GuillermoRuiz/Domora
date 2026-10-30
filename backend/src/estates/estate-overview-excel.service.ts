import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { EstateOverviewService } from './estate-overview.service';
import { EstateOverviewFilterDto } from './dto/estate-overview.dto';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Presentation only. Values and scope always come from the overview selection. */
@Injectable()
export class EstateOverviewExcelService {
  constructor(private readonly overview: EstateOverviewService) {}

  async generate(query: EstateOverviewFilterDto, user: AuthenticatedUser) {
    const result = await this.overview.selectOverview(query, user);
    if (result.total > 10_000) {
      throw new BadRequestException(
        'El listado supera 10.000 comunidades. Reduce la búsqueda o los filtros.',
      );
    }
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Domora';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Comunidades', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = [
      { header: 'Nombre de la comunidad', key: 'name', width: 46 },
      { header: 'Dirección', key: 'address', width: 52 },
      { header: 'Número de propietarios', key: 'owners', width: 24 },
      { header: 'Incidencias abiertas', key: 'issues', width: 22 },
      { header: 'Saldo de la comunidad', key: 'balance', width: 24 },
      { header: result.pendingLabel, key: 'pending', width: 24 },
    ];
    sheet.getRow(1).height = 28;
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF292929' },
    };
    sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    for (const item of result.items) {
      const address = formatExportAddress(item);
      const row = sheet.addRow({
        name: item.name,
        address,
        owners: item.ownersCount,
        issues: item.activeIssues,
        balance: Number(item.balance),
        pending: Number(item.pendingAmount),
      });
      row.alignment = { vertical: 'middle', wrapText: true };
      row.height = Math.max(
        22,
        Math.ceil(item.name.length / 42) * 15,
        Math.ceil(address.length / 48) * 15,
      );
      for (const column of [3, 4])
        row.getCell(column).alignment = {
          horizontal: 'center',
          vertical: 'middle',
        };
      for (const column of [5, 6]) {
        row.getCell(column).numFmt = '#,##0.00 "€"';
        row.getCell(column).alignment = {
          horizontal: 'right',
          vertical: 'middle',
        };
      }
    }
    sheet.autoFilter = { from: 'A1', to: `F${Math.max(1, sheet.rowCount)}` };
    return {
      fileName: 'comunidades.xlsx',
      content: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }
}

/** Match the UI address presentation, including numbers already embedded in address. */
function formatExportAddress(item: {
  address: string;
  streetNumber: string | null;
  location: string;
}): string {
  const address = item.address.trim();
  const number = item.streetNumber?.trim() ?? '';
  const present =
    number &&
    new RegExp(
      `(?:^|[\\s,])${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[\\s,.;/\\-])`,
      'i',
    ).test(address);
  return [
    [address, number && !present ? number : ''].filter(Boolean).join(' '),
    item.location.trim(),
  ]
    .filter(Boolean)
    .join(', ');
}
