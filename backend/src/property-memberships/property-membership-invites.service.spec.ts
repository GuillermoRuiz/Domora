import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PropertyMembershipInvitesService } from './property-membership-invites.service';
import { PropertyMembershipsService } from './property-memberships.service';
import { PrismaService } from '../prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';

const PROPERTY_ID = 'property-1';
const TOKEN = 'un-token-cualquiera';
const EMAIL = 'nuevo.inquilino@example.com';
const DAY_MS = 24 * 60 * 60 * 1000;

function user(role: AppRole, id = 'user-1'): AuthenticatedUser {
  return { id, role, estateIds: ['estate-1'], administratorId: 'admin-1' };
}

function validInvite(
  overrides: Partial<{
    usedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
    propertyId: string;
  }> = {},
) {
  return {
    id: 'invite-1',
    propertyId: PROPERTY_ID,
    roleType: 'Inquilino',
    inviteeEmail: EMAIL,
    createdByUserId: 'owner-1',
    usedAt: null,
    revokedAt: null,
    lastSentAt: new Date(),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * DAY_MS),
    ...overrides,
  };
}

describe('PropertyMembershipInvitesService', () => {
  let service: PropertyMembershipInvitesService;
  let inviteCreate: jest.Mock;
  let inviteFindUnique: jest.Mock;
  let inviteFindMany: jest.Mock;
  let propertyFindUniqueOrThrow: jest.Mock;
  let membershipUpsert: jest.Mock;
  let inviteUpdate: jest.Mock;
  let txPropertyFindUniqueOrThrow: jest.Mock;
  let txUserFindUnique: jest.Mock;
  let activityLogCreate: jest.Mock;
  let assertCanManageMembers: jest.Mock;
  let sendMembershipInvite: jest.Mock;

  beforeEach(() => {
    inviteCreate = jest.fn().mockResolvedValue({});
    inviteFindUnique = jest.fn().mockResolvedValue(validInvite());
    inviteFindMany = jest.fn().mockResolvedValue([]);
    propertyFindUniqueOrThrow = jest.fn().mockResolvedValue({
      viaType: 'Calle',
      viaName: 'Mayor',
      streetNumber: '3',
      staircase: null,
      floor: '2',
      door: 'A',
      estate: { name: 'Residencial Sol' },
    });
    membershipUpsert = jest
      .fn()
      .mockImplementation(({ create }) =>
        Promise.resolve({ id: 'membership-nueva', ...create }),
      );
    inviteUpdate = jest
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ ...validInvite(), ...data }),
      );
    txPropertyFindUniqueOrThrow = jest
      .fn()
      .mockResolvedValue({ estateId: 'estate-1' });
    txUserFindUnique = jest.fn().mockResolvedValue({
      fullName: 'Nuevo Inquilino',
      email: EMAIL,
      taxId: null,
      taxIdCountry: null,
    });
    activityLogCreate = jest.fn().mockResolvedValue({});

    const tx = {
      propertyMembershipInvite: {
        findUnique: inviteFindUnique,
        update: inviteUpdate,
      },
      propertyMembership: { upsert: membershipUpsert },
      property: { findUniqueOrThrow: txPropertyFindUniqueOrThrow },
      user: {
        findUnique: txUserFindUnique,
        findUniqueOrThrow: txUserFindUnique,
      },
      activityLogEntry: { create: activityLogCreate },
    };

    const prisma = {
      propertyMembershipInvite: {
        create: inviteCreate,
        findUnique: inviteFindUnique,
        findMany: inviteFindMany,
        update: inviteUpdate,
      },
      property: { findUniqueOrThrow: propertyFindUniqueOrThrow },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;

    assertCanManageMembers = jest
      .fn()
      .mockResolvedValue({ id: PROPERTY_ID, estateId: 'estate-1' });
    const memberships = {
      assertCanManageMembers,
    } as unknown as PropertyMembershipsService;

    sendMembershipInvite = jest.fn().mockResolvedValue(undefined);
    const mail = { sendMembershipInvite } as unknown as MailService;

    const config = {
      get: jest.fn().mockReturnValue('https://app.domora.test'),
    } as unknown as ConfigService;

    service = new PropertyMembershipInvitesService(
      prisma,
      memberships,
      mail,
      config,
    );
  });

  describe('createInvite', () => {
    it('crea el invite con el email del invitado y devuelve enlace + QR construidos en el backend', async () => {
      const result = await service.createInvite(
        PROPERTY_ID,
        'Inquilino',
        EMAIL,
        user('C'),
      );

      expect(result.token).toEqual(expect.any(String));
      expect(result.inviteUrl).toBe(
        `https://app.domora.test/membership-invite/${result.token}`,
      );
      expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(inviteCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            propertyId: PROPERTY_ID,
            roleType: 'Inquilino',
            inviteeEmail: EMAIL,
          }),
        }),
      );
    });

    it('envía el email de invitación al invitado con la dirección de la propiedad', async () => {
      const result = await service.createInvite(
        PROPERTY_ID,
        'Inquilino',
        EMAIL,
        user('C'),
      );
      expect(sendMembershipInvite).toHaveBeenCalledWith(
        EMAIL,
        'Inquilino',
        'Calle Mayor 3 2º A',
        'Residencial Sol',
        result.inviteUrl,
      );
    });

    it('un fallo del envío de email nunca rompe la creación de la invitación', async () => {
      sendMembershipInvite.mockRejectedValue(new Error('SMTP caído'));
      await expect(
        service.createInvite(PROPERTY_ID, 'Inquilino', EMAIL, user('C')),
      ).resolves.toMatchObject({
        token: expect.any(String),
      });
    });

    it('propaga el rechazo cuando el requester no puede gestionar la propiedad', async () => {
      assertCanManageMembers.mockRejectedValue(new ForbiddenException());
      await expect(
        service.createInvite(
          PROPERTY_ID,
          'Inquilino',
          EMAIL,
          user('C', 'ajeno'),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(inviteCreate).not.toHaveBeenCalled();
      expect(sendMembershipInvite).not.toHaveBeenCalled();
    });
  });

  describe('getInviteInfo', () => {
    it('devuelve la dirección de la propiedad y el nombre de la finca', async () => {
      const info = await service.getInviteInfo(TOKEN);
      expect(info).toEqual({
        roleType: 'Inquilino',
        propertyAddress: 'Calle Mayor 3 2º A',
        estateName: 'Residencial Sol',
      });
    });

    it('rechaza un token inválido', async () => {
      inviteFindUnique.mockResolvedValue(null);
      await expect(service.getInviteInfo(TOKEN)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rechaza un token ya usado', async () => {
      inviteFindUnique.mockResolvedValue(validInvite({ usedAt: new Date() }));
      await expect(service.getInviteInfo(TOKEN)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rechaza un token caducado', async () => {
      inviteFindUnique.mockResolvedValue(
        validInvite({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.getInviteInfo(TOKEN)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rechaza un token revocado aunque no haya caducado', async () => {
      inviteFindUnique.mockResolvedValue(
        validInvite({ revokedAt: new Date() }),
      );
      await expect(service.getInviteInfo(TOKEN)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('redeemInvite', () => {
    it('adjunta la membresía al usuario autenticado y marca el invite usado', async () => {
      const result = await service.redeemInvite(
        TOKEN,
        user('C', 'nuevo-inquilino'),
      );

      expect(membershipUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            propertyId: PROPERTY_ID,
            userId: 'nuevo-inquilino',
            roleType: 'Inquilino',
            status: 'linked',
          }),
        }),
      );
      expect(inviteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ usedByUserId: 'nuevo-inquilino' }),
        }),
      );
      expect(result).toMatchObject({ propertyId: PROPERTY_ID });
    });

    it('rechaza el canje si el invite ya fue usado dentro de la misma transacción (carrera)', async () => {
      inviteFindUnique
        .mockResolvedValueOnce(validInvite()) // findValidInvite, fuera de la tx
        .mockResolvedValueOnce(validInvite({ usedAt: new Date() })); // re-chequeo dentro de la tx

      await expect(service.redeemInvite(TOKEN, user('C'))).rejects.toThrow(
        ConflictException,
      );
      expect(membershipUpsert).not.toHaveBeenCalled();
    });

    it('rechaza el canje de un token caducado', async () => {
      inviteFindUnique.mockResolvedValue(
        validInvite({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.redeemInvite(TOKEN, user('C'))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rechaza el canje de un token revocado', async () => {
      inviteFindUnique.mockResolvedValue(
        validInvite({ revokedAt: new Date() }),
      );
      await expect(service.redeemInvite(TOKEN, user('C'))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(membershipUpsert).not.toHaveBeenCalled();
    });
  });

  describe('listPendingInvites', () => {
    it('solo consulta invitaciones sin canjear de la propiedad', async () => {
      await service.listPendingInvites(PROPERTY_ID, user('B'));
      expect(inviteFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { propertyId: PROPERTY_ID, usedAt: null },
        }),
      );
    });

    it('deriva el estado de cada invitación sin persistirlo', async () => {
      inviteFindMany.mockResolvedValue([
        validInvite({ expiresAt: new Date(Date.now() + 5 * DAY_MS) }),
        validInvite({ expiresAt: new Date(Date.now() + DAY_MS) }),
        validInvite({ expiresAt: new Date(Date.now() - DAY_MS) }),
        validInvite({
          revokedAt: new Date(),
          expiresAt: new Date(Date.now() + 5 * DAY_MS),
        }),
      ]);

      const result = await service.listPendingInvites(PROPERTY_ID, user('B'));
      expect(result.map((r) => r.status)).toEqual([
        'pending',
        'expiring_soon',
        'expired',
        'revoked',
      ]);
    });

    it('nunca expone el hash del token', async () => {
      inviteFindMany.mockResolvedValue([
        { ...validInvite(), tokenHash: 'secreto' },
      ]);
      const [row] = await service.listPendingInvites(PROPERTY_ID, user('B'));
      expect(row).not.toHaveProperty('tokenHash');
    });

    it('propaga el rechazo cuando el requester no puede gestionar la propiedad', async () => {
      assertCanManageMembers.mockRejectedValue(new ForbiddenException());
      await expect(
        service.listPendingInvites(PROPERTY_ID, user('C', 'ajeno')),
      ).rejects.toThrow(ForbiddenException);
      expect(inviteFindMany).not.toHaveBeenCalled();
    });
  });

  describe('resendInvite', () => {
    it('rota el token, extiende la caducidad 7 días y reenvía el email', async () => {
      const before = Date.now();
      const result = await service.resendInvite(
        PROPERTY_ID,
        'invite-1',
        user('B'),
      );

      const { data } = inviteUpdate.mock.calls[0][0];
      expect(data.tokenHash).toEqual(expect.any(String));
      expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 7 * DAY_MS,
      );
      expect(data.lastSentAt).toBeInstanceOf(Date);
      expect(sendMembershipInvite).toHaveBeenCalledWith(
        EMAIL,
        'Inquilino',
        'Calle Mayor 3 2º A',
        'Residencial Sol',
        result.inviteUrl,
      );
    });

    it('rechaza reenviar una invitación ya canjeada', async () => {
      inviteFindUnique.mockResolvedValue(validInvite({ usedAt: new Date() }));
      await expect(
        service.resendInvite(PROPERTY_ID, 'invite-1', user('B')),
      ).rejects.toThrow(ConflictException);
      expect(sendMembershipInvite).not.toHaveBeenCalled();
    });

    it('rechaza reenviar una invitación revocada', async () => {
      inviteFindUnique.mockResolvedValue(
        validInvite({ revokedAt: new Date() }),
      );
      await expect(
        service.resendInvite(PROPERTY_ID, 'invite-1', user('B')),
      ).rejects.toThrow(ConflictException);
    });

    it('rechaza una invitación de otra propiedad (no se puede reenviar cruzando la ruta)', async () => {
      inviteFindUnique.mockResolvedValue(
        validInvite({ propertyId: 'otra-propiedad' }),
      );
      await expect(
        service.resendInvite(PROPERTY_ID, 'invite-1', user('B')),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('permite reenviar una invitación ya caducada (es justo el caso de uso)', async () => {
      inviteFindUnique.mockResolvedValue(
        validInvite({ expiresAt: new Date(Date.now() - DAY_MS) }),
      );
      await expect(
        service.resendInvite(PROPERTY_ID, 'invite-1', user('B')),
      ).resolves.toBeDefined();
    });
  });

  describe('revokeInvite', () => {
    it('marca la invitación como revocada con quién la revocó', async () => {
      await service.revokeInvite(
        PROPERTY_ID,
        'invite-1',
        user('B', 'gestora-1'),
      );
      expect(inviteUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'invite-1' },
          data: expect.objectContaining({
            revokedByUserId: 'gestora-1',
            revokedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('rechaza revocar una invitación ya canjeada', async () => {
      inviteFindUnique.mockResolvedValue(validInvite({ usedAt: new Date() }));
      await expect(
        service.revokeInvite(PROPERTY_ID, 'invite-1', user('B')),
      ).rejects.toThrow(ConflictException);
      expect(inviteUpdate).not.toHaveBeenCalled();
    });

    it('propaga el rechazo cuando el requester no puede gestionar la propiedad', async () => {
      assertCanManageMembers.mockRejectedValue(new ForbiddenException());
      await expect(
        service.revokeInvite(PROPERTY_ID, 'invite-1', user('C', 'ajeno')),
      ).rejects.toThrow(ForbiddenException);
      expect(inviteUpdate).not.toHaveBeenCalled();
    });
  });
});
