import { GoneException } from '@nestjs/common';
import { EstatesController } from './estates.controller';

describe('GET /estates/search (bloqueado)', () => {
  it('responde 410 sin consultar nada: el catálogo de todas las fincas ya no se expone', () => {
    const estatesService = {};
    const ctrl = new EstatesController(
      estatesService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(() => ctrl.search()).toThrow(GoneException);
  });
});
