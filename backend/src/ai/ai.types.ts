export const AI_PROMPT_VERSION = 2;
/** Older queued payloads had no explicit version and retain v1 provenance. */
export function requestPromptVersion(context: unknown): number {
  const version = (context as { promptVersion?: unknown } | null)
    ?.promptVersion;
  return typeof version === 'number' && Number.isInteger(version) && version > 0
    ? version
    : 1;
}
import type { Prisma } from '../prisma/client';
export type AiKind =
  | 'invoice-extraction'
  | 'reconciliation-review'
  | 'weekly-intelligence'
  | 'meeting-minutes';
export type Json = Prisma.InputJsonValue;
export interface InvoiceExtraction {
  supplier_name: string | null;
  supplier_tax_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  description: string | null;
  net_amount: string | null;
  vat_amount: string | null;
  total_amount: string | null;
  withholding_amount: string | null;
  currency: string | null;
  payment_reference: string | null;
  needs_review: boolean;
}
export interface Signal {
  id: string;
  entity_type: 'issue' | 'contract' | 'invoice' | 'bank' | 'estate' | 'event';
  entity_id: string;
  fact: string;
  priority: 'high' | 'medium' | 'low';
  link: string;
}
export interface Intelligence {
  summary: string;
  items: {
    signal_id: string;
    priority: 'high' | 'medium' | 'low';
    title: string;
    explanation: string;
    recommended_action: string;
    entity_type: Signal['entity_type'];
    entity_id: string;
  }[];
}
export interface Review {
  candidate_key: string | null;
  plausible: boolean;
  evidence_summary: string;
  needs_review: boolean;
}
export const json = (value: unknown): Json =>
  JSON.parse(JSON.stringify(value)) as Json;
