import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UpdateSupplierVisitDto } from './dto/supplier-visit.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { UpdateSupplierContractDto } from './dto/update-supplier-contract.dto';
import { SupplierVisitsService } from './supplier-visits.service';

const errorsFor = async <T extends object>(cls: new () => T, body: Record<string, unknown>) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property).sort();

describe('PATCH de visitas y proveedores: un null en un campo obligatorio es un 400, no un 500', () => {
  it('proveedor y contrato: nombre, categoría, estado, servicio, inicio y renovación no admiten null', async () => {
    expect(await errorsFor(UpdateSupplierDto, { name: null, category: null, status: null, excludedFrom347: null })).toEqual(['category', 'excludedFrom347', 'name', 'status']);
    expect(await errorsFor(UpdateSupplierDto, { email: null, phone: null, iban: null, taxId: null })).toEqual([]);
    expect(await errorsFor(UpdateSupplierContractDto, { serviceType: null, startDate: null, renewalType: null })).toEqual(['renewalType', 'serviceType', 'startDate']);
    expect(await errorsFor(UpdateSupplierContractDto, { endDate: null, costAmount: null, notes: null })).toEqual([]); // se pueden vaciar
  });

  it('visita: scheduledAt y purpose no admiten null; sí se pueden omitir o vaciar las notas', async () => {
    expect(await errorsFor(UpdateSupplierVisitDto, { scheduledAt: null })).toEqual(['scheduledAt']);
    expect(await errorsFor(UpdateSupplierVisitDto, { purpose: null })).toEqual(['purpose']);
    expect(await errorsFor(UpdateSupplierVisitDto, {})).toEqual([]);
    expect(await errorsFor(UpdateSupplierVisitDto, { notes: null, assetId: null, issueId: null })).toEqual([]);
    expect(await errorsFor(UpdateSupplierVisitDto, { scheduledAt: '2026-11-01T10:00:00Z', purpose: 'Revisión' })).toEqual([]);
  });

});

describe('SupplierVisitsService.update: no enlaza una incidencia borrada', () => {
  const manager = { id: 'b', role: 'B', estateIds: ['e1'], administratorId: 'adm' } as unknown as AuthenticatedUser;

  it('busca la incidencia sin borrar y rechaza la borrada', async () => {
    const issueFindFirst = jest.fn().mockResolvedValue(null); // soft-deleted: no la encuentra
    const prisma = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ estateId: 'e1', status: 'Activo' }) },
      supplierVisit: { findUnique: jest.fn().mockResolvedValue({ id: 'v1', supplierId: 's1', estateId: 'e1', status: 'planificada' }) },
      issue: { findFirst: issueFindFirst },
    } as unknown as PrismaService;
    const service = new SupplierVisitsService(prisma, new EstateAccessService());
    await expect(service.update('e1', 's1', 'v1', { issueId: 'deleted-issue' } as never, manager)).rejects.toBeInstanceOf(BadRequestException);
    expect(issueFindFirst.mock.calls[0][0].where).toEqual({ id: 'deleted-issue', deletedAt: null });
  });

  it('reenviar la incidencia ya vinculada (aunque se haya borrado después) no bloquea la edición', async () => {
    const issueFindFirst = jest.fn().mockResolvedValue(null);
    const update = jest.fn().mockResolvedValue({ id: 'v1' });
    const prisma = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ estateId: 'e1', status: 'Activo' }) },
      supplierVisit: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', supplierId: 's1', estateId: 'e1', status: 'planificada', issueId: 'old-issue', assetId: null }),
        update,
      },
      issue: { findFirst: issueFindFirst },
    } as unknown as PrismaService;
    const service = new SupplierVisitsService(prisma, new EstateAccessService());
    await service.update('e1', 's1', 'v1', { issueId: 'old-issue', notes: 'Nueva nota' } as never, manager);
    expect(issueFindFirst).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });
});
