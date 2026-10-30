import type { AiKind } from '../ai.types';

declare const aiInputBrand: unique symbol;

/**
 * Lo ÚNICO que acepta el cliente del LLM. Solo se fabrica con `AiUseCase.prepare`, que construye la entrada
 * campo a campo (lista blanca): no hay forma de pasar una incidencia, un correo o una factura enteros.
 */
export interface AiInput {
  readonly [aiInputBrand]: true;
  readonly useCase: string;
  readonly kind: AiKind;
  readonly promptVersion: number;
  readonly payload: unknown;
}

/** Qué adjuntos admite un caso de uso: ninguno, solo texto extraído, o binarios autorizados expresamente. */
export type AttachmentPolicy = 'none' | 'text_only' | 'explicit';

/**
 * Un uso de IA declarado: qué datos entran (el constructor de entrada), cuánto, si admite binarios, contra qué
 * esquema se valida la salida (el `kind`) y con qué versión de prompt. `Output` es solo el tipo del resultado.
 */
export interface AiUseCase<Source = never, Output = unknown> {
  readonly name: string;
  readonly kind: AiKind;
  readonly promptVersion: number;
  /** Tope del tamaño de la entrada serializada. */
  readonly maxInputChars: number;
  readonly attachments: AttachmentPolicy;
  readonly admitsBinary: boolean;
  /** Solo para inferir el tipo de salida. */
  readonly output?: Output;
  prepare(source: Source): AiInput;
}

export interface AiUseCaseDefinition<Source> {
  name: string;
  kind: AiKind;
  promptVersion: number;
  maxInputChars: number;
  attachments: AttachmentPolicy;
  admitsBinary: boolean;
  /** Construye lo que se envía eligiendo campos concretos del origen: jamás se reenvía el origen. */
  build: (source: Source) => unknown;
}

const BINARY = /data:[\w.+-]+\/[\w.+-]+;base64,|"type":"input_(?:image|file)"/;

export function defineUseCase<Source, Output = unknown>(
  definition: AiUseCaseDefinition<Source>,
): AiUseCase<Source, Output> {
  const { build, ...meta } = definition;
  return {
    ...meta,
    prepare(source: Source): AiInput {
      const payload = build(source);
      const serialized = JSON.stringify(payload);
      if (serialized.length > meta.maxInputChars)
        throw new Error('AI_INPUT_TOO_LARGE');
      // Un binario solo entra por un caso de uso que lo declara.
      if (!meta.admitsBinary && BINARY.test(serialized))
        throw new Error('AI_BINARY_NOT_ALLOWED');
      return Object.freeze({
        useCase: meta.name,
        kind: meta.kind,
        promptVersion: meta.promptVersion,
        payload,
      }) as unknown as AiInput;
    },
  };
}

/** Recorta un texto libre a un máximo de caracteres. */
export const clip = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : '';
