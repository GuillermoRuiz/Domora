import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { bootstrapEstateLedger } from '../src/ledger/chart/ledger-bootstrap';
import { JournalService } from '../src/ledger/journal/journal.service';
import { ReceiptPostingService } from '../src/ledger/posting/receipt-posting.service';
import { createPrismaClient } from '../src/prisma/create-prisma-client';

const prisma = createPrismaClient();

const SEED_EMAIL = 'admin@domora.app';
const SEED_PASSWORD = 'admin123';

/**
 * Duplica el algoritmo de backend/src/sepa/crypto.service.ts (AES-256-GCM,
 * mismo prefijo 'enc:v1:', misma derivación de clave por scrypt si falta
 * SEPA_ENC_KEY) porque seed.ts corre fuera del contenedor de NestJS y no
 * puede inyectar CryptoService. Si cambia el algoritmo allá, hay que
 * actualizar esto también — es la única duplicación aceptada a propósito.
 */
function encryptIban(plainIban: string): string {
  const hexKey = process.env['SEPA_ENC_KEY'];
  const hasValidKey = !!hexKey && /^[0-9a-fA-F]{64}$/.test(hexKey);

  // Mismo control que CryptoService: sin clave válida la derivación usa una
  // sal fija y pública, así que el resultado es reproducible por cualquiera.
  // Aceptable para datos de demo; nunca contra una base de datos real.
  if (!hasValidKey && process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'SEPA_ENC_KEY ausente o inválida: el seed no cifrará IBAN con una clave derivada de JWT_SECRET en producción.',
    );
  }

  const key = hasValidKey
    ? Buffer.from(hexKey, 'hex')
    : crypto.scryptSync(
        process.env['JWT_SECRET'] ?? 'dev-secret-change-me',
        'domora-iban-at-rest',
        32,
      );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plainIban, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return 'enc:v1:' + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

async function main() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const administrator = await prisma.administrator.upsert({
    where: { cif: 'B00000001' },
    update: {},
    create: {
      name: 'Gestora Demo S.L.',
      cif: 'B00000001',
      plan: 'STANDARD',
      tier: 'standard',
      // usersActive ya NO se persiste (Apéndice H): se calcula al vuelo
      // contando property_memberships con status='linked', no un contador
      // almacenado que pueda desincronizarse.
      usersMax: 10,
      status: 'Activa',
      contactName: 'Admin Demo',
      contactEmail: SEED_EMAIL,
      mrr: 49.0,
    },
  });

  // estates has no natural unique key besides id, so "find or create" is
  // done with an explicit findFirst instead of upsert (which requires a
  // unique `where`), keeping the seed script idempotent across re-runs.
  const existingEstate = await prisma.estate.findFirst({
    where: { administratorId: administrator.id, name: 'Residencial Demo' },
  });
  const estate =
    existingEstate ??
    (await prisma.estate.create({
      data: {
        administratorId: administrator.id,
        name: 'Residencial Demo',
        type: 'Edificio',
        address: 'Calle Falsa',
        streetNumber: '123',
        location: 'Madrid',
        reserveTarget: 5000,
      },
    }));

  const user = await prisma.user.upsert({
    where: { email: SEED_EMAIL },
    update: { passwordHash },
    create: {
      email: SEED_EMAIL,
      passwordHash,
      fullName: 'Admin Demo',
      role: 'B',
      administratorId: administrator.id,
    },
  });

  // Sin esto PropertiesService.resolveView() nunca resuelve `adminContact`
  // (lee Administrator.primaryUser) — la tarjeta "Administrador" del
  // propietario y "Enviar mensaje" quedan sin destinatario resoluble.
  if (!administrator.primaryUserId) {
    await prisma.administrator.update({
      where: { id: administrator.id },
      data: { primaryUserId: user.id },
    });
  }

  // ── Demo mínima del modelo enriquecido (Fase 0.5) ─────────────────────
  // Un propietario con NIF, una propiedad con datos catastrales, y su
  // membresía como titular principal — smoke test de que las tablas nuevas
  // (users.tax_id, properties, property_memberships) funcionan de extremo a
  // extremo. Fases posteriores (2+) ampliarán esto con fixtures propios por
  // módulo (issues, receipts, mandates...).
  const owner = await prisma.user.upsert({
    where: { email: 'maria.garcia@demo.app' },
    update: {},
    create: {
      email: 'maria.garcia@demo.app',
      passwordHash: await bcrypt.hash('owner123', 10),
      fullName: 'María García López',
      role: 'C',
      taxIdCountry: 'ES',
      taxId: '12345678Z',
    },
  });

  const existingProperty = await prisma.property.findFirst({
    where: { estateId: estate.id, ref: '2B' },
  });
  const property =
    existingProperty ??
    (await prisma.property.create({
      data: {
        estateId: estate.id,
        administratorId: administrator.id,
        type: 'Piso',
        status: 'Ocupado',
        viaType: 'Calle',
        viaName: 'Falsa',
        streetNumber: '123',
        staircase: '1',
        floor: '2',
        door: 'B',
        ref: '2B',
        postalCode: '28001',
        municipality: 'Madrid',
        province: 'Madrid',
        country: 'ES',
        quotaMonthly: 87.5,
      },
    }));

  await prisma.propertyMembership.upsert({
    where: {
      propertyId_userId_roleType: {
        propertyId: property.id,
        userId: owner.id,
        roleType: 'Propietario',
      },
    },
    update: {},
    create: {
      propertyId: property.id,
      userId: owner.id,
      roleType: 'Propietario',
      status: 'linked',
      isPrimaryContact: true,
      nickname: 'Vivienda habitual',
      linkedAt: new Date('2024-01-15T00:00:00Z'),
      approvedByUserId: user.id,
    },
  });

  // ── Contabilidad de la finca ───────────────────────────────────────────
  // Mismo arranque que EstatesService.create(): configuración con fecha de
  // corte (1 de enero del año en curso, para poder contabilizar todo el
  // ejercicio de demo), plan de cuentas de comunidades y banco por defecto.
  // Idempotente: volver a ejecutar el seed no duplica nada.
  await prisma.$transaction((tx) =>
    bootstrapEstateLedger(tx, estate.id, {
      cutoverDate: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
    }),
  );

  // ── Periodo contable + mandato + recibo pendiente ──────────────────────
  // Fixture mínima para poder generar una remesa SEPA real de punta a
  // punta (antes no había ningún recibo domiciliado con mandato activo,
  // así que "Nueva remesa" siempre fallaba con "no hay recibos
  // pendientes"). Ver doc/frontend-zoneless-audit-guide.md §5.2.
  const now = new Date();
  const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const MONTH_LABELS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const monthLabel = MONTH_LABELS[now.getMonth()];
  const period = await prisma.accountingPeriod.upsert({
    where: { estateId_periodKey: { estateId: estate.id, periodKey } },
    update: {},
    create: {
      estateId: estate.id,
      periodKey,
      label: `${monthLabel} ${now.getFullYear()}`,
      monthAbbrev: monthLabel.slice(0, 3).toUpperCase(),
      issuedAt: now,
    },
  });

  const existingMandate = await prisma.mandate.findFirst({
    where: { propertyId: property.id, status: 'active' },
  });
  const mandate =
    existingMandate ??
    (await prisma.mandate.create({
      data: {
        umr: `DOMORA-DEMO-${property.id.slice(0, 8)}`,
        creditorEstateId: estate.id,
        propertyId: property.id,
        titularUserId: owner.id,
        scheme: 'CORE',
        paymentType: 'recurrent',
        debtorIban: encryptIban('ES9121000418450200051332'),
        debtorBic: 'CAIXESBBXXX',
        signedAt: new Date('2024-01-15'),
        status: 'active',
      },
    }));

  const existingReceipt = await prisma.accountingReceipt.findFirst({
    where: { periodId: period.id, propertyId: property.id },
  });
  if (!existingReceipt) {
    // Por la vía contable, como cualquier recibo: nace con su asiento de
    // emisión (la base de datos rechaza un recibo sin él).
    const receiptPosting = new ReceiptPostingService(new JournalService());
    await prisma.$transaction((tx) =>
      receiptPosting.issue(tx, {
        estateId: estate.id,
        periodId: period.id,
        periodKey,
        propertyId: property.id,
        no: `${periodKey}-001`,
        ownerUserId: owner.id,
        mandateId: mandate.id,
        concept: `Cuota ordinaria ${monthLabel} ${now.getFullYear()}`,
        kind: 'cuota_ordinaria',
        amount: Math.round(Number(property.quotaMonthly) * 100),
        dueDate: now,
        method: 'Domiciliacion',
        manual: false,
        ownerNameSnapshot: 'María García López',
        ownerTaxIdSnapshot: '12345678Z',
        ownerTaxIdCountrySnapshot: 'ES',
      }),
    );
  }

  // ── Instalaciones (zonas comunes reservables) ──────────────────────────
  // Sin al menos una activa, la pestaña "Reservas" del propietario nunca
  // aparece (property-detail.component.ts la muestra solo si
  // amenities().length > 0) — ver plan "Reserva de instalaciones".
  const DEMO_AMENITIES = [
    {
      name: 'Piscina', icon: '🏊', color: 'var(--color-secondary)', bg: 'var(--color-secondary-bg)',
      maxHours: 3, capacity: 15, seasonal: true, seasonLabel: '15 jun – 15 sep',
      rules: 'Ducha obligatoria antes de entrar. Aforo máximo 15.',
      slots: ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'],
    },
    {
      name: 'Gimnasio', icon: '🏋️', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)',
      maxHours: 2, capacity: 6, seasonal: false, seasonLabel: null,
      rules: 'Aforo máximo 6 personas. Llevar toalla obligatoriamente.',
      slots: ['07:00', '08:00', '09:00', '10:00', '11:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'],
    },
    {
      name: 'Sala de reuniones', icon: '📋', color: 'var(--color-accent)', bg: 'var(--color-bg)',
      maxHours: 3, capacity: 8, seasonal: false, seasonLabel: null,
      rules: 'Reserva mínima 1 hora. Dejar la sala ordenada. No se permite comida.',
      slots: ['09:00', '10:00', '11:00', '12:00', '16:00', '17:00', '18:00', '19:00'],
    },
    {
      name: 'Pista de pádel', icon: '🏓', color: 'var(--color-accent)', bg: 'var(--color-bg)',
      maxHours: 2, capacity: 4, seasonal: false, seasonLabel: null,
      rules: 'Máximo 2 horas seguidas. Calzado deportivo obligatorio.',
      slots: ['09:00', '10:00', '11:00', '12:00', '13:00', '16:00', '17:00', '18:00', '19:00', '20:00'],
    },
  ];
  for (const am of DEMO_AMENITIES) {
    const existing = await prisma.amenity.findFirst({
      where: { estateId: estate.id, name: am.name },
    });
    if (!existing) {
      await prisma.amenity.create({ data: { ...am, estateId: estate.id } });
    }
  }

  // ── Documentos (con fichero real en disco, no solo metadata) ───────────
  // Sin esto GET /documents/:id/file siempre 404 ("sin fichero asociado")
  // — Document.s3Key es nullable y nada más en el seed lo poblaba.
  const DEMO_DOCUMENTS = [
    { title: 'Estatutos de la comunidad.txt', type: 'Estatutos', body: 'Estatutos de la comunidad de propietarios — Residencial Demo.\n\n(Documento de ejemplo para el entorno de demo.)' },
    { title: 'Acta última junta.txt', type: 'Acta', body: 'Acta de la junta ordinaria — Residencial Demo.\n\n(Documento de ejemplo para el entorno de demo.)' },
  ];
  // NOTA: StorageService resuelve su raíz igual (`STORAGE_DIR ?? .../storage`)
  // — se replica tal cual, incluida la particularidad de que `??` no cae al
  // default si la env var está declarada vacía (`STORAGE_DIR=` en .env), para
  // que el fichero quede exactamente donde el endpoint de descarga lo busca.
  const storageRoot = process.env['STORAGE_DIR'] ?? path.join(process.cwd(), 'storage');
  for (const doc of DEMO_DOCUMENTS) {
    const existingDoc = await prisma.document.findFirst({
      where: { estateId: estate.id, title: doc.title },
    });
    if (existingDoc) continue;
    const content = Buffer.from(doc.body, 'utf-8');
    const key = `documents/${estate.id}/${crypto.randomUUID()}-${doc.title.replace(/[^A-Za-z0-9._-]/g, '_')}`;
    const fullPath = path.join(storageRoot, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    await prisma.document.create({
      data: {
        estateId: estate.id,
        title: doc.title,
        type: doc.type,
        date: new Date(),
        size: `${Math.max(1, Math.round(content.byteLength / 1024))} KB`,
        s3Key: key,
      },
    });
  }

  // ── Usuario demo de rol A (super-admin) ───────────────────────────────
  // Rol A bypassa el scoping por estate (estate-access.service.ts), así
  // que no necesita administratorId ni ningún vínculo a estate/property.
  const SUPERADMIN_EMAIL = 'superadmin@domora.app';
  const SUPERADMIN_PASSWORD = 'super123';
  const superadmin = await prisma.user.upsert({
    where: { email: SUPERADMIN_EMAIL },
    update: { passwordHash: await bcrypt.hash(SUPERADMIN_PASSWORD, 10) },
    create: {
      email: SUPERADMIN_EMAIL,
      passwordHash: await bcrypt.hash(SUPERADMIN_PASSWORD, 10),
      fullName: 'Super Admin Demo',
      role: 'A',
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seed completed:');
  // eslint-disable-next-line no-console
  console.log(`  administrator: ${administrator.name} (${administrator.id})`);
  // eslint-disable-next-line no-console
  console.log(`  estate:        ${estate.name} (${estate.id})`);
  // eslint-disable-next-line no-console
  console.log(`  user:          ${user.email} / role ${user.role}`);
  // eslint-disable-next-line no-console
  console.log(`  owner:         ${owner.email} / property ${property.ref}`);
  // eslint-disable-next-line no-console
  console.log(`  period:        ${period.label} (recibo pendiente, mandato ${mandate.umr})`);
  // eslint-disable-next-line no-console
  console.log('  Nota: falta configurar creditorId/creditorIban de la finca (pestaña "Facturación SEPA" en la ficha de la finca) para poder generar una remesa real.');
  // eslint-disable-next-line no-console
  console.log(`  superadmin:    ${superadmin.email} / role ${superadmin.role}`);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('Login credentials:');
  // eslint-disable-next-line no-console
  console.log(`  email:    ${SEED_EMAIL}`);
  // eslint-disable-next-line no-console
  console.log(`  password: ${SEED_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
