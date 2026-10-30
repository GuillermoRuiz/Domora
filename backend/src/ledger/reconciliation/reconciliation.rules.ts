import type { Cents } from '../money';

/** Partida del extracto o línea del diario, reducida a lo que importa para emparejar. */
export interface MatchItem {
  id: string;
  date: Date;
  /** Positivo si entra dinero en la cuenta; negativo si sale. */
  amount: Cents;
}

export interface MatchPair {
  entryId: string;
  lineId: string;
}

const DAY = 86_400_000;

/**
 * Emparejamiento automático 1:1: mismo importe exacto y fechas a menos de
 * `maxDays` días (el banco suele apuntar uno o dos días después). Entre
 * varias candidatas gana la de fecha más cercana y, a igualdad, la más
 * antigua. Lo dudoso no se empareja: si dos partidas del extracto compiten
 * por la misma línea, se queda la que esté más cerca en fecha.
 */
export function autoMatch(
  extract: readonly MatchItem[],
  ledger: readonly MatchItem[],
  maxDays = 10,
): MatchPair[] {
  const candidates: { entry: MatchItem; line: MatchItem; distance: number }[] =
    [];
  for (const entry of extract) {
    for (const line of ledger) {
      if (line.amount !== entry.amount) continue;
      const distance =
        Math.abs(line.date.getTime() - entry.date.getTime()) / DAY;
      if (distance <= maxDays) candidates.push({ entry, line, distance });
    }
  }
  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      a.entry.date.getTime() - b.entry.date.getTime() ||
      a.line.date.getTime() - b.line.date.getTime() ||
      a.entry.id.localeCompare(b.entry.id) ||
      a.line.id.localeCompare(b.line.id),
  );
  const usedEntries = new Set<string>();
  const usedLines = new Set<string>();
  const pairs: MatchPair[] = [];
  for (const c of candidates) {
    if (usedEntries.has(c.entry.id) || usedLines.has(c.line.id)) continue;
    usedEntries.add(c.entry.id);
    usedLines.add(c.line.id);
    pairs.push({ entryId: c.entry.id, lineId: c.line.id });
  }
  return pairs;
}
