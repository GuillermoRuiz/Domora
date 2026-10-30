import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { AuthService } from '../../../src/auth/auth.service';
import { DEMO_ACCOUNT_SPECS, DEMO_PASSWORD } from '../data/accounts';

/**
 * T1.4 — las cinco cuentas demo (superadmin@, gestora@, propietario@,
 * moroso@, nuevo@) hacen login con el AuthService REAL y la contraseña
 * pública del bundle demo, y el rol devuelto es el esperado. Si no, el seed
 * aborta: una demo cuyas cuentas del botón "Modo demo" no entran es una demo
 * rota.
 */
export async function verifyDemoAccounts(
  auth: AuthService,
  prisma: PrismaService,
): Promise<void> {
  for (const account of DEMO_ACCOUNT_SPECS) {
    const result = await auth.login(account.email, DEMO_PASSWORD);
    if (result.user.role !== account.role) {
      throw new Error(
        `F1: ${account.email} entra con rol ${result.user.role}, se esperaba ${account.role}.`,
      );
    }
    if (account.role === 'C' && result.user.estateIds.length === 0) {
      throw new Error(
        `F1: ${account.email} no tiene ninguna finca vinculada tras el seed.`,
      );
    }
    if (account.role === 'B' && result.user.estateIds.length === 0) {
      throw new Error(`F1: ${account.email} no gestiona ninguna finca.`);
    }
  }
  // El login de comprobación emite refresh tokens: no deben quedar sesiones
  // vivas en una BD recién sembrada.
  await prisma.refreshToken.deleteMany();
}
