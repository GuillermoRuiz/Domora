import type { ConfigService } from '@nestjs/config';
import {
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { AssistantService } from './assistant.service';
import type { CommunityFinanceService } from './community-finance.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { RagAuthorizationService } from './rag-authorization.service';
import type { StorageService } from '../files/storage.service';

const ESTATE_A = '11111111-1111-4111-8111-111111111111';
const ESTATE_B = '22222222-2222-4222-8222-222222222222';
const FOREIGN_ESTATE = '33333333-3333-4333-8333-333333333333';

const user: AuthenticatedUser = {
  id: 'user-1',
  role: 'C',
  estateIds: [ESTATE_A, ESTATE_B],
  administratorId: null,
};

function build(env: Record<string, string | undefined>) {
  const prisma = {
    estate: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const config = {
    get: (key: string) =>
      key === 'RAG_INTERNAL_KEY'
        ? 'test-only-key-not-secret'.repeat(3)
        : env[key],
  } as unknown as ConfigService;
  const finance = {
    summaryFor: jest.fn().mockResolvedValue('{"gasto_total_del_año":"1,00 €"}'),
  };
  const service = new AssistantService(
    prisma as unknown as PrismaService,
    config,
    finance as unknown as CommunityFinanceService,
    {
      estates: async (u: AuthenticatedUser) => {
        if (u.role !== 'A' && !u.estateIds.length) return [];
        return (await prisma.estate.findMany({
          where:
            u.role === 'A'
              ? { deletedAt: null }
              : { id: { in: u.estateIds }, deletedAt: null },
        })) as { id: string; name: string }[];
      },
      resolve: async (u: AuthenticatedUser, requested?: string) => {
        const estate =
          requested ?? (u.role === 'A' ? undefined : u.estateIds[0]);
        if (
          requested &&
          (u.role === 'A'
            ? !(await prisma.estate.findFirst({ where: { id: requested } }))
            : !u.estateIds.includes(requested))
        ) {
          throw new ForbiddenException();
        }
        return {
          user_id: u.id,
          tenant_id: null,
          allowed_community_ids: estate ? [estate] : [],
          allowed_property_ids: [],
          authorized_document_ids: [],
          role: u.role,
          permissions: ['rag:query'],
        };
      },
    } as unknown as RagAuthorizationService,
    {} as StorageService,
  );
  return { service, prisma, finance };
}

function mockFetch(status: number, body: unknown) {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  global.fetch = fn;
  return fn;
}

describe('AssistantService', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('envía al RAG la finca pedida, el usuario por canal y la clave interna', async () => {
    const { service } = build({
      RAG_API_URL: 'http://rag:8000/',
      RAG_INTERNAL_KEY: 'k',
    });
    const fetchMock = mockFetch(200, {
      answer: 'Sí',
      conversation_id: 'conv-1',
      citations: [{ source_id: 'S1' }],
      evidence_status: 'sufficient',
    });

    const result = await service.ask(
      { question: '¿Puedo?', channel: 'domo', estateId: ESTATE_B },
      user,
    );

    expect(result).toEqual({
      answer: 'Sí',
      conversationId: 'conv-1',
      citations: [{ source_id: 'S1' }],
      evidenceStatus: 'sufficient',
      sources: [{ source_id: 'S1' }],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://rag:8000/ask');
    const transport = JSON.parse(init.body as string) as {
      authorization: string;
      payload: string;
    };
    const token = transport.authorization;
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
    const signed = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString(),
    ) as { allowed_community_ids: string[]; method: string; path: string };
    expect(signed.allowed_community_ids).toEqual([ESTATE_B]);
    expect(signed.method).toBe('POST');
    expect(signed.path).toBe('/ask');
    expect(JSON.parse(transport.payload)).toEqual({
      question: '¿Puedo?',
      community_id: ESTATE_B,
      user_id: 'user-1:domo',
      conversation_id: null,
      community_finance: '{"gasto_total_del_año":"1,00 €"}',
    });
  });

  it('usa la primera finca del usuario si no se indica ninguna', async () => {
    const { service } = build({ RAG_API_URL: 'http://rag:8000' });
    const fetchMock = mockFetch(200, { answer: 'ok' });

    await service.ask({ question: 'hola', channel: 'intelligence' }, user);

    const body = JSON.parse(
      (
        JSON.parse(
          (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
        ) as { payload: string }
      ).payload,
    ) as { community_id: string };
    expect(body.community_id).toBe(ESTATE_A);
  });

  it('las cuentas agregadas se piden solo de la finca validada y se omiten sin finca', async () => {
    const { service, finance } = build({ RAG_API_URL: 'http://rag:8000' });
    mockFetch(200, { answer: 'ok' });

    await service.ask(
      { question: 'hola', channel: 'domo', estateId: ESTATE_B },
      user,
    );
    expect(finance.summaryFor).toHaveBeenCalledWith(ESTATE_B);

    finance.summaryFor.mockClear();
    await service.ask(
      { question: 'hola', channel: 'domo' },
      { ...user, estateIds: [] },
    );
    expect(finance.summaryFor).not.toHaveBeenCalled();
  });

  it('rechaza una finca que no es del usuario sin llamar al RAG', async () => {
    const { service } = build({ RAG_API_URL: 'http://rag:8000' });
    const fetchMock = mockFetch(200, { answer: 'nunca' });

    await expect(
      service.ask(
        { question: 'hola', channel: 'domo', estateId: FOREIGN_ESTATE },
        user,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin RAG_API_URL responde 503', async () => {
    const { service } = build({});
    await expect(
      service.ask({ question: 'hola', channel: 'domo' }, user),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('un fallo del RAG se traduce a 502 sin filtrar el detalle', async () => {
    const { service } = build({ RAG_API_URL: 'http://rag:8000' });
    mockFetch(500, { detail: 'secreto interno' });
    await expect(
      service.ask({ question: 'hola', channel: 'domo' }, user),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('lista mensajes con el usuario del canal y la comunidad validada', async () => {
    const { service } = build({ RAG_API_URL: 'http://rag:8000' });
    const fetchMock = mockFetch(200, {
      messages: [
        {
          role: 'assistant',
          content: 'Hola',
          citations: null,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    });

    const messages = await service.listMessages(
      'conv-1',
      'domo',
      user,
      ESTATE_A,
    );

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: 'Hola',
        citations: null,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]);
    const url = (fetchMock.mock.calls[0] as [string])[0];
    expect(url).toContain('/conversations/conv-1/messages?');
    expect(url).toContain('user_id=user-1%3Adomo');
    expect(url).toContain(`community_id=${ESTATE_A}`);
  });

  it('una conversación ajena (404 del RAG) se traduce a 404', async () => {
    const { service } = build({ RAG_API_URL: 'http://rag:8000' });
    mockFetch(404, { detail: 'Conversación no encontrada.' });
    await expect(
      service.listMessages('otra', 'domo', user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('rol A (superusuario)', () => {
    const admin: AuthenticatedUser = {
      id: 'admin-1',
      role: 'A',
      estateIds: [],
      administratorId: null,
    };

    it('lista todas las comunidades de la plataforma', async () => {
      const { service, prisma } = build({});
      await service.listEstates(admin);
      expect(prisma.estate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null } }),
      );
    });

    it('puede preguntar por cualquier comunidad existente', async () => {
      const { service, prisma } = build({ RAG_API_URL: 'http://rag:8000' });
      prisma.estate.findFirst.mockResolvedValue({ id: FOREIGN_ESTATE });
      const fetchMock = mockFetch(200, { answer: 'ok' });

      await service.ask(
        { question: 'hola', channel: 'domo', estateId: FOREIGN_ESTATE },
        admin,
      );

      const body = JSON.parse(
        (
          JSON.parse(
            (fetchMock.mock.calls[0] as [string, RequestInit])[1]
              .body as string,
          ) as { payload: string }
        ).payload,
      ) as { community_id: string };
      expect(body.community_id).toBe(FOREIGN_ESTATE);
    });

    it('sin comunidad solo consulta documentos globales', async () => {
      const { service } = build({ RAG_API_URL: 'http://rag:8000' });
      const fetchMock = mockFetch(200, { answer: 'ok' });

      await service.ask({ question: 'hola', channel: 'domo' }, admin);

      const body = JSON.parse(
        (
          JSON.parse(
            (fetchMock.mock.calls[0] as [string, RequestInit])[1]
              .body as string,
          ) as { payload: string }
        ).payload,
      ) as { community_id?: string };
      expect(body.community_id).toBeUndefined();
    });

    it('una comunidad inexistente se rechaza sin llamar al RAG', async () => {
      const { service } = build({ RAG_API_URL: 'http://rag:8000' });
      const fetchMock = mockFetch(200, { answer: 'nunca' });
      await expect(
        service.ask(
          { question: 'hola', channel: 'domo', estateId: FOREIGN_ESTATE },
          admin,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('listEstates solo consulta las fincas del usuario', async () => {
    const { service, prisma } = build({});
    await service.listEstates(user);
    expect(prisma.estate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: user.estateIds }, deletedAt: null },
      }),
    );
    expect(await service.listEstates({ ...user, estateIds: [] })).toEqual([]);
  });
});
