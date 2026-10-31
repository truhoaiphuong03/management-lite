import type {
  AccountPlatform,
  AccountHealthStatus,
  ManagedAccountData,
} from '../../../../../packages/contracts/src/accounts.js';

export interface PlatformConfig {
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
  bg: string;
  border: string;
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  label: 'Nền tảng khác',
  shortLabel: 'Khác',
  icon: '🌐',
  color: '#A855F7',
  bg: 'rgba(168, 85, 247, 0.1)',
  border: 'rgba(168, 85, 247, 0.3)',
};

export const PLATFORM_CONFIG: Record<string, PlatformConfig> = {
  gmail: {
    label: 'Gmail / Google',
    shortLabel: 'Gmail',
    icon: '📧',
    color: '#EA4335',
    bg: 'rgba(234, 67, 53, 0.1)',
    border: 'rgba(234, 67, 53, 0.3)',
  },
  tiktok: {
    label: 'TikTok',
    shortLabel: 'TikTok',
    icon: '🎵',
    color: '#F43F5E',
    bg: 'rgba(244, 63, 94, 0.1)',
    border: 'rgba(244, 63, 94, 0.3)',
  },
  facebook: {
    label: 'Facebook (FB)',
    shortLabel: 'Facebook',
    icon: '📘',
    color: '#3B82F6',
    bg: 'rgba(59, 130, 246, 0.1)',
    border: 'rgba(59, 130, 246, 0.3)',
  },
  youtube: {
    label: 'YouTube (YTB)',
    shortLabel: 'YouTube',
    icon: '▶️',
    color: '#EF4444',
    bg: 'rgba(239, 68, 68, 0.1)',
    border: 'rgba(239, 68, 68, 0.3)',
  },
  authenticator: {
    label: 'GG Authenticator',
    shortLabel: 'Authenticator',
    icon: '🔐',
    color: '#F59E0B',
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.35)',
  },
  recovery: {
    label: 'TK Khôi phục',
    shortLabel: 'Khôi phục',
    icon: '🛟',
    color: 'var(--success-text)',
    bg: 'rgba(16, 185, 129, 0.12)',
    border: 'rgba(16, 185, 129, 0.35)',
  },
  ai: {
    label: 'AI / LLM',
    shortLabel: 'AI / LLM',
    icon: '🤖',
    color: 'var(--success-text)',
    bg: 'rgba(16, 185, 129, 0.1)',
    border: 'rgba(16, 185, 129, 0.3)',
  },
  pm: {
    label: 'PM / Dự án',
    shortLabel: 'PM',
    icon: '📋',
    color: 'var(--info-text)',
    bg: 'rgba(56, 189, 248, 0.1)',
    border: 'rgba(56, 189, 248, 0.3)',
  },
  other: DEFAULT_PLATFORM_CONFIG,
};

export function getPlatformConfig(platform: string): PlatformConfig {
  return PLATFORM_CONFIG[platform] ?? DEFAULT_PLATFORM_CONFIG;
}

export interface HealthStatusConfig {
  label: string;
  shortLabel: string;
  badgeStatus: 'success' | 'warning' | 'danger' | 'neutral';
  color: string;
  bg: string;
  border: string;
}

export const HEALTH_STATUS_CONFIG: Record<
  AccountHealthStatus,
  HealthStatusConfig
> = {
  healthy: {
    label: 'Hoạt động tốt',
    shortLabel: 'Tốt',
    badgeStatus: 'success',
    color: 'var(--success-text)',
    bg: 'rgba(16, 185, 129, 0.12)',
    border: 'rgba(16, 185, 129, 0.35)',
  },
  verify_required: {
    label: 'Cần xác minh / Checkpoint',
    shortLabel: 'Cần xác minh',
    badgeStatus: 'warning',
    color: 'var(--warning-text)',
    bg: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(245, 158, 11, 0.38)',
  },
  locked: {
    label: 'Bị khóa / Die',
    shortLabel: 'Bị khóa',
    badgeStatus: 'danger',
    color: 'var(--danger-text)',
    bg: 'rgba(239, 68, 68, 0.14)',
    border: 'rgba(239, 68, 68, 0.38)',
  },
};

export function getHealthStatusConfig(
  healthStatus?: AccountHealthStatus | string | null,
): HealthStatusConfig {
  if (healthStatus === 'verify_required') {
    return HEALTH_STATUS_CONFIG.verify_required;
  }
  if (healthStatus === 'locked') {
    return HEALTH_STATUS_CONFIG.locked;
  }
  return HEALTH_STATUS_CONFIG.healthy;
}

export function normalizeVnPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  let cleaned = raw.trim().replace(/[\s.\-()]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+84')) {
    cleaned = '0' + cleaned.slice(3);
  } else if (/^84[35789]\d{8}$/.test(cleaned)) {
    cleaned = '0' + cleaned.slice(2);
  }
  return cleaned;
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

/**
 * 360° Bidirectional Account Graph Lookup:
 * Given a search query (e.g., a TikTok ID, UID, Gmail address, phone number, Authenticator, or Recovery email),
 * finds all directly matching accounts AND traverses both UPWARD (to root Gmail, phone, authenticator, recovery)
 * and DOWNWARD (to all child TikTok/FB/YTB channels and sibling channels) so the user immediately sees
 * the complete connected family cluster.
 */
export interface Filter360Result {
  matchedIds: Set<string>;
  directMatchIds: Set<string>;
  includedClusterIds: Set<string>;
  visibleAccounts: ManagedAccountData[];
  matchedAccounts: ManagedAccountData[];
}

export function filterAccounts360(
  accounts: ManagedAccountData[],
  rawQuery: string,
): Filter360Result {
  const q = rawQuery.trim().toLowerCase();
  if (!q) {
    const empty = new Set<string>();
    return {
      matchedIds: empty,
      directMatchIds: empty,
      includedClusterIds: empty,
      visibleAccounts: accounts,
      matchedAccounts: accounts,
    };
  }

  const normalizedPhoneQ = normalizeVnPhone(q);
  const byId = new Map<string, ManagedAccountData>();
  for (const acc of accounts) {
    byId.set(acc.id, acc);
  }

  const matchedIds = new Set<string>();
  const matchedPhones = new Set<string>();

  for (const acc of accounts) {
    const fields = [
      acc.username,
      acc.platform,
      acc.platform_account_id,
      acc.recovery_email,
      acc.account_group,
      acc.assigned_employee_name,
      acc.assigned_employee_code,
      acc.phone_number,
      acc.phone_note,
      acc.parent_account_username,
      acc.recovery_account_username,
      acc.authenticator_account_username,
      acc.notes,
    ];
    let isMatch = fields.some(
      (f) => typeof f === 'string' && f.toLowerCase().includes(q),
    );
    if (
      !isMatch &&
      normalizedPhoneQ.length >= 4 &&
      acc.phone_number &&
      normalizeVnPhone(acc.phone_number).includes(normalizedPhoneQ)
    ) {
      isMatch = true;
    }
    if (
      !isMatch &&
      Array.isArray(acc.child_accounts) &&
      acc.child_accounts.some(
        (c) =>
          (c.username && c.username.toLowerCase().includes(q)) ||
          (c.platform_account_id &&
            c.platform_account_id.toLowerCase().includes(q)),
      )
    ) {
      isMatch = true;
    }

    if (isMatch) {
      matchedIds.add(acc.id);
      if (acc.phone_number) {
        matchedPhones.add(normalizeVnPhone(acc.phone_number));
      }
    }
  }

  const includedClusterIds = new Set<string>(matchedIds);
  const rootParentIdsToExpand = new Set<string>();

  for (const id of matchedIds) {
    const acc = byId.get(id);
    if (!acc) continue;

    // 1. Upward traversal: include parent Gmail, recovery account, authenticator account, and phone
    if (acc.phone_number) {
      matchedPhones.add(normalizeVnPhone(acc.phone_number));
    }
    if (acc.parent_account_id) {
      includedClusterIds.add(acc.parent_account_id);
      rootParentIdsToExpand.add(acc.parent_account_id);
      const parentAcc = byId.get(acc.parent_account_id);
      if (parentAcc) {
        if (parentAcc.phone_number) {
          matchedPhones.add(normalizeVnPhone(parentAcc.phone_number));
        }
        if (parentAcc.recovery_account_id) {
          includedClusterIds.add(parentAcc.recovery_account_id);
        }
        if (parentAcc.authenticator_account_id) {
          includedClusterIds.add(parentAcc.authenticator_account_id);
        }
      }
    }
    if (acc.recovery_account_id) {
      includedClusterIds.add(acc.recovery_account_id);
    }
    if (acc.authenticator_account_id) {
      includedClusterIds.add(acc.authenticator_account_id);
    }

    // Also expand children of this matched account
    rootParentIdsToExpand.add(acc.id);
  }

  // 2. Downward & sibling traversal: any account whose parent, recovery, or authenticator is in matchedIds/rootParentIdsToExpand
  for (const acc of accounts) {
    const normPhone = normalizeVnPhone(acc.phone_number);
    if (normPhone && matchedPhones.has(normPhone)) {
      includedClusterIds.add(acc.id);
      rootParentIdsToExpand.add(acc.id);
    }
    if (
      (acc.parent_account_id &&
        rootParentIdsToExpand.has(acc.parent_account_id)) ||
      (acc.recovery_account_id && matchedIds.has(acc.recovery_account_id)) ||
      (acc.authenticator_account_id &&
        matchedIds.has(acc.authenticator_account_id))
    ) {
      includedClusterIds.add(acc.id);
      if (acc.platform === 'gmail') {
        rootParentIdsToExpand.add(acc.id);
      }
      if (acc.recovery_account_id) {
        includedClusterIds.add(acc.recovery_account_id);
      }
      if (acc.authenticator_account_id) {
        includedClusterIds.add(acc.authenticator_account_id);
      }
    }
  }

  // Second pass for grandchildren (e.g. searching Authenticator -> finds Gmail -> includes Gmail's TikTok/FB/YTB)
  for (const acc of accounts) {
    if (
      acc.parent_account_id &&
      rootParentIdsToExpand.has(acc.parent_account_id)
    ) {
      includedClusterIds.add(acc.id);
    }
  }

  const visibleAccounts = accounts
    .filter((acc) => includedClusterIds.has(acc.id))
    .sort((a, b) => {
      const aDirect = matchedIds.has(a.id) ? 0 : 1;
      const bDirect = matchedIds.has(b.id) ? 0 : 1;
      return aDirect - bDirect;
    });

  return {
    matchedIds,
    directMatchIds: matchedIds,
    includedClusterIds,
    visibleAccounts,
    matchedAccounts: visibleAccounts,
  };
}

export interface GmailClusterItem {
  root: ManagedAccountData;
  gmail: ManagedAccountData;
  children: ManagedAccountData[];
}

export interface GmailClustersViewData {
  clusters: GmailClusterItem[];
  standalone: ManagedAccountData[];
  unlinkedAccounts: ManagedAccountData[];
}

export function buildGmailClusters(
  accounts: ManagedAccountData[],
): GmailClustersViewData {
  const byId = new Map<string, ManagedAccountData>();
  const childrenMap = new Map<string, ManagedAccountData[]>();

  for (const acc of accounts) {
    byId.set(acc.id, acc);
  }

  for (const acc of accounts) {
    if (acc.parent_account_id && byId.has(acc.parent_account_id)) {
      const list = childrenMap.get(acc.parent_account_id) || [];
      list.push(acc);
      childrenMap.set(acc.parent_account_id, list);
    }
  }

  const clusters: GmailClusterItem[] = [];
  const standalone: ManagedAccountData[] = [];

  for (const acc of accounts) {
    if (acc.parent_account_id && byId.has(acc.parent_account_id)) {
      // Child of an existing root in the current view; rendered inside its parent cluster
      continue;
    }
    const children = childrenMap.get(acc.id) || [];
    if (acc.platform === 'gmail' || children.length > 0) {
      clusters.push({
        root: acc,
        gmail: acc,
        children,
      });
    } else {
      standalone.push(acc);
    }
  }

  return { clusters, standalone, unlinkedAccounts: standalone };
}

export interface PhoneClusterItem {
  phone_number: string;
  phone_note: string | null;
  gmail_count: number;
  social_count: number;
  total_count: number;
  warningLevel: 'safe' | 'warning' | 'limit';
  gmails: ManagedAccountData[];
  socials: ManagedAccountData[];
  all: ManagedAccountData[];
  accounts: ManagedAccountData[];
}

export function buildPhoneClusters(accounts: ManagedAccountData[]): {
  phones: PhoneClusterItem[];
  unlinked: ManagedAccountData[];
} {
  const map = new Map<string, PhoneClusterItem>();
  const unlinked: ManagedAccountData[] = [];

  for (const acc of accounts) {
    const cleanPhone = normalizeVnPhone(acc.phone_number);
    if (!cleanPhone) {
      unlinked.push(acc);
      continue;
    }
    let group = map.get(cleanPhone);
    if (!group) {
      group = {
        phone_number: cleanPhone,
        phone_note: acc.phone_note || null,
        gmail_count: 0,
        social_count: 0,
        total_count: 0,
        warningLevel: 'safe',
        gmails: [],
        socials: [],
        all: [],
        accounts: [],
      };
      map.set(cleanPhone, group);
    } else if (!group.phone_note && acc.phone_note) {
      group.phone_note = acc.phone_note;
    }

    group.total_count += 1;
    group.all.push(acc);
    group.accounts.push(acc);
    if (acc.platform === 'gmail') {
      group.gmail_count += 1;
      group.gmails.push(acc);
    } else {
      group.social_count += 1;
      group.socials.push(acc);
    }
  }

  const phones = Array.from(map.values()).map((g) => ({
    ...g,
    warningLevel:
      g.gmail_count >= 5 ? 'limit' : g.gmail_count >= 4 ? 'warning' : 'safe',
  })) as PhoneClusterItem[];

  phones.sort(
    (a, b) =>
      b.gmail_count - a.gmail_count ||
      b.total_count - a.total_count ||
      a.phone_number.localeCompare(b.phone_number),
  );

  return { phones, unlinked };
}

export interface ProtectionClusterItem {
  protector: ManagedAccountData;
  account: ManagedAccountData;
  protectedAccounts: ManagedAccountData[];
}

export function buildProtectionClusters(accounts: ManagedAccountData[]): {
  authenticators: ProtectionClusterItem[];
  recoveries: ProtectionClusterItem[];
} {
  const authById = new Map<string, ProtectionClusterItem>();
  const recById = new Map<string, ProtectionClusterItem>();

  for (const acc of accounts) {
    if (acc.platform === 'authenticator') {
      authById.set(acc.id, {
        protector: acc,
        account: acc,
        protectedAccounts: [],
      });
    }
    if (acc.platform === 'recovery') {
      recById.set(acc.id, {
        protector: acc,
        account: acc,
        protectedAccounts: [],
      });
    }
  }

  const byId = new Map<string, ManagedAccountData>();
  for (const acc of accounts) {
    byId.set(acc.id, acc);
  }

  for (const acc of accounts) {
    if (acc.authenticator_account_id) {
      let group = authById.get(acc.authenticator_account_id);
      if (!group) {
        const protector = byId.get(acc.authenticator_account_id);
        if (protector) {
          group = {
            protector,
            account: protector,
            protectedAccounts: [],
          };
          authById.set(protector.id, group);
        }
      }
      if (group) {
        group.protectedAccounts.push(acc);
      }
    }

    if (acc.recovery_account_id) {
      let group = recById.get(acc.recovery_account_id);
      if (!group) {
        const protector = byId.get(acc.recovery_account_id);
        if (protector) {
          group = {
            protector,
            account: protector,
            protectedAccounts: [],
          };
          recById.set(protector.id, group);
        }
      }
      if (group) {
        group.protectedAccounts.push(acc);
      }
    }
  }

  return {
    authenticators: Array.from(authById.values()).sort(
      (a, b) => b.protectedAccounts.length - a.protectedAccounts.length,
    ),
    recoveries: Array.from(recById.values()).sort(
      (a, b) => b.protectedAccounts.length - a.protectedAccounts.length,
    ),
  };
}

/**
 * Decodes a Base32 TOTP secret (RFC 4648) into a Uint8Array.
 * Accepts raw Base32 strings (with spaces/dashes/lowercase) or otpauth:// URIs.
 */
export function decodeBase32Secret(rawInput: string): Uint8Array | null {
  if (!rawInput || typeof rawInput !== 'string') return null;
  let secretStr = rawInput.trim();
  if (secretStr.toLowerCase().startsWith('otpauth://')) {
    try {
      const url = new URL(secretStr);
      const paramSecret = url.searchParams.get('secret');
      if (paramSecret) secretStr = paramSecret;
    } catch {
      // Fallback to raw string
    }
  }

  const cleaned = secretStr.replace(/[\s\-=]/g, '').toUpperCase();
  if (!cleaned || !/^[A-Z2-7]+$/.test(cleaned)) {
    return null;
  }

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = alphabet.indexOf(cleaned[i]!);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return output.length > 0 ? new Uint8Array(output) : null;
}

/**
 * Generates a live 6-digit RFC 6238 TOTP code (Google Authenticator compatible, 30s period, HMAC-SHA1).
 */
export async function computeTotpCode(
  secretInput: string,
  timestampMs: number = Date.now(),
): Promise<{
  code: string;
  formattedCode: string;
  remainingSeconds: number;
} | null> {
  const keyBytes = decodeBase32Secret(secretInput);
  if (!keyBytes || !globalThis.crypto?.subtle) return null;

  const epochSeconds = Math.floor(timestampMs / 1000);
  const timeStep = Math.floor(epochSeconds / 30);
  const remainingSeconds = 30 - (epochSeconds % 30);

  const counterBuf = new ArrayBuffer(8);
  const counterView = new DataView(counterBuf);
  counterView.setUint32(0, Math.floor(timeStep / 0x100000000), false);
  counterView.setUint32(4, timeStep >>> 0, false);

  try {
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'raw',
      keyBytes as unknown as BufferSource,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const sigBuf = await globalThis.crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      counterBuf,
    );
    const hmac = new Uint8Array(sigBuf);
    const offset = hmac[hmac.length - 1]! & 0x0f;
    const binary =
      ((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff);
    const otp = (binary % 1000000).toString().padStart(6, '0');
    return {
      code: otp,
      formattedCode: `${otp.slice(0, 3)} ${otp.slice(3)}`,
      remainingSeconds,
    };
  } catch {
    return null;
  }
}

export interface BulkParsedAccountRow {
  platform: AccountPlatform;
  username: string;
  password?: string;
  recovery_email?: string;
  two_fa_secret?: string;
  phone_number?: string;
  phone_note?: string;
}

/**
 * Parses bulk account lines formatted as:
 * username|password|recovery_email|2fa_secret|phone_number|phone_note
 */
export function parseBulkAccountsInput(
  rawText: string,
  defaultPlatform: AccountPlatform = 'gmail',
): BulkParsedAccountRow[] {
  if (!rawText || typeof rawText !== 'string') return [];
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const results: BulkParsedAccountRow[] = [];
  for (const line of lines) {
    const delimiter = line.includes('|')
      ? '|'
      : line.includes('\t')
        ? '\t'
        : line.includes(';')
          ? ';'
          : ',';
    const parts = line.split(delimiter).map((p) => p.trim());
    const username = parts[0] || '';
    if (!username) continue;

    const password = parts[1] || undefined;
    const recoveryRaw = parts[2] || undefined;
    const twoFaRaw = parts[3] || undefined;
    const phoneRaw = parts[4] || undefined;
    const phoneNoteRaw = parts[5] || undefined;

    results.push({
      platform: defaultPlatform,
      username,
      ...(password ? { password } : {}),
      ...(recoveryRaw && recoveryRaw.includes('@')
        ? { recovery_email: recoveryRaw.toLowerCase() }
        : {}),
      ...(twoFaRaw ? { two_fa_secret: twoFaRaw } : {}),
      ...(phoneRaw ? { phone_number: normalizeVnPhone(phoneRaw) } : {}),
      ...(phoneNoteRaw ? { phone_note: phoneNoteRaw } : {}),
    });
  }

  return results;
}
