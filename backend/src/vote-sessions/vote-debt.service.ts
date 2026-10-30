import { Injectable } from '@nestjs/common';
import type { ReceiptStatus } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Recibos que deben algo: su `outstanding` es lo que queda por cobrar (mismo criterio que la morosidad). */
const OPEN_RECEIPT_STATUSES: ReceiptStatus[] = ['Pendiente', 'Parcial', 'Devuelto'];

/**
 * Art. 15.2 LPH: no tiene derecho de voto quien, al iniciarse la junta, no está al corriente de las
 * deudas VENCIDAS con la comunidad. Esta clase solo calcula esa deuda; qué se hace con ella
 * (bloquear el voto, permitir que la gestora lo anule) lo decide `VoteSessionsService`.
 */
@Injectable()
export class VoteDebtService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deuda vencida (importe positivo) de las propiedades de la finca que deben algo: recibos abiertos
   * cuyo vencimiento ya pasó (o sin vencimiento indicado). Las propiedades al corriente no aparecen.
   */
  async overdueByProperty(estateId: string, propertyIds?: string[], at: Date = new Date()): Promise<Map<string, number>> {
    const rows = await this.prisma.accountingReceipt.groupBy({
      by: ['propertyId'],
      where: {
        estateId,
        ...(propertyIds ? { propertyId: { in: propertyIds } } : {}),
        status: { in: OPEN_RECEIPT_STATUSES },
        outstanding: { gt: 0 },
        OR: [{ dueDate: null }, { dueDate: { lte: at } }],
      },
      _sum: { outstanding: true },
    });
    const debts = new Map<string, number>();
    for (const row of rows) {
      const amount = Number(row._sum.outstanding?.toString() ?? 0);
      if (amount > 0) debts.set(row.propertyId, Math.round(amount * 100) / 100);
    }
    return debts;
  }
}
