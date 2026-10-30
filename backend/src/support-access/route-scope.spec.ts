import { Controller, Get, Post } from '@nestjs/common';
import { classifyRoute, isReadOnlyRequest, isSafeMethod, routeTemplate } from './route-scope';

@Controller('estates/:estateId/receipts')
class ReceiptsController {
  @Get() list(this: void): void {}
  @Post(':id/cancel') cancel(this: void): void {}
}

@Controller()
class RootController {
  @Get(['first/:id', 'second']) multi(this: void): void {}
}

describe('route scope', () => {
  it('builds the route template from Nest metadata, never from the URL', () => {
    const c = new ReceiptsController();
    expect(routeTemplate(ReceiptsController, c.list)).toBe('estates/:estateId/receipts');
    expect(routeTemplate(ReceiptsController, c.cancel)).toBe('estates/:estateId/receipts/:id/cancel');
    expect(routeTemplate(RootController, new RootController().multi)).toBe('first/:id');
  });

  it.each([
    [['A', 'B'], 'estates/:estateId/cost-centres', 'tenant'],
    [['A', 'B', 'C'], 'receipts/:id/payment-proof', 'tenant'],
    [undefined, 'estates/:estateId', 'tenant'],
    [[], 'properties/:id', 'tenant'],
    [['A'], 'platform-metrics/mrr', 'platform'],
    [['A'], 'completeness/offices', 'platform'],
    [undefined, 'auth/me', 'self'],
    [['A', 'B'], 'notifications/preferences', 'self'],
    [['A', 'B'], 'admins/:id/invoices', 'self'],
    [undefined, 'gdpr/me/export', 'self'],
    [['A', 'B'], 'issues/:id/notifications', 'tenant'],
    [undefined, 'direct-messages/settings', 'self'],
    [undefined, 'direct-messages/messages/:id', 'self'],
    [undefined, 'direct-messages/messages', 'self'],
    [undefined, 'direct-messages/conversations/:id', 'self'],
    [undefined, 'estate-onboarding-requests/:id', 'self'],
    [undefined, 'estate-onboarding-requests', 'self'],
  ] as const)('classifies %j %s as %s', (roles, template, scope) => {
    expect(classifyRoute(roles as never, template)).toBe(scope);
  });

  it('treats only GET, HEAD and OPTIONS as safe', () => {
    expect(['GET', 'head', 'OPTIONS'].map(isSafeMethod)).toEqual([true, true, true]);
    expect(['POST', 'PUT', 'PATCH', 'DELETE'].map(isSafeMethod)).toEqual([false, false, false, false]);
  });

  it.each([
    'estates/:estateId/catastro/lookup',
    'estates/:estateId/late-interest/preview',
    'estates/:estateId/properties/coefficients/preview-by-area',
    'estates/:estateId/meetings/convocatoria-preview',
  ])('treats POST %s as a read (computes, persists nothing)', (template) => {
    expect(isReadOnlyRequest('POST', template)).toBe(true);
    expect(isReadOnlyRequest('PUT', template)).toBe(false);
  });

  it.each([
    'estates/:estateId/opening-balances/validate',
    'estates/:estateId/library/review',
    'assistant/ask',
    'meetings/:id/heartbeat',
    'estates/:estateId/properties/coefficients/apply-by-area',
    'estates/:estateId/catastro/import',
  ])('keeps POST %s a write', (template) => {
    expect(isReadOnlyRequest('POST', template)).toBe(false);
  });

  it('keeps GET, HEAD and OPTIONS reads on any route', () => {
    expect(isReadOnlyRequest('GET', 'estates/:estateId/receipts')).toBe(true);
    expect(isReadOnlyRequest('DELETE', 'estates/:estateId/receipts')).toBe(false);
  });
});
