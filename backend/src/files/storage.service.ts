import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Abstracción de almacenamiento de ficheros (Fase 12). Driver actual:
 * disco local bajo STORAGE_DIR (default backend/storage) — suficiente para
 * desarrollo y single-node. El campo persistido sigue llamándose `s3Key`
 * porque el contrato es el mismo: una clave opaca que un driver S3 real
 * (o compatible: MinIO/R2) resolverá con URLs prefirmadas cuando se
 * configure en producción; solo cambia esta clase, no los llamantes.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  private static readonly ALLOWED_MIME = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/xml',
    'text/xml',
    'text/plain',
    'text/csv',
  ]);

  static readonly MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

  constructor(configService: ConfigService) {
    // `?? fallback` NO cubre `STORAGE_DIR=""`: una cadena vacía no es
    // null/undefined, así que el operador nullish-coalescing la deja pasar
    // tal cual. El efecto real, descubierto al probar el adjunto de
    // movimientos: TODOS los ficheros de la app (documentos, facturas de
    // proveedor, justificantes de pago) llevaban aterrizando directamente en
    // el directorio de trabajo del proceso en vez de en un almacenamiento
    // dedicado — en un contenedor con filesystem efímero, eso es pérdida de
    // datos garantizada en cada redeploy.
    const configured = configService.get<string>('STORAGE_DIR')?.trim();
    this.root = configured || path.join(process.cwd(), 'storage');
  }

  /**
   * `maxBytes` es opcional y solo lo usan llamantes que necesitan un límite
   * distinto al compartido (p. ej. importación de datos, cuyos ficheros de
   * origen suelen pesar más que un documento suelto) — el límite por
   * defecto sigue siendo el mismo para el resto de módulos (documentos,
   * movimientos, facturas, personal), no se toca `MAX_SIZE_BYTES` global.
   */
  assertAllowed(
    mimetype: string,
    size: number,
    maxBytes: number = StorageService.MAX_SIZE_BYTES,
  ): void {
    if (!StorageService.ALLOWED_MIME.has(mimetype)) {
      throw new BadRequestException(
        `Tipo de fichero no permitido: ${mimetype}`,
      );
    }
    if (size > maxBytes) {
      throw new BadRequestException(
        `El fichero supera el máximo de ${Math.round(maxBytes / (1024 * 1024))} MB.`,
      );
    }
  }

  /** Guarda el contenido y devuelve la clave opaca (`s3Key`). */
  async put(
    prefix: string,
    originalName: string,
    content: Buffer,
  ): Promise<string> {
    const safeName = originalName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-100);
    const key = `${prefix}/${crypto.randomUUID()}-${safeName}`;
    const fullPath = this.filePath(key);
    // La clave la generamos nosotros (UUID) — no hay traversal posible,
    // pero se comprueba igualmente como defensa en profundidad.
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.filePath(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.filePath(key), { force: true });
  }

  assertDocumentKey(key: string, estateId: string): void {
    this.filePath(key);
    const parts = key.split('/');
    if (
      parts.length !== 3 ||
      parts[0] !== 'documents' ||
      parts[1].toLowerCase() !== estateId.toLowerCase()
    ) {
      throw new BadRequestException(
        'El fichero no pertenece a esta comunidad.',
      );
    }
  }

  private filePath(key: string): string {
    const root = path.resolve(this.root);
    if (
      path.isAbsolute(key) ||
      key.includes('\\') ||
      key.includes('\0') ||
      key.split('/').some((part) => ['', '.', '..'].includes(part))
    ) {
      throw new BadRequestException('Clave de fichero inválida.');
    }
    const target = path.resolve(root, key);
    const relative = path.relative(root, target);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new BadRequestException('Clave de fichero inválida.');
    }
    return target;
  }
}
