import { Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/**
 * Cifrado de IBAN en reposo, en un módulo propio para que lo usen tanto
 * SEPA como la contabilidad (cuentas bancarias) sin que un módulo tenga que
 * importar al otro.
 */
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
