import { XMLParser } from 'fast-xml-parser';

/**
 * Lectura de los ficheros de devoluciones que envía el banco:
 *
 * - **pain.002** (CstmrPmtStsRpt): el banco informa del estado de la remesa
 *   que le enviamos. Nos interesan las operaciones rechazadas (TxSts=RJCT),
 *   normalmente antes del cargo, y el rechazo de la remesa entera.
 * - **camt.054** (BkToCstmrDbtCdtNtfctn): aviso de adeudo en cuenta. Las
 *   devoluciones son los detalles con información de devolución (RtrInf):
 *   el dinero ya había entrado y sale de nuevo.
 *
 * Función pura sobre el XML: se prueba con ficheros de muestra sin base de
 * datos. Mismas decisiones de parseo que la respuesta de VeriFactu: todo es
 * texto (un importe "100.10" no debe pasar por coma flotante) y se navega por
 * nombre local, sin prefijos de namespace. Las entidades XML no se procesan.
 */

export type ReturnFileFormat = 'pain002' | 'camt054';

export interface ParsedReturnItem {
  /**
   * `transaction`: una operación concreta. `group`: el banco rechazó la
   * remesa entera (todas sus líneas pendientes). `block`: rechazó un bloque
   * de pago entero sin detallar operaciones.
   */
  scope: 'transaction' | 'group' | 'block';
  endToEndId: string | null;
  /** MsgId de la remesa original, si el fichero lo cita. */
  originalMessageId: string | null;
  /** Importe en céntimos. */
  amount: number | null;
  /** AAAA-MM-DD. */
  date: string | null;
  returnCode: string | null;
  /** Comisión en céntimos, si el banco la detalla. */
  feeAmount: number | null;
}

export interface ParsedReturnFile {
  format: ReturnFileFormat;
  /** MsgId del propio fichero. */
  messageId: string | null;
  items: ParsedReturnItem[];
  /** Operaciones que el fichero trae pero no son devoluciones (aceptadas, abonos…). */
  ignored: number;
}

export class ReturnFileParseError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: false,
});

type Node = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function node(value: unknown): Node | undefined {
  return value && typeof value === 'object' ? (value as Node) : undefined;
}

/** Sigue una ruta de elementos; si alguno falta, `undefined`. */
function at(root: unknown, ...path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    const n = node(Array.isArray(current) ? current[0] : current);
    if (!n) return undefined;
    current = n[key];
  }
  return Array.isArray(current) ? current[0] : current;
}

function text(root: unknown, ...path: string[]): string | null {
  const value = at(root, ...path);
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/** '100.1' o '100.10' → 10010 céntimos, sin coma flotante. */
export function amountToCents(value: string | null): number | null {
  if (!value) return null;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1] : null;
}

/** Los bancos ponen "NOTPROVIDED" cuando no hay EndToEndId. */
function endToEnd(value: string | null): string | null {
  if (!value || value.toUpperCase() === 'NOTPROVIDED') return null;
  return value.slice(0, 35);
}

/** Código de motivo: `Rsn/Cd`, o `Rsn/Prtry` si el banco usa uno propio. */
function reasonCode(reasonInfo: unknown): string | null {
  for (const info of asArray(reasonInfo)) {
    const code = text(info, 'Rsn', 'Cd') ?? text(info, 'Rsn', 'Prtry');
    if (code) return code.slice(0, 10);
  }
  return null;
}

export function parseReturnFile(xml: string): ParsedReturnFile {
  let doc: Node;
  try {
    // Un BOM al principio (U+FEFF) no es parte del XML.
    const body = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
    doc = parser.parse(body) as Node;
  } catch {
    throw new ReturnFileParseError('El fichero no es un XML válido.');
  }
  const root = node(doc.Document);
  if (!root) {
    throw new ReturnFileParseError(
      'El fichero no es un mensaje ISO 20022 (falta el elemento Document).',
    );
  }
  if ('CstmrPmtStsRpt' in root)
    return parsePain002(node(at(root, 'CstmrPmtStsRpt')) ?? {});
  if ('BkToCstmrDbtCdtNtfctn' in root)
    return parseCamt054(node(at(root, 'BkToCstmrDbtCdtNtfctn')) ?? {});
  if ('BkToCstmrStmt' in root) {
    throw new ReturnFileParseError(
      'Es un extracto de cuenta (camt.053). Sube el aviso de devoluciones (camt.054) o el informe de estado de la remesa (pain.002).',
    );
  }
  throw new ReturnFileParseError(
    'Formato no reconocido: se admiten el informe de estado de la remesa (pain.002) y el aviso de devoluciones (camt.054).',
  );
}

function parsePain002(report: Node): ParsedReturnFile {
  const messageId = text(report, 'GrpHdr', 'MsgId');
  const created = isoDate(text(report, 'GrpHdr', 'CreDtTm'));
  const group = at(report, 'OrgnlGrpInfAndSts');
  const originalMessageId = text(group, 'OrgnlMsgId');
  const groupStatus = text(group, 'GrpSts');
  const groupReason = reasonCode(node(group)?.StsRsnInf);

  const items: ParsedReturnItem[] = [];
  let ignored = 0;
  const blocks = asArray(report.OrgnlPmtInfAndSts);

  for (const block of blocks) {
    const txs = asArray(node(block)?.TxInfAndSts);
    const blockStatus = text(block, 'PmtInfSts');
    const blockReason = reasonCode(node(block)?.StsRsnInf);
    if (txs.length === 0) {
      if (blockStatus === 'RJCT') {
        items.push({
          scope: 'block',
          endToEndId: null,
          originalMessageId,
          amount: null,
          date: created,
          returnCode: blockReason ?? groupReason,
          feeAmount: null,
        });
      }
      continue;
    }
    for (const tx of txs) {
      if (text(tx, 'TxSts') !== 'RJCT') {
        ignored += 1;
        continue;
      }
      items.push({
        scope: 'transaction',
        endToEndId: endToEnd(text(tx, 'OrgnlEndToEndId')),
        originalMessageId,
        amount: amountToCents(text(tx, 'OrgnlTxRef', 'Amt', 'InstdAmt')),
        date: isoDate(text(tx, 'OrgnlTxRef', 'ReqdColltnDt')) ?? created,
        returnCode:
          reasonCode(node(tx)?.StsRsnInf) ?? blockReason ?? groupReason,
        feeAmount: null,
      });
    }
  }

  // Rechazo de la remesa entera sin detalle por operación.
  if (blocks.length === 0 && groupStatus === 'RJCT') {
    items.push({
      scope: 'group',
      endToEndId: null,
      originalMessageId,
      amount: null,
      date: created,
      returnCode: groupReason,
      feeAmount: null,
    });
  }
  return { format: 'pain002', messageId, items, ignored };
}

function chargesOf(tx: unknown): number | null {
  const charges = node(tx)?.Chrgs;
  if (!charges) return null;
  // camt.054.001.04 y posteriores: total o registros; .001.02: lista de cargos.
  const total = amountToCents(text(charges, 'TtlChrgsAndTaxAmt'));
  if (total !== null) return total;
  const records = [
    ...asArray(node(charges)?.Rcrd),
    ...asArray(charges as unknown),
  ];
  const sum = records
    .map((r) => amountToCents(text(r, 'Amt')))
    .filter((v): v is number => v !== null)
    .reduce((s, v) => s + v, 0);
  return sum > 0 ? sum : null;
}

function parseCamt054(notification: Node): ParsedReturnFile {
  const messageId = text(notification, 'GrpHdr', 'MsgId');
  const items: ParsedReturnItem[] = [];
  let ignored = 0;

  for (const ntfctn of asArray(notification.Ntfctn)) {
    for (const entry of asArray(node(ntfctn)?.Ntry)) {
      const booked =
        isoDate(
          text(entry, 'BookgDt', 'Dt') ?? text(entry, 'BookgDt', 'DtTm'),
        ) ?? isoDate(text(entry, 'ValDt', 'Dt'));
      const details = asArray(node(entry)?.NtryDtls).flatMap((d) =>
        asArray(node(d)?.TxDtls),
      );
      for (const tx of details) {
        const returnInfo = node(tx)?.RtrInf;
        if (!returnInfo) {
          ignored += 1;
          continue;
        }
        const amount =
          amountToCents(text(tx, 'Amt')) ??
          amountToCents(text(tx, 'AmtDtls', 'TxAmt', 'Amt')) ??
          amountToCents(text(tx, 'AmtDtls', 'InstdAmt', 'Amt')) ??
          (details.length === 1 ? amountToCents(text(entry, 'Amt')) : null);
        items.push({
          scope: 'transaction',
          endToEndId: endToEnd(text(tx, 'Refs', 'EndToEndId')),
          originalMessageId: null,
          amount,
          date: booked,
          returnCode: reasonCode(returnInfo),
          feeAmount: chargesOf(tx),
        });
      }
    }
  }
  return { format: 'camt054', messageId, items, ignored };
}
