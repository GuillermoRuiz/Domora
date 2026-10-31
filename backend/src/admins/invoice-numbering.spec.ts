import { PrismaClient } from '../prisma/client';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Prueba de integración contra la base de datos real: lo que se verifica aquí
 * —atomicidad y ausencia de huecos— depende del comportamiento de Postgres,
 * así que un mock no probaría nada.
 *
 * Antes, el número se calculaba con `count()` de filas dentro de la
 * transacción. Eso fallaba de dos maneras que la facturación no admite:
 * dos emisiones simultáneas contaban lo mismo, y borrar una factura hacía
 * que la siguiente reutilizase un número ya usado.
 */
// Veinte transacciones a la vez abren conexiones nuevas: en máquinas lentas (Windows) superan el maxWait de 2 s por defecto.
const prisma = createPrismaClient(undefined, {
  transactionOptions: { maxWait: 20_000 },
});

const SERIES = 'TEST';
const YEAR = 2999; // ejercicio inventado: no colisiona con datos reales

/** Réplica exacta de AdminsService.nextInvoiceNumber. */
async function nextNumber(
  tx: Pick<PrismaClient, '$queryRaw'>,
  series: string,
  year: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ last_number: number }[]>`
    INSERT INTO invoice_series (series, year, last_number)
    VALUES (${series}, ${year}, 1)
    ON CONFLICT (series, year)
    DO UPDATE SET last_number = invoice_series.last_number + 1
    RETURNING last_number
  `;
  return rows[0].last_number;
}

describe('Numeración de facturas', () => {
  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM invoice_series WHERE series = ${SERIES}`;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM invoice_series WHERE series = ${SERIES}`;
    await prisma.$disconnect();
  });

  it('empieza en 1 y avanza de uno en uno', async () => {
    expect(await nextNumber(prisma, SERIES, YEAR)).toBe(1);
    expect(await nextNumber(prisma, SERIES, YEAR)).toBe(2);
    expect(await nextNumber(prisma, SERIES, YEAR)).toBe(3);
  });

  it('no entrega el mismo número a dos emisiones simultáneas', async () => {
    const CONCURRENT = 20;
    const numbers = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        prisma.$transaction((tx) => nextNumber(tx, SERIES, YEAR)),
      ),
    );

    expect(new Set(numbers).size).toBe(CONCURRENT);
    // Y sin huecos: exactamente 1..N en algún orden.
    expect([...numbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: CONCURRENT }, (_, i) => i + 1),
    );
  });

  it('libera el número si la transacción falla, en vez de dejar un hueco', async () => {
    expect(await nextNumber(prisma, SERIES, YEAR)).toBe(1);

    // Una emisión que revienta después de reservar el número.
    await expect(
      prisma.$transaction(async (tx) => {
        await nextNumber(tx, SERIES, YEAR); // reserva el 2
        throw new Error('fallo al emitir la factura');
      }),
    ).rejects.toThrow('fallo al emitir');

    // El 2 sigue libre: la numeración no puede saltarse un número. Con una
    // SEQUENCE de Postgres esto habría devuelto 3.
    expect(await nextNumber(prisma, SERIES, YEAR)).toBe(2);
  });

  it('lleva contadores independientes por ejercicio', async () => {
    expect(await nextNumber(prisma, SERIES, YEAR)).toBe(1);
    expect(await nextNumber(prisma, SERIES, YEAR)).toBe(2);
    // El año siguiente arranca de nuevo en 1.
    expect(await nextNumber(prisma, SERIES, YEAR + 1)).toBe(1);
    await prisma.$executeRaw`DELETE FROM invoice_series WHERE series = ${SERIES} AND year = ${YEAR + 1}`;
  });
});
