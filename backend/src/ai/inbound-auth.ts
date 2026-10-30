import { createHmac, timingSafeEqual } from 'node:crypto';
export function verifyInbound(
  raw: Buffer | undefined,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  if (
    !raw ||
    secret.length < 32 ||
    !timestamp ||
    !/^\d{10}$/.test(timestamp) ||
    !signature ||
    !/^sha256=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  if (Math.abs(now - Number(timestamp) * 1000) > 300000) return false;
  const expected = createHmac('sha256', secret)
    .update(timestamp + '.')
    .update(raw)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}
