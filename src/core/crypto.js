import crypto from 'node:crypto';

// AES-256-GCM helpers for OAuth tokens and provider secrets stored at rest.
export function createCipher(KEY) {
  const enc = s => {
    const iv = crypto.randomBytes(12),
      c = crypto.createCipheriv('aes-256-gcm', KEY, iv),
      b = Buffer.concat([c.update(s, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), b]).toString('base64');
  };
  const dec = s => {
    const b = Buffer.from(s, 'base64'),
      d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString();
  };
  return { enc, dec };
}
