import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  resolvePage,
  toPage,
} from './pagination';

describe('resolvePage', () => {
  it('usa valores por defecto sin parámetros', () => {
    expect(resolvePage()).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
    });
  });

  it('calcula el desplazamiento a partir de la página', () => {
    expect(resolvePage({ page: 3, pageSize: 20 })).toMatchObject({
      skip: 40,
      take: 20,
    });
  });

  // Lo importante de todo esto: el cliente no decide cuántas filas se leen.
  it('acota pageSize al máximo del servidor aunque el cliente pida más', () => {
    expect(resolvePage({ pageSize: 100_000 }).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('ignora valores no numéricos o absurdos', () => {
    expect(resolvePage({ page: NaN, pageSize: NaN }).pageSize).toBe(
      DEFAULT_PAGE_SIZE,
    );
    expect(resolvePage({ page: -5 }).page).toBe(1);
    expect(resolvePage({ pageSize: 0 }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(resolvePage({ pageSize: -10 }).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it('trunca decimales en lugar de propagarlos al skip', () => {
    expect(resolvePage({ page: 2.9, pageSize: 10.7 })).toMatchObject({
      page: 2,
      pageSize: 10,
      skip: 10,
    });
  });
});

describe('toPage', () => {
  it('devuelve el total real, no el número de elementos de la página', () => {
    const resolved = resolvePage({ page: 2, pageSize: 10 });
    expect(toPage(213, resolved, ['a', 'b'])).toEqual({
      total: 213,
      page: 2,
      pageSize: 10,
      items: ['a', 'b'],
    });
  });
});
