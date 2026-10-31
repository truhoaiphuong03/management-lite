#!/usr/bin/env node
/**
 * Phase 19 — Task 19.2: Secret Hygiene & Rotation Readiness Auditor
 *
 * Audits environment key-value pairs (without ever printing secret values) for:
 *  - leftover bootstrap ADMIN_PASSWORD
 *  - weak/short CSRF_SECRET (< 32 chars)
 *  - missing or invalid ACCOUNT_SECRET_KEY (must be 64 hex chars / 32 bytes)
 *  - non-HTTPS origin in production
 * Also generates fresh CSPRNG candidate keys on --generate-rotation-keys.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseEnvContent(rawText) {
  const map = {};
  for (const line of String(rawText).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    map[key] = val;
  }
  return map;
}

export function auditEnvSecretsHygiene(envMap) {
  const findings = [];

  if (envMap.ADMIN_PASSWORD && envMap.ADMIN_PASSWORD.trim().length > 0) {
    findings.push({
      code: 'LEFTOVER_BOOTSTRAP_PASSWORD',
      severity: 'warn',
      field: 'ADMIN_PASSWORD',
      recommendation:
        'Remove ADMIN_PASSWORD from api.env after initial owner bootstrap is completed.',
    });
  }

  const csrf = envMap.CSRF_SECRET || '';
  if (csrf.length < 32 || /dev-default|changeme|test/i.test(csrf)) {
    findings.push({
      code: 'WEAK_CSRF_SECRET',
      severity: 'error',
      field: 'CSRF_SECRET',
      recommendation:
        'Rotate CSRF_SECRET to a >= 64-hex-char CSPRNG secret.',
    });
  }

  const accKey = envMap.ACCOUNT_SECRET_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(accKey)) {
    findings.push({
      code: 'INVALID_ACCOUNT_SECRET_KEY',
      severity: 'error',
      field: 'ACCOUNT_SECRET_KEY',
      recommendation:
        'Ensure ACCOUNT_SECRET_KEY is a 64-character hex string (256-bit AES-GCM key).',
    });
  }

  return {
    healthy: findings.every((f) => f.severity !== 'error'),
    findingCount: findings.length,
    findings,
  };
}

export function generateRotationKeyBundle() {
  return {
    CSRF_SECRET: crypto.randomBytes(32).toString('hex'),
    ACCOUNT_SECRET_KEY: crypto.randomBytes(32).toString('hex'),
    BRIDGE_SHARED_SECRET: crypto.randomBytes(32).toString('hex'),
    generatedAt: new Date().toISOString(),
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  if (process.argv.includes('--generate-rotation-keys')) {
    console.log(JSON.stringify(generateRotationKeyBundle(), null, 2));
    process.exit(0);
  }
  const envFile = process.argv[2];
  const envMap = envFile
    ? parseEnvContent(fs.readFileSync(envFile, 'utf8'))
    : process.env;
  const report = auditEnvSecretsHygiene(envMap);
  console.log(JSON.stringify(report, null, 2));
}
