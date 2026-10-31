import { NotFoundException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { CompletenessController } from './completeness.controller';

const roles = (method: keyof CompletenessController) =>
  Reflect.getMetadata(ROLES_KEY, CompletenessController.prototype[method]);

describe('CompletenessController', () => {
  it('keeps the list and the detail of every despacho for role A only', async () => {
    expect(roles('offices')).toEqual(['A']);
    expect(roles('office')).toEqual(['A']);
    const service = {
      overview: jest.fn().mockResolvedValue({ average: 50, offices: [] }),
      detail: jest.fn().mockResolvedValue({ administratorId: 'a1' }),
    };
    const controller = new CompletenessController(service as never);
    await expect(controller.offices()).resolves.toEqual({
      average: 50,
      offices: [],
    });
    await controller.office('a1');
    expect(service.detail).toHaveBeenCalledWith('a1');
  });

  it('gives role B only its own despacho, taken from the token and never from the request', async () => {
    expect(roles('mine')).toEqual(['B']);
    const service = {
      detail: jest.fn().mockResolvedValue({ administratorId: 'own' }),
    };
    const controller = new CompletenessController(service as never);
    await controller.mine({
      id: 'u1',
      role: 'B',
      estateIds: [],
      administratorId: 'own',
    });
    expect(service.detail).toHaveBeenCalledWith('own');
  });

  it('a role B user without despacho gets 404', async () => {
    const service = { detail: jest.fn() };
    const controller = new CompletenessController(service as never);
    await expect(
      controller.mine({
        id: 'u1',
        role: 'B',
        estateIds: [],
        administratorId: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(service.detail).not.toHaveBeenCalled();
  });
});
