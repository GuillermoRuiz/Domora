import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'node:crypto';
import {
  MarkOwnerDocumentsReadDto,
  OwnerDocumentsQueryDto,
} from './dto/owner-documents.dto';

const errors = <T extends object>(cls: new () => T, plain: object) =>
  validateSync(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((e) => e.property);

describe('GET /me/documents query validation', () => {
  it('accepts every documented filter', () => {
    const query = plainToInstance(OwnerDocumentsQueryDto, {
      propertyId: randomUUID(),
      q: 'acta',
      category: 'economicos',
      from: '2026-01-01',
      to: '2026-12-31',
      fileType: 'spreadsheet',
      onlyNew: 'true',
      sort: 'size_desc',
    });
    expect(validateSync(query)).toEqual([]);
    expect(query.onlyNew).toBe(true);
    expect(
      plainToInstance(OwnerDocumentsQueryDto, { onlyNew: 'false' }).onlyNew,
    ).toBe(false);
  });

  it.each([
    [{ propertyId: 'abc' }, 'propertyId'],
    [{ q: 'x'.repeat(101) }, 'q'],
    [{ category: 'interno' }, 'category'],
    [{ from: '2026-13-01' }, 'from'],
    [{ to: '01/02/2026' }, 'to'],
    [{ fileType: 'exe' }, 'fileType'],
    [{ onlyNew: 'yes' }, 'onlyNew'],
    [{ sort: 'random' }, 'sort'],
    [{ folderId: randomUUID() }, 'folderId'],
  ])('rejects %p', (plain, property) => {
    expect(errors(OwnerDocumentsQueryDto, plain)).toEqual([property]);
  });
});

describe('POST /me/documents/read body validation', () => {
  it('accepts up to 200 document ids', () => {
    expect(
      errors(MarkOwnerDocumentsReadDto, {
        documentIds: Array.from({ length: 200 }, () => randomUUID()),
      }),
    ).toEqual([]);
  });

  it('rejects more than 200 ids, non-uuid ids and a missing list', () => {
    expect(
      errors(MarkOwnerDocumentsReadDto, {
        documentIds: Array.from({ length: 201 }, () => randomUUID()),
      }),
    ).toEqual(['documentIds']);
    expect(errors(MarkOwnerDocumentsReadDto, { documentIds: ['abc'] })).toEqual(
      ['documentIds'],
    );
    expect(errors(MarkOwnerDocumentsReadDto, {})).toEqual(['documentIds']);
  });
});
