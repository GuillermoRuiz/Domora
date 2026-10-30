/**
 * Checks that an uploaded file's bytes match its declared MIME type, so a renamed
 * executable or HTML page cannot be stored as a "PDF". Text formats only need to
 * contain no NUL bytes in their first KiB.
 */
const startsWith = (buffer: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buffer[offset + i] === b);

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx, xlsx
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // doc, xls
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

const isText = (buffer: Buffer) => !buffer.subarray(0, 1024).includes(0);

export function fileMatchesMime(buffer: Buffer, mime: string): boolean {
  switch (mime) {
    case 'application/pdf': return startsWith(buffer, PDF);
    case 'image/png': return startsWith(buffer, PNG);
    case 'image/jpeg': return startsWith(buffer, JPEG);
    case 'image/webp': return startsWith(buffer, RIFF) && startsWith(buffer, WEBP, 8);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return startsWith(buffer, ZIP);
    case 'application/msword':
    case 'application/vnd.ms-excel':
      return startsWith(buffer, OLE);
    case 'application/xml':
    case 'text/xml':
    case 'text/plain':
    case 'text/csv':
      return isText(buffer);
    default:
      return false;
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  xml: 'application/xml',
};

/**
 * Type of a stored file from its key's extension, for documents created before the library
 * stored `mimeType` (only the types uploads accept; anything else stays unknown).
 */
export function mimeFromKey(key: string | null | undefined): string | null {
  const ext = key?.split('/').pop()?.split('.').pop()?.toLowerCase();
  return (ext && MIME_BY_EXTENSION[ext]) || null;
}

/** Stored type, or the one its file extension implies. */
export function documentMime(d: { mimeType: string | null; s3Key: string | null }): string | null {
  return d.mimeType ?? mimeFromKey(d.s3Key);
}
