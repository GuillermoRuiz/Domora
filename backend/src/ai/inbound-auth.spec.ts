import { createHmac } from 'node:crypto';
import { verifyInbound } from './inbound-auth';
const secret = 's'.repeat(32),
  raw = Buffer.from('{"eventId":"email-1"}'),
  timestamp = '1791028800';
const signature =
  'sha256=' +
  createHmac('sha256', secret)
    .update(timestamp + '.')
    .update(raw)
    .digest('hex');
describe('Inbound email HMAC', () => {
  it('verifies exact bytes and timestamp', () =>
    expect(
      verifyInbound(
        raw,
        timestamp,
        signature,
        secret,
        Number(timestamp) * 1000,
      ),
    ).toBe(true));
  it('rejects replay outside the five minute window', () =>
    expect(
      verifyInbound(
        raw,
        timestamp,
        signature,
        secret,
        Number(timestamp) * 1000 + 300001,
      ),
    ).toBe(false));
  it('rejects altered raw content', () =>
    expect(
      verifyInbound(
        Buffer.from('{}'),
        timestamp,
        signature,
        secret,
        Number(timestamp) * 1000,
      ),
    ).toBe(false));
  it('rejects short or unset secrets', () =>
    expect(
      verifyInbound(raw, timestamp, signature, '', Number(timestamp) * 1000),
    ).toBe(false));
});
