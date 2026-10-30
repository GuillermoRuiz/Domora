import { backfillFacades } from './catastro-facade-backfill';

it('backfill secuencial, acotado, con continuidad ante errores y sin repetir fincas', async () => {
  const findMany = jest
    .fn()
    .mockResolvedValueOnce([
      { id: 'a', cadastralReference: '1907401VK4810H' },
      { id: 'b', cadastralReference: '1907401VK4810H' },
    ])
    .mockResolvedValueOnce([]);
  const refreshEstate = jest
    .fn()
    .mockRejectedValueOnce(new Error('db'))
    .mockResolvedValueOnce(null);
  const log = jest.fn();
  const result = await backfillFacades(
    { estate: { findMany } } as never,
    { refreshEstate },
    { limit: 3, retry: false, log },
  );
  expect(result).toEqual({ processed: 2, photos: 0, errors: 1 });
  expect(refreshEstate.mock.calls.map((call) => call[0])).toEqual(['a', 'b']);
  expect(findMany.mock.calls[1][0].where.id).toEqual({ gt: 'b' });
  expect(findMany.mock.calls[0][0].where.catastroFacadeResolvedAt).toBeNull();
});
