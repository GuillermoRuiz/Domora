/**
 * Puerto directo de los helpers de mapa de `CreateJuntaDialog.tsx` (React).
 * Sin API key de Google Maps configurada, cae al embed público sin key
 * (`google.com/maps?output=embed&q=...`) — mismo fallback que el original.
 * No hay selector de dirección con autocompletar (Places API): por eso
 * `locationLat`/`locationLng`/`locationPlaceId` del DTO no se rellenan
 * todavía desde este formulario — quedan preparados para cuando se añada.
 */
export function buildMapEmbedUrl(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return '';
  return `https://www.google.com/maps?output=embed&q=${encodeURIComponent(trimmed)}`;
}

export function buildOpenInMapsUrl(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return 'https://maps.google.com';
  return `https://www.google.com/maps/search/${encodeURIComponent(trimmed)}`;
}

const LOWERCASE_WORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'en', 'a']);

const ABBREVIATIONS: Record<string, string> = {
  'c/': 'Calle', 'c.': 'Calle',
  'av/': 'Avenida', 'av.': 'Avenida', 'avda': 'Avenida', 'avda.': 'Avenida',
  'pº': 'Paseo', 'p.': 'Paseo',
  'pl.': 'Plaza', 'pza': 'Plaza', 'pza.': 'Plaza',
  'ctra': 'Carretera', 'ctra.': 'Carretera',
};

/** Capitaliza correctamente direcciones españolas — puerto de `capitalizeAddress` (React). */
export function capitalizeAddress(text: string): string {
  if (!text?.trim()) return '';
  let result = text.toLowerCase().trim();
  for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`^${abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i');
    result = result.replace(regex, `${full} `);
  }
  return result
    .split(/\s+/)
    .map((word, index) => {
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      if (LOWERCASE_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

export function buildFullAddress(street: string, postalCode: string, city: string): string {
  const parts: string[] = [];
  if (street?.trim()) parts.push(capitalizeAddress(street));
  if (postalCode?.trim()) parts.push(postalCode.trim());
  if (city?.trim()) parts.push(capitalizeAddress(city));
  return parts.join(', ');
}
