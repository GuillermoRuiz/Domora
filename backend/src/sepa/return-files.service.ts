import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type ReturnFileItemStatus } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import { runPosting } from '../ledger/journal/journal-db-errors';
import { fromCents, toCents } from '../ledger/money';
import {
  parseReturnFile,
  ReturnFileParseError,
  type ParsedReturnItem,
} from './parsers/return-file-parser';
import { returnReasonText } from './parsers/sepa-return-reasons';

/** Un fichero de devoluciones es pequeño: 5 MB son decenas de miles de operaciones. */
export const RETURN_FILE_MAX_BYTES = 5 * 1024 * 1024;

export interface UploadedReturnFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

type Db = Prisma.TransactionClient | PrismaService;

interface PlannedItem {
  seq: number;
  item: ParsedReturnItem;
  status: ReturnFileItemStatus;
  remesaLineId: string | null;
  error: string | null;
}

type LineForMatch = {
  id: string;
  status: string;
  amount: Prisma.Decimal;
  endToEndId: string | null;
  receipt: { no: string };
  remesa: { id: string; messageId: string | null; status: string };
};

const LINE_SELECT = {
  id: true,
  status: true,
  amount: true,
  endToEndId: true,
  receipt: { select: { no: true } },
  remesa: { select: { id: true, messageId: true, status: true } },
} as const;

function day(iso: string | null): Date {
  return new Date(
    `${(iso ?? new Date().toISOString()).slice(0, 10)}T00:00:00Z`,
  );
}

/**
 * Ficheros de devoluciones del banco (fase 6). Subirlo guarda el fichero con
 * cada partida ya emparejada con su línea de remesa, para revisarlo antes de
 * contabilizar; aplicarlo registra cada devolución o rechazo a través de
 * `CollectionPostingService.returnRemesaLine`, una transacción por partida.
 *
 * Idempotente por diseño: el mismo fichero (mismo hash) es el mismo registro,
 * una partida aplicada no se vuelve a aplicar (la base de datos lo impide,
 * DM042) y una línea ya devuelta por otro fichero o a mano queda marcada como
 * tal en vez de devolverse dos veces.
 */
@Injectable()
export class ReturnFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly collections: CollectionPostingService,
  ) {}

  async upload(
    estateId: string,
    file: UploadedReturnFile | undefined,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'No se recibió ningún fichero (campo "file").',
      );
    }
    if (file.size > RETURN_FILE_MAX_BYTES) {
      throw new BadRequestException('El fichero supera los 5 MB.');
    }
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.returnFile.findUnique({
      where: { estateId_fileHash: { estateId, fileHash } },
      select: { id: true },
    });
    if (existing) {
      return { ...(await this.loadDetail(existing.id)), duplicate: true };
    }

    let parsed;
    try {
      parsed = parseReturnFile(file.buffer.toString('utf8'));
    } catch (error) {
      if (error instanceof ReturnFileParseError)
        throw new BadRequestException(error.message);
      throw error;
    }
    if (parsed.items.length === 0) {
      throw new BadRequestException(
        parsed.ignored > 0
          ? 'El fichero no contiene devoluciones ni rechazos: todas sus operaciones están aceptadas o no son adeudos devueltos.'
          : 'El fichero no contiene ninguna operación.',
      );
    }

    const planned = await this.plan(estateId, parsed.items);
    const created = await this.prisma.returnFile.create({
      data: {
        estateId,
        format: parsed.format,
        fileName: (file.originalname || 'devoluciones.xml').slice(0, 255),
        fileHash,
        messageId: parsed.messageId?.slice(0, 35) ?? null,
        createdByUserId: user.id,
        items: {
          create: planned.map((p) => ({
            seq: p.seq,
            endToEndId: p.item.endToEndId,
            originalMessageId: p.item.originalMessageId?.slice(0, 35) ?? null,
            amount: p.item.amount !== null ? fromCents(p.item.amount) : null,
            date: p.item.date ? day(p.item.date) : null,
            returnCode: p.item.returnCode,
            returnReason:
              returnReasonText(p.item.returnCode)?.slice(0, 150) ?? null,
            feeAmount:
              p.item.feeAmount !== null ? fromCents(p.item.feeAmount) : null,
            status: p.status,
            remesaLineId: p.remesaLineId,
            error: p.error?.slice(0, 255) ?? null,
          })),
        },
      },
      select: { id: true },
    });
    return { ...(await this.loadDetail(created.id)), duplicate: false };
  }

  async list(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const files = await this.prisma.returnFile.findMany({
      where: { estateId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { items: { select: { status: true } } },
    });
    return files.map(({ items, ...f }) => ({
      ...f,
      counts: countByStatus(items),
    }));
  }

  async detail(fileId: string, user: AuthenticatedUser) {
    await this.findOwn(fileId, user);
    return this.loadDetail(fileId);
  }

  /**
   * Contabiliza las partidas emparejadas (y reintenta las que fallaron).
   * Cada partida va en su propia transacción: una que la contabilidad
   * rechace no impide aplicar las demás, y queda marcada con el motivo.
   */
  async apply(
    fileId: string,
    dto: { rechargeFee?: boolean },
    user: AuthenticatedUser,
  ) {
    const file = await this.findOwn(fileId, user);
    const settings = await this.prisma.accountingSettings.findUnique({
      where: { estateId: file.estateId },
      select: { returnFeeRecharge: true },
    });
    const rechargeFee = dto.rechargeFee ?? settings?.returnFeeRecharge ?? false;
    const pending = await this.prisma.returnFileItem.findMany({
      where: {
        fileId,
        status: { in: ['matched', 'failed'] },
        remesaLineId: { not: null },
      },
      orderBy: { seq: 'asc' },
      select: { id: true },
    });

    const summary = { applied: 0, alreadyReturned: 0, failed: 0 };
    for (const { id } of pending) {
      try {
        const outcome = await runPosting(
          this.prisma,
          (tx) => this.applyItem(tx, id, file.format, rechargeFee, user.id),
          {
            timeoutMs: 60_000,
          },
        );
        if (outcome === 'applied') summary.applied += 1;
        if (outcome === 'already_returned') summary.alreadyReturned += 1;
      } catch (error) {
        summary.failed += 1;
        const message =
          error instanceof HttpException
            ? error.message
            : 'Error inesperado al contabilizar.';
        await this.prisma.returnFileItem.update({
          where: { id },
          data: { status: 'failed', error: message.slice(0, 255) },
        });
      }
    }
    await this.prisma.returnFile.update({
      where: { id: fileId },
      data: { lastAppliedAt: new Date() },
    });
    return { ...(await this.loadDetail(fileId)), summary };
  }

  // ── Internos ────────────────────────────────────────────────────────────

  private async applyItem(
    tx: Prisma.TransactionClient,
    itemId: string,
    format: 'pain002' | 'camt054',
    rechargeFee: boolean,
    userId: string,
  ): Promise<'applied' | 'already_returned' | 'skipped'> {
    await tx.$queryRaw`SELECT 1 FROM "return_file_items" WHERE "id" = ${itemId}::uuid FOR UPDATE`;
    const item = await tx.returnFileItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    if (
      (item.status !== 'matched' && item.status !== 'failed') ||
      !item.remesaLineId
    )
      return 'skipped';
    const line = await tx.remesaLine.findUniqueOrThrow({
      where: { id: item.remesaLineId },
      select: { status: true },
    });
    if (line.status === 'Devuelto' || line.status === 'Rechazado') {
      await tx.returnFileItem.update({
        where: { id: itemId },
        data: { status: 'already_returned', error: null },
      });
      return 'already_returned';
    }
    const fee = item.feeAmount ? toCents(item.feeAmount) : 0;
    await this.collections.returnRemesaLine(tx, item.remesaLineId, {
      date: item.date ?? day(null),
      returnCode: item.returnCode,
      returnReason: item.returnReason,
      feeAmount: fee,
      rechargeFee: rechargeFee && fee > 0,
      source: format,
      userId,
    });
    await tx.returnFileItem.update({
      where: { id: itemId },
      data: { status: 'applied', appliedAt: new Date(), error: null },
    });
    return 'applied';
  }

  /**
   * Empareja cada partida con su línea de remesa:
   * 1. por EndToEndId (lo que guardamos al generar la remesa);
   * 2. si no, por la remesa original (MsgId) y el número de recibo al final
   *    del EndToEndId, o por importe si es el único de esa remesa.
   * El importe, si el fichero lo trae, tiene que coincidir con la línea.
   */
  private async plan(
    estateId: string,
    items: ParsedReturnItem[],
  ): Promise<PlannedItem[]> {
    const e2eIds = items
      .map((i) => i.endToEndId)
      .filter((v): v is string => Boolean(v));
    const byE2E = new Map<string, LineForMatch>();
    if (e2eIds.length > 0) {
      const lines = await this.prisma.remesaLine.findMany({
        where: { endToEndId: { in: e2eIds }, remesa: { estateId } },
        select: LINE_SELECT,
      });
      for (const l of lines) byE2E.set(l.endToEndId!, l);
    }
    const remesaCache = new Map<string, LineForMatch[]>();
    const linesOfRemesa = async (messageId: string) => {
      if (!remesaCache.has(messageId)) {
        remesaCache.set(
          messageId,
          await this.prisma.remesaLine.findMany({
            where: { remesa: { estateId, messageId } },
            select: LINE_SELECT,
            orderBy: { id: 'asc' },
          }),
        );
      }
      return remesaCache.get(messageId)!;
    };

    const planned: PlannedItem[] = [];
    const seen = new Set<string>();
    let seq = 0;
    const push = (
      item: ParsedReturnItem,
      line: LineForMatch | null,
      error: string | null,
    ) => {
      seq += 1;
      if (!line) {
        planned.push({
          seq,
          item,
          status: 'unmatched',
          remesaLineId: null,
          error,
        });
        return;
      }
      if (item.amount !== null && toCents(line.amount) !== item.amount) {
        planned.push({
          seq,
          item,
          status: 'unmatched',
          remesaLineId: null,
          error: `El importe del fichero (${(item.amount / 100).toFixed(2)} €) no coincide con el de la línea (${line.amount.toFixed(2)} €).`,
        });
        return;
      }
      if (line.remesa.status === 'Anulada') {
        planned.push({
          seq,
          item,
          status: 'unmatched',
          remesaLineId: null,
          error: 'La remesa de esta operación está anulada.',
        });
        return;
      }
      if (seen.has(line.id)) {
        planned.push({
          seq,
          item,
          status: 'unmatched',
          remesaLineId: null,
          error: 'La misma línea aparece dos veces en el fichero.',
        });
        return;
      }
      seen.add(line.id);
      const done = line.status === 'Devuelto' || line.status === 'Rechazado';
      planned.push({
        seq,
        item,
        status: done ? 'already_returned' : 'matched',
        remesaLineId: line.id,
        error: null,
      });
    };

    for (const item of items) {
      if (item.scope === 'group') {
        // La remesa entera rechazada: una partida por cada línea sin cobrar.
        const lines = item.originalMessageId
          ? await linesOfRemesa(item.originalMessageId)
          : [];
        const pendingLines = lines.filter((l) => l.status === 'Pendiente');
        if (pendingLines.length === 0) {
          push(
            item,
            null,
            lines.length === 0
              ? 'No se encuentra la remesa que el banco rechaza.'
              : 'La remesa rechazada no tiene líneas pendientes de cobro.',
          );
        }
        for (const line of pendingLines)
          push({ ...item, scope: 'transaction', amount: null }, line, null);
        continue;
      }
      if (item.scope === 'block') {
        push(
          item,
          null,
          'El banco rechazó un bloque entero de la remesa sin detallar las operaciones: revísalo en la remesa.',
        );
        continue;
      }
      let line = item.endToEndId ? (byE2E.get(item.endToEndId) ?? null) : null;
      if (!line && item.originalMessageId) {
        const candidates = (await linesOfRemesa(item.originalMessageId)).filter(
          (l) => l.status === 'Pendiente' || l.status === 'Cobrado',
        );
        const suffix = item.endToEndId?.startsWith(`${item.originalMessageId}-`)
          ? item.endToEndId.slice(item.originalMessageId.length + 1)
          : null;
        line =
          (suffix
            ? candidates.find((l) => l.receipt.no === suffix)
            : undefined) ?? null;
        if (!line && item.amount !== null) {
          const sameAmount = candidates.filter(
            (l) => toCents(l.amount) === item.amount,
          );
          if (sameAmount.length === 1) line = sameAmount[0];
        }
      }
      push(
        item,
        line,
        line ? null : 'No se encuentra la línea de remesa de esta operación.',
      );
    }
    return planned;
  }

  private async findOwn(fileId: string, user: AuthenticatedUser) {
    const file = await this.prisma.returnFile.findUnique({
      where: { id: fileId },
      select: { id: true, estateId: true, format: true },
    });
    if (!file)
      throw new NotFoundException('El fichero de devoluciones no existe.');
    this.estateAccess.assertAccess(file.estateId, user);
    return file;
  }

  private async loadDetail(fileId: string, db: Db = this.prisma) {
    const file = await db.returnFile.findUniqueOrThrow({
      where: { id: fileId },
      include: {
        items: {
          orderBy: { seq: 'asc' },
          include: {
            remesaLine: {
              select: {
                id: true,
                status: true,
                amount: true,
                ownerNameSnapshot: true,
                receipt: { select: { id: true, no: true } },
                property: {
                  select: {
                    ref: true,
                    staircase: true,
                    floor: true,
                    door: true,
                  },
                },
                remesa: { select: { id: true, concept: true, status: true } },
              },
            },
          },
        },
      },
    });
    return { ...file, counts: countByStatus(file.items) };
  }
}

function countByStatus(
  items: { status: ReturnFileItemStatus }[],
): Record<ReturnFileItemStatus, number> {
  const counts: Record<ReturnFileItemStatus, number> = {
    matched: 0,
    unmatched: 0,
    applied: 0,
    already_returned: 0,
    failed: 0,
  };
  for (const i of items) counts[i.status] += 1;
  return counts;
}
