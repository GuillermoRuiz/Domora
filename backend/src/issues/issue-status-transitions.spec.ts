import { ConflictException } from '@nestjs/common';
import {
  assertManualTransition,
  canTransitionManually,
  ISSUE_STATUS_TRANSITION_NOT_ALLOWED,
} from './issue-status-transitions';

describe('manual issue status transitions', () => {
  it.each([
    ['Cerrada', 'PendienteProveedor'],
    ['Cerrada', 'EnReparacion'],
    ['Retirada', 'EnReparacion'],
    ['Retirada', 'Resuelta'],
    ['Retirada', 'Cerrada'],
  ] as const)('rejects %s → %s', (from, to) => {
    expect(canTransitionManually(from, to)).toBe(false);
  });

  it.each([
    ['Abierta', 'EnReparacion'],
    ['PendienteProveedor', 'Resuelta'],
    ['PendienteInformacion', 'Abierta'],
    ['Resuelta', 'Cerrada'],
    ['Resuelta', 'Abierta'],
    ['Cerrada', 'Abierta'],
    ['Cerrada', 'Resuelta'],
    ['Retirada', 'Abierta'],
    ['Cerrada', 'Cerrada'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransitionManually(from, to)).toBe(true);
  });

  it('rejects an incoherent jump with a stable code', () => {
    try {
      assertManualTransition('Cerrada', 'PendienteProveedor');
      fail('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: ISSUE_STATUS_TRANSITION_NOT_ALLOWED,
        from: 'Cerrada',
        to: 'PendienteProveedor',
      });
    }
  });
});
