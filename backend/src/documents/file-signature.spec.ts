import { fileMatchesMime } from './file-signature';

const bytes = (...b: number[]) => Buffer.from([...b, ...Array(16).fill(0x20)]);

describe('fileMatchesMime', () => {
  it.each([
    ['application/pdf', Buffer.from('%PDF-1.7 ...')],
    ['image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ['image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['image/webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes(0x50, 0x4b, 0x03, 0x04)],
    ['application/vnd.ms-excel', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)],
    ['text/csv', Buffer.from('a;b\n1;2\n')],
  ])('accepts a real %s', (mime, buffer) => {
    expect(fileMatchesMime(buffer, mime)).toBe(true);
  });

  it('rejects a renamed file whose bytes do not match the declared type', () => {
    expect(fileMatchesMime(Buffer.from('<html><script>alert(1)</script>'), 'application/pdf')).toBe(false);
    expect(fileMatchesMime(Buffer.from('MZ\x90\x00 executable'), 'image/png')).toBe(false);
    expect(fileMatchesMime(Buffer.from([0x41, 0x00, 0x42]), 'text/plain')).toBe(false);
  });

  it('rejects types outside the allowed list', () => {
    expect(fileMatchesMime(Buffer.from('<svg/>'), 'image/svg+xml')).toBe(false);
  });
});
