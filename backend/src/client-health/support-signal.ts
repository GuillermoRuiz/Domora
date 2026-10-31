import { Injectable } from '@nestjs/common';

/**
 * Serious open support tickets per despacho, for salud and «Requieren
 * atención». The Soporte e incidencias module does not exist yet (S16), so
 * the bound implementation reports the signal as unavailable (null): it never
 * subtracts and never raises «Incidencias graves sin resolver». When support
 * exists, bind a source that counts the despacho's open Crítica/Alta tickets
 * in one batched query.
 */
export interface SupportSignalSource {
  /** Count per despacho id (absent = 0), or null when support is not available. */
  seriousOpenTickets(
    administratorIds: string[],
  ): Promise<Map<string, number> | null>;
}

export const SUPPORT_SIGNAL_SOURCE = Symbol('SUPPORT_SIGNAL_SOURCE');

@Injectable()
export class UnavailableSupportSignalSource implements SupportSignalSource {
  seriousOpenTickets(): Promise<Map<string, number> | null> {
    return Promise.resolve(null);
  }
}
