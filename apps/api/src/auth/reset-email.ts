export interface PasswordResetMailer {
  send(to: string, token: string): Promise<'accepted' | 'failed'>;
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
  return {
    async send(to, token) {
      const link = new URL('/reset-password', url);
      // Fragment keeps the bearer token out of HTTP access logs and Referer headers.
      link.hash = new URLSearchParams({ token }).toString();
      try {
        const response = await request('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: {
            'api-key': key,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            sender: { name: 'Management Lite', email: sender },
            to: [{ email: to }],
            subject: 'Đặt lại mật khẩu Management Lite',
            textContent: `Bạn đã yêu cầu đặt lại mật khẩu Management Lite.\nMở liên kết: ${link.href}\nHoặc nhập mã xác minh: ${token}\nMã chỉ dùng một lần và hết hạn sau 15 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
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
    },
  };
}
