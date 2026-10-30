import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminActivityType, AdminPayMethod, AdminSepaMandateStatus, Prisma, type AdminSepaMandate } from '../prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../sepa/crypto.service';
import type { UpdateOwnBillingDto } from './admin-billing.dto';
import { SepaCreditorConfig } from './sepa-creditor.config';
import {
  SEPA_MANDATE_TEXT_VERSION,
  generateMandateReference,
  isMandateReferenceFor,
  sepaMandateText,
} from './sepa-mandate';
import { isValidSpanishTaxId, normalizeSpanishTaxId } from './spanish-tax-id';

export interface OwnBillingData {
  businessName: string;
  cif: string;
  address: string;
  email: string;
  paymentMethod: AdminPayMethod;
  /** Never the full IBAN. */
  ibanMasked: string | null;
}

export interface SepaMandateView {
  id: string;
  reference: string;
  creditorId: string;
  debtorName: string;
  ibanMasked: string;
  signedAt: Date;
  status: AdminSepaMandateStatus;
  revokedAt: Date | null;
  revokedReason: string | null;
  textVersion: string;
  mandateText: string;
}

export interface OwnBilling {
  billing: OwnBillingData | null;
  /** The active mandate, if any. */
  mandate: SepaMandateView | null;
  sepa: {
    /** Whether domiciliación can be chosen (Domora's creditor identifier is configured). */
    available: boolean;
    creditorId: string | null;
    creditorName: string;
    /** A fresh reference for a new mandate and the exact order text the user accepts with it. */
    mandateReference: string | null;
    mandateText: string | null;
  };
}

const MSG = {
  noDespacho: 'Tu usuario no está asociado a ningún despacho.',
  invalidTaxId: 'El NIF/CIF no es válido: revisa la letra o el dígito de control.',
  sepaUnavailable: 'Domora todavía no ofrece el pago por domiciliación. Elige tarjeta o transferencia.',
  ibanRequired: 'Indica el IBAN de la cuenta en la que domiciliar los cobros.',
  mandateRequired: 'Para domiciliar los cobros tienes que aceptar la orden de domiciliación SEPA.',
  invalidReference: 'La referencia del mandato no es válida. Recarga la página y vuelve a intentarlo.',
} as const;

const REVOKE_REPLACED = 'Sustituido por un nuevo mandato';
const REVOKE_METHOD = 'Cambio de método de pago';

/**
 * Billing data of a despacho edited by the despacho itself (role B), and its
 * SEPA direct debit mandate (odd/tasks/role-a-panel.md S17).
 *
 * Only `admin_billing` and `admin_sepa_mandates` are written: invoices already
 * issued keep their own recipient snapshot (`AdminInvoice.recipient*`), so they
 * never change; corrections go through a rectificativa.
 *
 * `AdminBilling.iban` keeps the format role A's `PUT /admins/:id/billing` uses
 * today (plain, normalised); the mandate stores its own copy encrypted with
 * `CryptoService`, and the API only ever returns masked values.
 */
@Injectable()
export class AdminBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly creditor: SepaCreditorConfig,
  ) {}

  private despachoOf(user: AuthenticatedUser): string {
    if (!user.administratorId) throw new NotFoundException(MSG.noDespacho);
    return user.administratorId;
  }

  async getOwn(user: AuthenticatedUser): Promise<OwnBilling> {
    const administratorId = this.despachoOf(user);
    const admin = await this.prisma.administrator.findFirst({
      where: { id: administratorId, deletedAt: null },
      select: {
        billing: true,
        sepaMandates: { where: { status: AdminSepaMandateStatus.active }, take: 1 },
      },
    });
    if (!admin) throw new NotFoundException(MSG.noDespacho);
    return this.view(administratorId, admin.billing, admin.sepaMandates[0] ?? null);
  }

  async updateOwn(user: AuthenticatedUser, dto: UpdateOwnBillingDto): Promise<OwnBilling> {
    const administratorId = this.despachoOf(user);
    if (!isValidSpanishTaxId(dto.cif)) throw new BadRequestException(MSG.invalidTaxId);
    const cif = normalizeSpanishTaxId(dto.cif);
    const domiciliacion = dto.paymentMethod === AdminPayMethod.Domiciliacion;
    if (domiciliacion && !this.creditor.creditorId) throw new ConflictException(MSG.sepaUnavailable);

    const admin = await this.prisma.administrator.findFirst({
      where: { id: administratorId, deletedAt: null },
      select: { billing: true, sepaMandates: { where: { status: AdminSepaMandateStatus.active }, take: 1 } },
    });
    if (!admin) throw new NotFoundException(MSG.noDespacho);
    const current = admin.billing;
    const activeMandate = admin.sepaMandates[0] ?? null;

    // Domiciliación: keep the active mandate when the IBAN does not change;
    // a first mandate or a new IBAN needs the order accepted again.
    let iban: string | null = null;
    let newMandate: { reference: string; debtorName: string; iban: string } | null = null;
    if (domiciliacion) {
      const keepsMandate = !!activeMandate && !!current?.iban && (!dto.iban || dto.iban === current.iban);
      if (keepsMandate) {
        iban = current.iban;
      } else {
        if (!dto.iban) throw new BadRequestException(MSG.ibanRequired);
        if (!dto.mandate?.accepted) throw new BadRequestException(MSG.mandateRequired);
        if (!isMandateReferenceFor(administratorId, dto.mandate.reference)) throw new BadRequestException(MSG.invalidReference);
        iban = dto.iban;
        newMandate = { reference: dto.mandate.reference, debtorName: dto.mandate.debtorName, iban: dto.iban };
      }
    }

    const data = {
      businessName: dto.businessName,
      cif,
      address: dto.address,
      email: dto.email,
      paymentMethod: dto.paymentMethod,
      iban,
    };
    const billingChanged =
      !current ||
      current.businessName !== data.businessName ||
      current.cif !== data.cif ||
      current.address !== data.address ||
      current.email !== data.email ||
      current.paymentMethod !== data.paymentMethod ||
      (current.iban ?? null) !== data.iban;
    const revoke = activeMandate && (newMandate || !domiciliacion) ? activeMandate : null;

    try {
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const log = (title: string) =>
          tx.adminActivityItem.create({
            data: { administratorId, type: AdminActivityType.billing_change, title, authorUserId: user.id },
          });
        if (billingChanged) {
          await tx.adminBilling.upsert({ where: { administratorId }, update: data, create: { administratorId, ...data } });
          await log('Datos de facturación actualizados por el despacho');
        }
        if (revoke) {
          await tx.adminSepaMandate.update({
            where: { id: revoke.id },
            data: { status: AdminSepaMandateStatus.revoked, revokedAt: now, revokedReason: newMandate ? REVOKE_REPLACED : REVOKE_METHOD },
          });
          await log(`Mandato SEPA ${revoke.reference} revocado`);
        }
        if (newMandate) {
          await tx.adminSepaMandate.create({
            data: {
              administratorId,
              reference: newMandate.reference,
              creditorId: this.creditor.creditorId!,
              debtorName: newMandate.debtorName,
              debtorIban: this.crypto.encrypt(newMandate.iban),
              debtorIbanMasked: this.crypto.maskIban(newMandate.iban),
              signedAt: now,
              acceptedByUserId: user.id,
              mandateText: this.mandateText(newMandate.reference),
              textVersion: SEPA_MANDATE_TEXT_VERSION,
            },
          });
          await log(`Mandato SEPA ${newMandate.reference} firmado por el despacho`);
        }
      });
    } catch (error) {
      // A reused reference (unique) or a concurrent second active mandate (partial unique index).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(MSG.invalidReference);
      }
      throw error;
    }
    return this.getOwn(user);
  }

  /** Role A: every mandate of a despacho, newest first, masked. */
  async mandatesOf(administratorId: string): Promise<SepaMandateView[]> {
    const rows = await this.prisma.adminSepaMandate.findMany({
      where: { administratorId },
      orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((m) => this.mandateView(m));
  }

  private mandateText(reference: string): string {
    return sepaMandateText({
      reference,
      creditorId: this.creditor.creditorId ?? '',
      creditorName: this.creditor.creditorName,
      creditorAddress: this.creditor.creditorAddress,
    });
  }

  private mandateView(m: AdminSepaMandate): SepaMandateView {
    return {
      id: m.id,
      reference: m.reference,
      creditorId: m.creditorId,
      debtorName: m.debtorName,
      ibanMasked: m.debtorIbanMasked,
      signedAt: m.signedAt,
      status: m.status,
      revokedAt: m.revokedAt,
      revokedReason: m.revokedReason,
      textVersion: m.textVersion,
      mandateText: m.mandateText,
    };
  }

  private view(
    administratorId: string,
    billing: { businessName: string; cif: string; address: string; email: string; paymentMethod: AdminPayMethod; iban: string | null } | null,
    mandate: AdminSepaMandate | null,
  ): OwnBilling {
    const available = !!this.creditor.creditorId;
    const reference = available ? generateMandateReference(administratorId, new Date()) : null;
    return {
      billing: billing
        ? {
            businessName: billing.businessName,
            cif: billing.cif,
            address: billing.address,
            email: billing.email,
            paymentMethod: billing.paymentMethod,
            ibanMasked: billing.iban ? this.crypto.maskIban(billing.iban) : null,
          }
        : null,
      mandate: mandate ? this.mandateView(mandate) : null,
      sepa: {
        available,
        creditorId: this.creditor.creditorId,
        creditorName: this.creditor.creditorName,
        mandateReference: reference,
        mandateText: reference ? this.mandateText(reference) : null,
      },
    };
  }
}
