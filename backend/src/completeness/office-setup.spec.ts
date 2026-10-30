import {
  completeness,
  officeSetupSteps,
  onboardingComplete,
  stepsPercent,
  type OfficeSetupInput,
} from './office-setup';
import type { SetupStep } from '../estates/estate-setup.service';

const complete: OfficeSetupInput = {
  contactName: 'Ana Ruiz',
  contactEmail: 'ana@despacho.es',
  phone: '600000000',
  billing: { businessName: 'Despacho SL', cif: 'B12345678', address: 'Calle Mayor 1', email: 'facturas@despacho.es', paymentMethod: 'Transferencia', iban: null },
  subscription: null,
  estates: 2,
  otherActiveUsers: 1,
  usedTeamInvites: 0,
  primaryTotpEnabled: true,
};

const step = (input: Partial<OfficeSetupInput>, key: string) =>
  officeSetupSteps({ ...complete, ...input }).find((s) => s.key === key);

describe('officeSetupSteps', () => {
  it('lists the six despacho steps with their weights (S10)', () => {
    expect(officeSetupSteps(complete).map((s) => [s.key, s.weight, s.status])).toEqual([
      ['contact', 'recommended', 'done'],
      ['billing', 'required', 'done'],
      ['payment', 'required', 'done'],
      ['estates', 'required', 'done'],
      ['team', 'info', 'done'],
      ['twoFactor', 'recommended', 'done'],
    ]);
  });

  it('contacto completo needs contact name, contact email and phone', () => {
    expect(step({ phone: null }, 'contact')?.status).toBe('pending');
    expect(step({ contactName: '  ' }, 'contact')?.status).toBe('pending');
    expect(step({ contactEmail: null }, 'contact')?.status).toBe('pending');
  });

  it('datos de facturación needs a billing row with its fields filled in', () => {
    expect(step({ billing: null }, 'billing')?.status).toBe('pending');
    expect(step({ billing: { ...complete.billing!, address: '' } }, 'billing')?.status).toBe('pending');
  });

  it('método de pago: a billing method (domiciliación only with IBAN) or a live Stripe subscription', () => {
    expect(step({ billing: null }, 'payment')?.status).toBe('pending');
    expect(step({ billing: { ...complete.billing!, paymentMethod: 'Domiciliacion', iban: null } }, 'payment')?.status).toBe('pending');
    expect(step({ billing: { ...complete.billing!, paymentMethod: 'Domiciliacion', iban: 'ES9121000418450200051332' } }, 'payment')?.status).toBe('done');
    expect(step({ billing: null, subscription: { stripeSubscriptionId: 'sub_1', status: 'active' } }, 'payment')?.status).toBe('done');
    expect(step({ billing: null, subscription: { stripeSubscriptionId: 'sub_1', status: 'canceled' } }, 'payment')?.status).toBe('pending');
    expect(step({ billing: null, subscription: { stripeSubscriptionId: null, status: null } }, 'payment')?.status).toBe('pending');
  });

  it('≥1 comunidad needs a non-deleted estate', () => {
    expect(step({ estates: 0 }, 'estates')?.status).toBe('pending');
    expect(step({ estates: 0 }, 'estates')?.done).toBe(0);
  });

  it('equipo invitado: another active user or a used team invite', () => {
    expect(step({ otherActiveUsers: 0, usedTeamInvites: 0 }, 'team')?.status).toBe('pending');
    expect(step({ otherActiveUsers: 0, usedTeamInvites: 1 }, 'team')?.status).toBe('done');
  });

  it('2FA del usuario principal follows the primary user totp flag', () => {
    expect(step({ primaryTotpEnabled: false }, 'twoFactor')?.status).toBe('pending');
    expect(step({ primaryTotpEnabled: null }, 'twoFactor')?.status).toBe('pending');
  });
});

const s = (weight: SetupStep['weight'], status: SetupStep['status']): Pick<SetupStep, 'weight' | 'status'> => ({ weight, status });

describe('stepsPercent', () => {
  it('counts required and recommended only; info never counts (L11, L12)', () => {
    expect(stepsPercent([s('required', 'done'), s('recommended', 'pending'), s('info', 'done'), s('info', 'pending')])).toBe(50);
    expect(stepsPercent([s('required', 'warning'), s('required', 'done'), s('recommended', 'done'), s('recommended', 'done')])).toBe(75);
  });
});

describe('completeness', () => {
  it('weighs the despacho steps 50% and the mean of its estates 50% (L13)', () => {
    const office = [s('required', 'done'), s('recommended', 'done')]; // 100
    const estates = [[s('required', 'done'), s('required', 'pending')], [s('required', 'done'), s('recommended', 'done')]]; // 50, 100
    expect(completeness(office, estates)).toEqual({ office: 100, estates: 75, total: 87.5 });
  });

  it('a despacho without estates gets 0% in the estates half', () => {
    expect(completeness([s('required', 'done')], [])).toEqual({ office: 100, estates: 0, total: 50 });
  });
});

describe('onboardingComplete', () => {
  const office = [s('required', 'done'), s('recommended', 'pending'), s('info', 'pending')];
  it('needs every required despacho step and every required step of each estate, with at least one estate', () => {
    expect(onboardingComplete(office, [[s('required', 'done'), s('recommended', 'pending')]])).toBe(true);
    expect(onboardingComplete(office, [])).toBe(false);
    expect(onboardingComplete(office, [[s('required', 'done')], [s('required', 'warning')]])).toBe(false);
    expect(onboardingComplete([s('required', 'pending')], [[s('required', 'done')]])).toBe(false);
  });
});
