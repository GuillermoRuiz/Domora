import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AppRole } from '../auth/auth.types';
import {
  EstateAccountingController,
  EstateReceiptsController,
} from '../accounting/accounting.controller';

/**
 * `RolesGuard` deja pasar a CUALQUIER rol autenticado si el handler no tiene
 * `@Roles` (ver roles.guard.ts). En los módulos que tocan dinero eso no
 * puede pasar por olvido: esta spec recorre sus controladores y falla si
 * algún endpoint no declara roles (o `@Public`) de forma explícita.
 */
const MONEY_MODULES = [
  'ledger',
  'accounting',
  'sepa',
  'suppliers',
  'debtors',
  // Contabilizan o leen el diario desde fuera de ledger/.
  'imports',
  'cost-centres',
  'staff',
];

type Ctor = { name: string; prototype: Record<string, unknown> };

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return controllerFiles(p);
    return p.endsWith('.controller.ts') ? [p] : [];
  });
}

function handlersWithoutRoles(): string[] {
  const missing: string[] = [];
  for (const module of MONEY_MODULES) {
    for (const file of controllerFiles(join(__dirname, '..', module))) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const exports = require(file) as Record<string, unknown>;
      for (const value of Object.values(exports)) {
        if (
          typeof value !== 'function' ||
          Reflect.getMetadata(PATH_METADATA, value) === undefined
        )
          continue;
        const controller = value as unknown as Ctor;
        const classRoles = Reflect.getMetadata(
          ROLES_KEY,
          controller,
        ) as unknown;
        const classPublic = Reflect.getMetadata(
          IS_PUBLIC_KEY,
          controller,
        ) as unknown;
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = controller.prototype[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined)
            continue;
          const roles =
            (Reflect.getMetadata(ROLES_KEY, handler) as unknown) ?? classRoles;
          const isPublic =
            (Reflect.getMetadata(IS_PUBLIC_KEY, handler) as unknown) ??
            classPublic;
          if (!roles && !isPublic)
            missing.push(`${module}: ${controller.name}.${name}`);
        }
      }
    }
  }
  return missing;
}

describe('Módulos de dinero — todo endpoint declara sus roles', () => {
  it('ningún handler de ledger, accounting, sepa, suppliers, debtors ni movements queda sin @Roles', () => {
    expect(handlersWithoutRoles()).toEqual([]);
  });
});

function contextFor(
  role: AppRole,
  controller: object,
  handler: (...args: never[]) => unknown,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: 'u1', role, estateIds: ['e1'], administratorId: null },
      }),
    }),
  } as unknown as ExecutionContext;
}

function allowed(
  role: AppRole,
  controller: object,
  handler: (...args: never[]) => unknown,
): boolean {
  const guard = new RolesGuard(new Reflector());
  try {
    return guard.canActivate(contextFor(role, controller, handler));
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    return false;
  }
}

describe('Regresión de privacidad — un vecino no ve las cuentas de la finca', () => {
  // Antes estos endpoints no tenían @Roles: cualquier propietario con acceso
  // a la finca veía nombre, NIF y deuda de todos los vecinos.
  // Los métodos se pasan sin llamarlos: el guard solo lee su metadata.
  /* eslint-disable @typescript-eslint/unbound-method */
  const HANDLERS = [
    [
      'GET /estates/:estateId/receipts',
      EstateReceiptsController,
      EstateReceiptsController.prototype.list,
    ],
    [
      'GET /estates/:estateId/accounting/summary',
      EstateAccountingController,
      EstateAccountingController.prototype.summary,
    ],
    [
      'GET /estates/:estateId/accounting/periods',
      EstateAccountingController,
      EstateAccountingController.prototype.listPeriods,
    ],
  ] as const;
  /* eslint-enable @typescript-eslint/unbound-method */

  it.each(HANDLERS)(
    '%s rechaza al rol C y deja pasar a A y B',
    (_label, controller, handler) => {
      expect(allowed('C', controller, handler)).toBe(false);
      expect(allowed('B', controller, handler)).toBe(true);
      expect(allowed('A', controller, handler)).toBe(true);
    },
  );
});
