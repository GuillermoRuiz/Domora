import type { Mandate } from '../prisma/client';
import { MandatesService } from './mandates.service';

/**
 * `computeSeq` y `applyLifecycleRule` son las dos reglas de negocio de más
 * riesgo de todo el flujo SEPA: la primera decide qué tipo de secuencia
 * (FRST/RCUR/OOFF) lleva cada adeudo en el pain.008, y equivocarla hace que
 * el banco rechace la remesa ENTERA, no solo una línea. La segunda decide
 * cuándo un mandato caduca o queda dormido — acertarla mal deja domiciliar
 * con un mandato que ya no es válido, o bloquea uno que sí lo es.
 *
 * Ambas son funciones puras (reciben datos, no tocan Prisma/crypto/audit),
 * así que se instancian sin las dependencias reales del servicio.
 */
function service(): MandatesService {
  return new MandatesService(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

function mandate(
  overrides: Partial<
    Pick<
      Mandate,
      'status' | 'paymentType' | 'firstUseAt' | 'signedAt' | 'lastUseAt'
    >
  >,
): Pick<
  Mandate,
  'status' | 'paymentType' | 'firstUseAt' | 'signedAt' | 'lastUseAt'
> {
  return {
    status: 'active',
    paymentType: 'recurrent',
    signedAt: new Date('2020-01-01'),
    firstUseAt: null,
    lastUseAt: null,
    ...overrides,
  };
}

describe('MandatesService.computeSeq', () => {
  const s = service();

  it('un mandato no activo no tiene secuencia', () => {
    expect(s.computeSeq(mandate({ status: 'expired' }))).toBeNull();
    expect(s.computeSeq(mandate({ status: 'dormant' }))).toBeNull();
    expect(s.computeSeq(mandate({ status: 'revoked' }))).toBeNull();
  });

  it('un adeudo puntual (oneOff) siempre es OOFF, incluso si ya se usó antes', () => {
    // Caso de trampa: paymentType manda sobre firstUseAt para oneOff.
    expect(
      s.computeSeq(mandate({ paymentType: 'oneOff', firstUseAt: null })),
    ).toBe('OOFF');
    expect(
      s.computeSeq(
        mandate({ paymentType: 'oneOff', firstUseAt: new Date('2024-01-01') }),
      ),
    ).toBe('OOFF');
  });

  it('recurrente sin uso previo es FRST (primer cargo)', () => {
    expect(
      s.computeSeq(mandate({ paymentType: 'recurrent', firstUseAt: null })),
    ).toBe('FRST');
  });

  it('recurrente con uso previo es RCUR', () => {
    expect(
      s.computeSeq(
        mandate({
          paymentType: 'recurrent',
          firstUseAt: new Date('2024-01-01'),
        }),
      ),
    ).toBe('RCUR');
  });
});

describe('MandatesService.applyLifecycleRule', () => {
  const s = service();
  const today = new Date('2026-08-16');

  it('un mandato que no está activo se deja tal cual (no revive uno revocado)', () => {
    expect(s.applyLifecycleRule(mandate({ status: 'revoked' }), today)).toBe(
      'revoked',
    );
    expect(s.applyLifecycleRule(mandate({ status: 'expired' }), today)).toBe(
      'expired',
    );
  });

  it('firmado hace ≥36 meses y nunca usado → expired', () => {
    expect(
      s.applyLifecycleRule(
        mandate({ signedAt: new Date('2023-08-16'), firstUseAt: null }),
        today,
      ),
    ).toBe('expired');
  });

  it('firmado hace <36 meses y nunca usado → sigue active', () => {
    expect(
      s.applyLifecycleRule(
        mandate({ signedAt: new Date('2023-09-16'), firstUseAt: null }),
        today,
      ),
    ).toBe('active');
  });

  it('usado, pero sin cargo desde hace ≥36 meses → dormant', () => {
    expect(
      s.applyLifecycleRule(
        mandate({
          firstUseAt: new Date('2020-01-01'),
          lastUseAt: new Date('2023-08-16'),
        }),
        today,
      ),
    ).toBe('dormant');
  });

  it('usado recientemente → sigue active aunque se firmara hace mucho', () => {
    expect(
      s.applyLifecycleRule(
        mandate({
          signedAt: new Date('2018-01-01'),
          firstUseAt: new Date('2018-02-01'),
          lastUseAt: new Date('2026-06-01'),
        }),
        today,
      ),
    ).toBe('active');
  });

  it('el uso previo protege de la regla de "firmado y nunca usado", aunque no haya cargo reciente', () => {
    // firstUseAt !== null desactiva la primera regla; sin lastUseAt no entra
    // en la segunda tampoco (lastUseAt es null) — el mandato sigue active.
    // Es el comportamiento actual: se documenta explícitamente porque no es
    // obvio a primera vista y una futura "mejora" podría romperlo sin querer.
    expect(
      s.applyLifecycleRule(
        mandate({
          signedAt: new Date('2020-01-01'),
          firstUseAt: new Date('2020-02-01'),
          lastUseAt: null,
        }),
        today,
      ),
    ).toBe('active');
  });
});
