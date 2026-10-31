import {
  BadRequestException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminsService } from './admins.service';
import { UpdateOwnAdministratorDto } from './dto/admins.dto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real: "Ajustes → Empresa" era una maqueta que
 * fingía guardar. Una gestora lee y edita SOLO su propia empresa, y nunca
 * la razón social ni el CIF (cambiarlos es cambiar de entidad legal).
 */
const prisma = createPrismaClient();
const service = new AdminsService(
  prisma as unknown as PrismaService,
  undefined as never,
  undefined as never,
  undefined as never,
);
const TAG = `own-${Date.now()}`;

let adminId: string;
let otherAdminId: string;
let gestora: AuthenticatedUser;

beforeAll(async () => {
  const admin = await prisma.administrator.create({
    data: {
      name: 'Gestora Propia S.L.',
      cif: `B${TAG}`.slice(0, 20),
      plan: 'BASE',
      tier: 'basic',
      usersMax: 5,
      status: 'Activa',
      phone: '+34 900 000 000',
      mrr: 49,
      billing: {
        create: {
          businessName: 'Gestora Propia S.L.',
          cif: 'B12345678',
          address: 'Calle Real 1, 28001 Madrid',
          email: 'fact@test.local',
          paymentMethod: 'Tarjeta',
        },
      },
    },
  });
  adminId = admin.id;
  otherAdminId = (
    await prisma.administrator.create({
      data: {
        name: 'Otra',
        cif: `C${TAG}`.slice(0, 20),
        plan: 'BASE',
        tier: 'basic',
        usersMax: 5,
        status: 'Activa',
      },
    })
  ).id;
  gestora = { id: 'b1', role: 'B', estateIds: [], administratorId: adminId };
});

afterAll(async () => {
  await prisma.adminBilling.deleteMany({
    where: { administratorId: { in: [adminId, otherAdminId] } },
  });
  await prisma.administrator.deleteMany({
    where: { id: { in: [adminId, otherAdminId] } },
  });
  await prisma.$disconnect();
});

describe('AdminsService — la propia empresa de la gestora', () => {
  it('devuelve solo los datos de documentos, con la dirección fiscal de facturación, sin nada interno de Domora', async () => {
    const own = await service.findOwn(gestora);

    expect(own).toMatchObject({
      id: adminId,
      name: 'Gestora Propia S.L.',
      phone: '+34 900 000 000',
      fiscalAddress: 'Calle Real 1, 28001 Madrid',
    });
    expect(own).not.toHaveProperty('mrr');
    expect(own).not.toHaveProperty('invoices');
    expect(own.billing).toBeUndefined();
  });

  it('guarda los campos editables en su propia gestora y no en otra', async () => {
    const updated = await service.updateOwn(
      {
        phone: '+34 911 111 111',
        contactName: 'Ana Gestora',
        contactEmail: 'ana@gestora.test',
        vatNumber: 'ESB12345678',
      },
      gestora,
    );

    expect(updated).toMatchObject({
      phone: '+34 911 111 111',
      contactName: 'Ana Gestora',
      contactEmail: 'ana@gestora.test',
      vatNumber: 'ESB12345678',
    });
    const other = await prisma.administrator.findUniqueOrThrow({
      where: { id: otherAdminId },
    });
    expect(other.phone).toBeNull();
  });

  it('una cuenta sin gestora recibe 404', async () => {
    await expect(
      service.findOwn({ ...gestora, administratorId: null }),
    ).rejects.toThrow(NotFoundException);
  });

  it('el pipe global rechaza intentar cambiar razón social o CIF (forbidNonWhitelisted)', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const meta = { type: 'body' as const, metatype: UpdateOwnAdministratorDto };

    await expect(pipe.transform({ name: 'Otra Razón' }, meta)).rejects.toThrow(
      BadRequestException,
    );
    await expect(pipe.transform({ cif: 'B00000000' }, meta)).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      pipe.transform({ contactEmail: 'no-es-email' }, meta),
    ).rejects.toThrow(BadRequestException);
    await expect(
      pipe.transform({ phone: '+34 600 000 000' }, meta),
    ).resolves.toMatchObject({ phone: '+34 600 000 000' });
  });
});
