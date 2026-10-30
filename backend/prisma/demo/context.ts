import type { INestApplicationContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../../src/auth/auth.types';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { type Clock, createClock, resolveAnchor } from './clock';
import { createRng, DEMO_SEED, type Rng } from './lib/rng';

/** Parte determinista del contexto: no necesita Nest ni BD. */
export interface DemoBaseCtx {
  now: Date;
  clock: Clock;
  rng: Rng;
}

/** Unidad sembrada por F1 (lo que F2+ necesita para colgar datos de ella). */
export interface DemoUnitRef {
  propertyId: string;
  ref: string;
  kind: 'Piso' | 'Parking' | 'Local';
  /** Coeficiente de participación (%, 2 decimales). */
  coefficient: number;
  /** Cuota ordinaria mensual (céntimos); Σ por finca == presupuesto mensual. */
  quotaMonthlyCents: number;
  /** Titular principal con cuenta (rol C). null si el titular es externo. */
  ownerUserId: string | null;
  /** Titular externo sin cuenta (empresa) o null. */
  externalOwnerId: string | null;
  /** Mandato SEPA activo (solo fincas con remesas y titular con cuenta). */
  mandateId: string | null;
}

export interface DemoEstateRef {
  id: string;
  key: 'val' | 'mad' | 'valb';
  name: string;
  propertyIds: string[];
  ownerIds: string[];
  /** Presupuesto ordinario mensual (céntimos). */
  monthlyBudgetCents: number;
  /** Cuenta bancaria por defecto de la comunidad. */
  bankAccountId: string | null;
  units: DemoUnitRef[];
}

/** Cuentas nombradas del demo y las propiedades que F2+ debe usar. */
export interface DemoNamedUser {
  userId: string;
  estateIds: string[];
  propertyIds: string[];
}

/** Contexto completo que reciben las fases (design D2). */
export interface DemoCtx extends DemoBaseCtx {
  app: INestApplicationContext;
  prisma: PrismaService;
  actors: { superadmin: AuthenticatedUser; gestora: AuthenticatedUser };
  estates: DemoEstateRef[];
  /** propietario@ / moroso@ / nuevo@ (los rellena F1). */
  named: Partial<Record<'propietario' | 'moroso' | 'nuevo', DemoNamedUser>>;
}

export type Phase = (ctx: DemoCtx) => Promise<void>;

export function createBaseContext(
  env: NodeJS.ProcessEnv = process.env,
  realNow: Date = new Date(),
  seed: number = DEMO_SEED,
): DemoBaseCtx {
  const anchor = resolveAnchor(env, realNow);
  return { now: anchor, clock: createClock(anchor), rng: createRng(seed) };
}
