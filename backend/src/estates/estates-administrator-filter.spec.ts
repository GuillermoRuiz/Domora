import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstatesController } from './estates.controller';

/**
 * Role A despacho context on the setup summary (odd/tasks/role-a-panel.md S1):
 * the reused /b/estates screen loads `GET /estates/setup-summary`, so role A
 * gets the selected despacho's summary through `?administratorId=`.
 */
const OFFICE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function user(overrides: Partial<AuthenticatedUser>): AuthenticatedUser {
  return { userId: 'u1', role: 'B', estateIds: [], administratorId: null, ...overrides } as AuthenticatedUser;
}

function controller() {
  const summaryForAdministrator = jest.fn().mockResolvedValue([{ estateId: 'e1' }]);
  const ctrl = new EstatesController(
    {} as never,
    { summaryForAdministrator } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { ctrl, summaryForAdministrator };
}

describe('EstatesController setup-summary despacho filter', () => {
  it('is open to roles A and B', () => {
    const roles = new Reflector().get<string[]>(ROLES_KEY, EstatesController.prototype.setupSummary);
    expect(roles).toEqual(['A', 'B']);
  });

  it('role A gets the summary of ?administratorId=', async () => {
    const { ctrl, summaryForAdministrator } = controller();
    await expect(
      ctrl.setupSummary(user({ role: 'A' }), undefined, OFFICE),
    ).resolves.toEqual([{ estateId: 'e1' }]);
    expect(summaryForAdministrator).toHaveBeenCalledWith(OFFICE);
  });

  it('role A without a despacho nor a support session gets an empty list', async () => {
    const { ctrl, summaryForAdministrator } = controller();
    await expect(
      ctrl.setupSummary(user({ role: 'A' }), undefined, undefined),
    ).resolves.toEqual([]);
    expect(summaryForAdministrator).not.toHaveBeenCalled();
  });

  it('role A without ?administratorId= gets the despacho of its support session', async () => {
    const { ctrl, summaryForAdministrator } = controller();
    await expect(
      ctrl.setupSummary(user({ role: 'A' }), OFFICE, undefined),
    ).resolves.toEqual([{ estateId: 'e1' }]);
    expect(summaryForAdministrator).toHaveBeenCalledWith(OFFICE);
  });

  it('role A with a despacho that is not a UUID is a 400', () => {
    const { ctrl, summaryForAdministrator } = controller();
    expect(() =>
      ctrl.setupSummary(user({ role: 'A' }), undefined, 'nope'),
    ).toThrow(BadRequestException);
    expect(summaryForAdministrator).not.toHaveBeenCalled();
  });

  it('role B keeps its own despacho from the token and ignores the parameter, even malformed', async () => {
    const { ctrl, summaryForAdministrator } = controller();
    const b = user({ role: 'B', administratorId: OFFICE });
    await ctrl.setupSummary(b, undefined, OTHER);
    await ctrl.setupSummary(b, undefined, 'nope');
    await ctrl.setupSummary(b, undefined, undefined);
    expect(summaryForAdministrator.mock.calls).toEqual([[OFFICE], [OFFICE], [OFFICE]]);
  });

  it('role B without a despacho still gets an empty list', async () => {
    const { ctrl, summaryForAdministrator } = controller();
    await expect(
      ctrl.setupSummary(user({ role: 'B' }), undefined, OTHER),
    ).resolves.toEqual([]);
    expect(summaryForAdministrator).not.toHaveBeenCalled();
  });
});
