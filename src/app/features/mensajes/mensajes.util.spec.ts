import { filterConversations, formatConversationDate, type InboxFilters } from './mensajes.util';
import type { ConversationSummary } from '../../core/models';

const NOW = new Date('2026-10-17T12:00:00');
const ROWS: ConversationSummary[] = [
  { id: 'a', otherUserId: 'u2', otherDisplayName: 'María García', lastMessagePreview: 'Ascensor averiado', lastMessageAt: '2026-10-17T10:00:00', unreadCount: 2, lastMessageSenderId: 'u2' },
  { id: 'b', otherUserId: 'u3', otherDisplayName: 'Javier Pérez', lastMessagePreview: 'Cuotas de la comunidad', lastMessageAt: '2026-10-16T10:00:00', unreadCount: 0, lastMessageSenderId: 'me' },
  { id: 'c', otherUserId: 'u4', otherDisplayName: 'Ana Contreras', lastMessagePreview: 'Documentación', lastMessageAt: '2026-09-01T10:00:00', unreadCount: 1, lastMessageSenderId: 'u4' },
];
const DEFAULTS: InboxFilters = { search: '', unreadOnly: false, range: null, sort: 'recent' };

describe('Filtros de la bandeja de Mensajes', () => {
  it('busca por remitente y último mensaje sin distinguir tildes o mayúsculas', () => {
    expect(filterConversations(ROWS, { ...DEFAULTS, search: 'MARIA' }, []).map(r => r.id)).toEqual(['a']);
    expect(filterConversations(ROWS, { ...DEFAULTS, search: 'documentacion' }, []).map(r => r.id)).toEqual(['c']);
  });

  it('combina sin leer y rango de fechas', () => {
    const filters: InboxFilters = { ...DEFAULTS, unreadOnly: true, range: { from: '2026-10-11', to: '2026-10-17' } };
    expect(filterConversations(ROWS, filters, []).map(r => r.id)).toEqual(['a']);
  });

  it('el rango incluye el primer y el último día completos', () => {
    expect(filterConversations(ROWS, { ...DEFAULTS, range: { from: '2026-10-16', to: '2026-10-16' } }, []).map(r => r.id)).toEqual(['b']);
    expect(filterConversations(ROWS, { ...DEFAULTS, range: { from: '2026-10-16', to: '2026-10-17' } }, []).map(r => r.id)).toEqual(['a', 'b']);
    expect(filterConversations(ROWS, { ...DEFAULTS, range: { from: '2026-09-01', to: '2026-09-01' } }, []).map(r => r.id)).toEqual(['c']);
  });

  it('un rango sin conversaciones deja la lista vacía', () => {
    expect(filterConversations(ROWS, { ...DEFAULTS, range: { from: '2025-01-01', to: '2025-01-31' } }, [])).toEqual([]);
  });

  it('conserva las fijadas arriba, ordena las demás y no modifica los datos originales', () => {
    expect(filterConversations(ROWS, DEFAULTS, ['c']).map(r => r.id)).toEqual(['c', 'a', 'b']);
    expect(filterConversations(ROWS, { ...DEFAULTS, sort: 'oldest' }, []).map(r => r.id)).toEqual(['c', 'b', 'a']);
    expect(ROWS.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('hoy comienza a medianoche y ayer incluye la fecha anterior', () => {
    expect(formatConversationDate(ROWS[0].lastMessageAt, NOW)).toContain('Hoy');
    expect(formatConversationDate(ROWS[1].lastMessageAt, NOW)).toContain('Ayer');
    expect(formatConversationDate('invalid', NOW)).toBe('');
  });
});
