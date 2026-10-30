import { Logger } from '@nestjs/common';
import { isDemoDbName, isDemoMode, parseDbTarget } from './demo-mode';
import {
  SEPA_CREDITOR_ID_ENV,
  isValidSepaCreditorId,
  normalizeSepaCreditorId,
} from '../admin-billing/sepa-mandate';

/**
 * Validación de entorno que corre ANTES de que arranque la aplicación
 * (ConfigModule.forRoot({ validate })). Su motivo de existir: los secretos
 * tenían fallbacks silenciosos en el código (JWT_SECRET caía a una cadena
 * publicada en el repositorio, y SEPA_ENC_KEY derivaba de ella), de forma
 * que una variable mal inyectada no rompía el arranque — producía una
 * aplicación con tokens forjables e IBANs cifrados con una clave
 * reproducible por cualquiera que leyese el código.
 *
 * La regla ahora es explícita: en producción, si un secreto falta o es
 * débil, el proceso NO arranca. Los comentarios de "nunca usar esto en
 * producción" no son un control; esto sí.
 */

/** Solo para desarrollo local. Nunca debe llegar a producción. */
export const DEV_JWT_SECRET = 'dev-secret-change-me';

const MIN_JWT_SECRET_LENGTH = 32;
const SEPA_ENC_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Precio de Stripe por plan (BASE/STANDARD/PREMIUM) — igual que
 * ISSUER_KEYS, son secretos de configuración, no datos de negocio, así
 * que no viven en `plans.catalog.ts` junto al resto del catálogo.
 */
const STRIPE_PRICE_KEYS = [
  'STRIPE_PRICE_BASE',
  'STRIPE_PRICE_STANDARD',
  'STRIPE_PRICE_PREMIUM',
] as const;

/**
 * Identidad fiscal del emisor de las facturas que Domora gira a las gestoras.
 * Son datos de empresa, constantes, y por eso viven en configuración y no en
 * base de datos.
 *
 * Se exigen en producción porque una factura sin NIF del emisor es
 * legalmente defectuosa y NO se puede arreglar después: la numeración es
 * correlativa e inmutable, así que corregirla obliga a emitir una
 * rectificativa. Es preferible que un despliegue mal configurado no arranque
 * a que emita facturas inválidas — el mismo criterio que ya se aplica a los
 * secretos.
 */
const ISSUER_KEYS = [
  'INVOICE_ISSUER_NAME',
  'INVOICE_ISSUER_TAX_ID',
  'INVOICE_ISSUER_ADDRESS',
] as const;

/** Valores de desarrollo, evidentemente falsos para que nadie los confunda con los reales. */
const DEV_ISSUER: Record<(typeof ISSUER_KEYS)[number], string> = {
  INVOICE_ISSUER_NAME: 'Domora Desarrollo S.L.',
  INVOICE_ISSUER_TAX_ID: 'B00000000',
  INVOICE_ISSUER_ADDRESS: 'Dirección de desarrollo, sin validez fiscal',
};

/**
 * Claves de servicios externos que NO pueden existir en el entorno demo:
 * garantiza "cero llamadas externas" por construcción, no por convención.
 */
export const DEMO_FORBIDDEN_KEYS = [
  'STRIPE_SECRET_KEY',
  'OPENAI_API_KEY',
  'SMTP_HOST',
  'VAPID_PRIVATE_KEY',
  'RAG_API_URL',
  'RAG_INTERNAL_KEY',
  'RAG_INGESTION_API_URL',
  'RAG_INGESTION_INTERNAL_KEY',
] as const;

/**
 * Claves que DEMO_MODE rechaza solo cuando valen exactamente `true`.
 * Fuente única compartida con el CLI del seed demo (descarte del .env).
 */
export const DEMO_FORBIDDEN_TRUE_FLAGS = ['VERIFACTU_ENABLED'] as const;

/**
 * Reglas exclusivas de DEMO_MODE=true. Solo se invoca con DEMO_MODE activo;
 * sin él, validateEnv se comporta exactamente como antes.
 */
function validateDemoMode(
  config: Record<string, unknown>,
  isProduction: boolean,
): void {
  const errors: string[] = [];

  for (const key of DEMO_FORBIDDEN_KEYS) {
    if (read(config, key)) {
      errors.push(
        `${key} no puede estar definida con DEMO_MODE=true: el entorno demo no hace llamadas externas.`,
      );
    }
  }
  for (const key of DEMO_FORBIDDEN_TRUE_FLAGS) {
    if (read(config, key) === 'true') {
      errors.push(
        `${key}=true no es compatible con DEMO_MODE=true: el entorno demo no remite a la AEAT.`,
      );
    }
  }

  // El reverso del guard del seed: nadie arranca producción con DEMO_MODE.
  if (isProduction) {
    const target = parseDbTarget(read(config, 'DATABASE_URL'));
    if (!target || !isDemoDbName(target.name)) {
      errors.push(
        `DEMO_MODE=true con NODE_ENV=production exige una BD demo (nombre con "demo" y distinto de "domora"); recibida: "${target?.name ?? 'ininterpretable'}".`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuración DEMO_MODE inválida — el arranque se aborta a propósito:\n` +
        errors.map((e) => `  · ${e}`).join('\n'),
    );
  }

  // Sin consultas al Catastro (servicio externo).
  config['CATASTRO_ENABLED'] = 'false';
  config['GEOCODING_ENABLED'] = 'false';
}

function read(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const logger = new Logger('EnvValidation');
  const isProduction = read(config, 'NODE_ENV') === 'production';
  // DEMO_MODE relaja SOLO Stripe e INVOICE_ISSUER_*; JWT_SECRET, SEPA_ENC_KEY
  // y DATABASE_URL siguen siendo estrictos. Validar antes de configurar RAG.
  const demo = isDemoMode(config);
  if (demo) {
    validateDemoMode(config, isProduction);
  }
  for (const [urlName, keyName] of [
    ['RAG_API_URL', 'RAG_INTERNAL_KEY'],
    ['RAG_INGESTION_API_URL', 'RAG_INGESTION_INTERNAL_KEY'],
  ]) {
    const endpoint = read(config, urlName);
    if (!endpoint) continue;
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error(`${urlName}: invalid private service URL`);
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (isProduction && url.protocol !== 'https:')
    )
      throw new Error(`${urlName}: invalid private service URL`);
    if (read(config, keyName).length < 32)
      throw new Error(`${keyName}: at least 32 characters required`);
  }
  if (
    read(config, 'RAG_INGESTION_API_URL') &&
    read(config, 'RAG_INTERNAL_KEY') ===
      read(config, 'RAG_INGESTION_INTERNAL_KEY')
  ) {
    throw new Error('RAG query and ingestion signing keys must be different');
  }

  // Domora's SEPA creditor identifier: optional everywhere (no despacho pays
  // by direct debit yet; without it domiciliación simply cannot be chosen),
  // but a wrong one would end up printed on every signed mandate, so a value
  // with bad check digits stops the boot in any environment.
  const creditorId = read(config, SEPA_CREDITOR_ID_ENV);
  if (creditorId) {
    if (!isValidSepaCreditorId(creditorId)) {
      throw new Error(
        `${SEPA_CREDITOR_ID_ENV} no es un identificador de acreedor SEPA válido (revisa los dígitos de control; formato ESnnZZZ + NIF).`,
      );
    }
    config[SEPA_CREDITOR_ID_ENV] = normalizeSepaCreditorId(creditorId);
  } else {
    logger.warn(
      `${SEPA_CREDITOR_ID_ENV} no configurada — los despachos no podrán elegir el pago por domiciliación.`,
    );
  }

  const jwtSecret = read(config, 'JWT_SECRET');
  const sepaEncKey = read(config, 'SEPA_ENC_KEY');
  const databaseUrl = read(config, 'DATABASE_URL');
  const stripeSecretKey = read(config, 'STRIPE_SECRET_KEY');
  const stripeWebhookSecret = read(config, 'STRIPE_WEBHOOK_SECRET');

  if (isProduction) {
    const errors: string[] = [];

    if (!jwtSecret) {
      errors.push('JWT_SECRET es obligatoria en producción.');
    } else if (jwtSecret === DEV_JWT_SECRET) {
      errors.push(
        'JWT_SECRET tiene el valor de desarrollo, que está publicado en el repositorio: cualquiera podría firmar tokens válidos.',
      );
    } else if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
      errors.push(
        `JWT_SECRET debe tener al menos ${MIN_JWT_SECRET_LENGTH} caracteres (recibidos: ${jwtSecret.length}).`,
      );
    }

    if (!sepaEncKey) {
      errors.push(
        'SEPA_ENC_KEY es obligatoria en producción (64 caracteres hex = 32 bytes). Sin ella, la clave de cifrado de IBANs se derivaría de JWT_SECRET con una sal fija y pública.',
      );
    } else if (!SEPA_ENC_KEY_PATTERN.test(sepaEncKey)) {
      errors.push(
        'SEPA_ENC_KEY debe ser exactamente 64 caracteres hexadecimales (32 bytes). Genérala con: openssl rand -hex 32',
      );
    }

    if (!databaseUrl) {
      errors.push('DATABASE_URL es obligatoria.');
    }

    for (const key of ISSUER_KEYS) {
      if (demo) {
        if (!read(config, key)) config[key] = DEV_ISSUER[key];
        continue;
      }
      const value = read(config, key);
      if (!value) {
        errors.push(
          `${key} es obligatoria en producción: una factura sin los datos fiscales del emisor es inválida y solo se corrige emitiendo una rectificativa.`,
        );
      } else if (value === DEV_ISSUER[key]) {
        errors.push(
          `${key} conserva el valor de desarrollo, que no tiene validez fiscal.`,
        );
      }
    }

    // Sin esto no es un fallo con síntoma visible: el checkout/portal
    // devolverían un 500 al primer clic (aceptable, se ve), pero el
    // webhook fallaría en silencio si STRIPE_WEBHOOK_SECRET falta —
    // Stripe reintenta unas horas y luego deja de intentarlo, y las
    // facturas fiscales de ese periodo nunca se generarían.
    if (!demo && !stripeSecretKey) {
      errors.push(
        'STRIPE_SECRET_KEY es obligatoria en producción: sin ella no se puede cobrar ninguna suscripción.',
      );
    }
    if (!demo && !stripeWebhookSecret) {
      errors.push(
        'STRIPE_WEBHOOK_SECRET es obligatoria en producción: sin ella el webhook no puede verificar que los eventos vienen realmente de Stripe.',
      );
    }
    for (const key of STRIPE_PRICE_KEYS) {
      if (!demo && !read(config, key)) {
        errors.push(
          `${key} es obligatoria en producción: sin ella no se puede crear una sesión de checkout para ese plan.`,
        );
      }
    }

    // El peor fallo posible de Verifactu no es un error: es un éxito
    // aparente. Un sistema en producción apuntando a preproducción emite
    // facturas, recibe respuestas correctas y no registra NADA ante la
    // Agencia. Todo parece funcionar hasta que llega una inspección. Por eso
    // esta combinación aborta el arranque en lugar de avisar.
    if (
      read(config, 'VERIFACTU_ENABLED') === 'true' &&
      read(config, 'VERIFACTU_ENV') !== 'produccion'
    ) {
      errors.push(
        'VERIFACTU_ENABLED=true con VERIFACTU_ENV distinto de "produccion": se estaría remitiendo a preproducción, que no tiene ningún efecto fiscal, y sin ningún síntoma visible.',
      );
    }

    if (errors.length > 0) {
      throw new Error(
        `Configuración de producción inválida — el arranque se aborta a propósito:\n` +
          errors.map((e) => `  · ${e}`).join('\n'),
      );
    }

    return config;
  }

  // ── Fuera de producción ────────────────────────────────────────────────
  // Se permiten los valores por defecto para no entorpecer el desarrollo,
  // pero se avisa de forma inequívoca: si estas líneas aparecen en un log
  // de producción, es que NODE_ENV no está puesto y la aplicación está
  // corriendo con secretos conocidos.
  if (!jwtSecret) {
    config['JWT_SECRET'] = DEV_JWT_SECRET;
    logger.warn(
      `JWT_SECRET no configurada — usando el valor de desarrollo. NUNCA debe verse esto con NODE_ENV=production.`,
    );
  }
  if (!sepaEncKey) {
    logger.warn(
      'SEPA_ENC_KEY no configurada — la clave de cifrado de IBANs se derivará de JWT_SECRET (solo desarrollo).',
    );
  }
  // Sin fallback fabricado a propósito: una STRIPE_SECRET_KEY falsa no
  // sirve para nada (Stripe la rechaza en la primera llamada), a
  // diferencia de JWT_SECRET, que sí puede tener un valor de desarrollo
  // funcional. StripeService/BillingController degradan explícitamente
  // (mismo patrón que MailService sin SMTP_HOST) en vez de fallar en
  // silencio.
  if (!stripeSecretKey) {
    logger.warn(
      'STRIPE_SECRET_KEY no configurada — los endpoints de facturación (checkout, portal, webhook) devolverán error hasta que se configure.',
    );
  }
  if (!stripeWebhookSecret) {
    logger.warn(
      'STRIPE_WEBHOOK_SECRET no configurada — el webhook de Stripe rechazará todos los eventos entrantes hasta que se configure.',
    );
  }
  for (const key of STRIPE_PRICE_KEYS) {
    if (!read(config, key)) {
      logger.warn(
        `${key} no configurada — el checkout de ese plan fallará hasta que se configure.`,
      );
    }
  }

  for (const key of ISSUER_KEYS) {
    if (!read(config, key)) {
      config[key] = DEV_ISSUER[key];
    }
  }

  // Fuera de producción sí se permite remitir (es como se valida contra
  // preproducción), pero sin certificado no hay forma de autenticarse y el
  // fallo aparecería en el primer envío, no aquí.
  if (
    read(config, 'VERIFACTU_ENABLED') === 'true' &&
    !read(config, 'VERIFACTU_CERT_PATH')
  ) {
    throw new Error(
      'VERIFACTU_ENABLED=true pero falta VERIFACTU_CERT_PATH: la remisión a la AEAT se autentica exclusivamente con el certificado.',
    );
  }

  return config;
}
