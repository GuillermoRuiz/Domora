/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { ConfigService } from '@nestjs/config';
import { AiConfigService } from './ai-config.service';
import {
  AiWorkerHeartbeatService,
  coverageServes,
} from './ai-worker-heartbeat.service';

const NOW = new Date('2026-10-23T10:00:00.000Z');
const seconds = (s: number) => new Date(NOW.getTime() + s * 1000);

function build(env: Record<string, string> = {}, rows: any[] = []) {
  const config = new AiConfigService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);
  const prisma: any = {
    aiWorkerHeartbeat: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue(rows),
    },
  };
  return {
    service: new AiWorkerHeartbeatService(prisma, config),
    prisma,
    config,
  };
}

describe('configuración del latido', () => {
  it('por defecto: latido cada 30 s y worker no disponible tras 150 s', () => {
    const { config } = build();
    expect(config.workerHeartbeatIntervalMs).toBe(30_000);
    expect(config.workerHeartbeatStaleMs).toBe(150_000);
  });
  it('es configurable y el margen nunca baja de dos intervalos', () => {
    const { config } = build({
      AI_WORKER_HEARTBEAT_SECONDS: '10',
      AI_WORKER_HEARTBEAT_STALE_SECONDS: '90',
    });
    expect(config.workerHeartbeatIntervalMs).toBe(10_000);
    expect(config.workerHeartbeatStaleMs).toBe(90_000);
    const tight = build({
      AI_WORKER_HEARTBEAT_SECONDS: '60',
      AI_WORKER_HEARTBEAT_STALE_SECONDS: '30',
    }).config;
    expect(tight.workerHeartbeatStaleMs).toBe(120_000);
  });
  it('un valor inválido vuelve al de por defecto', () => {
    const { config } = build({
      AI_WORKER_HEARTBEAT_SECONDS: 'abc',
      AI_WORKER_HEARTBEAT_STALE_SECONDS: '-5',
    });
    expect(config.workerHeartbeatIntervalMs).toBe(30_000);
    expect(config.workerHeartbeatStaleMs).toBe(150_000);
  });
});

describe('AiWorkerHeartbeatService.beat', () => {
  it('escribe el latido con los tipos que atiende este worker, como mucho una vez por intervalo', async () => {
    const { service, prisma } = build({ AI_WORKER_KINDS: 'incident, send' });
    await service.beat(NOW);
    await service.beat(seconds(10)); // dentro del intervalo: no escribe
    await service.beat(seconds(31));
    expect(prisma.aiWorkerHeartbeat.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.aiWorkerHeartbeat.upsert.mock.calls[0][0]).toMatchObject({
      where: { instanceId: service.instanceId },
      update: { kinds: ['incident', 'send'], beatAt: NOW },
    });
  });
  it('sin AI_WORKER_KINDS atiende todos (lista vacía)', async () => {
    const { service, prisma } = build();
    await service.beat(NOW);
    expect(
      prisma.aiWorkerHeartbeat.upsert.mock.calls[0][0].update.kinds,
    ).toEqual([]);
  });
  it('un fallo de la base de datos no rompe al worker y se reintenta en el siguiente tick', async () => {
    const { service, prisma } = build();
    prisma.aiWorkerHeartbeat.upsert.mockRejectedValueOnce(new Error('db'));
    await expect(service.beat(NOW)).resolves.toBeUndefined();
    await service.beat(seconds(1));
    expect(prisma.aiWorkerHeartbeat.upsert).toHaveBeenCalledTimes(2);
  });
  it('olvida los latidos de workers desaparecidos hace más de un día', async () => {
    const { service, prisma } = build();
    await service.beat(NOW);
    expect(prisma.aiWorkerHeartbeat.deleteMany).toHaveBeenCalledWith({
      where: { beatAt: { lt: new Date(NOW.getTime() - 24 * 3_600_000) } },
    });
  });
  it('una parada ordenada retira su latido', async () => {
    const { service, prisma } = build();
    await service.onModuleDestroy();
    expect(prisma.aiWorkerHeartbeat.deleteMany).toHaveBeenCalledWith({
      where: { instanceId: service.instanceId },
    });
  });
});

describe('AiWorkerHeartbeatService.coverage', () => {
  it('solo mira latidos recientes', async () => {
    const { service, prisma } = build();
    await service.coverage(NOW);
    expect(prisma.aiWorkerHeartbeat.findMany.mock.calls[0][0].where).toEqual({
      beatAt: { gte: new Date(NOW.getTime() - 150_000) },
    });
  });
  it('un worker sin lista de tipos cubre todo; si solo hay workers por tipo, solo esos tipos', async () => {
    const all = await build({}, [{ kinds: [] }]).service.coverage(NOW);
    expect(coverageServes(all, 'incident')).toBe(true);
    const some = await build({}, [
      { kinds: ['send'] },
      { kinds: ['reply', 'send'] },
    ]).service.coverage(NOW);
    expect(coverageServes(some, 'send')).toBe(true);
    expect(coverageServes(some, 'reply')).toBe(true);
    expect(coverageServes(some, 'incident')).toBe(false);
  });
  it('ningún worker con latido reciente: no cubre nada', async () => {
    const none = await build({}, []).service.coverage(NOW);
    expect(coverageServes(none, 'incident')).toBe(false);
  });
});
