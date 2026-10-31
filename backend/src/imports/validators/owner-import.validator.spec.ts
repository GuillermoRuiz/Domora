import { validateOwnerRow } from './owner-import.validator';

describe('validateOwnerRow', () => {
  it('acepta una fila completa y válida', () => {
    const result = validateOwnerRow(
      {
        fullName: 'María García',
        propertyRef: 'A-101',
        taxId: '12345678Z',
        email: 'maria@example.com',
        phone: '600111222',
        postalAddress: 'Calle Mayor 1',
      },
      2,
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.data).toEqual({
      fullName: 'María García',
      propertyRef: 'A-101',
      taxId: '12345678Z',
      email: 'maria@example.com',
      phone: '600111222',
      postalAddress: 'Calle Mayor 1',
    });
  });

  it('sin nombre: bloquea con error', () => {
    const result = validateOwnerRow({ propertyRef: 'A-101' }, 2);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Falta el nombre del propietario.');
  });

  it('sin referencia de unidad: bloquea con error (no hay a qué vincular el propietario)', () => {
    const result = validateOwnerRow({ fullName: 'María García' }, 2);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes('referencia de la unidad')),
    ).toBe(true);
  });

  it('reporta AMBOS errores a la vez si faltan nombre y referencia', () => {
    const result = validateOwnerRow({}, 2);
    expect(result.errors).toHaveLength(2);
  });

  it('email con formato dudoso: avisa pero no bloquea', () => {
    const result = validateOwnerRow(
      {
        fullName: 'María García',
        propertyRef: 'A-101',
        email: 'no-es-un-email',
      },
      2,
    );
    expect(result.ok).toBe(true);
    expect(
      result.warnings.some((w) => w.includes('Email con formato dudoso')),
    ).toBe(true);
  });

  it('campos opcionales ausentes quedan undefined, no cadena vacía', () => {
    const result = validateOwnerRow(
      { fullName: 'María García', propertyRef: 'A-101' },
      2,
    );
    expect(result.data?.taxId).toBeUndefined();
    expect(result.data?.email).toBeUndefined();
    expect(result.data?.phone).toBeUndefined();
    expect(result.data?.postalAddress).toBeUndefined();
  });
});
