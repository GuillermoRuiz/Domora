import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { bootstrapEstateLedger } from '../ledger/chart/ledger-bootstrap';
import { JournalService } from '../ledger/journal/journal.service';
import { ReceiptPostingService } from '../ledger/posting/receipt-posting.service';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { purgeAdministrator } from '../testing/db-fixtures';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import type { PropertyMembershipsService } from './property-memberships.service';
import { PropertyMembershipInvitesService } from './property-membership-invites.service';
import { AccountingService } from '../accounting/accounting.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { ExternalOwnersService } from '../external-owners/external-owners.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real — mismo criterio que
 * `meeting-quorum.service.spec.ts`: los límites del estado derivado
 * (expiring_soon vs. pending vs. expired) y el ciclo completo
 * crear → reenviar → canjear / revocar → canjear dependen de columnas
 * Timestamptz y de la unicidad real de `tokenHash`, no de un mock.
 *
 * La autorización (`assertCanManageMembers`) sí va mockeada: no es lo que se
 * prueba aquí y ya tiene su propia cobertura.
 */
const prisma = createPrismaClient();

const CIF = 'TESTINV-INT-1';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

let administratorId: string;
let estateId: string;
let propertyId: string;
let managerId: string;
let inviteeId: string;
let manager: AuthenticatedUser;
let invitee: AuthenticatedUser;
let service: PropertyMembershipInvitesService;
let sendMembershipInvite: jest.Mock;

async function createRawInvite(expiresAt: Date, extra: { revokedAt?: Date; usedAt?: Date } = {}) {
  return prisma.propertyMembershipInvite.create({
    data: {
      propertyId,
      roleType: 'Inquilino',
      inviteeEmail: 'raw@test.local',
      tokenHash: `raw-${Math.random().toString(36).slice(2)}-${Date.now()}`,
      createdByUserId: managerId,
      expiresAt,
      ...extra,
    },
  });
}

function tokenFromUrl(url: string): string {
  return url.split('/membership-invite/')[1];
}

beforeAll(async () => {
  const admin = await prisma.administrator.create({
    data: { name: 'Gestora de prueba (invites int)', cif: CIF, plan: 'BASE', tier: 'basic', usersMax: 5, status: 'Activa' },
  });
  administratorId = admin.id;

  const estate = await prisma.estate.create({
    data: { administratorId, name: 'Finca de prueba — invites int', type: 'Edificio', address: 'Calle Falsa 14', location: 'Madrid' },
  });
  estateId = estate.id;
  // Contabilidad lista para poder emitir recibos (ver el test de recibos).
  await prisma.$transaction((tx) =>
    bootstrapEstateLedger(tx, estateId, { cutoverDate: new Date(Date.UTC(2099, 0, 1)) }),
  );

  const property = await prisma.property.create({
    data: { estateId, type: 'Piso', status: 'Ocupado', viaType: 'Calle', viaName: 'Falsa', streetNumber: '14', floor: '1', door: 'A', quotaMonthly: '50.00' },
  });
  propertyId = property.id;

  const managerRow = await prisma.user.create({
    data: { email: `manager-invites-int-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Gestora', role: 'B', administratorId },
  });
  managerId = managerRow.id;
  manager = { id: managerId, role: 'B', estateIds: [estateId], administratorId };

  const inviteeRow = await prisma.user.create({
    data: { email: `invitee-invites-int-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Nuevo Inquilino', role: 'C', administratorId },
  });
  inviteeId = inviteeRow.id;
  invitee = { id: inviteeId, role: 'C', estateIds: [], administratorId };
});

beforeEach(() => {
  sendMembershipInvite = jest.fn().mockResolvedValue(undefined);
  const memberships = {
    assertCanManageMembers: jest.fn().mockResolvedValue({ id: propertyId, estateId }),
  } as unknown as PropertyMembershipsService;
  const mail = { sendMembershipInvite } as unknown as MailService;
  const config = { get: jest.fn().mockReturnValue('https://app.domora.test') } as unknown as ConfigService;
  service = new PropertyMembershipInvitesService(prisma as unknown as PrismaService, memberships, mail, config);
});

afterEach(async () => {
  await prisma.activityLogEntry.deleteMany({ where: { propertyId } });
  await prisma.propertyMembership.deleteMany({ where: { propertyId } });
  await prisma.propertyMembershipInvite.deleteMany({ where: { propertyId } });
  await prisma.externalOwner.deleteMany({ where: { propertyId } });
  await prisma.user.update({ where: { id: inviteeId }, data: { taxId: null, taxIdCountry: null } });
});

afterAll(async () => {
  // Purga la finca entera (recibos y asientos incluidos) y los usuarios de
  // la gestora, invitado incluido.
  await purgeAdministrator(prisma, administratorId);
  await prisma.$disconnect();
});

describe('PropertyMembershipInvitesService (Postgres real)', () => {
  describe('estado derivado en listPendingInvites', () => {
    it('distingue pending / expiring_soon / expired / revoked en los límites reales', async () => {
      const pending = await createRawInvite(new Date(Date.now() + 49 * HOUR_MS));
      const expiringSoon = await createRawInvite(new Date(Date.now() + 47 * HOUR_MS));
      const expired = await createRawInvite(new Date(Date.now() - 60_000));
      const revoked = await createRawInvite(new Date(Date.now() + 5 * DAY_MS), { revokedAt: new Date() });

      const result = await service.listPendingInvites(propertyId, manager);
      const statusById = new Map(result.map((r) => [r.id, r.status]));

      expect(statusById.get(pending.id)).toBe('pending');
      expect(statusById.get(expiringSoon.id)).toBe('expiring_soon');
      expect(statusById.get(expired.id)).toBe('expired');
      expect(statusById.get(revoked.id)).toBe('revoked');
    });

    it('una invitación canjeada desaparece del listado (pasa a ser un PropertyMembership)', async () => {
      const used = await createRawInvite(new Date(Date.now() + 5 * DAY_MS), { usedAt: new Date() });
      const result = await service.listPendingInvites(propertyId, manager);
      expect(result.map((r) => r.id)).not.toContain(used.id);
    });
  });

  describe('ciclo de vida completo', () => {
    it('crear → canjear vincula al invitado y la invitación deja de listarse', async () => {
      const { inviteUrl } = await service.createInvite(propertyId, 'Inquilino', 'nuevo@test.local', manager);

      await service.redeemInvite(tokenFromUrl(inviteUrl), invitee);

      const membership = await prisma.propertyMembership.findFirstOrThrow({ where: { propertyId, userId: inviteeId } });
      expect(membership.status).toBe('linked');
      expect(await service.listPendingInvites(propertyId, manager)).toHaveLength(0);
    });

    it('reenviar invalida el enlace anterior y el nuevo funciona (misma fila, token rotado)', async () => {
      const first = await service.createInvite(propertyId, 'Inquilino', 'nuevo@test.local', manager);
      const [row] = await service.listPendingInvites(propertyId, manager);

      const resent = await service.resendInvite(propertyId, row.id, manager);

      await expect(service.getInviteInfo(tokenFromUrl(first.inviteUrl))).rejects.toThrow(UnauthorizedException);
      await expect(service.getInviteInfo(tokenFromUrl(resent.inviteUrl))).resolves.toMatchObject({ roleType: 'Inquilino' });
      const rows = await prisma.propertyMembershipInvite.findMany({ where: { propertyId } });
      expect(rows).toHaveLength(1);
    });

    it('reenviar una invitación caducada la reactiva con 7 días nuevos', async () => {
      const expired = await createRawInvite(new Date(Date.now() - DAY_MS));

      const { inviteUrl } = await service.resendInvite(propertyId, expired.id, manager);

      const updated = await prisma.propertyMembershipInvite.findUniqueOrThrow({ where: { id: expired.id } });
      expect(updated.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * DAY_MS);
      await expect(service.getInviteInfo(tokenFromUrl(inviteUrl))).resolves.toBeDefined();
    });

    it('revocar bloquea el canje aunque el enlace no haya caducado', async () => {
      const { inviteUrl } = await service.createInvite(propertyId, 'Inquilino', 'nuevo@test.local', manager);
      const [row] = await service.listPendingInvites(propertyId, manager);

      await service.revokeInvite(propertyId, row.id, manager);

      await expect(service.redeemInvite(tokenFromUrl(inviteUrl), invitee)).rejects.toThrow(UnauthorizedException);
      expect(await prisma.propertyMembership.count({ where: { propertyId, userId: inviteeId } })).toBe(0);
    });

    it('no se puede revocar una invitación ya canjeada', async () => {
      const { inviteUrl } = await service.createInvite(propertyId, 'Inquilino', 'nuevo@test.local', manager);
      const invite = await prisma.propertyMembershipInvite.findFirstOrThrow({ where: { propertyId } });
      await service.redeemInvite(tokenFromUrl(inviteUrl), invitee);

      await expect(service.revokeInvite(propertyId, invite.id, manager)).rejects.toThrow(ConflictException);
    });
  });
});

/**
 * Invitación de PROPIETARIO ligada a un titular importado. Contra Postgres
 * real porque lo que protege está en la BD: el CHECK Propietario ⇔
 * externalOwnerId, la FK Restrict, la promoción atómica y el titular de los
 * recibos que se generen después.
 */
describe('invitación de propietario importado (Postgres real)', () => {
  let inviteeEmail: string;
  let strangerId: string;

  beforeAll(async () => {
    inviteeEmail = (await prisma.user.findUniqueOrThrow({ where: { id: inviteeId } })).email;
    const stranger = await prisma.user.create({
      data: { email: `stranger-invites-int-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Otra Persona', role: 'C', administratorId },
    });
    strangerId = stranger.id;
  });

  async function importedOwner(overrides: { email?: string | null; taxId?: string | null } = {}) {
    return prisma.externalOwner.create({
      data: {
        propertyId,
        fullName: 'Titular Importado',
        email: overrides.email === undefined ? inviteeEmail.toUpperCase() : overrides.email,
        taxId: overrides.taxId === undefined ? '12345678Z' : overrides.taxId,
        taxIdCountry: 'ES',
        roleType: 'Propietario',
        createdByUserId: managerId,
      },
    });
  }

  const stranger = (): AuthenticatedUser => ({ id: strangerId, role: 'C', estateIds: [], administratorId });

  describe('emisión', () => {
    it('solo la gestora: un vecino, aunque gestione la propiedad, no puede invitar a un propietario', async () => {
      const owner = await importedOwner();
      await expect(service.createOwnerInvite(propertyId, owner.id, invitee)).rejects.toThrow(ForbiddenException);
    });

    it('va al email del titular importado y queda como invitación de Propietario ligada a él', async () => {
      const owner = await importedOwner();

      await service.createOwnerInvite(propertyId, owner.id, manager);

      const invite = await prisma.propertyMembershipInvite.findFirstOrThrow({ where: { externalOwnerId: owner.id } });
      expect(invite.roleType).toBe('Propietario');
      expect(invite.inviteeEmail).toBe(owner.email);
      expect(sendMembershipInvite).toHaveBeenCalledWith(owner.email, 'Propietario', expect.any(String), expect.anything(), expect.any(String));
    });

    it('un titular sin email no se puede invitar', async () => {
      const owner = await importedOwner({ email: null });
      await expect(service.createOwnerInvite(propertyId, owner.id, manager)).rejects.toThrow(BadRequestException);
    });

    it('no admite una segunda invitación mientras la primera siga pendiente', async () => {
      const owner = await importedOwner();
      await service.createOwnerInvite(propertyId, owner.id, manager);
      await expect(service.createOwnerInvite(propertyId, owner.id, manager)).rejects.toThrow(ConflictException);
    });

    it('la BD rechaza una invitación de Propietario sin titular, y una de inquilino ligada a un titular', async () => {
      const owner = await importedOwner();
      const base = { propertyId, inviteeEmail: 'x@test.local', createdByUserId: managerId, expiresAt: new Date(Date.now() + DAY_MS) };

      await expect(prisma.propertyMembershipInvite.create({
        data: { ...base, roleType: 'Propietario', tokenHash: `chk-1-${Date.now()}` },
      })).rejects.toThrow(/owner_requires_external_owner/);
      await expect(prisma.propertyMembershipInvite.create({
        data: { ...base, roleType: 'Inquilino', externalOwnerId: owner.id, tokenHash: `chk-2-${Date.now()}` },
      })).rejects.toThrow(/owner_requires_external_owner/);
    });
  });

  describe('canje', () => {
    it('con otra cuenta se rechaza y no toca nada (el enlace no es un token al portador)', async () => {
      const owner = await importedOwner();
      const { inviteUrl } = await service.createOwnerInvite(propertyId, owner.id, manager);

      await expect(service.redeemInvite(tokenFromUrl(inviteUrl), stranger())).rejects.toThrow(ForbiddenException);

      expect((await prisma.externalOwner.findUniqueOrThrow({ where: { id: owner.id } })).promotedToUserId).toBeNull();
      expect(await prisma.propertyMembership.count({ where: { propertyId } })).toBe(0);
      expect((await prisma.propertyMembershipInvite.findFirstOrThrow({ where: { externalOwnerId: owner.id } })).usedAt).toBeNull();
    });

    it('con la cuenta de ese email (sin distinguir mayúsculas): Propietario titular principal, titular promovido y NIF copiado', async () => {
      const owner = await importedOwner();
      const { inviteUrl } = await service.createOwnerInvite(propertyId, owner.id, manager);

      await service.redeemInvite(tokenFromUrl(inviteUrl), invitee);

      const membership = await prisma.propertyMembership.findFirstOrThrow({ where: { propertyId, userId: inviteeId } });
      expect(membership).toMatchObject({ roleType: 'Propietario', status: 'linked', isPrimaryContact: true });
      const promoted = await prisma.externalOwner.findUniqueOrThrow({ where: { id: owner.id } });
      expect(promoted.promotedToUserId).toBe(inviteeId);
      expect(promoted.promotedAt).not.toBeNull();
      const user = await prisma.user.findUniqueOrThrow({ where: { id: inviteeId } });
      expect(user).toMatchObject({ taxId: '12345678Z', taxIdCountry: 'ES' });
    });

    it('nunca pisa un NIF ya informado en la cuenta: lo deja y lo anota para la gestora', async () => {
      await prisma.user.update({ where: { id: inviteeId }, data: { taxId: '87654321X' } });
      const owner = await importedOwner();
      const { inviteUrl } = await service.createOwnerInvite(propertyId, owner.id, manager);

      await service.redeemInvite(tokenFromUrl(inviteUrl), invitee);

      expect((await prisma.user.findUniqueOrThrow({ where: { id: inviteeId } })).taxId).toBe('87654321X');
      const log = await prisma.activityLogEntry.findFirstOrThrow({ where: { propertyId } });
      expect(log.summary).toContain('no coincide con el importado (12345678Z)');
    });

    it('si la propiedad ya tiene titular principal, no se lo quita', async () => {
      await prisma.propertyMembership.create({
        data: { propertyId, userId: strangerId, roleType: 'Propietario', status: 'linked', isPrimaryContact: true, linkedAt: new Date() },
      });
      const owner = await importedOwner();
      const { inviteUrl } = await service.createOwnerInvite(propertyId, owner.id, manager);

      await service.redeemInvite(tokenFromUrl(inviteUrl), invitee);

      const mine = await prisma.propertyMembership.findFirstOrThrow({ where: { propertyId, userId: inviteeId } });
      expect(mine.isPrimaryContact).toBe(false);
    });

    it('si el titular ya se vinculó a otra cuenta entretanto, 409 y nada queda a medias', async () => {
      const owner = await importedOwner();
      const { inviteUrl } = await service.createOwnerInvite(propertyId, owner.id, manager);
      await prisma.externalOwner.update({ where: { id: owner.id }, data: { promotedToUserId: strangerId, promotedAt: new Date() } });

      await expect(service.redeemInvite(tokenFromUrl(inviteUrl), invitee)).rejects.toThrow(ConflictException);

      expect(await prisma.propertyMembership.count({ where: { propertyId, userId: inviteeId } })).toBe(0);
      expect((await prisma.propertyMembershipInvite.findFirstOrThrow({ where: { externalOwnerId: owner.id } })).usedAt).toBeNull();
    });

    it('los recibos siguientes salen a nombre del usuario promovido y conservan el NIF', async () => {
      const owner = await importedOwner();
      const { inviteUrl } = await service.createOwnerInvite(propertyId, owner.id, manager);
      await service.redeemInvite(tokenFromUrl(inviteUrl), invitee);
      const accounting = new AccountingService(
        prisma as unknown as PrismaService,
        new EstateAccessService(),
        undefined as never,
        new ReceiptPostingService(new JournalService()),
        new CollectionPostingService(new JournalService(), new ReceiptPostingService(new JournalService())),
        { notify: async () => {} } as unknown as NotificationsService,
      );
      const periodKey = '2099-08';
      // Los recibos emitidos no se borran: se purgan con la finca al final.
      await accounting.generateReceipts(estateId, { periodKey }, { id: managerId, role: 'A', estateIds: [], administratorId: null });

      const receipt = await prisma.accountingReceipt.findFirstOrThrow({ where: { propertyId, period: { periodKey } } });
      expect(receipt.ownerUserId).toBe(inviteeId);
      expect(receipt.ownerTaxIdSnapshot).toBe('12345678Z');
    });
  });

  it('borrar a mano un titular se lleva su invitación pendiente (la FK Restrict no deja huérfanos)', async () => {
    const owner = await importedOwner();
    await service.createOwnerInvite(propertyId, owner.id, manager);
    const externalOwners = new ExternalOwnersService(prisma as unknown as PrismaService, new EstateAccessService());

    await externalOwners.remove(owner.id, manager);

    expect(await prisma.externalOwner.count({ where: { id: owner.id } })).toBe(0);
    expect(await prisma.propertyMembershipInvite.count({ where: { externalOwnerId: owner.id } })).toBe(0);
  });
});
