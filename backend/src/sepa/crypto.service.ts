import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

const PREFIX = 'enc:v1:';

/**
 * Cifrado de IBAN en reposo a nivel de aplicación (decisión Fase 6:
 * AES-256-GCM frente a pgcrypto — la clave nunca toca la base de datos,
 * así que un dump/backup robado no expone IBANs).
 *
 * Formato almacenado: 'enc:v1:' + base64(iv[12] | authTag[16] | ciphertext).
 * `decrypt` acepta también valores en claro (sin prefijo) para tolerar
 * datos anteriores al cifrado — se re-cifran en la siguiente escritura.
 *
 * Clave: SEPA_ENC_KEY (64 hex chars = 32 bytes), obligatoria en producción
 * (la exige validateEnv al arrancar, y el constructor lo vuelve a comprobar).
 * Solo fuera de producción se deriva de JWT_SECRET con scrypt, avisando por
 * log: esa derivación usa una sal fija y pública, así que la clave
 * resultante es reproducible por cualquiera con acceso al código.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    const hexKey = configService.get<string>('SEPA_ENC_KEY');
    if (hexKey && /^[0-9a-fA-F]{64}$/.test(hexKey)) {
      this.key = Buffer.from(hexKey, 'hex');
      return;
    }

    // Segunda barrera: validateEnv ya exige SEPA_ENC_KEY en producción, así
    // que llegar aquí con NODE_ENV=production significa que la validación
    // se ha saltado o el ConfigModule está mal montado. Antes esto solo
    // emitía un warning y seguía adelante cifrando los IBAN con una clave
    // derivada de un secreto público — es decir, cifrado sin seguridad real.
    if (configService.get<string>('NODE_ENV') === 'production') {
      throw new Error(
        'SEPA_ENC_KEY ausente o inválida en producción. No se cifrarán IBAN con una clave derivada de JWT_SECRET; genera una con: openssl rand -hex 32',
      );
    }

    const secret = configService.getOrThrow<string>('JWT_SECRET');
    this.key = crypto.scryptSync(secret, 'domora-iban-at-rest', 32);
    this.logger.warn(
      'SEPA_ENC_KEY no configurada — derivando clave de JWT_SECRET (solo desarrollo).',
    );
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
  }

  decrypt(stored: string): string {
    if (!stored.startsWith(PREFIX)) {
      // Se sigue devolviendo el valor para no romper una lectura en
      // producción, pero deja de ser silencioso: un IBAN en claro es un dato
      // sensible sin proteger, y antes esta tolerancia —pensada para migrar—
      // no tenía forma de detectarse ni fecha de caducidad. Para corregirlo:
      // `npx ts-node scripts/encrypt-plaintext-ibans.ts`
      this.logger.error(
        'IBAN almacenado SIN CIFRAR. Ejecuta scripts/encrypt-plaintext-ibans.ts para corregirlo.',
      );
      return stored;
    }
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Últimos 4 caracteres en claro, para display sin descifrar en cliente. */
  maskIban(plainIban: string): string {
    const clean = plainIban.replace(/\s/g, '');
    return `${clean.slice(0, 4)} ···· ${clean.slice(-4)}`;
  }
}
