import type { Intelligence, InvoiceExtraction, Review } from '../ai.types';
import type { MeetingMinutesOutput } from '../meeting-minutes.contract';
import { defineUseCase, clip } from './ai-use-case';

/** Casos de uso de IA que no son de incidencias, declarados en el mismo catálogo. */

// ── draft_meeting_minutes ──────────────────────────────────────────────────

export interface MeetingMinutesSource {
  sections: readonly { id: string; title: string; notes: string }[];
}

/** Solo título y notas de cada sección: ni asistentes, ni cuotas, ni votos, ni fechas. */
export const draftMeetingMinutes = defineUseCase<
  MeetingMinutesSource,
  MeetingMinutesOutput
>({
  name: 'draft_meeting_minutes',
  kind: 'meeting-minutes',
  promptVersion: 1,
  maxInputChars: 120_000,
  attachments: 'none',
  admitsBinary: false,
  build: (s) => ({
    sections: s.sections.map((x) => ({
      id: clip(x.id, 100),
      title: clip(x.title, 300),
      notes: clip(x.notes, 8000),
    })),
  }),
});

// ── extract_invoice ────────────────────────────────────────────────────────

export interface ExtractInvoiceSource {
  /** Texto extraído del documento (preferente). */
  text: string;
  /** Solo si no hay texto suficiente: el propio documento, autorizado para este caso de uso. */
  file?: { fileName: string; mimeType: string; bytes: Buffer };
}

/** Único caso de uso que admite binarios: una factura que una persona subió para extraerla. */
export const extractInvoice = defineUseCase<
  ExtractInvoiceSource,
  InvoiceExtraction
>({
  name: 'extract_invoice',
  kind: 'invoice-extraction',
  promptVersion: 2,
  maxInputChars: 14 * 1024 * 1024,
  attachments: 'explicit',
  admitsBinary: true,
  build: ({ text, file }) => {
    const content: unknown[] =
      text.length > 150 || !file
        ? [{ type: 'input_text', text }]
        : file.mimeType === 'application/pdf'
          ? [
              {
                type: 'input_file',
                filename: file.fileName,
                file_data: `data:application/pdf;base64,${file.bytes.toString('base64')}`,
              },
            ]
          : [
              {
                type: 'input_image',
                image_url: `data:${file.mimeType};base64,${file.bytes.toString('base64')}`,
              },
            ];
    return [{ role: 'user', content }];
  },
});

// ── review_reconciliation ──────────────────────────────────────────────────

export interface ReviewReconciliationSource {
  candidates: readonly unknown[];
  bank_entries: readonly unknown[];
  journal_lines?: readonly unknown[];
  invoice_candidates?: readonly unknown[];
}

export const reviewReconciliation = defineUseCase<
  ReviewReconciliationSource,
  Review
>({
  name: 'review_reconciliation',
  kind: 'reconciliation-review',
  promptVersion: 2,
  maxInputChars: 400_000,
  attachments: 'none',
  admitsBinary: false,
  build: (s) => ({
    candidates: s.candidates,
    bank_entries: s.bank_entries,
    ...(s.journal_lines ? { journal_lines: s.journal_lines } : {}),
    ...(s.invoice_candidates
      ? { invoice_candidates: s.invoice_candidates }
      : {}),
  }),
});

// ── weekly_intelligence ────────────────────────────────────────────────────

const WEEKLY_FIELDS = [
  'community_id',
  'snapshot_at',
  'as_of_calendar_date',
  'time_zone',
  'finance',
  'incidents',
  'contracts',
  'accounting',
  'signals',
  'coverage',
  'limitations',
] as const;

export type WeeklyIntelligenceSource = Partial<
  Record<(typeof WEEKLY_FIELDS)[number], unknown>
>;

/** Cifras agregadas y señales: solo estos campos del resumen semanal salen hacia el modelo. */
export const weeklyIntelligence = defineUseCase<
  WeeklyIntelligenceSource,
  Intelligence
>({
  name: 'weekly_intelligence',
  kind: 'weekly-intelligence',
  promptVersion: 2,
  maxInputChars: 400_000,
  attachments: 'none',
  admitsBinary: false,
  build: (s) =>
    Object.fromEntries(
      WEEKLY_FIELDS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]),
    ),
});
