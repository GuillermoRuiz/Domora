import { Injectable, Logger, Optional } from '@nestjs/common';
import { AiConfigService } from '../../ai/ai-config.service';
import { OpenAiService } from '../../ai/openai.service';
import { MEETING_MINUTES_MAX_TEXT } from '../../ai/meeting-minutes.contract';
import { draftMeetingMinutes } from '../../ai/use-cases';

export interface NarrativeSectionInput {
  id: string;
  title: string;
  notes: string;
}

export interface NarrativeSectionResult {
  text: string;
  /** `llm`: redactado por el modelo; `notes`: las notas de la gestora tal cual. */
  mode: 'llm' | 'notes';
}

export interface NarrativeResult {
  /** `llm` si al menos una sección la redactó el modelo; `fallback` si todo salió de las notas. */
  mode: 'llm' | 'fallback';
  model: string | null;
  /** Por qué no se usó el modelo (o por qué se descartó alguna sección). */
  reason: string | null;
  sections: Record<string, NarrativeSectionResult>;
}

/** Notas con el espaciado normalizado: es lo único que hace el modo determinista. */
export function notesAsText(notes: string): string {
  return notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Estructura determinista del modo sin IA: las notas de la gestora tal cual, solo con la
 * ortografía mínima de un texto formal (mayúscula inicial y punto final en cada párrafo). No
 * cambia, añade ni quita ninguna palabra.
 */
export function formalizeNotes(notes: string): string {
  const text = notesAsText(notes);
  if (!text) return '';
  return text
    .split('\n')
    .map((line) => {
      const first = line.search(/\p{L}/u);
      const capitalized =
        first >= 0
          ? line.slice(0, first) +
            line.charAt(first).toLocaleUpperCase('es') +
            line.slice(first + 1)
          : line;
      return /[.!?…:;)»"]$/.test(capitalized) ? capitalized : `${capitalized}.`;
    })
    .join('\n');
}

function numbersIn(text: string): Set<string> {
  return new Set(text.match(/\d+/g) ?? []);
}

/**
 * Defensa adicional contra invenciones: el texto redactado no puede traer cifras que no estén
 * en las notas ni en el título, ni ser desproporcionadamente más largo que las notas.
 */
export function isFaithfulDraft(
  input: NarrativeSectionInput,
  text: string,
): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MEETING_MINUTES_MAX_TEXT) return false;
  if (trimmed.length > Math.max(400, input.notes.length * 4)) return false;
  const allowed = numbersIn(`${input.notes} ${input.title}`);
  for (const number of numbersIn(trimmed)) {
    if (!allowed.has(number)) return false;
  }
  return true;
}

/**
 * Convierte las notas breves de la gestora en redacción formal. La IA NO decide hechos: solo
 * recibe título y notas de cada sección (ni asistentes, ni cuotas, ni votos, ni fechas) y
 * devuelve texto que se valida contra las notas. Si la IA está desactivada, falla o se desvía,
 * se usan las notas de la gestora con una estructura determinista: el acta se genera igual.
 * Reutiliza `OpenAiService` (el mismo cliente, reintentos y validación de esquema que el resto).
 */
@Injectable()
export class ActaNarrativeService {
  private readonly logger = new Logger(ActaNarrativeService.name);

  constructor(
    @Optional() private readonly ai?: OpenAiService,
    @Optional() private readonly config?: AiConfigService,
  ) {}

  async draft(sections: NarrativeSectionInput[]): Promise<NarrativeResult> {
    const withNotes = sections
      .map((section) => ({ ...section, notes: notesAsText(section.notes) }))
      .filter((section) => section.notes.length > 0);
    const fallback = (reason: string | null): NarrativeResult => ({
      mode: 'fallback',
      model: null,
      reason,
      sections: Object.fromEntries(
        withNotes.map((section) => [
          section.id,
          { text: formalizeNotes(section.notes), mode: 'notes' as const },
        ]),
      ),
    });

    if (withNotes.length === 0) return fallback('Sin notas que redactar.');
    if (!this.ai || !this.config?.enabled)
      return fallback('Redacción automática desactivada.');

    try {
      const response = await this.ai.run(draftMeetingMinutes, {
        sections: withNotes.map(({ id, title, notes }) => ({
          id,
          title,
          notes,
        })),
      });
      const sectionsOut: Record<string, NarrativeSectionResult> = {};
      const rejected: string[] = [];
      for (const section of withNotes) {
        const drafted = response.value.sections.find(
          (entry) => entry.id === section.id,
        );
        if (drafted && isFaithfulDraft(section, drafted.text)) {
          sectionsOut[section.id] = { text: drafted.text.trim(), mode: 'llm' };
        } else {
          sectionsOut[section.id] = {
            text: formalizeNotes(section.notes),
            mode: 'notes',
          };
          rejected.push(section.id);
        }
      }
      const usedModel = Object.values(sectionsOut).some(
        (section) => section.mode === 'llm',
      );
      return {
        mode: usedModel ? 'llm' : 'fallback',
        model: usedModel ? response.model : null,
        reason: rejected.length
          ? `Se usaron tus notas originales en ${rejected.length} sección(es) porque la redacción automática no superó la validación.`
          : null,
        sections: sectionsOut,
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'error desconocido';
      this.logger.warn(
        `No se pudo redactar el acta con IA, se usan las notas originales: ${code}`,
      );
      // El código técnico solo va al log: la gestora no tiene que verlo.
      return fallback('Redacción automática no disponible.');
    }
  }
}
