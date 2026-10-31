import { BadRequestException, Injectable } from '@nestjs/common';
import { generateSecret, verify, generateURI } from 'otplib';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const BACKUP_CODE_HASH_ROUNDS = 10; // mismo coste que auth.service.ts para el password
const BACKUP_CODE_COUNT = 10;

function generateBackupCode(): string {
  // 8 dígitos en dos grupos, fáciles de transcribir a mano — mismo criterio
  // de "escrito simple" que ya se aplicó a la delegación de voto: no hace
  // falta más ceremonia que la necesaria.
  const raw = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, '0');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * 2FA opcional por TOTP (RFC 6238) — Fase 2.3. Nunca obligatorio
 * globalmente: cada usuario lo activa o no sobre su propia cuenta desde
 * Ajustes; la gestora puede EXIGIRLO solo para votar en una junta concreta
 * (`Meeting.require2faForVoting`, consultado desde `VoteSessionsService`).
 *
 * El secreto viaja al frontend en `generateEnrollment()` y vuelve en
 * `verifyAndEnable()` (no se persiste hasta que el código introducido lo
 * confirma) — evita dejar un secreto a medio activar en la base de datos
 * si el usuario nunca completa el enrolamiento.
 */
@Injectable()
export class TwoFactorService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string): Promise<{ enabled: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpEnabled: true },
    });
    return { enabled: user.totpEnabled };
  }

  async generateEnrollment(
    userId: string,
  ): Promise<{ secret: string; qrDataUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    const secret = generateSecret();
    const otpauthUri = generateURI({
      issuer: 'Domora',
      label: user.email,
      secret,
    });
    const qrDataUrl = await QRCode.toDataURL(otpauthUri);
    return { secret, qrDataUrl };
  }

  async verifyAndEnable(
    userId: string,
    secret: string,
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    const result = await verify({ secret, token: code });
    if (!result.valid) {
      throw new BadRequestException(
        'Código incorrecto — comprueba la hora del teléfono y vuelve a intentarlo.',
      );
    }

    const backupCodes = Array.from(
      { length: BACKUP_CODE_COUNT },
      generateBackupCode,
    );
    const hashed = await Promise.all(
      backupCodes.map((c) => bcrypt.hash(c, BACKUP_CODE_HASH_ROUNDS)),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { totpSecret: secret, totpEnabled: true },
      });
      await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
      await tx.twoFactorBackupCode.createMany({
        data: hashed.map((codeHash) => ({ userId, codeHash })),
      });
    });

    return { backupCodes };
  }

  async disable(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { totpSecret: null, totpEnabled: false },
      }),
      this.prisma.twoFactorBackupCode.deleteMany({ where: { userId } }),
    ]);
  }

  async regenerateBackupCodes(
    userId: string,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { totpEnabled: true },
    });
    if (!user.totpEnabled) {
      throw new BadRequestException(
        'Activa el 2FA antes de generar códigos de respaldo.',
      );
    }
    const backupCodes = Array.from(
      { length: BACKUP_CODE_COUNT },
      generateBackupCode,
    );
    const hashed = await Promise.all(
      backupCodes.map((c) => bcrypt.hash(c, BACKUP_CODE_HASH_ROUNDS)),
    );
    await this.prisma.$transaction([
      this.prisma.twoFactorBackupCode.deleteMany({ where: { userId } }),
      this.prisma.twoFactorBackupCode.createMany({
        data: hashed.map((codeHash) => ({ userId, codeHash })),
      }),
    ]);
    return { backupCodes };
  }

  /** TOTP válido O un código de respaldo no usado — usado por `VoteSessionsService.castVote()` cuando la junta lo exige. */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true, totpEnabled: true },
    });
    if (!user?.totpEnabled || !user.totpSecret) return false;

    // otplib exige exactamente 6 dígitos y lanza si el token no cumple el
    // formato — un código de respaldo ("XXXX-XXXX", 9 caracteres) rompería
    // esta rama sin llegar nunca a probarse como código de respaldo. Se
    // intenta como TOTP solo si tiene pinta de serlo.
    if (/^\d{6}$/.test(code)) {
      const result = await verify({ secret: user.totpSecret, token: code });
      if (result.valid) return true;
    }

    const candidates = await this.prisma.twoFactorBackupCode.findMany({
      where: { userId, usedAt: null },
    });
    for (const candidate of candidates) {
      if (await bcrypt.compare(code, candidate.codeHash)) {
        // Guarda condicional (igual criterio que MeetingsService.updateStatus)
        // contra dos verificaciones concurrentes consumiendo el mismo código.
        const { count } = await this.prisma.twoFactorBackupCode.updateMany({
          where: { id: candidate.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (count > 0) return true;
      }
    }
    return false;
  }
}
