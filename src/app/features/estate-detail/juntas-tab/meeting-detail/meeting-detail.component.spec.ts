import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import { API, setupComponent, settle, type ComponentHarness } from '../../../../core/testing/component-harness';
import { MeetingDetailComponent } from './meeting-detail.component';
import type { Meeting, MeetingAttendee, MeetingVoteDelegation, OwnerProperty, QuorumResult, EligibleAttendee, VoteSession } from '../../../../core/models';

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1', estateId: 'e1', title: 'Junta Ordinaria 2026', type: 'ordinaria', status: 'convocada',
    scheduledAt1: '2026-03-01T18:00:00.000Z', scheduledAt2: '2026-03-01T18:30:00.000Z', agenda: [],
    convokedBy: 'presidente', signerRole: 'administrador', attendeeEmails: [], includeJitsi: false,
    createdByUserId: 'u1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeQuorum(overrides: Partial<QuorumResult> = {}): QuorumResult {
  return {
    convocatoria: 'primera',
    quorumRequired: true,
    quorumMet: false,
    owners: { present: 1, total: 2, percent: 50 },
    quota: { present: 40, total: 100, percent: 40 },
    missingParticipationQuotaCount: 0,
    attendingProperties: [],
    ...overrides,
  } as QuorumResult;
}

function makeProperty(overrides: Partial<OwnerProperty> = {}): OwnerProperty {
  return {
    id: 'p1', type: 'Piso', estateId: 'e1', administratorId: 'admin1', status: 'Ocupado',
    quotaMonthly: 50, balance: 0, pendingDocs: 0, openIssues: 0, ref: '1A',
    ...overrides,
  } as OwnerProperty;
}

describe('MeetingDetailComponent', () => {
  let h: ComponentHarness<MeetingDetailComponent>;

  beforeEach(() => {
    h = setupComponent(MeetingDetailComponent);
    h.component.meetingId = 'm1';
    h.component.estateId = 'e1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    h.http.match(() => true);
    h.http.verify();
  });

  async function flushInitialLoad(opts: {
    meeting?: Meeting; quorum?: QuorumResult; attendance?: MeetingAttendee[];
    properties?: OwnerProperty[]; delegations?: MeetingVoteDelegation[]; voteSessions?: VoteSession[];
    /** Estado de la versión canónica del acta (solo se pide con la junta celebrada). */
    actaStatus?: 'draft' | 'readyForSignature' | null;
  } = {}): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/meetings/m1`).flush(opts.meeting ?? makeMeeting());
    h.http.expectOne(`${API}/meetings/m1/quorum`).flush(opts.quorum ?? makeQuorum());
    h.http.expectOne(`${API}/meetings/m1/attendance`).flush(opts.attendance ?? []);
    h.http.expectOne(`${API}/estates/e1/properties`).flush(opts.properties ?? [makeProperty()]);
    h.http.expectOne(`${API}/meetings/m1/delegations`).flush(opts.delegations ?? []);
    h.http.expectOne(`${API}/meetings/m1/vote-sessions`).flush(opts.voteSessions ?? []);
    await settle();
    const requested = h.http.match(`${API}/meetings/m1/acta`);
    for (const req of requested) {
      req.flush({
        version: opts.actaStatus ? { status: opts.actaStatus } : null,
        legacy: { signed: false, hasDocx: false },
      });
    }
    await settle();
    h.fixture.detectChanges();
  }

  it('carga en paralelo junta, quórum, asistencia, censo y delegaciones', async () => {
    await flushInitialLoad();

    expect(h.el.textContent).toContain('Junta Ordinaria 2026');
    expect(h.el.textContent).toContain('1ª convocatoria');
    expect(h.el.textContent).toContain('Quórum NO alcanzado');
  });

  it('en 2ª convocatoria sin quórum exigible, lo indica', async () => {
    await flushInitialLoad({ quorum: makeQuorum({ convocatoria: 'segunda', quorumRequired: false, quorumMet: true }) });

    expect(h.el.textContent).toContain('2ª convocatoria');
    expect(h.el.textContent).toContain('Sin quórum exigible');
  });

  it('avisa si hay propiedades sin coeficiente de participación', async () => {
    await flushInitialLoad({ quorum: makeQuorum({ missingParticipationQuotaCount: 2 }) });

    expect(h.el.textContent).toContain('2 propiedades sin coeficiente de participación asignado no cuentan');
  });

  it('con votingOnly oculta quórum, pase de lista y delegaciones', async () => {
    h.component.votingOnly = true;
    await flushInitialLoad({ properties: [makeProperty({ id: 'p1', ref: '1A' })] });

    const text = h.el.textContent ?? '';
    expect(text).toContain('Junta Ordinaria 2026');
    expect(text).not.toContain('Quórum');
    expect(text).not.toContain('Pase de lista');
    expect(text).not.toContain('Delegaciones de voto');
  });

  it('"Refrescar" vuelve a pedir quórum y asistencia', async () => {
    await flushInitialLoad();

    h.el.querySelector<HTMLButtonElement>('.card__header app-btn button')!.click();
    h.http.expectOne(`${API}/meetings/m1/quorum`).flush(makeQuorum({ quorumMet: true }));
    h.http.expectOne(`${API}/meetings/m1/attendance`).flush([]);
    h.http.expectOne(`${API}/meetings/m1/vote-sessions`).flush([]);
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Quórum alcanzado');
  });

  describe('pase de lista', () => {
    it('propiedad ausente ofrece "Marcar presente"; al elegir y confirmar, hace POST roll-call', async () => {
      await flushInitialLoad({ properties: [makeProperty({ id: 'p1', ref: '1A' })] });

      h.el.querySelector<HTMLButtonElement>('button[title="Marcar presente"]')!.click();
      h.http.expectOne((r) => r.url === `${API}/meetings/m1/roll-call/eligible` && r.params.get('propertyId') === 'p1')
        .flush([{ userId: 'u2', name: 'Ana', kind: 'own' } satisfies EligibleAttendee]);
      await settle();
      h.fixture.detectChanges();

      h.component.rollCallSelectedUserId.set('u2');
      h.fixture.detectChanges();

      void h.component.confirmRollCall();
      const req = h.http.expectOne(`${API}/meetings/m1/roll-call`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ propertyId: 'p1', userId: 'u2' });
      req.flush({ id: 'a1', meetingId: 'm1', propertyId: 'p1', userId: 'u2', displayName: 'Ana', role: 'attendee', source: 'manual', joinedAt: '2026-01-01' } satisfies MeetingAttendee);
      await settle();
      h.http.expectOne(`${API}/meetings/m1/quorum`).flush(makeQuorum());
      h.http.expectOne(`${API}/meetings/m1/attendance`).flush([{ id: 'a1', meetingId: 'm1', propertyId: 'p1', userId: 'u2', displayName: 'Ana', role: 'attendee', source: 'manual', joinedAt: '2026-01-01' }]);
      h.http.expectOne(`${API}/meetings/m1/vote-sessions`).flush([]);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Ana');
      expect(h.component.toastMessage()).toBe('Asistencia marcada');
    });

    it('propiedad presente ofrece "Deshacer", que manda DELETE y refresca', async () => {
      const attendance: MeetingAttendee[] = [
        { id: 'a1', meetingId: 'm1', propertyId: 'p1', userId: 'u2', displayName: 'Ana', role: 'attendee', source: 'jitsi', joinedAt: '2026-01-01' },
      ];
      await flushInitialLoad({ properties: [makeProperty({ id: 'p1' })], attendance });

      h.el.querySelector<HTMLButtonElement>('button[title="Deshacer"]')!.click();
      const req = h.http.expectOne(`${API}/meetings/m1/roll-call/a1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      await settle();
      h.http.expectOne(`${API}/meetings/m1/quorum`).flush(makeQuorum());
      h.http.expectOne(`${API}/meetings/m1/attendance`).flush([]);
      h.http.expectOne(`${API}/meetings/m1/vote-sessions`).flush([]);
      await settle();
      h.fixture.detectChanges();

      expect(h.component.toastMessage()).toBe('Asistencia deshecha');
    });
  });

  describe('delegaciones', () => {
    it('sin delegaciones, la tabla queda vacía', async () => {
      await flushInitialLoad({ delegations: [] });

      expect(h.el.textContent).toContain('Todavía no hay delegaciones registradas');
    });

    it('lista delegaciones activas y revocadas con su badge', async () => {
      await flushInitialLoad({
        delegations: [
          { id: 'd1', meetingId: 'm1', propertyId: 'p1', delegatorUserId: 'u1', representativeUserId: 'u2', createdAt: '2026-01-01', createdByUserId: 'u1', delegatorUser: { fullName: 'Ana', email: 'a@x.com' }, representativeUser: { fullName: 'Luis', email: 'l@x.com' } },
          { id: 'd2', meetingId: 'm1', propertyId: 'p1', delegatorUserId: 'u3', representativeUserId: 'u4', createdAt: '2026-01-01', createdByUserId: 'u3', revokedAt: '2026-01-05' },
        ],
      });

      expect(h.el.textContent).toContain('Activa');
      expect(h.el.textContent).toContain('Revocada');
      expect(h.el.textContent).toContain('Luis');
    });

    it('"Registrar delegación" abre el modal compartido', async () => {
      await flushInitialLoad();

      expect(h.el.querySelector('app-register-delegation-modal')).toBeNull();
      // El primer card__header es el de quórum ("Refrescar"); el de delegaciones es el segundo.
      const delegationBtn = h.el.querySelectorAll<HTMLButtonElement>('.card__header app-btn button')[1];
      delegationBtn.click();
      h.fixture.detectChanges();

      expect(h.el.querySelector('app-register-delegation-modal')).not.toBeNull();
    });

    it('"Revocar" con confirmación manda PATCH :id/revoke y recarga', async () => {
      vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
      await flushInitialLoad({
        delegations: [
          { id: 'd1', meetingId: 'm1', propertyId: 'p1', delegatorUserId: 'u1', representativeUserId: 'u2', createdAt: '2026-01-01', createdByUserId: 'u1' },
        ],
      });

      h.el.querySelector<HTMLButtonElement>('button[title="Revocar"]')!.click();
      await settle();
      const req = h.http.expectOne(`${API}/meetings/m1/delegations/d1/revoke`);
      expect(req.request.method).toBe('PATCH');
      req.flush({ id: 'd1', meetingId: 'm1', propertyId: 'p1', delegatorUserId: 'u1', representativeUserId: 'u2', createdAt: '2026-01-01', createdByUserId: 'u1', revokedAt: '2026-01-06' });
      await settle();
      h.http.expectOne(`${API}/meetings/m1/delegations`).flush([]);
      await settle();
      h.fixture.detectChanges();

      expect(h.component.toastMessage()).toBe('Delegación revocada');
    });
  });

  it('"Volver a juntas" emite closed', async () => {
    await flushInitialLoad();
    let closed = false;
    h.component.closed.subscribe(() => { closed = true; });

    h.el.querySelector<HTMLButtonElement>('.back-btn')!.click();

    expect(closed).toBe(true);
  });

  describe('acta digital', () => {
    it('junta convocada: no muestra la sección de acta', async () => {
      await flushInitialLoad({ meeting: makeMeeting({ status: 'convocada' }) });
      expect(h.el.textContent).not.toContain('Plazo para firmar el acta');
      expect(h.el.querySelectorAll('.acta')).toHaveLength(0);
    });

    it('junta celebrada sin firmar: pide email de presidente y secretario', async () => {
      await flushInitialLoad({ meeting: makeMeeting({ status: 'celebrada', celebratedAt: new Date().toISOString() }) });
      expect(h.el.textContent).toContain('Plazo para firmar el acta');
      expect(h.el.querySelectorAll('.acta__signer-input input[type="email"]')).toHaveLength(2);
    });

    it('sin el acta enviada a firma, ningún botón de firmar está habilitado y se explica el motivo', async () => {
      await flushInitialLoad({ meeting: makeMeeting({ status: 'celebrada', celebratedAt: new Date().toISOString() }), actaStatus: 'draft' });
      h.component.presidenteEmail.set('presi@x.com');
      h.component.secretarioEmail.set('secre@x.com');
      h.fixture.detectChanges();

      const buttons = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.acta__signer-input app-btn button'));
      expect(buttons).toHaveLength(2);
      expect(buttons.every((b) => b.disabled)).toBe(true);
      expect(h.el.textContent).toContain('Revisar');
    });

    it('con el acta enviada a firma firma primero el presidente; el secretario espera a que el presidente firme', async () => {
      await flushInitialLoad({ meeting: makeMeeting({ status: 'celebrada', celebratedAt: new Date().toISOString() }), actaStatus: 'readyForSignature' });
      h.component.presidenteEmail.set('presi@x.com');
      h.component.secretarioEmail.set('secre@x.com');
      h.fixture.detectChanges();

      const [presidente, secretario] = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.acta__signer-input app-btn button'));
      expect(presidente.disabled).toBe(false);
      expect(secretario.disabled).toBe(true);
    });

    it('con el presidente ya firmado, el secretario puede firmar', async () => {
      await flushInitialLoad({
        meeting: makeMeeting({ status: 'celebrada', celebratedAt: new Date().toISOString(), actaSignedByPresidenteUserId: 'u1' }),
        actaStatus: 'readyForSignature',
      });
      h.component.secretarioEmail.set('secre@x.com');
      h.fixture.detectChanges();

      const secretario = h.el.querySelector<HTMLButtonElement>('.acta__signer-input app-btn button')!;
      expect(secretario.disabled).toBe(false);
    });

    it('firmar presidente manda POST con role y signerEmail', async () => {
      await flushInitialLoad({ meeting: makeMeeting({ status: 'celebrada', celebratedAt: new Date().toISOString() }), actaStatus: 'readyForSignature' });

      // ngModel + eventos `input` no propaga de forma fiable en este runner
      // (zoneless + Vitest) — se asigna el campo del componente directo,
      // mismo criterio documentado en component-harness.ts.
      h.component.presidenteEmail.set('presi@x.com');
      h.fixture.detectChanges();

      h.el.querySelector<HTMLButtonElement>('.acta__signer-input app-btn button')!.click();
      const req = h.http.expectOne(`${API}/meetings/m1/acta/sign`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ role: 'presidente', signerEmail: 'presi@x.com' });
      req.flush(makeMeeting({ status: 'celebrada', actaSignedByPresidenteUserId: 'u1' }));
      await settle();
      h.fixture.detectChanges();

      expect(h.component.toastMessage()).toBe('Firma registrada');
    });

    it('con acta ya firmada, ofrece descargar y enviar a todos los propietarios', async () => {
      await flushInitialLoad({
        meeting: makeMeeting({
          status: 'celebrada', celebratedAt: new Date().toISOString(),
          actaSignedByPresidenteUserId: 'u1', actaSignedBySecretarioUserId: 'u2', actaSignedAt: new Date().toISOString(),
        }),
      });

      expect(h.el.textContent).toContain('Acta firmada');

      vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
      const sendBtn = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.acta__signed app-btn button')).find((b) => b.textContent?.includes('Enviar a todos'))!;
      sendBtn.click();
      await settle();
      const req = h.http.expectOne(`${API}/meetings/m1/acta/send`);
      expect(req.request.method).toBe('POST');
      req.flush({ sentCount: 3 });
      await settle();
      h.http.expectOne(`${API}/meetings/m1`).flush(makeMeeting({
        status: 'celebrada', actaSignedAt: new Date().toISOString(), actaDistributedAt: new Date().toISOString(),
      }));
      await settle();
      h.fixture.detectChanges();

      expect(h.component.toastMessage()).toBe('Acta enviada a 3 propietario(s)');
    });
  });

  describe('mayoría al abrir la votación', () => {
    it('"Abrir votación" no pide la mayoría: abre directamente con la sugerida cuando la junta no la fijó (ascensor: art. 17.2 LPH, no 3/5)', async () => {
      await flushInitialLoad({
        meeting: makeMeeting({
          agenda: [{
            id: 'a1', title: 'Instalación de ascensor en el portal', hasVote: true,
            voteTemplate: { questions: [{ title: '¿Aprobar la instalación?', type: 'single_choice', options: ['A favor', 'En contra'] }] },
          }],
        }),
      });

      h.el.querySelector<HTMLButtonElement>('.vote-item app-btn button')!.click();
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('select')).toBeNull();
      expect(h.el.textContent).not.toContain('Sugerencia automática');
      const req = h.http.expectOne(`${API}/meetings/m1/vote-sessions`);
      expect(req.request.body).toEqual({ agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple' });
    });

    it('sin palabras clave, abre con mayoría simple (régimen residual)', async () => {
      await flushInitialLoad({
        meeting: makeMeeting({
          agenda: [{
            id: 'a1', title: 'Aprobación de cuentas del ejercicio 2025', hasVote: true,
            voteTemplate: { questions: [{ title: '¿Aprobar?', type: 'single_choice', options: ['A favor', 'En contra'] }] },
          }],
        }),
      });

      h.el.querySelector<HTMLButtonElement>('.vote-item app-btn button')!.click();
      await settle();

      const req = h.http.expectOne(`${API}/meetings/m1/vote-sessions`);
      expect(req.request.body.majorityType).toBe('mayoriaSimple');
    });
  });
});
