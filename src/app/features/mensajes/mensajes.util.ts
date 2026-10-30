import type { ConversationSummary } from '../../core/models';
import { rangeBounds, type DateRange } from '../../shared/components/date-range-picker/date-range.util';

export interface InboxFilters {
  search: string;
  unreadOnly: boolean;
  /** Días (inclusivos) del último mensaje de la conversación; `null` = cualquier fecha. */
  range: DateRange | null;
  sort: 'recent' | 'oldest' | 'unread';
}

export function normalizeMessageSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
}

export function filterConversations(
  rows: ConversationSummary[], filters: InboxFilters, pinnedIds: string[],
): ConversationSummary[] {
  const query = normalizeMessageSearch(filters.search);
  const bounds = filters.range ? rangeBounds(filters.range) : null;
  const pins = new Set(pinnedIds);
  return rows.filter(row => {
    if (query && !normalizeMessageSearch(`${row.otherDisplayName} ${row.lastMessagePreview}`).includes(query)) return false;
    if (filters.unreadOnly && row.unreadCount === 0) return false;
    if (!bounds) return true;
    const at = Date.parse(row.lastMessageAt);
    return at >= bounds.start && at <= bounds.end;
  }).sort((a, b) => {
    const pinned = Number(pins.has(b.id)) - Number(pins.has(a.id));
    if (pinned) return pinned;
    if (filters.sort === 'unread' && a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
    const delta = Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt);
    return (filters.sort === 'oldest' ? -delta : delta) || a.id.localeCompare(b.id);
  });
}

export function formatConversationDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (date >= today) return `Hoy, ${time}`;
  if (date >= yesterday) return `Ayer, ${time}`;
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatFileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}
