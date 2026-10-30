import { API, setupComponent, settle } from '../../../core/testing/component-harness';
import { BillingCardComponent } from './billing-card.component';

const SEPA = {
  available: true,
  creditorId: 'ES11ZZZB12345674',
  creditorName: 'Domora S.L.',
  mandateReference: 'DOM-1A2B3C4D-20261027-ABCDEF',
  mandateText: 'Orden de domiciliación de adeudo directo SEPA\nReferencia de la orden de domiciliación: DOM-1A2B3C4D-20261027-ABCDEF\nIdentificador del acreedor: ES11ZZZB12345674',
};
const BILLING = { businessName: 'Fincas Prueba S.L.', cif: 'B12345674', address: 'Calle Mayor 1, Madrid', email: 'facturas@fincas.test', paymentMethod: 'Transferencia', ibanMasked: null };
const MANDATE = {
  id: 'm1', reference: 'DOM-1A2B3C4D-20261001-111111', creditorId: 'ES11ZZZB12345674', debtorName: 'Fincas Prueba S.L.', ibanMasked: 'ES91 ···· 1332',
  signedAt: '2026-10-01T10:00:00.000Z', status: 'active', revokedAt: null, revokedReason: null, textVersion: 'sepa-core-es-v1', mandateText: 'Orden',
};

async function mount(own: object) {
  const h = setupComponent(BillingCardComponent);
  h.fixture.detectChanges();
  h.http.expectOne((r: any) => r.url === `${API}/admin-billing/me` && r.method === 'GET').flush(own);
  await settle();
  h.fixture.detectChanges();
  return h;
}

function putRequest(http: any) {
  return http.expectOne((r: any) => r.url === `${API}/admin-billing/me` && r.method === 'PUT');
}

describe('BillingCardComponent («Datos de facturación», S17)', () => {
  it('shows the despacho billing data with the legal hint about issued invoices', async () => {
    const { el } = await mount({ billing: { ...BILLING, paymentMethod: 'Domiciliacion', ibanMasked: 'ES91 ···· 1332' }, mandate: MANDATE, sepa: SEPA });
    const text = el.textContent ?? '';
    expect(text).toContain('Datos de facturación');
    expect(text).toContain('Fincas Prueba S.L.');
    expect(text).toContain('B12345674');
    expect(text).toContain('Domiciliación');
    expect(text).toContain('ES91 ···· 1332');
    expect(text).toContain('DOM-1A2B3C4D-20261001-111111');
    expect(text).toContain('Son los datos que aparecen en las facturas que te emite Domora');
    expect(text).toContain('Las facturas ya emitidas no cambian');
    expect(text).toContain('rectificativa');
  });

  it('without data, invites the despacho to add them', async () => {
    const { el } = await mount({ billing: null, mandate: null, sepa: SEPA });
    expect(el.textContent).toContain('Todavía no has indicado tus datos de facturación.');
    expect(el.querySelector('[data-testid="billing-edit"]')?.textContent).toContain('Añadir datos');
  });

  it('saves card or transfer without IBAN or mandate and shows the saved data', async () => {
    const { component, fixture, http, el } = await mount({ billing: null, mandate: null, sepa: SEPA });
    component.startEdit();
    component.businessName.set('Fincas Prueba S.L.');
    component.cif.set('b-1234567.4');
    component.address.set('Calle Mayor 1, Madrid');
    component.email.set('facturas@fincas.test');
    component.paymentMethod.set('Transferencia');

    const promise = component.save();
    const req = putRequest(http);
    expect(req.request.body).toEqual({
      businessName: 'Fincas Prueba S.L.', cif: 'b-1234567.4', address: 'Calle Mayor 1, Madrid', email: 'facturas@fincas.test', paymentMethod: 'Transferencia',
    });
    req.flush({ billing: BILLING, mandate: null, sepa: SEPA });
    await promise;
    fixture.detectChanges();
    expect(component.editing()).toBe(false);
    expect(el.textContent).toContain('facturas@fincas.test');
    expect(el.textContent).toContain('Datos de facturación guardados');
  });

  it('a NIF/CIF with a wrong check digit blocks saving with a Spain Spanish message', async () => {
    const { component, fixture, http, el } = await mount({ billing: BILLING, mandate: null, sepa: SEPA });
    component.startEdit();
    component.cif.set('B12345678');
    await component.save();
    fixture.detectChanges();
    http.expectNone((r: any) => r.method === 'PUT');
    expect(el.textContent).toContain('El NIF/CIF no es válido: revisa la letra o el dígito de control.');
  });

  it('when Domora has no SEPA creditor identifier, domiciliación cannot be chosen and the card says so', async () => {
    const { component, fixture, el } = await mount({ billing: BILLING, mandate: null, sepa: { ...SEPA, available: false, creditorId: null, mandateReference: null, mandateText: null } });
    component.startEdit();
    fixture.detectChanges();
    const option = el.querySelector('#billing-method option[value="Domiciliación"]') as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(el.textContent).toContain('El pago por domiciliación todavía no está disponible');
  });

  it('domiciliación shows the SEPA order with its reference and needs it accepted, then sends IBAN and acceptance', async () => {
    const { component, fixture, http, el } = await mount({ billing: BILLING, mandate: null, sepa: SEPA });
    component.startEdit();
    component.paymentMethod.set('Domiciliación');
    fixture.detectChanges();
    expect(el.querySelector('.mandate-text')?.textContent).toContain('Referencia de la orden de domiciliación: DOM-1A2B3C4D-20261027-ABCDEF');
    expect(el.querySelector('.mandate-text')?.textContent).toContain('Identificador del acreedor: ES11ZZZB12345674');

    component.iban.set('es91 2100 0418 4502 0005 1332');
    component.debtorName.set('Fincas Prueba S.L.');
    await component.save();
    fixture.detectChanges();
    http.expectNone((r: any) => r.method === 'PUT');
    expect(el.textContent).toContain('Para domiciliar los cobros tienes que aceptar la orden de domiciliación SEPA.');

    component.accepted.set(true);
    const promise = component.save();
    const req = putRequest(http);
    expect(req.request.body).toMatchObject({
      paymentMethod: 'Domiciliacion',
      iban: 'ES9121000418450200051332',
      mandate: { accepted: true, reference: 'DOM-1A2B3C4D-20261027-ABCDEF', debtorName: 'Fincas Prueba S.L.' },
    });
    req.flush({ billing: { ...BILLING, paymentMethod: 'Domiciliacion', ibanMasked: 'ES91 ···· 1332' }, mandate: MANDATE, sepa: SEPA });
    await promise;
  });

  it('an IBAN with wrong check digits blocks saving', async () => {
    const { component, fixture, http, el } = await mount({ billing: BILLING, mandate: null, sepa: SEPA });
    component.startEdit();
    component.paymentMethod.set('Domiciliación');
    component.iban.set('ES9121000418450200051333');
    component.debtorName.set('Fincas');
    component.accepted.set(true);
    await component.save();
    fixture.detectChanges();
    http.expectNone((r: any) => r.method === 'PUT');
    expect(el.textContent).toContain('El IBAN no es válido (revisa los dígitos de control).');
  });

  it('with an active mandate, saving other fields keeps it and sends no IBAN', async () => {
    const { component, http } = await mount({ billing: { ...BILLING, paymentMethod: 'Domiciliacion', ibanMasked: 'ES91 ···· 1332' }, mandate: MANDATE, sepa: SEPA });
    component.startEdit();
    component.email.set('nueva@fincas.test');
    const promise = component.save();
    const req = putRequest(http);
    expect(req.request.body.iban).toBeUndefined();
    expect(req.request.body.mandate).toBeUndefined();
    expect(req.request.body.paymentMethod).toBe('Domiciliacion');
    req.flush({ billing: { ...BILLING, email: 'nueva@fincas.test', paymentMethod: 'Domiciliacion', ibanMasked: 'ES91 ···· 1332' }, mandate: MANDATE, sepa: SEPA });
    await promise;
  });

  it('shows the server message when saving fails and keeps editing', async () => {
    const { component, fixture, http, el } = await mount({ billing: BILLING, mandate: null, sepa: SEPA });
    component.startEdit();
    const promise = component.save();
    putRequest(http).flush({ message: 'Domora todavía no ofrece el pago por domiciliación. Elige tarjeta o transferencia.' }, { status: 409, statusText: 'Conflict' });
    await promise;
    fixture.detectChanges();
    expect(component.editing()).toBe(true);
    expect(el.textContent).toContain('Domora todavía no ofrece el pago por domiciliación.');
  });
});
