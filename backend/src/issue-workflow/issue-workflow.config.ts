import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_STALLED_GRACE_MS,
  DEFAULT_VISIT_GRACE_MS,
} from './issue-situation';

const minutes = (raw: string | undefined, fallbackMs: number): number => {
  const value = Number(raw ?? '');
  return raw !== undefined &&
    raw.trim() !== '' &&
    Number.isFinite(value) &&
    value >= 0
    ? value * 60_000
    : fallbackMs;
};

/**
 * Márgenes del workflow, configurables por entorno. Son los que garantizan que ninguna incidencia queda
 * abierta sin siguiente paso.
 */
@Injectable()
export class IssueWorkflowConfig {
  constructor(@Optional() private readonly config?: ConfigService) {}

  /** Minutos sin ninguna actuación prevista tras los que una incidencia abierta se considera estancada. */
  get stalledGraceMs(): number {
    return minutes(
      this.config?.get<string>('ISSUE_STALLED_GRACE_MINUTES'),
      DEFAULT_STALLED_GRACE_MS,
    );
  }

  /** Minutos tras la hora de una visita planificada a partir de los cuales se pide a una persona confirmar su resultado. */
  get visitGraceMs(): number {
    return minutes(
      this.config?.get<string>('ISSUE_VISIT_GRACE_MINUTES'),
      DEFAULT_VISIT_GRACE_MS,
    );
  }

  /** El barrido periódico está activo salvo `ISSUE_SWEEP_ENABLED=false`. */
  get sweepEnabled(): boolean {
    return this.config?.get<string>('ISSUE_SWEEP_ENABLED') !== 'false';
  }
}
