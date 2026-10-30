/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { createPrismaClient } from '../prisma/create-prisma-client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  createAdministrator,
  createEstate,
  createOwnerUser,
  createProperty,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { IssuesService } from './issues.service';

/**
 * Trazabilidad del expediente contra Postgres real: cada aviso queda con su
 * canal y su contenido original, y cada evento dice QUÉ actuó (antes, lo que
 * hacía el gestor se guardaba con rol «Sistema»).
 */
const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();
const service = new IssuesService(
  prisma as unknown as PrismaService,
  estateAccess,
  {
    notify: jest.fn(),
    notifyUsers: jest.fn(),
  } as unknown as NotificationsService,
  undefined,
  undefined,
  new PropertyAccessService(prisma as unknown as PrismaService, estateAccess),
);

let admin: AdministratorFixture;
let estateId: string;
let propertyId: string;
let ownerId: string;
let manager: AuthenticatedUser;
let owner: AuthenticatedUser;

const dto = (extra: Record<string, unknown> = {}) =>
  ({
    type: 'Fuga',
    title: 'Goteras',
    description: 'Entra agua por el techo',
    priority: 'Normal',
    ...extra,
  }) as never;

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (trazabilidad)',
  });
  estateId = await createEstate(prisma, admin.administratorId, {
    name: 'Finca de prueba — trazabilidad',
  });
  propertyId = await createProperty(prisma, estateId);
  ownerId = await createOwnerUser(prisma, {
    fullName: 'Propietaria de prueba (trazabilidad)',
  });
  await prisma.propertyMembership.create({
    data: {
      propertyId,
      userId: ownerId,
      roleType: 'Propietario',
      status: 'linked',
      linkedAt: new Date(),
    },
  });
  manager = roleB(admin, [estateId]);
  owner = {
    id: ownerId,
    role: 'C',
    estateIds: [estateId],
    administratorId: null,
  } as unknown as AuthenticatedUser;
});

afterAll(async () => {
  await prisma.issue.deleteMany({ where: { estateId } });
  await prisma.propertyMembership.deleteMany({ where: { userId: ownerId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

const timeline = (issueId: string) =>
  prisma.issueTimelineEntry.findMany({
    where: { issueId },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });

describe('IssuesService.create · el aviso original', () => {
  it('por el formulario, un propietario: canal «form», su contenido tal cual y él como quien avisa', async () => {
    const issue = await service.create(estateId, dto(), owner);
    const [report] = await prisma.issueReport.findMany({
      where: { issueId: issue.id },
    });
    expect(report).toMatchObject({
      channel: 'form',
      sourceRef: null,
      content: 'Entra agua por el techo',
      reporterUserId: ownerId,
      createdByKind: 'person',
      createdByUserId: ownerId,
    });
    const [first] = await timeline(issue.id);
    expect(first).toMatchObject({
      kind: 'report_received',
      actorKind: 'person',
      authorUserId: ownerId,
      role: 'Propietario',
      refType: 'issue_report',
      refId: report.id,
    });
    expect(issue.source).toBe('Propietario');
  });

  it('una llamada que registra la gestión: canal, referencia y quien llamó (sin cuenta en Domora)', async () => {
    const ref = `call-${Date.now()}`;
    const issue = await service.create(
      estateId,
      dto({
        channel: 'call',
        sourceRef: ref,
        reporterName: 'Vecino del 3ºB',
        reporterContact: '600 111 222',
      }),
      manager,
    );
    const [report] = await prisma.issueReport.findMany({
      where: { issueId: issue.id },
    });
    expect(report).toMatchObject({
      channel: 'call',
      sourceRef: ref,
      reporterUserId: null,
      reporterName: 'Vecino del 3ºB',
      reporterContact: '600 111 222',
      createdByUserId: admin.userId,
    });
    expect(issue.source).toBe('Comunidad');
  });

  it('el modelo admite el canal «email» sin más funcionalidad', async () => {
    const issue = await service.create(
      estateId,
      dto({ channel: 'email', sourceRef: `<${Date.now()}@mail.test>` }),
      manager,
    );
    expect(
      (
        await prisma.issueReport.findFirstOrThrow({
          where: { issueId: issue.id },
        })
      ).channel,
    ).toBe('email');
  });

  it('una llamada de un propietario con cuenta: queda como reportante, igual que si la hubiera creado él', async () => {
    const issue = await service.create(
      estateId,
      dto({ channel: 'call', reporterUserId: ownerId, reporterName: 'Vecino con cuenta', reporterContact: '600 333 444' }),
      manager,
    );
    const report = await prisma.issueReport.findFirstOrThrow({ where: { issueId: issue.id } });
    expect(report).toMatchObject({
      channel: 'call',
      reporterUserId: ownerId,
      reporterName: 'Vecino con cuenta',
      createdByUserId: admin.userId,
    });
    // Quien avisó es reportante: la incidencia es «suya» y le llegan los avisos de solicitante.
    expect(await service.isReporter(issue.id, ownerId)).toBe(true);
    expect(issue.source).toBe('Comunidad');
  });

  it('el reportante con cuenta tiene que ser miembro de la comunidad', async () => {
    await expect(
      service.create(estateId, dto({ reporterUserId: admin.userId }), manager),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(estateId, dto({ reporterUserId: '00000000-0000-4000-8000-000000000000' }), manager),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un propietario no puede indicar canal, referencia ni quien avisa: siempre avisa por el formulario', async () => {
    for (const extra of [
      { channel: 'call' },
      { sourceRef: 'x' },
      { reporterName: 'otro' },
      { reporterContact: 'x' },
      { reporterUserId: ownerId },
    ]) {
      await expect(
        service.create(estateId, dto(extra), owner),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});

describe('IssuesService.deleteIssue · eliminar una incidencia', () => {
  it('la gestión la elimina: deja de verse y se retira lo que seguía vivo por ella', async () => {
    const issue = await service.create(estateId, dto({ title: 'Para eliminar' }), manager);
    await prisma.agendaTask.create({
      data: { administratorId: admin.administratorId, estateId, title: 'Tarea de la incidencia', issueId: issue.id, startAt: new Date(), endAt: new Date(Date.now() + 3_600_000) },
    });
    await prisma.issueWait.create({
      data: { issueId: issue.id, party: 'provider', kind: 'provider_reply', startedAt: new Date() },
    });

    await expect(service.deleteIssue(issue.id, manager)).resolves.toEqual({ deleted: true });

    // Borrado lógico: la fila sigue, pero ninguna lectura la ve.
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).deletedAt).not.toBeNull();
    await expect(service.assertIssueAccess(issue.id, manager)).rejects.toThrow('no encontrada');
    // Las tareas no se borran (el historial las referencia): se archivan y se cierran.
    expect(await prisma.agendaTask.count({ where: { issueId: issue.id, archivedAt: null } })).toBe(0);
    expect(await prisma.agendaTask.count({ where: { issueId: issue.id, archivedAt: { not: null }, status: 'CANCELADA' } })).toBe(1);
    expect(await prisma.issueWait.count({ where: { issueId: issue.id, endedAt: null } })).toBe(0);
    // Eliminarla dos veces: ya no existe.
    await expect(service.deleteIssue(issue.id, manager)).rejects.toThrow('no encontrada');
  });

  it('un propietario no puede eliminar incidencias', async () => {
    const issue = await service.create(estateId, dto({ title: 'No se elimina' }), manager);
    await expect(service.deleteIssue(issue.id, owner)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).deletedAt).toBeNull();
  });
});

describe('el historial dice QUÉ actuó', () => {
  it('estado, presupuesto, instalación y comentarios los firma la persona; el rol ya no es «Sistema»', async () => {
    const issue = await service.create(estateId, dto(), owner); // el vecino la reporta: por eso puede añadir notas
    await service.updateStatus(
      issue.id,
      { status: 'EnReparacion' } as never,
      manager,
    );
    await service.updateBudget(
      issue.id,
      { budgetAmount: 780, budgetDescription: 'Cuadro' },
      manager,
    );
    await service.addTimelineEntry(
      issue.id,
      { text: 'Llamado el proveedor' },
      manager,
    );
    await service.addTimelineEntry(
      issue.id,
      { text: 'Gracias, espero noticias' },
      owner,
    );

    const entries = await timeline(issue.id);
    const byKind = (kind: string) => entries.filter((e) => e.kind === kind);
    expect(byKind('status_changed')[0]).toMatchObject({
      actorKind: 'person',
      authorUserId: admin.userId,
      role: 'Administrador',
      fromStatus: 'Abierta',
      toStatus: 'EnReparacion',
    });
    expect(byKind('budget_updated')[0]).toMatchObject({
      actorKind: 'person',
      authorUserId: admin.userId,
      role: 'Administrador',
    });
    const notes = byKind('note');
    expect(notes[0]).toMatchObject({
      actorKind: 'person',
      authorUserId: admin.userId,
      role: 'Administrador',
    });
    expect(notes[1]).toMatchObject({
      actorKind: 'person',
      authorUserId: ownerId,
      role: 'Propietario',
    });
    expect(entries.some((e) => e.role === 'Sistema')).toBe(false);
  });

  it('el nombre a mostrar sale de quién actuó cuando no hay usuario: Domora, el sistema o un tercero', async () => {
    const issue = await service.create(estateId, dto(), manager);
    await prisma.issueTimelineEntry.createMany({
      data: [
        {
          issueId: issue.id,
          date: new Date(),
          role: 'Sistema',
          actorKind: 'ai',
          kind: 'classified',
          text: 'Analizada',
        },
        {
          issueId: issue.id,
          date: new Date(),
          role: 'Sistema',
          actorKind: 'system',
          kind: 'email_sent',
          text: 'Enviada',
        },
        {
          issueId: issue.id,
          date: new Date(),
          role: 'Sistema',
          actorKind: 'external',
          kind: 'provider_responded',
          text: 'Respondió',
        },
        {
          issueId: issue.id,
          date: new Date(),
          role: 'Sistema',
          actorKind: 'system',
          kind: 'task_opened',
          text: 'Tarea abierta',
          internal: true,
          meta: { x: 1 },
        },
      ],
    });
    const asManager = ((await service.findById(issue.id, manager)) as any)
      .timeline;
    const author = (kind: string) =>
      asManager.find((e: any) => e.kind === kind).author;
    expect(author('classified')).toBe('Domora');
    expect(author('email_sent')).toBe('Sistema');
    expect(author('provider_responded')).toBe('Tercero');
    expect(asManager.find((e: any) => e.kind === 'task_opened').meta).toEqual({
      x: 1,
    });

    // El propietario recibe la historia sin la maquinaria.
    const asOwner = ((await service.findById(issue.id, owner)) as any).timeline;
    expect(asOwner.map((e: any) => e.kind)).not.toContain('task_opened');
    // …y solo los tipos públicos: el análisis de Domora no sale.
    expect(asOwner.map((e: any) => e.kind)).not.toContain('classified');
    for (const e of asOwner) expect(e).not.toHaveProperty('meta');
    // También en el listado.
    const page = await service.listByEstate(estateId, owner, { pageSize: 200 });
    const listed = page.items.find((i: any) => i.id === issue.id) as any;
    expect(listed.timeline.map((e: any) => e.kind)).not.toContain(
      'task_opened',
    );
  });

  it('resolver o cerrar la incidencia por la API deja el rastro y no rompe en una propiedad sin finca', async () => {
    const issue = await service.create(estateId, dto(), manager);
    const resolved = await service.updateStatus(
      issue.id,
      { status: 'Resuelta' } as never,
      manager,
    );
    expect(resolved.status).toBe('Resuelta');
    const reopened = await service.updateStatus(
      issue.id,
      { status: 'Abierta' } as never,
      manager,
    );
    expect(reopened.status).toBe('Abierta');
    expect(
      (await timeline(issue.id)).filter((e) => e.kind === 'status_changed'),
    ).toHaveLength(2);
  });
});

describe('el mismo aviso no se registra dos veces', () => {
  it('(canal, referencia) repetido → 409 en vez de un error de base de datos', async () => {
    // La unicidad la garantiza la base de datos; aquí se comprueba cómo la traduce el servicio.
    const unique = Object.assign(new Error('unique'), {
      code: 'P2002',
      meta: { target: ['channel', 'source_ref'] },
    });
    const fake = {
      estate: { findFirst: jest.fn().mockResolvedValue({ id: estateId }) },
      $transaction: jest.fn().mockRejectedValue(unique),
    } as unknown as PrismaService;
    const svc = new IssuesService(
      fake,
      new EstateAccessService(),
      {} as NotificationsService,
    );
    await expect(
      svc.create(estateId, dto({ channel: 'call', sourceRef: 'x' }), manager),
    ).rejects.toBeInstanceOf(ConflictException);
    // Otro error de unicidad (p. ej. la referencia de la incidencia) NO se disfraza de aviso repetido.
    const other = Object.assign(new Error('unique'), {
      code: 'P2002',
      meta: { target: ['ref'] },
    });
    (fake.$transaction as unknown as jest.Mock).mockRejectedValue(other);
    await expect(
      svc.create(estateId, dto({ channel: 'call', sourceRef: 'x' }), manager),
    ).rejects.toBe(other);
  });
});
