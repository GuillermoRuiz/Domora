import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  createAdministrator,
  createEstate,
  createOwnerUser,
  createProperty,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { EstateGovernanceService } from './estate-governance.service';
import { EstateGeneralService } from './estate-general.service';
import { EstatesService } from './estates.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { bootstrapEstateLedger } from '../ledger/chart/ledger-bootstrap';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CryptoService } from '../sepa/crypto.service';
import type { EstateGeoService } from '../catastro/estate-geo.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/** Own unique fixtures only; requires a migrated disposable PostgreSQL DB. */
describe('estate general data (key contacts and overview)', () => {
  const db = createPrismaClient();
  const crypto = {
    decrypt: (v: string) => v,
    maskIban: (v: string) => `${v.slice(0, 4)} ···· ${v.slice(-4)}`,
  } as unknown as CryptoService;
  const geo = {
    refreshEstate: jest.fn().mockResolvedValue(undefined),
  } as unknown as EstateGeoService;
  const service = new EstateGeneralService(
    db as PrismaService,
    new EstateGovernanceService(db as PrismaService),
    crypto,
    geo,
  );
  let fx: AdministratorFixture;
  let foreign: AdministratorFixture;
  let estateId: string, foreignEstateId: string;
  let p1: string, p2: string, foreignProperty: string;
  let owner: string, tenant: string, external: string;
  let actor: AuthenticatedUser;

  beforeAll(async () => {
    fx = await createAdministrator(db);
    foreign = await createAdministrator(db);
    estateId = await createEstate(db, fx.administratorId);
    foreignEstateId = await createEstate(db, foreign.administratorId);
    p1 = await createProperty(db, estateId, { ref: '1A' });
    p2 = await createProperty(db, estateId, { ref: '2B' });
    foreignProperty = await createProperty(db, foreignEstateId, { ref: 'X1' });
    owner = await createOwnerUser(db, { fullName: 'Ana Gil' });
    tenant = await createOwnerUser(db, { fullName: 'Inquilino' });
    await db.user.update({
      where: { id: owner },
      data: { phone: '610123456' },
    });
    await db.propertyMembership.create({
      data: {
        propertyId: p1,
        userId: owner,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: new Date(),
      },
    });
    await db.propertyMembership.create({
      data: {
        propertyId: p2,
        userId: owner,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: new Date(),
      },
    });
    await db.propertyMembership.create({
      data: {
        propertyId: p1,
        userId: tenant,
        roleType: 'Inquilino',
        status: 'linked',
        linkedAt: new Date(),
      },
    });
    external = (
      await db.externalOwner.create({
        data: {
          propertyId: p2,
          fullName: 'Blas Mora',
          email: 'blas@example.com',
          phone: '699000111',
          roleType: 'Propietario',
          createdByUserId: fx.userId,
        },
      })
    ).id;
    actor = roleB(fx, [estateId]);
  }, 30000);

  afterAll(async () => {
    await db.estateOfficeTerm.deleteMany({
      where: { estateId: { in: [estateId, foreignEstateId] } },
    });
    await db.externalOwner.deleteMany({
      where: { propertyId: { in: [p1, p2, foreignProperty] } },
    });
    await db.propertyMembership.deleteMany({
      where: { userId: { in: [owner, tenant] } },
    });
    await db.property.deleteMany({
      where: { id: { in: [p1, p2, foreignProperty] } },
    });
    await db.estate.deleteMany({
      where: { id: { in: [estateId, foreignEstateId] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [owner, tenant, fx.userId, foreign.userId] } },
    });
    await db.administrator.deleteMany({
      where: { id: { in: [fx.administratorId, foreign.administratorId] } },
    });
    await db.$disconnect();
  });

  describe('key contacts', () => {
    afterEach(async () => {
      await db.propertyMembership.updateMany({
        where: { userId: owner },
        data: { isKeyContact: false },
      });
      await db.externalOwner.updateMany({
        where: { id: external },
        data: { isKeyContact: false },
      });
    });

    it('marks and unmarks a member of the property and an imported owner', async () => {
      await service.setKeyContact(
        estateId,
        { propertyId: p1, userId: owner, keyContact: true },
        actor,
      );
      await service.setKeyContact(
        estateId,
        { propertyId: p2, externalOwnerId: external, keyContact: true },
        actor,
      );
      expect(
        (
          await db.propertyMembership.findFirstOrThrow({
            where: { propertyId: p1, userId: owner },
          })
        ).isKeyContact,
      ).toBe(true);
      expect(
        (
          await db.propertyMembership.findFirstOrThrow({
            where: { propertyId: p2, userId: owner },
          })
        ).isKeyContact,
      ).toBe(false);
      expect(
        (await db.externalOwner.findUniqueOrThrow({ where: { id: external } }))
          .isKeyContact,
      ).toBe(true);

      const governance = new EstateGovernanceService(db as PrismaService);
      const holders = (await governance.candidates(estateId, actor)).flatMap(
        (p) => p.holders.map((h) => [p.ref, h.name, h.keyContact]),
      );
      expect(holders).toEqual(
        expect.arrayContaining([
          ['1A', 'Ana Gil', true],
          ['2B', 'Ana Gil', false],
          ['2B', 'Blas Mora', true],
        ]),
      );

      await service.setKeyContact(
        estateId,
        { propertyId: p1, userId: owner, keyContact: false },
        actor,
      );
      expect(
        (
          await db.propertyMembership.findFirstOrThrow({
            where: { propertyId: p1, userId: owner },
          })
        ).isKeyContact,
      ).toBe(false);
    });

    it('rejects a person who is not an owner of that property, and both or neither person ids', async () => {
      await expect(
        service.setKeyContact(
          estateId,
          { propertyId: p1, userId: tenant, keyContact: true },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.setKeyContact(
          estateId,
          { propertyId: p1, externalOwnerId: external, keyContact: true },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.setKeyContact(
          estateId,
          { propertyId: p1, keyContact: true },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.setKeyContact(
          estateId,
          {
            propertyId: p1,
            userId: owner,
            externalOwnerId: external,
            keyContact: true,
          },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(
        await db.propertyMembership.count({
          where: { userId: { in: [owner, tenant] }, isKeyContact: true },
        }),
      ).toBe(0);
    });

    it('rejects another administrator despite a forged estate claim, and a property of another estate', async () => {
      const forged: AuthenticatedUser = { ...roleB(foreign, [estateId]) };
      await expect(
        service.setKeyContact(
          estateId,
          { propertyId: p1, userId: owner, keyContact: true },
          forged,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.setKeyContact(
          estateId,
          { propertyId: foreignProperty, userId: owner, keyContact: true },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('general overview', () => {
    const today = new Date();
    const year = today.getUTCFullYear();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const daysFromNow = (n: number) => new Date(Date.now() + n * 86400000);
    let supplierIds: string[] = [];
    let documentIds: string[] = [];

    beforeAll(async () => {
      await db.administrator.update({
        where: { id: fx.administratorId },
        data: {
          phone: '914567890',
          contactName: 'Carlos Ruiz',
          contactEmail: 'carlos@gestora.es',
        },
      });
      await db.estate.update({
        where: { id: estateId },
        data: {
          iban: 'ES9121000418450200051332',
          yearBuilt: 2001,
          parcelAreaM2: '1248.00',
        },
      });
      await db.property.update({
        where: { id: p1 },
        data: { participationQuota: '30.50', builtAreaM2: '80.00' },
      });
      await db.property.update({
        where: { id: p2 },
        data: { participationQuota: '69.50' },
      });
      await db.propertyMembership.updateMany({
        where: { userId: owner, propertyId: { in: [p1, p2] } },
        data: { isKeyContact: true },
      });
      await db.externalOwner.update({
        where: { id: external },
        data: { isKeyContact: true },
      });
      await db.estateOfficeTerm.create({
        data: {
          estateId,
          role: 'PRESIDENT',
          propertyId: p1,
          userId: owner,
          holderNameSnapshot: 'Ana Gil',
          startsAt: new Date(`${year - 1}-03-10`),
          createdByUserId: fx.userId,
        },
      });
      await db.estateOfficeTerm.create({
        data: {
          estateId,
          role: 'VICE_PRESIDENT',
          propertyId: p2,
          externalOwnerId: external,
          holderNameSnapshot: 'Blas Mora',
          startsAt: new Date(`${year - 1}-04-01`),
          createdByUserId: fx.userId,
        },
      });
      await db.estateOfficeTerm.create({
        data: {
          estateId,
          role: 'PRESIDENT',
          holderNameSnapshot: 'Antiguo',
          startsAt: new Date(`${year - 3}-01-01`),
          endsAt: new Date(`${year - 1}-03-10`),
          createdByUserId: fx.userId,
        },
      });

      const insurer = await db.supplier.create({
        data: {
          estateId,
          administratorId: fx.administratorId,
          name: 'Mapfre',
          category: 'Seguros',
        },
      });
      const lifts = await db.supplier.create({
        data: {
          estateId,
          administratorId: fx.administratorId,
          name: 'Schindler',
          category: 'Ascensores',
        },
      });
      supplierIds = [insurer.id, lifts.id];
      const contract = (data: Record<string, unknown>) =>
        db.supplierContract.create({
          data: {
            estateId,
            renewalType: 'tacita',
            startDate: daysFromNow(-300),
            ...data,
          } as never,
        });
      await contract({
        supplierId: insurer.id,
        serviceType: 'Multirriesgo comunidad',
        contractNumber: '0987654321',
        endDate: daysFromNow(65),
        notes: 'Daños por agua y RC',
      });
      await contract({
        supplierId: insurer.id,
        serviceType: 'Póliza cancelada',
        cancelledAt: new Date(),
      });
      await contract({
        supplierId: insurer.id,
        serviceType: 'Póliza vencida',
        endDate: daysFromNow(-1),
      });
      await contract({
        supplierId: lifts.id,
        serviceType: 'Mantenimiento ascensor',
      });

      const doc = (type: string, date: string, title: string) =>
        db.document.create({
          data: {
            estateId,
            type,
            title,
            date: new Date(date),
            size: '1,2 MB',
            s3Key: `k/${title}`,
          },
        });
      documentIds = (
        await Promise.all([
          doc('IBI', '2024-01-12', 'IBI 2024'),
          doc('IBI', '2025-01-12', 'IBI 2025'),
          doc('Estatutos', '2018-03-22', 'Estatutos'),
          doc('Acta', '2025-06-01', 'Acta junta'),
        ])
      ).map((d) => d.id);
    });

    afterAll(async () => {
      await db.document.deleteMany({ where: { id: { in: documentIds } } });
      await db.supplierContract.deleteMany({
        where: { supplierId: { in: supplierIds } },
      });
      await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    });

    it('gathers the derived and stored general data of the estate', async () => {
      const o = await service.overview(estateId, actor);

      expect(o.properties).toBe(2);
      expect(o.coefficients).toEqual({
        total: 100,
        informed: 2,
        missing: 0,
        max: { ref: '2B', value: 69.5 },
        min: { ref: '1A', value: 30.5 },
      });
      expect(o.surface).toEqual({
        parcelAreaM2: 1248,
        builtAreaM2: 80,
        builtAreaInformed: 1,
      });
      expect(o.fiscalYear).toEqual({
        year,
        startsOn: `${year}-01-01`,
        endsOn: `${year}-12-31`,
        status: 'Abierto',
      });
      expect(o.bank).toEqual({
        bankName: 'CaixaBank',
        iban: 'ES9121000418450200051332',
        masked: false,
        accountCode: null,
        alias: null,
      });
      expect(o.administrator).toEqual({
        name: 'Gestora de prueba',
        contactName: 'Carlos Ruiz',
        phone: '914567890',
        email: 'carlos@gestora.es',
      });

      expect(o.offices.president).toEqual({
        label: 'Presidente',
        name: 'Ana Gil',
        propertyRef: '1A',
        since: `${year - 1}-03-10`,
      });
      expect(o.offices.vicePresidents).toEqual([
        {
          label: 'Vicepresidente 1º',
          name: 'Blas Mora',
          propertyRef: '2B',
          since: `${year - 1}-04-01`,
        },
      ]);

      expect(o.keyContacts).toEqual([
        {
          name: 'Ana Gil',
          office: 'Presidente',
          propertyRefs: ['1A', '2B'],
          phone: '610123456',
          email: expect.stringContaining('@test.local'),
        },
        {
          name: 'Blas Mora',
          office: 'Vicepresidente 1º',
          propertyRefs: ['2B'],
          phone: '699000111',
          email: 'blas@example.com',
        },
      ]);

      expect(
        o.essentialDocuments.map((d) => [d.type, d.document?.title ?? null]),
      ).toEqual([
        ['Escritura de constitución', null],
        ['Estatutos', 'Estatutos'],
        ['CIF de la comunidad', null],
        ['IBI', 'IBI 2025'],
        ['Póliza de seguro', null],
      ]);

      expect(o.insurance).toEqual([
        {
          contractId: expect.any(String),
          type: 'Multirriesgo comunidad',
          insurer: 'Mapfre',
          contractNumber: '0987654321',
          endDate: iso(daysFromNow(65)),
          renewalType: 'tacita',
          coverage: 'Daños por agua y RC',
        },
      ]);
    });

    it('uses the default bank account (masked, with its ledger account) when the estate has one', async () => {
      const created = await db.estate.create({
        data: {
          name: 'Con banco',
          type: 'Edificio',
          address: 'C/ B 1',
          location: 'Madrid',
          administratorId: fx.administratorId,
        },
      });
      try {
        await db.$transaction((tx) =>
          bootstrapEstateLedger(tx, created.id, {}),
        );
        await db.bankAccount.updateMany({
          where: { estateId: created.id, isDefault: true },
          data: {
            ibanEnc: 'ES7600491500051234567892',
            ibanLast4: '7892',
            bankName: null,
          },
        });
        const o = await service.overview(created.id, roleB(fx, [created.id]));
        expect(o.bank).toMatchObject({
          bankName: 'Banco Santander',
          iban: 'ES76 ···· 7892',
          masked: true,
          accountCode: '5720001',
        });
      } finally {
        await db.$executeRaw`SELECT accounting_purge_estate(${created.id}::uuid)`;
        await db.estate.delete({ where: { id: created.id } });
      }
    });

    it('is refused to another administrator despite a forged estate claim', async () => {
      await expect(
        service.overview(estateId, roleB(foreign, [estateId])),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('manager-only estate fields', () => {
    it('an owner (role C) never receives the internal notes or internal reference; the manager does', async () => {
      await db.estate.update({
        where: { id: estateId },
        data: { notes: 'NOTA INTERNA', internalRef: 'FIN-9', yearBuilt: 2001 },
      });
      const estates = new EstatesService(
        db as PrismaService,
        new EstateAccessService(),
        crypto,
        { refreshEstate: jest.fn() } as never,
        undefined as never,
        geo,
      );
      const ownerUser: AuthenticatedUser = {
        id: owner,
        role: 'C',
        estateIds: [estateId],
        administratorId: null,
      };

      const asOwner = await estates.findById(estateId, ownerUser);
      expect(asOwner).not.toHaveProperty('notes');
      expect(asOwner).not.toHaveProperty('internalRef');
      expect(asOwner.yearBuilt).toBe(2001);
      const listed = (await estates.list(ownerUser)).find(
        (e) => e.id === estateId,
      )!;
      expect(listed).not.toHaveProperty('notes');
      expect(listed).not.toHaveProperty('internalRef');

      const asManager = await estates.findById(estateId, actor);
      expect([asManager.notes, asManager.internalRef]).toEqual([
        'NOTA INTERNA',
        'FIN-9',
      ]);
    });
  });

  describe('Catastro facade on save (real row lock)', () => {
    it('the same reference keeps the facade without asking the Catastro; a new one clears and re-resolves it', async () => {
      const url =
        'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfLibres/OVCFotoFachada.svc/RecuperarFotoFachadaGet?ReferenciaCatastral=8792601VM3889S';
      await db.estate.update({
        where: { id: estateId },
        data: {
          cadastralReference: '8792601VM3889S',
          catastroFacadeUrl: url,
          catastroFacadeResolvedAt: new Date(),
        },
      });
      const facade = {
        refreshEstate: jest.fn().mockResolvedValue('https://new-facade'),
      };
      const estates = new EstatesService(
        db as PrismaService,
        new EstateAccessService(),
        crypto,
        facade as never,
        undefined as never,
        geo,
      );

      const same = await estates.update(
        estateId,
        { name: 'Finca renombrada', cadastralReference: '8792601VM3889S' },
        actor,
      );
      expect(same.catastroFacadeUrl).toBe(url);
      expect(facade.refreshEstate).not.toHaveBeenCalled();
      expect(
        (await db.estate.findUniqueOrThrow({ where: { id: estateId } }))
          .catastroFacadeUrl,
      ).toBe(url);

      const changed = await estates.update(
        estateId,
        { cadastralReference: '9872023VH5797S' },
        actor,
      );
      expect(facade.refreshEstate).toHaveBeenCalledWith(
        estateId,
        '9872023VH5797S',
      );
      expect(changed.catastroFacadeUrl).toBe('https://new-facade');
    });
  });
});
