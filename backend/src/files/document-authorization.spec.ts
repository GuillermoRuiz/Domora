import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { DocumentFilesController } from './files.controller';
import { LibraryService } from '../documents/library.service';
import type { AuditService } from '../gdpr/audit.service';
import { RagAuthorizationService } from '../assistant/rag-authorization.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from './storage.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const DOC_ID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const user: AuthenticatedUser = {
  id: 'user-a',
  role: 'B',
  estateIds: ['community-a'],
  administratorId: 'tenant-a',
};

function fixture() {
  const prisma = {
    user: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: user.id, role: 'C', administratorId: null }),
    },
    estate: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'community-a', name: 'A', administratorId: 'tenant-a' },
        ]),
    },
    estateOfficeTerm: { findMany: jest.fn().mockResolvedValue([]) },
    propertyMembership: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { propertyId: 'property-a', property: { estateId: 'community-a' } },
        ]),
    },
    document: {
      findMany: jest.fn().mockResolvedValue([{ id: 'document-a' }]),
      findFirst: jest.fn().mockResolvedValue({
        id: 'document-a',
        estateId: 'community-a',
        s3Key: 'documents/community-a/f.pdf',
        title: 'Acta',
        targetPropertyId: null,
      }),
      create: jest.fn(),
    },
  };
  const storage = {
    assertDocumentKey: jest.fn(),
    get: jest.fn().mockResolvedValue(Buffer.from('original')),
    put: jest.fn(),
  };
  const auth = new RagAuthorizationService(prisma as unknown as PrismaService);
  const audit = { logAccess: jest.fn().mockResolvedValue(undefined) };
  const controller = new DocumentFilesController(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    auth,
    audit as unknown as AuditService,
  );
  return {
    prisma,
    storage,
    auth,
    audit,
    controller,
    response: { setHeader: jest.fn(), send: jest.fn() } as unknown as Response,
  };
}

describe('Original document authorization uses current database state', () => {
  it('denies orphaned originals even when old JWT claims include the former community', async () => {
    const { prisma, storage, controller, response } = fixture();
    prisma.document.findFirst.mockResolvedValue({
      id: 'document-a',
      estateId: null,
      s3Key: 'documents/community-a/f.pdf',
    });
    await expect(
      controller.download(DOC_ID, user, response),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.get).not.toHaveBeenCalled();
  });
  it('denies revoked membership before reading original bytes', async () => {
    const { prisma, storage, controller, response } = fixture();
    prisma.estate.findMany.mockResolvedValue([]);
    await expect(
      controller.download(DOC_ID, user, response),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.get).not.toHaveBeenCalled();
  });
  it('does not preserve staff bypass when the account is now a resident without document ACL', async () => {
    const { prisma, storage, controller, response } = fixture();
    prisma.document.findMany.mockResolvedValue([]);
    await expect(
      controller.download(DOC_ID, user, response),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.get).not.toHaveBeenCalled();
  });
  it('reads only after fresh document ACL and community-bound key validation', async () => {
    const { storage, controller, response } = fixture();
    await controller.download(DOC_ID, user, response);
    expect(storage.assertDocumentKey).toHaveBeenCalledWith(
      'documents/community-a/f.pdf',
      'community-a',
    );
    expect(storage.get).toHaveBeenCalledWith('documents/community-a/f.pdf');
  });
  it('records every download in the access log', async () => {
    const { audit, controller, response } = fixture();
    await controller.download(DOC_ID, user, response);
    expect(audit.logAccess).toHaveBeenCalledWith(
      user,
      'document',
      'download',
      'document-a',
      'Acta',
    );
  });
  it('a document without a stored type is served with the type of its file extension', async () => {
    const { controller, response } = fixture();
    await controller.download(DOC_ID, user, response);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
  });
  it('a file missing from storage answers 404 with a clear message, not a 500', async () => {
    const { storage, audit, controller, response } = fixture();
    storage.get.mockRejectedValue(
      Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }),
    );
    await expect(controller.download(DOC_ID, user, response)).rejects.toThrow(
      new NotFoundException('El fichero de este documento no está disponible.'),
    );
    expect(audit.logAccess).not.toHaveBeenCalled();
  });
  it('a missing document, one of another community and one the user cannot see answer exactly the same', async () => {
    const answer = async (setup: (f: ReturnType<typeof fixture>) => void) => {
      const f = fixture();
      setup(f);
      const error = await f.controller
        .download(DOC_ID, user, f.response)
        .catch((e: unknown) => e);
      expect(f.storage.get).not.toHaveBeenCalled();
      return {
        type: (error as object).constructor.name,
        status: (error as NotFoundException).getStatus(),
        body: (error as NotFoundException).getResponse(),
      };
    };
    const missing = await answer((f) =>
      f.prisma.document.findFirst.mockResolvedValue(null),
    );
    const otherCommunity = await answer((f) =>
      f.prisma.estate.findMany.mockResolvedValue([]),
    );
    const notVisible = await answer((f) =>
      f.prisma.document.findMany.mockResolvedValue([]),
    );
    expect(missing).toEqual({
      type: 'NotFoundException',
      status: 404,
      body: {
        message: 'Documento no encontrado.',
        error: 'Not Found',
        statusCode: 404,
      },
    });
    expect(otherCommunity).toEqual(missing);
    expect(notVisible).toEqual(missing);
  });
  it('a malformed document id is rejected with 400 before touching the database', async () => {
    const { prisma, controller, response } = fixture();
    await expect(controller.download('abc', user, response)).rejects.toThrow(
      new BadRequestException('Identificador de documento no válido.'),
    );
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
  });
  it('a generated document may only point at the file of its origin', async () => {
    const { prisma, storage, controller, response } = fixture();
    prisma.document.findFirst.mockResolvedValue({
      id: 'document-a',
      estateId: 'community-a',
      title: 'Acta',
      source: 'generated',
      sourceRef: 'meeting:11111111-1111-1111-1111-111111111111',
      s3Key: 'documents/other-estate/secret.pdf',
    });
    await expect(
      controller.download(DOC_ID, user, response),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.get).not.toHaveBeenCalled();
  });
  it('downloads are never cached: Cache-Control private, no-store (G11)', async () => {
    const { controller, response } = fixture();
    await controller.download(DOC_ID, user, response);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    );
  });
  it('the file name goes in Content-Disposition with an ASCII fallback and the RFC 5987 UTF-8 form (G12)', async () => {
    const { prisma, controller, response } = fixture();
    prisma.document.findFirst.mockResolvedValue({
      id: 'document-a',
      estateId: 'community-a',
      s3Key: 'documents/community-a/f.pdf',
      title: 'Acta "junta" año 2026.pdf',
      targetPropertyId: null,
    });
    await controller.download(DOC_ID, user, response);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename="Acta _junta_ ano 2026.pdf"; filename*=UTF-8''Acta%20%22junta%22%20a%C3%B1o%202026.pdf`,
    );
  });
  it('a title without extension downloads with the extension of the original file', async () => {
    const { prisma, controller, response } = fixture();
    prisma.document.findFirst.mockResolvedValue({
      id: 'document-a',
      estateId: 'community-a',
      s3Key: 'documents/community-a/uuid-poliza.pdf',
      title: 'Póliza (2026)',
      targetPropertyId: null,
    });
    await controller.download(DOC_ID, user, response);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename="Poliza (2026).pdf"; filename*=UTF-8''P%C3%B3liza%20%282026%29.pdf`,
    );
  });
  it('a preview is audited as view and a download as download; download is the default (G14)', async () => {
    const view = fixture();
    await view.controller.download(DOC_ID, user, view.response, 'view');
    expect(view.audit.logAccess).toHaveBeenCalledWith(
      user,
      'document',
      'view',
      'document-a',
      'Acta',
    );
    const explicit = fixture();
    await explicit.controller.download(
      DOC_ID,
      user,
      explicit.response,
      'download',
    );
    expect(explicit.audit.logAccess).toHaveBeenCalledWith(
      user,
      'document',
      'download',
      'document-a',
      'Acta',
    );
  });
  it('an unknown purpose is rejected with 400 before touching the database', async () => {
    const { prisma, controller, response } = fixture();
    await expect(
      controller.download(DOC_ID, user, response, 'print'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
  });
  it('a denied preview answers the same 404 and is not audited', async () => {
    const { prisma, audit, controller, response } = fixture();
    prisma.document.findMany.mockResolvedValue([]);
    await expect(
      controller.download(DOC_ID, user, response, 'view'),
    ).rejects.toThrow(new NotFoundException('Documento no encontrado.'));
    expect(audit.logAccess).not.toHaveBeenCalled();
  });
  it('denies uploads after staff role was revoked, despite a previous B token', async () => {
    const { prisma, storage, auth } = fixture();
    const library = new LibraryService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      auth,
      { notify: jest.fn() } as never,
    );
    await expect(
      library.upload(
        'community-a',
        {
          originalname: 'f.pdf',
          mimetype: 'application/pdf',
          size: 5,
          buffer: Buffer.from('bytes'),
        },
        {},
        user,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
  });
});
