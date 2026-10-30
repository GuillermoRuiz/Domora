import * as crypto from 'node:crypto';

/**
 * Nombre de sala derivado del `meetingId` (no del `estateId`, a diferencia
 * del original React/Supabase) — dos juntas simultáneas de la misma finca
 * nunca comparten sala. Sala pública en meet.jit.si, sin JaaS/JWT (mismo
 * modelo que el original: `getJitsiToken` allí es hoy un stub).
 */
export function buildJitsiRoomName(meetingId: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(`meeting:${meetingId}`, 'utf8')
    .digest('hex');
  return `domora-${hash.slice(0, 20)}`;
}

/**
 * Password mostrada al organizador/asistentes. NO se aplica a nivel de
 * Jitsi (limitación heredada del original: meet.jit.si público no soporta
 * password vía URL sin JaaS) — es solo un control social/informativo hasta
 * que se migre a JaaS con JWT real (ver `not_designed_yet`/plan de fase 2).
 */
export function generateMeetingPassword(): string {
  const p1 = crypto.randomBytes(4).toString('hex');
  const p2 = crypto.randomBytes(4).toString('hex');
  return (p1 + p2).toUpperCase();
}

export function buildJitsiUrl(roomName: string): string {
  return `https://meet.jit.si/${roomName}`;
}
