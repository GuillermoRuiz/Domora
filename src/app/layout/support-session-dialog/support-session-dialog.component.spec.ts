import { TestBed } from '@angular/core/testing';
import { API, makeUser, setupComponent, settle, typeInto } from '../../core/testing/component-harness';
import { SupportSessionService } from '../../core/support-session.service';
import type { SupportSession } from '../../core/models';
import { SupportSessionDialogComponent } from './support-session-dialog.component';

const roleA = makeUser({ id: 'a1', role: 'A', estateIds: [], administratorId: null });

async function mount() {
  sessionStorage.setItem('domora.despacho-context', JSON.stringify({ userId: 'a1', id: 'd1', name: 'Fincas García' }));
  const h = setupComponent(SupportSessionDialogComponent, { user: roleA });
  const closed = vi.fn();
  h.component.closed.subscribe(closed);
  h.fixture.detectChanges();
  TestBed.tick();
  h.http.expectOne(`${API}/support-sessions/active`).flush([]);
  await settle();
  h.fixture.detectChanges();
  return { ...h, closed };
}

const submit = (el: HTMLElement) => (el.querySelector('button[type="submit"]') as HTMLButtonElement).click();

describe('SupportSessionDialogComponent', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('names the despacho and warns not to include personal data in the reason', async () => {
    const { el } = await mount();
    expect(el.textContent).toContain('Fincas García');
    expect(el.querySelector('.support-dialog__hint')?.textContent).toContain('No incluyas datos personales');
    expect(el.querySelector('textarea')?.getAttribute('maxlength')).toBe('500');
  });

  it('the reason is required: nothing is sent without it', async () => {
    const { fixture, el, http } = await mount();
    typeInto(el, 'textarea', '   ');
    submit(el);
    fixture.detectChanges();
    expect(el.querySelector('.support-dialog__error')?.textContent).toContain('Indica el motivo de la sesión de soporte.');
    http.expectNone(`${API}/support-sessions`);
  });

  it('the reason cannot exceed 500 characters', async () => {
    const { fixture, el, http } = await mount();
    typeInto(el, 'textarea', 'x'.repeat(501));
    submit(el);
    fixture.detectChanges();
    expect(el.querySelector('.support-dialog__error')?.textContent).toContain('El motivo no puede superar los 500 caracteres.');
    http.expectNone(`${API}/support-sessions`);
  });

  it('starts the session with the reason and the optional ticket, then closes', async () => {
    const { fixture, el, http, closed } = await mount();
    typeInto(el, 'textarea', 'Corregir la remesa de octubre');
    typeInto(el, 'input', 'T-42');
    submit(el);
    const req = http.expectOne(`${API}/support-sessions`);
    expect(req.request.body).toEqual({ administratorId: 'd1', reason: 'Corregir la remesa de octubre', ticketRef: 'T-42' });
    const started: SupportSession = {
      id: 's1', staffUserId: 'a1', administratorId: 'd1', reason: 'Corregir la remesa de octubre', ticketRef: 'T-42',
      startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), endedAt: null,
    };
    req.flush(started);
    await settle();
    fixture.detectChanges();
    expect(TestBed.inject(SupportSessionService).active()?.id).toBe('s1');
    expect(closed).toHaveBeenCalled();
  });

  it('shows the API error and stays open', async () => {
    const { fixture, el, http, closed } = await mount();
    typeInto(el, 'textarea', 'Corregir la remesa');
    submit(el);
    http.expectOne(`${API}/support-sessions`).flush(
      { statusCode: 400, message: ['ticketRef must be shorter than or equal to 100 characters'] },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.support-dialog__error')?.textContent).toContain('ticketRef must be shorter');
    expect(closed).not.toHaveBeenCalled();
  });

  it('«Cancelar» closes without starting anything', async () => {
    const { el, http, closed } = await mount();
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancelar') as HTMLButtonElement).click();
    expect(closed).toHaveBeenCalled();
    http.expectNone(`${API}/support-sessions`);
  });
});
