import { loadTestDatabaseConfig } from '../dist/packages/database/src/config.js';

export function loadExplicitDatabaseConfig(
  env = process.env,
  target = env.DATABASE_URL,
) {
  if (typeof target !== 'string' || !target.trim()) {
    throw new Error(
      'An explicit DATABASE_URL is required; no database defaults are permitted.',
    );
  }
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error('DATABASE_URL is invalid.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  ) {
    throw new Error(
      'DATABASE_URL must identify a PostgreSQL host and database.',
    );
  }
  return {
    connectionString: target,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  };
}

export function loadConfirmedTestConfig(env = process.env) {
  return loadTestDatabaseConfig(env);
}

export function loadQaEndpoint(value) {
  if (!value) throw new Error('An explicit isolated QA endpoint is required.');
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    [
      '3000',
      '3001',
      '3002',
      '3004',
      '3005',
      '3007',
      '3008',
      '3017',
      '3018',
      '3027',
      '3028',
      '55432',
    ].includes(url.port)
  )
    throw new Error('Operational or nonlocal QA endpoint refused.');
  return value;
}

export function loadQaSecret(key, env = process.env) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim())
    throw new Error(
      `Explicit ${key} is required; no credential defaults are permitted.`,
    );
  return value;
}
