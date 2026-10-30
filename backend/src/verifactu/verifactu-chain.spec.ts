import { ConfigService } from '@nestjs/config';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VerifactuService, type InvoiceForRecord } from './verifactu.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra la base de datos real: lo que se prueba aquí —
 * serialización bajo concurrencia e inmutabilidad por trigger— es
 * comportamiento de Postgres. Con mocks no se probaría nada.
 */
// Veinte transacciones a la vez abren conexiones nuevas: en máquinas lentas (Windows) superan el maxWait de 2 s por defecto.
const prisma = createPrismaClient(undefined, { transactionOptions: { maxWait: 20_000 } });

const ISSUER = 'TESTNIF01';
const OTHER_ISSUER = 'TESTNIF02';

function service(): VerifactuService {
  const config = {
    getOrThrow: () => ISSUER,
  } as unknown as ConfigService;
  return new VerifactuService(prisma as unknown as PrismaService, config);
}

function invoice(n: number): InvoiceForRecord {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    invoiceNo: `TEST-2026-${String(n).padStart(4, '0')}`,
    issueDate: new Date('2026-08-08T00:00:00Z'),
    taxAmount: new Prisma.Decimal('23.03'),
    total: new Prisma.Decimal('132.68'),
  };
}

/** Los registros de prueba no referencian facturas reales (invoice_id null). */
function detached(inv: InvoiceForRecord): InvoiceForRecord {
  return { ...inv, id: undefined as unknown as string };
}

async function cleanup(): Promise<void> {
  // El trigger impide DELETE: se desactiva solo para poder limpiar. Que haga
  // falta esto es, en sí, la prueba de que el trigger está activo.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE verifactu_records DISABLE TRIGGER verifactu_records_immutable`,
  );
  await prisma.$executeRaw`DELETE FROM verifactu_records WHERE issuer_tax_id IN (${ISSUER}, ${OTHER_ISSUER})`;
  await prisma.$executeRawUnsafe(
    `ALTER TABLE verifactu_records ENABLE TRIGGER verifactu_records_immutable`,
  );
  await prisma.$executeRaw`DELETE FROM verifactu_chain WHERE issuer_tax_id IN (${ISSUER}, ${OTHER_ISSUER})`;
}

describe('Cadena de registros de facturación', () => {
  const verifactu = service();

  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('el primer registro no tiene huella anterior', async () => {
    const record = await prisma.$transaction((tx) =>
      verifactu.appendAlta(tx, detached(invoice(1)), ISSUER),
    );
    expect(record.chainSeq).toBe(1);
    expect(record.previousHash).toBeNull();
    expect(record.hash).toMatch(/^[0-9A-F]{64}$/);
  });

  it('cada registro enlaza con la huella del anterior', async () => {
    const first = await prisma.$transaction((tx) =>
      verifactu.appendAlta(tx, detached(invoice(1)), ISSUER),
    );
    const second = await prisma.$transaction((tx) =>
      verifactu.appendAlta(tx, detached(invoice(2)), ISSUER),
    );
    expect(second.previousHash).toBe(first.hash);
    expect(second.chainSeq).toBe(2);
  });

  it('una anulación encadena igual que un alta', async () => {
    const alta = await prisma.$transaction((tx) =>
      verifactu.appendAlta(tx, detached(invoice(1)), ISSUER),
    );
    const anulacion = await prisma.$transaction((tx) =>
      verifactu.appendAnulacion(tx, detached(invoice(1)), ISSUER),
    );
    expect(anulacion.type).toBe('anulacion');
    expect(anulacion.previousHash).toBe(alta.hash);
    await expect(verifactu.verifyChain(ISSUER)).resolves.toMatchObject({
      ok: true,
      checked: 2,
    });
  });

  it('cada emisor tiene una cadena independiente', async () => {
    const mine = await prisma.$transaction((tx) =>
      verifactu.appendAlta(tx, detached(invoice(1)), ISSUER),
    );
    const theirs = await prisma.$transaction((tx) =>
      verifactu.appendAlta(tx, detached(invoice(1)), OTHER_ISSUER),
    );
    // Ambas empiezan en 1 y ninguna enlaza con la otra.
    expect(mine.chainSeq).toBe(1);
    expect(theirs.chainSeq).toBe(1);
    expect(theirs.previousHash).toBeNull();
  });

  it('bajo concurrencia no se bifurca ni repite posición', async () => {
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        prisma.$transaction((tx) =>
          verifactu.appendAlta(tx, detached(invoice(i + 1)), ISSUER),
        ),
      ),
    );

    const records = await prisma.verifactuRecord.findMany({
      where: { issuerTaxId: ISSUER },
      orderBy: { chainSeq: 'asc' },
    });
    expect(records).toHaveLength(N);
    // Sin saltos y con cada eslabón apuntando al anterior.
    expect(records.map((r) => r.chainSeq)).toEqual(
      Array.from({ length: N }, (_, i) => i + 1),
    );
    await expect(verifactu.verifyChain(ISSUER)).resolves.toMatchObject({
      ok: true,
    });
  });

  describe('verifyChain', () => {
    it('acepta una cadena intacta', async () => {
      for (let i = 1; i <= 3; i++) {
        await prisma.$transaction((tx) =>
          verifactu.appendAlta(tx, detached(invoice(i)), ISSUER),
        );
      }
      await expect(verifactu.verifyChain(ISSUER)).resolves.toEqual({
        ok: true,
        checked: 3,
        problems: [],
      });
    });

    it('detecta un importe manipulado aunque el trigger se hubiera saltado', async () => {
      await prisma.$transaction((tx) =>
        verifactu.appendAlta(tx, detached(invoice(1)), ISSUER),
      );
      // Se fuerza la manipulación desactivando el trigger: simula a alguien
      // con acceso directo a la base de datos.
      await prisma.$executeRawUnsafe(
        `ALTER TABLE verifactu_records DISABLE TRIGGER verifactu_records_immutable`,
      );
      await prisma.$executeRaw`
        UPDATE verifactu_records
           SET payload = jsonb_set(payload, '{importeTotal}', '"999.99"')
         WHERE issuer_tax_id = ${ISSUER}
      `;
      await prisma.$executeRawUnsafe(
        `ALTER TABLE verifactu_records ENABLE TRIGGER verifactu_records_immutable`,
      );

      const result = await verifactu.verifyChain(ISSUER);
      expect(result.ok).toBe(false);
      expect(result.problems.join(' ')).toContain(
        'no coincide con sus propios datos',
      );
    });
  });

  describe('inmutabilidad garantizada por la base de datos', () => {
    it('rechaza borrar un registro', async () => {
      await prisma.$transaction((tx) =>
        verifactu.appendAlta(tx, detached(invoice(1)), ISSUER),
      );
      await expect(
        prisma.$executeRaw`DELETE FROM verifactu_records WHERE issuer_tax_id = ${ISSUER}`,
      ).rejects.toThrow(/no se pueden borrar/);
    });

    it('rechaza alterar la huella', async () => {
      await prisma.$transaction((tx) =>
        verifactu.appendAlta(tx, detached(invoice(1)), ISSUER),
      );
      await expect(
        prisma.$executeRaw`
          UPDATE verifactu_records SET hash = ${'0'.repeat(64)} WHERE issuer_tax_id = ${ISSUER}
        `,
      ).rejects.toThrow(/inmutables/);
    });

    it('rechaza alterar el payload', async () => {
      await prisma.$transaction((tx) =>
        verifactu.appendAlta(tx, detached(invoice(1)), ISSUER),
      );
      await expect(
        prisma.$executeRaw`
          UPDATE verifactu_records SET payload = '{}'::jsonb WHERE issuer_tax_id = ${ISSUER}
        `,
      ).rejects.toThrow(/inmutables/);
    });

    // El seguimiento del envío SÍ debe poder actualizarse: es administración
    // del envío, no el registro fiscal.
    it('permite actualizar el estado de remisión', async () => {
      await prisma.$transaction((tx) =>
        verifactu.appendAlta(tx, detached(invoice(1)), ISSUER),
      );
      await expect(
        prisma.$executeRaw`
          UPDATE verifactu_records
             SET submission_state = 'aceptado', aeat_csv = 'CSV-PRUEBA', attempts = 1
           WHERE issuer_tax_id = ${ISSUER}
        `,
      ).resolves.toBe(1);
    });
  });
});
