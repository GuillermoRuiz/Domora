import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiUnavailableReason } from './ai-errors';

export type AiRegion = 'eu' | 'global' | 'custom';
export interface AiAvailability {
  available: boolean;
  reason?: AiUnavailableReason;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
/**
 * Hosts que SATISFACEN `AI_REQUIRE_REGION=eu`. `eu.api.openai.com` es el host europeo (EEE + Suiza) y, según la
 * documentación de OpenAI, soporta `/v1/responses`, `/v1/batches` y `/v1/files` regionalmente, SUJETO a la
 * configuración y elegibilidad del proyecto. Es configuración, no un hecho jurídico: usar el host no prueba que
 * NUESTRA cuenta/proyecto tenga activada la residencia UE (eso es configuración externa con OpenAI). Se puede
 * cambiar con `AI_EU_HOSTS`.
 */
const DEFAULT_EU_HOSTS = ['eu.api.openai.com'];

@Injectable()
export class AiConfigService {
  private readonly logger = new Logger(AiConfigService.name);

  constructor(private readonly config: ConfigService) {
    // Una IA mal configurada no tumba la aplicación: los módulos que la usan muestran su estado no disponible.
    const { available, reason } = this.availability;
    if (this.requested && !available)
      this.logger.warn(
        `IA solicitada pero NO disponible (${reason}).`,
      );
  }
  private get nonProduction() {
    return ['development', 'test'].includes(
      this.config.get<string>('NODE_ENV')?.trim() ?? '',
    );
  }
  /** Se ha pedido la IA (`AI_ENABLED=true`), esté o no utilizable. */
  get requested() {
    return this.config.get<string>('AI_ENABLED') === 'true';
  }
  /**
   * La IA se puede USAR ahora: pedida, configurada y, si se exige, en la región requerida. Todo lo que
   * se automatiza con IA pregunta esto; si es `false`, el trabajo pasa a una persona.
   */
  get enabled() {
    return this.availability.available;
  }
  get unavailableReason(): AiUnavailableReason | undefined {
    return this.availability.reason;
  }
  get availability(): AiAvailability {
    if (!this.requested) return { available: false, reason: 'AI_DISABLED' };
    if (!this.apiKey || !this.model || !this.endpoint)
      return { available: false, reason: 'AI_NOT_CONFIGURED' };
    const required = this.requireRegion;
    // Si se exige UE y no se puede cumplir: NUNCA se cae al endpoint global.
    if (
      required === 'invalid' ||
      (required === 'eu' && (this.region !== 'eu' || !this.projectId))
    )
      return { available: false, reason: 'AI_REGION_UNAVAILABLE' };
    return { available: true };
  }
  /** `OPENAI_BASE_URL` validada: https (http solo hacia localhost en desarrollo/pruebas), sin credenciales ni query. */
  private get endpoint(): URL | null {
    const raw =
      this.config.get<string>('OPENAI_BASE_URL')?.trim() || DEFAULT_BASE_URL;
    try {
      const url = new URL(raw);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(
        url.hostname,
      );
      const protocolOk =
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && loopback && this.nonProduction);
      if (!protocolOk || url.username || url.password || url.search || url.hash)
        return null;
      return url;
    } catch {
      return null;
    }
  }
  get baseUrl(): string {
    return (this.endpoint?.href ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }
  get projectId() {
    return this.config.get<string>('OPENAI_PROJECT_ID')?.trim() ?? '';
  }
  get organizationId() {
    return this.config.get<string>('OPENAI_ORGANIZATION_ID')?.trim() ?? '';
  }
  /** `AI_REQUIRE_REGION`: `eu`, `none` (por defecto) o un valor que no se reconoce (→ se trata como no cumplible). */
  get requireRegion(): 'eu' | 'none' | 'invalid' {
    const raw = this.config
      .get<string>('AI_REQUIRE_REGION')
      ?.trim()
      .toLowerCase();
    if (!raw || raw === 'none') return 'none';
    return raw === 'eu' ? 'eu' : 'invalid';
  }
  private get euHosts(): string[] {
    const configured = (this.config.get<string>('AI_EU_HOSTS') ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    return configured.length ? configured : DEFAULT_EU_HOSTS;
  }
  /** Región técnica del endpoint configurado (no implica residencia contractual). */
  get region(): AiRegion {
    const host = this.endpoint?.hostname.toLowerCase() ?? '';
    if (this.euHosts.includes(host)) return 'eu';
    return host === 'api.openai.com' ? 'global' : 'custom';
  }
  get workerEnabled() {
    return this.config.get<string>('AI_WORKER_ENABLED') === 'true';
  }
  /** Tipos de trabajo que procesa este worker (lista separada por comas); sin valor, todos. */
  get workerKinds(): string[] | undefined {
    const kinds = (this.config.get<string>('AI_WORKER_KINDS') ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    return kinds.length ? kinds : undefined;
  }
  get autoReconcile() {
    return this.config.get<string>('AI_AUTO_RECONCILE') === 'true';
  }
  get model() {
    return this.config.get<string>('OPENAI_MODEL')?.trim() ?? '';
  }
  get visionModel() {
    return this.config.get<string>('OPENAI_VISION_MODEL')?.trim() || this.model;
  }
  get apiKey() {
    return this.config.get<string>('OPENAI_API_KEY')?.trim() ?? '';
  }
  get pdftotext() {
    return this.config.get<string>('PDFTOTEXT_PATH')?.trim() ?? '';
  }
  /** Horas que se conservan los ficheros de Batch en OpenAI tras aplicar los resultados (0 = borrarlos enseguida). */
  get batchFileRetentionHours() {
    return nonNegative(
      this.config.get<string>('AI_BATCH_FILE_RETENTION_HOURS'),
    );
  }
  /** Cada cuánto escribe el worker su latido (segundos en la variable, milisegundos aquí). */
  get workerHeartbeatIntervalMs(): number {
    return positiveSeconds(
      this.config.get<string>('AI_WORKER_HEARTBEAT_SECONDS'),
      30,
    );
  }
  /**
   * Tras cuánto sin latido se considera que no hay worker. Nunca menos de dos intervalos: un latido perdido no debe
   * dar la cola por abandonada.
   */
  get workerHeartbeatStaleMs(): number {
    return Math.max(
      positiveSeconds(
        this.config.get<string>('AI_WORKER_HEARTBEAT_STALE_SECONDS'),
        150,
      ),
      2 * this.workerHeartbeatIntervalMs,
    );
  }
  get requestResultRetentionHours(): number | null {
    return optionalHours(
      this.config.get<string>('AI_REQUEST_RESULT_RETENTION_HOURS'),
    );
  }
  /** Horas que se conserva `AiRequest.payload` tras completarse la petición (0 = vaciarlo enseguida). */
  get requestPayloadRetentionHours() {
    return nonNegative(
      this.config.get<string>('AI_REQUEST_PAYLOAD_RETENTION_HOURS'),
    );
  }
}

/**
 * Horas que se conserva `AiRequest.result` (la salida del modelo) una vez MATERIALIZADA en su entidad (factura,
 * conciliación, resumen…). `null` = no se purga: el plazo definitivo es una decisión legal/de producto pendiente,
 * así que no se inventa uno. Configurable (0 = enseguida) para poder aplicarlo cuando se decida.
 */
function optionalHours(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveSeconds(raw: string | undefined, fallbackSeconds: number): number {
  const value = Number(raw ?? '');
  const seconds =
    raw !== undefined && raw.trim() !== '' && Number.isFinite(value) && value > 0
      ? value
      : fallbackSeconds;
  return seconds * 1000;
}

function nonNegative(raw: string | undefined): number {
  const value = Number(raw ?? '');
  return raw !== undefined &&
    raw.trim() !== '' &&
    Number.isFinite(value) &&
    value >= 0
    ? value
    : 0;
}
