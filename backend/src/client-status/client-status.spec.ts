import { AdminStatus, SubscriptionStatus } from '../prisma/client';
import {
  clientStatus,
  paymentStatus,
  pendingInvoicesSummary,
  type ClientStatusInput,
  type PaymentStatusInput,
} from './client-status';

const client = (over: Partial<ClientStatusInput> = {}): ClientStatusInput => ({
  status: AdminStatus.Activa,
  deletedAt: null,
  stripeStatus: null,
  onboardingComplete: true,
  ...over,
});

const payment = (
  over: Partial<PaymentStatusInput> = {},
): PaymentStatusInput => ({
  status: AdminStatus.Activa,
  stripeStatus: null,
  invoices: [],
  ...over,
});

describe('clientStatus (S6 mapping, L32)', () => {
  it('Activa → Activo', () => {
    expect(clientStatus(client())).toBe('Activo');
  });

  it('Periodo de gracia → Activo', () => {
    expect(
      clientStatus(client({ status: AdminStatus.Periodo_de_gracia })),
    ).toBe('Activo');
  });

  it('Vencida → Suspendido', () => {
    expect(clientStatus(client({ status: AdminStatus.Vencida }))).toBe(
      'Suspendido',
    );
  });

  it('Bloqueada → Suspendido', () => {
    expect(clientStatus(client({ status: AdminStatus.Bloqueada }))).toBe(
      'Suspendido',
    );
  });

  it('deleted despacho → Cancelado', () => {
    expect(clientStatus(client({ deletedAt: new Date('2026-01-01') }))).toBe(
      'Cancelado',
    );
  });

  it('Stripe canceled → Cancelado', () => {
    expect(
      clientStatus(
        client({
          status: AdminStatus.Vencida,
          stripeStatus: SubscriptionStatus.canceled,
        }),
      ),
    ).toBe('Cancelado');
  });

  it('Stripe trialing → En prueba', () => {
    expect(
      clientStatus(client({ stripeStatus: SubscriptionStatus.trialing })),
    ).toBe('En prueba');
  });

  it('an Activo client with required setup steps pending is shown as En onboarding', () => {
    expect(clientStatus(client({ onboardingComplete: false }))).toBe(
      'En onboarding',
    );
    expect(
      clientStatus(
        client({
          status: AdminStatus.Periodo_de_gracia,
          onboardingComplete: false,
        }),
      ),
    ).toBe('En onboarding');
  });

  describe('precedence', () => {
    it('deleted wins over everything, a live Stripe trial included', () => {
      expect(
        clientStatus(
          client({
            deletedAt: new Date(),
            stripeStatus: SubscriptionStatus.trialing,
          }),
        ),
      ).toBe('Cancelado');
    });

    it('Stripe canceled is Cancelado even if the despacho was set back to Activa by hand (same as the MRR, which counts it 0)', () => {
      expect(
        clientStatus(client({ stripeStatus: SubscriptionStatus.canceled })),
      ).toBe('Cancelado');
    });

    it('a manual block during a trial is Suspendido: access is cut', () => {
      expect(
        clientStatus(
          client({
            status: AdminStatus.Bloqueada,
            stripeStatus: SubscriptionStatus.trialing,
          }),
        ),
      ).toBe('Suspendido');
      expect(
        clientStatus(
          client({
            status: AdminStatus.Vencida,
            stripeStatus: SubscriptionStatus.trialing,
          }),
        ),
      ).toBe('Suspendido');
    });

    it('a trial is En prueba even with setup steps pending', () => {
      expect(
        clientStatus(
          client({
            stripeStatus: SubscriptionStatus.trialing,
            onboardingComplete: false,
          }),
        ),
      ).toBe('En prueba');
    });

    it('a suspended client is never shown as En onboarding', () => {
      expect(
        clientStatus(
          client({ status: AdminStatus.Bloqueada, onboardingComplete: false }),
        ),
      ).toBe('Suspendido');
    });

    it('other Stripe statuses leave the decision to AdminStatus', () => {
      expect(
        clientStatus(client({ stripeStatus: SubscriptionStatus.active })),
      ).toBe('Activo');
      expect(
        clientStatus(client({ stripeStatus: SubscriptionStatus.past_due })),
      ).toBe('Activo');
      expect(
        clientStatus(
          client({
            status: AdminStatus.Vencida,
            stripeStatus: SubscriptionStatus.unpaid,
          }),
        ),
      ).toBe('Suspendido');
    });
  });
});

describe('paymentStatus (S6)', () => {
  it('Al día without unpaid invoices nor failed charges', () => {
    expect(
      paymentStatus(
        payment({
          invoices: [
            { status: 'Pagada', total: 60, stripe: false },
            { status: 'Anulada', total: 60, stripe: false },
          ],
        }),
      ),
    ).toBe('Al día');
  });

  it('Pendiente with an invoice still in term', () => {
    expect(
      paymentStatus(
        payment({
          invoices: [{ status: 'Pendiente', total: 60, stripe: false }],
        }),
      ),
    ).toBe('Pendiente');
  });

  it('Vencido with an overdue manual invoice', () => {
    expect(
      paymentStatus(
        payment({
          invoices: [{ status: 'Vencida', total: 60, stripe: false }],
        }),
      ),
    ).toBe('Vencido');
  });

  it('Vencido when the despacho is Vencida (grace exhausted or Stripe gave up)', () => {
    expect(paymentStatus(payment({ status: AdminStatus.Vencida }))).toBe(
      'Vencido',
    );
  });

  it('Fallido while Stripe retries the charge (past_due)', () => {
    expect(
      paymentStatus(payment({ stripeStatus: SubscriptionStatus.past_due })),
    ).toBe('Fallido');
  });

  it('Fallido when Stripe reports unpaid', () => {
    expect(
      paymentStatus(payment({ stripeStatus: SubscriptionStatus.unpaid })),
    ).toBe('Fallido');
  });

  it('Fallido during the manual grace period', () => {
    expect(
      paymentStatus(payment({ status: AdminStatus.Periodo_de_gracia })),
    ).toBe('Fallido');
  });

  describe('precedence', () => {
    it('the Stripe invoice marked Vencida by the failed charge is Fallido while Stripe still retries (L32: grace = Fallido)', () => {
      expect(
        paymentStatus(
          payment({
            stripeStatus: SubscriptionStatus.past_due,
            invoices: [{ status: 'Vencida', total: 72.6, stripe: true }],
          }),
        ),
      ).toBe('Fallido');
    });

    it('a manual overdue invoice is Vencido even while a Stripe charge is being retried', () => {
      expect(
        paymentStatus(
          payment({
            stripeStatus: SubscriptionStatus.past_due,
            invoices: [{ status: 'Vencida', total: 60, stripe: false }],
          }),
        ),
      ).toBe('Vencido');
    });

    it('a Stripe invoice still Vencida once Stripe stopped retrying is Vencido', () => {
      expect(
        paymentStatus(
          payment({
            stripeStatus: SubscriptionStatus.canceled,
            invoices: [{ status: 'Vencida', total: 72.6, stripe: true }],
          }),
        ),
      ).toBe('Vencido');
    });

    it('Vencida despacho wins over a failed charge', () => {
      expect(
        paymentStatus(
          payment({
            status: AdminStatus.Vencida,
            stripeStatus: SubscriptionStatus.unpaid,
          }),
        ),
      ).toBe('Vencido');
    });

    it('a failed charge wins over an invoice in term', () => {
      expect(
        paymentStatus(
          payment({
            stripeStatus: SubscriptionStatus.past_due,
            invoices: [{ status: 'Pendiente', total: 60, stripe: false }],
          }),
        ),
      ).toBe('Fallido');
    });

    it('payment and client status are independent: an Activo client can have a pending invoice', () => {
      expect(clientStatus(client())).toBe('Activo');
      expect(
        paymentStatus(
          payment({
            invoices: [{ status: 'Pendiente', total: 60, stripe: false }],
          }),
        ),
      ).toBe('Pendiente');
    });
  });
});

describe('pendingInvoicesSummary', () => {
  it('counts every unpaid invoice (Pendiente + Vencida) with VAT, and the overdue ones apart', () => {
    expect(
      pendingInvoicesSummary([
        { status: 'Pendiente', total: 60.5, stripe: false },
        { status: 'Vencida', total: 72.6, stripe: true },
        { status: 'Vencida', total: 10.01, stripe: false },
        { status: 'Pagada', total: 999, stripe: false },
        { status: 'Anulada', total: 999, stripe: false },
      ]),
    ).toEqual({
      count: 3,
      amount: 143.11,
      overdueCount: 2,
      overdueAmount: 82.61,
    });
  });

  it('is all zeros without unpaid invoices', () => {
    expect(pendingInvoicesSummary([])).toEqual({
      count: 0,
      amount: 0,
      overdueCount: 0,
      overdueAmount: 0,
    });
  });
});
