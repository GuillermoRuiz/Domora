import { deflateSync } from 'node:zlib';

/**
 * Fotos FICTICIAS de incidencias para el demo: escenas sencillas generadas
 * por código (sin dependencias ni ficheros binarios en el repo). Determinista:
 * mismo (tipo, variante) = mismos bytes.
 */

const WIDTH = 480;
const HEIGHT = 300;

type Rgb = [number, number, number];

const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Hash entero estable en [0, 1). */
function hash01(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Grano de baja frecuencia (bloques de 6 px) para que no se vea un degradado plano. */
const grain = (x: number, y: number, v: number): number => (hash01(Math.floor(x / 6), Math.floor(y / 6), v) - 0.5) * 14;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(pixel: (x: number, y: number) => Rgb): Buffer {
  const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  let o = 0;
  for (let y = 0; y < HEIGHT; y++) {
    raw[o++] = 0; // filtro «none»
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = clamp(r);
      raw[o++] = clamp(g);
      raw[o++] = clamp(b);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export type IssuePhotoKind = 'Averia' | 'Fuga' | 'Seguridad' | 'Ruido' | 'Limpieza' | 'DanoEstructural' | 'Otro';

/** Distancia de un punto a un segmento. */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Mancha de humedad / suciedad: oscurece de forma suave alrededor de unos centros. */
function blobs(v: number, count: number): { x: number; y: number; r: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    x: 60 + hash01(v, i, 1) * (WIDTH - 120),
    y: 50 + hash01(v, i, 2) * (HEIGHT - 100),
    r: 40 + hash01(v, i, 3) * 55,
  }));
}

function crackPath(v: number): [number, number][] {
  const points: [number, number][] = [];
  let x = 120 + hash01(v, 0, 9) * (WIDTH - 240);
  for (let y = -10; y <= HEIGHT + 10; y += 22) {
    points.push([x, y]);
    x += (hash01(v, y, 7) - 0.5) * 46;
  }
  return points;
}

export function makeIssuePhoto(kind: IssuePhotoKind, variant: number): Buffer {
  const seed = variant + 1;
  switch (kind) {
    case 'Fuga': {
      const stains = blobs(seed, 3);
      const ceiling: Rgb = [226, 222, 212];
      const wet: Rgb = [118, 104, 78];
      return encodePng((x, y) => {
        let k = 0;
        for (const s of stains) k = Math.max(k, 1 - Math.hypot(x - s.x, (y - s.y) * 1.4) / s.r);
        const base = mix(ceiling, [196, 192, 182], y / HEIGHT);
        const [r, g, b] = mix(base, wet, Math.max(0, k) ** 0.8 * 0.9);
        const n = grain(x, y, seed);
        return [r + n, g + n, b + n];
      });
    }
    case 'DanoEstructural': {
      const path = crackPath(seed);
      return encodePng((x, y) => {
        let d = 999;
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1] as [number, number];
          const b = path[i] as [number, number];
          d = Math.min(d, distToSegment(x, y, a[0], a[1], b[0], b[1]));
        }
        const wall: Rgb = [178, 172, 162];
        const n = grain(x, y, seed) * 1.4;
        if (d < 2.4) return [38, 34, 32];
        if (d < 7) return mix([38, 34, 32], [wall[0] + n, wall[1] + n, wall[2] + n], (d - 2.4) / 4.6);
        return [wall[0] + n, wall[1] + n, wall[2] + n];
      });
    }
    case 'Averia': {
      // Panel metálico con triángulo de aviso.
      const cx = WIDTH / 2 + (hash01(seed, 4, 4) - 0.5) * 60;
      const cy = HEIGHT / 2 + 10;
      return encodePng((x, y) => {
        const n = grain(x, y, seed);
        const panel = mix([92, 98, 108], [58, 62, 70], y / HEIGHT);
        const rx = x - cx;
        const ry = y - cy;
        // Triángulo equilátero apuntando arriba, lado ≈ 150.
        const inside = ry > -70 && ry < 55 && Math.abs(rx) < (ry + 70) * 0.58;
        if (inside) {
          const inner = ry > -48 && ry < 42 && Math.abs(rx) < (ry + 48) * 0.58 - 4;
          if (!inner) return [30, 30, 30];
          // Signo de exclamación.
          const bar = Math.abs(rx) < 6 && ry > -18 && ry < 14;
          const dot = Math.hypot(rx, ry - 26) < 6;
          return bar || dot ? [30, 30, 30] : [246, 196, 42];
        }
        return [panel[0] + n, panel[1] + n, panel[2] + n];
      });
    }
    case 'Seguridad': {
      // Puerta con cerradura forzada.
      const left = 130 + hash01(seed, 6, 6) * 40;
      return encodePng((x, y) => {
        const n = grain(x, y, seed);
        const wall: Rgb = [206, 200, 188];
        if (x > left && x < left + 190 && y > 24) {
          const wood = mix([118, 84, 52], [92, 64, 38], (x - left) / 190);
          const handle = Math.hypot(x - (left + 160), y - 160) < 9;
          const scratch = distToSegment(x, y, left + 140, 140, left + 178, 188) < 1.8;
          if (handle) return [206, 178, 90];
          if (scratch) return [214, 190, 150];
          return [wood[0] + n, wood[1] + n, wood[2] + n];
        }
        return [wall[0] + n, wall[1] + n, wall[2] + n];
      });
    }
    case 'Limpieza': {
      const dirt = blobs(seed, 4);
      return encodePng((x, y) => {
        const grout = x % 60 < 3 || y % 60 < 3;
        let base: Rgb = grout ? [150, 148, 142] : [214, 210, 200];
        let k = 0;
        for (const s of dirt) k = Math.max(k, 1 - Math.hypot(x - s.x, y - s.y) / (s.r * 0.8));
        base = mix(base, [96, 84, 62], Math.max(0, k) * 0.75);
        const n = grain(x, y, seed);
        return [base[0] + n, base[1] + n, base[2] + n];
      });
    }
    case 'Ruido': {
      const cx = WIDTH / 2;
      const cy = HEIGHT / 2;
      return encodePng((x, y) => {
        const d = Math.hypot(x - cx, y - cy);
        const ring = Math.abs(((d + seed * 7) % 38) - 19) < 3 && d > 20;
        const base = mix([34, 52, 84], [18, 28, 50], y / HEIGHT);
        const n = grain(x, y, seed);
        return ring ? [112 + n, 160 + n, 214 + n] : [base[0] + n, base[1] + n, base[2] + n];
      });
    }
    default: {
      return encodePng((x, y) => {
        const n = grain(x, y, seed);
        const stripe = Math.floor((x + seed * 13) / 24) % 2 === 0;
        const base = mix(stripe ? [96, 132, 92] : [82, 116, 80], [60, 88, 58], y / HEIGHT);
        return [base[0] + n, base[1] + n, base[2] + n];
      });
    }
  }
}
