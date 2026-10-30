import * as bcrypt from 'bcryptjs';
import { AdminsService } from '../../../src/admins/admins.service';
import type { AuthenticatedUser } from '../../../src/auth/auth.types';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { accountSpec, DEMO_PASSWORD } from '../data/accounts';
import { GESTORA } from '../data/estates';
import { makeCif } from '../lib/nif';
import type { Rng } from '../lib/rng';
import type { INestApplicationContext } from '@nestjs/common';

// La contraseña y los emails viven en data/accounts.ts (fuente única, T1.4).
export { DEMO_PASSWORD };
export const SUPERADMIN_EMAIL = accountSpec('superadmin').email;
export const GESTORA_EMAIL = accountSpec('gestora').email;

export interface BootstrapActors {
  superadmin: AuthenticatedUser;
  gestora: AuthenticatedUser;
}

/**
 * Base del universo (F0/F1): lo mínimo para tener un universo con sentido y para que el
 * guard (capa 4) reconozca la BD como demo por dos vías (marcador y usuarios
 * *@demo.domora.app). Superadmin (A) + una gestora creada por el servicio
 * REAL (AdminsService.create) + su usuario B. F1-F5 sustituirán esto.
 */
export async function runF0Bootstrap(
  app: INestApplicationContext,
  prisma: PrismaService,
  rng: Rng,
): Promise<BootstrapActors> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const superadminUser = await prisma.user.create({
    data: {
      email: SUPERADMIN_EMAIL,
      passwordHash,
      fullName: accountSpec('superadmin').fullName,
      role: 'A',
    },
  });
  const superadmin: AuthenticatedUser = {
    id: superadminUser.id,
    role: 'A',
    estateIds: [],
    administratorId: null,
  };

  const admins = app.get(AdminsService, { strict: false });
  const administrator = await admins.create(
    {
      name: GESTORA.name,
      cif: makeCif(rng, 'B'),
      plan: 'STANDARD',
      contactName: accountSpec('gestora').fullName,
      contactEmail: GESTORA_EMAIL,
      phone: GESTORA.phone,
    },
    superadmin,
  );

  const gestoraUser = await prisma.user.create({
    data: {
      email: GESTORA_EMAIL,
      passwordHash,
      fullName: accountSpec('gestora').fullName,
      role: 'B',
      administratorId: administrator.id,
    },
  });
  // Titular de la cuenta de la gestora (lo fija el canje de la invitación de
  // alta en la app real; ningún servicio lo expone para un alta directa).
  await prisma.administrator.update({
    where: { id: administrator.id },
    data: { primaryUserId: gestoraUser.id },
  });

  return {
    superadmin,
    gestora: {
      id: gestoraUser.id,
      role: 'B',
      estateIds: [],
      administratorId: administrator.id,
    },
  };
}
