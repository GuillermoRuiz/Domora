import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { OwnerIssueDetail } from '../../../core/owner-issues.models';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { issueDetail } from '../testing/owner-issue-fixtures';
import { IssueDetailComponent } from './issue-detail.component';

registerLocaleData(localeEs);

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('IssueDetailComponent', () => {
  let h: ComponentHarness<IssueDetailComponent>;
  let closed: number;
  let changed: number;

  async function mount(detail: OwnerIssueDetail = issueDetail()) {
    h = setupComponent(IssueDetailComponent, { user: makeUser() });
    h.fixture.componentRef.setInput('issueId', detail.id);
    closed = 0;
    changed = 0;
    h.component.closed.subscribe(() => closed++);
    h.component.changed.subscribe(() => changed++);
    h.fixture.detectChanges();
    await settle();
    h.http.expectOne(`${API}/me/issues/${detail.id}`).flush(detail);
    await settle();
    h.fixture.detectChanges();
  }

  /** Every action answers with the updated detail: let it render. */
  async function rerender() {
    await settle();
    h.fixture.detectChanges();
  }

  afterEach(() => h?.http.verify());

  it('shows title, ref, status, meta, description, follow-up with the pending node and the expected response', async () => {
    await mount();
    expect(text(h.el.querySelector('[data-detail-title]'))).toBe('Gotera en el garaje');
    expect(text(h.el.querySelector('[data-detail-ref]'))).toBe('INC-0001');
    expect(text(h.el.querySelector('.detail__header app-status-pill'))).toBe('Abierta');
    expect(text(h.el.querySelector('[data-meta="tipo"]'))).toContain('Fuga');
    expect(text(h.el.querySelector('[data-meta="ubicacion"]'))).toContain('Garaje');
    expect(text(h.el.querySelector('[data-meta="fecha"]'))).toContain('20 oct 2026');
    expect(text(h.el.querySelector('[data-description]'))).toBe('Cae agua del techo junto a la plaza 12 cuando llueve.');
    expect(h.el.querySelectorAll('app-issue-timeline [data-entry]').length).toBe(1);
    expect(text(h.el.querySelector('app-issue-timeline [data-pending] strong'))).toBe('Pendiente de actualización');
    expect(text(h.el.querySelector('app-issue-timeline [data-pending] .timeline__text'))).toBe('Te notificaremos cualquier novedad');
    expect(text(h.el.querySelector('[data-expected]'))).toBe('Respuesta estimada: 3 días');
  });

  it('a closed issue has no pending node nor reply box', async () => {
    await mount(issueDetail({ status: 'Resuelta', canReply: false, canWithdraw: false }));
    expect(h.el.querySelector('[data-pending]')).toBeNull();
    expect(h.el.querySelector('[data-reply]')).toBeNull();
    expect(text(h.el.querySelector('.detail__header app-status-pill'))).toBe('Resuelta');
  });

  it('when the manager asks for information shows the banner and the reply is posted, then the detail and list refresh', async () => {
    await mount(issueDetail({ status: 'PendienteInformacion' }));
    expect(text(h.el.querySelector('[data-info-banner]'))).toContain('El administrador necesita información');
    const box = h.el.querySelector<HTMLTextAreaElement>('textarea[data-reply]')!;
    box.value = 'Es en la plaza 12';
    box.dispatchEvent(new Event('input'));
    h.fixture.detectChanges();
    h.el.querySelector<HTMLButtonElement>('[data-action="reply"]')!.click();
    const req = h.http.expectOne(`${API}/me/issues/i1/replies`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ text: 'Es en la plaza 12' });
    req.flush(issueDetail({ status: 'Abierta' }));
    await rerender();
    expect(changed).toBe(1);
    expect(h.el.querySelector('[data-info-banner]')).toBeNull();
    expect(h.el.querySelector<HTMLTextAreaElement>('textarea[data-reply]')!.value).toBe('');
  });

  it('«Retirar» asks for confirmation before withdrawing; cancelling does nothing', async () => {
    await mount();
    const ask = vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    h.el.querySelector<HTMLButtonElement>('[data-action="withdraw"]')!.click();
    await settle();
    h.http.expectNone(`${API}/me/issues/i1/withdraw`);
    h.el.querySelector<HTMLButtonElement>('[data-action="withdraw"]')!.click();
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    h.http.expectOne(`${API}/me/issues/i1/withdraw`).flush(issueDetail({ status: 'Retirada', canWithdraw: false, canReply: false }));
    await rerender();
    expect(changed).toBe(1);
    expect(text(h.el.querySelector('.detail__header app-status-pill'))).toBe('Retirada');
    expect(h.el.querySelector('[data-action="withdraw"]')).toBeNull();
  });

  it('«Reabrir» reopens a recently resolved issue', async () => {
    await mount(issueDetail({ status: 'Resuelta', canReply: false, canWithdraw: false, canReopen: true }));
    h.el.querySelector<HTMLButtonElement>('[data-action="reopen"]')!.click();
    const req = h.http.expectOne(`${API}/me/issues/i1/reopen`);
    expect(req.request.method).toBe('POST');
    req.flush(issueDetail());
    await rerender();
    expect(changed).toBe(1);
    expect(h.el.querySelector('[data-action="reopen"]')).toBeNull();
  });

  it('rates the resolution with stars and an optional comment', async () => {
    await mount(issueDetail({ status: 'Resuelta', canReply: false, canWithdraw: false, canRate: true }));
    expect(h.el.querySelector<HTMLButtonElement>('[data-action="rate"]')!.disabled).toBe(true);
    h.el.querySelector<HTMLButtonElement>('[data-star="4"]')!.click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-star="4"]')!.getAttribute('aria-pressed')).toBe('true');
    const comment = h.el.querySelector<HTMLTextAreaElement>('textarea[data-rating-comment]')!;
    comment.value = 'Muy rápido';
    comment.dispatchEvent(new Event('input'));
    h.fixture.detectChanges();
    h.el.querySelector<HTMLButtonElement>('[data-action="rate"]')!.click();
    const req = h.http.expectOne(`${API}/me/issues/i1/rating`);
    expect(req.request.body).toEqual({ rating: 4, comment: 'Muy rápido' });
    req.flush(issueDetail({ status: 'Resuelta', canReply: false, canWithdraw: false, rating: 4, ratingComment: 'Muy rápido' }));
    await rerender();
    expect(changed).toBe(1);
    expect(h.el.querySelector('[data-action="rate"]')).toBeNull();
    expect(text(h.el.querySelector('[data-rating]'))).toContain('4 de 5');
  });

  it("another owner's common-area issue offers «Me afecta también» with its count and shows no attachments", async () => {
    await mount(issueDetail({ mine: false, canReply: false, canWithdraw: false, canMarkAffected: true, affectedCount: 2 }));
    expect(h.el.querySelector('[data-attachments]')).toBeNull();
    const toggle = h.el.querySelector<HTMLButtonElement>('[data-affected]')!;
    expect(text(toggle)).toContain('Me afecta también');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(text(h.el.querySelector('[data-affected-count]'))).toBe('2 vecinos afectados');
    toggle.click();
    const put = h.http.expectOne(`${API}/me/issues/i1/affected`);
    expect(put.request.method).toBe('PUT');
    put.flush(issueDetail({ mine: false, canReply: false, canMarkAffected: true, affectedCount: 3, affectedByMe: true }));
    await rerender();
    expect(h.el.querySelector('[data-affected]')!.getAttribute('aria-pressed')).toBe('true');
    expect(text(h.el.querySelector('[data-affected-count]'))).toBe('3 vecinos afectados');
    h.el.querySelector<HTMLButtonElement>('[data-affected]')!.click();
    const del = h.http.expectOne(`${API}/me/issues/i1/affected`);
    expect(del.request.method).toBe('DELETE');
    del.flush(issueDetail({ mine: false, canReply: false, canMarkAffected: true, affectedCount: 2 }));
    await rerender();
    expect(changed).toBe(2);
  });

  it('adds attachments: rejects files over 10 MB and uploads the valid ones, then reloads', async () => {
    await mount();
    const gallery = h.el.querySelector('[data-attachments] app-attachment-gallery');
    expect(gallery?.querySelector('[data-add-files]')).not.toBeNull();
    const input = h.el.querySelector<HTMLInputElement>('[data-add-files] input[type=file]')!;
    const big = new File(['x'], 'enorme.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    const ok = new File(['x'], 'gotera.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [big, ok], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
    const upload = h.http.expectOne(`${API}/issues/i1/photos`);
    expect(((upload.request.body as FormData).get('file') as File).name).toBe('gotera.pdf');
    upload.flush({ id: 'a9' });
    await settle();
    h.http.expectOne(`${API}/me/issues/i1`).flush(issueDetail({ attachments: [{ id: 'a9', fileName: 'gotera.pdf', mimeType: 'application/pdf', size: 1, uploadedAt: '2026-10-24T10:00:00.000Z' }] }));
    await settle();
    h.fixture.detectChanges();
    expect(text(h.el.querySelector('[data-attachment-error]'))).toContain('«enorme.jpg» supera los 10 MB.');
    expect(h.el.querySelector('[data-attachment="a9"]')).not.toBeNull();
    expect(changed).toBe(1);
  });

  it('the close button and Escape close the panel', async () => {
    await mount();
    h.el.querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
    expect(closed).toBe(1);
    h.el.querySelector('.detail')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(2);
  });

  it('a backend error of an action is shown inline', async () => {
    await mount(issueDetail({ status: 'Resuelta', canReply: false, canWithdraw: false, canReopen: true }));
    h.el.querySelector<HTMLButtonElement>('[data-action="reopen"]')!.click();
    h.http.expectOne(`${API}/me/issues/i1/reopen`).flush({ message: 'Solo se puede reabrir durante los 7 días siguientes a su resolución.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    h.fixture.detectChanges();
    expect(text(h.el.querySelector('[data-action-error]'))).toBe('Solo se puede reabrir durante los 7 días siguientes a su resolución.');
    expect(changed).toBe(0);
  });

  it('if the detail cannot be loaded it says so', async () => {
    h = setupComponent(IssueDetailComponent, { user: makeUser() });
    h.fixture.componentRef.setInput('issueId', 'i404');
    h.fixture.detectChanges();
    await settle();
    h.http.expectOne(`${API}/me/issues/i404`).flush({ message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle();
    h.fixture.detectChanges();
    expect(text(h.el.querySelector('[data-detail-error]'))).toBe('No se pudo cargar la incidencia. Inténtalo de nuevo.');
  });
});
