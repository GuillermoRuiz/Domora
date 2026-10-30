import { ForbiddenException } from '@nestjs/common';
import { RagAuthorizationService } from './rag-authorization.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-a',
  role: 'A',
  administratorId: null,
  estateIds: ['community-b'],
}; // Deliberately stale/forged role and scope.

function fixture() {
  const prisma = {
    user: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'user-a', role: 'C', administratorId: null }),
    },
    propertyMembership: {
      findMany: jest
        .fn()
        .mockImplementation((args: { select: { property?: unknown } }) =>
          Promise.resolve(
            args.select.property
              ? [{ propertyId: 'property-a', property: { estateId: 'community-a' } }]
              : [{ propertyId: 'property-a' }],
          ),
        ),
    },
    estate: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'community-a', name: 'A', administratorId: 'tenant-a' },
        ]),
    },
    estateOfficeTerm: { findMany: jest.fn().mockResolvedValue([]) },
    document: { findMany: jest.fn().mockResolvedValue([{ id: 'document-a' }]) },
  };
  return {
    prisma,
    service: new RagAuthorizationService(prisma as unknown as PrismaService),
  };
}

describe('RAG authoritative scope', () => {
  it('uses current role, tenant, memberships and document ACL instead of JWT permissions', async () => {
    const { service, prisma } = fixture();
    const ctx = await service.resolve(user, 'community-a');
    expect(ctx).toMatchObject({
      role: 'C',
      tenant_id: 'tenant-a',
      allowed_community_ids: ['community-a'],
      allowed_property_ids: ['property-a'],
      authorized_document_ids: ['document-a'],
      permissions: ['rag:query'],
    });
    const membershipCall = prisma.propertyMembership.findMany.mock
      .calls[0] as unknown as [{ where: unknown }];
    expect(membershipCall[0].where).toMatchObject({
      userId: user.id,
      status: 'linked',
      revokedAt: null,
    });
    const documentCall = prisma.document.findMany.mock.calls[0] as unknown as [
      { where: unknown },
    ];
    // Library visibility rule: an owner never gets «Solo gestora» documents, and nothing from the trash.
    expect(documentCall[0].where).toEqual({
      AND: [
        { estateId: 'community-a' },
        {
          deletedAt: null,
          OR: [
            { effectiveVisibility: 'OWNERS', estateId: { in: ['community-a'] } },
            { effectiveVisibility: 'PROPERTY', targetPropertyId: { in: ['property-a'] } },
          ],
        },
      ],
    });
  });
  it('denies client community B even if stale JWT lists B', async () => {
    const { service, prisma } = fixture();
    await expect(service.resolve(user, 'community-b')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  });
  it('denies a deleted user immediately', async () => {
    const { service, prisma } = fixture();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.resolve(user, 'community-a')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('denies revoked membership despite old JWT access', async () => {
    const { service, prisma } = fixture();
    prisma.estate.findMany.mockResolvedValue([]);
    await expect(service.resolve(user, 'community-a')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('denies ingestion when role A in token was demoted to resident', async () => {
    const { service } = fixture();
    await expect(
      service.resolve(user, 'community-a', true),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('role A without estate gets rag:publish:public on write', async () => {
    const { service, prisma } = fixture();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-a',
      role: 'A',
      administratorId: null,
    });
    const ctx = await service.resolve(user, undefined, true);
    expect(ctx.permissions).toContain('rag:publish:public');
    expect(ctx.tenant_id).toBeNull();
    expect(ctx.allowed_community_ids).toEqual([]);
  });
  it('role A with estate does NOT get rag:publish:public', async () => {
    const { service, prisma } = fixture();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-a',
      role: 'A',
      administratorId: null,
    });
    const ctx = await service.resolve(user, 'community-a', true);
    expect(ctx.permissions).not.toContain('rag:publish:public');
    expect(ctx.permissions).toContain('rag:delete');
  });
  it('role B write without estate is denied', async () => {
    const { service, prisma } = fixture();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-a',
      role: 'B',
      administratorId: 'tenant-a',
    });
    // Role B defaults to first estate; if estates list is empty → denied
    prisma.estate.findMany.mockResolvedValue([]);
    await expect(service.resolve(user, undefined, true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('role B uses current administrator, not token tenant', async () => {
    const { service, prisma } = fixture();
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-a',
      role: 'B',
      administratorId: 'tenant-a',
    });
    await service.resolve(user, 'community-a');
    expect(prisma.estate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, administratorId: 'tenant-a' },
      }),
    );
  });
});
