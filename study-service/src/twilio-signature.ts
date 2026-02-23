import { webcrypto as nodeWebCrypto } from 'node:crypto';

const cryptoApi: Crypto = (globalThis.crypto ?? (nodeWebCrypto as unknown as Crypto));

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

export async function verifyTwilioWebhookSignature(input: {
  authToken: string;
  signature: string;
  url: string;
  params: Record<string, string>;
}): Promise<boolean> {
  const sortedKeys = Object.keys(input.params).sort((a, b) => a.localeCompare(b));
  let payload = input.url;
  for (const key of sortedKeys) {
    payload += `${key}${input.params[key]}`;
  }

  const hmacKey = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const signatureBuffer = await cryptoApi.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(payload));
  const expected = toBase64(new Uint8Array(signatureBuffer));
  return timingSafeEqual(expected, input.signature);
}
