import { Injectable } from '@nestjs/common';
import { AiConfigService, type AiRegion } from './ai-config.service';
import { AiOutputService } from './ai-output.service';
import { AiUnavailableError } from './ai-errors';
import type { AiInput, AiUseCase } from './use-cases/ai-use-case';

export interface RemoteBatch {
  id: string;
  status: string;
  input_file_id: string;
  output_file_id: string | null;
  error_file_id: string | null;
  metadata?: Record<string, string>;
}

/**
 * Rastro de una llamada al modelo: lo que hace falta para auditarla SIN guardar su contenido
 * (ni el prompt ni la respuesta). `store:false` pide que OpenAI no conserve la respuesta; NO equivale a Zero
 * Data Retention, que depende de la configuración real de nuestra cuenta con el proveedor.
 */
export interface AiCallTrace {
  useCase: string;
  promptVersion: number;
  model: string;
  requestId: string | null;
  responseId: string | null;
  latencyMs: number;
  /** Región técnica del endpoint usado (`mock` en desarrollo). No prueba residencia contractual. */
  region: AiRegion | 'mock';
  projectId: string | null;
  store: false;
  usage: unknown;
}

export interface AiRun<T> {
  value: T;
  usage: unknown;
  model: string;
  trace: AiCallTrace;
}

interface RawCall<T> {
  data: T;
  requestId: string | null;
}

@Injectable()
export class OpenAiService {
  constructor(
    private readonly config: AiConfigService,
    private readonly outputs: AiOutputService,
  ) {}

  /** Cuerpo de una petición a Responses. Solo acepta una entrada fabricada por un caso de uso. */
  body(input: AiInput, model = this.config.model): Record<string, unknown> {
    if (!model) throw new Error('AI_MODEL_MISSING');
    const payload = input.payload;
    return {
      model,
      store: false,
      instructions: this.outputs.prompt(input.kind, input.promptVersion),
      input:
        Array.isArray(payload) || typeof payload === 'string'
          ? payload
          : JSON.stringify(payload),
      max_output_tokens: 3000,
      text: {
        format: {
          type: 'json_schema',
          name: input.kind.replace(/-/g, '_'),
          strict: true,
          schema: this.outputs.schema(input.kind),
        },
      },
    };
  }

  private async call<T>(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<RawCall<T>> {
    const availability = this.config.availability;
    // Sin IA utilizable (apagada, sin configurar o fuera de la región exigida) no se sale a ningún endpoint.
    if (!availability.available)
      throw new AiUnavailableError(availability.reason ?? 'AI_DISABLED');
    // Paths are constructed by backend code; no model-supplied URL is accepted.
    const allowed =
      /^\/(responses|files(?:\/[A-Za-z0-9_-]+(?:\/content)?)?|batches(?:\/[A-Za-z0-9_-]+)?)(?:\?after=[A-Za-z0-9_-]+&limit=100|\?limit=100)?$/.test(
        path,
      );
    if (
      !allowed ||
      (method === 'DELETE' && !/^\/files\/[A-Za-z0-9_-]+$/.test(path))
    )
      throw new Error('AI_PATH_INVALID');
    const multipart = body instanceof FormData;
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        ...(this.config.projectId
          ? { 'OpenAI-Project': this.config.projectId }
          : {}),
        ...(this.config.organizationId
          ? { 'OpenAI-Organization': this.config.organizationId }
          : {}),
        ...(!multipart ? { 'Content-Type': 'application/json' } : {}),
      },
      body:
        body === undefined
          ? undefined
          : multipart
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`);
    const requestId = response.headers.get('x-request-id');
    if (path.endsWith('/content')) {
      const text = await response.text();
      if (text.length > 25 * 1024 * 1024)
        throw new Error('AI_RESULT_TOO_LARGE');
      return { data: text as T, requestId };
    }
    return { data: (await response.json()) as T, requestId };
  }

  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    return (await this.call<T>(path, method, body)).data;
  }

  /**
   * Única puerta para pedir algo al modelo: un caso de uso del catálogo y los datos de origen. El caso de uso
   * decide qué campos salen; el resultado se valida con su esquema y se devuelve con su rastro de auditoría.
   *
   */
  async run<Source, Output>(
    useCase: AiUseCase<Source, Output>,
    source: Source,
    _scope?: { estateId: string },
    model = this.config.model,
  ): Promise<AiRun<Output>> {
    const availability = this.config.availability;
    if (!availability.available)
      throw new AiUnavailableError(availability.reason ?? 'AI_DISABLED');
    const input = useCase.prepare(source);
    const started = Date.now();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data, requestId } = await this.call<{
          id?: string;
          usage?: unknown;
        }>('/responses', 'POST', this.body(input, model));
        return {
          value: this.outputs.parseResponse<Output>(useCase.kind, data),
          usage: data.usage ?? null,
          model,
          trace: {
            useCase: useCase.name,
            promptVersion: useCase.promptVersion,
            model,
            requestId,
            responseId: typeof data.id === 'string' ? data.id : null,
            latencyMs: Date.now() - started,
            region: this.config.region,
            projectId: this.config.projectId || null,
            store: false,
            usage: data.usage ?? null,
          },
        };
      } catch (error) {
        if (
          attempt === 2 ||
          !/^OPENAI_HTTP_(429|5\d\d)$/.test(
            error instanceof Error ? error.message : '',
          )
        )
          throw error;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    throw new Error('AI_RETRY_EXHAUSTED');
  }

  async upload(
    content: Buffer,
    name: string,
    purpose: 'batch' | 'user_data',
  ): Promise<string> {
    const form = new FormData();
    form.append('purpose', purpose);
    form.append('file', new Blob([new Uint8Array(content)]), name);
    const file = await this.request<{ id: string }>('/files', 'POST', form);
    if (!/^file-[A-Za-z0-9_-]+$/.test(file.id))
      throw new Error('AI_FILE_ID_INVALID');
    return file.id;
  }

  /** Borra un fichero de la cuenta de OpenAI (los de Batch ya no hacen falta tras aplicar sus resultados). */
  async deleteFile(fileId: string): Promise<void> {
    if (!/^file-[A-Za-z0-9_-]+$/.test(fileId))
      throw new Error('AI_FILE_ID_INVALID');
    await this.request(`/files/${fileId}`, 'DELETE');
  }

  async findBatch(localId: string): Promise<RemoteBatch | null> {
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const data = await this.request<{
        data: RemoteBatch[];
        has_more: boolean;
        last_id: string;
      }>(`/batches?${after ? `after=${after}&` : ''}limit=100`);
      const matches = data.data.filter(
        (b) => b.metadata?.domora_batch === localId,
      );
      if (matches.length > 1) throw new Error('AI_DUPLICATE_REMOTE_BATCH');
      if (matches.length) return matches[0];
      if (!data.has_more) return null;
      after = data.last_id;
    }
    throw new Error('AI_BATCH_LOOKUP_INCOMPLETE');
  }
}
