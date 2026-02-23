import type { IdempotencyRecord, IdempotencyStore } from './types';
import { webcrypto as nodeWebCrypto } from 'node:crypto';

const cryptoApi: Crypto = (globalThis.crypto ?? (nodeWebCrypto as unknown as Crypto));

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await cryptoApi.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export class D1IdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: D1Database) {}

  async get(idempotencyKey: string, endpoint: string): Promise<IdempotencyRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT request_hash, status_code, response_json
         FROM idempotency_record
         WHERE idempotency_key = ?1
           AND endpoint = ?2
         LIMIT 1`,
      )
      .bind(idempotencyKey, endpoint)
      .first<{ request_hash: string; status_code: number; response_json: string }>();

    if (!row) {
      return null;
    }

    return {
      requestHash: row.request_hash,
      statusCode: row.status_code,
      responseJson: row.response_json,
    };
  }

  async put(input: {
    idempotencyKey: string;
    endpoint: string;
    requestHash: string;
    statusCode: number;
    responseJson: string;
    nowIso: string;
    ttlSeconds: number;
  }): Promise<void> {
    const expiresAt = new Date(Date.parse(input.nowIso) + input.ttlSeconds * 1000).toISOString();

    await this.db
      .prepare(
        `INSERT INTO idempotency_record
           (idempotency_key, endpoint, request_hash, status_code, response_json, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(idempotency_key, endpoint) DO UPDATE SET
           request_hash = excluded.request_hash,
           status_code = excluded.status_code,
           response_json = excluded.response_json,
           expires_at = excluded.expires_at`,
      )
      .bind(
        input.idempotencyKey,
        input.endpoint,
        input.requestHash,
        input.statusCode,
        input.responseJson,
        input.nowIso,
        expiresAt,
      )
      .run();
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  private key(idempotencyKey: string, endpoint: string): string {
    return `${endpoint}::${idempotencyKey}`;
  }

  async get(idempotencyKey: string, endpoint: string): Promise<IdempotencyRecord | null> {
    return this.records.get(this.key(idempotencyKey, endpoint)) ?? null;
  }

  async put(input: {
    idempotencyKey: string;
    endpoint: string;
    requestHash: string;
    statusCode: number;
    responseJson: string;
    nowIso: string;
    ttlSeconds: number;
  }): Promise<void> {
    this.records.set(this.key(input.idempotencyKey, input.endpoint), {
      requestHash: input.requestHash,
      statusCode: input.statusCode,
      responseJson: input.responseJson,
    });
  }
}
