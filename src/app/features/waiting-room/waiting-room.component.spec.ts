import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { API, setupComponentAsync, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { WaitingRoomComponent } from './waiting-room.component';
import type { Meeting } from '../../core/models';

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1', estateId: 'e1', title: 'Junta Ordinaria 2026', type: 'ordinaria', status: 'convocada',
    scheduledAt1: '2026-03-01T18:00:00.000Z', scheduledAt2: '2026-03-01T18:30:00.000Z', agenda: [],
    convokedBy: 'presidente', signerRole: 'administrador', attendeeEmails: [], includeJitsi: true,
    jitsiRoomName: 'domora-m1', createdByUserId: 'u1', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('WaitingRoomComponent', () => {
  let h: ComponentHarness<WaitingRoomComponent>;

  // Asíncrono: la pantalla usa `@defer` para el embed de Jitsi, y TestBed
  // exige compileComponents() antes de crearla.
  beforeEach(async () => {
    h = await setupComponentAsync(WaitingRoomComponent, {
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ meetingId: 'm1' }) } } },
      ],
    });
  });

  afterEach(() => {
    // Un componente con polling deja peticiones pendientes; se descartan
    // para que verify() solo compruebe lo que cada test afirma.
    h.http.match(() => true);
    h.http.verify();
  });

  async function load(meeting: Meeting): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/meetings/m1`).flush(meeting);
    await settle();
    h.fixture.detectChanges();
  }

  it.each([
    ['cancelada', 'Esta junta ha sido cancelada.'],
    ['celebrada', 'Esta junta ya se ha celebrado.'],
  ] as const)('una junta %s no tiene sala: muestra el aviso y no abre el polling', async (status, message) => {
    await load(makeMeeting({ status }));

    expect(h.el.textContent).toContain(message);
    h.http.expectNone((r) => r.url.startsWith(`${API}/meetings/m1/`));
  });

  it('una junta convocada con videollamada sí conecta la sala (empieza a sondear el estado)', async () => {
    await load(makeMeeting({ status: 'convocada' }));

    expect(h.component.loadError()).toBeNull();
    expect(h.http.match((r) => r.url === `${API}/meetings/m1/state`).length).toBeGreaterThan(0);
  });

  it('una junta convocada sin videollamada sigue mostrando el aviso de "sin videollamada"', async () => {
    await load(makeMeeting({ status: 'convocada', includeJitsi: false, jitsiRoomName: null }));

    expect(h.el.textContent).toContain('Esta junta no tiene videollamada activada.');
  });

  describe('confirmación de asistencia (quórum)', () => {
    it('con una sola propiedad disponible, la preselecciona pero no confirma sola', async () => {
      await load(makeMeeting({ status: 'convocada' }));
      h.http.expectOne(`${API}/meetings/m1/attendance/options`)
        .flush([{ propertyId: 'p1', label: 'Piso 1A', kind: 'own' }]);
      await settle();
      h.fixture.detectChanges();

      expect(h.component.selectedPropertyIds()).toEqual(['p1']);
      expect(h.component.attendanceConfirmed()).toBe(false);
      expect(h.el.querySelector<HTMLInputElement>('.attendance-option input')!.checked).toBe(true);
      h.http.expectNone((r) => r.url === `${API}/meetings/m1/attendance`);
    });

    it('con varias propiedades, ninguna preseleccionada; al marcar y confirmar, manda POST con las elegidas', async () => {
      await load(makeMeeting({ status: 'convocada' }));
      h.http.expectOne(`${API}/meetings/m1/attendance/options`).flush([
        { propertyId: 'p1', label: 'Piso 1A', kind: 'own' },
        { propertyId: 'p2', label: 'Local 2B', kind: 'delegated' },
      ]);
      await settle();
      h.fixture.detectChanges();

      expect(h.component.selectedPropertyIds()).toEqual([]);
      const checkboxes = h.el.querySelectorAll<HTMLInputElement>('.attendance-option input');
      checkboxes[1].dispatchEvent(new Event('change'));
      h.fixture.detectChanges();
      expect(h.component.selectedPropertyIds()).toEqual(['p2']);

      h.el.querySelector<HTMLButtonElement>('.wait-room__card--attendance app-btn button')!.click();
      const req = h.http.expectOne(`${API}/meetings/m1/attendance`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ propertyIds: ['p2'] });
      req.flush(null);
      await settle();
      h.fixture.detectChanges();

      expect(h.component.attendanceConfirmed()).toBe(true);
      expect(h.el.textContent).toContain('Asistencia confirmada.');
    });

    it('si el backend rechaza la confirmación, muestra el error y no marca confirmado', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await load(makeMeeting({ status: 'convocada' }));
      h.http.expectOne(`${API}/meetings/m1/attendance/options`)
        .flush([{ propertyId: 'p1', label: 'Piso 1A', kind: 'own' }]);
      await settle();
      h.fixture.detectChanges();

      h.el.querySelector<HTMLButtonElement>('.wait-room__card--attendance app-btn button')!.click();
      h.http.expectOne(`${API}/meetings/m1/attendance`).flush(
        { message: 'No eres elegible para esta propiedad.' },
        { status: 403, statusText: 'Forbidden' },
      );
      await settle();
      h.fixture.detectChanges();

      expect(h.component.attendanceConfirmed()).toBe(false);
      expect(h.el.textContent).toContain('No se pudo confirmar la asistencia');
    });

    it('sin ninguna propiedad disponible, no muestra la tarjeta de asistencia', async () => {
      await load(makeMeeting({ status: 'convocada' }));
      h.http.expectOne(`${API}/meetings/m1/attendance/options`).flush([]);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.wait-room__card--attendance')).toBeNull();
    });
  });
});
