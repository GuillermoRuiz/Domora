import { createHash } from 'node:crypto';
export interface MatchRecord {
  id: string;
  estateId: string;
  bankAccountId: string;
  cents: number;
  date: string;
  concept: string;
  reference?: string | null;
  supplierName?: string;
  invoiceIds?: string[];
}
export interface Candidate {
  key: string;
  entryIds: string[];
  lineIds: string[];
  invoiceIds: string[];
  tier: 'high' | 'medium';
  score: number;
  evidence: {
    amountExact: boolean;
    exactReference: boolean;
    supplierName: boolean;
    maxDateDays: number;
    groupSize: number;
    competingCandidates: number;
    weights: Record<string, number>;
  };
}
export const normalizeName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/(SOCIEDADLIMITADA|SLU|SAU|SL|SA)$/, '');
const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
function groups<T>(items: readonly T[], max = 3): T[][] {
  const result: T[][] = [];
  function visit(start: number, picked: T[]) {
    if (picked.length) result.push(picked);
    if (picked.length === max) return;
    for (let i = start; i < items.length; i++)
      visit(i + 1, [...picked, items[i]]);
  }
  visit(0, []);
  return result;
}
/** Scores are evidence weights, not empirical probabilities. Amount=50, unique reference=30, supplier=10, date<=10d=10. */
export function reconcile(
  entries: readonly MatchRecord[],
  lines: readonly MatchRecord[],
): Candidate[] {
  const all = [...entries, ...lines];
  if (!all.length) return [];
  const tenant = all[0];
  if (
    all.some(
      (x) =>
        x.estateId !== tenant.estateId ||
        x.bankAccountId !== tenant.bankAccountId,
    )
  )
    throw new Error('RECONCILIATION_SCOPE');
  if (
    new Set(entries.map((x) => x.id)).size !== entries.length ||
    new Set(lines.map((x) => x.id)).size !== lines.length
  )
    throw new Error('REPEATED_ID');
  if (
    all.some(
      (x) =>
        !Number.isSafeInteger(x.cents) || !/^\d{4}-\d{2}-\d{2}$/.test(x.date),
    )
  )
    throw new Error('INVALID_MONEY_OR_DATE');
  // A bounded window avoids an unbounded subset-sum search. Callers partition larger histories by bank/date.
  if (entries.length > 30 || lines.length > 30)
    throw new Error('RECONCILIATION_WINDOW_TOO_LARGE');
  const candidates: Candidate[] = [];
  const lineGroups = groups(lines).filter((g) =>
    g.every((x) => Math.sign(x.cents) === Math.sign(g[0].cents)),
  );
  const sums = new Map<number, MatchRecord[][]>();
  for (const g of lineGroups) {
    const sum = g.reduce((a, b) => a + b.cents, 0);
    if (sum !== 0) sums.set(sum, [...(sums.get(sum) ?? []), g]);
  }
  for (const e of groups(entries)) {
    if (!e.every((x) => Math.sign(x.cents) === Math.sign(e[0].cents))) continue;
    for (const l of sums.get(e.reduce((a, b) => a + b.cents, 0)) ?? []) {
      const days = Math.max(
        ...e.flatMap((a) =>
          l.map(
            (b) => Math.abs(Date.parse(a.date) - Date.parse(b.date)) / 86400000,
          ),
        ),
      );
      if (!Number.isFinite(days) || days > 30) continue;
      const text = e
        .map((x) => `${x.reference ?? ''} ${x.concept}`)
        .join(' ')
        .toUpperCase();
      const refs = l
        .map((x) => compact(x.reference ?? ''))
        .filter((x) => x.length >= 4);
      const reference =
        refs.length === l.length &&
        refs.every((r) =>
          new RegExp(
            `(?:^|[^A-Z0-9])${[...r].join('[^A-Z0-9]*')}(?:$|[^A-Z0-9])`,
          ).test(text),
        );
      const supplier = l.every((x) => {
        const n = normalizeName(x.supplierName ?? '');
        return (
          n.length >= 6 &&
          normalizeName(e.map((b) => b.concept).join(' ')).includes(n)
        );
      });
      const score =
        50 + (reference ? 30 : 0) + (supplier ? 10 : 0) + (days <= 10 ? 10 : 0);
      const entryIds = e.map((x) => x.id).sort(),
        lineIds = l.map((x) => x.id).sort();
      candidates.push({
        key: createHash('sha256')
          .update(
            JSON.stringify([
              tenant.estateId,
              tenant.bankAccountId,
              entryIds,
              lineIds,
            ]),
          )
          .digest('hex'),
        entryIds,
        lineIds,
        invoiceIds: [...new Set(l.flatMap((x) => x.invoiceIds ?? []))],
        tier: 'medium',
        score,
        evidence: {
          amountExact: true,
          exactReference: reference,
          supplierName: supplier,
          maxDateDays: days,
          groupSize: e.length + l.length,
          competingCandidates: 0,
          weights: { amount: 50, reference: 30, supplier: 10, date: 10 },
        },
      });
    }
  }
  for (const c of candidates) {
    const competitors = candidates.filter(
      (x) =>
        x.key !== c.key &&
        (x.entryIds.some((id) => c.entryIds.includes(id)) ||
          x.lineIds.some((id) => c.lineIds.includes(id))),
    ).length;
    c.evidence.competingCandidates = competitors;
    // Split/multiple matches always need review even if exact. Competing records never auto-reconcile.
    if (
      c.entryIds.length === 1 &&
      c.lineIds.length === 1 &&
      c.score >= 90 &&
      c.evidence.exactReference &&
      competitors === 0
    )
      c.tier = 'high';
  }
  return candidates.sort(
    (a, b) => b.score - a.score || a.key.localeCompare(b.key),
  );
}
