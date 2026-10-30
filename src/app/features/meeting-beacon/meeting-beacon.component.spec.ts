import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { API, makeUser, setupComponentAsync, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { MeetingBeaconComponent } from './meeting-beacon.component';
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

describe('MeetingBeaconComponent', () => {
  let h: ComponentHarness<MeetingBeaconComponent>;

  // Asíncrono: el panel usa `@defer` para el embed de Jitsi, y TestBed
  // exige compileComponents() antes de crearlo.
  beforeEach(async () => {
    h = await setupComponentAsync(MeetingBeaconComponent, {
      user: makeUser({ role: 'B' }),
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ meetingId: 'm1' }) } } },
      ],
    });
  });

  afterEach(() => {
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
  ] as const)('una junta %s no abre el panel de anfitrión: muestra el aviso y no sondea', async (status, message) => {
    await load(makeMeeting({ status }));

    expect(h.el.textContent).toContain(message);
    h.http.expectNone((r) => r.url.startsWith(`${API}/meetings/m1/`));
  });

  it('una junta convocada con videollamada conecta el panel (heartbeat de anfitrión y estado)', async () => {
    await load(makeMeeting({ status: 'convocada' }));

    expect(h.component.loadError()).toBeNull();
    expect(h.http.match((r) => r.url === `${API}/meetings/m1/heartbeat`).length).toBeGreaterThan(0);
  });
});
