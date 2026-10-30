import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient, Prisma } from './client';
import { createPgAdapter } from './create-prisma-client';

/**
 * Umbral por defecto (ms) por encima del cual una consulta se considera lenta
 * y se registra. Se puede ajustar con SLOW_QUERY_MS.
 */
const DEFAULT_SLOW_QUERY_MS = 300;

/**
 * Thin wrapper around PrismaClient so it can be injected anywhere via Nest's
 * DI container, and so connection lifecycle is tied to the module lifecycle.
 *
 * Además registra las consultas lentas. La auditoría de rendimiento
 * (doc/auditoria-seguridad-rendimiento.md §M4) dejó a propósito sin resolver
 * qué índices faltan: con los datos de desarrollo cualquier medición es
 * ruido —Postgres elige seq scan en tablas diminutas haga lo que haga— y
 * añadir índices a ciegas cuesta en cada escritura. Esto es lo que permite
 * decidirlo con evidencia real cuando haya volumen.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly slowQueryMs: number;

  constructor() {
    super({
      adapter: createPgAdapter(),
      log: [{ emit: 'event', level: 'query' }],
    });
    const configured = Number(process.env.SLOW_QUERY_MS);
    this.slowQueryMs =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_SLOW_QUERY_MS;
  }

  async onModuleInit(): Promise<void> {
    // El tipado de $on con eventos depende del `log` pasado al constructor y
    // no se estrecha bien desde una subclase; el cast mantiene el manejador
    // tipado sin relajar nada más.
    (
      this as unknown as {
        $on(event: 'query', cb: (e: Prisma.QueryEvent) => void): void;
      }
    ).$on('query', (event) => {
      if (event.duration >= this.slowQueryMs) {
        this.logger.warn(
          `Consulta lenta (${event.duration}ms): ${event.query}`,
        );
      }
    });

    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
