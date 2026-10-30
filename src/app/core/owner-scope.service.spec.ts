import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { MembershipsMessagingService } from './memberships-messaging.service';
import { PropertiesService } from './properties.service';
import { OwnerScopeService } from './owner-scope.service';
import type { PropertyView } from './models';

const view = (id: string, nickname: string, estateId: string | null, estateName: string | null, isLinked = true): PropertyView => ({
  property: { id, estateId } as never, estate: null, admin: null, adminContact: null, membership: null,
  estateName, adminName: null, adminContactName: null, nickname, viewerRoleType: 'Propietario' as never,
  isLinked, linkageStatus: 'linked' as never, addressFull: `Calle ${nickname}`,
});

const VIEWS: Record<string, PropertyView | null> = {
  p1: view('p1', '3A', 'e1', 'Colón 24'),
  p2: view('p2', 'P03', 'e1', 'Colón 24'),
  p3: view('p3', '1A', 'e2', 'Cuba 18'),
  p4: view('p4', 'Mi piso', null, null, false),
  broken: null,
};

describe('OwnerScopeService', () => {
  let service: OwnerScopeService;
  let memberships: { listMembershipsByUser: ReturnType<typeof vi.fn> };
  let user: { id: string } | null;

  function setup(propertyIds: string[], opts: { fail?: boolean } = {}) {
    user = { id: 'u1' };
    memberships = { listMembershipsByUser: vi.fn(async () => { if (opts.fail) throw new Error('x'); return propertyIds.map(propertyId => ({ propertyId })); }) };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { currentUser: () => user } },
        { provide: MembershipsMessagingService, useValue: memberships },
        { provide: PropertiesService, useValue: { resolvePropertyView: async (id: string) => VIEWS[id] ?? null } },
      ],
    });
    service = TestBed.inject(OwnerScopeService);
  }

  beforeEach(() => {
    try { localStorage.clear(); } catch { /* sin almacenamiento */ }
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('con una sola propiedad la elige; no ofrece «Todas»', async () => {
    setup(['p3']);
    await service.load();
    expect(service.loaded()).toBe(true);
    expect(service.selected()?.id).toBe('p3');
    expect(service.showAll()).toBe(false);
    expect(service.isAll()).toBe(false);
  });

  it('con varias propiedades y sin elección recordada muestra «Todas», como la gestora', async () => {
    setup(['p3', 'p2', 'p1']);
    await service.load();
    expect(service.items()).toHaveLength(3);
    expect(service.showAll()).toBe(true);
    expect(service.isAll()).toBe(true);
    expect(service.selected()).toBeNull();
  });

  it('volver a «Todas» desde una propiedad también se recuerda', async () => {
    setup(['p1', 'p3']);
    await service.load();
    service.select('p3');
    service.select(null);
    expect(service.isAll()).toBe(true);
    expect(service.selected()).toBeNull();
    expect(localStorage.getItem('domora.ownerScope.u1')).toBe('all');

    TestBed.resetTestingModule();
    setup(['p1', 'p3']);
    await service.load();
    expect(service.isAll()).toBe(true);
  });

  it('con una sola propiedad, «Todas» recordado elige esa propiedad', async () => {
    localStorage.setItem('domora.ownerScope.u1', 'all');
    setup(['p3']);
    await service.load();
    expect(service.isAll()).toBe(false);
    expect(service.selected()?.id).toBe('p3');
  });

  it('agrupa por finca, ordena fincas y propiedades por nombre y deja las propiedades sin finca al final', async () => {
    setup(['p4', 'p3', 'p2', 'p1']);
    await service.load();
    expect(service.groups().map(g => [g.estateName, g.properties.map(p => p.nickname)])).toEqual([
      ['Colón 24', ['3A', 'P03']],
      ['Cuba 18', ['1A']],
      ['Sin comunidad vinculada', ['Mi piso']],
    ]);
  });

  it('elegir una propiedad la selecciona y la recuerda para la próxima vez', async () => {
    setup(['p1', 'p3']);
    await service.load();
    service.select('p3');
    expect(service.selected()?.id).toBe('p3');
    expect(localStorage.getItem('domora.ownerScope.u1')).toBe('p3');

    TestBed.resetTestingModule();
    setup(['p1', 'p3']);
    await service.load();
    expect(service.selected()?.id).toBe('p3');
  });

  it('la elección recordada es por usuario', async () => {
    setup(['p1', 'p3']);
    await service.load();
    service.select('p3');
    TestBed.resetTestingModule();
    setup(['p1', 'p3']);
    user = { id: 'otro-usuario' };
    await service.load();
    expect(service.isAll()).toBe(true);
  });

  it('una propiedad recordada que ya no existe vuelve a «Todas» (o a la única que quede)', async () => {
    localStorage.setItem('domora.ownerScope.u1', 'p-borrada');
    setup(['p1', 'p3']);
    await service.load();
    expect(service.isAll()).toBe(true);

    TestBed.resetTestingModule();
    setup(['p1']);
    await service.load();
    expect(service.selected()?.id).toBe('p1');
  });

  it('elegir una propiedad que no es del usuario no hace nada', async () => {
    setup(['p1']);
    await service.load();
    service.select('p3');
    expect(service.selected()?.id).toBe('p1');
    expect(localStorage.getItem('domora.ownerScope.u1')).toBeNull();
  });

  it('ignora las propiedades que no se pudieron resolver', async () => {
    setup(['p1', 'broken']);
    await service.load();
    expect(service.items().map(p => p.id)).toEqual(['p1']);
  });

  it('sin propiedades no hay selección y no es un error', async () => {
    setup([]);
    await service.load();
    expect(service.selected()).toBeNull();
    expect(service.groups()).toEqual([]);
    expect(service.failed()).toBe(false);
  });

  it('si falla la carga inicial lo marca; si falla una recarga conserva lo que había', async () => {
    setup([], { fail: true });
    await service.load();
    expect(service.failed()).toBe(true);
    expect(service.loaded()).toBe(true);

    TestBed.resetTestingModule();
    setup(['p1']);
    await service.load();
    memberships.listMembershipsByUser.mockRejectedValueOnce(new Error('x'));
    await service.load();
    expect(service.failed()).toBe(false);
    expect(service.items()).toHaveLength(1);
  });

  it('sin almacenamiento disponible sigue funcionando', async () => {
    setup(['p1', 'p3']);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    await service.load();
    service.select('p3');
    expect(service.selected()?.id).toBe('p3');
  });
});
