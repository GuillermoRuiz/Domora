import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { ResourcesService } from './resources.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RagAuthorizationService } from '../assistant/rag-authorization.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Tarea 20 — integración del vencimiento de contratos/documentos de
 * proveedor con el feed de Alertas ya existente (en vez de inventar un
 * sistema de notificaciones nuevo). Contra Postgres real: es exactamente el
 * tipo de query multi-modelo con umbral de fecha que un mock no verifica de
 * verdad, y `resources.service.ts` no tenía ningún test real de
 * `listAlerts` hasta ahora (su único spec mockea Prisma y ni siquiera llega
 * a este método).
 */
const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();
// Este spec no toca comunicados (ver comentario de cabecera) — sin
// dependencia real de ConfigService/StorageService/MailService.
const service = new ResourcesService(
  prisma as unknown as PrismaService,
  estateAccess,
  { get: () => undefined } as any,
  {} as any,
  {} as any,
  new RagAuthorizationService(prisma as unknown as PrismaService),
);

const CIF = 'TESTGR-ALERTAS-PROV';

let administratorId: string;
let estateId: string;
let bUserId: string;
let cUserId: string;
let bUser: AuthenticatedUser;
let cUser: AuthenticatedUser;

interface Fixture {
  supplierIds: string[];
  contractIds: string[];
  documentIds: string[];
}

function emptyFixture(): Fixture {
  return { supplierIds: [], contractIds: [], documentIds: [] };
}

async function makeSupplier(fixture: Fixture, name = 'Ascensores S.L.') {
  const s = await prisma.supplier.create({
    data: { estateId, administratorId, name, category: 'Ascensores' },
  });
  fixture.supplierIds.push(s.id);
  return s;
}

async function makeContract(
  fixture: Fixture,
  supplierId: string,
  endDate: Date | null,
) {
  const c = await prisma.supplierContract.create({
    data: {
      supplierId,
      estateId,
      serviceType: 'Mantenimiento',
      startDate: new Date('2026-01-01'),
      endDate,
      renewalType: 'tacita',
    },
  });
  fixture.contractIds.push(c.id);
  return c;
}

async function makeDocument(
  fixture: Fixture,
  supplierId: string,
  expiresAt: Date | null,
) {
  const d = await prisma.supplierDocument.create({
    data: {
      supplierId,
      documentType: 'Seguro',
      title: 'Seguro RC',
      fileName: 'seguro.pdf',
      mimeType: 'application/pdf',
      s3Key: 'fake-key-no-file',
      expiresAt,
    },
  });
  fixture.documentIds.push(d.id);
  return d;
}

async function cleanup(fixture: Fixture): Promise<void> {
  if (fixture.documentIds.length) {
    await prisma.supplierDocument.deleteMany({
      where: { id: { in: fixture.documentIds } },
    });
  }
  if (fixture.contractIds.length) {
    await prisma.supplierContract.deleteMany({
      where: { id: { in: fixture.contractIds } },
    });
  }
  if (fixture.supplierIds.length) {
    await prisma.supplier.deleteMany({
      where: { id: { in: fixture.supplierIds } },
    });
  }
}

beforeAll(async () => {
  const admin = await prisma.administrator.create({
    data: {
      name: 'Gestora de prueba (alertas proveedor)',
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
      name: 'Finca de prueba — alertas proveedor',
      type: 'Edificio',
      address: 'Calle Falsa 777',
      location: 'Madrid',
    },
  });
  estateId = estate.id;

  const b = await prisma.user.create({
    data: {
      email: `admin-alertas-prov-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Gestor de prueba',
      role: 'B',
      administratorId,
    },
  });
  bUserId = b.id;
  bUser = { id: bUserId, role: 'B', estateIds: [estateId], administratorId };

  const c = await prisma.user.create({
    data: {
      email: `vecino-alertas-prov-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Vecino de prueba',
      role: 'C',
    },
  });
  cUserId = c.id;
  cUser = {
    id: cUserId,
    role: 'C',
    estateIds: [estateId],
    administratorId: null,
  };
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [bUserId, cUserId] } } });
  await prisma.estate.delete({ where: { id: estateId } });
  await prisma.administrator.delete({ where: { id: administratorId } });
  await prisma.$disconnect();
});

describe('ResourcesService.listAlerts — vencimiento de proveedores (rol B)', () => {
  it('un contrato que vence dentro de 30 días aparece en el feed del admin', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx, 'Extintores Rápidos');
      await makeContract(
        fx,
        supplier.id,
        new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      );

      const alerts = await service.listAlerts(bUser);
      const alert = alerts.find(
        (a) =>
          a.sourceType === 'supplier_contract' &&
          a.title.includes('Extintores Rápidos'),
      );

      expect(alert).toBeDefined();
      expect(alert!.type).toBe('proveedor');
      expect(alert!.urgent).toBe(false);
    } finally {
      await cleanup(fx);
    }
  });

  it('marca urgent:true cuando faltan menos de 7 días', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx, 'Jardinería Urgente');
      await makeContract(
        fx,
        supplier.id,
        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      );

      const alerts = await service.listAlerts(bUser);
      const alert = alerts.find((a) => a.title.includes('Jardinería Urgente'));

      expect(alert!.urgent).toBe(true);
    } finally {
      await cleanup(fx);
    }
  });

  it('un contrato lejano (90 días) NO aparece en el feed', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx, 'Sin prisa S.A.');
      await makeContract(
        fx,
        supplier.id,
        new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      );

      const alerts = await service.listAlerts(bUser);
      expect(
        alerts.find((a) => a.title.includes('Sin prisa S.A.')),
      ).toBeUndefined();
    } finally {
      await cleanup(fx);
    }
  });

  it('un contrato ya vencido sigue apareciendo (sin cota inferior, mismo criterio que recibos Pendiente)', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx, 'Ya Vencido S.L.');
      await makeContract(
        fx,
        supplier.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      );

      const alerts = await service.listAlerts(bUser);
      const alert = alerts.find((a) => a.title.includes('Ya Vencido S.L.'));
      expect(alert).toBeDefined();
      expect(alert!.urgent).toBe(true);
    } finally {
      await cleanup(fx);
    }
  });

  it('un contrato cancelado NUNCA genera alerta, aunque su endDate esté vencido', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx, 'Cancelado Ltd');
      const contract = await makeContract(
        fx,
        supplier.id,
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      );
      await prisma.supplierContract.update({
        where: { id: contract.id },
        data: { cancelledAt: new Date() },
      });

      const alerts = await service.listAlerts(bUser);
      expect(
        alerts.find((a) => a.title.includes('Cancelado Ltd')),
      ).toBeUndefined();
    } finally {
      await cleanup(fx);
    }
  });

  it('un documento con fecha de vencimiento propia (independiente del contrato) también genera alerta', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx, 'Con Seguro Próximo');
      await makeDocument(
        fx,
        supplier.id,
        new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      );

      const alerts = await service.listAlerts(bUser);
      const alert = alerts.find(
        (a) =>
          a.sourceType === 'supplier_contract' &&
          a.title.includes('Con Seguro Próximo'),
      );
      expect(alert).toBeDefined();
      expect(alert!.description).toBe('Seguro RC');
    } finally {
      await cleanup(fx);
    }
  });

  it('un rol C jamás ve alertas de proveedores — no gestiona proveedores', async () => {
    const fx = emptyFixture();
    try {
      const supplier = await makeSupplier(fx, 'Nunca Visible SL');
      await makeContract(
        fx,
        supplier.id,
        new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      );

      const alerts = await service.listAlerts(cUser);
      expect(
        alerts.find((a) => a.sourceType === 'supplier_contract'),
      ).toBeUndefined();
    } finally {
      await cleanup(fx);
    }
  });
});
