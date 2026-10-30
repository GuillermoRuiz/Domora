import {
  buildJitsiRoomName,
  buildJitsiUrl,
  generateMeetingPassword,
} from './meeting-room.util';

describe('buildJitsiRoomName', () => {
  it('es determinista para el mismo meetingId', () => {
    expect(buildJitsiRoomName('m1')).toBe(buildJitsiRoomName('m1'));
  });

  // Mejora sobre el original (React deriva la sala solo del estateId, así
  // que dos juntas simultáneas de la misma finca comparten sala): aquí cada
  // meetingId produce una sala distinta, incluso si ambas juntas son de la
  // misma finca.
  it('produce salas distintas para juntas distintas', () => {
    expect(buildJitsiRoomName('m1')).not.toBe(buildJitsiRoomName('m2'));
  });

  it('no expone el uuid del meetingId en claro', () => {
    const meetingId = '11111111-2222-3333-4444-555555555555';
    expect(buildJitsiRoomName(meetingId)).not.toContain(meetingId);
  });
});

describe('generateMeetingPassword', () => {
  it('genera passwords distintas en cada llamada', () => {
    expect(generateMeetingPassword()).not.toBe(generateMeetingPassword());
  });

  it('es alfanumérica en mayúsculas', () => {
    expect(generateMeetingPassword()).toMatch(/^[0-9A-F]+$/);
  });
});

describe('buildJitsiUrl', () => {
  it('construye la URL pública de meet.jit.si', () => {
    expect(buildJitsiUrl('domora-abc')).toBe('https://meet.jit.si/domora-abc');
  });
});
