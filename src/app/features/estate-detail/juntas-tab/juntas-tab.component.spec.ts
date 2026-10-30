import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { JuntasTabComponent } from './juntas-tab.component';
import type { Meeting } from '../../../core/models';

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1', estateId: 'e1', title: 'Junta Ordinaria 2026', type: 'ordinaria', status: 'convocada',
    scheduledAt1: '2026-03-01T18:00:00.000Z', scheduledAt2: '2026-03-01T18:30:00.000Z', agenda: [],
    convokedBy: 'presidente', signerRole: 'administrador', attendeeEmails: [], includeJitsi: false,
    createdByUserId: 'u1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('JuntasTabComponent', () => {
  let h: ComponentHarness<JuntasTabComponent>;

  beforeEach(() => {
    h = setupComponent(JuntasTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    h.http.verify();
  });

  async function flushInitialLoad(meetings: Meeting[]): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/meetings`).flush(meetings);
    h.http.expectOne((r) => r.url === `${API}/estates/e1/meetings/participation-history`).flush([]);
    await settle();
    h.fixture.detectChanges();
  }

  const closeButtons = () => h.el.querySelectorAll<HTMLButtonElement>('button[title="Marcar como celebrada"], button[title="Cancelar junta"]');

  it('carga las juntas al montar y muestra su estado', async () => {
    await flushInitialLoad([
      makeMeeting({ id: 'm1', status: 'convocada' }),
      makeMeeting({ id: 'm2', title: 'Junta Extra', status: 'celebrada' }),
    ]);

    expect(h.el.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(h.el.textContent).toContain('Convocada');
    expect(h.el.textContent).toContain('Celebrada');
  });

  it('sin juntas, muestra el estado vacío', async () => {
    await flushInitialLoad([]);

    expect(h.el.textContent).toContain('Todavía no hay juntas convocadas');
  });

  describe('cierre de la junta', () => {
    it('solo una junta convocada ofrece "celebrada" y "cancelar" — las cerradas son definitivas', async () => {
      await flushInitialLoad([
        makeMeeting({ id: 'm1', status: 'convocada' }),
        makeMeeting({ id: 'm2', status: 'celebrada' }),
        makeMeeting({ id: 'm3', status: 'cancelada' }),
      ]);

      const rows = h.el.querySelectorAll('tbody tr');
      expect(rows[0].querySelectorAll('button[title="Marcar como celebrada"], button[title="Cancelar junta"]')).toHaveLength(2);
      expect(rows[1].querySelectorAll('button[title="Marcar como celebrada"], button[title="Cancelar junta"]')).toHaveLength(0);
      expect(rows[2].querySelectorAll('button[title="Marcar como celebrada"], button[title="Cancelar junta"]')).toHaveLength(0);
    });

    it('con confirmación, manda PATCH status=celebrada y refleja el cambio en la fila', async () => {
      const confirmSpy = vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
      await flushInitialLoad([makeMeeting({ id: 'm1' })]);

      h.el.querySelector<HTMLButtonElement>('button[title="Marcar como celebrada"]')!.click();
      await settle();
      const req = h.http.expectOne(`${API}/meetings/m1/status`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'celebrada' });
      req.flush(makeMeeting({ id: 'm1', status: 'celebrada' }));
      await settle();
      h.fixture.detectChanges();

      expect(confirmSpy).toHaveBeenCalled();
      expect(h.el.querySelector('tbody tr')!.textContent).toContain('Celebrada');
      expect(closeButtons()).toHaveLength(0);
      expect(h.component.toastMessage()).toBe('Junta marcada como celebrada');
    });

    it('cancelar manda status=cancelada', async () => {
      vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
      await flushInitialLoad([makeMeeting({ id: 'm1' })]);

      h.el.querySelector<HTMLButtonElement>('button[title="Cancelar junta"]')!.click();
      await settle();
      const req = h.http.expectOne(`${API}/meetings/m1/status`);
      expect(req.request.body).toEqual({ status: 'cancelada' });
      req.flush(makeMeeting({ id: 'm1', status: 'cancelada' }));
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('tbody tr')!.textContent).toContain('Cancelada');
      expect(h.component.toastMessage()).toBe('Junta cancelada');
    });

    it('sin confirmación, no manda ninguna petición', async () => {
      vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(false);
      await flushInitialLoad([makeMeeting({ id: 'm1' })]);

      h.el.querySelector<HTMLButtonElement>('button[title="Marcar como celebrada"]')!.click();
      await settle();

      h.http.expectNone((r) => r.method === 'PATCH');
      expect(h.el.querySelector('tbody tr')!.textContent).toContain('Convocada');
    });

    it('si el backend rechaza el cierre, muestra su mensaje y la fila no cambia', async () => {
      vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await flushInitialLoad([makeMeeting({ id: 'm1' })]);

      h.el.querySelector<HTMLButtonElement>('button[title="Marcar como celebrada"]')!.click();
      await settle();
      h.http.expectOne(`${API}/meetings/m1/status`).flush(
        { message: 'No se puede marcar como celebrada una junta antes de su primera convocatoria.' },
        { status: 409, statusText: 'Conflict' },
      );
      await settle();
      h.fixture.detectChanges();

      expect(h.component.toastMessage()).toBe('No se puede marcar como celebrada una junta antes de su primera convocatoria.');
      expect(h.el.querySelector('tbody tr')!.textContent).toContain('Convocada');
      expect(h.component.closingMeetingId()).toBeNull();
    });
  });

  describe('histórico de participación', () => {
    it('sin juntas celebradas todavía, no muestra la sección', async () => {
      await flushInitialLoad([makeMeeting({ id: 'm1' })]);
      expect(h.el.querySelectorAll('.participation-card')).toHaveLength(0);
    });

    it('con histórico, muestra quórum y % de delegación por junta', async () => {
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/meetings`).flush([makeMeeting({ id: 'm1' })]);
      h.http.expectOne((r) => r.url === `${API}/estates/e1/meetings/participation-history`).flush([
        { meetingId: 'm1', title: 'Junta Ordinaria 2026', celebratedAt: '2026-03-01T18:00:00.000Z', quorumMet: true, delegationUsageRate: 25 },
      ]);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelectorAll('.participation-card')).toHaveLength(1);
      expect(h.el.textContent).toContain('Alcanzado');
      expect(h.el.textContent).toContain('Delegación: 25%');
    });
  });
});
