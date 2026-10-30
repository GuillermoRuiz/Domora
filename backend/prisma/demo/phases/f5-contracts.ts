import type { ConfigService } from '@nestjs/config';
import { StorageService } from '../../../src/files/storage.service';
import { SuppliersService } from '../../../src/suppliers/suppliers.service';
import type { DemoCtx } from '../context';
import { PORTFOLIO } from '../data/portfolio';
import { makePdf } from '../lib/pdf';

/**
 * F5 — contratos con proveedores listos para el panel «Contratos» de la ficha: importe y
 * periodicidad en todos, estados variados (vigente, por vencer, vencido, programado, cancelado, sin
 * fecha de fin, puntual), histórico de renovaciones y documentos con su PDF. Va la última, sobre
 * los contratos que ya sembraron F2c (fincas base) y F4 (cartera).
 *
 * Servicios REALES: `SuppliersService.updateSupplierContract/createSupplierContract/
 * cancelSupplierContract`. RAW, con su motivo:
 *  - fecha de inicio de los contratos y el histórico de renovaciones: ningún servicio fabrica renovaciones
 *    pasadas (`renewSupplierContract` solo registra la de hoy);
 *  - fecha de cancelación (el servicio usa `new Date()`);
 *  - documentos: se guardan con el STORAGE_DIR REAL del proceso, como F3 (el servicio inyectado captura la
 *    configuración al importar el módulo).
 */

/** Contratos EXTRA que F5 añade a la cartera (no a las fincas base): programado, cancelado, puntual y sin fin. */
export const CONTRACT_EXTRAS: Record<string, number> = { p1: 1, p3: 2, p5: 1 };

/** Importe por servicio: `[importe, periodicidad]`. Lo que no esté aquí cuesta 1.200 € al año. */
const COST_BY_SERVICE: Record<string, readonly [number, 'MONTHLY' | 'QUARTERLY' | 'ANNUAL']> = {
  Ascensores: [3_600, 'ANNUAL'],
  Limpieza: [420, 'MONTHLY'],
  Seguros: [2_200, 'ANNUAL'],
  Jardinería: [120, 'MONTHLY'],
  Fontanería: [60, 'MONTHLY'],
  Seguridad: [260, 'MONTHLY'],
  Calefacción: [200, 'MONTHLY'],
  Electricidad: [440, 'MONTHLY'],
  Piscinas: [180, 'MONTHLY'],
  Automatismos: [150, 'QUARTERLY'],
  'Protección contra incendios': [720, 'ANNUAL'],
};
const DEFAULT_COST: readonly [number, 'ANNUAL'] = [1_200, 'ANNUAL'];

const DAY = 86_400_000;

export async function runF5Contracts(ctx: DemoCtx): Promise<void> {
  const suppliers = ctx.app.get(SuppliersService, { strict: false });
  // Almacenamiento con el STORAGE_DIR real del proceso (ver cabecera).
  const storage = new StorageService({ get: (key: string) => process.env[key] } as unknown as ConfigService);
  const gestora = ctx.actors.gestora;
  const { prisma, clock } = ctx;
  const d = (offsetDays: number) => clock.d(offsetDays);
  const iso = (offsetDays: number) => d(offsetDays).toISOString().slice(0, 10);

  const estates = await prisma.estate.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  const portfolioKeyByName = new Map<string, string>();
  for (const e of PORTFOLIO) portfolioKeyByName.set(e.name, e.key);

  for (const estate of estates) {
    const contracts = await prisma.supplierContract.findMany({
      where: { estateId: estate.id },
      orderBy: [{ serviceType: 'asc' }, { id: 'asc' }],
      include: { supplier: { select: { id: true, name: true } } },
    });

    for (const [index, c] of contracts.entries()) {
      // 1) Importe y periodicidad (cada contrato un poco distinto del de otra finca).
      const [base, frequency] = COST_BY_SERVICE[c.serviceType] ?? DEFAULT_COST;
      const amount = Math.round(base * (1 + (index % 3) * 0.08) * 100) / 100;
      await suppliers.updateSupplierContract(estate.id, c.supplierId, c.id, { costAmount: amount, costFrequency: frequency }, gestora);

      // 2) Histórico de renovaciones coherente con el vencimiento actual.
      if (c.endDate) {
        const endMs = c.endDate.getTime();
        const years = c.renewalType === 'tacita' ? 3 : 2;
        const start = new Date(endMs - years * 365 * DAY);
        await prisma.supplierContract.update({ where: { id: c.id }, data: { startDate: start } });
        for (let k = 1; k < years; k++) {
          const renewedAt = new Date(start.getTime() + k * 365 * DAY);
          if (renewedAt.getTime() > clock.anchor.getTime()) continue;
          await prisma.supplierContractRenewal.create({
            data: {
              contractId: c.id,
              estateId: estate.id,
              renewedAt,
              previousEndDate: renewedAt,
              newEndDate: new Date(renewedAt.getTime() + 365 * DAY),
              costAmount: Math.round(amount * (1 - 0.03 * (years - k)) * 100) / 100,
              costFrequency: frequency,
              kind: c.renewalType === 'tacita' ? 'tacita' : 'manual',
            },
          });
        }
      }

      // 3) Un documento con su PDF en la mitad de los contratos.
      if (index % 2 === 0) {
        const title = `Contrato de ${c.serviceType}`;
        const pdf = await makePdf({
          title,
          subtitle: `${estate.name} · ${c.supplier.name}`,
          lines: [`Contrato de ${c.serviceType} con ${c.supplier.name}.`, 'Datos ficticios del entorno de demostración.'],
          creationDate: c.startDate,
        });
        const key = await storage.put(`supplier-documents/${c.supplierId}`, `${title}.pdf`, pdf);
        await prisma.supplierDocument.create({
          data: { supplierId: c.supplierId, contractId: c.id, documentType: 'Contrato', title, fileName: `${title}.pdf`, mimeType: 'application/pdf', s3Key: key },
        });
      }
    }

    // 4) Contratos extra en algunas fincas de la cartera: programado, puntual, sin fin y cancelado.
    const key = portfolioKeyByName.get(estate.name);
    const extras = key ? (CONTRACT_EXTRAS[key] ?? 0) : 0;
    if (extras > 0) {
      const supplier = await prisma.supplier.findFirstOrThrow({ where: { estateId: estate.id }, orderBy: { name: 'asc' }, select: { id: true, category: true } });
      const make = (dto: Parameters<SuppliersService['createSupplierContract']>[2]) =>
        suppliers.createSupplierContract(estate.id, supplier.id, dto, gestora);
      if (key === 'p1') {
        await make({ serviceType: 'Mantenimiento de cubierta', startDate: iso(30), endDate: iso(395), renewalType: 'manual', costAmount: 150, costFrequency: 'MONTHLY' });
      }
      if (key === 'p3') {
        await make({ serviceType: 'Reforma del portal', startDate: iso(-120), endDate: iso(-90), renewalType: 'manual', costAmount: 8_500, costFrequency: 'ONE_OFF' });
        const old = await make({ serviceType: 'Mantenimiento antiguo', startDate: iso(-700), endDate: iso(200), renewalType: 'tacita', costAmount: 90, costFrequency: 'MONTHLY' });
        await suppliers.cancelSupplierContract(estate.id, supplier.id, old.id, { cancelledReason: 'Sustituido por otro proveedor' }, gestora);
        // RAW: el servicio cancela con `new Date()`.
        await prisma.supplierContract.update({ where: { id: old.id }, data: { cancelledAt: d(-20) } });
      }
      if (key === 'p5') {
        await make({ serviceType: 'Servicio de portería', startDate: iso(-500), renewalType: 'tacita', costAmount: 1_900, costFrequency: 'MONTHLY' });
      }
    }
  }
  await assertContractFigures(ctx);
}

/** Aborta el seed si los contratos no cuadran con lo previsto. */
async function assertContractFigures(ctx: DemoCtx): Promise<void> {
  const { prisma } = ctx;
  const withoutCost = await prisma.supplierContract.count({ where: { costAmount: null } });
  if (withoutCost > 0) throw new Error(`F5: ${withoutCost} contratos sin importe.`);
  const extras = Object.values(CONTRACT_EXTRAS).reduce((a, b) => a + b, 0);
  const programmed = await prisma.supplierContract.count({ where: { cancelledAt: null, startDate: { gt: ctx.clock.anchor } } });
  const cancelled = await prisma.supplierContract.count({ where: { cancelledAt: { not: null } } });
  const indefinite = await prisma.supplierContract.count({ where: { endDate: null, cancelledAt: null } });
  const oneOff = await prisma.supplierContract.count({ where: { costFrequency: 'ONE_OFF' } });
  if (programmed < 1 || cancelled !== 1 || indefinite !== 1 || oneOff !== 1) {
    throw new Error(`F5: estados inesperados (programados ${programmed}, cancelados ${cancelled}, sin fin ${indefinite}, puntuales ${oneOff}).`);
  }
  const renewals = await prisma.supplierContractRenewal.count();
  const documents = await prisma.supplierDocument.count({ where: { documentType: 'Contrato' } });
  if (renewals < 20 || documents < 10) throw new Error(`F5: pocas renovaciones (${renewals}) o documentos (${documents}) para ${extras} extras.`);
}
