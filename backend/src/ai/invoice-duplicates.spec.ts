/* eslint-disable @typescript-eslint/no-explicit-any */
import { existingInvoiceIds } from './invoice-duplicates';
describe('Invoice duplicate evidence', () => {
  it('does not guess a duplicate when tax ID or number is unknown', async () => {
    const db: any = { supplierInvoice: { findMany: jest.fn() } };
    expect(
      await existingInvoiceIds(db, 'e1', {
        supplier_tax_id: null,
        invoice_number: 'F1',
      } as any),
    ).toEqual([]);
    expect(db.supplierInvoice.findMany).not.toHaveBeenCalled();
  });
  it('uses the same estate, supplier tax ID and exact invoice number', async () => {
    const db: any = {
      supplierInvoice: {
        findMany: jest.fn().mockResolvedValue([{ id: 'existing' }]),
      },
    };
    expect(
      await existingInvoiceIds(db, 'e1', {
        supplier_tax_id: 'B12345678',
        invoice_number: 'F1',
      } as any),
    ).toEqual(['existing']);
    const query = db.supplierInvoice.findMany.mock.calls[0][0];
    expect(query.where.estateId).toBe('e1');
    expect(query.where.supplier.estateId).toBe('e1');
    expect(query.where.number).toBe('F1');
    expect(query.where.cancelledAt).toBeNull();
  });
});
