import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrevoResetMailer } from '../../dist/apps/api/src/auth/reset-email.js';

test('Brevo HTTPS recovery: exact endpoint, secret header, fragment, accepted only on 201', async () => {
  let seen;
  const mailer = createBrevoResetMailer(
    { BREVO_API_KEY: 'test-key-never-real' },
    async (url, options) => {
      seen = { url, options };
      return new Response('{}', { status: 201 });
    },
  );
  assert.equal(
    await mailer.send('qa@example.invalid', 'a'.repeat(64)),
    'accepted',
  );
  assert.equal(seen.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(seen.options.redirect, 'error');
  assert.equal(seen.options.headers['api-key'], 'test-key-never-real');
  const payload = JSON.parse(seen.options.body);
  assert.equal(payload.sender.email, 'no-reply@hoaiphuong.click');
  assert.deepEqual(payload.to, [{ email: 'qa@example.invalid' }]);
  assert.equal(payload.htmlContent, undefined);
  assert.ok(payload.textContent.includes('/reset-password#token='));
  assert.ok(!payload.textContent.includes('/reset-password?token='));
  assert.ok(payload.textContent.includes('15 phút'));
  assert.ok(!seen.options.body.includes('test-key-never-real'));
});

test('Provider failures, redirects and exceptions stay sanitized and fail closed', async () => {
  for (const status of [200, 302, 400, 401, 403, 429, 500]) {
    const mailer = createBrevoResetMailer(
      { BREVO_API_KEY: 'fixture' },
      async () => new Response('sensitive provider body', { status }),
    );
    assert.equal(
      await mailer.send('qa@example.invalid', 'fixture-token'),
      'failed',
    );
  }
  const mailer = createBrevoResetMailer(
    { BREVO_API_KEY: 'fixture' },
    async () => {
      throw new Error('secret upstream details');
    },
  );
  assert.equal(
    await mailer.send('qa@example.invalid', 'fixture-token'),
    'failed',
  );
  assert.equal(createBrevoResetMailer({}), undefined);
  for (const config of [
    { PASSWORD_RESET_ORIGIN: 'https://attacker.invalid' },
    { PASSWORD_RESET_ORIGIN: 'https://ql.hoaiphuong.click/?redirect=bad' },
    { BREVO_SENDER_EMAIL: 'attacker@example.invalid' },
  ])
    assert.throws(() =>
      createBrevoResetMailer({ BREVO_API_KEY: 'fixture', ...config }),
    );
});
