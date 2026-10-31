import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { documentVisibleWhere } from '../documents/document-access.service';

export interface AuthorizationContext {
  user_id: string;
  tenant_id: string | null;
  allowed_community_ids: string[];
  allowed_property_ids: string[];
  authorized_document_ids: string[];
  role: 'A' | 'B' | 'C';
  permissions: string[];
}

/** JWT identifies the principal; current database state determines RAG permissions. */
@Injectable()
export class RagAuthorizationService {
  private readonly logger = new Logger(RagAuthorizationService.name);
  constructor(private readonly prisma: PrismaService) {}

  private async current(user: AuthenticatedUser) {
    const current = await this.prisma.user.findFirst({
      where: { id: user.id, deletedAt: null },
      select: { id: true, role: true, administratorId: true },
    });
    if (!current) throw new ForbiddenException('Acceso al asistente revocado.');
    return current;
  }

  async estates(user: AuthenticatedUser) {
    const current = await this.current(user);
    return this.estatesFor(current);
  }

  private async estatesFor(current: {
    id: string;
    role: 'A' | 'B' | 'C';
    administratorId: string | null;
  }) {
    const memberships =
      current.role === 'C'
        ? await this.prisma.propertyMembership.findMany({
            where: {
              userId: current.id,
              status: 'linked',
              revokedAt: null,
              property: { deletedAt: null },
            },
            select: { property: { select: { estateId: true } } },
          })
        : [];
    if (current.role === 'B' && !current.administratorId) return [];
    return this.prisma.estate.findMany({
      where: {
        deletedAt: null,
        ...(current.role === 'A'
          ? {}
          : current.role === 'B'
            ? { administratorId: current.administratorId! }
            : {
                id: {
                  in: memberships.flatMap((m) =>
                    m.property.estateId ? [m.property.estateId] : [],
                  ),
                },
              }),
      },
      select: { id: true, name: true, administratorId: true },
      orderBy: { name: 'asc' },
    });
  }

  async resolve(
    user: AuthenticatedUser,
    requested?: string,
    write = false,
  ): Promise<AuthorizationContext> {
    try {
      return await this.resolveCurrent(user, requested, write);
    } catch (error) {
      if (error instanceof ForbiddenException)
        this.logger.warn(
          JSON.stringify({
            event: 'rag.authorization.denied',
            correlation_id: randomUUID(),
            user_id: user.id,
            permission: write ? 'rag:ingest' : 'rag:query',
          }),
        );
      throw error;
    }
  }

  private async resolveCurrent(
    user: AuthenticatedUser,
    requested?: string,
    write = false,
  ): Promise<AuthorizationContext> {
    const current = await this.current(user);
    if (write && current.role === 'C')
      throw new ForbiddenException('Ingesta no permitida.');
    const estates = await this.estatesFor(current);
    const estate = requested
      ? estates.find((e) => e.id.toLowerCase() === requested.toLowerCase())
      : current.role === 'A'
        ? undefined
        : estates[0];
    // Role A may write without an estate to manage global/public RAG documents.
    if ((requested && !estate) || (write && !estate && current.role !== 'A')) {
      throw new ForbiddenException('No tienes acceso a esa comunidad.');
    }
    const properties =
      estate && current.role === 'C'
        ? await this.prisma.propertyMembership.findMany({
            where: {
              userId: current.id,
              status: 'linked',
              revokedAt: null,
              property: { estateId: estate.id, deletedAt: null },
            },
            select: { propertyId: true },
          })
        : [];
    const propertyIds = [...new Set(properties.map((p) => p.propertyId))];
    // Downloads, uploads and the assistant all trust this list: it MUST follow the document visibility rule.
    const documents = estate
      ? await this.prisma.document.findMany({
          where: {
            AND: [
              { estateId: estate.id },
              await documentVisibleWhere(this.prisma, user),
            ],
          },
          select: { id: true },
        })
      : [];
    return {
      user_id: current.id,
      tenant_id: estate?.administratorId ?? null,
      allowed_community_ids: estate ? [estate.id] : [],
      allowed_property_ids: propertyIds,
      authorized_document_ids: documents.map((d) => d.id),
      role: current.role,
      permissions: write
        ? [
            'rag:ingest',
            'rag:delete',
            // Role A without an estate manages global/public documents (no tenant binding).
            ...(current.role === 'A' && !estate ? ['rag:publish:public'] : []),
          ]
        : ['rag:query'],
    };
  }
}
