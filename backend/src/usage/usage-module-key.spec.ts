import { moduleKeyFromControllerPath } from './usage-module-key';

describe('moduleKeyFromControllerPath', () => {
  it('takes the first segment of the controller path, lowercased, ignoring an API prefix', () => {
    expect(moduleKeyFromControllerPath('meetings')).toBe('meetings');
    expect(moduleKeyFromControllerPath('/api/v1/Accounting')).toBe(
      'accounting',
    );
    expect(moduleKeyFromControllerPath('/estates')).toBe('estates');
  });

  it('uses the sub-resource of a controller nested under a container scope', () => {
    expect(moduleKeyFromControllerPath('estates/:estateId/receipts')).toBe(
      'receipts',
    );
    expect(moduleKeyFromControllerPath('properties/:propertyId/issues')).toBe(
      'issues',
    );
    expect(moduleKeyFromControllerPath('users/:userId/receipts')).toBe(
      'receipts',
    );
    expect(moduleKeyFromControllerPath('estates/:estateId')).toBe('estates');
  });

  it('skips the «me» namespace', () => {
    expect(moduleKeyFromControllerPath('me/documents')).toBe('documents');
    expect(moduleKeyFromControllerPath('me/issues')).toBe('issues');
    expect(moduleKeyFromControllerPath('gdpr/me')).toBe('gdpr');
  });

  it('ignores auth, notification, push and health noise and the root controller', () => {
    expect(moduleKeyFromControllerPath('auth')).toBeNull();
    expect(moduleKeyFromControllerPath('notifications')).toBeNull();
    expect(moduleKeyFromControllerPath('push')).toBeNull();
    expect(moduleKeyFromControllerPath('health')).toBeNull();
    expect(moduleKeyFromControllerPath('/')).toBeNull();
    expect(moduleKeyFromControllerPath('')).toBeNull();
    expect(moduleKeyFromControllerPath(undefined)).toBeNull();
  });

  it('never returns a route parameter or wildcard as a module', () => {
    expect(moduleKeyFromControllerPath(':id')).toBeNull();
    expect(moduleKeyFromControllerPath('*path')).toBeNull();
  });
});
