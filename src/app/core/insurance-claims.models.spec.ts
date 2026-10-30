import {
  CLOSE_BLOCKED_BY_CLAIM_AND_NOTICE_MESSAGE,
  CLOSE_BLOCKED_BY_CLAIM_MESSAGE,
  CLOSE_BLOCKED_BY_NOTICE_MESSAGE,
  closeBlockedMessage,
} from './insurance-claims.models';

const CLAIM = 'ISSUE_HAS_OPEN_INSURANCE_CLAIM';
const NOTICE = 'ISSUE_HAS_PENDING_REQUESTER_NOTICE';
const conflict = (error: Record<string, unknown>) => ({ status: 409, error });

describe('closeBlockedMessage', () => {
  it('siniestro vivo: el texto de siempre (y sin `blockers`, solo por el código)', () => {
    expect(closeBlockedMessage(conflict({ code: CLAIM }))).toBe(CLOSE_BLOCKED_BY_CLAIM_MESSAGE);
    expect(closeBlockedMessage(conflict({ code: CLAIM, blockers: [CLAIM] }))).toBe(CLOSE_BLOCKED_BY_CLAIM_MESSAGE);
  });

  it('comunicación pendiente al solicitante: mensaje humano, sin el código técnico', () => {
    const message = closeBlockedMessage(conflict({ code: NOTICE, blockers: [NOTICE], message: 'técnico' }));
    expect(message).toBe(CLOSE_BLOCKED_BY_NOTICE_MESSAGE);
    expect(message).toContain('Antes de cerrar la incidencia, revisa la comunicación pendiente al solicitante');
    expect(message).not.toContain(NOTICE);
  });

  it('con los dos bloqueos a la vez: un solo mensaje que los dice juntos (no una cascada)', () => {
    expect(closeBlockedMessage(conflict({ code: CLAIM, blockers: [CLAIM, NOTICE] }))).toBe(
      CLOSE_BLOCKED_BY_CLAIM_AND_NOTICE_MESSAGE,
    );
  });

  it('cualquier otro error no es un cierre rechazado', () => {
    expect(closeBlockedMessage(conflict({ code: 'OTRO' }))).toBeNull();
    expect(closeBlockedMessage(new Error('x'))).toBeNull();
    expect(closeBlockedMessage(null)).toBeNull();
  });
});
