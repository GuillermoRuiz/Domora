/** Helpers shared by the owner issues page, its detail panel and its creation modal. */

/** Readable message of an API error (the backend sends `message` as text or as a list). */
export function messageFrom(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } })?.error?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.length > 0) return message.join(' ');
  return fallback;
}

/** El título de una incidencia es una frase corta: se lee entero en listados y avisos. */
export const ISSUE_TITLE_MAX = 34;

/** Same limit as the server (StorageService.MAX_SIZE_BYTES). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Splits the chosen files into the ones that can be attached and the reasons for the rest. */
export function checkAttachments(files: File[]): { valid: File[]; errors: string[] } {
  const valid: File[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') errors.push(`«${file.name}» no es una imagen ni un PDF.`);
    else if (file.size > MAX_ATTACHMENT_BYTES) errors.push(`«${file.name}» supera los 10 MB.`);
    else valid.push(file);
  }
  return { valid, errors };
}

const DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const MADRID_DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Madrid' });

/** "AAAA-MM-DD…" of a date-only column → calendar day, without the time zone shifting it. */
export function calendarDay(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : DAY.format(date);
}

/** A timestamp as the day it was in Spain. */
export function madridDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : MADRID_DAY.format(date);
}

/** 24 → "24 horas"; 72 → "3 días". */
export function responseTime(hours: number): string {
  if (hours < 48) return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  return `${Math.round(hours / 24)} días`;
}
