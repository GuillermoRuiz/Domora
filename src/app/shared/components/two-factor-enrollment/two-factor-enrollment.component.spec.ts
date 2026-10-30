import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { TwoFactorEnrollmentComponent } from './two-factor-enrollment.component';

describe('TwoFactorEnrollmentComponent', () => {
  let h: ComponentHarness<TwoFactorEnrollmentComponent>;

  beforeEach(() => {
    h = setupComponent(TwoFactorEnrollmentComponent);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    h.http.match(() => true);
    h.http.verify();
  });

  async function flushStatus(enabled: boolean): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/auth/2fa/status`).flush({ enabled });
    await settle();
    h.fixture.detectChanges();
  }

  it('desactivado: ofrece "Activar verificación en dos pasos"', async () => {
    await flushStatus(false);
    expect(h.el.textContent).toContain('Desactivada');
    expect(h.el.textContent).toContain('Activar verificación en dos pasos');
  });

  it('activado: ofrece regenerar códigos y desactivar', async () => {
    await flushStatus(true);
    expect(h.el.textContent).toContain('Activada');
    expect(h.el.textContent).toContain('Regenerar códigos de respaldo');
    expect(h.el.textContent).toContain('Desactivar');
  });

  it('flujo completo: enrolar, confirmar con código, muestra los códigos de respaldo', async () => {
    await flushStatus(false);

    h.el.querySelector<HTMLButtonElement>('app-btn button')!.click();
    const enrollReq = h.http.expectOne(`${API}/auth/2fa/enroll`);
    expect(enrollReq.request.method).toBe('POST');
    enrollReq.flush({ secret: 'SECRETSECRETSECRET', qrDataUrl: 'data:image/png;base64,abc' });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,abc');

    h.component.code.set('123456');
    h.fixture.detectChanges();

    const confirmBtn = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.tfa-enroll__actions app-btn button'))
      .find((b) => b.textContent?.includes('Confirmar'))!;
    confirmBtn.click();
    const verifyReq = h.http.expectOne(`${API}/auth/2fa/verify-enable`);
    expect(verifyReq.request.method).toBe('POST');
    expect(verifyReq.request.body).toEqual({ secret: 'SECRETSECRETSECRET', code: '123456' });
    verifyReq.flush({ backupCodes: ['1111-2222', '3333-4444'] });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('1111-2222');
    expect(h.component.enabled()).toBe(true);
  });

  it('código incorrecto: muestra el mensaje de error del backend sin activar nada', async () => {
    await flushStatus(false);

    h.el.querySelector<HTMLButtonElement>('app-btn button')!.click();
    h.http.expectOne(`${API}/auth/2fa/enroll`).flush({ secret: 'SECRETSECRETSECRET', qrDataUrl: 'data:image/png;base64,abc' });
    await settle();
    h.fixture.detectChanges();

    h.component.code.set('000000');
    h.fixture.detectChanges();
    const confirmBtn = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.tfa-enroll__actions app-btn button'))
      .find((b) => b.textContent?.includes('Confirmar'))!;
    confirmBtn.click();
    h.http.expectOne(`${API}/auth/2fa/verify-enable`).flush(
      { message: 'Código incorrecto — comprueba la hora del teléfono y vuelve a intentarlo.' },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Código incorrecto');
    expect(h.component.enabled()).toBe(false);
  });

  it('desactivar, con confirmación, manda POST y refleja el nuevo estado', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await flushStatus(true);

    const disableBtn = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.tfa-enroll__actions app-btn button'))
      .find((b) => b.textContent?.includes('Desactivar'))!;
    disableBtn.click();
    const req = h.http.expectOne(`${API}/auth/2fa/disable`);
    expect(req.request.method).toBe('POST');
    req.flush(null);
    await settle();
    h.fixture.detectChanges();

    expect(h.component.enabled()).toBe(false);
    expect(h.el.textContent).toContain('Activar verificación en dos pasos');
  });
});
