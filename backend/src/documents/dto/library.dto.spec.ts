import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LibraryQueryDto } from './library.dto';

describe('LibraryQueryDto', () => {
  const errors = async (query: Record<string, unknown>) =>
    validate(plainToInstance(LibraryQueryDto, query));

  it('accepts the root and a folder id', async () => {
    expect(await errors({ folderId: 'root' })).toHaveLength(0);
    expect(
      await errors({ folderId: '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' }),
    ).toHaveLength(0);
    expect(await errors({})).toHaveLength(0);
  });

  it('rejects a malformed folder id with a 400-style error instead of reaching the database', async () => {
    const result = await errors({ folderId: 'not-a-folder' });
    expect(result).toHaveLength(1);
    expect(Object.values(result[0]!.constraints ?? {})).toContain(
      'Carpeta no válida.',
    );
  });
});
