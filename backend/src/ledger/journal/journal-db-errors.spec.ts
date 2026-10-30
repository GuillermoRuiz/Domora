import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { parseLedgerDbError, toLedgerHttpException } from './journal-db-errors';

describe('parseLedgerDbError', () => {
  it('toma el SQLSTATE del error de Postgres, no un "DMxxx" del fragmento de código que Prisma cita', () => {
    const error = new Error(`
Invalid \`expectCode(prisma.receiptLine.deleteMany()\` invocation in
  290 await expectCode(prisma.accountingReceipt.delete({ where: { id: r.id } }), 'DM036');
Error occurred during query execution:
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "DM020", message: "Los asientos contabilizados no se pueden modificar ni borrar: registra un contraasiento.", severity: "ERROR" }) })`);
    expect(parseLedgerDbError(error)).toEqual({
      code: 'DM020',
      message:
        'Los asientos contabilizados no se pueden modificar ni borrar: registra un contraasiento.',
    });
  });

  it('reconoce el prefijo de un trigger diferido (sin SQLSTATE) y lo quita del mensaje', () => {
    const error = new Error(
      'Error in connector: Error querying the database: ERROR: DM002: El asiento 7 no cuadra: debe 10.00 y haber 9.99.',
    );
    expect(parseLedgerDbError(error)).toEqual({
      code: 'DM002',
      message: 'El asiento 7 no cuadra: debe 10.00 y haber 9.99.',
    });
  });

  it('ignora errores que no son de las garantías contables', () => {
    expect(
      parseLedgerDbError(
        new Error('Unique constraint failed on the fields: (`code`)'),
      ),
    ).toBeNull();
    expect(parseLedgerDbError('no es un error')).toBeNull();
  });
});

describe('toLedgerHttpException', () => {
  it('ejercicio cerrado, contraasiento, inmutabilidad y plan de cuentas son conflictos (409)', () => {
    for (const code of ['DM015', 'DM016', 'DM020', 'DM022']) {
      expect(
        toLedgerHttpException(
          new Error(`PostgresError { code: "${code}", message: "x" }`),
        ),
      ).toBeInstanceOf(ConflictException);
    }
  });

  it('el resto de garantías son datos no válidos (422)', () => {
    expect(
      toLedgerHttpException(
        new Error(
          'PostgresError { code: "DM006", message: "La cuenta 430 exige indicar la propiedad." }',
        ),
      ),
    ).toBeInstanceOf(UnprocessableEntityException);
  });
});
