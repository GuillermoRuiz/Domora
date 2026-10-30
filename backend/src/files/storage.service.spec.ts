import type { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { BadRequestException } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * `STORAGE_DIR=""` (cadena vacía, no ausente) es exactamente el valor que
 * tenía el `.env` de desarrollo cuando se descubrió el bug: todos los
 * ficheros de la app —documentos, facturas de proveedor, justificantes de
 * pago— llevaban aterrizando en el directorio de trabajo del proceso en vez
 * de en `storage/`, porque `?? fallback` no cubre cadenas vacías. En un
 * contenedor con filesystem efímero eso es pérdida de datos garantizada en
 * cada redeploy.
 */
describe('StorageService — resolución de STORAGE_DIR', () => {
  function service(storageDir: string | undefined): StorageService {
    const config = {
      get: (key: string) => (key === 'STORAGE_DIR' ? storageDir : undefined),
    } as unknown as ConfigService;
    return new StorageService(config);
  }

  let testRoot: string;
  let cwdRoot: string;
  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'domora-storage-test-'));
    jest.spyOn(process, 'cwd').mockReturnValue(testRoot);
    cwdRoot = path.join(testRoot, 'storage');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (
      !path
        .resolve(testRoot)
        .startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(testRoot).startsWith('domora-storage-test-')
    ) {
      throw new Error('Unsafe test cleanup path');
    }
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('usa <cwd>/storage cuando STORAGE_DIR está vacía (no undefined)', async () => {
    const s = service('');
    const key = await s.put('test-empty', 'f.txt', Buffer.from('x'));
    const written = path.join(cwdRoot, key);
    await expect(fs.access(written)).resolves.toBeUndefined();
  });

  it('usa <cwd>/storage cuando STORAGE_DIR son solo espacios', async () => {
    const s = service('   ');
    const key = await s.put('test-blank', 'f.txt', Buffer.from('x'));
    const written = path.join(cwdRoot, key);
    await expect(fs.access(written)).resolves.toBeUndefined();
  });

  it('usa <cwd>/storage cuando STORAGE_DIR no está definida', async () => {
    const s = service(undefined);
    const key = await s.put('test-undefined', 'f.txt', Buffer.from('x'));
    const written = path.join(cwdRoot, key);
    await expect(fs.access(written)).resolves.toBeUndefined();
  });

  it('respeta un STORAGE_DIR explícito no vacío', async () => {
    const custom = path.join(process.cwd(), '.tmp-storage-test');
    try {
      const s = service(custom);
      const key = await s.put('test-custom', 'f.txt', Buffer.from('x'));
      await expect(fs.access(path.join(custom, key))).resolves.toBeUndefined();
      // Y NO en el fallback, para dejar clara la diferencia.
      await expect(fs.access(path.join(cwdRoot, key))).rejects.toThrow();
    } finally {
      await fs.rm(custom, { recursive: true, force: true });
    }
  });

  it('rejects sibling-root traversal, absolute paths and another community before reading', async () => {
    const storage = service(undefined);
    for (const key of [
      '../storage-secret/file.pdf',
      'documents/../file.pdf',
      '..\\storage-secret\\file.pdf',
      path.resolve(testRoot, 'outside.pdf'),
    ]) {
      await expect(storage.get(key)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(() =>
      storage.assertDocumentKey(
        'documents/community-b/file.pdf',
        'community-a',
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      storage.assertDocumentKey(
        'documents/community-a/file.pdf',
        'community-a',
      ),
    ).not.toThrow();
  });
});
