export interface PlatformConfig {
  label: string;
  color: string;
  bg: string;
  border: string;
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  label: 'Nền tảng khác',
  color: '#A855F7',
  bg: 'rgba(168, 85, 247, 0.1)',
  border: 'rgba(168, 85, 247, 0.3)',
};

export const PLATFORM_CONFIG: Record<string, PlatformConfig> = {
  tiktok: {
    label: 'TikTok',
    color: '#F43F5E',
    bg: 'rgba(244, 63, 94, 0.1)',
    border: 'rgba(244, 63, 94, 0.3)',
  },
  gmail: {
    label: 'Gmail / Google',
    color: '#EA4335',
    bg: 'rgba(234, 67, 53, 0.1)',
    border: 'rgba(234, 67, 53, 0.3)',
  },
  ai: {
    label: 'AI / LLM',
    color: 'var(--success-text)',
    bg: 'rgba(16, 185, 129, 0.1)',
    border: 'rgba(16, 185, 129, 0.3)',
  },
  pm: {
    label: 'PM / Dự án',
    color: 'var(--info-text)',
    bg: 'rgba(56, 189, 248, 0.1)',
    border: 'rgba(56, 189, 248, 0.3)',
  },
  other: DEFAULT_PLATFORM_CONFIG,
};

export function getPlatformConfig(platform: string): PlatformConfig {
  return PLATFORM_CONFIG[platform] ?? DEFAULT_PLATFORM_CONFIG;
}

export function sanitizeUiError(msg: unknown): string {
  if (!msg) return 'Đã có lỗi xảy ra.';
  let str = msg instanceof Error ? msg.message : String(msg);
  str = str.replace(/bearer\s+[^\s&"']+/gi, 'Bearer [REDACTED]');
  str = str.replace(
    /(password|token|secret|key|proof)\s*[:=]\s*[^\s&"',]+/gi,
    '$1=[REDACTED]',
  );
  return str;
}
