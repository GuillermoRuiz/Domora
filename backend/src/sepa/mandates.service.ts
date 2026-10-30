import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { Mandate, MandateSeq } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { isDemoMode } from '../config/demo-mode';
import { CryptoService } from './crypto.service';
import { AuditService } from '../gdpr/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const THIRTY_SIX_MONTHS = 36;
const DAY_MS = 24 * 60 * 60 * 1000;

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth())
  );
}

@Injectable()
export class MandatesService implements OnModuleInit {
  private readonly logger = new Logger(MandatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly cryptoService: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Job diario de ciclo de vida (Apéndice F / Rulebook §4.6). Sin
   * dependencia de @nestjs/schedule: un timer propio con unref() para no
   * bloquear el shutdown. Además, el cálculo de candidatos de remesa
   * ejecuta el mismo refresh de forma síncrona antes de decidir — el
   * timer es solo el barrido de fondo.
   */
  onModuleInit(): void {
    // DEMO_MODE: sin timers de fondo (el entorno demo no ejecuta jobs). Se lee
    // process.env directo porque este servicio no inyecta ConfigService.
    if (isDemoMode()) return;
    const timer = setInterval(() => {
      this.refreshAllMandateLifecycles().catch((error: unknown) =>
        this.logger.error(
          'Fallo en el refresh periódico de mandatos',
          error as Error,
        ),
      );
    }, DAY_MS);
    timer.unref();
  }

  /**
   * Regla de 36 meses (Apéndice F): firmado y nunca usado ≥36 meses →
   * `expired` (necesita nueva firma); usado pero sin cargo ≥36 meses →
   * `dormant`. Solo toca mandatos `active`.
   */
  applyLifecycleRule(
    mandate: Pick<Mandate, 'status' | 'signedAt' | 'firstUseAt' | 'lastUseAt'>,
    today: Date = new Date(),
  ): 'active' | 'dormant' | 'expired' {
    if (mandate.status !== 'active') return mandate.status as never;
    if (
      !mandate.firstUseAt &&
      monthsBetween(mandate.signedAt, today) >= THIRTY_SIX_MONTHS
    ) {
      return 'expired';
    }
    if (
      mandate.lastUseAt &&
      monthsBetween(mandate.lastUseAt, today) >= THIRTY_SIX_MONTHS
    ) {
      return 'dormant';
    }
    return 'active';
  }

  async refreshLifecycleForEstate(estateId: string): Promise<number> {
    const mandates = await this.prisma.mandate.findMany({
      where: { creditorEstateId: estateId, status: 'active' },
    });
    let changed = 0;
    for (const mandate of mandates) {
      const next = this.applyLifecycleRule(mandate);
      if (next !== 'active') {
        await this.prisma.mandate.update({
          where: { id: mandate.id },
          data: { status: next },
        });
        changed += 1;
      }
    }
    return changed;
  }

  async refreshAllMandateLifecycles(): Promise<void> {
    const mandates = await this.prisma.mandate.findMany({
      where: { status: 'active' },
    });
    for (const mandate of mandates) {
      const next = this.applyLifecycleRule(mandate);
      if (next !== 'active') {
        await this.prisma.mandate.update({
          where: { id: mandate.id },
          data: { status: next },
        });
      }
    }
  }

  /**
   * Secuencia SEPA del próximo cargo: solo mandatos `active` cobran;
   * oneOff → OOFF; primer uso pendiente → FRST; resto → RCUR. FNAL nunca
   * se autocalcula — lo marca el gestor al preparar la remesa.
   */
  computeSeq(
    mandate: Pick<Mandate, 'status' | 'paymentType' | 'firstUseAt'>,
  ): MandateSeq | null {
    if (mandate.status !== 'active') return null;
    if (mandate.paymentType === 'oneOff') return 'OOFF';
    return mandate.firstUseAt ? 'RCUR' : 'FRST';
  }

  async listByProperty(
    propertyId: string,
    user: AuthenticatedUser,
    onlyActive = true,
  ) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, deletedAt: null },
      select: { estateId: true },
    });
    if (!property) {
      throw new NotFoundException(`Propiedad ${propertyId} no encontrada.`);
    }
    this.estateAccess.assertAccess(property.estateId, user);
    const mandates = await this.prisma.mandate.findMany({
      where: { propertyId, ...(onlyActive ? { status: 'active' } : {}) },
      orderBy: { signedAt: 'desc' },
    });
    // Acceso a datos bancarios — queda en el registro de auditoría (RGPD art. 32).
    await this.audit.logAccess(user, 'mandates', 'list', propertyId);
    // El IBAN nunca sale en claro por la API de listado — solo enmascarado.
    return mandates.map((m) => ({
      ...m,
      debtorIban: this.cryptoService.maskIban(
        this.cryptoService.decrypt(m.debtorIban),
      ),
    }));
  }
}
