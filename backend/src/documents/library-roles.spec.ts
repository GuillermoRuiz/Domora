import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';
import { LibraryController } from './library.controller';
import { OwnerDocumentsController } from './owner-documents.controller';
import { EstateDocumentsController } from '../resources/resources.controller';
import { DocumentFilesController } from '../files/files.controller';

/**
 * G6 (odd/tasks/owner-documents.md): an owner (role C) can read the library but never upload,
 * edit, delete, move, restore or reclassify documents or folders. Checked with the real
 * `RolesGuard` and the real decorator metadata of each route.
 */
type Handler = (...args: never[]) => unknown;
const guard = new RolesGuard(new Reflector());

function allows(cls: { prototype: object }, method: string, role: AppRole): boolean {
  const handler = (cls.prototype as Record<string, Handler>)[method];
  const user: AuthenticatedUser = { id: 'u1', role, estateIds: ['e1'], administratorId: role === 'C' ? null : 'adm' };
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
  return guard.canActivate(context);
}

const routeOf = (cls: { prototype: object }, method: string) => {
  const handler = (cls.prototype as Record<string, Handler>)[method];
  const path = [Reflect.getMetadata(PATH_METADATA, cls) as string, Reflect.getMetadata(PATH_METADATA, handler) as string]
    .map((part) => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
  return `${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number]} ${path}`;
};

describe('Mutating document routes answer 403 to an owner (G6)', () => {
  const MUTATING: [{ prototype: object }, string, string][] = [
    [LibraryController, 'upload', 'POST estates/:estateId/documents/upload'],
    [LibraryController, 'createFolder', 'POST estates/:estateId/library/folders'],
    [LibraryController, 'updateFolder', 'PATCH estates/:estateId/library/folders/:folderId'],
    [LibraryController, 'deleteFolder', 'DELETE estates/:estateId/library/folders/:folderId'],
    [LibraryController, 'updateDocument', 'PATCH estates/:estateId/library/documents/:documentId'],
    [LibraryController, 'trash', 'DELETE estates/:estateId/library/documents/:documentId'],
    [LibraryController, 'restore', 'POST estates/:estateId/library/documents/:documentId/restore'],
    [LibraryController, 'review', 'POST estates/:estateId/library/review'],
    [EstateDocumentsController, 'create', 'POST estates/:estateId/documents'],
  ];

  it.each(MUTATING)('%p.%s (%s) rejects role C and admits the manager', (cls, method, route) => {
    expect(routeOf(cls, method)).toBe(route);
    expect(allows(cls, method, 'C')).toBe(false);
    expect(allows(cls, method, 'B')).toBe(true);
    expect(allows(cls, method, 'A')).toBe(true);
  });

  it('every mutating route of the library controller is in the list above', () => {
    const handlers = Object.getOwnPropertyNames(LibraryController.prototype).filter((name) => {
      const handler = (LibraryController.prototype as unknown as Record<string, Handler>)[name];
      return typeof handler === 'function' && Reflect.getMetadata(METHOD_METADATA, handler) !== undefined
        && Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.GET;
    });
    expect(handlers.sort()).toEqual(MUTATING.filter(([cls]) => cls === LibraryController).map(([, m]) => m).sort());
  });

  it('the document file controller has no mutating route', () => {
    const verbs = Object.getOwnPropertyNames(DocumentFilesController.prototype)
      .map((name) => (DocumentFilesController.prototype as unknown as Record<string, Handler>)[name])
      .filter((handler) => typeof handler === 'function' && Reflect.getMetadata(METHOD_METADATA, handler) !== undefined)
      .map((handler) => Reflect.getMetadata(METHOD_METADATA, handler) as number);
    expect(verbs).toEqual([RequestMethod.GET]);
  });

  it('owners still read the library (existing behaviour)', () => {
    expect(allows(LibraryController, 'list', 'C')).toBe(true);
    expect(allows(LibraryController, 'list', 'B')).toBe(true);
  });

  it('«Mis documentos» is for owners only', () => {
    for (const method of ['list', 'markRead']) {
      expect(allows(OwnerDocumentsController, method, 'C')).toBe(true);
      expect(allows(OwnerDocumentsController, method, 'B')).toBe(false);
      expect(allows(OwnerDocumentsController, method, 'A')).toBe(false);
    }
    expect(routeOf(OwnerDocumentsController, 'list')).toBe('GET me/documents');
    expect(routeOf(OwnerDocumentsController, 'markRead')).toBe('POST me/documents/read');
  });
});
