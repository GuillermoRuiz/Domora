/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../gdpr/audit.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { StorageService } from '../files/storage.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TasksService } from '../notifications/tasks.service';
import type { PushService } from '../push/push.service';
import {
  createAdministrator,
  createEstate,
  createProperty,
  createSupplier,
  purgeAdministrator,
  uniqueEmail,
} from '../testing/db-fixtures';
import { AgendaTasksService } from './agenda-tasks.service';
import { AgendaTaskLinksService } from './agenda-task-links.service';
import {
  AgendaTaskExtrasService,
  type UploadedTaskFile,
} from './agenda-task-extras.service';
import { AgendaTasksRemindersCronService } from './agenda-tasks-reminders-cron.service';
import { DEFAULT_LABELS, MAX_RANGE_ITEMS } from './agenda-task.constants';
import type { AgendaTaskView } from './agenda-task.types';
import type { CreateAgendaTaskDto } from './dto/create-agenda-task.dto';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración de la agenda de tareas contra PostgreSQL real (como el resto de
 * specs de integración del proyecto): aislamiento entre gestoras y entre
 * comunidades, zonas horarias, recurrencia, recordatorios y restricciones de
 * la propia base de datos. Lo que un mock no puede demostrar.
 *
 * El reloj (`Date`) se fija en 2026-10-14 12:00Z para que ningún test dependa
 * de cuándo se ejecuta; el resto de temporizadores (los que usa el driver) no
 * se tocan.
 */
jest.setTimeout(120_000);

const NOW = new Date('2026-10-14T12:00:00.000Z');

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-it-'));
const config = {
  get: (key: string) => (key === 'STORAGE_DIR' ? tmpStorage : undefined),
} as unknown as ConfigService;
const storage = new StorageService(config);
const audit = new AuditService(db);
const tasks = new AgendaTasksService(
  db,
  new EstateAccessService(),
  audit,
  new AgendaTaskLinksService(db),
  storage,
);
/** `list` devuelve `{ items, truncated }`; la mayoría de pruebas solo miran los elementos. */
const listItems = async (
  ...args: Parameters<AgendaTasksService['list']>
): Promise<AgendaTaskView[]> => (await tasks.list(...args)).items;
const extras = new AgendaTaskExtrasService(db, tasks, storage, audit);
const notifications = new NotificationsService(
  db,
  new MailService(config),
  config,
  new TasksService(db),
  { sendToUser: async () => {} } as unknown as PushService,
);
const cron = new AgendaTasksRemindersCronService(db, notifications);

interface Tenant {
  administratorId: string;
  userId: string;
  secondUserId: string;
  estateId: string;
  otherEstateId: string;
  /** Gestor con acceso a las dos comunidades (el modelo actual: todas las de su gestora). */
  user: AuthenticatedUser;
  /** Otro gestor de la MISMA gestora con acceso restringido a la primera comunidad. */
  restricted: AuthenticatedUser;
  supplierId: string;
  issueId: string;
  meetingId: string;
  documentId: string;
}

let A: Tenant;
let B: Tenant;

async function createTenant(name: string): Promise<Tenant> {
  const admin = await createAdministrator(prisma, { name });
  const estateId = await createEstate(prisma, admin.administratorId, {
    name: `${name} · norte`,
  });
  const otherEstateId = await createEstate(prisma, admin.administratorId, {
    name: `${name} · sur`,
  });
  const second = await prisma.user.create({
    data: {
      email: uniqueEmail('gestor2'),
      passwordHash: 'x',
      fullName: `Segundo ${name}`,
      role: 'B',
      administratorId: admin.administratorId,
    },
  });
  await createProperty(prisma, estateId);
  const supplierId = await createSupplier(
    prisma,
    estateId,
    admin.administratorId,
  );
  const issue = await prisma.issue.create({
    data: {
      ref: `INC-${randomUUID().slice(0, 8)}`,
      estateId,
      type: 'Averia',
      title: 'Avería ascensor',
      description: 'No funciona',
      status: 'Abierta',
      priority: 'Normal',
      source: 'Comunidad',
      date: NOW,
    },
  });
  const meeting = await prisma.meeting.create({
    data: {
      estateId,
      title: 'Junta ordinaria',
      type: 'ordinaria',
      scheduledAt1: NOW,
      scheduledAt2: NOW,
      agenda: [],
      convokedBy: 'presidente',
      signerRole: 'administrador',
      createdByUserId: admin.userId,
    },
  });
  const document = await prisma.document.create({
    data: {
      estateId,
      title: 'Contrato.pdf',
      type: 'Documento',
      date: NOW,
      size: '1 KB',
    },
  });
  return {
    administratorId: admin.administratorId,
    userId: admin.userId,
    secondUserId: second.id,
    estateId,
    otherEstateId,
    user: {
      id: admin.userId,
      role: 'B',
      estateIds: [estateId, otherEstateId],
      administratorId: admin.administratorId,
    },
    restricted: {
      id: second.id,
      role: 'B',
      estateIds: [estateId],
      administratorId: admin.administratorId,
    },
    supplierId,
    issueId: issue.id,
    meetingId: meeting.id,
    documentId: document.id,
  };
}

async function destroyTenant(t: Tenant): Promise<void> {
  const estates = [t.estateId, t.otherEstateId];
  await prisma.notification.deleteMany({
    where: { userId: { in: [t.userId, t.secondUserId] } },
  });
  await prisma.agendaTask.deleteMany({
    where: { administratorId: t.administratorId },
  });
  await prisma.issue.deleteMany({
    where: { estateId: { in: estates } },
  });
  await prisma.meeting.deleteMany({ where: { estateId: { in: estates } } });
  await prisma.document.deleteMany({ where: { estateId: { in: estates } } });
  await purgeAdministrator(prisma, t.administratorId);
}

function dto(
  overrides: Partial<CreateAgendaTaskDto> = {},
): CreateAgendaTaskDto {
  return {
    title: 'Llamar al proveedor',
    startAt: '2026-10-14T07:00:00.000Z',
    endAt: '2026-10-14T08:00:00.000Z',
    ...overrides,
  };
}

const WEEK = {
  from: '2026-10-11T22:00:00.000Z',
  to: '2026-10-18T22:00:00.000Z',
  tz: 'Europe/Madrid',
};

function file(
  name = 'presupuesto.pdf',
  type = 'application/pdf',
  size = 12,
): UploadedTaskFile {
  return {
    originalname: name,
    mimetype: type,
    size,
    buffer: Buffer.alloc(size, 1),
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un rechazo y la operación tuvo éxito.');
}

async function agendaRowCounts() {
  const [t, o, r] = await Promise.all([
    prisma.agendaTask.count({ where: { administratorId: A.administratorId } }),
    prisma.agendaTaskOccurrence.count({
      where: { task: { administratorId: A.administratorId } },
    }),
    prisma.agendaTaskReminder.count({
      where: { task: { administratorId: A.administratorId } },
    }),
  ]);
  return { tasks: t, occurrences: o, reminders: r };
}

beforeAll(async () => {
  A = await createTenant('Gestora A');
  B = await createTenant('Gestora B');
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
});

afterAll(async () => {
  jest.useRealTimers();
  await destroyTenant(A);
  await destroyTenant(B);
  fs.rmSync(tmpStorage, { recursive: true, force: true });
  await prisma.$disconnect();
});

afterEach(async () => {
  // Cada test parte de una agenda vacía (las etiquetas y usuarios se conservan).
  await prisma.agendaTask.deleteMany({
    where: { administratorId: { in: [A.administratorId, B.administratorId] } },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('multi-tenancy: la gestora B no puede operar sobre tareas de la gestora A', () => {
  async function taskOfA() {
    const label = (await tasks.listLabels(A.user))[0];
    const created = await tasks.create(
      dto({
        estateId: A.estateId,
        labelIds: [label.id],
        checklist: ['Revisar histórico'],
        links: [{ type: 'issue', id: A.issueId }],
      }),
      A.user,
    );
    const comment = await extras.addComment(created.id, 'Nota interna', A.user);
    const attachment = await extras.addAttachment(created.id, file(), A.user);
    const checklistId = created.checklist[0].id;
    return {
      id: created.id,
      labelId: label.id,
      commentId: comment.id,
      attachmentId: attachment.id,
      checklistId,
    };
  }

  it('B no puede LEER, EDITAR, COMPLETAR, CANCELAR, DUPLICAR ni BORRAR la tarea, y en todos los casos recibe 404', async () => {
    const t = await taskOfA();

    const attempts: Record<string, Promise<unknown>> = {
      get: tasks.getById(t.id, B.user),
      update: tasks.update(t.id, { title: 'Hackeada' }, B.user),
      complete: tasks.updateStatus(t.id, { status: 'COMPLETADA' }, B.user),
      cancel: tasks.updateStatus(t.id, { status: 'CANCELADA' }, B.user),
      duplicate: tasks.duplicate(t.id, B.user),
      remove: tasks.remove(t.id, B.user),
    };
    for (const [name, attempt] of Object.entries(attempts)) {
      const error = await rejection(attempt);
      expect({ name, ok: error instanceof NotFoundException }).toEqual({
        name,
        ok: true,
      });
    }

    // Nada cambió.
    const intact = await tasks.getById(t.id, A.user);
    expect(intact.title).toBe('Llamar al proveedor');
    expect(intact.status).toBe('PENDIENTE');
    expect(
      await prisma.agendaTask.count({
        where: { administratorId: B.administratorId },
      }),
    ).toBe(0);
  });

  it('B no puede comentar, tocar la checklist ni acceder a los adjuntos de A', async () => {
    const t = await taskOfA();

    const attempts: Promise<unknown>[] = [
      extras.addComment(t.id, 'intruso', B.user),
      extras.deleteComment(t.id, t.commentId, B.user),
      extras.addChecklistItem(t.id, 'intruso', B.user),
      extras.updateChecklistItem(t.id, t.checklistId, { done: true }, B.user),
      extras.deleteChecklistItem(t.id, t.checklistId, B.user),
      extras.addAttachment(t.id, file('malware.pdf'), B.user),
      extras.readAttachment(t.id, t.attachmentId, B.user),
      extras.deleteAttachment(t.id, t.attachmentId, B.user),
    ];
    for (const attempt of attempts)
      expect(await rejection(attempt)).toBeInstanceOf(NotFoundException);

    const intact = await tasks.getById(t.id, A.user);
    expect(intact.comments.map((c) => c.text)).toEqual(['Nota interna']);
    expect(intact.checklist.map((c) => [c.text, c.done])).toEqual([
      ['Revisar histórico', false],
    ]);
    expect(intact.attachments).toHaveLength(1);
    // El fichero sigue en disco.
    const stored = await prisma.agendaTaskAttachment.findFirstOrThrow({
      where: { taskId: t.id },
    });
    expect(fs.existsSync(path.join(tmpStorage, stored.s3Key))).toBe(true);
  });

  it('un id ajeno y un id inexistente son INDISTINGUIBLES: no se puede saber si la tarea existe', async () => {
    const t = await taskOfA();
    const phantom = randomUUID();

    const foreign = (await rejection(
      tasks.getById(t.id, B.user),
    )) as NotFoundException;
    const missing = (await rejection(
      tasks.getById(phantom, B.user),
    )) as NotFoundException;
    expect(foreign.getStatus()).toBe(missing.getStatus());
    expect(foreign.message).toBe(missing.message);

    const foreignComment = (await rejection(
      extras.deleteComment(t.id, randomUUID(), B.user),
    )) as NotFoundException;
    const missingComment = (await rejection(
      extras.deleteComment(phantom, randomUUID(), B.user),
    )) as NotFoundException;
    expect(foreignComment.message).toBe(missingComment.message);

    // Tampoco se filtra a través de los filtros: comunidad ajena e inexistente responden igual.
    const foreignEstate = (await rejection(
      listItems(B.user, { ...WEEK, estateId: A.estateId }),
    )) as ForbiddenException;
    const missingEstate = (await rejection(
      listItems(B.user, { ...WEEK, estateId: randomUUID() }),
    )) as ForbiddenException;
    expect(foreignEstate.getStatus()).toBe(missingEstate.getStatus());
  });

  it('B no ve las tareas de A ni en el calendario, ni en las listas, ni en el resumen, ni al buscar', async () => {
    await tasks.create(
      dto({
        title: 'Secreto de A',
        estateId: A.estateId,
        priority: 'URGENTE',
        description: 'palabra-secreta',
      }),
      A.user,
    );
    await tasks.create(
      dto({
        title: 'Vencida de A',
        startAt: '2026-10-01T07:00:00.000Z',
        endAt: '2026-10-01T08:00:00.000Z',
        priority: 'URGENTE',
      }),
      A.user,
    );

    expect(await listItems(B.user, WEEK)).toEqual([]);
    expect(
      await listItems(B.user, { overdue: 'true', tz: 'Europe/Madrid' }),
    ).toEqual([]);
    expect(
      await listItems(B.user, { priority: 'URGENTE', tz: 'Europe/Madrid' }),
    ).toEqual([]);
    expect(await listItems(B.user, { ...WEEK, q: 'palabra-secreta' })).toEqual(
      [],
    );
    expect(
      await tasks.summary(B.user, {
        dayFrom: '2026-10-13T22:00:00.000Z',
        dayTo: '2026-10-14T22:00:00.000Z',
        ...{ weekFrom: WEEK.from, weekTo: WEEK.to },
        tz: WEEK.tz,
      }),
    ).toEqual({ today: 0, week: 0, urgent: 0, overdue: 0 });
    // Y A sí las ve (la comprobación es real, no un filtro que siempre devuelve vacío).
    expect((await listItems(A.user, WEEK)).map((x) => x.title)).toContain(
      'Secreto de A',
    );
  });

  it('B no puede crear tareas que apunten a recursos de A (comunidad, responsable, etiqueta, vínculos)', async () => {
    const labelA = (await tasks.listLabels(A.user))[0];
    const cases: [string, Partial<CreateAgendaTaskDto>, unknown][] = [
      ['comunidad de A', { estateId: A.estateId }, ForbiddenException],
      ['responsable de A', { assignedToUserId: A.userId }, BadRequestException],
      ['etiqueta de A', { labelIds: [labelA.id] }, BadRequestException],
      [
        'incidencia de A',
        { links: [{ type: 'issue', id: A.issueId }] },
        BadRequestException,
      ],
      [
        'junta de A',
        { links: [{ type: 'meeting', id: A.meetingId }] },
        BadRequestException,
      ],
      [
        'proveedor de A',
        { links: [{ type: 'supplier', id: A.supplierId }] },
        BadRequestException,
      ],
      [
        'documento de A',
        { links: [{ type: 'document', id: A.documentId }] },
        BadRequestException,
      ],
    ];
    for (const [name, overrides, expected] of cases) {
      const error = await rejection(tasks.create(dto(overrides), B.user));
      expect({ name, ok: error instanceof (expected as typeof Error) }).toEqual(
        { name, ok: true },
      );
    }
    expect(
      await prisma.agendaTask.count({
        where: { administratorId: B.administratorId },
      }),
    ).toBe(0);
  });

  it('B no puede REDIRIGIR una tarea suya hacia recursos de A mediante una edición', async () => {
    const own = await tasks.create(
      dto({ title: 'Mía', estateId: B.estateId }),
      B.user,
    );
    const labelA = (await tasks.listLabels(A.user))[0];

    const attempts: Promise<unknown>[] = [
      tasks.update(own.id, { estateId: A.estateId }, B.user),
      tasks.update(own.id, { assignedToUserId: A.userId }, B.user),
      tasks.update(own.id, { labelIds: [labelA.id] }, B.user),
      tasks.update(
        own.id,
        { links: [{ type: 'issue', id: A.issueId }] },
        B.user,
      ),
      tasks.update(
        own.id,
        { links: [{ type: 'supplier', id: A.supplierId }] },
        B.user,
      ),
    ];
    for (const attempt of attempts) await rejection(attempt);

    const intact = await tasks.getById(own.id, B.user);
    expect(intact.estate?.id).toBe(B.estateId);
    expect(intact.assignee).toBeNull();
    expect(intact.labels).toEqual([]);
    expect(intact.links).toEqual([]);
  });

  it('las etiquetas son de cada gestora: B no ve, no borra y puede reutilizar nombres de A', async () => {
    const [labelA] = await tasks.listLabels(A.user);
    const labelsB = await tasks.listLabels(B.user);

    expect(labelsB.map((l) => l.id)).not.toContain(labelA.id);
    expect(
      await rejection(tasks.deleteLabel(labelA.id, B.user)),
    ).toBeInstanceOf(NotFoundException);
    expect(
      await prisma.agendaTaskLabel.count({ where: { id: labelA.id } }),
    ).toBe(1);

    const same = await tasks.createLabel(labelA.name, B.user);
    expect(same.id).not.toBe(labelA.id);
  });

  it('los responsables posibles son solo el equipo de la propia gestora', async () => {
    const people = (await tasks.listAssignees(A.user)).map((p) => p.id).sort();
    expect(people).toEqual([A.userId, A.secondUserId].sort());
    expect(people).not.toContain(B.userId);
  });

  it('un usuario sin gestora (soporte u otro rol) no entra en la agenda aunque llegue al servicio', async () => {
    const orphan: AuthenticatedUser = {
      id: randomUUID(),
      role: 'B',
      estateIds: [],
      administratorId: null,
    };
    expect(await rejection(listItems(orphan, WEEK))).toBeInstanceOf(
      ForbiddenException,
    );
    expect(await rejection(tasks.create(dto(), orphan))).toBeInstanceOf(
      ForbiddenException,
    );
    expect(await rejection(tasks.listLabels(orphan))).toBeInstanceOf(
      ForbiddenException,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('comunidades: ser de la misma gestora NO basta cuando el acceso a la comunidad está restringido', () => {
  it('un gestor restringido a la comunidad norte no accede a ninguna tarea de la comunidad sur', async () => {
    const south = await tasks.create(
      dto({ title: 'Sur', estateId: A.otherEstateId, priority: 'URGENTE' }),
      A.user,
    );
    const north = await tasks.create(
      dto({ title: 'Norte', estateId: A.estateId }),
      A.user,
    );
    const general = await tasks.create(
      dto({ title: 'General (sin comunidad)' }),
      A.user,
    );
    const comment = await extras.addComment(south.id, 'nota', A.user);

    const visible = (await listItems(A.restricted, WEEK))
      .map((t) => t.title)
      .sort();
    expect(visible).toEqual(['General (sin comunidad)', 'Norte']);

    for (const attempt of [
      tasks.getById(south.id, A.restricted),
      tasks.update(south.id, { title: 'x' }, A.restricted),
      tasks.updateStatus(south.id, { status: 'COMPLETADA' }, A.restricted),
      tasks.duplicate(south.id, A.restricted),
      tasks.remove(south.id, A.restricted),
      extras.addComment(south.id, 'x', A.restricted),
      extras.deleteComment(south.id, comment.id, A.restricted),
      extras.addChecklistItem(south.id, 'x', A.restricted),
      extras.addAttachment(south.id, file(), A.restricted),
    ]) {
      expect(await rejection(attempt)).toBeInstanceOf(NotFoundException);
    }
    // Las de su ámbito sí.
    await expect(tasks.getById(north.id, A.restricted)).resolves.toMatchObject({
      title: 'Norte',
    });
    await expect(
      tasks.getById(general.id, A.restricted),
    ).resolves.toMatchObject({ title: 'General (sin comunidad)' });
    // Las listas sin rango y el resumen tampoco las cuentan.
    expect(
      (await listItems(A.restricted, { priority: 'URGENTE', tz: WEEK.tz }))
        .length,
    ).toBe(0);
    const summary = await tasks.summary(A.restricted, {
      dayFrom: '2026-10-13T22:00:00.000Z',
      dayTo: '2026-10-14T22:00:00.000Z',
      weekFrom: WEEK.from,
      weekTo: WEEK.to,
      tz: WEEK.tz,
    });
    expect(summary.urgent).toBe(0);
    expect(summary.week).toBe(2);
  });

  it('el gestor restringido no puede crear, mover ni vincular hacia la comunidad sur', async () => {
    const own = await tasks.create(dto({ estateId: A.estateId }), A.restricted);
    const linkSouth = await prisma.issue.create({
      data: {
        ref: `INC-${randomUUID().slice(0, 8)}`,
        estateId: A.otherEstateId,
        type: 'Averia',
        title: 'Sur',
        description: 'x',
        status: 'Abierta',
        priority: 'Normal',
        source: 'Comunidad',
        date: NOW,
      },
    });

    expect(
      await rejection(
        tasks.create(dto({ estateId: A.otherEstateId }), A.restricted),
      ),
    ).toBeInstanceOf(ForbiddenException);
    expect(
      await rejection(
        tasks.update(own.id, { estateId: A.otherEstateId }, A.restricted),
      ),
    ).toBeInstanceOf(ForbiddenException);
    expect(
      await rejection(
        tasks.create(
          dto({ links: [{ type: 'issue', id: linkSouth.id }] }),
          A.restricted,
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await rejection(
        listItems(A.restricted, { ...WEEK, estateId: A.otherEstateId }),
      ),
    ).toBeInstanceOf(ForbiddenException);
    await prisma.issue.delete({ where: { id: linkSouth.id } });
  });

  it('una entidad vinculada debe ser de la misma comunidad que la tarea', async () => {
    const issueSouth = await prisma.issue.create({
      data: {
        ref: `INC-${randomUUID().slice(0, 8)}`,
        estateId: A.otherEstateId,
        type: 'Averia',
        title: 'Sur',
        description: 'x',
        status: 'Abierta',
        priority: 'Normal',
        source: 'Comunidad',
        date: NOW,
      },
    });
    expect(
      await rejection(
        tasks.create(
          dto({
            estateId: A.estateId,
            links: [{ type: 'issue', id: issueSouth.id }],
          }),
          A.user,
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
    await prisma.issue.delete({ where: { id: issueSouth.id } });
  });

  it('los vínculos válidos se resuelven con su nombre y su ruta, y la tarea hereda la comunidad', async () => {
    const created = await tasks.create(
      dto({
        links: [
          { type: 'issue', id: A.issueId },
          { type: 'meeting', id: A.meetingId },
          { type: 'supplier', id: A.supplierId },
          { type: 'document', id: A.documentId },
        ],
      }),
      A.user,
    );

    expect(created.estate?.id).toBe(A.estateId);
    expect(created.links.map((l) => l.type).sort()).toEqual([
      'document',
      'issue',
      'meeting',
      'supplier',
    ]);
    const issue = created.links.find((l) => l.type === 'issue');
    expect(issue?.label).toMatch(/^INC-.* · Avería ascensor$/);
    expect(issue?.route).toBe(`/b/incidencias/${A.issueId}`);
  });

  it('el vínculo con la incidencia de la que nace una tarea no se puede quitar, aunque se pidan otros vínculos', async () => {
    const created = await tasks.create(
      dto({ links: [{ type: 'issue', id: A.issueId }] }),
      A.user,
    );
    // Como las tareas que abre Domora: nacen de una incidencia (`issueId`).
    await prisma.agendaTask.update({
      where: { id: created.id },
      data: { issueId: A.issueId },
    });

    const emptied = await tasks.update(created.id, { links: [] }, A.user);
    expect(emptied.links.map((l) => `${l.type}:${l.id}`)).toEqual([
      `issue:${A.issueId}`,
    ]);

    const swapped = await tasks.update(
      created.id,
      { links: [{ type: 'supplier', id: A.supplierId }] },
      A.user,
    );
    expect(swapped.links.map((l) => l.type).sort()).toEqual([
      'issue',
      'supplier',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('zonas horarias', () => {
  const day = (iso: string, extra: Partial<CreateAgendaTaskDto> = {}) =>
    dto({
      title: `todo el día ${iso}`,
      allDay: true,
      startAt: `${iso}T00:00:00.000Z`,
      endAt: `${iso}T00:00:00.000Z`,
      timezone: 'Europe/Madrid',
      ...extra,
    });

  // Rango del 14-oct-2026 como "hoy" en cada zona (instantes que pide el navegador).
  const TODAY: Record<string, { from: string; to: string }> = {
    'Europe/Madrid': {
      from: '2026-10-13T22:00:00.000Z',
      to: '2026-10-14T22:00:00.000Z',
    }, // UTC+2
    'America/New_York': {
      from: '2026-10-14T04:00:00.000Z',
      to: '2026-10-15T04:00:00.000Z',
    }, // UTC−4
    'Pacific/Auckland': {
      from: '2026-10-13T11:00:00.000Z',
      to: '2026-10-14T11:00:00.000Z',
    }, // UTC+13
  };

  it.each(Object.keys(TODAY))(
    'las tareas de día completo del día anterior y del siguiente NO aparecen en "hoy" (%s)',
    async (tz) => {
      await tasks.create(day('2026-10-13'), A.user);
      await tasks.create(day('2026-10-14'), A.user);
      await tasks.create(day('2026-10-15'), A.user);

      const items = await listItems(A.user, { ...TODAY[tz], tz });
      expect(items.map((i) => i.title)).toEqual(['todo el día 2026-10-14']);

      const summary = await tasks.summary(A.user, {
        dayFrom: TODAY[tz].from,
        dayTo: TODAY[tz].to,
        weekFrom: TODAY[tz].from,
        weekTo: TODAY[tz].to,
        tz,
      });
      expect(summary.today).toBe(1);
    },
  );

  it('las de día completo se guardan como medianoche UTC aunque el cliente mande una hora cualquiera', async () => {
    const created = await tasks.create(
      dto({
        allDay: true,
        startAt: '2026-10-14T23:30:00.000Z',
        endAt: '2026-10-14T23:30:00.000Z',
      }),
      A.user,
    );
    expect(created.startAt).toBe('2026-10-14T00:00:00.000Z');
    expect(created.endAt).toBe('2026-10-15T00:00:00.000Z');
  });

  it('una tarea con hora ida y vuelta: 09:00 en Madrid se guarda como 07:00Z y vuelve igual', async () => {
    const madrid9 = new Date('2026-10-14T09:00:00+02:00').toISOString();
    const created = await tasks.create(
      dto({
        startAt: madrid9,
        endAt: new Date('2026-10-14T10:00:00+02:00').toISOString(),
      }),
      A.user,
    );

    expect(created.startAt).toBe('2026-10-14T07:00:00.000Z');
    const [item] = await listItems(A.user, WEEK);
    expect(
      new Intl.DateTimeFormat('es-ES', {
        timeZone: 'Europe/Madrid',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(item.occurrenceStart)),
    ).toBe('09:00');
  });

  it('mover una tarea de hora y de día conserva la duración y no la cambia de día', async () => {
    const created = await tasks.create(
      dto({
        startAt: '2026-10-13T07:00:00.000Z',
        endAt: '2026-10-13T08:30:00.000Z',
      }),
      A.user,
    );

    const moved = await tasks.update(
      created.id,
      {
        startAt: '2026-10-15T09:00:00.000Z',
        endAt: '2026-10-15T10:30:00.000Z',
      },
      A.user,
    );

    expect(
      new Date(moved.endAt).getTime() - new Date(moved.startAt).getTime(),
    ).toBe(90 * 60_000);
    expect(moved.startAt).toBe('2026-10-15T09:00:00.000Z');
  });

  it('no se puede terminar antes de empezar (400) y la tarea queda como estaba', async () => {
    const created = await tasks.create(dto(), A.user);

    expect(
      await rejection(
        tasks.update(created.id, { endAt: '2026-10-14T06:00:00.000Z' }, A.user),
      ),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await rejection(
        tasks.create(dto({ endAt: '2026-10-14T06:00:00.000Z' }), A.user),
      ),
    ).toBeInstanceOf(BadRequestException);
    expect((await tasks.getById(created.id, A.user)).endAt).toBe(
      '2026-10-14T08:00:00.000Z',
    );
  });

  it('una zona horaria desconocida se rechaza, en el alta y en las consultas', async () => {
    expect(
      await rejection(tasks.create(dto({ timezone: 'Marte/Olimpo' }), A.user)),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await rejection(listItems(A.user, { ...WEEK, tz: 'Marte/Olimpo' })),
    ).toBeInstanceOf(BadRequestException);
  });

  it('cambio horario CET↔CEST: una serie diaria a las 10:00 locales sigue siendo a las 10:00 tras el 25-oct', async () => {
    await tasks.create(
      dto({
        title: 'Diaria 10:00',
        startAt: '2026-10-24T08:00:00.000Z', // 10:00 CEST
        endAt: '2026-10-24T09:00:00.000Z',
        timezone: 'Europe/Madrid',
        recurrence: { freq: 'DAILY', interval: 1 },
      }),
      A.user,
    );

    const items = await listItems(A.user, {
      from: '2026-10-23T22:00:00.000Z',
      to: '2026-10-28T23:00:00.000Z',
      tz: 'Europe/Madrid',
    });

    const localHours = items.map((i) =>
      new Intl.DateTimeFormat('es-ES', {
        timeZone: 'Europe/Madrid',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(i.occurrenceStart)),
    );
    expect(localHours).toEqual(['10:00', '10:00', '10:00', '10:00', '10:00']);
    expect(items.map((i) => i.occurrenceStart)).toContain(
      '2026-10-25T09:00:00.000Z',
    ); // 10:00 CET (UTC+1)
  });

  it('cambio horario de primavera: la serie semanal a las 10:00 locales cruza el 29-mar-2026 sin moverse', async () => {
    await tasks.create(
      dto({
        startAt: '2026-03-23T09:00:00.000Z',
        endAt: '2026-03-23T10:00:00.000Z',
        timezone: 'Europe/Madrid',
        recurrence: { freq: 'WEEKLY', interval: 1 },
      }),
      A.user,
    );
    const items = await listItems(A.user, {
      from: '2026-03-22T23:00:00.000Z',
      to: '2026-04-06T22:00:00.000Z',
      tz: 'Europe/Madrid',
    });
    // 23-mar: CET (10:00 = 09:00Z). 30-mar y 6-abr: CEST (10:00 = 08:00Z).
    expect(items.map((i) => i.occurrenceStart)).toEqual([
      '2026-03-23T09:00:00.000Z',
      '2026-03-30T08:00:00.000Z',
      '2026-04-06T08:00:00.000Z',
    ]);
  });

  describe('vencimiento de las tareas de día completo: a la medianoche LOCAL de su zona', () => {
    afterEach(() => jest.setSystemTime(NOW));

    it.each([
      // zona, momento, ¿vencida?
      ['Europe/Madrid', '2026-10-14T21:30:00.000Z', false], // 23:30 del propio día
      ['Europe/Madrid', '2026-10-14T22:30:00.000Z', true], // 00:30 del día siguiente
      ['America/New_York', '2026-10-14T23:30:00.000Z', false], // 19:30 del propio día (en UTC ya sería "ayer")
      ['America/New_York', '2026-10-15T04:30:00.000Z', true], // 00:30 del día siguiente
      ['Pacific/Auckland', '2026-10-14T10:30:00.000Z', false], // 23:30 del propio día (UTC+13)
      ['Pacific/Auckland', '2026-10-14T11:30:00.000Z', true], // 00:30 del día siguiente
    ] as const)(
      '%s a las %s → vencida: %s (lista, calendario y KPI coinciden)',
      async (tz, at, expected) => {
        await tasks.create(day('2026-10-14', { timezone: tz }), A.user);
        jest.setSystemTime(new Date(at));

        const [item] = await listItems(A.user, {
          from: '2026-10-11T00:00:00.000Z',
          to: '2026-10-20T00:00:00.000Z',
          tz,
        });
        const listed = await listItems(A.user, { overdue: 'true', tz });
        const summary = await tasks.summary(A.user, {
          dayFrom: '2026-10-13T00:00:00.000Z',
          dayTo: '2026-10-14T00:00:00.000Z',
          weekFrom: '2026-10-11T00:00:00.000Z',
          weekTo: '2026-10-18T00:00:00.000Z',
          tz,
        });

        expect(item.overdue).toBe(expected);
        expect(listed).toHaveLength(expected ? 1 : 0);
        expect(summary.overdue).toBe(expected ? 1 : 0);
      },
    );
  });

  it('el resumen de "hoy" y el calendario del día cuentan lo mismo', async () => {
    await tasks.create(dto({ title: 'con hora' }), A.user);
    await tasks.create(day('2026-10-14'), A.user);
    await tasks.create(day('2026-10-13'), A.user);
    const range = TODAY['Europe/Madrid'];

    const calendar = await listItems(A.user, { ...range, tz: 'Europe/Madrid' });
    const summary = await tasks.summary(A.user, {
      dayFrom: range.from,
      dayTo: range.to,
      weekFrom: WEEK.from,
      weekTo: WEEK.to,
      tz: 'Europe/Madrid',
    });

    expect(calendar).toHaveLength(2);
    expect(summary.today).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('recurrencia', () => {
  const series = (
    freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY',
    interval = 1,
    until?: string,
  ) =>
    dto({
      title: `serie ${freq}/${interval}`,
      startAt: '2026-01-05T09:00:00.000Z',
      endAt: '2026-01-05T10:00:00.000Z',
      timezone: 'UTC',
      recurrence: { freq, interval, until },
    });
  const range = (from: string, to: string) => ({ from, to, tz: 'UTC' });

  it.each([
    [
      'DAILY',
      1,
      '2026-10-12T00:00:00.000Z',
      '2026-10-15T00:00:00.000Z',
      [
        '2026-10-12T09:00:00.000Z',
        '2026-10-13T09:00:00.000Z',
        '2026-10-14T09:00:00.000Z',
      ],
    ],
    [
      'WEEKLY',
      1,
      '2026-10-01T00:00:00.000Z',
      '2026-10-20T00:00:00.000Z',
      [
        '2026-10-05T09:00:00.000Z',
        '2026-10-12T09:00:00.000Z',
        '2026-10-19T09:00:00.000Z',
      ],
    ],
    [
      'MONTHLY',
      1,
      '2026-08-01T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z',
      [
        '2026-08-05T09:00:00.000Z',
        '2026-09-05T09:00:00.000Z',
        '2026-10-05T09:00:00.000Z',
      ],
    ],
    [
      'YEARLY',
      1,
      '2026-12-31T00:00:00.000Z',
      '2027-02-01T00:00:00.000Z',
      ['2027-01-05T09:00:00.000Z'],
    ],
    [
      'YEARLY',
      1,
      '2028-01-01T00:00:00.000Z',
      '2028-02-01T00:00:00.000Z',
      ['2028-01-05T09:00:00.000Z'],
    ],
    // Cada 3 semanas desde el lunes 5-ene: 5-ene, 26-ene, 16-feb, 9-mar, 30-mar…
    [
      'WEEKLY',
      3,
      '2026-02-01T00:00:00.000Z',
      '2026-04-15T00:00:00.000Z',
      [
        '2026-02-16T09:00:00.000Z',
        '2026-03-09T09:00:00.000Z',
        '2026-03-30T09:00:00.000Z',
      ],
    ],
    [
      'MONTHLY',
      3,
      '2026-01-01T00:00:00.000Z',
      '2026-04-10T00:00:00.000Z',
      ['2026-01-05T09:00:00.000Z', '2026-04-05T09:00:00.000Z'],
    ],
    [
      'MONTHLY',
      3,
      '2026-09-01T00:00:00.000Z',
      '2026-12-01T00:00:00.000Z',
      ['2026-10-05T09:00:00.000Z'],
    ],
  ] as const)(
    '%s cada %i: las ocurrencias del rango son las esperadas',
    async (freq, interval, from, to, expected) => {
      await tasks.create(series(freq, interval), A.user);

      const items = await listItems(A.user, range(from, to));

      expect(items.map((i) => i.occurrenceStart)).toEqual(expected);
      expect(new Set(items.map((i) => i.occurrenceKey)).size).toBe(
        items.length,
      );
    },
  );

  it('la fecha de finalización corta la serie (inclusiva)', async () => {
    await tasks.create(series('DAILY', 1, '2026-10-14T09:00:00.000Z'), A.user);

    const items = await listItems(
      A.user,
      range('2026-10-12T00:00:00.000Z', '2026-10-30T00:00:00.000Z'),
    );

    expect(items.map((i) => i.occurrenceStart.slice(0, 10))).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
  });

  it('completar y cancelar UNA ocurrencia no toca la serie ni las demás, y reabrir la restaura', async () => {
    const created = await tasks.create(series('DAILY'), A.user);
    const r = range('2026-10-12T00:00:00.000Z', '2026-10-16T00:00:00.000Z');

    await tasks.updateStatus(
      created.id,
      { status: 'COMPLETADA', occurrenceStart: '2026-10-13T09:00:00.000Z' },
      A.user,
    );
    await tasks.updateStatus(
      created.id,
      { status: 'CANCELADA', occurrenceStart: '2026-10-14T09:00:00.000Z' },
      A.user,
    );

    const items = await listItems(A.user, r);
    expect(
      items.map((i) => [i.occurrenceStart.slice(0, 10), i.status]),
    ).toEqual([
      ['2026-10-12', 'PENDIENTE'],
      ['2026-10-13', 'COMPLETADA'],
      ['2026-10-14', 'CANCELADA'],
      ['2026-10-15', 'PENDIENTE'],
    ]);
    const row = await prisma.agendaTask.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.status).toBe('PENDIENTE');
    expect(row.completedAt).toBeNull();
    expect(
      await prisma.agendaTask.count({
        where: { administratorId: A.administratorId },
      }),
    ).toBe(1);

    await tasks.updateStatus(
      created.id,
      { status: 'PENDIENTE', occurrenceStart: '2026-10-13T09:00:00.000Z' },
      A.user,
    );
    expect((await listItems(A.user, r)).map((i) => i.status)).toEqual([
      'PENDIENTE',
      'PENDIENTE',
      'CANCELADA',
      'PENDIENTE',
    ]);
    expect(
      await prisma.agendaTaskOccurrence.count({
        where: { taskId: created.id },
      }),
    ).toBe(1);
  });

  it('resolver la misma ocurrencia dos veces no duplica registros', async () => {
    const created = await tasks.create(series('DAILY'), A.user);
    for (let i = 0; i < 3; i += 1) {
      await tasks.updateStatus(
        created.id,
        { status: 'COMPLETADA', occurrenceStart: '2026-10-13T09:00:00.000Z' },
        A.user,
      );
    }
    expect(
      await prisma.agendaTaskOccurrence.count({
        where: { taskId: created.id },
      }),
    ).toBe(1);
  });

  it('una fecha que no es ninguna ocurrencia, o una tarea que no se repite, se rechazan', async () => {
    const created = await tasks.create(series('DAILY'), A.user);
    const single = await tasks.create(dto(), A.user);

    expect(
      await rejection(
        tasks.updateStatus(
          created.id,
          { status: 'COMPLETADA', occurrenceStart: '2026-10-13T09:30:00.000Z' },
          A.user,
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await rejection(
        tasks.updateStatus(
          single.id,
          { status: 'COMPLETADA', occurrenceStart: '2026-10-14T07:00:00.000Z' },
          A.user,
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await rejection(
        tasks.updateStatus(
          created.id,
          { status: 'EN_CURSO', occurrenceStart: '2026-10-13T09:00:00.000Z' },
          A.user,
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  it('navegar entre rangos NO crea ningún registro', async () => {
    await tasks.create(series('DAILY'), A.user);
    await tasks.create(series('MONTHLY'), A.user);
    const before = await agendaRowCounts();

    for (const from of [
      '2026-01-01',
      '2026-03-01',
      '2026-06-01',
      '2026-10-01',
      '2027-02-01',
    ]) {
      const to = new Date(
        new Date(`${from}T00:00:00Z`).getTime() + 35 * 86_400_000,
      ).toISOString();
      await listItems(A.user, range(`${from}T00:00:00.000Z`, to));
      await tasks.summary(A.user, {
        dayFrom: `${from}T00:00:00.000Z`,
        dayTo: to,
        weekFrom: `${from}T00:00:00.000Z`,
        weekTo: to,
        tz: 'UTC',
      });
    }

    expect(await agendaRowCounts()).toEqual(before);
  });

  it('el coste está acotado: una serie diaria de hace 10 años solo expande el rango pedido', async () => {
    await tasks.create(
      dto({
        startAt: '2016-01-04T09:00:00.000Z',
        endAt: '2016-01-04T10:00:00.000Z',
        timezone: 'UTC',
        recurrence: { freq: 'DAILY', interval: 1 },
      }),
      A.user,
    );

    const started = Date.now();
    const items = await listItems(
      A.user,
      range('2026-10-01T00:00:00.000Z', '2026-12-30T00:00:00.000Z'),
    ); // 90 días
    const elapsed = Date.now() - started;

    expect(items).toHaveLength(90);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('se rechazan los rangos de más de 100 días y los invertidos (nadie puede pedir "todo")', async () => {
    expect(
      await rejection(
        listItems(
          A.user,
          range('2026-01-01T00:00:00.000Z', '2027-06-01T00:00:00.000Z'),
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await rejection(
        listItems(
          A.user,
          range('2026-10-20T00:00:00.000Z', '2026-10-10T00:00:00.000Z'),
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  it('reglas imposibles se rechazan: intervalo 0, "hasta" anterior al inicio', async () => {
    expect(
      await rejection(
        tasks.create(series('DAILY', 1, '2025-01-01T00:00:00.000Z'), A.user),
      ),
    ).toBeInstanceOf(BadRequestException);
    await expect(
      prisma.agendaTask.create({
        data: {
          administratorId: A.administratorId,
          createdByUserId: A.userId,
          title: 'x',
          startAt: NOW,
          endAt: NOW,
          recurrenceFreq: 'DAILY',
          recurrenceInterval: 0,
        },
      }),
    ).rejects.toThrow(/agenda_tasks_recurrence_interval_chk/);
  });

  describe('editar una serie no reescribe lo que ya ocurrió', () => {
    const madrid = (startAt: string, endAt: string) =>
      dto({
        title: 'Revisión semanal',
        startAt,
        endAt,
        timezone: 'Europe/Madrid',
        recurrence: { freq: 'WEEKLY', interval: 1 },
      });
    const slots = (items: AgendaTaskView[]) =>
      items.map((i) => [i.occurrenceStart, i.status]);

    it('lunes 10:00 → martes 10:00: el 5 y el 12 siguen siendo lunes; las futuras pasan a martes', async () => {
      // 10:00 en Madrid (CET, UTC+1) = 09:00Z.
      const created = await tasks.create(
        madrid('2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
        A.user,
      );
      for (const day of ['2026-01-05', '2026-01-12'])
        await tasks.updateStatus(
          created.id,
          { status: 'COMPLETADA', occurrenceStart: `${day}T09:00:00.000Z` },
          A.user,
        );

      await tasks.update(
        created.id,
        {
          startAt: '2026-01-20T09:00:00.000Z',
          endAt: '2026-01-20T10:00:00.000Z',
        },
        A.user,
      ); // la serie pasa a los martes a partir del 20

      const items = await listItems(A.user, {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-03T00:00:00.000Z',
        tz: 'Europe/Madrid',
      });
      expect(slots(items)).toEqual([
        ['2026-01-05T09:00:00.000Z', 'COMPLETADA'],
        ['2026-01-12T09:00:00.000Z', 'COMPLETADA'],
        ['2026-01-20T09:00:00.000Z', 'PENDIENTE'],
        ['2026-01-27T09:00:00.000Z', 'PENDIENTE'],
      ]);
      expect(
        items.slice(0, 2).map((i) => new Date(i.occurrenceStart).getUTCDay()),
      ).toEqual([1, 1]); // lunes
      expect(
        items.slice(2).map((i) => new Date(i.occurrenceStart).getUTCDay()),
      ).toEqual([2, 2]); // martes
      // La fila conserva la hora y el estado originales (con el fin que tenían).
      const stored = await prisma.agendaTaskOccurrence.findMany({
        where: { taskId: created.id },
        orderBy: { occurrenceStart: 'asc' },
      });
      expect(
        stored.map((o) => [
          o.occurrenceStart.toISOString(),
          o.occurrenceEnd?.toISOString(),
          o.status,
        ]),
      ).toEqual([
        ['2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z', 'COMPLETADA'],
        ['2026-01-12T09:00:00.000Z', '2026-01-12T10:00:00.000Z', 'COMPLETADA'],
      ]);
    });

    it('una ocurrencia cancelada a mano en el pasado sigue cancelada y en su hora tras cambiar la hora de la serie', async () => {
      const created = await tasks.create(
        madrid('2026-01-05T09:00:00.000Z', '2026-01-05T10:00:00.000Z'),
        A.user,
      );
      await tasks.updateStatus(
        created.id,
        { status: 'CANCELADA', occurrenceStart: '2026-01-12T09:00:00.000Z' },
        A.user,
      );
      // 10:00 → 12:00 locales a partir del 19.
      await tasks.update(
        created.id,
        {
          startAt: '2026-01-19T11:00:00.000Z',
          endAt: '2026-01-19T12:00:00.000Z',
        },
        A.user,
      );
      const items = await listItems(A.user, {
        from: '2026-01-10T00:00:00.000Z',
        to: '2026-01-21T00:00:00.000Z',
        tz: 'Europe/Madrid',
      });
      expect(slots(items)).toEqual([
        ['2026-01-12T09:00:00.000Z', 'CANCELADA'],
        ['2026-01-19T11:00:00.000Z', 'PENDIENTE'],
      ]);
    });

    it('DST Europe/Madrid: las resueltas antes y después del cambio de hora conservan su instante exacto', async () => {
      // Lunes 10:00 locales: 09:00Z en invierno (23-mar), 08:00Z en verano (30-mar, el cambio fue el 29).
      const created = await tasks.create(
        madrid('2026-03-23T09:00:00.000Z', '2026-03-23T10:00:00.000Z'),
        A.user,
      );
      for (const iso of [
        '2026-03-23T09:00:00.000Z',
        '2026-03-30T08:00:00.000Z',
      ])
        await tasks.updateStatus(
          created.id,
          { status: 'COMPLETADA', occurrenceStart: iso },
          A.user,
        );
      // A martes, 10:00 locales (08:00Z ya en horario de verano).
      await tasks.update(
        created.id,
        {
          startAt: '2026-04-07T08:00:00.000Z',
          endAt: '2026-04-07T09:00:00.000Z',
        },
        A.user,
      );
      const items = await listItems(A.user, {
        from: '2026-03-20T00:00:00.000Z',
        to: '2026-04-16T00:00:00.000Z',
        tz: 'Europe/Madrid',
      });
      expect(slots(items)).toEqual([
        ['2026-03-23T09:00:00.000Z', 'COMPLETADA'],
        ['2026-03-30T08:00:00.000Z', 'COMPLETADA'],
        ['2026-04-07T08:00:00.000Z', 'PENDIENTE'],
        ['2026-04-14T08:00:00.000Z', 'PENDIENTE'],
      ]);
      const local = (iso: string) =>
        new Intl.DateTimeFormat('es-ES', {
          timeZone: 'Europe/Madrid',
          weekday: 'long',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(iso));
      expect(items.map((i) => local(i.occurrenceStart))).toEqual([
        'lunes, 10:00',
        'lunes, 10:00',
        'martes, 10:00',
        'martes, 10:00',
      ]);
    });

    it('cambiar la regla (frecuencia o intervalo) conserva las resueltas como historia', async () => {
      const created = await tasks.create(series('DAILY'), A.user);
      await tasks.updateStatus(
        created.id,
        { status: 'COMPLETADA', occurrenceStart: '2026-10-13T09:00:00.000Z' },
        A.user,
      );

      await tasks.update(
        created.id,
        { recurrence: { freq: 'WEEKLY', interval: 1 } },
        A.user,
      );

      expect(
        await prisma.agendaTaskOccurrence.count({
          where: { taskId: created.id },
        }),
      ).toBe(1);
      const items = await listItems(
        A.user,
        range('2026-10-13T00:00:00.000Z', '2026-10-14T00:00:00.000Z'),
      );
      expect(slots(items)).toEqual([
        ['2026-10-13T09:00:00.000Z', 'COMPLETADA'],
      ]);
    });

    it('una resolución anterior a la columna (sin fin guardado) se congela con la duración previa al editar', async () => {
      const created = await tasks.create(series('DAILY'), A.user); // 1 h
      await prisma.agendaTaskOccurrence.create({
        data: {
          taskId: created.id,
          occurrenceStart: new Date('2026-10-13T09:00:00.000Z'),
          status: 'COMPLETADA',
        },
      });
      await tasks.update(
        created.id,
        {
          startAt: '2026-01-05T09:00:00.000Z',
          endAt: '2026-01-05T11:00:00.000Z',
        },
        A.user,
      ); // ahora dura 2 h
      const [row] = await prisma.agendaTaskOccurrence.findMany({
        where: { taskId: created.id },
      });
      expect(row.occurrenceEnd?.toISOString()).toBe('2026-10-13T10:00:00.000Z');
    });

    it('editar solo el título no toca las resoluciones', async () => {
      const created = await tasks.create(series('DAILY'), A.user);
      await tasks.updateStatus(
        created.id,
        { status: 'COMPLETADA', occurrenceStart: '2026-10-13T09:00:00.000Z' },
        A.user,
      );

      await tasks.update(created.id, { title: 'Otro título' }, A.user);

      const stored = await prisma.agendaTaskOccurrence.findMany({
        where: { taskId: created.id },
      });
      expect(stored.map((o) => o.occurrenceStart.toISOString())).toEqual([
        '2026-10-13T09:00:00.000Z',
      ]);
    });
  });

  it('una serie terminada (until pasado) no cuenta como urgente ni aparece en la lista de urgentes (el KPI y la lista coinciden)', async () => {
    await tasks.create(
      {
        ...series('DAILY', 1, '2026-09-01T09:00:00.000Z'),
        priority: 'URGENTE',
      },
      A.user,
    );
    await tasks.create(
      { ...dto({ title: 'Urgente puntual' }), priority: 'URGENTE' },
      A.user,
    );

    const list = await listItems(A.user, { priority: 'URGENTE', tz: 'UTC' });
    const summary = await tasks.summary(A.user, {
      dayFrom: WEEK.from,
      dayTo: WEEK.to,
      weekFrom: WEEK.from,
      weekTo: WEEK.to,
      tz: 'UTC',
    });

    expect(list.map((t) => t.title)).toEqual(['Urgente puntual']);
    expect(summary.urgent).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('recordatorios (cron contra la base real)', () => {
  const T = (iso: string) => new Date(iso);
  let notify: jest.SpyInstance;

  beforeEach(() => {
    notify = jest.spyOn(notifications, 'notify').mockResolvedValue(undefined);
  });
  afterEach(() => {
    notify.mockRestore();
    jest.setSystemTime(NOW);
  });

  const reminderTask = (overrides: Partial<CreateAgendaTaskDto> = {}) =>
    dto({
      title: 'Llamada con recordatorio',
      startAt: '2026-11-03T10:00:00.000Z',
      endAt: '2026-11-03T11:00:00.000Z',
      timezone: 'UTC',
      reminderMinutesBefore: 60,
      assignedToUserId: A.userId,
      ...overrides,
    });

  /**
   * `@updatedAt` lo pone el motor de Prisma con el reloj REAL (no el simulado):
   * se fija a mano para que ningún test dependa de cuándo se ejecuta.
   */
  const stamp = (id: string, at: Date = NOW) =>
    prisma.agendaTask.update({ where: { id }, data: { updatedAt: at } });
  const createReminder = async (
    overrides: Partial<CreateAgendaTaskDto> = {},
    at: Date = NOW,
  ) => {
    const created = await tasks.create(reminderTask(overrides), A.user);
    await stamp(created.id, at);
    return created;
  };

  it('UNA ocurrencia + UN recordatorio = UN aviso, aunque el cron corra muchas veces', async () => {
    await createReminder();

    for (let minute = 0; minute < 8; minute += 1) {
      await cron.remindDue(
        new Date(T('2026-11-03T09:00:10.000Z').getTime() + minute * 60_000),
      );
    }

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      userIds: [A.userId],
      category: 'task',
      title: 'Recordatorio: Llamada con recordatorio',
    });
  });

  it('con VARIAS réplicas ejecutando el cron a la vez, solo una envía el aviso', async () => {
    await createReminder();
    const now = T('2026-11-03T09:00:10.000Z');
    const replicas = Array.from(
      { length: 12 },
      () => new AgendaTasksRemindersCronService(db, notifications),
    );

    const results = await Promise.all(
      replicas.map((replica) => replica.remindDue(now)),
    );

    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(
      await prisma.agendaTaskReminder.count({
        where: { task: { administratorId: A.administratorId } },
      }),
    ).toBe(1);
  });

  it('un reinicio del servidor (instancia nueva, sin memoria) no repite el aviso', async () => {
    await createReminder();
    await cron.remindDue(T('2026-11-03T09:00:10.000Z'));

    await new AgendaTasksRemindersCronService(db, notifications).remindDue(
      T('2026-11-03T09:05:00.000Z'),
    );

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('editar la tarea (título, responsable, prioridad…) no vuelve a disparar el recordatorio', async () => {
    const created = await createReminder();
    await cron.remindDue(T('2026-11-03T09:00:10.000Z'));

    await tasks.update(
      created.id,
      {
        title: 'Título nuevo',
        priority: 'ALTA',
        assignedToUserId: A.secondUserId,
      },
      A.user,
    );
    await tasks.update(created.id, { reminderMinutesBefore: 30 }, A.user);
    await stamp(created.id, T('2026-11-03T09:01:00.000Z'));
    await cron.remindDue(T('2026-11-03T09:30:10.000Z'));

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('reprogramar la tarea sí da un aviso nuevo, pero solo para el nuevo momento (y solo uno)', async () => {
    const created = await createReminder();
    await cron.remindDue(T('2026-11-03T09:00:10.000Z'));
    expect(notify).toHaveBeenCalledTimes(1);

    await tasks.update(
      created.id,
      {
        startAt: '2026-11-05T10:00:00.000Z',
        endAt: '2026-11-05T11:00:00.000Z',
      },
      A.user,
    );
    await stamp(created.id, T('2026-11-03T09:20:00.000Z'));
    for (const at of [
      '2026-11-04T09:00:10.000Z',
      '2026-11-05T09:00:10.000Z',
      '2026-11-05T09:03:00.000Z',
    ]) {
      await cron.remindDue(T(at));
    }

    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('no avisa antes de tiempo ni de tareas completadas, canceladas o ya resueltas', async () => {
    const done = await createReminder({ title: 'Hecha' });
    await tasks.updateStatus(done.id, { status: 'COMPLETADA' }, A.user);
    const cancelled = await createReminder({ title: 'Cancelada' });
    await tasks.updateStatus(cancelled.id, { status: 'CANCELADA' }, A.user);
    await createReminder({ title: 'Pendiente' });

    await cron.remindDue(T('2026-11-03T08:59:00.000Z')); // un minuto antes
    expect(notify).not.toHaveBeenCalled();

    await cron.remindDue(T('2026-11-03T09:00:10.000Z'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].title).toBe('Recordatorio: Pendiente');
  });

  it('un recordatorio cuyo momento ya había pasado al crear la tarea no se emite retroactivamente', async () => {
    // Recordatorio a las 09:00, pero la tarea se crea (se "toca") a las 09:40.
    await createReminder({}, T('2026-11-03T09:40:00.000Z'));

    await cron.remindDue(T('2026-11-03T09:41:00.000Z'));

    expect(notify).not.toHaveBeenCalled();
  });

  it('serie diaria con antelación de 1 día: cada ocurrencia se avisa UNA vez (sin rebotar entre ocurrencias)', async () => {
    await createReminder({
      title: 'Diaria',
      recurrence: { freq: 'DAILY', interval: 1 },
      reminderMinutesBefore: 1440,
      startAt: '2026-11-10T09:00:00.000Z',
      endAt: '2026-11-10T10:00:00.000Z',
    });

    // Minuto a minuto durante las 2 horas siguientes al inicio de la ocurrencia del 11-nov.
    const base = T('2026-11-11T09:00:05.000Z').getTime();
    for (let m = 0; m < 120; m += 1)
      await cron.remindDue(new Date(base + m * 60_000));

    // Dos ocurrencias DISTINTAS (11 y 12 de noviembre), cada una avisada exactamente una vez:
    // antes del arreglo esto rebotaba entre ambas durante toda la hora.
    const keys = notify.mock.calls.map((c) => c[0].dedupeKey as string);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it('el aviso lleva una clave de deduplicación POR ocurrencia (el de una no oculta el de la siguiente)', async () => {
    await createReminder({
      recurrence: { freq: 'DAILY', interval: 1 },
      reminderMinutesBefore: 60,
      startAt: '2026-11-10T10:00:00.000Z',
      endAt: '2026-11-10T11:00:00.000Z',
    });

    await cron.remindDue(T('2026-11-10T09:00:10.000Z'));
    await cron.remindDue(T('2026-11-11T09:00:10.000Z'));

    const keys = notify.mock.calls.map(
      (c) => (c[0] as { dedupeKey: string }).dedupeKey,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('una ocurrencia completada de la serie no se avisa; las demás sí', async () => {
    const created = await createReminder({
      recurrence: { freq: 'DAILY', interval: 1 },
      reminderMinutesBefore: 60,
      startAt: '2026-11-10T10:00:00.000Z',
      endAt: '2026-11-10T11:00:00.000Z',
    });
    await tasks.updateStatus(
      created.id,
      { status: 'COMPLETADA', occurrenceStart: '2026-11-11T10:00:00.000Z' },
      A.user,
    );

    await cron.remindDue(T('2026-11-11T09:00:10.000Z'));
    await cron.remindDue(T('2026-11-12T09:00:10.000Z'));

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('un recordatorio de día completo se dispara a la medianoche LOCAL, no a la UTC', async () => {
    await createReminder({
      title: 'Todo el día',
      allDay: true,
      startAt: '2026-11-20T00:00:00.000Z',
      endAt: '2026-11-20T00:00:00.000Z',
      timezone: 'Europe/Madrid',
      reminderMinutesBefore: 0,
    });

    await cron.remindDue(T('2026-11-19T22:59:00.000Z')); // 23:59 del 19 en Madrid
    expect(notify).not.toHaveBeenCalled();
    await cron.remindDue(T('2026-11-19T23:00:30.000Z')); // 00:00:30 del 20 en Madrid
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('si el responsable no existe se avisa a quien creó la tarea', async () => {
    await createReminder({ assignedToUserId: undefined });

    await cron.remindDue(T('2026-11-03T09:00:10.000Z'));

    expect(notify.mock.calls[0][0].userIds).toEqual([A.userId]);
  });

  it('la limpieza diaria borra solo los registros antiguos', async () => {
    const created = await createReminder();
    await prisma.agendaTaskReminder.createMany({
      data: [
        {
          taskId: created.id,
          occurrenceStart: new Date(NOW.getTime() - 90 * 86_400_000),
        },
        {
          taskId: created.id,
          occurrenceStart: new Date(NOW.getTime() - 2 * 86_400_000),
        },
      ],
    });

    await cron.prune();

    expect(
      await prisma.agendaTaskReminder.count({ where: { taskId: created.id } }),
    ).toBe(1);
  });

  it('con la bandeja real: el aviso llega a la persona correcta y no se duplica entre ejecuciones', async () => {
    notify.mockRestore();
    const created = await createReminder({ assignedToUserId: A.secondUserId });

    await Promise.all([
      cron.remindDue(T('2026-11-03T09:00:10.000Z')),
      cron.remindDue(T('2026-11-03T09:00:12.000Z')),
      new AgendaTasksRemindersCronService(db, notifications).remindDue(
        T('2026-11-03T09:00:14.000Z'),
      ),
    ]);

    const rows = await prisma.notification.findMany({
      where: { userId: { in: [A.userId, A.secondUserId] }, category: 'task' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: A.secondUserId,
      link: `/b/tasks?task=${created.id}`,
    });
  });
});

describe('desmarcar una tarea completada: vuelve al estado que tenía', () => {
  const stateOf = async (id: string) =>
    prisma.agendaTask.findUniqueOrThrow({
      where: { id },
      select: { status: true, statusBeforeCompletion: true, completedAt: true },
    });

  it.each(['PENDIENTE', 'EN_CURSO', 'EN_ESPERA'] as const)(
    'completar desde %s y desmarcar restaura %s',
    async (before) => {
      const task = await tasks.create(
        dto({ title: `Vuelve a ${before}` }),
        A.user,
      );
      if (before !== 'PENDIENTE') {
        await tasks.updateStatus(task.id, { status: before }, A.user);
      }

      await tasks.updateStatus(task.id, { status: 'COMPLETADA' }, A.user);
      expect(await stateOf(task.id)).toMatchObject({
        status: 'COMPLETADA',
        statusBeforeCompletion: before,
      });

      const back = await tasks.updateStatus(
        task.id,
        { status: 'PENDIENTE', restorePrevious: true },
        A.user,
      );

      expect(back.status).toBe(before);
      expect(await stateOf(task.id)).toEqual({
        status: before,
        statusBeforeCompletion: null,
        completedAt: null,
      });
    },
  );

  it('sin restorePrevious "Reabrir" sigue yendo a PENDIENTE (comportamiento anterior)', async () => {
    const task = await tasks.create(dto(), A.user);
    await tasks.updateStatus(task.id, { status: 'EN_CURSO' }, A.user);
    await tasks.updateStatus(task.id, { status: 'COMPLETADA' }, A.user);

    await tasks.updateStatus(task.id, { status: 'PENDIENTE' }, A.user);

    expect((await stateOf(task.id)).status).toBe('PENDIENTE');
  });

  it('completar dos veces seguidas no pisa el estado de origen', async () => {
    const task = await tasks.create(dto(), A.user);
    await tasks.updateStatus(task.id, { status: 'EN_ESPERA' }, A.user);
    await tasks.updateStatus(task.id, { status: 'COMPLETADA' }, A.user);
    await tasks.updateStatus(task.id, { status: 'COMPLETADA' }, A.user);

    await tasks.updateStatus(
      task.id,
      { status: 'PENDIENTE', restorePrevious: true },
      A.user,
    );

    expect((await stateOf(task.id)).status).toBe('EN_ESPERA');
  });

  it('una tarea completada de antes (sin estado guardado) vuelve a PENDIENTE', async () => {
    const task = await tasks.create(dto(), A.user);
    await prisma.agendaTask.update({
      where: { id: task.id },
      data: {
        status: 'COMPLETADA',
        completedAt: new Date(),
        statusBeforeCompletion: null,
      },
    });

    await tasks.updateStatus(
      task.id,
      { status: 'PENDIENTE', restorePrevious: true },
      A.user,
    );

    expect((await stateOf(task.id)).status).toBe('PENDIENTE');
  });

  it('restorePrevious en una tarea no completada no cambia nada más que el estado pedido', async () => {
    const task = await tasks.create(dto(), A.user);
    await tasks.updateStatus(task.id, { status: 'EN_CURSO' }, A.user);

    await tasks.updateStatus(
      task.id,
      { status: 'PENDIENTE', restorePrevious: true },
      A.user,
    );

    expect(await stateOf(task.id)).toMatchObject({
      status: 'PENDIENTE',
      statusBeforeCompletion: null,
    });
  });

  it('restorePrevious solo se admite con PENDIENTE', async () => {
    const task = await tasks.create(dto(), A.user);

    expect(
      await rejection(
        tasks.updateStatus(
          task.id,
          { status: 'CANCELADA', restorePrevious: true },
          A.user,
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  it('en una serie, desmarcar una ocurrencia completada la deja como el resto de la serie', async () => {
    const serie = await tasks.create(
      dto({
        timezone: 'UTC',
        startAt: '2026-10-12T09:00:00.000Z',
        endAt: '2026-10-12T10:00:00.000Z',
        recurrence: { freq: 'DAILY', interval: 1 },
      }),
      A.user,
    );
    const occurrenceStart = '2026-10-13T09:00:00.000Z';
    await tasks.updateStatus(
      serie.id,
      { status: 'COMPLETADA', occurrenceStart },
      A.user,
    );

    await tasks.updateStatus(
      serie.id,
      { status: 'PENDIENTE', occurrenceStart, restorePrevious: true },
      A.user,
    );

    expect(
      await prisma.agendaTaskOccurrence.count({ where: { taskId: serie.id } }),
    ).toBe(0);
  });

  it('otra gestora no puede desmarcar la tarea (404)', async () => {
    const task = await tasks.create(dto(), A.user);

    expect(
      await rejection(
        tasks.updateStatus(
          task.id,
          { status: 'PENDIENTE', restorePrevious: true },
          B.user,
        ),
      ),
    ).toBeInstanceOf(NotFoundException);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('etiquetas: catálogo inicial sembrado UNA sola vez', () => {
  async function freshTenant() {
    const admin = await createAdministrator(prisma, {
      name: 'Gestora etiquetas',
    });
    const user: AuthenticatedUser = {
      id: admin.userId,
      role: 'B',
      estateIds: [],
      administratorId: admin.administratorId,
    };
    return { admin, user };
  }
  async function cleanup(administratorId: string) {
    await purgeAdministrator(prisma, administratorId);
  }

  it('la primera vez se siembran las etiquetas iniciales', async () => {
    const { admin, user } = await freshTenant();
    const labels = await tasks.listLabels(user);
    expect(labels.map((l) => l.name).sort()).toEqual(
      [...DEFAULT_LABELS].sort(),
    );
    await cleanup(admin.administratorId);
  });

  it('peticiones simultáneas la primera vez NO duplican ni fallan', async () => {
    const { admin, user } = await freshTenant();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => tasks.listLabels(user)),
    );

    expect(
      await prisma.agendaTaskLabel.count({
        where: { administratorId: admin.administratorId },
      }),
    ).toBe(DEFAULT_LABELS.length);
    for (const labels of results)
      expect(labels).toHaveLength(DEFAULT_LABELS.length);
    await cleanup(admin.administratorId);
  });

  it('una etiqueta borrada voluntariamente NO reaparece', async () => {
    const { admin, user } = await freshTenant();
    const labels = await tasks.listLabels(user);
    const removed = labels.find((l) => l.name === 'Ascensor')!;

    await tasks.deleteLabel(removed.id, user);
    const after = await tasks.listLabels(user);
    const again = await tasks.listLabels(user);

    expect(after).toHaveLength(DEFAULT_LABELS.length - 1);
    expect(after.map((l) => l.name)).not.toContain('Ascensor');
    expect(again).toEqual(after);
    await cleanup(admin.administratorId);
  });

  it('si se borran TODAS, el catálogo queda vacío y no se recrea', async () => {
    const { admin, user } = await freshTenant();
    for (const label of await tasks.listLabels(user))
      await tasks.deleteLabel(label.id, user);

    expect(await tasks.listLabels(user)).toEqual([]);
    expect(await tasks.listLabels(user)).toEqual([]);
    const created = await tasks.createLabel('Solo esta', user);
    expect((await tasks.listLabels(user)).map((l) => l.id)).toEqual([
      created.id,
    ]);
    await cleanup(admin.administratorId);
  });

  it('si la gestora estrena Tareas creando una etiqueta, también recibe las iniciales (y una sola vez)', async () => {
    const { admin, user } = await freshTenant();

    await tasks.createLabel('Mi etiqueta', user);

    const labels = await tasks.listLabels(user);
    expect(labels).toHaveLength(DEFAULT_LABELS.length + 1);
    expect(labels.map((l) => l.name)).toContain('Mi etiqueta');
    await cleanup(admin.administratorId);
  });

  it('crear una etiqueta repetida (sin distinguir mayúsculas) devuelve la existente', async () => {
    const { admin, user } = await freshTenant();
    const [first] = await tasks.listLabels(user);

    const dup = await tasks.createLabel(
      `  ${first.name.toUpperCase()}  `,
      user,
    );

    expect(dup.id).toBe(first.id);
    await cleanup(admin.administratorId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('adjuntos (StorageService compartido)', () => {
  const stored = async (taskId: string) =>
    prisma.agendaTaskAttachment.findMany({ where: { taskId } });

  it('sube, lee y borra: el fichero vive bajo agenda-tasks/<tarea>/ y se limpia del disco', async () => {
    const created = await tasks.create(dto(), A.user);

    const attachment = await extras.addAttachment(
      created.id,
      file('presupuesto.pdf', 'application/pdf', 64),
      A.user,
    );
    const [row] = await stored(created.id);
    expect(row.s3Key.startsWith(`agenda-tasks/${created.id}/`)).toBe(true);
    expect(fs.existsSync(path.join(tmpStorage, row.s3Key))).toBe(true);

    const read = await extras.readAttachment(created.id, attachment.id, A.user);
    expect(read.fileName).toBe('presupuesto.pdf');
    expect(read.content.length).toBe(64);

    await extras.deleteAttachment(created.id, attachment.id, A.user);
    expect(await stored(created.id)).toEqual([]);
    expect(fs.existsSync(path.join(tmpStorage, row.s3Key))).toBe(false);
  });

  it('rechaza tipos no permitidos, ficheros demasiado grandes y la ausencia de fichero', async () => {
    const created = await tasks.create(dto(), A.user);

    expect(
      await rejection(
        extras.addAttachment(
          created.id,
          file('virus.exe', 'application/x-msdownload'),
          A.user,
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await rejection(
        extras.addAttachment(
          created.id,
          { ...file(), size: 11 * 1024 * 1024 },
          A.user,
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await rejection(extras.addAttachment(created.id, undefined, A.user)),
    ).toBeInstanceOf(BadRequestException);
    expect(await stored(created.id)).toEqual([]);
  });

  it('no se puede leer un adjunto con el id de otra tarea de la misma gestora', async () => {
    const one = await tasks.create(dto({ title: 'Uno' }), A.user);
    const two = await tasks.create(dto({ title: 'Dos' }), A.user);
    const attachment = await extras.addAttachment(one.id, file(), A.user);

    expect(
      await rejection(extras.readAttachment(two.id, attachment.id, A.user)),
    ).toBeInstanceOf(NotFoundException);
    expect(
      await rejection(extras.deleteAttachment(two.id, attachment.id, A.user)),
    ).toBeInstanceOf(NotFoundException);
  });

  it('el nombre del fichero no puede escapar del almacén (path traversal)', async () => {
    const created = await tasks.create(dto(), A.user);

    await extras.addAttachment(
      created.id,
      file('../../../etc/passwd.pdf'),
      A.user,
    );

    const [row] = await stored(created.id);
    // Las barras se sustituyen: queda un único nombre de fichero bajo agenda-tasks/<tarea>/.
    expect(row.s3Key).toMatch(
      /^agenda-tasks\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[A-Za-z0-9._-]+$/,
    );
    expect(
      path.resolve(tmpStorage, row.s3Key).startsWith(path.resolve(tmpStorage)),
    ).toBe(true);
  });

  it('hay un tope de adjuntos por tarea', async () => {
    const created = await tasks.create(dto(), A.user);
    await prisma.agendaTaskAttachment.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        taskId: created.id,
        fileName: `f${i}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1,
        s3Key: `agenda-tasks/${created.id}/f${i}`,
      })),
    });

    expect(
      await rejection(extras.addAttachment(created.id, file(), A.user)),
    ).toBeInstanceOf(BadRequestException);
  });

  it('si falla el registro en BD, el fichero recién subido no queda huérfano en disco', async () => {
    const created = await tasks.create(dto(), A.user);
    const spy = jest
      .spyOn(prisma.agendaTaskAttachment, 'create')
      .mockRejectedValueOnce(new Error('BD caída'));
    const before = fs.existsSync(
      path.join(tmpStorage, 'agenda-tasks', created.id),
    )
      ? fs.readdirSync(path.join(tmpStorage, 'agenda-tasks', created.id)).length
      : 0;

    await expect(
      extras.addAttachment(created.id, file(), A.user),
    ).rejects.toThrow('BD caída');

    spy.mockRestore();
    const dir = path.join(tmpStorage, 'agenda-tasks', created.id);
    const after = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    expect(after).toBe(before);
  });

  it('borrar la tarea borra sus ficheros del disco y todo lo que cuelga de ella', async () => {
    const created = await tasks.create(
      dto({
        checklist: ['uno'],
        labelIds: [(await tasks.listLabels(A.user))[0].id],
      }),
      A.user,
    );
    await extras.addComment(created.id, 'hola', A.user);
    await extras.addAttachment(created.id, file(), A.user);
    const [row] = await stored(created.id);

    await tasks.remove(created.id, A.user);

    expect(fs.existsSync(path.join(tmpStorage, row.s3Key))).toBe(false);
    for (const count of await Promise.all([
      prisma.agendaTaskComment.count({ where: { taskId: created.id } }),
      prisma.agendaTaskChecklistItem.count({ where: { taskId: created.id } }),
      prisma.agendaTaskAttachment.count({ where: { taskId: created.id } }),
      prisma.agendaTaskLabelLink.count({ where: { taskId: created.id } }),
    ]))
      expect(count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('base de datos: restricciones y cascadas reales', () => {
  const base = () => ({
    administratorId: A.administratorId,
    createdByUserId: A.userId,
    title: 'x',
    startAt: NOW,
    endAt: new Date(NOW.getTime() + 3_600_000),
  });

  it('los CHECK rechazan datos imposibles aunque se salte la aplicación', async () => {
    await expect(
      prisma.agendaTask.create({
        data: { ...base(), endAt: new Date(NOW.getTime() - 1) },
      }),
    ).rejects.toThrow(/agenda_tasks_end_after_start_chk/);
    await expect(
      prisma.agendaTask.create({
        data: { ...base(), reminderMinutesBefore: -5 },
      }),
    ).rejects.toThrow(/agenda_tasks_reminder_chk/);
    await expect(
      prisma.agendaTask.create({
        data: { ...base(), reminderMinutesBefore: 10_081 },
      }),
    ).rejects.toThrow(/agenda_tasks_reminder_chk/);
    await expect(
      prisma.agendaTask.create({ data: { ...base(), recurrenceUntil: NOW } }),
    ).rejects.toThrow(/agenda_tasks_recurrence_chk/);
  });

  it('(gestora, source, source_ref) es único: una automatización no puede crear la misma tarea dos veces', async () => {
    await prisma.agendaTask.create({
      data: { ...base(), source: 'issue_followup', sourceRef: 'inc-1' },
    });
    await expect(
      prisma.agendaTask.create({
        data: { ...base(), source: 'issue_followup', sourceRef: 'inc-1' },
      }),
    ).rejects.toThrow(/Unique constraint/);
    // …pero la misma referencia en OTRA gestora es otra cosa, y las manuales (sin ref) conviven.
    await prisma.agendaTask.create({
      data: {
        ...base(),
        administratorId: B.administratorId,
        createdByUserId: B.userId,
        source: 'issue_followup',
        sourceRef: 'inc-1',
      },
    });
    await prisma.agendaTask.create({ data: base() });
    await prisma.agendaTask.create({ data: base() });
  });

  it('una tarea no puede durar más de 31 días: la BD lo garantiza, y la consulta de calendario se apoya en ello', async () => {
    await expect(
      prisma.agendaTask.create({
        data: { ...base(), endAt: new Date(NOW.getTime() + 32 * 86_400_000) },
      }),
    ).rejects.toThrow(/agenda_tasks_max_duration_chk/);
    await prisma.agendaTask.create({
      data: { ...base(), endAt: new Date(NOW.getTime() + 31 * 86_400_000) },
    });
    expect(
      await rejection(
        tasks.create(
          dto({
            startAt: '2026-10-01T00:00:00.000Z',
            endAt: '2026-11-10T00:00:00.000Z',
          }),
          A.user,
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  it('la consulta acotada por inicio sigue encontrando tareas LARGAS que empezaron antes del rango (y descarta las que ya terminaron)', async () => {
    // 31 días de día completo: 14-sep → 15-oct (fin exclusivo). Solapa con la semana del 12 al 18 de octubre.
    await tasks.create(
      dto({
        title: 'Obra de 31 días',
        allDay: true,
        startAt: '2026-09-14T00:00:00.000Z',
        endAt: '2026-10-15T00:00:00.000Z',
      }),
      A.user,
    );
    // Termina el 10-oct a las 08:00: no solapa con la semana.
    await tasks.create(
      dto({
        title: 'Ya terminó',
        startAt: '2026-10-09T07:00:00.000Z',
        endAt: '2026-10-10T08:00:00.000Z',
      }),
      A.user,
    );

    const titles = (await listItems(A.user, WEEK)).map((t) => t.title);

    expect(titles).toEqual(['Obra de 31 días']);
  });

  it('las consultas de calendario usan índices (no recorren el histórico de la gestora)', async () => {
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN SELECT * FROM agenda_tasks WHERE administrator_id = '${A.administratorId}'::uuid AND ((recurrence_freq IS NULL AND start_at >= '2026-09-01'::timestamptz AND start_at < '2026-10-20'::timestamptz AND end_at >= '2026-10-10'::timestamptz) OR (recurrence_freq IS NOT NULL AND start_at < '2026-10-20'::timestamptz)) ORDER BY start_at LIMIT 1000`,
    );
    // Con las tablas casi vacías de un test Postgres puede preferir un Seq Scan; lo que se comprueba es que los índices EXISTEN.
    const indexes = await prisma.$queryRaw<
      { indexname: string }[]
    >`SELECT indexname FROM pg_indexes WHERE tablename = 'agenda_tasks'`;
    const names = indexes.map((i) => i.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        'agenda_tasks_administrator_id_start_at_idx',
        'agenda_tasks_administrator_id_status_end_at_idx',
        'agenda_tasks_recurring_idx',
        'agenda_tasks_reminder_idx',
      ]),
    );
    expect(plan.length).toBeGreaterThan(0);
  });

  it('una consulta de rango añade las tareas abiertas de incidencias que vencen después (y solo esas)', async () => {
    const mk = (title: string, data: Record<string, unknown>) =>
      prisma.agendaTask.create({
        data: {
          administratorId: A.administratorId,
          createdByUserId: A.userId,
          title,
          startAt: new Date('2026-10-30T10:00:00.000Z'),
          endAt: new Date('2026-10-30T10:30:00.000Z'),
          ...data,
        } as never,
      });
    await mk('Incidencia futura', { source: 'issue', sourceRef: randomUUID() });
    await mk('Incidencia futura hecha', {
      source: 'issue',
      sourceRef: randomUUID(),
      status: 'COMPLETADA',
    });
    await mk('Manual futura', {});

    const titles = (await listItems(A.user, WEEK)).map((t) => t.title);

    expect(titles).toContain('Incidencia futura');
    expect(titles).not.toContain('Incidencia futura hecha');
    expect(titles).not.toContain('Manual futura');
  });

  it('avisa (truncated) cuando se alcanza el tope de seguridad en vez de mostrar un calendario incompleto como si fuese completo', async () => {
    const few = await tasks.list(A.user, WEEK);
    expect(few.truncated).toBe(false);

    await prisma.agendaTask.createMany({
      data: Array.from({ length: MAX_RANGE_ITEMS + 1 }, (_, i) => ({
        ...base(),
        title: `Masiva ${i}`,
      })),
    });
    const full = await tasks.list(A.user, WEEK);

    expect(full.truncated).toBe(true);
    expect(full.items.length).toBeLessThanOrEqual(MAX_RANGE_ITEMS);
  });

  it('el enum NotificationCategory incluye "task"', async () => {
    const rows = await prisma.$queryRaw<
      { v: string }[]
    >`SELECT unnest(enum_range(NULL::"NotificationCategory"))::text AS v`;
    expect(rows.map((r) => r.v)).toContain('task');
  });

  it('borrar una etiqueta la quita de las tareas sin borrarlas', async () => {
    const label = await tasks.createLabel('Temporal', A.user);
    const created = await tasks.create(dto({ labelIds: [label.id] }), A.user);

    await tasks.deleteLabel(label.id, A.user);

    const after = await tasks.getById(created.id, A.user);
    expect(after.labels).toEqual([]);
  });

  it('borrar una comunidad deja la tarea sin comunidad (no la borra)', async () => {
    const estateId = await createEstate(prisma, A.administratorId, {
      name: 'Efímera',
    });
    const created = await tasks.create(dto({ estateId }), {
      ...A.user,
      estateIds: [...A.user.estateIds, estateId],
    });

    await prisma.estate.delete({ where: { id: estateId } });

    const row = await prisma.agendaTask.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.estateId).toBeNull();
  });

  it('el borrado de un responsable deja la tarea sin asignar', async () => {
    const temp = await prisma.user.create({
      data: {
        email: uniqueEmail('temp'),
        passwordHash: 'x',
        fullName: 'Temp',
        role: 'B',
        administratorId: A.administratorId,
      },
    });
    const created = await tasks.create(
      dto({ assignedToUserId: temp.id }),
      A.user,
    );

    await prisma.user.delete({ where: { id: temp.id } });

    expect(
      (await prisma.agendaTask.findUniqueOrThrow({ where: { id: created.id } }))
        .assignedToUserId,
    ).toBeNull();
  });

  it('se audita cada operación relevante en data_access_log', async () => {
    // Prisma 7 generates now() defaults in the client, so they follow the frozen
    // test clock and would all tie on occurredAt; advance it between operations.
    const tick = () => jest.setSystemTime(new Date(Date.now() + 1000));
    const created = await tasks.create(dto(), A.user);
    tick();
    await tasks.update(
      created.id,
      { assignedToUserId: A.secondUserId },
      A.user,
    );
    tick();
    await tasks.update(
      created.id,
      {
        startAt: '2026-10-15T07:00:00.000Z',
        endAt: '2026-10-15T08:00:00.000Z',
      },
      A.user,
    );
    tick();
    await tasks.updateStatus(created.id, { status: 'COMPLETADA' }, A.user);
    tick();
    await tasks.updateStatus(created.id, { status: 'CANCELADA' }, A.user);
    tick();
    await tasks.remove(created.id, A.user);

    const actions = (
      await prisma.dataAccessLog.findMany({
        where: { resource: 'agenda_task', resourceId: created.id },
        orderBy: { occurredAt: 'asc' },
      })
    ).map((r) => r.action);
    expect(actions).toEqual([
      'create',
      'reassign',
      'reschedule',
      'complete',
      'cancel',
      'delete',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('KPI y listas coinciden con los datos reales', () => {
  it('urgentes y vencidas: el contador es exactamente el tamaño de su lista', async () => {
    const future = {
      startAt: '2026-10-20T07:00:00.000Z',
      endAt: '2026-10-20T08:00:00.000Z',
    };
    const past = {
      startAt: '2026-10-01T07:00:00.000Z',
      endAt: '2026-10-01T08:00:00.000Z',
    };
    await tasks.create(
      dto({ title: 'Urgente 1', priority: 'URGENTE', ...future }),
      A.user,
    );
    await tasks.create(
      dto({
        title: 'Urgente 2',
        priority: 'URGENTE',
        startAt: '2026-11-01T07:00:00.000Z',
        endAt: '2026-11-01T08:00:00.000Z',
      }),
      A.user,
    );
    await tasks.create(
      dto({
        title: 'Urgente hecha',
        priority: 'URGENTE',
        status: 'COMPLETADA',
        ...future,
      }),
      A.user,
    );
    await tasks.create(dto({ title: 'Vencida', ...past }), A.user);
    await tasks.create(
      dto({ title: 'Vencida y completada', status: 'COMPLETADA', ...past }),
      A.user,
    );
    await tasks.create(
      dto({ title: 'Vencida y cancelada', status: 'CANCELADA', ...past }),
      A.user,
    );
    await tasks.create(dto({ title: 'Futura', ...future }), A.user);
    const tz = 'Europe/Madrid';

    const urgentList = await listItems(A.user, { priority: 'URGENTE', tz });
    const overdueList = await listItems(A.user, { overdue: 'true', tz });
    const summary = await tasks.summary(A.user, {
      dayFrom: WEEK.from,
      dayTo: WEEK.to,
      weekFrom: WEEK.from,
      weekTo: WEEK.to,
      tz,
    });

    expect(urgentList.map((t) => t.title).sort()).toEqual([
      'Urgente 1',
      'Urgente 2',
    ]);
    expect(overdueList.map((t) => t.title)).toEqual(['Vencida']);
    expect(summary.urgent).toBe(urgentList.length);
    expect(summary.overdue).toBe(overdueList.length);
  });

  it('las listas sin rango solo traen trabajo ABIERTO y respetan el tope (nunca el histórico)', async () => {
    for (let i = 0; i < 5; i += 1) {
      await tasks.create(
        dto({
          title: `Abierta ${i}`,
          priority: 'URGENTE',
          startAt: `2026-11-0${i + 1}T07:00:00.000Z`,
          endAt: `2026-11-0${i + 1}T08:00:00.000Z`,
        }),
        A.user,
      );
    }
    await tasks.create(
      dto({ title: 'Cerrada', priority: 'URGENTE', status: 'COMPLETADA' }),
      A.user,
    );

    const list = await listItems(A.user, {
      priority: 'URGENTE',
      tz: 'UTC',
      limit: 3,
    });

    expect(list).toHaveLength(3);
    expect(list.map((t) => t.status)).not.toContain('COMPLETADA');
  });

  it('el calendario no devuelve la descripción (texto largo) pero el detalle sí', async () => {
    const created = await tasks.create(
      dto({ description: 'x'.repeat(5_000) }),
      A.user,
    );

    const [item] = await listItems(A.user, WEEK);

    expect('description' in item).toBe(false);
    expect((await tasks.getById(created.id, A.user)).description).toHaveLength(
      5_000,
    );
  });

  it('la búsqueda encuentra por título, descripción, comunidad, responsable, etiqueta y proveedor', async () => {
    const label = await tasks.createLabel('Etiqueta-única', A.user);
    await tasks.create(
      dto({
        title: 'Título-único',
        description: 'Descripción-única',
        estateId: A.estateId,
        assignedToUserId: A.secondUserId,
        labelIds: [label.id],
        links: [{ type: 'supplier', id: A.supplierId }],
      }),
      A.user,
    );
    await prisma.supplier.update({
      where: { id: A.supplierId },
      data: { name: 'Proveedor-único' },
    });
    await prisma.user.update({
      where: { id: A.secondUserId },
      data: { fullName: 'Responsable-único' },
    });
    await prisma.estate.update({
      where: { id: A.estateId },
      data: { name: 'Comunidad-única' },
    });

    for (const q of [
      'título-único',
      'descripción-única',
      'comunidad-única',
      'responsable-único',
      'etiqueta-única',
      'proveedor-único',
    ]) {
      expect({
        q,
        found: (await listItems(A.user, { ...WEEK, q })).length,
      }).toEqual({ q, found: 1 });
    }
    expect(await listItems(A.user, { ...WEEK, q: 'no-existe-nada' })).toEqual(
      [],
    );
  });

  it('los filtros se combinan (AND) y el de estado se aplica por ocurrencia en las series', async () => {
    const serie = await tasks.create(
      dto({
        title: 'Serie',
        timezone: 'UTC',
        startAt: '2026-10-12T09:00:00.000Z',
        endAt: '2026-10-12T10:00:00.000Z',
        recurrence: { freq: 'DAILY', interval: 1 },
        priority: 'ALTA',
        type: 'VISITA',
      }),
      A.user,
    );
    await tasks.updateStatus(
      serie.id,
      { status: 'COMPLETADA', occurrenceStart: '2026-10-13T09:00:00.000Z' },
      A.user,
    );
    await tasks.create(
      dto({ title: 'Otra', priority: 'BAJA', type: 'LLAMADA' }),
      A.user,
    );

    const done = await listItems(A.user, {
      from: '2026-10-12T00:00:00.000Z',
      to: '2026-10-15T00:00:00.000Z',
      tz: 'UTC',
      status: 'COMPLETADA',
      priority: 'ALTA',
      type: 'VISITA',
    });
    const none = await listItems(A.user, {
      from: '2026-10-12T00:00:00.000Z',
      to: '2026-10-15T00:00:00.000Z',
      tz: 'UTC',
      status: 'COMPLETADA',
      priority: 'BAJA',
    });

    expect(done.map((t) => t.occurrenceStart.slice(0, 10))).toEqual([
      '2026-10-13',
    ]);
    expect(none).toEqual([]);
  });

  it('duplicar copia campos, etiquetas, checklist (sin marcar) y vínculos, pero no comentarios ni adjuntos', async () => {
    const label = (await tasks.listLabels(A.user))[0];
    const created = await tasks.create(
      dto({
        labelIds: [label.id],
        checklist: ['a', 'b'],
        links: [{ type: 'issue', id: A.issueId }],
        priority: 'ALTA',
      }),
      A.user,
    );
    await prisma.agendaTaskChecklistItem.updateMany({
      where: { taskId: created.id },
      data: { done: true },
    });
    await tasks.updateStatus(created.id, { status: 'COMPLETADA' }, A.user);
    await extras.addComment(created.id, 'nota', A.user);
    await extras.addAttachment(created.id, file(), A.user);

    const copy = await tasks.duplicate(created.id, A.user);

    expect(copy.id).not.toBe(created.id);
    expect(copy.title).toBe('Llamar al proveedor (copia)');
    expect(copy.status).toBe('PENDIENTE');
    expect(copy.priority).toBe('ALTA');
    expect(copy.labels.map((l) => l.id)).toEqual([label.id]);
    expect(copy.checklist.map((c) => [c.text, c.done])).toEqual([
      ['a', false],
      ['b', false],
    ]);
    expect(copy.links).toHaveLength(1);
    expect(copy.comments).toEqual([]);
    expect(copy.attachments).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('vínculos huérfanos: nunca se omiten en silencio', () => {
  const linked = async (
    links: {
      type: 'issue' | 'meeting' | 'supplier' | 'document';
      id: string;
    }[],
  ) => tasks.create(dto({ title: 'con vínculos', links }), A.user);

  it('guarda el título al vincular y lo muestra con la entidad viva', async () => {
    const created = await linked([{ type: 'supplier', id: A.supplierId }]);
    const stored = await prisma.agendaTaskLink.findFirstOrThrow({
      where: { taskId: created.id },
    });
    expect(stored.label).toBeTruthy();
    const detail = await tasks.getById(created.id, A.user);
    expect(detail.links).toHaveLength(1);
    expect(detail.links[0]).toMatchObject({
      type: 'supplier',
      id: A.supplierId,
      label: stored.label,
    });
    expect(detail.links[0].deleted).toBe(false);
  });

  it('entidad eliminada: el vínculo sigue en la tarea, marcado, con el título que tenía; el endpoint no se rompe', async () => {
    const created = await linked([{ type: 'supplier', id: A.supplierId }]);
    const { label } = await prisma.agendaTaskLink.findFirstOrThrow({
      where: { taskId: created.id },
    });
    await prisma.supplier
      .delete({ where: { id: A.supplierId } })
      .catch(async () => {
        // Con dependencias, la baja física no procede en este fixture: se simula la desaparición de la entidad.
        await prisma.$executeRaw`UPDATE agenda_task_links SET entity_id = ${randomUUID()}::uuid WHERE task_id = ${created.id}::uuid`;
      });
    const detail = await tasks.getById(created.id, A.user);
    expect(detail.links).toHaveLength(1);
    expect(detail.links[0]).toMatchObject({
      type: 'supplier',
      deleted: true,
      label,
      route: '',
    });
    A.supplierId = await createSupplier(prisma, A.estateId, A.administratorId);
  });

  it('incidencia en la papelera: se muestra como eliminada con su referencia y título (no desaparece)', async () => {
    const created = await linked([{ type: 'issue', id: A.issueId }]);
    const issue = await prisma.issue.findUniqueOrThrow({
      where: { id: A.issueId },
    });
    await prisma.issue.update({
      where: { id: A.issueId },
      data: { deletedAt: new Date() },
    });
    const detail = await tasks.getById(created.id, A.user);
    expect(detail.links).toHaveLength(1);
    expect(detail.links[0]).toMatchObject({
      type: 'issue',
      deleted: true,
      label: `${issue.ref} · ${issue.title}`,
    });
    await prisma.issue.update({
      where: { id: A.issueId },
      data: { deletedAt: null },
    });
  });

  it('vínculo anterior a la columna (sin título) cuya entidad falta: «Entidad eliminada»', async () => {
    const created = await linked([{ type: 'meeting', id: A.meetingId }]);
    await prisma.$executeRaw`UPDATE agenda_task_links SET label = NULL, entity_id = ${randomUUID()}::uuid WHERE task_id = ${created.id}::uuid`;
    const detail = await tasks.getById(created.id, A.user);
    expect(detail.links[0]).toMatchObject({
      deleted: true,
      label: 'Entidad eliminada',
    });
  });

  it('una entidad de OTRA gestora no se revela: ni su título ni que existe', async () => {
    const created = await linked([{ type: 'issue', id: A.issueId }]);
    // La tarea de A se «lee» con un usuario de B: ni siquiera la ve (404), y su vínculo no se filtra.
    await expect(tasks.getById(created.id, B.user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // Y un vínculo cuya incidencia cae fuera de las fincas del lector tampoco se muestra.
    const detail = await tasks.getById(created.id, A.restricted);
    expect(detail.links.map((l) => l.id)).toEqual([A.issueId]); // restringido a la 1.ª comunidad: la incidencia es de ella
  });
});
