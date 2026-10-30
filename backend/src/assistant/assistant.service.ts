import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  RagAuthorizationService,
  type AuthorizationContext,
} from './rag-authorization.service';
import { ragAclFor } from '../documents/rag-acl';
import { StorageService } from '../files/storage.service';
import { basename } from 'node:path';
import { CommunityFinanceService } from './community-finance.service';
import type {
  AskAssistantDto,
  AssistantChannel,
} from './dto/ask-assistant.dto';

const RAG_TIMEOUT_MS = 60_000;

export interface AssistantCitation {
  source_id?: string;
  title?: string;
  pages?: number[];
  [key: string]: unknown;
}

export interface AssistantAnswer {
  answer: string;
  conversationId: string | null;
  citations: AssistantCitation[];
  sources: AssistantCitation[];
  evidenceStatus: string;
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  citations: AssistantCitation[] | null;
  createdAt: string;
}

interface RagAskResponse {
  answer: string;
  conversation_id?: string;
  citations?: AssistantCitation[];
  sources?: AssistantCitation[];
  evidence_status?: string;
}

interface RagMessagesResponse {
  messages: {
    role: 'user' | 'assistant';
    content: string;
    citations?: AssistantCitation[] | null;
    created_at: string;
  }[];
}

/**
 * Puente entre la app y el servicio RAG (carpeta `rag/`). Es el único sitio
 * que habla con el RAG: el navegador nunca recibe su URL ni su clave, y el
 * `community_id` que se envía al RAG sale SIEMPRE de las fincas del JWT —
 * nunca de lo que el cliente afirme — para que un usuario no pueda leer los
 * documentos de otra comunidad.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly finance: CommunityFinanceService,
    private readonly authorization: RagAuthorizationService,
    private readonly storage: StorageService,
  ) {}

  async listEstates(user: AuthenticatedUser) {
    return (await this.authorization.estates(user)).map(({ id, name }) => ({
      id,
      name,
    }));
  }

  async ask(
    dto: AskAssistantDto,
    user: AuthenticatedUser,
  ): Promise<AssistantAnswer> {
    const context = await this.authorization.resolve(user, dto.estateId);
    const estateId = context.allowed_community_ids[0];
    // Cuentas agregadas de la comunidad (sin datos de vecinos): solo de la finca ya validada.
    const communityFinance = estateId
      ? await this.finance.summaryFor(estateId)
      : null;
    const data = await this.callRag<RagAskResponse>(
      '/ask',
      {
        method: 'POST',
        body: JSON.stringify({
          question: dto.question,
          community_id: estateId,
          user_id: this.ragUserId(user, dto.channel),
          conversation_id: dto.conversationId ?? null,
          community_finance: communityFinance,
        }),
      },
      context,
      dto.channel,
    );
    return {
      answer: data.answer,
      conversationId: data.conversation_id ?? null,
      citations: data.citations ?? [],
      sources: data.sources ?? data.citations ?? [],
      evidenceStatus: data.evidence_status ?? 'unknown',
    };
  }

  async listMessages(
    conversationId: string,
    channel: AssistantChannel,
    user: AuthenticatedUser,
    estateIdParam?: string,
  ): Promise<AssistantMessage[]> {
    const context = await this.authorization.resolve(user, estateIdParam);
    const estateId = context.allowed_community_ids[0];
    const params = new URLSearchParams({
      user_id: this.ragUserId(user, channel),
    });
    if (estateId) params.set('community_id', estateId);
    const data = await this.callRag<RagMessagesResponse>(
      `/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`,
      { method: 'GET' },
      context,
      channel,
    );
    return data.messages.map((m) => ({
      role: m.role,
      content: m.content,
      citations: m.citations ?? null,
      createdAt: m.created_at,
    }));
  }

  /** Cada usuario+superficie tiene su propio historial en el RAG. */
  private ragUserId(user: AuthenticatedUser, channel: AssistantChannel) {
    return `${user.id}:${channel}`;
  }

  /** Explicit bridge for existing uploads. Other document formats/downloads remain unchanged. */
  async indexDocument(id: string, user: AuthenticatedUser, reprocess = false) {
    const document = await this.prisma.document.findUnique({ where: { id } });
    if (!document?.estateId || !document.s3Key || document.deletedAt)
      throw new NotFoundException('Documento no encontrado.');
    const context = await this.authorization.resolve(
      user,
      document.estateId,
      true,
    );
    this.storage.assertDocumentKey(document.s3Key, document.estateId);
    const content = await this.storage.get(document.s3Key);
    if (content.length > StorageService.MAX_SIZE_BYTES) {
      throw new BadRequestException('El fichero supera el tamaño máximo de 10 MB.');
    }
    if (!content.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new BadRequestException('El RAG solo acepta ficheros PDF.');
    }
    return this.callRag(
      '/documents',
      {
        method: 'POST',
        body: JSON.stringify({
          document_id: document.id,
          source_document_id: document.id,
          filename: basename(document.s3Key),
          title: document.title,
          doc_type: document.type,
          mime_type: 'application/pdf',
          // Never wider than the library: «Solo gestora» or «Junta» documents stay staff-only.
          ...ragAclFor(document),
          content_base64: content.toString('base64'),
          reprocess,
        }),
      },
      context,
      'intelligence',
      true,
    );
  }

  async deleteRagDocument(id: string, user: AuthenticatedUser) {
    const document = await this.prisma.document.findUnique({
      where: { id },
      select: { estateId: true },
    });
    // Community document: derive estate from Prisma (prevents caller from spoofing estateId).
    // No Prisma record: public/global RAG document — only Role A global context can manage it.
    const context = await this.authorization.resolve(
      user,
      document?.estateId ?? undefined,
      true,
    );
    return this.callRag(
      `/documents/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      context,
      'intelligence',
      true,
    );
  }

  private async callRag<T>(
    path: string,
    init: Omit<RequestInit, 'body'> & { body?: string },
    context: AuthorizationContext,
    channel: AssistantChannel,
    ingestion = false,
  ): Promise<T> {
    const baseUrl = this.config
      .get<string>(ingestion ? 'RAG_INGESTION_API_URL' : 'RAG_API_URL')
      ?.replace(/\/+$/, '');
    if (!baseUrl) {
      throw new ServiceUnavailableException(
        'El asistente no está disponible en este momento.',
      );
    }
    const internalKey = this.config.get<string>(
      ingestion ? 'RAG_INGESTION_INTERNAL_KEY' : 'RAG_INTERNAL_KEY',
    );
    if (!internalKey || internalKey.length < 32)
      throw new ServiceUnavailableException(
        'Configura la clave interna del asistente.',
      );
    const correlationId = randomUUID();
    // Signed scope goes in a bounded body, avoiding HTTP header size limits for large communities.
    const method = init.method === 'GET' ? 'POST' : init.method;
    const operationBody = init.body ?? '';
    const payload = Buffer.from(
      JSON.stringify({
        ...context,
        channel,
        issued_at: Math.floor(Date.now() / 1000),
        nonce: randomUUID(),
        correlation_id: correlationId,
        method,
        path,
        body_sha256: createHash('sha256').update(operationBody).digest('hex'),
      }),
    ).toString('base64url');
    if (payload.length > 1_500_000)
      throw new ForbiddenException(
        'El contexto de permisos excede el límite configurado.',
      );
    const signature = createHmac('sha256', internalKey)
      .update(payload)
      .digest('hex');
    this.logger.log(
      JSON.stringify({
        event: 'rag.authorization.allowed',
        correlation_id: correlationId,
        user_id: context.user_id,
        community_ids: context.allowed_community_ids,
      }),
    );

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        method,
        body: JSON.stringify({
          authorization: `${payload}.${signature}`,
          payload: operationBody,
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId,
        },
        signal: AbortSignal.timeout(RAG_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'rag.transport.failed',
          correlation_id: correlationId,
          error_type: (error as Error).name,
        }),
      );
      throw new BadGatewayException(
        'El asistente no ha podido responder. Inténtalo de nuevo.',
      );
    }

    if (response.status === 404) {
      throw new NotFoundException('Conversación no encontrada.');
    }
    if (!response.ok) {
      this.logger.error(
        JSON.stringify({
          event: 'rag.transport.failed',
          correlation_id: correlationId,
          status: response.status,
        }),
      );
      throw new BadGatewayException(
        'El asistente no ha podido responder. Inténtalo de nuevo.',
      );
    }
    return (await response.json()) as T;
  }
}
