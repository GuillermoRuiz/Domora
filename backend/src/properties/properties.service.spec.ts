import { ForbiddenException } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { ESTATE_PRIVATE_OMIT, USER_SECRETS_OMIT } from '../common/secret-omit';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DebtorsService } from '../debtors/debtors.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';

function user(
  role: AppRole,
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    role,
    estateIds: ['estate-1'],
    administratorId: role === 'B' ? 'admin-1' : null,
    ...overrides,
  };
}

const PROPERTY = {
  id: 'prop-1',
  estateId: 'estate-1',
  administratorId: 'admin-1',
  primaryUserId: 'owner-1',
};

describe('PropertiesService', () => {
  let propertyFindFirst: jest.Mock;
  let propertyUpdate: jest.Mock;
  let propertyCreate: jest.Mock;
  let estateFindFirst: jest.Mock;
  let service: PropertiesService;

  beforeEach(() => {
    propertyFindFirst = jest.fn().mockResolvedValue(PROPERTY);
    propertyUpdate = jest
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ ...PROPERTY, ...data }),
      );
    propertyCreate = jest
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: 'new', ...data }),
      );
    estateFindFirst = jest
      .fn()
      .mockResolvedValue({ id: 'estate-1', administratorId: 'admin-1' });

    const prisma = {
      property: {
        findFirst: propertyFindFirst,
        update: propertyUpdate,
        create: propertyCreate,
      },
      estate: { findFirst: estateFindFirst },
    } as unknown as PrismaService;

    service = new PropertiesService(
      prisma,
      new EstateAccessService(),
      {} as DebtorsService,
      {} as NotificationsService,
      new PropertyAccessService(prisma, new EstateAccessService()),
    );
  });

  describe('resolvePropertyView', () => {
    it('no devuelve credenciales del usuario primario ni datos privados de la finca', async () => {
      const estate = jest.fn().mockResolvedValue({
        id: 'estate-1',
        administratorId: 'admin-1',
        name: 'Finca',
        notes: 'Interna',
        internalRef: 'FIN-1',
      });
      const administrator = jest.fn().mockResolvedValue({
        id: 'admin-1',
        name: 'Gestora',
        primaryUser: { id: 'u1', fullName: 'Ana' },
      });
      const memberships = jest.fn().mockResolvedValue([]);
      const prisma = {
        property: { findFirst: propertyFindFirst },
        estate: { findFirst: estate },
        administrator: { findFirst: administrator },
        propertyMembership: { findMany: memberships },
      } as unknown as PrismaService;
      const debtors = {
        computePropertyBalance: jest.fn().mockResolvedValue(0),
        computePropertyAdvance: jest.fn().mockResolvedValue(0),
      };
      const svc = new PropertiesService(
        prisma,
        new EstateAccessService(),
        debtors as unknown as DebtorsService,
        {} as NotificationsService,
        new PropertyAccessService(prisma, new EstateAccessService()),
      );

      const ownerView = await svc.resolvePropertyView(
        'prop-1',
        user('C', { id: 'owner-1' }),
      );
      // Internal data of the managing company never reaches the owner.
      expect(ownerView.estate).not.toHaveProperty('notes');
      expect(ownerView.estate).not.toHaveProperty('internalRef');

      expect(estate.mock.calls[0][0].omit).toEqual(ESTATE_PRIVATE_OMIT);
      const adminQuery = administrator.mock.calls[0][0];
      // Solo contacto: nada de plan, MRR, descuentos, notas, motivo de bloqueo ni CIF.
      expect(adminQuery.include).toBeUndefined();
      expect(Object.keys(adminQuery.select).sort()).toEqual([
        'contactEmail',
        'contactName',
        'id',
        'name',
        'phone',
        'primaryUser',
      ]);
      expect(Object.keys(adminQuery.select.primaryUser.select).sort()).toEqual([
        'email',
        'fullName',
        'id',
        'phone',
      ]);
      expect(memberships.mock.calls[0][0].include.user.omit).toEqual({
        ...USER_SECRETS_OMIT,
        taxId: true,
        taxIdCountry: true,
      });
      await svc.resolvePropertyView('prop-1', user('B'));
      expect(memberships.mock.calls[1][0].include.user.omit).toEqual(
        USER_SECRETS_OMIT,
      );
    });

    it('trae el saldo y el anticipo de la propiedad, igual que findById (el panel del propietario lo lee de aquí)', async () => {
      const computePropertyBalance = jest.fn().mockResolvedValue(-75.5);
      const computePropertyAdvance = jest.fn().mockResolvedValue(30);
      const prisma = {
        property: { findFirst: propertyFindFirst },
        estate: { findFirst: estateFindFirst },
        administrator: { findFirst: jest.fn().mockResolvedValue(null) },
        propertyMembership: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;
      const withDebtors = new PropertiesService(
        prisma,
        new EstateAccessService(),
        {
          computePropertyBalance,
          computePropertyAdvance,
        } as unknown as DebtorsService,
        {} as NotificationsService,
        new PropertyAccessService(prisma, new EstateAccessService()),
      );

      const view = await withDebtors.resolvePropertyView('prop-1', user('B'));

      expect(computePropertyBalance).toHaveBeenCalledWith('prop-1');
      expect(computePropertyAdvance).toHaveBeenCalledWith('prop-1');
      expect(view.property.balance).toBe(-75.5);
      expect(view.property.advance).toBe(30);
    });
  });

  describe('findById / resolvePropertyView — acceso de lectura del rol C por PROPIEDAD, no por finca', () => {
    // Regresión: antes esta comprobación era solo por finca (EstateAccessService,
    // igual para los tres roles), así que un rol C con una sola propiedad en una
    // finca de varias unidades podía leer el balance de cualquier vecino con solo
    // pedir su id — ver memoria discovery_property_scope_leak.md.
    const MANAGED_PROPERTY = { ...PROPERTY, id: 'prop-2', primaryUserId: null };

    function serviceWith(
      opts: { property?: unknown; membership?: unknown } = {},
    ) {
      const findFirst = jest.fn().mockResolvedValue(opts.property ?? PROPERTY);
      const membershipFindFirst = jest
        .fn()
        .mockResolvedValue(opts.membership ?? null);
      const prisma = {
        property: { findFirst },
        propertyMembership: { findFirst: membershipFindFirst },
      } as unknown as PrismaService;
      const debtors = {
        computePropertyBalance: jest.fn().mockResolvedValue(0),
        computePropertyAdvance: jest.fn().mockResolvedValue(0),
      } as unknown as DebtorsService;
      return {
        service: new PropertiesService(
          prisma,
          new EstateAccessService(),
          debtors,
          {} as NotificationsService,
          new PropertyAccessService(prisma, new EstateAccessService()),
        ),
        membershipFindFirst,
      };
    }

    it('el creador (primaryUserId) ve su propia propiedad, incluso con la adhesión pendiente', async () => {
      const { service: withOwner, membershipFindFirst } = serviceWith();
      await expect(
        withOwner.findById('prop-1', user('C', { id: 'owner-1' })),
      ).resolves.toMatchObject({ id: 'prop-1' });
      // Ni hace falta consultar la membresía: ya vale con ser el creador.
      expect(membershipFindFirst).not.toHaveBeenCalled();
    });

    it('un miembro vinculado (alta hecha por la gestora, sin primaryUserId) ve su propia propiedad', async () => {
      const { service: withMember } = serviceWith({
        property: MANAGED_PROPERTY,
        membership: { id: 'm1', status: 'linked', revokedAt: null },
      });
      await expect(
        withMember.findById('prop-2', user('C', { id: 'tenant-1' })),
      ).resolves.toMatchObject({ id: 'prop-2' });
    });

    it('un rol C SIN relación con la propiedad no puede leerla, aunque comparta finca (estateIds)', async () => {
      const { service: withStranger } = serviceWith({
        property: MANAGED_PROPERTY,
        membership: null,
      });
      await expect(
        withStranger.findById('prop-2', user('C', { id: 'vecino-1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('una vinculación revocada ya no da acceso', async () => {
      const { service: withRevoked } = serviceWith({
        property: MANAGED_PROPERTY,
        // El mock siempre filtra por revokedAt:null / status:'linked' en la
        // query real; aquí se simula que esa query no encuentra nada.
        membership: null,
      });
      await expect(
        withRevoked.findById('prop-2', user('C', { id: 'ex-inquilino' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rol B y rol A siguen entrando por finca, sin tocar PropertyMembership', async () => {
      const { service: withManager, membershipFindFirst } = serviceWith({
        property: MANAGED_PROPERTY,
      });
      await expect(
        withManager.findById('prop-2', user('B')),
      ).resolves.toMatchObject({ id: 'prop-2' });
      await expect(
        withManager.findById('prop-2', user('A', { estateIds: [] })),
      ).resolves.toMatchObject({ id: 'prop-2' });
      expect(membershipFindFirst).not.toHaveBeenCalled();
    });
  });

  describe('update — coeficiente de participación', () => {
    const owner = () => user('C', { id: 'owner-1' });

    it('la gestora de la finca puede fijar el coeficiente', async () => {
      await service.update('prop-1', { participationQuota: 2.5 }, user('B'));

      expect(propertyUpdate).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
        data: { participationQuota: 2.5 },
      });
    });

    it('la gestora también puede borrarlo (null) o fijarlo a 0', async () => {
      await service.update('prop-1', { participationQuota: null }, user('B'));
      await service.update('prop-1', { participationQuota: 0 }, user('B'));

      expect(propertyUpdate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ data: { participationQuota: null } }),
      );
      expect(propertyUpdate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ data: { participationQuota: 0 } }),
      );
    });

    it('rol A puede fijarlo', async () => {
      await service.update('prop-1', { participationQuota: 10 }, user('A'));

      expect(propertyUpdate).toHaveBeenCalledTimes(1);
    });

    it('el propio propietario (rol C) NO puede cambiar su coeficiente, aunque sí editar el resto de su propiedad', async () => {
      await expect(
        service.update('prop-1', { participationQuota: 50 }, owner()),
      ).rejects.toThrow(ForbiddenException);
      expect(propertyUpdate).not.toHaveBeenCalled();

      await service.update('prop-1', { floor: '3' }, owner());
      expect(propertyUpdate).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
        data: { floor: '3' },
      });
    });

    it.each([
      ['0', 0],
      ['null (borrarlo)', null],
    ])(
      'el propietario tampoco puede mandar %s: se comprueba con !== undefined, no por veracidad',
      async (_label, value) => {
        await expect(
          service.update('prop-1', { participationQuota: value }, owner()),
        ).rejects.toThrow(ForbiddenException);
        expect(propertyUpdate).not.toHaveBeenCalled();
      },
    );

    it('un rol B de OTRA gestora no puede tocar el coeficiente', async () => {
      const otherManager = user('B', { administratorId: 'admin-otra' });

      await expect(
        service.update('prop-1', { participationQuota: 5 }, otherManager),
      ).rejects.toThrow(ForbiddenException);
      expect(propertyUpdate).not.toHaveBeenCalled();
    });
  });

  describe('update — cuota mensual', () => {
    it('la gestora puede fijar la cuota tras el alta (antes solo en el alta o importando)', async () => {
      await service.update('prop-1', { quotaMonthly: 85.5 }, user('B'));
      expect(propertyUpdate).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
        data: { quotaMonthly: 85.5 },
      });
    });

    it('el propietario (rol C) no puede cambiarse su propia cuota', async () => {
      await expect(
        service.update(
          'prop-1',
          { quotaMonthly: 1 },
          user('C', { id: 'owner-1' }),
        ),
      ).rejects.toThrow(
        'Solo la gestora de la finca puede modificar la cuota mensual.',
      );
      expect(propertyUpdate).not.toHaveBeenCalled();
    });

    it('tampoco puede ponerla a 0: se comprueba con !== undefined, no por veracidad', async () => {
      await expect(
        service.update(
          'prop-1',
          { quotaMonthly: 0 },
          user('C', { id: 'owner-1' }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createForEstate', () => {
    it('guarda el coeficiente indicado', async () => {
      await service.createForEstate('estate-1', {
        type: 'Piso',
        participationQuota: 3.25,
      });

      expect(propertyCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ participationQuota: 3.25 }),
      });
    });

    it('lo deja a null si no se indica (no inventa un 0)', async () => {
      await service.createForEstate('estate-1', { type: 'Piso' });

      expect(propertyCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ participationQuota: null }),
      });
    });

    it('guarda la superficie construida indicada', async () => {
      await service.createForEstate('estate-1', {
        type: 'Piso',
        builtAreaM2: 72.5,
      });

      expect(propertyCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ builtAreaM2: 72.5 }),
      });
    });
  });

  describe('update — superficie construida (m²)', () => {
    it('la gestora puede fijarla', async () => {
      await service.update('prop-1', { builtAreaM2: 64.3 }, user('B'));
      expect(propertyUpdate).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
        data: { builtAreaM2: 64.3 },
      });
    });

    it('el propietario (rol C) no puede cambiarse su propia superficie', async () => {
      await expect(
        service.update(
          'prop-1',
          { builtAreaM2: 1 },
          user('C', { id: 'owner-1' }),
        ),
      ).rejects.toThrow(
        'Solo la gestora de la finca puede modificar la superficie construida.',
      );
      expect(propertyUpdate).not.toHaveBeenCalled();
    });
  });

  describe('previewQuotasByArea / applyQuotasByArea', () => {
    function propertiesService(properties: unknown[]) {
      const findMany = jest.fn().mockResolvedValue(properties);
      const txUpdate = jest
        .fn()
        .mockImplementation(({ where, data }) =>
          Promise.resolve({ id: where.id, ...data }),
        );
      const $transaction = jest
        .fn()
        .mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
      const prisma = {
        property: { findMany, update: txUpdate },
        $transaction,
      } as unknown as PrismaService;
      const svc = new PropertiesService(
        prisma,
        new EstateAccessService(),
        {} as DebtorsService,
        {} as NotificationsService,
        new PropertyAccessService(prisma, new EstateAccessService()),
      );
      return { svc, findMany, txUpdate, $transaction };
    }

    it('reparte proporcional al área y la suma redondeada da EXACTAMENTE 100.00 (método del resto mayor)', async () => {
      // 3 unidades cuya proporción exacta (33.33...%) redondearía mal fila
      // por fila: 33.33+33.33+33.33 = 99.99, no 100 — justo el bug que este
      // algoritmo existe para evitar.
      const { svc } = propertiesService([
        {
          id: 'p1',
          ref: 'A',
          type: 'Piso',
          builtAreaM2: 100,
          participationQuota: null,
        },
        {
          id: 'p2',
          ref: 'B',
          type: 'Piso',
          builtAreaM2: 100,
          participationQuota: null,
        },
        {
          id: 'p3',
          ref: 'C',
          type: 'Piso',
          builtAreaM2: 100,
          participationQuota: null,
        },
      ]);

      const preview = await svc.previewQuotasByArea('estate-1');

      expect(preview.missingArea).toEqual([]);
      const sum = preview.rows.reduce((acc, r) => acc + r.proposedQuota, 0);
      expect(sum).toBeCloseTo(100, 2);
      // Resto mayor reparte el 0.01 sobrante a UNA sola fila, no a las tres.
      const values = preview.rows.map((r) => r.proposedQuota).sort();
      expect(values).toEqual([33.33, 33.33, 33.34]);
    });

    it('no calcula nada si falta la superficie de alguna propiedad activa — devuelve cuáles faltan', async () => {
      const { svc } = propertiesService([
        {
          id: 'p1',
          ref: 'A',
          type: 'Piso',
          builtAreaM2: 100,
          participationQuota: 50,
        },
        {
          id: 'p2',
          ref: 'B',
          type: 'Piso',
          builtAreaM2: null,
          participationQuota: 50,
        },
      ]);

      const preview = await svc.previewQuotasByArea('estate-1');

      expect(preview.rows).toEqual([]);
      expect(preview.missingArea).toEqual([
        { propertyId: 'p2', ref: 'B', type: 'Piso' },
      ]);
    });

    it('applyQuotasByArea recalcula de nuevo (no confía en un preview viejo) y escribe en una transacción', async () => {
      const { svc, txUpdate, $transaction } = propertiesService([
        {
          id: 'p1',
          ref: 'A',
          type: 'Piso',
          builtAreaM2: 60,
          participationQuota: 999,
        },
        {
          id: 'p2',
          ref: 'B',
          type: 'Piso',
          builtAreaM2: 40,
          participationQuota: 1,
        },
      ]);

      const result = await svc.applyQuotasByArea('estate-1');

      expect($transaction).toHaveBeenCalledTimes(1);
      expect(txUpdate).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { participationQuota: 60 },
      });
      expect(txUpdate).toHaveBeenCalledWith({
        where: { id: 'p2' },
        data: { participationQuota: 40 },
      });
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'p1', participationQuota: 60 }),
          expect.objectContaining({ id: 'p2', participationQuota: 40 }),
        ]),
      );
    });

    it('applyQuotasByArea rechaza si falta superficie, sin escribir nada', async () => {
      const { svc, $transaction } = propertiesService([
        {
          id: 'p1',
          ref: 'A',
          type: 'Piso',
          builtAreaM2: null,
          participationQuota: null,
        },
      ]);

      await expect(svc.applyQuotasByArea('estate-1')).rejects.toThrow(
        '1 propiedad(es) sin superficie construida',
      );
      expect($transaction).not.toHaveBeenCalled();
    });
  });
});
