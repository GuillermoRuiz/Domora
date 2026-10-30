import { validateSupplierInvoiceRow } from './supplier-invoice-import.validator';

describe('validateSupplierInvoiceRow', () => {
  it('acepta una fila completa y válida', () => {
    const result = validateSupplierInvoiceRow(
      {
        supplierName: 'Ascensores García SL',
        number: 'F-2024-0091',
        concept: 'Mantenimiento ascensor',
        issueDate: '15/11/2024',
        dueDate: '15/12/2024',
        amount: '245,50',
      },
      2,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      supplierName: 'Ascensores García SL',
      number: 'F-2024-0091',
      amount: 245.5,
    });
    expect(result.data?.issueDate.toISOString().slice(0, 10)).toBe(
      '2024-11-15',
    );
  });

  it('sin fecha de vencimiento: válida igual (es opcional)', () => {
    const result = validateSupplierInvoiceRow(
      {
        supplierName: 'x',
        number: 'F-1',
        concept: 'x',
        issueDate: '2024-11-15',
        amount: '10',
      },
      2,
    );
    expect(result.ok).toBe(true);
    expect(result.data?.dueDate).toBeUndefined();
  });

  it('falta cualquier campo obligatorio: bloquea con un error por campo', () => {
    const result = validateSupplierInvoiceRow({}, 2);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(5);
  });

  it('fecha de factura inválida: bloquea', () => {
    const result = validateSupplierInvoiceRow(
      {
        supplierName: 'x',
        number: 'F-1',
        concept: 'x',
        issueDate: '32/13/2024',
        amount: '10',
      },
      2,
    );
    expect(result.ok).toBe(false);
  });

  it('importe cero o negativo: bloquea', () => {
    expect(
      validateSupplierInvoiceRow(
        {
          supplierName: 'x',
          number: 'F-1',
          concept: 'x',
          issueDate: '2024-11-15',
          amount: '0',
        },
        2,
      ).ok,
    ).toBe(false);
  });
});
