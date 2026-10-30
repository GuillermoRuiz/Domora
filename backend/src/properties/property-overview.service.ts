import { documentVisibleWhere } from '../documents/document-access.service';
import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { issuesOfEstate } from '../issues/issue-estate';
import { ACTIVE_ISSUE_STATUSES } from '../issues/issue-status.constants';
import { effectiveConvocation } from '../meetings/effective-convocation';

/** Ventana de «lo nuevo» y de «lo reciente» en las fichas del propietario. */
export const OVERVIEW_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/** Recibos que el propietario todavía tiene que pagar (o volver a pagar). */
const PAYABLE_STATUSES = ['Pendiente', 'Parcial', 'Devuelto'] as const;

/** Horizonte y tamaño de «Próximos eventos». */
export const EVENTS_HORIZON_DAYS = 90;
export const EVENTS_LIMIT = 10;
/** La aplicación es de comunidades españolas: los días y las horas se dan en hora de Madrid. */
const TZ = 'Europe/Madrid';
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const TIME_FORMAT = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const madridDay = (d: Date) => DAY_FORMAT.format(d);
const madridTime = (d: Date) => TIME_FORMAT.format(d);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Identificador estable que no es el de la inspección: el propietario no debe poder usarlo en otras rutas. */
const opaqueId = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16);

export type PropertyEventKind = 'junta' | 'recibo' | 'reserva' | 'revision';

/**
 * Un evento de «Próximos eventos». De las revisiones de instalaciones (datos
 * de gestión) solo se expone qué es, sobre qué instalación y cuándo; nunca el
 * proveedor, el resultado ni los documentos (decisión D3).
 */
export interface PropertyEvent {
  id: string;
  kind: PropertyEventKind;
  title: string;
  subtitle: string | null;
  /** AAAA-MM-DD, en hora de Madrid. */
  date: string;
  /** HH:mm en hora de Madrid, o null si el evento es de día completo. */
  time: string | null;
}

export interface PropertyOverview {
  /** null en el agregado de todas las propiedades del propietario. */
  propertyId: string | null;
  estateId: string | null;
  /** El recibo por pagar que vence antes: lo que queda por cobrar, no el importe original. */
  nextReceipt: { id: string; propertyId: string; concept: string; amount: number; dueDate: Date | null; status: string } | null;
  requests: {
    /** Incidencias activas de la comunidad (no son de una vivienda: todos sus vecinos ven la misma cifra). */
    open: number;
    /** Incidencias abiertas en la comunidad en los últimos 30 días (cualquiera que sea su estado hoy). */
    newLast30Days: number;
    /** Incidencias abiertas en la comunidad en los 30 días anteriores a esos: la base del «vs. mes anterior». */
    newPrevious30Days: number;
  };
  /** La próxima junta convocada de la finca. */
  nextMeeting: { id: string; estateId: string; title: string; scheduledAt: Date } | null;
  documents: {
    /** Documentos publicados en los últimos 30 días que este propietario puede ver. */
    newLast30Days: number;
  };
}

/**
 * Las fichas de «Mi comunidad» (rol C) para UNA propiedad. Todo se calcula
 * para la propiedad elegida y respetando lo que ese propietario puede ver:
 * recibos, solo los de su propiedad; incidencias, las de la comunidad; documentos, los generales
 * de la finca más los dirigidos a ella; junta, la de la finca.
 */
@Injectable()
export class PropertyOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly propertyAccess: PropertyAccessService,
  ) {}

  async getOverview(propertyId: string, user: AuthenticatedUser, now: Date = new Date()): Promise<PropertyOverview> {
    const property = await this.loadAccessible(propertyId, user);
    const { estateId } = property;
    const cards = await this.computeOverview([propertyId], estateId ? [estateId] : [], user, now);
    return { propertyId, estateId, ...cards };
  }

  /**
   * «Todas mis propiedades»: las mismas fichas sobre todas las propiedades a las
   * que el propietario tiene acceso (las suyas como titular y las de sus
   * membresías vinculadas y no revocadas, la misma regla que PropertyAccessService).
   * Lo de una finca cuenta una vez aunque tenga varias propiedades en ella.
   */
  async getOverviewForUser(user: AuthenticatedUser, now: Date = new Date()): Promise<PropertyOverview> {
    const properties = await this.prisma.property.findMany({
      where: {
        deletedAt: null,
        OR: [{ primaryUserId: user.id }, { memberships: { some: { userId: user.id, status: 'linked', revokedAt: null } } }],
      },
      select: { id: true, estateId: true },
    });
    const estateIds = [...new Set(properties.flatMap((p) => (p.estateId ? [p.estateId] : [])))];
    const cards = await this.computeOverview(properties.map((p) => p.id), estateIds, user, now);
    return { propertyId: null, estateId: null, ...cards };
  }

  private async computeOverview(
    propertyIds: string[],
    estateIds: string[],
    user: AuthenticatedUser,
    now: Date,
  ): Promise<Omit<PropertyOverview, 'propertyId' | 'estateId'>> {
    const since = new Date(now.getTime() - OVERVIEW_WINDOW_DAYS * DAY_MS);
    const previousSince = new Date(since.getTime() - OVERVIEW_WINDOW_DAYS * DAY_MS);
    const inProperties = { in: propertyIds };

    const [receipt, open, newRequests, previousRequests, meetings, newDocuments] = await Promise.all([
      this.prisma.accountingReceipt.findFirst({
        where: { propertyId: inProperties, status: { in: [...PAYABLE_STATUSES] }, outstanding: { gt: 0 } },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { accrualDate: 'asc' }],
        select: { id: true, propertyId: true, concept: true, outstanding: true, dueDate: true, status: true },
      }),
      // Las incidencias son de la comunidad, no de la vivienda: se cuentan las de las fincas (una propiedad sin finca no tiene).
      estateIds.length > 0
        ? this.prisma.issue.count({ where: { ...issuesOfEstate(estateIds), deletedAt: null, status: { in: ACTIVE_ISSUE_STATUSES } } })
        : 0,
      estateIds.length > 0
        ? this.prisma.issue.count({ where: { ...issuesOfEstate(estateIds), deletedAt: null, createdAt: { gte: since } } })
        : 0,
      estateIds.length > 0
        ? this.prisma.issue.count({ where: { ...issuesOfEstate(estateIds), deletedAt: null, createdAt: { gte: previousSince, lt: since } } })
        : 0,
      // Una junta convocada tiene dos convocatorias; vale la primera que no haya pasado.
      // La fecha efectiva se calcula aquí: ordenar en base de datos por la primera
      // convocatoria elegiría mal si ya pasó y su segunda es más lejana que otra junta.
      estateIds.length > 0
        ? this.prisma.meeting.findMany({
            where: { estateId: { in: estateIds }, status: 'convocada', scheduledAt2: { gte: now } },
            select: { id: true, estateId: true, title: true, scheduledAt1: true, scheduledAt2: true },
          })
        : [],
      estateIds.length > 0
        ? this.prisma.document.count({
            where: {
              AND: [
                { estateId: { in: estateIds }, date: { gte: since }, OR: [{ targetPropertyId: null }, { targetPropertyId: inProperties }] },
                await documentVisibleWhere(this.prisma, user),
              ],
            },
          })
        : 0,
    ]);

    const nextMeeting =
      meetings
        .flatMap((m) => {
          const at = effectiveConvocation(m, now);
          return at ? [{ id: m.id, estateId: m.estateId, title: m.title, scheduledAt: at }] : [];
        })
        .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0] ?? null;

    return {
      nextReceipt: receipt
        ? {
            id: receipt.id,
            propertyId: receipt.propertyId,
            concept: receipt.concept,
            amount: Number(receipt.outstanding),
            dueDate: receipt.dueDate,
            status: receipt.status,
          }
        : null,
      requests: { open, newLast30Days: newRequests, newPrevious30Days: previousRequests },
      nextMeeting,
      documents: { newLast30Days: newDocuments },
    };
  }

  /**
   * Lo próximo que afecta a esta propiedad en los siguientes 90 días: juntas
   * de la finca, vencimientos de sus recibos, sus reservas de zonas comunes y
   * las revisiones de instalaciones de la finca. Más cercano primero, máximo 10.
   */
  async getEvents(propertyId: string, user: AuthenticatedUser, now: Date = new Date()): Promise<PropertyEvent[]> {
    const property = await this.loadAccessible(propertyId, user);
    const { estateId } = property;
    if (!estateId) return [];

    const today = madridDay(now);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const horizonDate = new Date(todayDate.getTime() + EVENTS_HORIZON_DAYS * DAY_MS);
    const inRange = { gte: todayDate, lte: horizonDate };

    const [meetings, receipts, bookings, inspections] = await Promise.all([
      this.prisma.meeting.findMany({
        where: { estateId, status: 'convocada', scheduledAt2: { gte: now } },
        select: { id: true, title: true, location: true, scheduledAt1: true, scheduledAt2: true },
      }),
      this.prisma.accountingReceipt.findMany({
        where: { propertyId, status: { in: [...PAYABLE_STATUSES] }, outstanding: { gt: 0 }, dueDate: inRange },
        select: { id: true, concept: true, dueDate: true },
      }),
      this.prisma.booking.findMany({
        // La zona debe ser de esta finca: un vínculo cruzado (dato corrupto) no debe colar reservas ajenas.
        where: { propertyId, status: 'confirmed', date: inRange, amenity: { estateId } },
        select: { id: true, date: true, startSlot: true, endSlot: true, amenity: { select: { name: true } } },
      }),
      this.prisma.regulatoryInspection.findMany({
        where: {
          estateId,
          status: { in: ['planificada', 'citada'] },
          OR: [{ appointmentDate: inRange }, { appointmentDate: null, nextDueDate: inRange }],
        },
        select: {
          id: true,
          appointmentDate: true,
          nextDueDate: true,
          inspectionType: { select: { name: true } },
          asset: { select: { name: true } },
        },
      }),
    ]);

    const events: PropertyEvent[] = [];
    for (const m of meetings) {
      const at = effectiveConvocation(m, now);
      if (!at) continue;
      const date = madridDay(at);
      if (date > isoDay(horizonDate)) continue; // mismo límite que el resto: por día de Madrid
      events.push({ id: `junta:${m.id}`, kind: 'junta', title: m.title, subtitle: m.location, date, time: madridTime(at) });
    }
    for (const r of receipts) {
      if (r.dueDate) events.push({ id: `recibo:${r.id}`, kind: 'recibo', title: 'Vencimiento de recibo', subtitle: r.concept, date: isoDay(r.dueDate), time: null });
    }
    for (const b of bookings) {
      events.push({ id: `reserva:${b.id}`, kind: 'reserva', title: `Reserva: ${b.amenity.name}`, subtitle: `${b.startSlot} - ${b.endSlot}`, date: isoDay(b.date), time: b.startSlot });
    }
    for (const i of inspections) {
      const due = i.appointmentDate ?? i.nextDueDate;
      if (due) events.push({ id: `revision:${opaqueId(i.id)}`, kind: 'revision', title: i.inspectionType.name, subtitle: i.asset.name, date: isoDay(due), time: null });
    }
    return events
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.id.localeCompare(b.id))
      .slice(0, EVENTS_LIMIT);
  }

  /** La propiedad, si existe y este usuario puede verla (por PROPIEDAD para el rol C). */
  private async loadAccessible(propertyId: string, user: AuthenticatedUser) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, deletedAt: null },
      select: { id: true, estateId: true, primaryUserId: true },
    });
    if (!property) throw new NotFoundException(`Propiedad ${propertyId} no encontrada.`);
    await this.propertyAccess.assertAccess(property, user);
    return property;
  }
}
