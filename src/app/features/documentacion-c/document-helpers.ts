import type { OwnerDocumentFileType } from '../../core/owner-documents.models';

/** Helpers shared by the owner «Documentación» page and its detail panel. */

const DAY_FORMAT = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** `2026-10-12` → «12 oct 2026» (a calendar day: no time zone shift). */
export function formatDay(day: string): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return day;
  return DAY_FORMAT.format(new Date(Date.UTC(y, m - 1, d))).replace(/\./g, '');
}

export function fileIcon(fileType: OwnerDocumentFileType): string {
  switch (fileType) {
    case 'pdf':
    case 'document':
      return 'file-text';
    case 'spreadsheet':
      return 'file-spreadsheet';
    case 'image':
      return 'image';
    default:
      return 'file';
  }
}
