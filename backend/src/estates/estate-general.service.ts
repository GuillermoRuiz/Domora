import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../sepa/crypto.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateGovernanceService } from './estate-governance.service';
import type { SetKeyContactDto } from './dto/estate-general.dto';
import { bankNameFromIban } from './spanish-banks';
import { EstateGeoService } from '../catastro/estate-geo.service';

/** Same strings as the frontend catalogue (core/essential-documents.ts): Document.type is free text. */
export const ESSENTIAL_DOCUMENT_TYPES = ['Escritura de constitución', 'Estatutos', 'CIF de la comunidad', 'IBI', 'Póliza de seguro'] as const;
/** Supplier category of insurers (frontend catalogue `supplier-categories.ts`). */
const INSURANCE_CATEGORY = 'seguros';

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Read model of the rol-B «Datos generales» tab, plus the key-contact flag set from the properties list. */
@Injectable()
export class EstateGeneralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly governance: EstateGovernanceService,
    private readonly crypto: CryptoService,
    private readonly geo: EstateGeoService,
  ) {}

  async setKeyContact(estateId: string, dto: SetKeyContactDto, user: AuthenticatedUser) {
    await this.governance.authorize(estateId, user);
    if (!!dto.userId === !!dto.externalOwnerId) throw new BadRequestException('Indica una única persona de la propiedad.');
    const property = await this.prisma.property.findFirst({ where: { id: dto.propertyId, estateId, deletedAt: null }, select: { id: true } });
    if (!property) throw new BadRequestException('Propiedad ajena a la comunidad.');

    // Same people the office-term candidates offer: linked owners and unpromoted imported owners.
    if (dto.userId) {
      const { count } = await this.prisma.propertyMembership.updateMany({
        where: { propertyId: property.id, userId: dto.userId, status: 'linked', roleType: 'Propietario', user: { deletedAt: null } },
        data: { isKeyContact: dto.keyContact },
      });
      if (count === 0) throw new BadRequestException('La persona no es titular de esta propiedad.');
    } else {
      const { count } = await this.prisma.externalOwner.updateMany({
        where: { id: dto.externalOwnerId, propertyId: property.id, promotedToUserId: null, OR: [{ roleType: 'Propietario' }, { roleType: null }] },
        data: { isKeyContact: dto.keyContact },
      });
      if (count === 0) throw new BadRequestException('La persona no es titular de esta propiedad.');
    }
    return { propertyId: property.id, userId: dto.userId ?? null, externalOwnerId: dto.externalOwnerId ?? null, keyContact: dto.keyContact };
  }

  /** Everything the read-only «Datos generales» tab shows that the estate row itself does not carry. */
  async overview(estateId: string, user: AuthenticatedUser) {
    await this.governance.authorize(estateId, user);
    const todayIso = new Date().toISOString().slice(0, 10);
    const today = new Date(`${todayIso}T00:00:00.000Z`);
    const year = today.getUTCFullYear();

    const estate = await this.prisma.estate.findUniqueOrThrow({
      where: { id: estateId },
      select: { iban: true, parcelAreaM2: true, geoResolvedAt: true, administrator: { select: { name: true, contactName: true, phone: true, contactEmail: true } } },
    });
    const [properties, fiscalYear, bankAccount, terms, memberships, externals, documents, contracts] = await Promise.all([
      this.prisma.property.findMany({ where: { estateId, deletedAt: null }, select: { id: true, ref: true, participationQuota: true, builtAreaM2: true } }),
      this.prisma.fiscalYear.findUnique({ where: { estateId_year: { estateId, year } }, select: { year: true, startDate: true, endDate: true, status: true } }),
      this.prisma.bankAccount.findFirst({
        where: { estateId, isDefault: true, closedAt: null },
        select: { alias: true, bankName: true, ibanEnc: true, chartAccount: { select: { code: true } } },
      }),
      this.prisma.estateOfficeTerm.findMany({
        where: { estateId, role: { in: ['PRESIDENT', 'VICE_PRESIDENT'] }, startsAt: { lte: today }, OR: [{ endsAt: null }, { endsAt: { gt: today } }] },
        orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.propertyMembership.findMany({
        where: { isKeyContact: true, status: 'linked', roleType: 'Propietario', user: { deletedAt: null }, property: { estateId, deletedAt: null } },
        select: { userId: true, property: { select: { ref: true } }, user: { select: { fullName: true, phone: true, email: true } } },
      }),
      this.prisma.externalOwner.findMany({
        where: { isKeyContact: true, promotedToUserId: null, property: { estateId, deletedAt: null } },
        select: { id: true, fullName: true, phone: true, email: true, property: { select: { ref: true } } },
      }),
      this.prisma.document.findMany({
        where: { estateId, deletedAt: null, type: { in: [...ESSENTIAL_DOCUMENT_TYPES] } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, type: true, title: true, date: true, size: true },
      }),
      this.prisma.supplierContract.findMany({
        where: {
          estateId, cancelledAt: null, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }],
          supplier: { category: { equals: INSURANCE_CATEGORY, mode: 'insensitive' } },
        },
        orderBy: { startDate: 'asc' },
        select: { id: true, serviceType: true, contractNumber: true, endDate: true, renewalType: true, notes: true, supplier: { select: { name: true } } },
      }),
    ]);
    // Estates saved before the map existed are located the first time someone opens the tab.
    if (!estate.geoResolvedAt) void this.geo.refreshEstate(estateId);
    const refOf = new Map(properties.map(p => [p.id, p.ref ?? '—']));

    const quotas = properties.flatMap(p => (p.participationQuota == null ? [] : [{ ref: p.ref ?? '—', value: num(p.participationQuota)! }]));
    const byValue = [...quotas].sort((a, b) => a.value - b.value);
    const built = properties.flatMap(p => (p.builtAreaM2 == null ? [] : [num(p.builtAreaM2)!]));

    const president = terms.find(t => t.role === 'PRESIDENT');
    const vicePresidents = terms.filter(t => t.role === 'VICE_PRESIDENT');
    const office = (t: (typeof terms)[number], label: string) => ({
      label, name: t.holderNameSnapshot, propertyRef: t.propertyId ? refOf.get(t.propertyId) ?? null : null, since: day(t.startsAt)!,
    });
    const officeOf = (person: { userId?: string; externalOwnerId?: string }) => {
      const term = terms.find(t => (person.userId && t.userId === person.userId) || (person.externalOwnerId && t.externalOwnerId === person.externalOwnerId));
      if (!term) return null;
      return term.role === 'PRESIDENT' ? 'Presidente' : `Vicepresidente ${vicePresidents.indexOf(term) + 1}º`;
    };

    // One entry per person even when flagged in several properties of the estate.
    type Contact = { name: string; office: string | null; propertyRefs: string[]; phone: string | null; email: string | null };
    const contacts = new Map<string, Contact>();
    for (const m of memberships) {
      const key = `u:${m.userId}`;
      const entry = contacts.get(key) ?? { name: m.user.fullName, office: officeOf({ userId: m.userId }), propertyRefs: [], phone: m.user.phone ?? null, email: m.user.email };
      entry.propertyRefs.push(m.property.ref ?? '—');
      contacts.set(key, entry);
    }
    for (const o of externals) {
      contacts.set(`x:${o.id}`, { name: o.fullName, office: officeOf({ externalOwnerId: o.id }), propertyRefs: [o.property.ref ?? '—'], phone: o.phone ?? null, email: o.email ?? null });
    }
    const officeRank = (label: string | null) => (label === 'Presidente' ? 0 : label ? 1 : 2);
    const keyContacts = [...contacts.values()]
      .map(c => ({ ...c, propertyRefs: [...c.propertyRefs].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })) }))
      .sort((a, b) => officeRank(a.office) - officeRank(b.office) || (a.office ?? '').localeCompare(b.office ?? '') || a.name.localeCompare(b.name, 'es'));

    let bank: { bankName: string | null; iban: string; masked: boolean; accountCode: string | null; alias: string | null } | null = null;
    if (bankAccount?.ibanEnc) {
      const iban = this.crypto.decrypt(bankAccount.ibanEnc);
      bank = { bankName: bankAccount.bankName ?? bankNameFromIban(iban), iban: this.crypto.maskIban(iban), masked: true, accountCode: bankAccount.chartAccount.code, alias: bankAccount.alias };
    } else if (estate.iban) {
      bank = { bankName: bankNameFromIban(estate.iban), iban: estate.iban, masked: false, accountCode: null, alias: null };
    }

    return {
      properties: properties.length,
      coefficients: {
        total: round2(quotas.reduce((sum, q) => sum + q.value, 0)),
        informed: quotas.length,
        missing: properties.length - quotas.length,
        max: byValue.at(-1) ?? null,
        min: byValue[0] ?? null,
      },
      surface: {
        parcelAreaM2: num(estate.parcelAreaM2),
        builtAreaM2: built.length ? round2(built.reduce((a, b) => a + b, 0)) : null,
        builtAreaInformed: built.length,
      },
      fiscalYear: fiscalYear
        ? { year: fiscalYear.year, startsOn: day(fiscalYear.startDate)!, endsOn: day(fiscalYear.endDate)!, status: fiscalYear.status as string }
        : { year, startsOn: `${year}-01-01`, endsOn: `${year}-12-31`, status: 'Abierto' },
      bank,
      administrator: estate.administrator
        ? { name: estate.administrator.name, contactName: estate.administrator.contactName ?? null, phone: estate.administrator.phone ?? null, email: estate.administrator.contactEmail ?? null }
        : null,
      offices: {
        president: president ? office(president, 'Presidente') : null,
        vicePresidents: vicePresidents.map((t, i) => office(t, `Vicepresidente ${i + 1}º`)),
      },
      keyContacts,
      essentialDocuments: ESSENTIAL_DOCUMENT_TYPES.map(type => {
        const latest = documents.find(d => d.type === type);
        return { type, document: latest ? { id: latest.id, title: latest.title, date: day(latest.date), size: latest.size } : null };
      }),
      insurance: contracts.map(c => ({
        contractId: c.id, type: c.serviceType, insurer: c.supplier.name, contractNumber: c.contractNumber ?? null,
        endDate: day(c.endDate), renewalType: c.renewalType, coverage: c.notes ?? null,
      })),
    };
  }
}
