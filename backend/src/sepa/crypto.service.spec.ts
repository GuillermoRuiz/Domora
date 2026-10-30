import type { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Falta ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

const VALID_KEY = 'a'.repeat(64);
const IBAN = 'ES9121000418450200051332';

describe('CryptoService', () => {
  describe('cifrado y descifrado', () => {
    const service = new CryptoService(configWith({ SEPA_ENC_KEY: VALID_KEY }));

    it('descifra lo que cifra', () => {
      expect(service.decrypt(service.encrypt(IBAN))).toBe(IBAN);
    });

    it('produce un texto cifrado distinto cada vez (IV aleatorio)', () => {
      expect(service.encrypt(IBAN)).not.toBe(service.encrypt(IBAN));
    });

    it('nunca deja el valor original visible en lo almacenado', () => {
      expect(service.encrypt(IBAN)).not.toContain(IBAN);
    });

    it('detecta manipulación del texto cifrado (AES-GCM autenticado)', () => {
      const encrypted = service.encrypt(IBAN);
      const tampered = encrypted.slice(0, -4) + 'AAAA';
      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('enmascara dejando solo los cuatro últimos caracteres', () => {
      expect(service.maskIban(IBAN)).toBe('ES91 ···· 1332');
    });
  });

  describe('valores heredados en claro', () => {
    it('los devuelve para no romper la lectura, pero los denuncia por log', () => {
      const service = new CryptoService(
        configWith({ SEPA_ENC_KEY: VALID_KEY }),
      );
      const error = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);

      expect(service.decrypt(IBAN)).toBe(IBAN);
      expect(error).toHaveBeenCalled();

      error.mockRestore();
    });
  });

  describe('configuración de la clave', () => {
    it('en producción se niega a derivar la clave de JWT_SECRET', () => {
      // Derivarla usa una sal fija y pública: el resultado sería reproducible
      // por cualquiera con acceso al código.
      expect(
        () =>
          new CryptoService(
            configWith({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) }),
          ),
      ).toThrow(/SEPA_ENC_KEY/);
    });

    it('fuera de producción la deriva para no entorpecer el desarrollo', () => {
      expect(
        () =>
          new CryptoService(
            configWith({ NODE_ENV: 'development', JWT_SECRET: 'x'.repeat(40) }),
          ),
      ).not.toThrow();
    });

    it('rechaza una SEPA_ENC_KEY que no sean 64 hex, aunque exista', () => {
      expect(
        () =>
          new CryptoService(
            configWith({
              NODE_ENV: 'production',
              SEPA_ENC_KEY: 'demasiado-corta',
            }),
          ),
      ).toThrow(/SEPA_ENC_KEY/);
    });
  });
});
