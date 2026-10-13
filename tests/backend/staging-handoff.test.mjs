import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateStagingEnvironment,
  resolveStaticFile,
} from '../../scripts/deployment/staging-runtime.mjs';

const fixture = () => ({
  DATABASE_URL:
    'postgresql://hp_stage_app:public-synthetic-fixture@127.0.0.1:55433/hp_stage_test',
  APPROVED_STAGING_DATABASE_NAME: 'hp_stage_test',
  NODE_ENV: 'staging',
  HOST: '127.0.0.1',
  PORT: '3202',
  CSRF_SECRET: 'public-synthetic-csrf-fixture-32-bytes-long',
  ACCOUNT_SECRET_KEY: 'public-synthetic-fixture-not-used-to-encrypt',
});

test('staging startup accepts only explicit binding; does not mutate supplied keys', () => {
  const env = fixture();
  const before = JSON.stringify(env);
  validateStagingEnvironment(env);
  assert.equal(JSON.stringify(env), before);
});
test('staging startup rejects missing database and operational destinations', () => {
  for (const url of [
    undefined,
    '',
    'not-a-url',
    fixture().DATABASE_URL.replace('55433', '5432'),
    fixture().DATABASE_URL.replace('127.0.0.1', 'db.example.invalid'),
    fixture().DATABASE_URL.replace('hp_stage_app:', 'hp_stage_db:'),
    fixture().DATABASE_URL.replace('/hp_stage_test', '/management_lite'),
    fixture().DATABASE_URL.replace('postgresql:', 'https:'),
  ])
    assert.throws(() =>
      validateStagingEnvironment({ ...fixture(), DATABASE_URL: url }),
    );
});
test('staging startup rejects production mode, public bind, wrong ports and missing keys', () => {
  for (const override of [
    { NODE_ENV: 'production' },
    { HOST: '0.0.0.0' },
    { PORT: '3002' },
    { CSRF_SECRET: undefined },
    { CSRF_SECRET: 'x'.repeat(32) },
    { ACCOUNT_SECRET_KEY: undefined },
    { APPROVED_STAGING_DATABASE_NAME: undefined },
    { FIN_RECEIPT_DIR: 'C:\\Production\\receipts' },
  ])
    assert.throws(() =>
      validateStagingEnvironment({ ...fixture(), ...override }),
    );
  validateStagingEnvironment({
    ...fixture(),
    FIN_RECEIPT_DIR: 'C:\\HoaiPhuong-Staging\\shared\\receipts\\qa',
  });
});
test('static Web serves SPA routes and blocks hidden files, traversal and missing assets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-stage-static-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), 'synthetic');
    fs.writeFileSync(path.join(root, 'app.js'), 'synthetic');
    assert.equal(
      resolveStaticFile(root, '/settings'),
      path.join(root, 'index.html'),
    );
    assert.equal(resolveStaticFile(root, '/app.js'), path.join(root, 'app.js'));
    for (const request of [
      '/.env',
      '/%2eenv',
      '/%2e%2e%2f.env',
      '/%5c..%5c.env',
      '/missing.js',
      '/%00',
      '/%zz',
    ])
      assert.equal(resolveStaticFile(root, request), null, request);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
