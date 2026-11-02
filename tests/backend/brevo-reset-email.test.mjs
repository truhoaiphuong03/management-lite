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
    {
      NODE_ENV: 'production',
      PASSWORD_RESET_ORIGIN: 'http://localhost:3101',
    },
  ])
    assert.throws(() =>
      createBrevoResetMailer({ BREVO_API_KEY: 'fixture', ...config }),
    );
});

test('DEV loopback origin (http://localhost:3101 / http://127.0.0.1:3101) is accepted in development mode', async () => {
  let seenBody;
  const mailer = createBrevoResetMailer(
    {
      NODE_ENV: 'development',
      BREVO_API_KEY: 'test-key-never-real',
      PASSWORD_RESET_ORIGIN: 'http://localhost:3101',
    },
    async (_url, options) => {
      seenBody = JSON.parse(options.body);
      return new Response('{}', { status: 201 });
    },
  );
  assert.ok(mailer, 'Mailer must be created for valid DEV loopback origin');
  assert.equal(
    await mailer.send('dev-owner@example.invalid', 'b'.repeat(64)),
    'accepted',
  );
  assert.ok(
    seenBody.textContent.includes(
      'http://localhost:3101/reset-password#token=' + 'b'.repeat(64),
    ),
  );
});

test('Brevo HTTPS email verification: unique subject reference, timestamp, 15m expiry, Windows 1 localhost:3101 guidance, no token in subject', async () => {
  const payloads = [];
  const mailer = createBrevoResetMailer(
    {
      NODE_ENV: 'development',
      BREVO_API_KEY: 'test-key-never-real',
      PASSWORD_RESET_ORIGIN: 'http://localhost:3101',
    },
    async (url, options) => {
      assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['api-key'], 'test-key-never-real');
      assert.ok(!options.body.includes('test-key-never-real'));
      payloads.push(JSON.parse(options.body));
      return new Response('{}', { status: 201 });
    },
  );
  assert.ok(mailer?.sendVerification, 'Mailer must expose sendVerification');

  const secretToken1 = 'c1d2e3f4'.repeat(8);
  const secretToken2 = 'a9b8c7d6'.repeat(8);

  assert.equal(
    await mailer.sendVerification('verify-qa@example.invalid', secretToken1),
    'accepted',
  );
  assert.equal(
    await mailer.sendVerification('verify-qa@example.invalid', secretToken2),
    'accepted',
  );

  assert.equal(payloads.length, 2);
  const [first, second] = payloads;

  for (const [idx, payload] of payloads.entries()) {
    const tok = idx === 0 ? secretToken1 : secretToken2;
    assert.equal(payload.sender.email, 'no-reply@hoaiphuong.click');
    assert.deepEqual(payload.to, [{ email: 'verify-qa@example.invalid' }]);
    assert.equal(payload.htmlContent, undefined);
    assert.match(
      payload.subject,
      /^Xác minh địa chỉ email Management Lite \[Mã tham chiếu: #[0-9A-F]{6}\]$/,
    );
    assert.ok(
      !payload.subject.includes(tok) &&
        !payload.subject.includes(tok.slice(0, 8)),
      'Subject must never contain the verification token or token prefix',
    );
    assert.ok(
      payload.textContent.includes(
        `http://localhost:3101/verify-email#token=${tok}`,
      ),
    );
    assert.ok(!payload.textContent.includes('/verify-email?token='));
    assert.ok(payload.textContent.includes('Thời điểm gửi:'));
    assert.ok(payload.textContent.includes('(GMT+7)'));
    assert.ok(payload.textContent.includes('Thời hạn hiệu lực: 15 phút'));
    assert.ok(
      payload.textContent.includes(
        'Hướng dẫn mở liên kết trên Windows 1 (localhost:3101)',
      ),
    );
    assert.ok(payload.textContent.includes('DESKTOP-8T8UHTS'));
  }

  assert.notEqual(
    first.subject,
    second.subject,
    'Each send must have a distinct subject reference code so Gmail does not collapse repeated verification emails',
  );
});
