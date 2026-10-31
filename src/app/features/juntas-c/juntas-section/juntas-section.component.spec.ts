import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { JuntasSectionComponent } from './juntas-section.component';
import type { Meeting, MeetingVoteDelegation } from '../../../core/models';

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1', estateId: 'e1', title: 'Junta Ordinaria 2026', type: 'ordinaria', status: 'convocada',
    scheduledAt1: '2026-03-01T18:00:00.000Z', scheduledAt2: '2026-03-01T18:30:00.000Z', agenda: [],
    convokedBy: 'presidente', signerRole: 'administrador', attendeeEmails: [], includeJitsi: false,
    createdByUserId: 'u1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('JuntasSectionComponent', () => {
  let h: ComponentHarness<JuntasSectionComponent>;

  beforeEach(() => {
    h = setupComponent(JuntasSectionComponent, { user: { id: 'u1', fullName: 'Ana', email: 'ana@demo.app', role: 'C' } as any });
    h.component.estateId = 'e1';
    h.component.propertyId = 'p1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    h.http.match(() => true);
    h.http.verify();
  });

  async function flushMeetingsList(meetings: Meeting[]): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates/e1/meetings`).flush(meetings);
    await settle();
    h.fixture.detectChanges();
  }

  async function flushPerMeeting(meetingId: string, delegations: MeetingVoteDelegation[], eligible: { userId: string; name: string }[]): Promise<void> {
    h.http.expectOne(`${API}/meetings/${meetingId}/delegations`).flush(delegations);
    h.http.expectOne((r) => r.url === `${API}/meetings/${meetingId}/delegations/eligible-delegators` && r.params.get('propertyId') === 'p1').flush(eligible);
    h.http.expectOne(`${API}/meetings/${meetingId}/vote-sessions`).flush([]);
    await settle();
    h.fixture.detectChanges();
  }

  /** Con una votación abierta se pregunta si esta propiedad puede votar (art. 15.2 LPH). */
  async function flushVotingRight(meetingId: string, canVote: boolean): Promise<void> {
    const req = h.http.expectOne((r) => r.url === `${API}/meetings/${meetingId}/vote-sessions/voting-right` && r.params.get('propertyId') === 'p1');
    req.flush(canVote ? { canVote: true, reason: null } : { canVote: false, reason: 'debt' });
    await settle();
    h.fixture.detectChanges();
  }

  it('filtra a solo juntas convocadas y descarta las que no son de la propiedad', async () => {
    await flushMeetingsList([
      makeMeeting({ id: 'm1', status: 'convocada' }),
      makeMeeting({ id: 'm2', status: 'celebrada' }),
    ]);
    // Solo se piden delegaciones/eligibles de la junta convocada (m1); de la celebrada (m2) solo si le toca firmar.
    await flushPerMeeting('m1', [], [{ userId: 'u1', name: 'Ana' }]);

    expect(h.el.textContent).toContain('Junta Ordinaria 2026');
    h.http.expectNone((r) => r.url.includes('/meetings/m2/') && !r.url.endsWith('/acta/signing'));
  });

  it('sin voto en la propiedad y sin delegación previa, la junta no aparece', async () => {
    await flushMeetingsList([makeMeeting({ id: 'm1' })]);
    await flushPerMeeting('m1', [], []); // no elegible, sin delegación

    expect(h.el.textContent).toContain('Sin juntas pendientes');
  });

  it('con voto, ofrece "Delegar mi voto" que abre el modal bloqueado a la propia propiedad/usuario', async () => {
    await flushMeetingsList([makeMeeting({ id: 'm1' })]);
    await flushPerMeeting('m1', [], [{ userId: 'u1', name: 'Ana' }]);

    expect(h.el.querySelector('app-register-delegation-modal')).toBeNull();
    h.el.querySelector<HTMLButtonElement>('app-btn button')!.click();
    h.fixture.detectChanges();

    const modal = h.el.querySelector('app-register-delegation-modal');
    expect(modal).not.toBeNull();
    expect(h.component.delegationTargetMeetingId()).toBe('m1');
  });

  it('con delegación activa propia, muestra a quién delegó y permite revocar', async () => {
    await flushMeetingsList([makeMeeting({ id: 'm1' })]);
    await flushPerMeeting('m1', [
      { id: 'd1', meetingId: 'm1', propertyId: 'p1', delegatorUserId: 'u1', representativeUserId: 'u2', createdAt: '2026-01-01', createdByUserId: 'u1', representativeUser: { fullName: 'Luis', email: 'l@x.com' } },
    ], []);

    expect(h.el.textContent).toContain('Voto delegado');
    expect(h.el.textContent).toContain('Luis');

    vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
    h.el.querySelector<HTMLButtonElement>('button[title="Revocar delegación"]')!.click();
    await settle();
    const req = h.http.expectOne(`${API}/meetings/m1/delegations/d1/revoke`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ id: 'd1', meetingId: 'm1', propertyId: 'p1', delegatorUserId: 'u1', representativeUserId: 'u2', createdAt: '2026-01-01', createdByUserId: 'u1', revokedAt: '2026-01-06' });
    await settle();
    // reload() vuelve a pedir todo desde cero.
    h.http.expectOne(`${API}/estates/e1/meetings`).flush([makeMeeting({ id: 'm1' })]);
    await settle();
    await flushPerMeeting('m1', [], []);

    expect(h.component.toastMessage()).toBe('Delegación revocada');
  });

  it('con una votación abierta, permite elegir una opción y votar por la propiedad', async () => {
    const meeting = makeMeeting({
      id: 'm1',
      agenda: [{ id: 'a1', title: 'Reforma del tejado', hasVote: true, voteTemplate: { questions: [{ title: '¿Aprobar?', type: 'single_choice', options: ['A favor', 'En contra'] }] } }],
    });
    await flushMeetingsList([meeting]);
    h.http.expectOne(`${API}/meetings/m1/delegations`).flush([]);
    h.http.expectOne((r) => r.url === `${API}/meetings/m1/delegations/eligible-delegators`).flush([]);
    h.http.expectOne(`${API}/meetings/m1/vote-sessions`).flush([
      { id: 's1', meetingId: 'm1', agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple', status: 'abierta', openedAt: '2026-01-01', openedByUserId: 'b1', require2fa: false },
    ]);
    await settle();
    await flushVotingRight('m1', true);

    expect(h.el.textContent).toContain('¿Aprobar?');
    const radios = h.el.querySelectorAll<HTMLInputElement>('.votes-block__option input[type="radio"]');
    expect(radios).toHaveLength(2);

    radios[0].dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
    expect(h.component.pendingVote()['s1']).toBe(0);

    h.el.querySelector<HTMLButtonElement>('.votes-block__question app-btn button')!.click();
    const req = h.http.expectOne(`${API}/meetings/m1/vote-sessions/s1/vote`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ propertyId: 'p1', optionIndex: 0 });
    req.flush(null);
    await settle();

    // castVote() recarga todo desde cero.
    h.http.expectOne(`${API}/estates/e1/meetings`).flush([meeting]);
    await settle();
    await flushPerMeeting('m1', [], []);

    expect(h.component.toastMessage()).toBe('Voto registrado');
  });

  it('sesión con require2fa: exige el código y lo manda en el POST', async () => {
    const meeting = makeMeeting({
      id: 'm1',
      agenda: [{ id: 'a1', title: 'Reforma del tejado', hasVote: true, voteTemplate: { questions: [{ title: '¿Aprobar?', type: 'single_choice', options: ['A favor', 'En contra'] }] } }],
    });
    await flushMeetingsList([meeting]);
    h.http.expectOne(`${API}/meetings/m1/delegations`).flush([]);
    h.http.expectOne((r) => r.url === `${API}/meetings/m1/delegations/eligible-delegators`).flush([]);
    h.http.expectOne(`${API}/meetings/m1/vote-sessions`).flush([
      { id: 's1', meetingId: 'm1', agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple', status: 'abierta', openedAt: '2026-01-01', openedByUserId: 'b1', require2fa: true },
    ]);
    await settle();
    await flushVotingRight('m1', true);

    expect(h.el.querySelector('.votes-block__totp')).not.toBeNull();

    const radios = h.el.querySelectorAll<HTMLInputElement>('.votes-block__option input[type="radio"]');
    radios[0].dispatchEvent(new Event('change'));
    h.fixture.detectChanges();

    const voteBtn = h.el.querySelector<HTMLButtonElement>('.votes-block__question app-btn button')!;
    expect(voteBtn.disabled).toBe(true); // sin código todavía

    h.component.setTotpCode('s1', '123456');
    h.fixture.detectChanges();
    expect(voteBtn.disabled).toBe(false);

    voteBtn.click();
    const req = h.http.expectOne(`${API}/meetings/m1/vote-sessions/s1/vote`);
    expect(req.request.body).toEqual({ propertyId: 'p1', optionIndex: 0, totpCode: '123456' });
    req.flush(null);
    await settle();
    h.http.expectOne(`${API}/estates/e1/meetings`).flush([meeting]);
    await settle();
    await flushPerMeeting('m1', [], []);

    expect(h.component.toastMessage()).toBe('Voto registrado');
  });
  describe('deuda pendiente (art. 15.2 LPH)', () => {
    const openVoteMeeting = () => makeMeeting({
      id: 'm1',
      agenda: [{ id: 'a1', title: 'Reforma del tejado', hasVote: true, voteTemplate: { questions: [{ title: '¿Aprobar?', type: 'single_choice', options: ['A favor', 'En contra'] }] } }],
    });
    const flushOpenVote = async (canVote: boolean) => {
      await flushMeetingsList([openVoteMeeting()]);
      h.http.expectOne(`${API}/meetings/m1/delegations`).flush([]);
      h.http.expectOne((r) => r.url === `${API}/meetings/m1/delegations/eligible-delegators`).flush([]);
      h.http.expectOne(`${API}/meetings/m1/vote-sessions`).flush([
        { id: 's1', meetingId: 'm1', agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple', status: 'abierta', openedAt: '2026-01-01', openedByUserId: 'b1', require2fa: false },
      ]);
      await settle();
      await flushVotingRight('m1', canVote);
    };

    it('con deuda vencida el botón dice «Deuda pendiente», queda deshabilitado y no se puede votar', async () => {
      await flushOpenVote(false);
      h.el.querySelectorAll<HTMLInputElement>('.votes-block__option input[type="radio"]')[0].dispatchEvent(new Event('change'));
      h.fixture.detectChanges();
      const button = h.el.querySelector<HTMLButtonElement>('.votes-block__question app-btn button')!;
      expect(button.textContent?.trim()).toBe('Deuda pendiente');
      expect(button.disabled).toBe(true);
      expect(h.el.querySelector('.votes-block__question app-btn')!.getAttribute('title')).toContain('art. 15.2 LPH');
    });

    it('al corriente de pago el botón sigue diciendo «Votar»', async () => {
      await flushOpenVote(true);
      expect(h.el.querySelector<HTMLButtonElement>('.votes-block__question app-btn button')!.textContent?.trim()).toBe('Votar');
    });
  });

  describe('firma del acta como presidente', () => {
    const signing = (canSign: boolean) => ({ readyForSignature: true, presidenteSigned: false, secretarioSigned: false, canSign: { presidente: canSign, secretario: false } });

    it('si es el presidente y el acta espera su firma, ofrece «Firmar»', async () => {
      await flushMeetingsList([makeMeeting({ id: 'm2', status: 'celebrada', title: 'Junta celebrada' })]);
      h.http.expectOne(`${API}/meetings/m2/acta/signing`).flush(signing(true));
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Junta celebrada');
      expect(h.el.textContent).toContain('Acta pendiente de tu firma como presidente');
      const button = h.el.querySelector<HTMLButtonElement>('app-btn button')!;
      expect(button.textContent).toContain('Firmar');
    });

    it('si no es el presidente (o no le toca) no aparece nada que firmar', async () => {
      await flushMeetingsList([makeMeeting({ id: 'm2', status: 'celebrada' })]);
      h.http.expectOne(`${API}/meetings/m2/acta/signing`).flush(signing(false));
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Sin juntas pendientes');
      expect(h.el.textContent).not.toContain('Firmar');
    });

    it('al confirmar firma como presidente y la fila desaparece', async () => {
      vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
      await flushMeetingsList([makeMeeting({ id: 'm2', status: 'celebrada' })]);
      h.http.expectOne(`${API}/meetings/m2/acta/signing`).flush(signing(true));
      await settle();
      h.fixture.detectChanges();

      void h.component.signAsPresident(h.component.signatures()[0]);
      await settle();
      const req = h.http.expectOne(`${API}/meetings/m2/acta/sign-self`);
      expect(req.request.body).toEqual({ role: 'presidente' });
      req.flush(makeMeeting({ id: 'm2', status: 'celebrada', actaSignedByPresidenteUserId: 'u1' }));
      await settle();

      expect(h.component.signatures()).toHaveLength(0);
      expect(h.component.toastMessage()).toBe('Firma registrada');
    });
  });
});
