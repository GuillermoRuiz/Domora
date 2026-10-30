import {
  branchesOfRoute,
  isClaimProfessionalWait,
  waitObsoleteOnChange,
  type ClaimProfessionals,
  type WaitFacts,
} from './route-compatibility';
import { RESOLUTION_ROUTES } from './resolution-routes';

const none: ClaimProfessionals = { supplierIds: new Set(), names: new Set() };
const wait = (over: Partial<WaitFacts>): WaitFacts => ({
  party: 'provider',
  refType: null,
  supplierId: null,
  partyLabel: null,
  ...over,
});

describe('route-compatibility · qué rama activa cada vía', () => {
  it('cada vía activa como mucho una rama y sin vía no hay ninguna', () => {
    expect(branchesOfRoute(null)).toEqual([]);
    for (const route of RESOLUTION_ROUTES)
      expect(branchesOfRoute(route).length).toBeLessThanOrEqual(1);
    expect(branchesOfRoute('community_provider')).toEqual(['provider']);
    expect(branchesOfRoute('community_insurance')).toEqual(['insurer']);
    expect(branchesOfRoute('owner_insurance')).toEqual(['owner']);
    expect(branchesOfRoute('direct_management')).toEqual([]);
  });
});

describe('route-compatibility · esperas', () => {
  it('sin vía nueva («sin decidir») no se cierra ninguna espera', () => {
    expect(
      waitObsoleteOnChange(
        wait({}),
        { from: 'community_provider', to: null },
        none,
      ),
    ).toBe(false);
  });

  it('una espera de una persona solo se retira si era de la rama de la vía anterior', () => {
    const owner = wait({ party: 'owner' });
    expect(
      waitObsoleteOnChange(
        owner,
        { from: null, to: 'community_provider' },
        none,
      ),
    ).toBe(false);
    expect(
      waitObsoleteOnChange(
        owner,
        { from: 'owner_insurance', to: 'community_provider' },
        none,
      ),
    ).toBe(true);
    expect(
      waitObsoleteOnChange(
        wait({ party: 'insurer' }),
        { from: 'community_insurance', to: 'direct_management' },
        none,
      ),
    ).toBe(true);
  });

  it('una espera a «otro» no pertenece a ninguna rama: nunca se retira', () => {
    expect(
      waitObsoleteOnChange(
        wait({ party: 'other' }),
        { from: 'community_provider', to: 'direct_management' },
        none,
      ),
    ).toBe(false);
  });

  it('el profesional que envió la aseguradora es de la rama del seguro (por proveedor o por nombre)', () => {
    const pros: ClaimProfessionals = {
      supplierIds: new Set(['s1']),
      names: new Set(['fontanero pepe']),
    };
    expect(isClaimProfessionalWait(wait({ supplierId: 's1' }), pros)).toBe(
      true,
    );
    expect(
      isClaimProfessionalWait(
        wait({ partyLabel: '  Fontanero   PEPE ' }),
        pros,
      ),
    ).toBe(true);
    expect(isClaimProfessionalWait(wait({ supplierId: 's2' }), pros)).toBe(
      false,
    );
    expect(
      waitObsoleteOnChange(
        wait({ supplierId: 's1' }),
        { from: 'community_provider', to: 'community_insurance' },
        pros,
      ),
    ).toBe(false);
    // Con otra vía que no es la del seguro, ya no pertenece a ninguna rama activa.
    expect(
      waitObsoleteOnChange(
        wait({ supplierId: 's1' }),
        { from: 'community_provider', to: 'direct_management' },
        pros,
      ),
    ).toBe(true);
  });
});
