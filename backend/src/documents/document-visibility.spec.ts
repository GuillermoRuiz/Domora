import {
  documentEffectiveVisibility,
  folderVisibilities,
  managerOnlyFolderIds,
  staleEffectiveVisibilities,
  wouldCreateCycle,
  type FolderNode,
} from './document-visibility';

const folders: FolderNode[] = [
  { id: 'legal', parentId: null, visibility: 'OWNERS' },
  { id: 'legal/old', parentId: 'legal', visibility: null },
  { id: 'legal/old/private', parentId: 'legal/old', visibility: 'MANAGER' },
  {
    id: 'legal/old/private/x',
    parentId: 'legal/old/private',
    visibility: null,
  },
  { id: 'board', parentId: null, visibility: 'BOARD' },
  { id: 'loose', parentId: null, visibility: null },
];

describe('document visibility', () => {
  it('a folder inherits from its nearest ancestor with a value; a root without value is «Solo gestora»', () => {
    const v = folderVisibilities(folders);
    expect(Object.fromEntries(v)).toEqual({
      legal: 'OWNERS',
      'legal/old': 'OWNERS',
      'legal/old/private': 'MANAGER',
      'legal/old/private/x': 'MANAGER',
      board: 'BOARD',
      loose: 'MANAGER',
    });
  });

  it('a document keeps its own visibility; otherwise inherits its folder; at the library root it is «Solo gestora»', () => {
    const v = folderVisibilities(folders);
    expect(
      documentEffectiveVisibility(
        { folderId: 'legal/old', visibility: null },
        v,
      ),
    ).toBe('OWNERS');
    expect(
      documentEffectiveVisibility(
        { folderId: 'legal/old', visibility: 'MANAGER' },
        v,
      ),
    ).toBe('MANAGER');
    expect(
      documentEffectiveVisibility(
        { folderId: 'board', visibility: 'PROPERTY' },
        v,
      ),
    ).toBe('PROPERTY');
    expect(
      documentEffectiveVisibility({ folderId: null, visibility: null }, v),
    ).toBe('MANAGER');
    expect(
      documentEffectiveVisibility({ folderId: 'missing', visibility: null }, v),
    ).toBe('MANAGER');
  });

  it('reports only the documents whose stored effective visibility is out of date', () => {
    const stale = staleEffectiveVisibilities(
      [
        {
          id: 'a',
          folderId: 'legal',
          visibility: null,
          effectiveVisibility: 'OWNERS',
        },
        {
          id: 'b',
          folderId: 'legal/old/private/x',
          visibility: null,
          effectiveVisibility: 'OWNERS',
        },
        {
          id: 'c',
          folderId: 'board',
          visibility: null,
          effectiveVisibility: 'MANAGER',
        },
      ],
      folders,
    );
    expect(Object.fromEntries(stale)).toEqual({ MANAGER: ['b'], BOARD: ['c'] });
  });

  it('a corrupted cycle resolves to «Solo gestora» instead of looping', () => {
    const v = folderVisibilities([
      { id: 'p', parentId: 'q', visibility: null },
      { id: 'q', parentId: 'p', visibility: null },
    ]);
    expect(v.get('p')).toBe('MANAGER');
  });

  describe('«Interno de la gestora» is always «Solo gestora» (G2)', () => {
    const tree: FolderNode[] = [
      {
        id: 'interno',
        parentId: null,
        visibility: 'OWNERS',
        systemKey: 'interno',
      },
      { id: 'interno/rrhh', parentId: 'interno', visibility: 'BOARD' },
      { id: 'interno/rrhh/2026', parentId: 'interno/rrhh', visibility: null },
      { id: 'legal', parentId: null, visibility: 'OWNERS', systemKey: 'legal' },
      { id: 'legal/sub', parentId: 'legal', visibility: null },
    ];

    it('the interno folder and every folder under it are manager-only, whatever they store', () => {
      expect([...managerOnlyFolderIds(tree)].sort()).toEqual([
        'interno',
        'interno/rrhh',
        'interno/rrhh/2026',
      ]);
      expect(Object.fromEntries(folderVisibilities(tree))).toEqual({
        interno: 'MANAGER',
        'interno/rrhh': 'MANAGER',
        'interno/rrhh/2026': 'MANAGER',
        legal: 'OWNERS',
        'legal/sub': 'OWNERS',
      });
    });

    it('a document under interno is «Solo gestora» even with its own wider visibility', () => {
      const stale = staleEffectiveVisibilities(
        [
          {
            id: 'own-owners',
            folderId: 'interno/rrhh/2026',
            visibility: 'OWNERS',
            effectiveVisibility: 'OWNERS',
          },
          {
            id: 'own-property',
            folderId: 'interno',
            visibility: 'PROPERTY',
            effectiveVisibility: 'PROPERTY',
          },
          {
            id: 'outside',
            folderId: 'legal/sub',
            visibility: null,
            effectiveVisibility: 'MANAGER',
          },
        ],
        tree,
      );
      expect(Object.fromEntries(stale)).toEqual({
        MANAGER: ['own-owners', 'own-property'],
        OWNERS: ['outside'],
      });
      expect(
        documentEffectiveVisibility(
          { folderId: 'interno/rrhh', visibility: 'BOARD' },
          folderVisibilities(tree),
          managerOnlyFolderIds(tree),
        ),
      ).toBe('MANAGER');
    });

    it('a manager root folder that happens to be called like it is not locked: only the system key counts', () => {
      expect(
        managerOnlyFolderIds([
          { id: 'x', parentId: null, visibility: 'OWNERS', systemKey: null },
        ]).size,
      ).toBe(0);
    });
  });

  it('detects moves that would put a folder inside itself or its descendants', () => {
    expect(wouldCreateCycle('legal', 'legal', folders)).toBe(true);
    expect(wouldCreateCycle('legal', 'legal/old/private', folders)).toBe(true);
    expect(wouldCreateCycle('legal/old', 'board', folders)).toBe(false);
    expect(wouldCreateCycle('legal/old', null, folders)).toBe(false);
  });
});
