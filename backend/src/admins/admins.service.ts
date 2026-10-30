import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Administrator, type PlanTier } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  CreateAdministratorDto,
  SwitchToManualBillingDto,
  UpdateAdministratorDto,
  UpdateOwnAdministratorDto,
  UpsertAdminBillingDto,
} from './dto/admins.dto';
import { PLAN_PRICE, PLAN_TIERS, netMrr } from './plans.catalog';
import { VerifactuService } from '../verifactu/verifactu.service';
import { InvoicePdfService } from '../invoicing/invoice-pdf.service';
import { detachedSubscriptionRef, isActiveStripeSubscription, isDetachableStripeSubscription } from '../common/subscription-status';
import { isUniqueViolationOn } from '../prisma/prisma-errors';
import { ClientStatusService } from '../client-status/client-status.service';

/**
 * Extra steps of a despacho creation made from somewhere else (the lead
 * conversion, odd/tasks/role-a-panel.md S13): a note appended to the signup
 * entry of its activity and work done in the same transaction.
 */
export interface CreateAdministratorOptions {
  signupNote?: string;
  afterCreate?: (tx: Prisma.TransactionClient, admin: Administrator) => Promise<void>;
}

/** Serie de facturación de Domora a las gestoras. */
const INVOICE_SERIES = 'DOM';
/** IVA general vigente. */
const INVOICE_TAX_RATE = 21;

@Injectable()
export class AdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verifactu: VerifactuService,
    private readonly pdf: InvoicePdfService,
    private readonly clientStatus: ClientStatusService,
  ) {}

  /**
   * `usersActive` NUNCA se persiste (Apéndice H): usuarios distintos con
   * membresía `linked` en propiedades de la gestora. `pending` y
   * `revoked` no computan para la cuota del plan.
   */
  private async countActiveUsers(administratorId: string): Promise<number> {
    const memberships = await this.prisma.propertyMembership.findMany({
      where: {
        status: 'linked',
        revokedAt: null,
        property: { administratorId },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    return memberships.length;
  }

  getPlansCatalog() {
    return { prices: PLAN_PRICE, tiers: PLAN_TIERS };
  }

  async list() {
    const admins = await this.prisma.administrator.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
    // Client vs payment status (S6), derived on read in one batch for the whole list.
    const statuses = await this.clientStatus.forAdministrators(admins.map((a) => a.id));
    return Promise.all(
      admins.map(async (a) => ({
        ...a,
        usersActive: await this.countActiveUsers(a.id),
        ...statuses.get(a.id),
      })),
    );
  }

  private static readonly OWN_ADMINISTRATOR_SELECT = {
    id: true,
    name: true,
    cif: true,
    vatNumber: true,
    phone: true,
    contactName: true,
    contactEmail: true,
    billing: { select: { address: true } },
  } as const;

  /**
   * La propia empresa de la gestora (rol B), sin nada de lo que solo ve
   * Domora (facturas, actividad, MRR, descuentos): solo los datos que
   * aparecen en comunicaciones y documentos.
   */
  async findOwn(user: AuthenticatedUser) {
    if (!user.administratorId) throw new NotFoundException('Tu cuenta no pertenece a ninguna gestora.');
    const admin = await this.prisma.administrator.findFirst({
      where: { id: user.administratorId, deletedAt: null },
      select: AdminsService.OWN_ADMINISTRATOR_SELECT,
    });
    if (!admin) throw new NotFoundException('Gestora no encontrada.');
    return { ...admin, fiscalAddress: admin.billing?.address ?? null, billing: undefined };
  }

  async updateOwn(dto: UpdateOwnAdministratorDto, user: AuthenticatedUser) {
    await this.findOwn(user);
    const admin = await this.prisma.administrator.update({
      where: { id: user.administratorId! },
      data: dto,
      select: AdminsService.OWN_ADMINISTRATOR_SELECT,
    });
    return { ...admin, fiscalAddress: admin.billing?.address ?? null, billing: undefined };
  }

  async findById(id: string) {
    const admin = await this.prisma.administrator.findFirst({
      where: { id, deletedAt: null },
      include: {
        billing: true,
        invoices: { orderBy: { issueDate: 'desc' } },
        activity: {
          orderBy: { occurredAt: 'desc' },
          include: { authorUser: { select: { fullName: true } } },
        },
        estates: {
          where: { deletedAt: null },
          include: { _count: { select: { properties: true } } },
        },
        subscription: { select: { stripeSubscriptionId: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } },
      },
    });
    if (!admin) {
      throw new NotFoundException(`Gestora ${id} no encontrada.`);
    }
    const { estates, activity, subscription, ...rest } = admin;
    return {
      ...rest,
      // The linked Stripe subscription (never the customer id), only present
      // while one is linked: absent means billed manually.
      // `manualBillingAvailable` drives «Pasar a facturación manual» (T14).
      ...(subscription?.stripeSubscriptionId && {
        stripeSubscription: {
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          manualBillingAvailable: isDetachableStripeSubscription(subscription),
        },
      }),
      usersActive: await this.countActiveUsers(id),
      // Proyección AdminFinca — derivada de estates, nunca tabla propia.
      fincas: estates.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        location: e.location,
        units: e._count.properties,
        since: e.createdAt,
        active: e.deletedAt === null,
      })),
      activity: activity.map((a) => ({
        id: a.id,
        type: a.type,
        title: a.title,
        date: a.occurredAt,
        author: a.authorUser?.fullName ?? 'Sistema',
      })),
      ...(await this.clientStatus.forAdministrator(id)),
    };
  }

  /** Alta de gestora — defaults del primer tramo del plan (dashboard-a). */
  async create(dto: CreateAdministratorDto, user: AuthenticatedUser, options: CreateAdministratorOptions = {}) {
    const firstTier = PLAN_TIERS[dto.plan][0];
    try {
      return await this.prisma.$transaction(async (tx) => {
        const admin = await tx.administrator.create({
          data: {
            name: dto.name,
            cif: dto.cif,
            plan: dto.plan,
            tier: `<${firstTier.max}`,
            usersMax: firstTier.max,
            status: 'Activa',
            mrr: new Prisma.Decimal(PLAN_PRICE[dto.plan]),
            contactName: dto.contactName,
            contactEmail: dto.contactEmail,
            phone: dto.phone,
          },
        });
        await tx.adminBilling.create({
          data: {
            administratorId: admin.id,
            businessName: dto.name,
            cif: dto.cif,
            address: '',
            email: dto.contactEmail ?? '',
            paymentMethod: 'Transferencia',
          },
        });
        await tx.adminActivityItem.create({
          data: {
            administratorId: admin.id,
            type: 'signup',
            title: `Alta de gestora (plan ${dto.plan})${options.signupNote ? ` · ${options.signupNote}` : ''}`,
            authorUserId: user.id,
          },
        });
        await options.afterCreate?.(tx, admin);
        return admin;
      });
    } catch (error) {
      // El CIF es un identificador fiscal real y único por empresa — a
      // diferencia de otros campos, acá SÍ tiene sentido de negocio
      // rechazar un duplicado con un mensaje claro en vez de dejar
      // escapar el error crudo de Prisma.
      if (
        isUniqueViolationOn(error, 'cif')
      ) {
        throw new ConflictException(
          `Ya existe una gestora registrada con el CIF ${dto.cif}.`,
        );
      }
      throw error;
    }
  }

  /**
   * Con Stripe activo, `plan`/`usersMax` los sincroniza el webhook
   * (`BillingService.onSubscriptionUpdated`) desde lo que Stripe confirma
   * de verdad. Permitir aquí un cambio manual paralelo dejaría a Domora
   * mostrando un plan/cupo que Stripe desconoce por completo — y el
   * próximo evento del webhook lo pisaría en silencio de todas formas. Es
   * una lectura directa (no una llamada a BillingService) para no crear
   * una dependencia circular entre AdminsModule y BillingModule, que ya
   * depende de AdminsService para las facturas fiscales.
   *
   * También bloquea `discountPct`: Stripe cobra siempre el Price fijo del
   * plan (no hay ningún cupón o descuento conectado a Stripe en todo el
   * código), así que un descuento aplicado aquí solo movería el MRR que
   * se muestra en el dashboard — el importe real cobrado y el de la
   * factura fiscal (`invoice.subtotal`, sin tocar) seguirían siendo el
   * precio completo. Mejor bloquearlo con un mensaje claro que dejar un
   * "descuento aplicado" que en realidad no descuenta nada.
   */
  private async assertNoActiveStripeSubscription(administratorId: string): Promise<void> {
    const sub = await this.prisma.administratorSubscription.findUnique({
      where: { administratorId },
    });
    if (isActiveStripeSubscription(sub)) {
      throw new ConflictException(
        `La gestora ${administratorId} tiene una suscripción activa en Stripe: el plan, el cupo de usuarios y los descuentos los gestiona el propio cliente (o el portal de Stripe), no esta pantalla. Cancela la suscripción en Stripe antes de forzar un cambio manual.`,
      );
    }
  }

  /**
   * Mutaciones de soporte (rol A). El MRR siempre se recalcula en
   * servidor desde el catálogo — nunca se acepta del cliente. Cada cambio
   * relevante deja su entrada de actividad.
   */
  async update(
    id: string,
    dto: UpdateAdministratorDto,
    user: AuthenticatedUser,
  ) {
    const admin = await this.prisma.administrator.findFirst({
      where: { id, deletedAt: null },
    });
    if (!admin) {
      throw new NotFoundException(`Gestora ${id} no encontrada.`);
    }

    if (dto.plan !== undefined || dto.usersMax !== undefined || dto.discountPct !== undefined || dto.billingInterval !== undefined) {
      await this.assertNoActiveStripeSubscription(id);
    }

    const plan = dto.plan ?? admin.plan;
    const discountPct = dto.discountPct ?? Number(admin.discountPct);
    const data: Prisma.AdministratorUpdateInput = {};
    const activities: {
      type: 'plan_change' | 'discount' | 'block';
      title: string;
    }[] = [];

    if (dto.plan && dto.plan !== admin.plan) {
      const firstTier = PLAN_TIERS[dto.plan][0];
      data.plan = dto.plan;
      data.tier = `<${firstTier.max}`;
      data.usersMax = firstTier.max;
      data.mrr = new Prisma.Decimal(netMrr(PLAN_PRICE[dto.plan], discountPct));
      activities.push({
        type: 'plan_change',
        title: `Cambio de plan ${admin.plan} → ${dto.plan}`,
      });
    }

    if (dto.usersMax !== undefined) {
      const tier = PLAN_TIERS[plan].find((t) => t.max === dto.usersMax);
      if (!tier) {
        throw new BadRequestException(
          `El tramo de ${dto.usersMax} usuarios no existe en el plan ${plan}.`,
        );
      }
      data.usersMax = tier.max;
      data.tier = `<${tier.max}`;
      data.mrr = new Prisma.Decimal(netMrr(tier.price, discountPct));
    }

    if (dto.discountPct !== undefined) {
      data.discountPct = new Prisma.Decimal(dto.discountPct);
      data.discountReason = dto.discountReason ?? null;
      data.discountUntil = dto.discountUntil
        ? new Date(dto.discountUntil)
        : null;
      const baseTier = PLAN_TIERS[plan].find(
        (t) => t.max === (dto.usersMax ?? admin.usersMax),
      );
      const basePrice = baseTier?.price ?? PLAN_PRICE[plan];
      data.mrr = new Prisma.Decimal(netMrr(basePrice, dto.discountPct));
      activities.push({
        type: 'discount',
        title: `Descuento del ${dto.discountPct}%${dto.discountReason ? ` (${dto.discountReason})` : ''}`,
      });
    }

    if (dto.status && dto.status !== admin.status) {
      data.status = dto.status;
      if (dto.status === 'Bloqueada') {
        data.blockReason = dto.blockReason ?? null;
        activities.push({
          type: 'block',
          title: `Cuenta bloqueada${dto.blockReason ? `: ${dto.blockReason}` : ''}`,
        });
      } else if (admin.status === 'Bloqueada') {
        data.blockReason = null;
        activities.push({ type: 'block', title: 'Cuenta desbloqueada' });
      }
    }

    if (dto.endDate !== undefined) {
      data.endDate = new Date(dto.endDate);
    }
    if (dto.billingInterval !== undefined) {
      data.billingInterval = dto.billingInterval;
    }
    if (dto.notes !== undefined) {
      data.notes = dto.notes;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.administrator.update({ where: { id }, data });
      for (const activity of activities) {
        await tx.adminActivityItem.create({
          data: {
            administratorId: id,
            type: activity.type,
            title: activity.title,
            authorUserId: user.id,
          },
        });
      }
      return updated;
    });
  }

  /**
   * «Pasar a facturación manual» (odd/tasks/role-a-panel.md T14, S6, S9): a
   * despacho whose Stripe subscription is dead for good (`canceled`,
   * `incomplete_expired`) is going to be billed by hand. Every reader —
   * client status, MRR (`mrr.ts`), completitud, `isActiveStripeSubscription`
   * — treats a row without `stripeSubscriptionId` as a manually billed
   * client, so the dead link is cleared instead of special-casing the rules:
   *
   * - The row is kept with its `stripeCustomerId` (Stripe history, portal,
   *   and a later checkout reuses the same customer). Only the subscription
   *   fields are cleared; the Stripe side is untouched (nothing to cancel).
   * - The write is conditional on the state that was checked, so a webhook
   *   landing in between makes it match nothing → 409 instead of detaching
   *   a subscription that just came back.
   * - The activity entry carries `detachedSubscriptionRef`, the tombstone
   *   `BillingService` checks so a late Stripe event for the old
   *   subscription never links it again.
   * - `mrr` is recomputed from the catalogue like any manual plan change
   *   (the stored value was Stripe's amount); `activate` and
   *   `billingInterval` are applied in the same transaction (see the DTO).
   */
  async switchToManualBilling(id: string, dto: SwitchToManualBillingDto, user: AuthenticatedUser) {
    const admin = await this.prisma.administrator.findFirst({ where: { id, deletedAt: null } });
    if (!admin) throw new NotFoundException(`Gestora ${id} no encontrada.`);
    const sub = await this.prisma.administratorSubscription.findUnique({ where: { administratorId: id } });
    if (!sub?.stripeSubscriptionId) {
      throw new ConflictException('Este despacho no tiene ninguna suscripción de Stripe que desvincular: ya se factura manualmente.');
    }
    if (!isDetachableStripeSubscription(sub)) {
      throw new ConflictException(
        'La suscripción de Stripe de este despacho sigue viva: solo se puede pasar a facturación manual cuando está cancelada o caducada. Cancélala primero en Stripe.',
      );
    }
    if (dto.activate && admin.status === 'Bloqueada') {
      throw new ConflictException('La cuenta está bloqueada: desbloquéala antes de reactivarla.');
    }

    const tier = PLAN_TIERS[admin.plan].find((t) => t.max === admin.usersMax);
    const data: Prisma.AdministratorUpdateInput = {
      mrr: new Prisma.Decimal(netMrr(tier?.price ?? PLAN_PRICE[admin.plan], Number(admin.discountPct))),
    };
    const notes: string[] = [];
    if (dto.activate && admin.status === 'Vencida') {
      data.status = 'Activa';
      notes.push('cuenta reactivada');
    }
    if (dto.billingInterval) {
      data.billingInterval = dto.billingInterval;
      notes.push(dto.billingInterval === 'year' ? 'facturación anual' : 'facturación mensual');
    }
    const label = sub.status === 'canceled' ? 'cancelada' : 'caducada';
    const title = [`Pasada a facturación manual: se desvincula la suscripción de Stripe ${sub.stripeSubscriptionId} (${label})`, ...notes].join(' · ');

    await this.prisma.$transaction(async (tx) => {
      const detached = await tx.administratorSubscription.updateMany({
        where: { administratorId: id, stripeSubscriptionId: sub.stripeSubscriptionId, status: sub.status },
        data: { stripeSubscriptionId: null, stripePriceId: null, status: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, pastDueSince: null },
      });
      if (detached.count === 0) {
        throw new ConflictException('La suscripción de Stripe acaba de cambiar. Recarga la ficha y vuelve a intentarlo.');
      }
      await tx.administrator.update({ where: { id }, data });
      await tx.adminActivityItem.create({
        data: {
          administratorId: id,
          type: 'plan_change',
          title,
          authorUserId: user.id,
          externalRef: detachedSubscriptionRef(sub.stripeSubscriptionId),
        },
      });
    });
    return this.findById(id);
  }

  async upsertBilling(id: string, dto: UpsertAdminBillingDto) {
    const admin = await this.prisma.administrator.findFirst({
      where: { id, deletedAt: null },
    });
    if (!admin) {
      throw new NotFoundException(`Gestora ${id} no encontrada.`);
    }
    return this.prisma.adminBilling.upsert({
      where: { administratorId: id },
      update: { ...dto },
      create: { administratorId: id, ...dto },
    });
  }

  /**
   * Emite la factura del ciclo a una gestora (RD 1619/2012): numeración
   * correlativa por año (DOM-YYYY-NNNN, sin huecos — se calcula dentro de
   * la transacción), base = MRR vigente, IVA 21%.
   */
  /**
   * Reserva el siguiente número de la serie DENTRO de la transacción.
   *
   * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` es atómico: dos
   * emisiones simultáneas no pueden obtener el mismo número porque la
   * segunda espera al bloqueo de fila de la primera. Y al vivir en la
   * transacción, si la emisión falla el número se libera en lugar de dejar
   * un hueco en la numeración.
   */
  private async nextInvoiceNumber(
    tx: Prisma.TransactionClient,
    series: string,
    year: number,
  ): Promise<number> {
    const rows = await tx.$queryRaw<{ last_number: number }[]>`
      INSERT INTO invoice_series (series, year, last_number)
      VALUES (${series}, ${year}, 1)
      ON CONFLICT (series, year)
      DO UPDATE SET last_number = invoice_series.last_number + 1
      RETURNING last_number
    `;
    return rows[0].last_number;
  }

  /**
   * Núcleo común de emisión de una factura fiscal: numeración correlativa
   * + desglose IVA + cadena Verifactu + entrada de actividad, todo en la
   * MISMA transacción que le pasa el llamante (una factura sin registro de
   * facturación sería un incumplimiento; un registro sin factura rompería
   * la trazabilidad — o se guardan las dos cosas, o ninguna).
   *
   * Compartido entre la emisión manual (`issueInvoice`, rol A pulsa el
   * botón) y la automática que dispara el webhook de Stripe al finalizar
   * el ciclo de facturación (`BillingService`, evento `invoice.finalized`)
   * — nunca deben existir dos secuencias de numeración/Verifactu
   * independientes para las facturas de una misma gestora. `user: null`
   * cuando el disparo es del webhook (sin actor humano); `authorUserId`
   * queda `null` en ese caso, que ya es un valor válido (ver
   * `AdminActivityItem.authorUserId`, se muestra como "Sistema").
   */
  private async createFiscalInvoice(
    tx: Prisma.TransactionClient,
    admin: { id: string; plan: PlanTier },
    billing: { businessName: string; cif: string; address: string },
    taxBase: Prisma.Decimal,
    concept: string,
    user: AuthenticatedUser | null,
    stripeInvoiceId?: string,
    // Cuándo se considera emitida a efectos fiscales — `new Date()` (el
    // instante en que ESTE proceso la procesa) es correcto para la emisión
    // manual (issueInvoice: el clic ES el momento de emitir), pero NO para
    // la disparada por el webhook de Stripe: si el backend estuvo caído o
    // Stripe reintregó tarde, "cuándo se procesó" puede caer en un año
    // fiscal distinto de "cuándo Stripe finalizó de verdad" el invoice —
    // ver createFiscalInvoiceFromStripe, que sí pasa la fecha real.
    issuedAt: Date = new Date(),
  ) {
    const now = issuedAt;
    const year = now.getFullYear();
    const taxRate = new Prisma.Decimal(INVOICE_TAX_RATE);
    // Se redondea la CUOTA y después se suma, que es el criterio fiscal
    // correcto; redondear el total (base * 1.21) puede desviarse un
    // céntimo respecto de la cuota declarada.
    const taxAmount = taxBase.times(taxRate).dividedBy(100).toDecimalPlaces(2);
    const total = taxBase.plus(taxAmount);

    const sequence = await this.nextInvoiceNumber(tx, INVOICE_SERIES, year);
    const invoiceNo = `${INVOICE_SERIES}-${year}-${String(sequence).padStart(4, '0')}`;

    const invoice = await tx.adminInvoice.create({
      data: {
        administratorId: admin.id,
        invoiceNo,
        series: INVOICE_SERIES,
        fiscalYear: year,
        sequence,
        issueDate: now,
        operationDate: now,
        concept,
        taxBase,
        taxRate,
        taxAmount,
        total,
        recipientName: billing.businessName,
        recipientTaxId: billing.cif,
        recipientAddress: billing.address,
        status: 'Pendiente',
        stripeInvoiceId: stripeInvoiceId ?? null,
      },
    });

    await this.verifactu.appendAlta(tx, invoice);

    await tx.adminActivityItem.create({
      data: {
        administratorId: admin.id,
        type: 'invoice',
        title: `Factura ${invoice.invoiceNo} emitida (${total.toFixed(2)} € IVA incl.)`,
        authorUserId: user?.id ?? null,
      },
    });
    return invoice;
  }

  /**
   * Emite la factura del ciclo a una gestora (RD 1619/2012), disparada a
   * mano por rol A. Congela los datos fiscales del destinatario en el
   * momento de emitir: una factura es inmutable, así que no puede depender
   * de un AdminBilling que cambie después. Sin esos datos no se puede
   * emitir — antes se emitía igualmente y salía una factura sin
   * destinatario identificado.
   */
  async issueInvoice(id: string, user: AuthenticatedUser) {
    const admin = await this.prisma.administrator.findFirst({
      where: { id, deletedAt: null },
      include: { billing: true },
    });
    if (!admin) {
      throw new NotFoundException(`Gestora ${id} no encontrada.`);
    }
    // A una constante local: dentro del closure de la transacción,
    // TypeScript no conserva el estrechamiento de `admin.billing`.
    const billing = admin.billing;
    if (!billing) {
      throw new ConflictException(
        'La gestora no tiene datos de facturación (razón social, CIF y domicilio). Complétalos antes de emitir la factura.',
      );
    }

    const taxBase = new Prisma.Decimal(admin.mrr);
    return this.prisma.$transaction((tx) =>
      this.createFiscalInvoice(
        tx,
        admin,
        billing,
        taxBase,
        `Suscripción Domora — plan ${admin.plan}`,
        user,
      ),
    );
  }

  /**
   * Emisión automática al finalizar el ciclo de Stripe (`invoice.finalized`)
   * — mismo núcleo que `issueInvoice`, pero con el importe que ya calculó
   * Stripe (subtotal SIN impuestos: el checkout de Domora crea la sesión
   * con `automatic_tax` desactivado a propósito, para que el único cálculo
   * de IVA español sea este, no el de Stripe) y sin actor humano.
   * `BillingService` la invoca dentro de su propia transacción.
   *
   * `planLabel` es OBLIGATORIO y debe venir resuelto por el llamante desde
   * el propio evento de Stripe (el price de la línea de esa factura), NO
   * desde `admin.plan`: Stripe no garantiza el orden de entrega entre
   * `invoice.finalized` y `customer.subscription.updated` cuando coinciden
   * (p.ej. una factura de renovación justo tras un cambio de plan). Si
   * aquí se leyera `admin.plan` y ese evento aún no hubiera aterrizado, el
   * texto de la factura (plan viejo) y su importe (ya el nuevo, tomado
   * directo de Stripe) quedarían en desacuerdo — y una factura fiscal ya
   * emitida es inmutable, así que ese desacuerdo no se podría corregir sin
   * una rectificativa.
   */
  async createFiscalInvoiceFromStripe(
    tx: Prisma.TransactionClient,
    administratorId: string,
    taxBaseCents: number,
    stripeInvoiceId: string,
    planLabel: string,
    // Fecha real de finalización en Stripe (`invoice.status_transitions.
    // finalized_at`), resuelta por el llamante — no `new Date()` aquí: si
    // el webhook se procesa tarde (backend caído, reintento de Stripe), el
    // momento de procesar puede caer en un ejercicio fiscal distinto del
    // que corresponde de verdad.
    issuedAt: Date,
  ) {
    const admin = await tx.administrator.findFirst({
      where: { id: administratorId, deletedAt: null },
      include: { billing: true },
    });
    if (!admin) {
      throw new NotFoundException(`Gestora ${administratorId} no encontrada.`);
    }
    const billing = admin.billing;
    if (!billing) {
      throw new ConflictException(
        `La gestora ${administratorId} no tiene datos de facturación — no se puede reconciliar la factura de Stripe ${stripeInvoiceId}.`,
      );
    }
    const taxBase = new Prisma.Decimal(taxBaseCents).dividedBy(100);
    return this.createFiscalInvoice(
      tx,
      admin,
      billing,
      taxBase,
      `Suscripción Domora — plan ${planLabel}`,
      null,
      stripeInvoiceId,
      issuedAt,
    );
  }

  /** Facturas: rol A cualquier gestora; rol B solo la suya. */
  async listInvoices(id: string, user: AuthenticatedUser) {
    if (user.role !== 'A' && user.administratorId !== id) {
      throw new ForbiddenException(
        'Solo puedes ver las facturas de tu propia gestora.',
      );
    }
    return this.prisma.adminInvoice.findMany({
      where: { administratorId: id },
      orderBy: { issueDate: 'desc' },
    });
  }

  /**
   * Anula una factura: la operación se cancela y la factura queda sin
   * efecto.
   *
   * No la borra —su número está en una serie correlativa y su registro de
   * alta ya forma parte de la cadena— sino que emite un registro de
   * anulación encadenado. Para corregir datos de una operación que SÍ tuvo
   * lugar no sirve esto: eso es una factura rectificativa, que es una
   * factura nueva y está fuera de esta fase.
   */
  async voidInvoice(
    invoiceId: string,
    reason: string | undefined,
    user: AuthenticatedUser,
  ) {
    const invoice = await this.prisma.adminInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      throw new NotFoundException(`Factura ${invoiceId} no encontrada.`);
    }
    if (invoice.status === 'Anulada') {
      throw new ConflictException('Esta factura ya está anulada.');
    }
    if (invoice.status === 'Pagada') {
      throw new ConflictException(
        'Una factura cobrada no se anula: si la operación fue válida y hay que corregirla, corresponde una factura rectificativa.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.adminInvoice.update({
        where: { id: invoiceId },
        data: { status: 'Anulada' },
      });

      // Si el último Alta (o su subsanación) de esta factura fue RECHAZADO
      // por la AEAT, nunca llegó a registrarse en su sistema: una anulación
      // normal volvería con "No existe el registro de facturación" —
      // comprobado contra preproducción, código 3002—, así que hay que
      // declarar SinRegistroPrevio en su lugar.
      const alta = await tx.verifactuRecord.findFirst({
        where: { invoiceId, type: { in: ['alta', 'subsanacion'] } },
        orderBy: { chainSeq: 'desc' },
      });
      if (alta?.submissionState === 'rechazado') {
        await this.verifactu.appendAnulacionSinRegistroPrevio(tx, updated);
      } else {
        await this.verifactu.appendAnulacion(tx, updated);
      }

      await tx.adminActivityItem.create({
        data: {
          administratorId: invoice.administratorId,
          type: 'invoice',
          title: `Factura ${invoice.invoiceNo} anulada${reason ? ` (${reason})` : ''}`,
          authorUserId: user.id,
        },
      });
      return updated;
    });
  }

  /**
   * Factura en PDF. Mismo criterio de acceso que el listado: el rol A ve
   * cualquiera, el rol B solo las de su gestora.
   */
  async invoicePdf(
    invoiceId: string,
    user: AuthenticatedUser,
  ): Promise<{ fileName: string; content: Buffer }> {
    const invoice = await this.prisma.adminInvoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      throw new NotFoundException(`Factura ${invoiceId} no encontrada.`);
    }
    if (user.role !== 'A' && user.administratorId !== invoice.administratorId) {
      throw new ForbiddenException(
        'Solo puedes descargar las facturas de tu propia gestora.',
      );
    }
    return {
      fileName: `${invoice.invoiceNo}.pdf`,
      content: await this.pdf.render(invoice),
    };
  }

  /** Vista de suscripción del rol B (GET /subscriptions/me). */
  async mySubscription(user: AuthenticatedUser) {
    if (!user.administratorId) {
      throw new ForbiddenException('Usuario sin gestora asociada.');
    }
    const admin = await this.prisma.administrator.findFirst({
      where: { id: user.administratorId, deletedAt: null },
      include: { subscription: true },
    });
    if (!admin) {
      throw new NotFoundException('Gestora no encontrada.');
    }
    return {
      plan: admin.plan,
      tier: admin.tier,
      status: admin.status,
      blockReason: admin.blockReason,
      mrr: admin.mrr,
      discountPct: admin.discountPct,
      endDate: admin.endDate,
      usersMax: admin.usersMax,
      usersActive: await this.countActiveUsers(admin.id),
      // Estado real del cobro (Stripe) — distinto de `status` (AdminStatus).
      // `status` lo mueve soporte manualmente entre cualquiera de sus 4
      // valores, pero además BillingService lo alterna solo entre
      // Activa⇄Vencida según lo que confirme Stripe (impago/recuperación/
      // cancelación) — ver `deriveAdminStatusFromStripe`. `Periodo_de_gracia`
      // y `Bloqueada` siguen siendo exclusivamente manuales. `billing` es
      // `null` si la gestora todavía no
      // tiene ninguna suscripción de Stripe CONFIRMADA (p.ej. facturación
      // manual/transferencia, como hasta ahora). Se comprueba
      // `stripeSubscriptionId`, no solo que la fila exista: BillingService.
      // ensureCustomer crea la fila (con el customerId nada más) en cuanto
      // se abre un checkout, antes de que el usuario llegue a pagar — si
      // aquí se aceptara la fila sin más, un checkout abandonado a medias
      // dejaría a la gestora con "billing" no-nulo para siempre, ocultando
      // el botón real de "Configurar pago" en la UI sin que exista ninguna
      // suscripción de verdad.
      billing: admin.subscription?.stripeSubscriptionId
        ? {
            status: admin.subscription.status,
            currentPeriodEnd: admin.subscription.currentPeriodEnd,
            cancelAtPeriodEnd: admin.subscription.cancelAtPeriodEnd,
          }
        : null,
    };
  }
}
