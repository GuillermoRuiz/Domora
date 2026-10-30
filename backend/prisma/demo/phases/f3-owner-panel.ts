import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../../src/auth/auth.types';
import { AmenitiesService } from '../../../src/amenities/amenities.service';
import { StorageService } from '../../../src/files/storage.service';
import { issueEventData } from '../../../src/issue-workflow/issue-events.service';
import { MeetingsService } from '../../../src/meetings/meetings.service';
import { ResourcesService } from '../../../src/resources/resources.service';
import type { DemoCtx } from '../context';
import { makePdf } from '../lib/pdf';
import { fileInLibrary, type Filing } from './library-filing';

/**
 * F3 — lo que necesita el panel «Mi comunidad» del propietario: zonas comunes
 * con alguna reserva suya, documentos publicados (con fichero real que se
 * puede descargar), una junta ya celebrada y otra convocada próxima.
 *
 * Servicios REALES: `AmenitiesService.createAmenity/createBooking` (esta
 * última como el propio propietario), `ResourcesService.createDocument`
 * (con el PDF guardado en `StorageService`) y `MeetingsService.create` /
 * `updateStatus`. RAW: las incidencias del propietario demo
 * (estados, fechas y seguimiento pasados no los crea ningún servicio).
 */

/** Lo que el seed deja por finca; la fase aborta si no cuadra. */
export const OWNER_PANEL_FIGURES = {
  amenities: { val: 2, mad: 2, valb: 2 },
  /** Reservas del propietario demo (`propietario@`): solo tiene propiedades en Colón 24 y Cuba 18. */
  ownerBookings: { val: 1, mad: 0, valb: 1 },
  documents: { val: 5, mad: 5, valb: 5 },
  /** De ellos, los que ve cualquier propietario en la biblioteca (todos: el demo los abre). */
  ownerDocuments: { val: 5, mad: 5, valb: 5 },
  /** Documentos publicados en los últimos 30 días. */
  recentDocuments: { val: 3, mad: 3, valb: 3 },
  convokedMeetings: { val: 1, mad: 1, valb: 1 },
  celebratedMeetings: { val: 1, mad: 1, valb: 1 },
  /** Incidencias que abrió el propietario demo (todas en su primera finca). */
  ownerIssues: 8,
} as const;

type OwnerIssueSeed = {
  title: string;
  description: string;
  type: 'Averia' | 'Ruido' | 'Fuga' | 'Limpieza';
  location: string;
  status: 'Abierta' | 'EnReparacion' | 'PendienteInformacion' | 'Resuelta' | 'Retirada';
  daysAgo: number;
  /** Seguimiento después del alta: [días tras el alta, texto, nota interna, estado al que pasa]. */
  steps?: readonly [number, string, boolean, ('EnReparacion' | 'PendienteInformacion' | 'Resuelta' | 'Retirada')?][];
  rating?: number;
};

/** Lo que el propietario demo tiene en «Incidencias»: un caso de cada estado, siempre de la comunidad. */
const OWNER_ISSUES: readonly OwnerIssueSeed[] = [
  {
    title: 'Ascensor fuera de servicio', description: 'El ascensor del portal 1 no funciona desde esta mañana. Se queda bloqueado en la planta baja y no responde al botón de llamada.',
    type: 'Averia', location: 'Portal 1', status: 'Abierta', daysAgo: 1,
    steps: [[0.05, 'Aviso trasladado al servicio técnico del ascensor.', true]],
  },
  {
    title: 'Humedades en la fachada del patio', description: 'Aparecen manchas de humedad en la fachada que da al patio interior.',
    type: 'Fuga', location: 'Fachada y cubierta', status: 'EnReparacion', daysAgo: 8,
    steps: [[1, 'Hemos pedido a un técnico que revise la fachada del patio.', false, 'EnReparacion']],
  },
  {
    title: 'Puerta del garaje atascada', description: 'La puerta del garaje se queda atascada a mitad de recorrido y hay que esperar para entrar o salir.',
    type: 'Averia', location: 'Garaje', status: 'Resuelta', daysAgo: 30,
    steps: [[2, 'Un técnico ha reparado el motor de la puerta del garaje.', false, 'Resuelta']],
  },
  {
    title: 'Ruido en zonas comunes', description: 'Ruidos en el portal por las noches, sobre todo los fines de semana.',
    type: 'Ruido', location: 'Zonas comunes', status: 'Resuelta', daysAgo: 40,
    steps: [[3, 'Se ha recordado la norma de descanso a todos los vecinos.', false, 'Resuelta']],
  },
  {
    title: 'Fallo en la iluminación', description: 'La luz del rellano de la planta 3 parpadea y a veces no se enciende.',
    type: 'Averia', location: 'Portal 1', status: 'EnReparacion', daysAgo: 12,
    steps: [[1, 'Asignada al equipo de mantenimiento.', false, 'EnReparacion']],
  },
  {
    title: 'Cerradura del portal averiada', description: 'La llave del portal gira pero no abre bien la cerradura, y a veces hay que forzarla.',
    type: 'Averia', location: 'Portal 1', status: 'PendienteInformacion', daysAgo: 5,
    steps: [[1, '¿Te ocurre con todas las llaves o solo con una?', false, 'PendienteInformacion']],
  },
  {
    title: 'Suciedad acumulada en el portal', description: 'En invierno el portal acumula barro y suciedad a diario por la lluvia.',
    type: 'Limpieza', location: 'Zonas comunes', status: 'Resuelta', daysAgo: 55,
    steps: [[4, 'Se amplía la limpieza a tres días por semana de noviembre a marzo.', false, 'Resuelta']],
    rating: 5,
  },
  {
    title: 'Foco de la piscina apagado', description: 'El foco subacuático de la piscina no se enciende por la noche.',
    type: 'Averia', location: 'Piscina', status: 'Retirada', daysAgo: 20,
    steps: [[1, 'Retirada por quien la reportó: era un fallo puntual y ya funciona.', false, 'Retirada']],
  },
];

const SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

const AMENITIES = [
  { name: 'Pista de pádel', icon: '🎾', maxHours: 2, capacity: 4, slots: SLOTS },
  { name: 'Sala comunitaria', icon: '🛋️', maxHours: 4, capacity: 25, slots: SLOTS },
] as const;

/** Documentos por finca: `daysAgo` decide cuáles cuentan como «nuevos» (último mes). */
// Biblioteca: «Documentación legal» se abre a los propietarios como carpeta (sus documentos heredan);
// el resto se abre documento a documento («Visibilidad propia»). Todos los ve el propietario.
const DOCUMENTS: readonly { title: string; type: string; daysAgo: number; filing: Filing }[] = [
  { title: 'Estatutos de la comunidad', type: 'Estatutos', daysAgo: 420, filing: { folder: 'legal', visibility: null } },
  { title: 'Normas de convivencia', type: 'Otro', daysAgo: 300, filing: { folder: 'legal', visibility: null } },
  { title: 'Presupuesto 2027', type: 'Presupuesto', daysAgo: 9, filing: { folder: 'contabilidad', visibility: 'OWNERS' } },
  { title: 'Calendario de limpieza de otoño', type: 'Otro', daysAgo: 3, filing: { folder: 'contratos', visibility: 'OWNERS' } },
  { title: 'Póliza del seguro multirriesgo', type: 'Otro', daysAgo: 21, filing: { folder: 'seguros', visibility: 'OWNERS' } },
];

const AGENDA = [
  {
    id: 'a1',
    title: 'Aprobación de las cuentas del ejercicio',
    description: 'Examen y votación de las cuentas anuales.',
    hasVote: true,
    voteTemplate: { questions: [{ title: '¿Aprueba las cuentas del ejercicio?', type: 'single_choice' as const, options: ['A favor', 'En contra', 'Abstención'] }] },
  },
  { id: 'a2', title: 'Presupuesto del próximo ejercicio', description: 'Presentación del presupuesto ordinario.' },
  { id: 'a3', title: 'Ruegos y preguntas' },
];

export async function runF3OwnerPanel(ctx: DemoCtx): Promise<void> {
  const amenities = ctx.app.get(AmenitiesService, { strict: false });
  const resources = ctx.app.get(ResourcesService, { strict: false });
  const meetings = ctx.app.get(MeetingsService, { strict: false });
  // El almacenamiento se resuelve con el STORAGE_DIR REAL del proceso (el que el guard
  // valida y el reset vacía), no con la copia que ConfigModule captura al importar el
  // módulo: así los PDFs nunca caen fuera del directorio que el seed controla.
  const storage = new StorageService({ get: (key: string) => process.env[key] } as unknown as ConfigService);
  const gestora = ctx.actors.gestora;
  const { clock } = ctx;
  const named = ctx.named.propietario;
  if (!named) throw new Error('F3: falta la cuenta propietario@ (la crea F1).');
  const owner = { id: named.userId, role: 'C', estateIds: named.estateIds, administratorId: null } as unknown as AuthenticatedUser;
  const at = (days: number, hourUtc: number) => new Date(clock.d(days).getTime() + hourUtc * 3_600_000);
  const slotDay = (days: number) => clock.d(days).toISOString().slice(0, 10);

  for (const estate of ctx.estates) {
    // ── Zonas comunes y las reservas del propietario demo ───────────────
    const created = [];
    for (const spec of AMENITIES) {
      created.push(await amenities.createAmenity(estate.id, { ...spec, slots: [...spec.slots] } as never, gestora));
    }
    const ownerProperty = estate.propertyIds.find((id) => named.propertyIds.includes(id));
    if (ownerProperty) {
      const days = estate.key === 'val' ? 6 : 9;
      await amenities.createBooking(
        { amenityId: created[0]!.id, propertyId: ownerProperty, date: slotDay(days), startSlot: '18:00', endSlot: '19:00', guests: 2 } as never,
        owner,
      );
    }

    // ── Documentos con su PDF, archivados en la biblioteca ──────────────
    const filed = [];
    for (const doc of DOCUMENTS) {
      const date = clock.d(-doc.daysAgo);
      const pdf = await makePdf({ title: doc.title, subtitle: estate.name, lines: [`Documento de la comunidad: ${doc.title}.`, 'Datos ficticios del entorno de demostración.'], creationDate: date });
      const key = await storage.put(`documents/${estate.id}`, `${doc.title}.pdf`, pdf);
      const created = await resources.createDocument(
        estate.id,
        { title: doc.title, type: doc.type, date: date.toISOString().slice(0, 10), size: `${Math.max(1, Math.round(pdf.length / 1024))} KB`, s3Key: key } as never,
        gestora,
      );
      filed.push({ id: created.id, filing: doc.filing, sizeBytes: pdf.length });
    }
    await fileInLibrary(ctx, estate.id, filed, { legal: 'OWNERS' });

    // ── Juntas: una celebrada hace dos meses y una convocada próxima ─────
    const base = { type: 'ordinaria', convokedBy: 'presidente', signerRole: 'administrador', attendeeEmails: [], includeJitsi: false, agenda: AGENDA } as const;
    const past = await meetings.create(
      estate.id,
      { ...base, title: 'Junta ordinaria (ejercicio anterior)', scheduledAt1: at(-60, 17).toISOString(), scheduledAt2: at(-60, 17.5).toISOString(), location: 'Salón de la comunidad' } as never,
      gestora,
    );
    await meetings.updateStatus(past.id, { status: 'celebrada' } as never, gestora);
    await meetings.create(
      estate.id,
      { ...base, title: 'Junta ordinaria de propietarios', scheduledAt1: at(12, 17).toISOString(), scheduledAt2: at(12, 17.5).toISOString(), location: 'Salón de la comunidad' } as never,
      gestora,
    );
  }
  await seedOwnerIssues(ctx);
  await assertOwnerPanelFigures(ctx);
}

/** RAW: incidencias pasadas del propietario demo, con su seguimiento (ningún servicio fija fechas ni estados pasados). */
async function seedOwnerIssues(ctx: DemoCtx): Promise<void> {
  const { prisma, clock } = ctx;
  const named = ctx.named.propietario;
  if (!named) throw new Error('F3: falta la cuenta propietario@ (la crea F1).');
  const estate = ctx.estates.find((e) => e.propertyIds.some((id) => named.propertyIds.includes(id)));
  if (!estate) throw new Error('F3: el propietario demo no tiene propiedades en ninguna finca.');
  const gestora = ctx.actors.gestora;
  for (const [i, seed] of OWNER_ISSUES.entries()) {
    const created = new Date(clock.d(-seed.daysAgo).getTime() + 9 * 3_600_000);
    const later = (days: number) => new Date(created.getTime() + days * 86_400_000);
    let status: OwnerIssueSeed['status'] = 'Abierta';
    const steps = (seed.steps ?? []).flatMap(([after, text, internal, to]) => {
      const date = later(after);
      const from = status;
      if (to) status = to;
      return [
        issueEventData({
          kind: !internal && to === 'PendienteInformacion' ? 'info_requested' : 'note',
          actorKind: 'person',
          authorUserId: gestora.id,
          date,
          text,
          internal,
          ...(to === 'PendienteInformacion' ? { meta: { recipientUserIds: [named.userId] } } : {}),
        }),
        ...(to
          ? [issueEventData({ kind: 'status_changed', actorKind: 'person', authorUserId: gestora.id, date: new Date(date.getTime() + 1), text: `Estado actualizado a "${to}".`, fromStatus: from, toStatus: to })]
          : []),
      ];
    });
    const finishedAt = later(seed.steps?.at(-1)?.[0] ?? 1);
    // Retirada es terminal pero no una resolución: lleva `closedAt` y nunca `resolvedAt`.
    const resolvedAt = seed.status === 'Resuelta' ? finishedAt : null;
    const closedAt = seed.status === 'Retirada' ? finishedAt : null;
    const reportId = randomUUID();
    await prisma.issue.create({
      data: {
        ref: `#INC-${created.getUTCFullYear()}-OWN${String(i + 1).padStart(2, '0')}`,
        estateId: estate.id, type: seed.type, location: seed.location,
        title: seed.title, description: seed.description, status: seed.status, priority: 'Normal', source: 'Propietario', date: created,
        statusBeforeInfoRequest: seed.status === 'PendienteInformacion' ? 'Abierta' : null,
        resolvedAt, closedAt, rating: seed.rating ?? null,
        // Quien avisó queda en su aviso (`IssueReport`): la incidencia es de la comunidad.
        reports: {
          create: { id: reportId, channel: 'form', content: seed.description, reporterUserId: named.userId, receivedAt: created, createdByKind: 'person', createdByUserId: named.userId },
        },
        timeline: {
          create: [
            issueEventData({ kind: 'report_received', actorKind: 'person', authorUserId: named.userId, role: 'Propietario', date: created, text: seed.description, refType: 'issue_report', refId: reportId }),
            ...steps,
          ],
        },
      },
    });
  }
  await seedNeighbourIssue(ctx, estate.id);
}

/**
 * Una incidencia que reportó otro vecino de la misma comunidad y a la que el propietario demo se ha sumado con «Me afecta
 * también»: él no es reportante (no tiene aviso suyo en ella), solo lo marcó.
 */
async function seedNeighbourIssue(ctx: DemoCtx, estateId: string): Promise<void> {
  const { prisma, clock } = ctx;
  const owner = ctx.named.propietario;
  const neighbour = ctx.named.moroso;
  if (!owner || !neighbour || !neighbour.estateIds.includes(estateId)) return;
  const created = new Date(clock.d(-3).getTime() + 10 * 3_600_000);
  const description = 'La puerta del portal no cierra bien y cualquiera puede entrar.';
  const reportId = randomUUID();
  await prisma.issue.create({
    data: {
      ref: `#INC-${created.getUTCFullYear()}-OWN-N1`,
      estateId, type: 'Seguridad', location: 'Portal 1',
      title: 'La puerta del portal no cierra', description, status: 'Abierta', priority: 'Urgente', source: 'Propietario', date: created,
      reports: { create: { id: reportId, channel: 'form', content: description, reporterUserId: neighbour.userId, receivedAt: created, createdByKind: 'person', createdByUserId: neighbour.userId } },
      affected: { create: { userId: owner.userId } },
      timeline: { create: [issueEventData({ kind: 'report_received', actorKind: 'person', authorUserId: neighbour.userId, role: 'Propietario', date: created, text: description, refType: 'issue_report', refId: reportId })] },
    },
  });
}

/** Aborta el seed si lo sembrado no cuadra con `OWNER_PANEL_FIGURES`. */
async function assertOwnerPanelFigures(ctx: DemoCtx): Promise<void> {
  const { prisma, clock } = ctx;
  const named = ctx.named.propietario;
  const since = clock.d(-30);
  for (const estate of ctx.estates) {
    const where = { estateId: estate.id };
    const actual = {
      amenities: await prisma.amenity.count({ where }),
      ownerBookings: await prisma.booking.count({ where: { amenity: where, userId: named?.userId, status: 'confirmed' } }),
      documents: await prisma.document.count({ where }),
      ownerDocuments: await prisma.document.count({ where: { ...where, deletedAt: null, effectiveVisibility: 'OWNERS' } }),
      recentDocuments: await prisma.document.count({ where: { ...where, date: { gte: since } } }),
      convokedMeetings: await prisma.meeting.count({ where: { ...where, status: 'convocada' } }),
      celebratedMeetings: await prisma.meeting.count({ where: { ...where, status: 'celebrada' } }),
    };
    for (const key of Object.keys(actual) as (keyof typeof actual)[]) {
      const expected = OWNER_PANEL_FIGURES[key][estate.key];
      if (actual[key] !== expected) throw new Error(`F3: ${estate.name} · ${key}: esperado ${expected}, hay ${actual[key]}.`);
    }
  }
  const ownerIssues = await prisma.issue.count({ where: { reports: { some: { reporterUserId: named?.userId } } } });
  if (ownerIssues !== OWNER_PANEL_FIGURES.ownerIssues) throw new Error(`F3: incidencias del propietario demo: esperado ${OWNER_PANEL_FIGURES.ownerIssues}, hay ${ownerIssues}.`);
}
