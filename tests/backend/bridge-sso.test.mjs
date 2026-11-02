import test from 'node:test';
import assert from 'node:assert/strict';
import { ManagementSsoIssuer } from '../../dist/apps/api/src/bridge/sso.js';
const auth = {
  user: { id: 'owner-id', email: 'owner-sso@example.test' },
  workspace: { id: 'workspace-id', role: 'owner' },
};
const cfg = {
  secret: 'test-secret-32-bytes-long-xxxxxxxxxxxx',
  ownerId: 'owner-id',
  ownerEmail: 'owner-sso@example.test',
  workspaceId: 'workspace-id',
  callback: 'https://hoaiphuong.click/api/auth/management/callback',
};
const state = 'a'.repeat(64);
const fixture = () => {
  let current = auth,
    now = 0;
  const issuer = new ManagementSsoIssuer(
    async (token) => (token === 'opaque-session' ? current : null),
    () => cfg,
    () => now,
  );
  return {
    issuer,
    setAuth: (value) => (current = value),
    setNow: (value) => (now = value),
  };
};
const codeOf = (url) => new URL(url).searchParams.get('code');
test('SSO grant is one-use, bound to browser state and exact owner/workspace; never sends source session token', async () => {
  const f = fixture(),
    url = f.issuer.authorize(auth, 'opaque-session', state),
    code = codeOf(url);
  assert.equal(new URL(url).origin, 'https://hoaiphuong.click');
  assert.ok(!url.includes('opaque-session'));
  await assert.rejects(f.issuer.exchange(cfg.secret, code, 'b'.repeat(64)), {
    code: 'SSO_INVALID_GRANT',
  });
  await assert.rejects(f.issuer.exchange('wrong', code, state), {
    code: 'SSO_FORBIDDEN',
  });
  const result = await f.issuer.exchange(cfg.secret, code, state);
  assert.equal(result.email, auth.user.email);
  assert.ok(!('token' in result));
  await assert.rejects(f.issuer.exchange(cfg.secret, code, state), {
    code: 'SSO_INVALID_GRANT',
  });
});
test('SSO expires and rechecks revocation and owner role before exchange', async () => {
  for (const revoked of [
    null,
    { ...auth, workspace: { ...auth.workspace, role: 'staff' } },
  ]) {
    const f = fixture(),
      code = codeOf(f.issuer.authorize(auth, 'opaque-session', state));
    f.setAuth(revoked);
    await assert.rejects(f.issuer.exchange(cfg.secret, code, state), (error) =>
      ['UNAUTHENTICATED', 'SSO_FORBIDDEN'].includes(error.code),
    );
  }
  const f = fixture(),
    code = codeOf(f.issuer.authorize(auth, 'opaque-session', state));
  f.setNow(60000);
  await assert.rejects(f.issuer.exchange(cfg.secret, code, state), {
    code: 'SSO_INVALID_GRANT',
  });
});
test('SSO never accepts other owners, staff, missing configuration, or invalid state', () => {
  const f = fixture();
  for (const value of [
    { ...auth, user: { ...auth.user, id: 'other' } },
    { ...auth, workspace: { id: 'another', role: 'owner' } },
    { ...auth, workspace: { ...auth.workspace, role: 'staff' } },
  ])
    assert.throws(() => f.issuer.authorize(value, 'opaque-session', state), {
      code: 'SSO_FORBIDDEN',
    });
  assert.throws(() => f.issuer.authorize(auth, 'opaque-session', 'unsafe'), {
    code: 'SSO_INVALID_STATE',
  });
  const noConfig = new ManagementSsoIssuer(
    async () => auth,
    () => ({ ...cfg, secret: '' }),
  );
  assert.throws(() => noConfig.authorize(auth, 'opaque-session', state), {
    code: 'SSO_NOT_CONFIGURED',
  });
});
test('SSO concurrent exchange can redeem only once', async () => {
  const f = fixture(),
    code = codeOf(f.issuer.authorize(auth, 'opaque-session', state));
  const results = await Promise.allSettled([
    f.issuer.exchange(cfg.secret, code, state),
    f.issuer.exchange(cfg.secret, code, state),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
});

test('SSO login continuation only permits a fixed internal destination and opaque state', async () => {
  const { managementSsoContinuation } =
    await import('../../dist/apps/web/src/navigation-guard.js');
  assert.equal(
    managementSsoContinuation(`?sso_state=${state}`),
    `/api/v1/bridge/sso/authorize?state=${state}`,
  );
  assert.equal(managementSsoContinuation('?sso_state=https://evil.test'), null);
  assert.equal(managementSsoContinuation(''), null);
});
