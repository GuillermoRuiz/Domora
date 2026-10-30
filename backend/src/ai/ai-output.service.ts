import { Injectable } from '@nestjs/common';
import Ajv, { type ValidateFunction } from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_PROMPT_VERSION, type AiKind } from './ai.types';
import {
  MEETING_MINUTES_PROMPT,
  MEETING_MINUTES_SCHEMA,
} from './meeting-minutes.contract';

/** Usos de IA cuyo prompt y esquema viven en código (no en `assets/`, que el build no copia). */
const INLINE_KINDS: Partial<
  Record<AiKind, { prompt: string; schema: Record<string, unknown> }>
> = {
  'meeting-minutes': {
    prompt: MEETING_MINUTES_PROMPT,
    schema: MEETING_MINUTES_SCHEMA,
  },
};
@Injectable()
export class AiOutputService {
  private readonly ajv = new Ajv({
    allErrors: false,
    strict: true,
    allowUnionTypes: true,
  });
  private readonly validators = new Map<AiKind, ValidateFunction>();
  schema(kind: AiKind): Record<string, unknown> {
    const inline = INLINE_KINDS[kind];
    if (inline) return inline.schema;
    return JSON.parse(
      readFileSync(join(__dirname, 'assets', `${kind}.schema.json`), 'utf8'),
    ) as Record<string, unknown>;
  }
  /** `version`: la del caso de uso; por defecto, la global (los usos por lotes). */
  prompt(kind: AiKind, version: number = AI_PROMPT_VERSION): string {
    const inline = INLINE_KINDS[kind];
    if (inline) return inline.prompt;
    return readFileSync(
      join(__dirname, 'assets', `${kind}.v${version}.txt`),
      'utf8',
    );
  }
  validate<T>(kind: AiKind, value: unknown): T {
    let validate = this.validators.get(kind);
    if (!validate) {
      validate = this.ajv.compile(this.schema(kind));
      this.validators.set(kind, validate);
    }
    if (!validate(value)) throw new Error(`AI_SCHEMA_INVALID:${kind}`);
    return value as T;
  }
  parseResponse<T>(kind: AiKind, raw: unknown): T {
    const body = raw as {
      status?: string;
      output?: { type: string; content?: { type: string; text?: string }[] }[];
    };
    if (body?.status !== 'completed') throw new Error('AI_RESPONSE_INCOMPLETE');
    const parts = (body.output ?? [])
      .filter((x) => x.type === 'message')
      .flatMap((x) => x.content ?? []);
    if (parts.some((x) => x.type === 'refusal')) throw new Error('AI_REFUSAL');
    const text = parts
      .filter((x) => x.type === 'output_text')
      .map((x) => x.text ?? '')
      .join('');
    if (!text || text.length > 50000) throw new Error('AI_RESPONSE_INVALID');
    return this.validate<T>(kind, JSON.parse(text));
  }
}
