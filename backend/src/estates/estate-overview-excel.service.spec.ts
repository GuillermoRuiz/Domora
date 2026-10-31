import ExcelJS from 'exceljs';
import { EstateType } from '../prisma/client';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EstateOverviewExcelService } from './estate-overview-excel.service';
import { EstateOverviewService } from './estate-overview.service';
import { EstateOverviewFilterDto } from './dto/estate-overview.dto';
import type { AuthenticatedUser } from '../auth/auth.types';

/** Crea un EstateOverviewFilterDto con todos los defaults, permitiendo sobrescribir campos. */
function filterDto(
  overrides: Partial<EstateOverviewFilterDto> = {},
): EstateOverviewFilterDto {
  return Object.assign(new EstateOverviewFilterDto(), overrides);
}

describe('EstateOverviewExcelService', () => {
  const user: AuthenticatedUser = {
    id: 'manager',
    role: 'B',
    administratorId: 'admin',
    estateIds: ['e1'],
  };
  const item = {
    name: '=SUM(1,1)',
    address: 'Gran Vía 12',
    streetNumber: '12',
    location: 'Madrid',
    ownersCount: 3,
    activeIssues: 2,
    balance: '-1234.56',
    pendingAmount: '87.50',
  };
  let selectOverview: jest.Mock;
  let service: EstateOverviewExcelService;
  beforeEach(() => {
    selectOverview = jest.fn().mockResolvedValue({
      items: Array.from({ length: 31 }, () => item),
      total: 31,
      pendingLabel: 'Cuotas pendientes',
    });
    service = new EstateOverviewExcelService({
      selectOverview,
    } as unknown as EstateOverviewService);
  });
  it('exports all matching rows with scoped filters, six columns, plain text and numeric EUR values', async () => {
    const query = filterDto({
      search: 'Madrid',
      types: [EstateType.Edificio, EstateType.Garaje],
      sort: 'balance',
      direction: 'desc',
    });
    const result = await service.generate(query, user);
    expect(selectOverview).toHaveBeenCalledTimes(1);
    expect(selectOverview).toHaveBeenCalledWith(query, user);
    expect(result.fileName).toBe('comunidades.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.content as any);
    const sheet = workbook.getWorksheet('Comunidades')!;
    expect(sheet.rowCount).toBe(32);
    expect(sheet.columnCount).toBe(6);
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      'Nombre de la comunidad',
      'Dirección',
      'Número de propietarios',
      'Incidencias abiertas',
      'Saldo de la comunidad',
      'Cuotas pendientes',
    ]);
    expect(sheet.getRow(2).values).toEqual([
      undefined,
      '=SUM(1,1)',
      'Gran Vía 12, Madrid',
      3,
      2,
      -1234.56,
      87.5,
    ]);
    expect(sheet.getCell('A2').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('E2').numFmt).toContain('€');
    expect(sheet.getCell('F32').value).toBe(87.5);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBe('A1:F32');
  });
  it('formats missing street numbers and existing street ranges without duplication', async () => {
    selectOverview.mockResolvedValue({
      total: 2,
      pendingLabel: 'Cuotas pendientes',
      items: [
        { ...item, address: 'Calle Sol', streetNumber: '14' },
        { ...item, address: 'Calle Luna 12-14', streetNumber: '12-14' },
      ],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await service.generate(filterDto(), user)).content as any,
    );
    expect(workbook.worksheets[0].getCell('B2').value).toBe(
      'Calle Sol 14, Madrid',
    );
    expect(workbook.worksheets[0].getCell('B3').value).toBe(
      'Calle Luna 12-14, Madrid',
    );
  });
  it('produces a valid empty workbook and rejects oversized exports without truncation', async () => {
    selectOverview.mockResolvedValue({
      total: 0,
      items: [],
      pendingLabel: 'Cuotas pendientes',
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await service.generate(filterDto(), user)).content as any,
    );
    expect(workbook.worksheets[0].rowCount).toBe(1);
    selectOverview.mockResolvedValue({
      total: 10001,
      items: [],
      pendingLabel: 'Cuotas pendientes',
    });
    await expect(service.generate(filterDto(), user)).rejects.toThrow(
      BadRequestException,
    );
  });
  it('propagates scope denial without creating a workbook', async () => {
    selectOverview.mockRejectedValue(new ForbiddenException());
    await expect(service.generate(filterDto(), user)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
