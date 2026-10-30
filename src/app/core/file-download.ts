/** Extensión por tipo de contenido, para los ficheros cuyo título no la trae. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'text/plain': '.txt',
  'text/csv': '.csv',
};

/** Añade la extensión que corresponde al tipo del fichero si el nombre no tiene ninguna ("Presupuesto 2027" + PDF → "Presupuesto 2027.pdf"). */
export function fileNameFor(title: string, contentType: string): string {
  const name = title.trim() || 'documento';
  if (/\.[A-Za-z0-9]{2,5}$/.test(name)) return name;
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return `${name}${EXTENSION_BY_TYPE[type] ?? ''}`;
}

/** El servidor sirve los ficheros como `application/octet-stream`: se reconoce el tipo por los primeros bytes. */
async function sniffType(blob: Blob): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf'; // %PDF-
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  return '';
}

/** Guarda en el equipo del usuario un fichero ya descargado. */
export async function saveBlob(blob: Blob, title: string): Promise<void> {
  // El tipo que declara el servidor manda; solo si no dice nada útil se mira el contenido.
  const type = blob.type && blob.type !== 'application/octet-stream' ? blob.type : await sniffType(blob);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileNameFor(title, type);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
