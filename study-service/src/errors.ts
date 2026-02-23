import type { Context } from 'hono';

export const DEFAULT_SCHEMA_VERSION = '1.0.0';

export function schemaVersion(c: Context): string {
  return c.env.SCHEMA_VERSION || DEFAULT_SCHEMA_VERSION;
}

export function jsonError(
  c: Context,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  const payload: Record<string, unknown> = {
    schema_version: schemaVersion(c),
    error: {
      code,
      message,
    },
  };

  if (details && Object.keys(details).length > 0) {
    (payload.error as Record<string, unknown>).details = details;
  }

  return jsonResponse(payload, status);
}

export function jsonResponse(payload: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
