import crypto from 'node:crypto';

export interface PasswordResetMailer {
  send(to: string, token: string): Promise<'accepted' | 'failed'>;
  sendVerification?(to: string, token: string): Promise<'accepted' | 'failed'>;
}

function createMailReferenceCode(): string {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function formatVietnamTimestamp(date: Date): string {
  const formatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${formatter.format(date)} (GMT+7)`;
}

/** HTTPS only, fixed provider endpoint, no provider payload/error logging or retries. */
export function createBrevoResetMailer(
  env: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch,
): PasswordResetMailer | undefined {
  const key = env['BREVO_API_KEY']?.trim();
  if (!key) return undefined;
  const sender = env['BREVO_SENDER_EMAIL'] || 'no-reply@hoaiphuong.click';
  const origin = env['PASSWORD_RESET_ORIGIN'] || 'https://ql.hoaiphuong.click';
  // Trusted configuration only; never construct recovery links from Host/Origin headers.
  const url = new URL(origin);
  const isolatedTestOrigin =
    (env['NODE_ENV'] === 'test' || env['NODE_ENV'] === 'development') &&
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
    Number(url.port) >= 1024;
  if (
    sender !== 'no-reply@hoaiphuong.click' ||
    (url.origin !== 'https://ql.hoaiphuong.click' && !isolatedTestOrigin) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error('Invalid password recovery email configuration');

  async function postBrevoTextEmail(
    to: string,
    subject: string,
    textContent: string,
  ): Promise<'accepted' | 'failed'> {
    try {
      const response = await request('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          'api-key': key!,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'Management Lite', email: sender },
          to: [{ email: to }],
          subject,
          textContent,
          // Plain text only. Verify received link/source in the real inbox
          // before release; do not rely on undocumented tracking headers.
        }),
      });
      const accepted = response.status === 201;
      await response.body?.cancel();
      return accepted ? 'accepted' : 'failed';
    } catch {
      return 'failed';
    }
  }

  return {
    async send(to, token) {
      const refCode = createMailReferenceCode();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
      const link = new URL('/reset-password', url);
      // Fragment keeps the bearer token out of HTTP access logs and Referer headers.
      link.hash = new URLSearchParams({ token }).toString();
      const devGuidance = isolatedTestOrigin
        ? `\nHướng dẫn mở liên kết trên Windows 1 (${url.host}): Vì liên kết sử dụng địa chỉ nội bộ ${url.origin}, vui lòng mở trình duyệt trực tiếp trên máy Windows 1 (DESKTOP-8T8UHTS) và dán toàn bộ liên kết trên vào thanh địa chỉ (hoặc mở ${url.origin}/reset-password trên Windows 1 và nhập Mã xác minh).\n`
        : '';
      return postBrevoTextEmail(
        to,
        `Đặt lại mật khẩu Management Lite [Mã tham chiếu: #${refCode}]`,
        `[Management Lite — Khôi phục mật khẩu | Mã tham chiếu: #${refCode}]\nThời điểm gửi: ${formatVietnamTimestamp(now)}\nThời hạn hiệu lực: 15 phút (hết hạn lúc ${formatVietnamTimestamp(expiresAt)})\n\nBạn đã yêu cầu đặt lại mật khẩu tài khoản Management Lite.\nMở liên kết: ${link.href}\nHoặc nhập mã xác minh: ${token}${devGuidance}\nLưu ý: Mã chỉ dùng một lần và hết hạn sau 15 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
      );
    },
    async sendVerification(to, token) {
      const refCode = createMailReferenceCode();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
      const link = new URL('/verify-email', url);
      // Fragment keeps the bearer token out of HTTP access logs and Referer headers.
      link.hash = new URLSearchParams({ token }).toString();
      const devGuidance = isolatedTestOrigin
        ? `\nHướng dẫn mở liên kết trên Windows 1 (${url.host}): Vì liên kết sử dụng địa chỉ nội bộ ${url.origin}, Gmail sẽ không tự chuyển hướng trên thiết bị khác. Vui lòng mở trình duyệt trực tiếp trên máy Windows 1 (DESKTOP-8T8UHTS), sao chép và dán toàn bộ liên kết trên vào thanh địa chỉ (hoặc mở ${url.origin}/verify-email trên Windows 1 và dán Mã xác minh vào ô xác nhận).\n`
        : '';
      return postBrevoTextEmail(
        to,
        `Xác minh địa chỉ email Management Lite [Mã tham chiếu: #${refCode}]`,
        `[Management Lite — Xác minh địa chỉ email | Mã tham chiếu: #${refCode}]\nThời điểm gửi: ${formatVietnamTimestamp(now)}\nThời hạn hiệu lực: 15 phút (hết hạn lúc ${formatVietnamTimestamp(expiresAt)})\n\nBạn đã yêu cầu xác minh địa chỉ email tài khoản Management Lite.\nMở liên kết: ${link.href}\nHoặc nhập mã xác minh: ${token}${devGuidance}\nLưu ý: Mã chỉ dùng một lần và hết hạn sau 15 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
      );
    },
  };
}

