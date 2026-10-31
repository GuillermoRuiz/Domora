import { generate } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { TwoFactorService } from './two-factor.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Fase 2.3 ("2FA opcional") — integración contra Postgres real, mismo
 * patrón que `meeting-quorum.service.spec.ts`: el hasheo de códigos de
 * respaldo y la persistencia condicionada al código correcto son
 * exactamente el tipo de lógica que un mock no verifica de verdad.
 */
const prisma = createPrismaClient();

// Cada test hashea 10 códigos de respaldo con bcrypt (CPU pura): ~2s aislado,
// pero con la suite completa en paralelo supera los 5s por defecto de Jest.
jest.setTimeout(30_000);

let userId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `2fa-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Test User',
      role: 'C',
    },
  });
  userId = user.id;
});

afterEach(async () => {
  await prisma.twoFactorBackupCode.deleteMany({ where: { userId } });
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: null, totpEnabled: false },
  });
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('TwoFactorService', () => {
  const service = new TwoFactorService(prisma as unknown as PrismaService);

  it('status refleja si el 2FA está activo', async () => {
    await expect(service.status(userId)).resolves.toEqual({ enabled: false });
    const { secret } = await service.generateEnrollment(userId);
    const token = await generate({ secret });
    await service.verifyAndEnable(userId, secret, token);
    await expect(service.status(userId)).resolves.toEqual({ enabled: true });
  });

  it('generateEnrollment devuelve un secreto y un QR sin persistir nada todavía', async () => {
    const { secret, qrDataUrl } = await service.generateEnrollment(userId);

    expect(secret.length).toBeGreaterThan(10);
    expect(qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.totpSecret).toBeNull();
    expect(user.totpEnabled).toBe(false);
  });

  it('verifyAndEnable con código incorrecto NO deja el secreto a medio activar', async () => {
    const { secret } = await service.generateEnrollment(userId);

    await expect(
      service.verifyAndEnable(userId, secret, '000000'),
    ).rejects.toThrow();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.totpSecret).toBeNull();
    expect(user.totpEnabled).toBe(false);
  });

  it('verifyAndEnable con código correcto activa el 2FA y devuelve 10 códigos de respaldo', async () => {
    const { secret } = await service.generateEnrollment(userId);
    const token = await generate({ secret });

    const { backupCodes } = await service.verifyAndEnable(
      userId,
      secret,
      token,
    );

    expect(backupCodes).toHaveLength(10);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.totpEnabled).toBe(true);
    expect(user.totpSecret).toBe(secret);
    const stored = await prisma.twoFactorBackupCode.findMany({
      where: { userId },
    });
    expect(stored).toHaveLength(10);
    // Los códigos se guardan hasheados, nunca en claro.
    expect(stored.every((c) => c.codeHash !== backupCodes[0])).toBe(true);
  });

  it('verifyCode acepta un TOTP válido', async () => {
    const { secret } = await service.generateEnrollment(userId);
    const token = await generate({ secret });
    await service.verifyAndEnable(userId, secret, token);

    // El mismo período — genera un token nuevo por si el reloj avanzó de período entre medio.
    const freshToken = await generate({ secret });
    await expect(service.verifyCode(userId, freshToken)).resolves.toBe(true);
  });

  it('verifyCode rechaza un TOTP incorrecto', async () => {
    const { secret } = await service.generateEnrollment(userId);
    const token = await generate({ secret });
    await service.verifyAndEnable(userId, secret, token);

    await expect(service.verifyCode(userId, '000000')).resolves.toBe(false);
  });

  it('verifyCode acepta un código de respaldo, y lo consume — no sirve una segunda vez', async () => {
    const { secret } = await service.generateEnrollment(userId);
    const token = await generate({ secret });
    const { backupCodes } = await service.verifyAndEnable(
      userId,
      secret,
      token,
    );

    await expect(service.verifyCode(userId, backupCodes[0])).resolves.toBe(
      true,
    );
    await expect(service.verifyCode(userId, backupCodes[0])).resolves.toBe(
      false,
    );
  });

  it('verifyCode rechaza si la cuenta no tiene 2FA activado', async () => {
    await expect(service.verifyCode(userId, '123456')).resolves.toBe(false);
  });

  it('disable limpia el secreto y los códigos de respaldo', async () => {
    const { secret } = await service.generateEnrollment(userId);
    const token = await generate({ secret });
    await service.verifyAndEnable(userId, secret, token);

    await service.disable(userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.totpEnabled).toBe(false);
    expect(user.totpSecret).toBeNull();
    const stored = await prisma.twoFactorBackupCode.findMany({
      where: { userId },
    });
    expect(stored).toHaveLength(0);
  });

  it('regenerateBackupCodes reemplaza los códigos anteriores, que dejan de servir', async () => {
    const { secret } = await service.generateEnrollment(userId);
    const token = await generate({ secret });
    const { backupCodes: oldCodes } = await service.verifyAndEnable(
      userId,
      secret,
      token,
    );

    const { backupCodes: newCodes } =
      await service.regenerateBackupCodes(userId);

    expect(newCodes).toHaveLength(10);
    await expect(service.verifyCode(userId, oldCodes[0])).resolves.toBe(false);
    await expect(service.verifyCode(userId, newCodes[0])).resolves.toBe(true);
  });
});
