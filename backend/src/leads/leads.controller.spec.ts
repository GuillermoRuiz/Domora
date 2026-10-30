import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { classifyRoute } from '../support-access/route-scope';
import { ClientsController, LeadsController } from './leads.controller';

const leadRoles = (method: keyof LeadsController) => Reflect.getMetadata(ROLES_KEY, LeadsController.prototype[method]);
const clientRoles = (method: keyof ClientsController) => Reflect.getMetadata(ROLES_KEY, ClientsController.prototype[method]);

describe('LeadsController and ClientsController (S13)', () => {
  it('every endpoint is role A only, so it is Domora back office and never a tenant route', () => {
    for (const m of ['list', 'get', 'create', 'update', 'addFollowUp', 'convert'] as const) expect(leadRoles(m)).toEqual(['A']);
    for (const m of ['overview', 'setNextAction', 'followUps', 'addFollowUp'] as const) expect(clientRoles(m)).toEqual(['A']);
    expect(classifyRoute(['A'], 'leads/:id/convert')).toBe('platform');
    expect(classifyRoute(['A'], 'clients/:administratorId/next-action')).toBe('platform');
  });

  it('delegates to the services with the current user', async () => {
    const user = { id: 'u1', role: 'A' } as never;
    const leads = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({ id: 'l1' }),
      create: jest.fn().mockResolvedValue({ id: 'l1' }),
      update: jest.fn().mockResolvedValue({ id: 'l1' }),
      addFollowUp: jest.fn().mockResolvedValue({ id: 'f1' }),
      convert: jest.fn().mockResolvedValue({ administratorId: 'a1' }),
    };
    const controller = new LeadsController(leads as never);
    await controller.list();
    await controller.get('l1');
    await controller.create({ name: 'X', origin: 'web' } as never, user);
    await controller.update('l1', { status: 'contactado' } as never, user);
    await controller.addFollowUp('l1', { text: 't' }, user);
    await expect(controller.convert('l1', { cif: 'B1' }, user)).resolves.toEqual({ administratorId: 'a1' });
    expect(leads.create).toHaveBeenCalledWith({ name: 'X', origin: 'web' }, user);
    expect(leads.update).toHaveBeenCalledWith('l1', { status: 'contactado' }, user);
    expect(leads.addFollowUp).toHaveBeenCalledWith('l1', { text: 't' }, user);
    expect(leads.convert).toHaveBeenCalledWith('l1', { cif: 'B1' }, user);

    const clients = {
      overview: jest.fn().mockResolvedValue({ kpis: {}, clients: [] }),
      setNextAction: jest.fn().mockResolvedValue({}),
      followUps: jest.fn().mockResolvedValue([]),
      addFollowUp: jest.fn().mockResolvedValue({}),
    };
    const clientsController = new ClientsController(clients as never);
    await clientsController.overview();
    await clientsController.setNextAction('a1', { nextAction: 'Llamar', nextActionAt: null });
    await clientsController.followUps('a1');
    await clientsController.addFollowUp('a1', { text: 't' }, user);
    expect(clients.setNextAction).toHaveBeenCalledWith('a1', { nextAction: 'Llamar', nextActionAt: null });
    expect(clients.addFollowUp).toHaveBeenCalledWith('a1', { text: 't' }, user);
  });
});
