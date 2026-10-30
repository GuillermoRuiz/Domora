import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { StorageService } from '../files/storage.service';
import { SuppliersService } from './suppliers.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Tarea 20 del tracker ("Supplier & contract management") — el módulo no
 * tenía NINGÚN test antes de esto, ni de lo que ya existía (alta de
 * proveedor, facturas) ni de lo nuevo (editar/dar de baja, contratos,
 * documentos, desempeño). Integración contra Postgres real, mismo criterio
 * que balances.spec.ts/debt-certificate.spec.ts: el estado derivado del
 * contrato es exactamente el tipo de cálculo que un mock no verifica de
 * verdad.
 */
const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();
// StorageService real (disco local bajo backend/storage) — mismo criterio
// que el resto de specs de ficheros del proyecto, sin mockear I/O.
const storage = new StorageService({ get: () => undefined } as any);
const service = new SuppliersService(prisma as unknown as PrismaService, estateAccess, storage);

const ROLE_B = (id: string, estateIds: string[]): AuthenticatedUser => ({
  id,
  role: 'B' as AppRole,
  estateIds,
  administratorId,
});

const CIF = 'TESTGR-PROVEEDORES';

let administratorId: string;
let estateId: string;
let bUserId: string;
let user: AuthenticatedUser;

interface Fixture {
  supplierIds: string[];
  invoiceIds: string[];
  contractIds: string[];
  documentIds: string[];
  propertyIds: string[];
  issueIds: string[];
  assignmentIds: string[];
}

function emptyFixture(): Fixture {
  return {
    supplierIds: [],
    invoiceIds: [],
    contractIds: [],
    documentIds: [],
    propertyIds: [],
    issueIds: [],
    assignmentIds: [],
  };
}

async function makeSupplier(fixture: Fixture, overrides: Partial<{ name: string; category: string }> = {}) {
  const s = await prisma.supplier.create({
    data: {
      estateId,
      administratorId,
      name: overrides.name ?? 'Ascensores de prueba S.L.',
      category: overrides.category ?? 'Ascensores',
    },
  });
  fixture.supplierIds.push(s.id);
  return s;
}

async function makeContract(
  fixture: Fixture,
  supplierId: string,
  overrides: Partial<{ endDate: Date | null; cancelledAt: Date | null }> = {},
) {
  const c = await prisma.supplierContract.create({
    data: {
      supplierId,
      estateId,
      serviceType: 'Mantenimiento',
      startDate: new Date('2026-01-01'),
      endDate: overrides.endDate,
      renewalType: 'tacita',
      cancelledAt: overrides.cancelledAt,
    },
  });
  fixture.contractIds.push(c.id);
  return c;
}

async function cleanup(fixture: Fixture): Promise<void> {
  if (fixture.assignmentIds.length) {
    await prisma.issueProviderAssignment.deleteMany({ where: { id: { in: fixture.assignmentIds } } });
  }
  if (fixture.issueIds.length) {
    await prisma.issue.deleteMany({ where: { id: { in: fixture.issueIds } } });
  }
  if (fixture.propertyIds.length) {
    await prisma.property.deleteMany({ where: { id: { in: fixture.propertyIds } } });
  }
  if (fixture.documentIds.length) {
    await prisma.supplierDocument.deleteMany({ where: { id: { in: fixture.documentIds } } });
  }
  if (fixture.contractIds.length) {
    await prisma.supplierContract.deleteMany({ where: { id: { in: fixture.contractIds } } });
  }
  if (fixture.invoiceIds.length) {
    await prisma.supplierInvoice.deleteMany({ where: { id: { in: fixture.invoiceIds } } });
  }
  if (fixture.supplierIds.length) {
    await prisma.supplier.deleteMany({ where: { id: { in: fixture.supplierIds } } });
  }
}

beforeAll(async () => {
  const admin = await prisma.administrator.create({
    data: {
      name: 'Gestora de prueba (proveedores)',
      cif: CIF,
      plan: 'BASE',
      tier: 'basic',
      usersMax: 5,
      status: 'Activa',
    },
  });
  administratorId = admin.id;

  const estate = await prisma.estate.create({
    data: {
      administratorId,
      name: 'Finca de prueba — proveedores',
      type: 'Edificio',
      address: 'Calle Falsa 555',
      location: 'Madrid',
    },
  });
  estateId = estate.id;

  const bUser = await prisma.user.create({
    data: {
      email: `admin-proveedores-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Gestor de prueba',
      role: 'B',
      administratorId,
    },
  });
  bUserId = bUser.id;
  user = ROLE_B(bUserId, [estateId]);
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: bUserId } });
  await prisma.estate.delete({ where: { id: estateId } });
  await prisma.administrator.delete({ where: { id: administratorId } });
  await prisma.$disconnect();
});

describe('SuppliersService — Supplier CRUD', () => {
  it('crea un proveedor con status "Activo" por defecto', async () => {
    const fx = emptyFixture();
    try {
      const created = await service.createSupplier(estateId, { name: 'Limpiezas ABC', category: 'Limpieza' } as any, user);
      fx.supplierIds.push(created.id);
      expect(created.status).toBe('Activo');
      expect(created.excludedFrom347).toBe(false);
    } finally {
      await cleanup(fx);
    }
  });

  it('suministros y seguros quedan fuera del 347 por defecto (art. 33.5 RGAT), y se puede cambiar', async () => {
    const fx = emptyFixture();
    try {
      const luz = await service.createSupplier(estateId, { name: 'Eléctrica', category: 'Suministros' } as any, user);
      fx.supplierIds.push(luz.id);
      expect(luz.excludedFrom347).toBe(true);
      const updated = await service.updateSupplier(estateId, luz.id, { excludedFrom347: false } as any, user);
      expect(updated.excludedFrom347).toBe(false);
    } finally {
      await cleanup(fx);
    }
  });

  it('updateSupplier permite corregir un dato sin tocar el resto (antes no existía ningún PATCH)', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx, { name: 'Nombre con Erratta' });
      const updated = await service.updateSupplier(estateId, supplier.id, { name: 'Nombre Correcto' } as any, user);
      expect(updated.name).toBe('Nombre Correcto');
      expect(updated.category).toBe(supplier.category);
    } finally {
      await cleanup(fx);
    }
  });

  it('updateSupplier con status "Baja" es la única forma de dar de baja — nunca hard-delete', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx);
      const updated = await service.updateSupplier(estateId, supplier.id, { status: 'Baja' } as any, user);
      expect(updated.status).toBe('Baja');
      const stillThere = await prisma.supplier.findUnique({ where: { id: supplier.id } });
      expect(stillThere).not.toBeNull();
    } finally {
      await cleanup(fx);
    }
  });

  it('listSuppliers marca hasExpiringSoon cuando hay un contrato por vencer', async () => {
    const fx = emptyFixture();
    try {
      const soon = await makeSupplier(fx, { name: 'Con contrato por vencer' });
      const ok = await makeSupplier(fx, { name: 'Sin nada por vencer' });
      await makeContract(fx, soon.id, { endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) });

      const rows = await service.listSuppliers(estateId, user);
      expect(rows.find((r) => r.id === soon.id)!.hasExpiringSoon).toBe(true);
      expect(rows.find((r) => r.id === ok.id)!.hasExpiringSoon).toBe(false);
    } finally {
      await cleanup(fx);
    }
  });

  it('deniega el acceso a una finca fuera del scope del usuario', async () => {
    const outsider = ROLE_B(bUserId, ['00000000-0000-0000-0000-000000000000']);
    await expect(service.listSuppliers(estateId, outsider)).rejects.toThrow(ForbiddenException);
  });
});

// Las facturas de proveedor contabilizan desde la fase 7: ver
// supplier-invoices.spec.ts.

describe('SuppliersService — estado derivado del contrato', () => {
  it('sin endDate: siempre "Activo"', () => {
    expect(service.deriveContractStatus({ endDate: null, cancelledAt: null })).toBe('Activo');
  });

  it('endDate lejana: "Activo"', () => {
    expect(
      service.deriveContractStatus({ endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), cancelledAt: null }),
    ).toBe('Activo');
  });

  it('endDate dentro de 30 días: "PorVencer"', () => {
    expect(
      service.deriveContractStatus({ endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), cancelledAt: null }),
    ).toBe('PorVencer');
  });

  it('endDate en el pasado: "Vencido"', () => {
    expect(
      service.deriveContractStatus({ endDate: new Date(Date.now() - 24 * 60 * 60 * 1000), cancelledAt: null }),
    ).toBe('Vencido');
  });

  it('cancelledAt puesto: "Cancelado" pase lo que pase con endDate', () => {
    expect(
      service.deriveContractStatus({
        endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        cancelledAt: new Date(),
      }),
    ).toBe('Cancelado');
  });

  it('nunca se persiste — no existe columna status en la tabla (verificado vía Prisma Client en runtime)', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx);
      const contract = await service.createSupplierContract(
        estateId,
        supplier.id,
        { serviceType: 'Extintores', startDate: '2026-01-01', renewalType: 'manual' } as any,
        user,
      );
      fx.contractIds.push(contract.id);
      const raw = await prisma.supplierContract.findUnique({ where: { id: contract.id } });
      expect(raw).not.toHaveProperty('status');
      expect(contract).toHaveProperty('status');
    } finally {
      await cleanup(fx);
    }
  });
});

describe('SuppliersService — SupplierContract CRUD', () => {
  it('createSupplierContract + listSupplierContracts devuelven el estado derivado', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx);
      const created = await service.createSupplierContract(
        estateId,
        supplier.id,
        { serviceType: 'Ascensores', startDate: '2026-01-01', endDate: '2026-12-31', renewalType: 'tacita' } as any,
        user,
      );
      fx.contractIds.push(created.id);

      const list = await service.listSupplierContracts(estateId, supplier.id, user);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(created.id);
      expect(list[0].status).toBeDefined();
    } finally {
      await cleanup(fx);
    }
  });

  it('listEstateContracts devuelve los contratos de la finca con proveedor, estado y días restantes, los más urgentes primero', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx);
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const create = async (endDate: string | null, serviceType: string) => {
        const c = await service.createSupplierContract(
          estateId, supplier.id,
          { serviceType, startDate: '2020-01-01', ...(endDate ? { endDate } : {}), renewalType: 'manual' } as any,
          user,
        );
        fx.contractIds.push(c.id);
        return c;
      };
      const far = await create(day(200), 'Lejano');
      const soon = await create(day(10), 'Próximo');
      const expired = await create(day(-5), 'Caducado');
      const open = await create(null, 'Indefinido');
      const cancelled = await create(day(20), 'Cancelado');
      await service.cancelSupplierContract(estateId, supplier.id, cancelled.id, { reason: 'x' } as any, user);

      const out = await service.listEstateContracts(estateId, user);
      const mine = out.filter((c) => fx.contractIds.includes(c.id));
      expect(mine.map((c) => c.serviceType)).toEqual(['Caducado', 'Próximo', 'Lejano', 'Indefinido', 'Cancelado']);
      const by = (id: string) => mine.find((c) => c.id === id)!;
      expect(by(expired.id)).toMatchObject({ status: 'Vencido', supplier: { id: supplier.id, name: supplier.name } });
      expect(by(expired.id).daysLeft).toBe(-5);
      expect(by(soon.id)).toMatchObject({ status: 'PorVencer', daysLeft: 10 });
      expect(by(far.id)).toMatchObject({ status: 'Activo', daysLeft: 200 });
      expect(by(open.id)).toMatchObject({ status: 'Activo', daysLeft: null });
      expect(by(cancelled.id).status).toBe('Cancelado');
    } finally {
      await cleanup(fx);
    }
  });

  it('listEstateContracts protege el acceso a la finca', async () => {
    await expect(service.listEstateContracts(estateId, ROLE_B('other-user', []))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateSupplierContract actualiza fechas y recalcula el estado', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx);
      const contract = await service.createSupplierContract(
        estateId,
        supplier.id,
        { serviceType: 'Extintores', startDate: '2026-01-01', endDate: '2027-01-01', renewalType: 'manual' } as any,
        user,
      );
      fx.contractIds.push(contract.id);
      expect(contract.status).toBe('Activo');

      const updated = await service.updateSupplierContract(
        estateId,
        supplier.id,
        contract.id,
        { endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() } as any,
        user,
      );
      expect(updated.status).toBe('PorVencer');
    } finally {
      await cleanup(fx);
    }
  });

  it('el nº de contrato (nº de póliza) se guarda al crear, se cambia o se borra al editar, y editar otros campos no lo pierde', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx);
      const contract = await service.createSupplierContract(
        estateId,
        supplier.id,
        { serviceType: 'Multirriesgo comunidad', startDate: '2026-01-01', renewalType: 'tacita', contractNumber: '0987654321' } as any,
        user,
      );
      fx.contractIds.push(contract.id);
      expect(contract.contractNumber).toBe('0987654321');

      const otherField = await service.updateSupplierContract(estateId, supplier.id, contract.id, { notes: 'Cubre daños por agua' } as any, user);
      expect(otherField.contractNumber).toBe('0987654321');
      const changed = await service.updateSupplierContract(estateId, supplier.id, contract.id, { contractNumber: 'POL-2' } as any, user);
      expect(changed.contractNumber).toBe('POL-2');
      const cleared = await service.updateSupplierContract(estateId, supplier.id, contract.id, { contractNumber: null } as any, user);
      expect(cleared.contractNumber).toBeNull();
    } finally {
      await cleanup(fx);
    }
  });

  it('cancelSupplierContract marca cancelledAt/cancelledReason y el estado pasa a "Cancelado"', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx);
      const contract = await service.createSupplierContract(
        estateId,
        supplier.id,
        { serviceType: 'Jardinería', startDate: '2026-01-01', renewalType: 'manual' } as any,
        user,
      );
      fx.contractIds.push(contract.id);

      const cancelled = await service.cancelSupplierContract(
        estateId,
        supplier.id,
        contract.id,
        { cancelledReason: 'Cambio de proveedor' } as any,
        user,
      );
      expect(cancelled.status).toBe('Cancelado');
      expect(cancelled.cancelledReason).toBe('Cambio de proveedor');
    } finally {
      await cleanup(fx);
    }
  });

  it('lanza NotFoundException si el contrato no es de ese proveedor', async () => {
    const fx = emptyFixture();
    try {
      const supplierA = await makeSupplier(fx, { name: 'A' });
      const supplierB = await makeSupplier(fx, { name: 'B' });
      const contract = await makeContract(fx, supplierA.id);

      await expect(
        service.updateSupplierContract(estateId, supplierB.id, contract.id, { notes: 'x' } as any, user),
      ).rejects.toThrow(NotFoundException);
    } finally {
      await cleanup(fx);
    }
  });
});

describe('SuppliersService — SupplierDocument', () => {
  it('sube, lista y descarga un documento con fecha de vencimiento', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx);
      const file = { originalname: 'seguro-rc.pdf', mimetype: 'application/pdf', size: 100, buffer: Buffer.from('contenido') };

      const doc = await service.uploadSupplierDocument(
        estateId,
        supplier.id,
        { title: 'Seguro RC 2026', documentType: 'Seguro', expiresAt: '2026-12-31' },
        file,
        user,
      );
      fx.documentIds.push(doc.id);

      const list = await service.listSupplierDocuments(estateId, supplier.id, user);
      expect(list).toHaveLength(1);
      expect(list[0].expiresAt?.toISOString().slice(0, 10)).toBe('2026-12-31');

      const downloaded = await service.getSupplierDocumentFileContent(estateId, supplier.id, doc.id, user);
      expect(downloaded.content.toString()).toBe('contenido');
      expect(downloaded.fileName).toBe('seguro-rc.pdf');
    } finally {
      await cleanup(fx);
      // El fichero físico queda huérfano tras deleteMany directo (sin pasar
      // por deleteSupplierDocument) — aceptable en este test de storage
      // local efímero, mismo criterio que el resto de specs de ficheros.
    }
  });

  it('deleteSupplierDocument borra la fila y el fichero físico', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx);
      const file = { originalname: 'contrato.pdf', mimetype: 'application/pdf', size: 50, buffer: Buffer.from('x') };
      const doc = await service.uploadSupplierDocument(
        estateId,
        supplier.id,
        { title: 'Contrato', documentType: 'Contrato' },
        file,
        user,
      );

      await service.deleteSupplierDocument(estateId, supplier.id, doc.id, user);

      const raw = await prisma.supplierDocument.findUnique({ where: { id: doc.id } });
      expect(raw).toBeNull();
      await expect(
        service.getSupplierDocumentFileContent(estateId, supplier.id, doc.id, user),
      ).rejects.toThrow(NotFoundException);
    } finally {
      await cleanup(fx);
    }
  });
});

describe('SuppliersService — getSupplierPerformance', () => {
  async function makeProperty(fixture: Fixture) {
    const p = await prisma.property.create({
      data: { estateId, type: 'Piso', status: 'Ocupado', staircase: '1', floor: '1', door: 'A', quotaMonthly: '50.00' },
    });
    fixture.propertyIds.push(p.id);
    return p;
  }

  async function makeIssueWithAssignment(
    fixture: Fixture,
    propertyId: string,
    supplierId: string,
    status: 'Abierta' | 'Resuelta' | 'Cerrada',
  ) {
    const issue = await prisma.issue.create({
      data: {
        ref: `INC-${Math.random().toString(36).slice(2, 8)}`,
        estateId,
        type: 'Averia',
        title: 'Incidencia de prueba',
        description: 'x',
        status,
        priority: 'Normal',
        source: 'Comunidad',
        date: new Date(),
      },
    });
    fixture.issueIds.push(issue.id);
    const assignment = await prisma.issueProviderAssignment.create({
      data: {
        issueId: issue.id,
        supplierId,
        providerNameSnapshot: 'Proveedor de prueba',
        assignedAt: new Date(),
        assignedByUserId: bUserId,
      },
    });
    fixture.assignmentIds.push(assignment.id);
    return { issue, assignment };
  }

  it('cuenta incidencias distintas (no filas de asignación) y separa resueltas de abiertas', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx);
      const property = await makeProperty(fx);
      await makeIssueWithAssignment(fx, property.id, supplier.id, 'Abierta');
      await makeIssueWithAssignment(fx, property.id, supplier.id, 'Resuelta');
      await makeIssueWithAssignment(fx, property.id, supplier.id, 'Cerrada');

      const perf = await service.getSupplierPerformance(estateId, supplier.id, user);
      expect(perf.totalIssuesAssigned).toBe(3);
      expect(perf.resolvedIssues).toBe(2);
      expect(perf.openIssues).toBe(1);
    } finally {
      await cleanup(fx);
    }
  });

  it('sin incidencias asignadas, devuelve todo en cero', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx);
      const perf = await service.getSupplierPerformance(estateId, supplier.id, user);
      expect(perf).toEqual({ totalIssuesAssigned: 0, resolvedIssues: 0, openIssues: 0 });
    } finally {
      await cleanup(fx);
    }
  });
});
