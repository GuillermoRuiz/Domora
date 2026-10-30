import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DespachoTarget {
  administratorId: string;
  estateId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

type EstateLookup = (prisma: PrismaService, id: string) => Promise<string | null | undefined>;

/** Named route params that identify a record of one estate, in precedence order. */
const BY_PARAM: [param: string, lookup: EstateLookup][] = [
  ['estateId', (p, id) => Promise.resolve(id)],
  ['propertyId', async (p, id) => (await p.property.findUnique({ where: { id }, select: { estateId: true } }))?.estateId],
  ['meetingId', async (p, id) => (await p.meeting.findUnique({ where: { id }, select: { estateId: true } }))?.estateId],
  ['issueId', async (p, id) => (await p.issue.findUnique({ where: { id }, select: { estateId: true } }))?.estateId],
  ['debtorId', async (p, id) => (await p.debtor.findUnique({ where: { id }, select: { estateId: true } }))?.estateId],
  ['agreementId', async (p, id) => (await p.paymentAgreement.findUnique({ where: { id }, select: { debtor: { select: { estateId: true } } } }))?.debtor.estateId],
  ['installmentId', async (p, id) => (await p.paymentAgreementInstallment.findUnique({ where: { id }, select: { agreement: { select: { debtor: { select: { estateId: true } } } } } }))?.agreement.debtor.estateId],
  ['lineId', async (p, id) => (await p.remesaLine.findUnique({ where: { id }, select: { property: { select: { estateId: true } } } }))?.property.estateId],
  ['actionId', async (p, id) => (await p.correctiveAction.findUnique({ where: { id }, select: { inspection: { select: { estateId: true } } } }))?.inspection.estateId],
];

/**
 * `:id` of a route, by the route's first path segment. Each entry was checked
 * against the record its controller's service loads for that id
 * (e.g. `remesas/:id` → RemesaHistoryItem, `reconciliations/:id` →
 * ReconciliationGroup, `receipts/:id` → AccountingReceipt).
 *
 * `Document` is deliberately absent: every Document reader must be reviewed
 * in documents/document-reads.guard.spec.ts, so `documents/:id` and
 * `assistant/documents/:id/index` stay unresolved (role A writes denied).
 */
const BY_SEGMENT: Record<string, EstateLookup> = {
  properties: async (p, id) => (await p.property.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  issues: async (p, id) => (await p.issue.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  meetings: async (p, id) => (await p.meeting.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  receipts: async (p, id) => (await p.accountingReceipt.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  amenities: async (p, id) => (await p.amenity.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  bookings: async (p, id) => (await p.booking.findUnique({ where: { id }, select: { amenity: { select: { estateId: true } } } }))?.amenity.estateId,
  communications: async (p, id) => (await p.communication.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  'external-owners': async (p, id) => (await p.externalOwner.findUnique({ where: { id }, select: { property: { select: { estateId: true } } } }))?.property.estateId,
  inspections: async (p, id) => (await p.regulatoryInspection.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  collections: async (p, id) => (await p.collection.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  journal: async (p, id) => (await p.journalEntry.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  payroll: async (p, id) => (await p.payrollRecord.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  remesas: async (p, id) => (await p.remesaHistoryItem.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  'reserve-fund-applications': async (p, id) => (await p.reserveFundApplication.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  'return-files': async (p, id) => (await p.returnFile.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  'supplier-payments': async (p, id) => (await p.supplierPayment.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  suspense: async (p, id) => (await p.suspenseItem.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  'tax-settlements': async (p, id) => (await p.taxSettlement.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
  reconciliations: async (p, id) => (await p.reconciliationGroup.findUnique({ where: { id }, select: { estateId: true } }))?.estateId,
};

/**
 * Resolves which despacho (and estate) a tenant request targets from its
 * route params, always through the stored record, never trusting a
 * client-sent despacho. `null` = cannot be resolved (unknown route shape,
 * malformed id, missing record or lookup failure); the support guard then
 * denies a role A write (odd/tasks/role-a-panel.md S5).
 */
@Injectable()
export class DespachoResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    template: string,
    params: Record<string, string | undefined>,
  ): Promise<DespachoTarget | null> {
    const lookup = this.pick(template, params);
    if (!lookup) return null;
    const [find, id] = lookup;
    if (!isUuid(id)) return null;
    try {
      const estateId = await find(this.prisma, id);
      if (!estateId) return null;
      const estate = await this.prisma.estate.findUnique({
        where: { id: estateId },
        select: { administratorId: true },
      });
      return estate?.administratorId
        ? { administratorId: estate.administratorId, estateId }
        : null;
    } catch {
      return null;
    }
  }

  private pick(
    template: string,
    params: Record<string, string | undefined>,
  ): [EstateLookup, string | undefined] | null {
    for (const [name, find] of BY_PARAM) {
      if (name in params) return [find, params[name]];
    }
    const bySegment = BY_SEGMENT[template.split('/')[0]];
    if (bySegment && 'id' in params) return [bySegment, params.id];
    return null;
  }
}
