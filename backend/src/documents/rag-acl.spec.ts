import { ragAclFor } from './rag-acl';

describe('ragAclFor', () => {
  it('«Todos los propietarios» is community-wide', () => {
    expect(
      ragAclFor({ effectiveVisibility: 'OWNERS', targetPropertyId: null }),
    ).toEqual({
      classification: 'community',
      acl: { community: true, roles: ['A', 'B'], users: [], properties: [] },
    });
  });
  it('«Una propiedad» is restricted to that property', () => {
    expect(
      ragAclFor({ effectiveVisibility: 'PROPERTY', targetPropertyId: 'p1' })
        .acl,
    ).toMatchObject({ community: false, properties: ['p1'] });
  });
  it.each(['MANAGER', 'BOARD'] as const)(
    '%s stays staff-only (never community), even without a target property',
    (v) => {
      expect(
        ragAclFor({ effectiveVisibility: v, targetPropertyId: null }),
      ).toEqual({
        classification: 'restricted',
        acl: { community: false, roles: ['A', 'B'], users: [], properties: [] },
      });
    },
  );
});
