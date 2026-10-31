import { DEV_JWT_SECRET, validateEnv } from './env.validation';

/**
 * Estos tests fijan una decisión de seguridad, no un detalle de
 * implementación: en producción, un secreto ausente o débil debe IMPEDIR el
 * arranque. Antes existía un fallback silencioso a una cadena publicada en
 * el repositorio, así que un despliegue mal configurado no fallaba: quedaba
 * abierto (tokens forjables e IBAN cifrados con clave reproducible).
 */
describe('validateEnv', () => {
  const validProd = {
    NODE_ENV: 'production',
    JWT_SECRET: 'x'.repeat(40),
    SEPA_ENC_KEY: 'a'.repeat(64),
    DATABASE_URL: 'postgresql://user:pass@host:5432/db',
    INVOICE_ISSUER_NAME: 'Domora S.L.',
    INVOICE_ISSUER_TAX_ID: 'B12345678',
    INVOICE_ISSUER_ADDRESS: 'Calle Real 1, Madrid',
    STRIPE_SECRET_KEY: 'sk_live_x'.repeat(4),
    STRIPE_WEBHOOK_SECRET: 'whsec_x'.repeat(4),
    STRIPE_PRICE_BASE: 'price_base',
    STRIPE_PRICE_STANDARD: 'price_standard',
    STRIPE_PRICE_PREMIUM: 'price_premium',
  };

  /** Configuración válida menos una clave, para probar cada ausencia. */
  function without(key: keyof typeof validProd): Record<string, unknown> {
    const config: Record<string, unknown> = { ...validProd };
    delete config[key];
    return config;
  }

  describe('en producción', () => {
    it('requires valid distinct RAG signing keys and HTTPS endpoints', () => {
      expect(() =>
        validateEnv({
          ...validProd,
          RAG_API_URL: 'https://private-rag.example',
          RAG_INTERNAL_KEY: 'q'.repeat(64),
        }),
      ).not.toThrow();
      expect(() =>
        validateEnv({
          ...validProd,
          RAG_API_URL: 'https://private-rag.example',
        }),
      ).toThrow(/RAG_INTERNAL_KEY/);
      expect(() =>
        validateEnv({
          ...validProd,
          RAG_API_URL: 'http://private-rag.example',
          RAG_INTERNAL_KEY: 'q'.repeat(64),
        }),
      ).toThrow(/RAG_API_URL/);
      expect(() =>
        validateEnv({
          ...validProd,
          RAG_API_URL: 'https://private-rag.example',
          RAG_INTERNAL_KEY: 'q'.repeat(64),
          RAG_INGESTION_API_URL: 'https://private-ingestion.example',
          RAG_INGESTION_INTERNAL_KEY: 'q'.repeat(64),
        }),
      ).toThrow(/different/);
    });
    it('acepta una configuración completa y válida', () => {
      expect(() => validateEnv({ ...validProd })).not.toThrow();
    });

    it('aborta si se remite a preproducción desde producción', () => {
      // Es el fallo más peligroso de todos porque NO se manifiesta: el
      // sistema emite, recibe respuestas correctas y no registra nada ante la
      // Agencia. Todo parece ir bien hasta la inspección.
      expect(() =>
        validateEnv({
          ...validProd,
          VERIFACTU_ENABLED: 'true',
          VERIFACTU_ENV: 'preproduccion',
        }),
      ).toThrow(/preproducción/);
    });

    it('aborta también si VERIFACTU_ENV no se indica en absoluto', () => {
      expect(() =>
        validateEnv({ ...validProd, VERIFACTU_ENABLED: 'true' }),
      ).toThrow(/preproducción/);
    });

    it('acepta la remisión cuando apunta de verdad a producción', () => {
      expect(() =>
        validateEnv({
          ...validProd,
          VERIFACTU_ENABLED: 'true',
          VERIFACTU_ENV: 'produccion',
          VERIFACTU_CERT_PATH: '/secrets/domora.p12',
        }),
      ).not.toThrow();
    });

    it('no exige nada de Verifactu si la remisión está apagada', () => {
      expect(() =>
        validateEnv({ ...validProd, VERIFACTU_ENABLED: 'false' }),
      ).not.toThrow();
    });

    it('aborta si falta JWT_SECRET', () => {
      expect(() => validateEnv(without('JWT_SECRET'))).toThrow(
        /JWT_SECRET es obligatoria/,
      );
    });

    it('aborta si JWT_SECRET es el valor de desarrollo publicado en el repo', () => {
      expect(() =>
        validateEnv({ ...validProd, JWT_SECRET: DEV_JWT_SECRET }),
      ).toThrow(/valor de desarrollo/);
    });

    it('aborta si JWT_SECRET es demasiado corto para ser fuerte', () => {
      expect(() => validateEnv({ ...validProd, JWT_SECRET: 'corto' })).toThrow(
        /al menos 32 caracteres/,
      );
    });

    it('aborta si falta SEPA_ENC_KEY (los IBAN se cifrarían con clave derivable)', () => {
      expect(() => validateEnv(without('SEPA_ENC_KEY'))).toThrow(
        /SEPA_ENC_KEY es obligatoria/,
      );
    });

    it('aborta si SEPA_ENC_KEY no son 64 caracteres hex', () => {
      expect(() =>
        validateEnv({ ...validProd, SEPA_ENC_KEY: 'no-es-hex' }),
      ).toThrow(/64 caracteres hexadecimales/);
    });

    it('aborta si falta DATABASE_URL', () => {
      expect(() => validateEnv(without('DATABASE_URL'))).toThrow(
        /DATABASE_URL es obligatoria/,
      );
    });

    it('aborta si falta cualquier clave de Stripe (no se podría cobrar ni verificar el webhook)', () => {
      expect(() => validateEnv(without('STRIPE_SECRET_KEY'))).toThrow(
        /STRIPE_SECRET_KEY es obligatoria/,
      );
      expect(() => validateEnv(without('STRIPE_WEBHOOK_SECRET'))).toThrow(
        /STRIPE_WEBHOOK_SECRET es obligatoria/,
      );
      expect(() => validateEnv(without('STRIPE_PRICE_BASE'))).toThrow(
        /STRIPE_PRICE_BASE es obligatoria/,
      );
      expect(() => validateEnv(without('STRIPE_PRICE_STANDARD'))).toThrow(
        /STRIPE_PRICE_STANDARD es obligatoria/,
      );
      expect(() => validateEnv(without('STRIPE_PRICE_PREMIUM'))).toThrow(
        /STRIPE_PRICE_PREMIUM es obligatoria/,
      );
    });

    it('trata una cadena vacía o de espacios como ausente', () => {
      expect(() => validateEnv({ ...validProd, JWT_SECRET: '   ' })).toThrow(
        /JWT_SECRET es obligatoria/,
      );
    });

    // Una factura sin NIF del emisor es inválida y, al ser la numeración
    // correlativa e inmutable, solo se corrige emitiendo una rectificativa.
    // Por eso se exige antes de arrancar, no al emitir.
    it('aborta si faltan los datos fiscales del emisor', () => {
      expect(() => validateEnv(without('INVOICE_ISSUER_TAX_ID'))).toThrow(
        /INVOICE_ISSUER_TAX_ID/,
      );
      expect(() => validateEnv(without('INVOICE_ISSUER_NAME'))).toThrow(
        /INVOICE_ISSUER_NAME/,
      );
      expect(() => validateEnv(without('INVOICE_ISSUER_ADDRESS'))).toThrow(
        /INVOICE_ISSUER_ADDRESS/,
      );
    });

    it('aborta si el emisor conserva el NIF de desarrollo', () => {
      expect(() =>
        validateEnv({ ...validProd, INVOICE_ISSUER_TAX_ID: 'B00000000' }),
      ).toThrow(/valor de desarrollo/);
    });

    it('informa de todos los problemas a la vez, no solo del primero', () => {
      let message = '';
      try {
        validateEnv({ NODE_ENV: 'production' });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('JWT_SECRET');
      expect(message).toContain('SEPA_ENC_KEY');
      expect(message).toContain('DATABASE_URL');
    });
  });

  describe('identificador de acreedor SEPA de Domora en producción', () => {
    it('no es obligatorio (hoy ningún despacho paga por domiciliación)', () => {
      expect(() => validateEnv({ ...validProd })).not.toThrow();
    });

    it('si se configura, debe ser válido', () => {
      expect(() =>
        validateEnv({
          ...validProd,
          DOMORA_SEPA_CREDITOR_ID: 'ES12ZZZB12345674',
        }),
      ).toThrow(/DOMORA_SEPA_CREDITOR_ID/);
      expect(() =>
        validateEnv({
          ...validProd,
          DOMORA_SEPA_CREDITOR_ID: 'ES11ZZZB12345674',
        }),
      ).not.toThrow();
    });
  });

  describe('fuera de producción', () => {
    it('arranca sin configuración e inyecta el secreto de desarrollo', () => {
      const config = validateEnv({ NODE_ENV: 'development' });
      expect(config['JWT_SECRET']).toBe(DEV_JWT_SECRET);
    });

    it('respeta un JWT_SECRET ya definido en lugar de pisarlo', () => {
      const config = validateEnv({
        NODE_ENV: 'development',
        JWT_SECRET: 'mi-secreto-local',
      });
      expect(config['JWT_SECRET']).toBe('mi-secreto-local');
    });

    it('permite remitir a preproducción, que es como se valida', () => {
      expect(() =>
        validateEnv({
          NODE_ENV: 'development',
          VERIFACTU_ENABLED: 'true',
          VERIFACTU_ENV: 'preproduccion',
          VERIFACTU_CERT_PATH: '/ruta/certificado.p12',
        }),
      ).not.toThrow();
    });

    it('exige el certificado si se habilita la remisión', () => {
      // Sin certificado no hay autenticación posible: mejor fallar al
      // arrancar que en el primer envío.
      expect(() =>
        validateEnv({ NODE_ENV: 'development', VERIFACTU_ENABLED: 'true' }),
      ).toThrow(/VERIFACTU_CERT_PATH/);
    });

    it('no exige SEPA_ENC_KEY ni DATABASE_URL', () => {
      expect(() => validateEnv({ NODE_ENV: 'test' })).not.toThrow();
    });

    it('DOMORA_SEPA_CREDITOR_ID es opcional: sin él la domiciliación queda deshabilitada', () => {
      const config = validateEnv({ NODE_ENV: 'development' });
      expect(config['DOMORA_SEPA_CREDITOR_ID']).toBeUndefined();
    });

    it('DOMORA_SEPA_CREDITOR_ID con dígitos de control erróneos impide arrancar, y uno válido se normaliza', () => {
      expect(() =>
        validateEnv({
          NODE_ENV: 'development',
          DOMORA_SEPA_CREDITOR_ID: 'ES12ZZZB12345674',
        }),
      ).toThrow(/DOMORA_SEPA_CREDITOR_ID/);
      const config = validateEnv({
        NODE_ENV: 'development',
        DOMORA_SEPA_CREDITOR_ID: ' es11 zzz b12345674 ',
      });
      expect(config['DOMORA_SEPA_CREDITOR_ID']).toBe('ES11ZZZB12345674');
    });

    it('inyecta datos de emisor de desarrollo, evidentemente falsos', () => {
      const config = validateEnv({ NODE_ENV: 'development' });
      expect(config['INVOICE_ISSUER_TAX_ID']).toBe('B00000000');
      expect(String(config['INVOICE_ISSUER_ADDRESS'])).toContain(
        'sin validez fiscal',
      );
    });
  });
});

describe('validateEnv con DEMO_MODE=true', () => {
  // Producción SIN Stripe ni emisor: es el entorno demo de Azure.
  const demoProd = (): Record<string, unknown> => ({
    NODE_ENV: 'production',
    DEMO_MODE: 'true',
    JWT_SECRET: 'x'.repeat(40),
    SEPA_ENC_KEY: 'a'.repeat(64),
    DATABASE_URL: 'postgresql://user:pass@host:5432/domora_demo',
  });

  it('relaja Stripe e INVOICE_ISSUER_* y rellena el emisor de desarrollo', () => {
    const config = validateEnv(demoProd());
    expect(config['INVOICE_ISSUER_TAX_ID']).toBe('B00000000');
  });

  it('sigue exigiendo JWT_SECRET, SEPA_ENC_KEY y DATABASE_URL', () => {
    const noJwt = demoProd();
    delete noJwt['JWT_SECRET'];
    expect(() => validateEnv(noJwt)).toThrow(/JWT_SECRET/);
    const noSepa = demoProd();
    delete noSepa['SEPA_ENC_KEY'];
    expect(() => validateEnv(noSepa)).toThrow(/SEPA_ENC_KEY/);
    const noDb = demoProd();
    delete noDb['DATABASE_URL'];
    // Sin DATABASE_URL tampoco se puede probar que la BD sea demo: aborta.
    expect(() => validateEnv(noDb)).toThrow(/BD demo/);
  });

  it.each([
    'STRIPE_SECRET_KEY',
    'OPENAI_API_KEY',
    'SMTP_HOST',
    'VAPID_PRIVATE_KEY',
    'RAG_API_URL',
    'RAG_INTERNAL_KEY',
    'RAG_INGESTION_API_URL',
    'RAG_INGESTION_INTERNAL_KEY',
  ])('rechaza %s', (key) => {
    expect(() => validateEnv({ ...demoProd(), [key]: 'algo' })).toThrow(
      new RegExp(key),
    );
  });

  it('rechaza VERIFACTU_ENABLED=true', () => {
    expect(() =>
      validateEnv({ ...demoProd(), VERIFACTU_ENABLED: 'true' }),
    ).toThrow(/VERIFACTU_ENABLED/);
  });

  it('acepta VERIFACTU_ENABLED=false', () => {
    expect(() =>
      validateEnv({ ...demoProd(), VERIFACTU_ENABLED: 'false' }),
    ).not.toThrow();
  });

  it('fuerza CATASTRO_ENABLED=false', () => {
    const config = validateEnv({ ...demoProd(), CATASTRO_ENABLED: 'true' });
    expect(config['CATASTRO_ENABLED']).toBe('false');
  });

  it('aborta con NODE_ENV=production y BD sin "demo"', () => {
    expect(() =>
      validateEnv({
        ...demoProd(),
        DATABASE_URL: 'postgresql://user:pass@host:5432/domora',
      }),
    ).toThrow(/BD demo/);
  });

  it('aborta con NODE_ENV=production y DATABASE_URL ininterpretable', () => {
    expect(() =>
      validateEnv({ ...demoProd(), DATABASE_URL: 'no-es-url' }),
    ).toThrow(/BD demo/);
  });

  it('fuera de producción acepta DEMO_MODE sin claves externas', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'development', DEMO_MODE: 'true' }),
    ).not.toThrow();
  });

  it('fuera de producción también rechaza claves externas', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DEMO_MODE: 'true',
        SMTP_HOST: 'smtp.example.com',
      }),
    ).toThrow(/SMTP_HOST/);
  });

  it('sin DEMO_MODE nada cambia: producción sigue exigiendo Stripe', () => {
    const config = demoProd();
    delete config['DEMO_MODE'];
    expect(() => validateEnv(config)).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('sin DEMO_MODE no fuerza CATASTRO_ENABLED ni rechaza SMTP_HOST', () => {
    const config = validateEnv({
      NODE_ENV: 'development',
      CATASTRO_ENABLED: 'true',
      SMTP_HOST: 'smtp.example.com',
    });
    expect(config['CATASTRO_ENABLED']).toBe('true');
  });
});
