import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';

function configWithout(...missingKeys: string[]): ConfigService {
  const values: Record<string, string> = {
    STRIPE_SECRET_KEY: 'sk_test_dummy',
    STRIPE_PRICE_BASE: 'price_base',
    STRIPE_PRICE_STANDARD: 'price_standard',
    STRIPE_PRICE_PREMIUM: 'price_premium',
  };
  for (const key of missingKeys) delete values[key];
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('StripeService', () => {
  describe('degradado sin STRIPE_SECRET_KEY', () => {
    // Mismo criterio que MailService sin SMTP_HOST: no falla al arrancar,
    // falla explícitamente (503) en la primera llamada real.
    it('cualquier operación real lanza ServiceUnavailableException en vez de un TypeError críptico', async () => {
      const service = new StripeService(configWithout('STRIPE_SECRET_KEY'));
      await expect(
        service.createCustomer({ email: 'a@b.com', name: 'Test', administratorId: 'admin-1' }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('priceIdFor / planForPriceId', () => {
    it('lanza si el Price de un plan no está configurado', () => {
      const service = new StripeService(configWithout('STRIPE_PRICE_STANDARD'));
      expect(() => service.priceIdFor('STANDARD')).toThrow(ServiceUnavailableException);
      expect(service.priceIdFor('BASE')).toBe('price_base');
    });

    it('resuelve el plan correcto a partir de un Price id recibido del webhook', () => {
      const service = new StripeService(configWithout());
      expect(service.planForPriceId('price_premium')).toBe('PREMIUM');
    });

    it('devuelve null para un Price id que no coincide con ninguno de los 3 configurados', () => {
      const service = new StripeService(configWithout());
      expect(service.planForPriceId('price_desconocido')).toBeNull();
    });
  });
});
