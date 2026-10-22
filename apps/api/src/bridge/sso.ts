import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';

export interface SsoConfig {
  secret: string;
  ownerId: string;
  ownerEmail: string;
  workspaceId: string;
  callback: string;
}
export function bridgeSsoConfig(): SsoConfig {
  return {
    secret: process.env['HP_BRIDGE_SECRET']?.trim() ?? '',
    ownerId: process.env['MGLITE_SSO_OWNER_ID']?.trim() ?? '',
    ownerEmail:
      process.env['MGLITE_SSO_OWNER_EMAIL']?.trim().toLowerCase() ?? '',
    workspaceId: process.env['MGLITE_SSO_WORKSPACE_ID']?.trim() ?? '',
    callback:
      process.env['MGLITE_SSO_CALLBACK_URL']?.trim() ||
      'https://hoaiphuong.click/api/auth/management/callback',
  };
}
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const validOpaque = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export class ManagementSsoIssuer {
  private readonly grants = new Map<
    string,
    { token: string; state: string; expires: number }
  >();
  constructor(
    private readonly resolveSession: (
      token: string,
    ) => Promise<AuthenticatedContext | null>,
    private readonly config = bridgeSsoConfig,
    private readonly now = Date.now,
  ) {}
  private configured(): SsoConfig {
    const cfg = this.config();
    if (
      cfg.secret.length < 32 ||
      !cfg.ownerId ||
      !cfg.ownerEmail ||
      !cfg.workspaceId
    )
      throw new AuthError(
        'SSO_NOT_CONFIGURED',
        'Chưa cấu hình liên kết tài khoản quản trị giữa hai web.',
        503,
      );
    let url: URL;
    try {
      url = new URL(cfg.callback);
    } catch {
      throw new AuthError(
        'SSO_NOT_CONFIGURED',
        'Địa chỉ đăng nhập liên thông không hợp lệ.',
        503,
      );
    }
    if (
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost'].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/api/auth/management/callback'
    )
      throw new AuthError(
        'SSO_NOT_CONFIGURED',
        'Địa chỉ đăng nhập liên thông không hợp lệ.',
        503,
      );
    return cfg;
  }
  private allowed(auth: AuthenticatedContext, cfg: SsoConfig): void {
    if (
      auth.workspace.role !== 'owner' ||
      auth.user.id !== cfg.ownerId ||
      auth.workspace.id !== cfg.workspaceId ||
      auth.user.email.trim().toLowerCase() !== cfg.ownerEmail
    )
      throw new AuthError(
        'SSO_FORBIDDEN',
        'Tài khoản này chưa được liên kết với quản trị viên TikTok AI Factory.',
        403,
      );
  }
  authorize(auth: AuthenticatedContext, token: string, state: unknown): string {
    const cfg = this.configured();
    this.allowed(auth, cfg);
    if (!validOpaque(state) || !token)
      throw new AuthError(
        'SSO_INVALID_STATE',
        'Phiên đăng nhập liên thông không hợp lệ.',
        400,
      );
    for (const [key, grant] of this.grants)
      if (grant.expires <= this.now()) this.grants.delete(key);
    if (this.grants.size >= 1000)
      throw new AuthError(
        'SSO_BUSY',
        'Đăng nhập liên thông đang bận. Hãy thử lại sau.',
        503,
      );
    const code = randomBytes(32).toString('hex');
    this.grants.set(digest(code), {
      token,
      state,
      expires: this.now() + 60000,
    });
    const url = new URL(cfg.callback);
    url.searchParams.set('code', code);
    url.searchParams.set('state', state);
    return url.href;
  }
  async exchange(
    secret: unknown,
    code: unknown,
    state: unknown,
  ): Promise<{
    user_id: string;
    workspace_id: string;
    email: string;
    role: 'owner';
  }> {
    const cfg = this.configured();
    if (
      typeof secret !== 'string' ||
      !timingSafeEqual(
        Buffer.from(digest(secret)),
        Buffer.from(digest(cfg.secret)),
      )
    )
      throw new AuthError(
        'SSO_FORBIDDEN',
        'Không xác thực được hệ thống nhận.',
        403,
      );
    if (!validOpaque(code) || !validOpaque(state))
      throw new AuthError(
        'SSO_INVALID_GRANT',
        'Mã đăng nhập không hợp lệ hoặc đã hết hạn.',
        400,
      );
    const key = digest(code),
      grant = this.grants.get(key);
    if (!grant || grant.expires <= this.now() || grant.state !== state)
      throw new AuthError(
        'SSO_INVALID_GRANT',
        'Mã đăng nhập không hợp lệ hoặc đã hết hạn.',
        400,
      );
    this.grants.delete(key); // consume before awaiting: concurrent redemption fails closed
    const auth = await this.resolveSession(grant.token);
    if (!auth)
      throw new AuthError(
        'UNAUTHENTICATED',
        'Phiên đăng nhập quản lý đã hết hạn.',
        401,
      );
    this.allowed(auth, cfg);
    return {
      user_id: auth.user.id,
      workspace_id: auth.workspace.id,
      email: auth.user.email,
      role: 'owner',
    };
  }
}
