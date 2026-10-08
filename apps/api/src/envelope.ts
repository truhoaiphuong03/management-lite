import type http from 'node:http';

export interface SuccessEnvelope<T = unknown> {
  success: true;
  data: T;
  meta: {
    request_id: string;
  };
}

export interface ErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details: ErrorDetail[];
  };
  meta: {
    request_id: string;
  };
}

export function createSuccessEnvelope<T>(
  data: T,
  requestId: string,
): SuccessEnvelope<T> {
  return {
    success: true,
    data,
    meta: {
      request_id: requestId,
    },
  };
}

export function createErrorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details: ErrorDetail[] = [],
): ErrorEnvelope {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      request_id: requestId,
    },
  };
}

export function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: SuccessEnvelope | ErrorEnvelope,
  headers: Record<string, string | string[]> = {},
): void {
  const json = JSON.stringify(body);
  const responseHeaders: http.OutgoingHttpHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'X-Request-Id': body.meta.request_id,
    ...headers,
  };
  res.writeHead(statusCode, responseHeaders);
  res.end(json);
}
