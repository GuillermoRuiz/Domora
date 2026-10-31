import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateSetupService } from '../estates/estate-setup.service';
import { CompletenessService } from '../completeness/completeness.service';
import { ClientStatusService } from '../client-status/client-status.service';
import { AdminsService } from '../admins/admins.service';
import { PropertiesService } from '../properties/properties.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import {
  createOwnerUser,
  purgeAdministrator,
  roleA,
  uniqueCif,
  uniqueEmail,
} from '../testing/db-fixtures';
import { LeadsService } from './leads.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Against real Postgres: leads CRUD, «seguimiento comercial», conversion into
 * the despacho through AdminsService.create and «Solicitudes de alta de
 * comunidad» as a lead origin (odd/tasks/role-a-panel.md S13).
 */
const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const clientStatus = new ClientStatusService(
  db,
  new CompletenessService(db, new EstateSetupService(db)),
);
const admins = new AdminsService(
  db,
  undefined as never,
  undefined as never,
  clientStatus,
);
const leads = new LeadsService(db, admins);
const notifications = {
  notify: jest.fn().mockResolvedValue(undefined),
  supportIds: jest.fn().mockResolvedValue([]),
};
const properties = new PropertiesService(
  db,
  new EstateAccessService(),
  {} as never,
  notifications as never,
  {} as never,
);

const createdLeads: string[] = [];
const createdAdmins: string[] = [];
const createdUsers: string[] = [];
const createdRequests: string[] = [];
let staff: ReturnType<typeof roleA>;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: uniqueEmail('staff'),
      passwordHash: 'x',
      fullName: 'Comercial Domora',
      role: 'A',
    },
  });
  createdUsers.push(user.id);
  staff = roleA(user.id);
});

afterAll(async () => {
  await prisma.lead.deleteMany({
    where: {
      OR: [
        { id: { in: createdLeads } },
        { onboardingRequestId: { in: createdRequests } },
      ],
    },
  });
  await prisma.estateOnboardingRequest.deleteMany({
    where: { id: { in: createdRequests } },
  });
  for (const id of createdAdmins) await purgeAdministrator(prisma, id);
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

async function newLead(overrides: Record<string, unknown> = {}) {
  const lead = await leads.create(
    {
      name: 'Fincas Prueba Leads',
      contactName: 'Marta Ruiz',
      contactEmail: uniqueEmail('lead'),
      contactPhone: '600111222',
      city: 'Valencia',
      origin: 'referido',
      planOfInterest: 'STANDARD',
      ...overrides,
    } as never,
    staff,
  );
  createdLeads.push(lead.id);
  return lead;
}

describe('leads CRUD and follow-ups', () => {
  it('creates a lead as «Nuevo» with its origin and plan of interest, and lists it', async () => {
    const lead = await newLead({
      nextAction: 'Enviar propuesta',
      nextActionAt: '2026-11-03',
      notes: 'Viene de un cliente',
    });
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row).toMatchObject({
      name: 'Fincas Prueba Leads',
      contactName: 'Marta Ruiz',
      contactPhone: '600111222',
      city: 'Valencia',
      origin: 'referido',
      planOfInterest: 'STANDARD',
      status: 'nuevo',
      nextAction: 'Enviar propuesta',
      notes: 'Viene de un cliente',
      convertedAdministratorId: null,
    });
    expect(row.nextActionAt?.toISOString().slice(0, 10)).toBe('2026-11-03');

    const list = await leads.list();
    const listed = list.find((l) => l.id === lead.id);
    expect(listed).toMatchObject({
      origin: 'referido',
      planOfInterest: 'STANDARD',
      status: 'nuevo',
      followUpCount: 0,
      lastFollowUpAt: null,
      onboardingRequest: null,
      convertedAdministrator: null,
    });
  });

  it('«Solicitud de alta de comunidad» is not a manual origin', async () => {
    await expect(
      leads.create({ name: 'X', origin: 'solicitud_alta' } as never, staff),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates the lead; «Convertido» can only be reached by converting', async () => {
    const lead = await newLead();
    const updated = await leads.update(
      lead.id,
      {
        status: 'contactado',
        nextAction: 'Demo el jueves',
        nextActionAt: '2026-11-05',
      } as never,
      staff,
    );
    expect(updated).toMatchObject({
      status: 'contactado',
      nextAction: 'Demo el jueves',
    });
    await expect(
      leads.update(lead.id, { status: 'convertido' } as never, staff),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status,
    ).toBe('contactado');
    await expect(
      leads.update(
        '00000000-0000-0000-0000-000000000000',
        { status: 'contactado' } as never,
        staff,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records follow-ups with author and date, newest first, and the list shows the count and the last one', async () => {
    const lead = await newLead();
    await leads.addFollowUp(
      lead.id,
      { text: 'Primera llamada', occurredAt: '2026-10-20T10:00:00Z' },
      staff,
    );
    await leads.addFollowUp(lead.id, { text: 'Enviada la propuesta' }, staff);

    const rows = await prisma.commercialFollowUp.findMany({
      where: { leadId: lead.id },
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (r) => r.authorUserId === staff.id && r.administratorId === null,
      ),
    ).toBe(true);

    const detail = await leads.get(lead.id);
    expect(detail.followUps.map((f) => f.text)).toEqual([
      'Enviada la propuesta',
      'Primera llamada',
    ]);
    expect(detail.followUps[0].author).toBe('Comercial Domora');

    const listed = (await leads.list()).find((l) => l.id === lead.id)!;
    expect(listed.followUpCount).toBe(2);
    expect(listed.lastFollowUpAt).toEqual(detail.followUps[0].occurredAt);
  });
});

describe('conversion into the despacho (S13: Clientes and Administradores share the record)', () => {
  it('creates the despacho through the existing creation path, links it and logs the conversion in its activity', async () => {
    const lead = await newLead({
      name: 'Fincas Convertidas SL',
      planOfInterest: 'PREMIUM',
    });
    const cif = uniqueCif('LEAD');
    const result = await leads.convert(lead.id, { cif }, staff);
    createdAdmins.push(result.administratorId);

    const admin = await prisma.administrator.findUniqueOrThrow({
      where: { id: result.administratorId },
      include: { billing: true, activity: true },
    });
    expect(admin).toMatchObject({
      name: 'Fincas Convertidas SL',
      cif,
      plan: 'PREMIUM',
      status: 'Activa',
      contactName: 'Marta Ruiz',
      contactEmail: lead.contactEmail,
      phone: '600111222',
    });
    expect(admin.billing).toMatchObject({
      businessName: 'Fincas Convertidas SL',
      cif,
    });
    expect(admin.activity).toHaveLength(1);
    expect(admin.activity[0]).toMatchObject({
      type: 'signup',
      authorUserId: staff.id,
    });
    expect(admin.activity[0].title).toBe(
      'Alta de gestora (plan PREMIUM) · convertida desde oportunidad (Referido)',
    );

    const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row).toMatchObject({
      status: 'convertido',
      convertedAdministratorId: result.administratorId,
    });
    expect(row.convertedAt).toBeInstanceOf(Date);
    const listed = (await leads.list()).find((l) => l.id === lead.id)!;
    expect(listed.convertedAdministrator).toEqual({
      id: result.administratorId,
      name: 'Fincas Convertidas SL',
    });
  });

  it('the form values override the lead (name, plan, contact)', async () => {
    const lead = await newLead();
    const result = await leads.convert(
      lead.id,
      {
        cif: uniqueCif('LEAD'),
        name: 'Nombre Fiscal SL',
        plan: 'BASE',
        contactEmail: 'facturas@test.local',
      },
      staff,
    );
    createdAdmins.push(result.administratorId);
    expect(
      await prisma.administrator.findUniqueOrThrow({
        where: { id: result.administratorId },
      }),
    ).toMatchObject({
      name: 'Nombre Fiscal SL',
      plan: 'BASE',
      contactEmail: 'facturas@test.local',
    });
  });

  it('a lead without plan of interest needs one to convert', async () => {
    const lead = await newLead({ planOfInterest: undefined });
    await expect(
      leads.convert(lead.id, { cif: uniqueCif('LEAD') }, staff),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status,
    ).toBe('nuevo');
  });

  it('a lead converts once: a second conversion → 409 and no second despacho', async () => {
    const lead = await newLead();
    const first = await leads.convert(
      lead.id,
      { cif: uniqueCif('LEAD') },
      staff,
    );
    createdAdmins.push(first.administratorId);
    const cif = uniqueCif('LEAD');
    await expect(leads.convert(lead.id, { cif }, staff)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await prisma.administrator.count({ where: { cif } })).toBe(0);
    await expect(
      leads.update(lead.id, { status: 'descartado' } as never, staff),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a duplicated CIF → 409 and the lead stays as it was (one transaction)', async () => {
    const existing = await newLead();
    const cif = uniqueCif('LEAD');
    const first = await leads.convert(existing.id, { cif }, staff);
    createdAdmins.push(first.administratorId);

    const lead = await newLead();
    await expect(leads.convert(lead.id, { cif }, staff)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }),
    ).toMatchObject({ status: 'nuevo', convertedAdministratorId: null });
    expect(await prisma.administrator.count({ where: { cif } })).toBe(1);
  });

  it('the existing «Añadir administrador» path still logs its own signup title', async () => {
    const admin = await admins.create(
      { name: 'Alta directa SL', cif: uniqueCif('DIR'), plan: 'BASE' },
      staff,
    );
    createdAdmins.push(admin.id);
    const activity = await prisma.adminActivityItem.findMany({
      where: { administratorId: admin.id },
    });
    expect(activity.map((a) => [a.type, a.title])).toEqual([
      ['signup', 'Alta de gestora (plan BASE)'],
    ]);
    expect(
      await prisma.lead.count({
        where: { convertedAdministratorId: admin.id },
      }),
    ).toBe(0);
  });
});

describe('«Solicitudes de alta de comunidad» as a lead origin', () => {
  let ownerId: string;

  beforeAll(async () => {
    ownerId = await createOwnerUser(prisma, {
      fullName: 'Propietaria Solicitante',
    });
    createdUsers.push(ownerId);
  });

  const owner = () => ({
    id: ownerId,
    role: 'C' as const,
    estateIds: [],
    administratorId: null,
  });

  async function request(adminName?: string) {
    const created = await properties.createOnboardingRequest(
      {
        communityName: 'Residencial Prueba Leads',
        communityAddress: 'Calle Mayor 1',
        adminName,
        adminEmail: 'despacho@test.local',
      } as never,
      owner(),
    );
    createdRequests.push(created.id);
    return created;
  }

  it('a new request creates its lead (origin solicitud_alta) and the existing queue keeps listing it', async () => {
    const created = await request('Fincas del Barrio');
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { onboardingRequestId: created.id },
    });
    expect(lead).toMatchObject({
      name: 'Fincas del Barrio',
      contactEmail: 'despacho@test.local',
      origin: 'solicitud_alta',
      status: 'nuevo',
    });

    const listed = (await leads.list()).find((l) => l.id === lead.id)!;
    expect(listed.onboardingRequest).toEqual({
      id: created.id,
      communityName: 'Residencial Prueba Leads',
      communityAddress: 'Calle Mayor 1',
      requestedByName: 'Propietaria Solicitante',
      status: 'pending',
    });
    expect(
      (await properties.listOnboardingRequests(staff)).some(
        (r) => r.id === created.id,
      ),
    ).toBe(true);
  });

  it('without the despacho name, the lead is named after the community', async () => {
    const created = await request(undefined);
    expect(
      (
        await prisma.lead.findUniqueOrThrow({
          where: { onboardingRequestId: created.id },
        })
      ).name,
    ).toBe('Administración de Residencial Prueba Leads');
  });

  it('resolving the request in the old queue moves a new lead along (contacted → Contactado, dismissed → Descartado)', async () => {
    const contacted = await request('Uno');
    await properties.resolveOnboardingRequest(
      contacted.id,
      { status: 'contacted' },
      staff,
    );
    expect(
      (
        await prisma.lead.findUniqueOrThrow({
          where: { onboardingRequestId: contacted.id },
        })
      ).status,
    ).toBe('contactado');

    const dismissed = await request('Dos');
    await properties.resolveOnboardingRequest(
      dismissed.id,
      { status: 'dismissed' },
      staff,
    );
    expect(
      (
        await prisma.lead.findUniqueOrThrow({
          where: { onboardingRequestId: dismissed.id },
        })
      ).status,
    ).toBe('descartado');
  });

  it('working the lead resolves its pending request, so the old queue does not show it as pending', async () => {
    const created = await request('Tres');
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { onboardingRequestId: created.id },
    });
    await leads.update(lead.id, { status: 'contactado' } as never, staff);
    expect(
      await prisma.estateOnboardingRequest.findUniqueOrThrow({
        where: { id: created.id },
      }),
    ).toMatchObject({ status: 'contacted', resolvedByUserId: staff.id });

    const other = await request('Cuatro');
    const otherLead = await prisma.lead.findUniqueOrThrow({
      where: { onboardingRequestId: other.id },
    });
    await leads.update(otherLead.id, { status: 'descartado' } as never, staff);
    expect(
      (
        await prisma.estateOnboardingRequest.findUniqueOrThrow({
          where: { id: other.id },
        })
      ).status,
    ).toBe('dismissed');
  });
});
