import { buildQrUrl, QR_ERROR_CORRECTION, QR_SIZE_MM } from './verifactu-qr';

const INVOICE = {
  issuerTaxId: 'B12345678',
  invoiceNo: 'DOM-2026-0001',
  issueDate: new Date('2026-08-08T00:00:00Z'),
  total: '132.68',
};

describe('QR de cotejo', () => {
  it('apunta al servicio de cotejo de la AEAT', () => {
    expect(buildQrUrl(INVOICE)).toContain('/ValidarQR?');
  });

  it('lleva los cuatro parámetros de la norma', () => {
    const url = new URL(buildQrUrl(INVOICE));
    expect(url.searchParams.get('nif')).toBe('B12345678');
    expect(url.searchParams.get('numserie')).toBe('DOM-2026-0001');
    expect(url.searchParams.get('fecha')).toBe('08-08-2026');
    expect(url.searchParams.get('importe')).toBe('132.68');
  });

  it('escapa el número de factura, que admite barras', () => {
    // "F-5730/2026" sin escapar partiría la query string.
    const url = buildQrUrl({ ...INVOICE, invoiceNo: 'F-5730/2026' });
    expect(url).toContain('numserie=F-5730%2F2026');
    expect(new URL(url).searchParams.get('numserie')).toBe('F-5730/2026');
  });

  it('usa la fecha en dd-mm-aaaa, no en ISO', () => {
    const url = new URL(
      buildQrUrl({ ...INVOICE, issueDate: new Date('2026-01-05T00:00:00Z') }),
    );
    expect(url.searchParams.get('fecha')).toBe('05-01-2026');
  });

  it('mantiene los parámetros de impresión que fija la norma', () => {
    // Corrección M (~15%) y lado entre 30 y 40 mm.
    expect(QR_ERROR_CORRECTION).toBe('M');
    expect(QR_SIZE_MM).toBeGreaterThanOrEqual(30);
    expect(QR_SIZE_MM).toBeLessThanOrEqual(40);
  });
});
