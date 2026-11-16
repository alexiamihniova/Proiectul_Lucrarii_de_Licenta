import { createHmac } from 'node:crypto';

/**
 * Builds and reads session tokens by hand, from the format in docs/design/auth.md (2.2), with
 * nothing but node:crypto. The tests therefore check the FORMAT, whatever JWT library the
 * implementation uses.
 */

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

export interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  signingInput: string;
}

export function decodeJwt(token: string): JwtParts {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error(`not a JWT: expected 3 parts, got ${parts.length}`);
  const [header, payload, signature] = parts as [string, string, string];
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    signature,
    signingInput: `${header}.${payload}`,
  };
}

export function hs256(signingInput: string, secret: string): string {
  return createHmac('sha256', secret).update(signingInput).digest('base64url');
}

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string {
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const algorithm = header.alg === 'HS512' ? 'sha512' : 'sha256';
  const signature =
    header.alg === 'none'
      ? ''
      : createHmac(algorithm, secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

/** Design 2.2: base64url(first 16 bytes of HMAC-SHA256(secret, "recap:pfp:v1:" + hash)). */
export function passwordFingerprint(secret: string, passwordHash: string): string {
  return createHmac('sha256', secret)
    .update(`recap:pfp:v1:${passwordHash}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
