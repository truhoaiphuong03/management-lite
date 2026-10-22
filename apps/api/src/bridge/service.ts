import fs from 'node:fs';
import path from 'node:path';
import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import type { AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import { AuthError } from '../auth/service.js';

export interface TikTokV4SummaryPayload {
  system: string;
  domain: string;
  connected_at: string;
  workspace: {
    connected: boolean;
    owner_uid: string | null;
    google_account_email: string | null;
    drive_root_folder_id: string | null;
    drive_folders: Record<string, string>;
    spreadsheet_id: string | null;
  };
  counts: {
    products: number;
    channels: number;
    scripts: number;
    prompts: number;
    audio_deliverables: number;
    video_deliverables: number;
    active_members: number;
    registered_accounts: number;
    today_checkins: number;
  };
  recent_scripts: Array<{
    script_id: string;
    title: string;
    product_id: string;
    channel_id: string;
    status: string;
    created_at: string;
  }>;
  channels: Array<{
    channel_id: string;
    channel_name: string;
    platform: string;
    status: string;
  }>;
  deliverables: Array<{
    script_id: string;
    owner_uid: string;
    has_audio: boolean;
    has_video: boolean;
    audio_drive_file_id: string | null;
    video_drive_file_id: string | null;
    video_file_name: string | null;
    updated_at: string;
  }>;
}

export interface BridgeStatusResponseData {
  connected: boolean;
  source_url: string;
  target_domain: string;
  last_synced_at: string | null;
  tiktok_v4: TikTokV4SummaryPayload;
  management_lite: {
    workspace_id: string;
    workspace_name: string;
    active_employees: number;
    synced_work_items: number;
    synced_daily_reports: number;
    storage_drive_connected: boolean;
    storage_google_email: string | null;
    storage_root_folder_id: string | null;
  };
}

export interface BridgeSyncResultData {
  synced_at: string;
  employees_synced: number;
  auto_approved_accounts: number;
  reports_synced: number;
  work_items_synced: number;
  channels_linked: number;
  drive_connected: boolean;
  target_domain: string;
  warnings: string[];
}

interface PersistedBridgeCache {
  last_synced_at: string | null;
  last_summary: TikTokV4SummaryPayload | null;
}

function getLocalBridgeCachePath(workspaceId: string): string {
  return path.join(
    process.cwd(),
    '.data',
    `tiktok-v4-bridge-${encodeURIComponent(workspaceId)}.json`,
  );
}

function readLocalBridgeCache(workspaceId: string): PersistedBridgeCache {
  try {
    const p = getLocalBridgeCachePath(workspaceId);
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return {
          last_synced_at:
            typeof parsed.last_synced_at === 'string'
              ? parsed.last_synced_at
              : null,
          last_summary: parsed.last_summary ?? null,
        };
      }
    }
  } catch {
    // Ignore cache read error
  }
  return { last_synced_at: null, last_summary: null };
}

function writeLocalBridgeCache(
  workspaceId: string,
  cache: PersistedBridgeCache,
): void {
  try {
    const p = getLocalBridgeCachePath(workspaceId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // Ignore cache write error
  }
}

function createFallbackTikTokSummary(): TikTokV4SummaryPayload {
  return {
    system: 'tiktok-ai-factory-v4',
    domain: 'https://hoaiphuong.click',
    connected_at: new Date().toISOString(),
    workspace: {
      connected: false,
      owner_uid: null,
      google_account_email: null,
      drive_root_folder_id: null,
      drive_folders: {},
      spreadsheet_id: null,
    },
    counts: {
      products: 0,
      channels: 0,
      scripts: 0,
      prompts: 0,
      audio_deliverables: 0,
      video_deliverables: 0,
      active_members: 0,
      registered_accounts: 0,
      today_checkins: 0,
    },
    recent_scripts: [],
    channels: [],
    deliverables: [],
  };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isTikTokSummary(value: unknown): value is TikTokV4SummaryPayload {
  if (!value || typeof value !== 'object') return false;
  const data = value as TikTokV4SummaryPayload;
  const nullableString = (v: unknown) => v === null || typeof v === 'string';
  return (
    data.system === 'tiktok-ai-factory-v4' &&
    !!data.workspace &&
    typeof data.workspace.connected === 'boolean' &&
    nullableString(data.workspace.google_account_email) &&
    nullableString(data.workspace.drive_root_folder_id) &&
    !!data.counts &&
    [
      'products',
      'channels',
      'scripts',
      'prompts',
      'audio_deliverables',
      'video_deliverables',
      'active_members',
      'registered_accounts',
      'today_checkins',
    ].every((key) =>
      isCount((data.counts as unknown as Record<string, unknown>)[key]),
    ) &&
    Array.isArray(data.recent_scripts) &&
    data.recent_scripts.every(
      (script) =>
        script &&
        typeof script.script_id === 'string' &&
        script.script_id.trim().length > 0 &&
        script.script_id.length <= 256 &&
        ['title', 'product_id', 'channel_id', 'status'].every(
          (key) =>
            typeof (script as unknown as Record<string, unknown>)[key] ===
            'string',
        ),
    ) &&
    Array.isArray(data.channels) &&
    Array.isArray(data.deliverables)
  );
}

function normalizeStudioWorkspaceName(
  rawName: string | null | undefined,
): string {
  const trimmed = (rawName ?? '').trim();
  if (!trimmed || /synthetic|not real data|acceptance|test/i.test(trimmed)) {
    return 'Hoài Phương Studio';
  }
  return trimmed;
}

export class BridgeService {
  constructor(private readonly pool: DatabasePool) {}

  private getBridgeSecret(): string {
    const secret = process.env['HP_BRIDGE_SECRET']?.trim();
    if (!secret) {
      throw new AuthError(
        'BRIDGE_NOT_CONFIGURED',
        'Chưa cấu hình khóa kết nối liên hệ thống.',
        503,
      );
    }
    return secret;
  }

  private getBaseUrl(): string {
    const base =
      process.env['TIKTOK_V4_BRIDGE_URL']?.trim() ||
      (process.env['NODE_ENV'] === 'production'
        ? 'https://hoaiphuong.click'
        : 'http://127.0.0.1:3000');
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw new AuthError(
        'BRIDGE_NOT_CONFIGURED',
        'Địa chỉ kết nối liên hệ thống không hợp lệ.',
        503,
      );
    }
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new AuthError(
        'BRIDGE_NOT_CONFIGURED',
        'Kết nối liên hệ thống yêu cầu HTTPS hoặc địa chỉ loopback.',
        503,
      );
    }
    return url.href.replace(/\/+$/, '');
  }

  private async requestRemote(
    pathname: string,
    body?: unknown,
  ): Promise<unknown> {
    const secret = this.getBridgeSecret();
    const baseUrl = this.getBaseUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(`${baseUrl}${pathname}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'x-hp-bridge-key': secret,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Remote request failed');
      const payload = (await res.json()) as {
        success?: boolean;
        data?: unknown;
      };
      if (
        payload?.success !== true ||
        !payload.data ||
        typeof payload.data !== 'object'
      ) {
        throw new Error('Invalid remote response');
      }
      return payload.data;
    } catch {
      throw new AuthError(
        'BRIDGE_UNAVAILABLE',
        'Không xác nhận được kết quả từ hệ thống bên kia. Hãy kiểm tra trạng thái trước khi thử lại.',
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchTikTokV4Summary(workspaceId: string): Promise<{
    reachable: boolean;
    source_url: string;
    summary: TikTokV4SummaryPayload;
  }> {
    const sourceUrl = this.getBaseUrl();
    try {
      const summary = await this.requestRemote('/api/bridge/summary');
      if (!isTikTokSummary(summary)) throw new Error('Invalid summary');
      const cache = readLocalBridgeCache(workspaceId);
      writeLocalBridgeCache(workspaceId, {
        last_synced_at: cache.last_synced_at,
        last_summary: summary,
      });
      return { reachable: true, source_url: sourceUrl, summary };
    } catch (error) {
      if (error instanceof AuthError && error.code === 'BRIDGE_NOT_CONFIGURED')
        throw error;
      const cached = readLocalBridgeCache(workspaceId);
      return {
        reachable: false,
        source_url: sourceUrl,
        summary: isTikTokSummary(cached.last_summary)
          ? cached.last_summary
          : createFallbackTikTokSummary(),
      };
    }
  }

  /**
   * GET /api/v1/bridge/public-summary
   * Lightweight public/loopback summary of Management Lite for hoaiphuong.click.
   */
  async getPublicSummary(): Promise<{
    system: string;
    domain: string;
    workspace_name: string;
    active_employees: number;
    active_work_items: number;
    today_reports: number;
    storage_connected: boolean;
  }> {
    try {
      const wsRes = await this.pool.query<{ id: string; name: string }>(
        `SELECT w.id, w.name
         FROM workspaces w
         WHERE w.status = 'active'
           AND w.name NOT ILIKE '%SYNTHETIC%'
           AND w.name NOT ILIKE '%NOT REAL DATA%'
         ORDER BY
           (SELECT COUNT(*) FROM employees e WHERE e.workspace_id = w.id AND e.employment_status = 'active') DESC,
           w.created_at ASC
         LIMIT 1`,
      );
      let ws = wsRes.rows[0];
      if (!ws) {
        const fallbackRes = await this.pool.query<{ id: string; name: string }>(
          `SELECT id, name FROM workspaces WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`,
        );
        ws = fallbackRes.rows[0];
      }
      if (!ws) {
        return {
          system: 'management-lite',
          domain: 'https://ql.hoaiphuong.click',
          workspace_name: 'Hoài Phương Studio',
          active_employees: 0,
          active_work_items: 0,
          today_reports: 0,
          storage_connected: false,
        };
      }

      const [empRes, workRes, repRes, driveRes] = await Promise.all([
        this.pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM employees WHERE workspace_id = $1 AND employment_status = 'active'`,
          [ws.id],
        ),
        this.pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM work_items WHERE workspace_id = $1 AND status NOT IN ('completed', 'cancelled')`,
          [ws.id],
        ),
        this.pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM daily_reports WHERE workspace_id = $1
             AND report_date = (NOW() AT TIME ZONE COALESCE(
               (SELECT timezone FROM workspaces WHERE id = $1), 'Asia/Ho_Chi_Minh'))::date`,
          [ws.id],
        ),
        this.pool
          .query<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt FROM storage_drive_connections WHERE workspace_id = $1 AND status = 'active'`,
            [ws.id],
          )
          .catch(() => ({ rows: [{ cnt: '0' }] })),
      ]);

      return {
        system: 'management-lite',
        domain: 'https://ql.hoaiphuong.click',
        workspace_name: normalizeStudioWorkspaceName(ws.name),
        active_employees: parseInt(empRes.rows[0]?.cnt ?? '0', 10) || 0,
        active_work_items: parseInt(workRes.rows[0]?.cnt ?? '0', 10) || 0,
        today_reports: parseInt(repRes.rows[0]?.cnt ?? '0', 10) || 0,
        storage_connected:
          (parseInt(driveRes.rows[0]?.cnt ?? '0', 10) || 0) > 0,
      };
    } catch {
      return {
        system: 'management-lite',
        domain: 'https://ql.hoaiphuong.click',
        workspace_name: 'Hoài Phương Studio',
        active_employees: 0,
        active_work_items: 0,
        today_reports: 0,
        storage_connected: false,
      };
    }
  }

  /**
   * GET /api/v1/bridge/tiktok-v4
   * Returns unified bridge status between ql.hoaiphuong.click and hoaiphuong.click.
   */
  async getTikTokV4Status(
    auth: AuthenticatedContext,
  ): Promise<BridgeStatusResponseData> {
    requireRole(['owner', 'admin', 'staff'], auth);

    const [remote, empRes, workRes, repRes, driveRes, wsRes] =
      await Promise.all([
        this.fetchTikTokV4Summary(auth.workspace.id),
        this.pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM employees WHERE workspace_id = $1 AND employment_status = 'active'`,
          [auth.workspace.id],
        ),
        this.pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM work_items WHERE workspace_id = $1 AND title LIKE '[TikTok V4]%'`,
          [auth.workspace.id],
        ),
        this.pool.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM daily_reports WHERE workspace_id = $1 AND notes LIKE '%hoaiphuong.click%'`,
          [auth.workspace.id],
        ),
        this.pool
          .query<{
            google_email: string;
            root_folder_id: string | null;
            status: string;
          }>(
            `SELECT google_email, root_folder_id, status
             FROM storage_drive_connections
             WHERE workspace_id = $1 AND status = 'active'
             ORDER BY updated_at DESC LIMIT 1`,
            [auth.workspace.id],
          )
          .catch(() => ({ rows: [] })),
        this.pool.query<{ name: string }>(
          `SELECT name FROM workspaces WHERE id = $1 LIMIT 1`,
          [auth.workspace.id],
        ),
      ]);

    const cache = readLocalBridgeCache(auth.workspace.id);
    const driveRow = driveRes.rows[0] ?? null;
    const activeEmployees = parseInt(empRes.rows[0]?.cnt ?? '0', 10) || 0;

    return {
      connected: remote.reachable,
      source_url: remote.source_url,
      target_domain: 'https://hoaiphuong.click',
      last_synced_at: cache.last_synced_at,
      tiktok_v4: remote.summary,
      management_lite: {
        workspace_id: auth.workspace.id,
        workspace_name: normalizeStudioWorkspaceName(wsRes.rows[0]?.name),
        active_employees: activeEmployees,
        synced_work_items: parseInt(workRes.rows[0]?.cnt ?? '0', 10) || 0,
        synced_daily_reports: parseInt(repRes.rows[0]?.cnt ?? '0', 10) || 0,
        storage_drive_connected:
          Boolean(driveRow) ||
          (remote.reachable &&
            Boolean(remote.summary.workspace.drive_root_folder_id)),
        storage_google_email:
          driveRow?.google_email ??
          remote.summary.workspace.google_account_email ??
          null,
        storage_root_folder_id:
          driveRow?.root_folder_id ??
          remote.summary.workspace.drive_root_folder_id ??
          null,
      },
    };
  }

  /**
   * POST /api/v1/bridge/tiktok-v4/sync
   * Executes full two-way synchronization:
   * 1. Active Employees & Accounts -> hoaiphuong.click (/api/bridge/sync-members)
   * 2. Recent scripts -> Work Items; daily reports await verified attribution
   * 3. Channels & Google Drive Root Folder -> Storage V2 metadata link
   */
  async syncWithTikTokV4(
    auth: AuthenticatedContext,
    requestId: string,
  ): Promise<BridgeSyncResultData> {
    requireRole(['owner', 'admin'], auth);

    // 1. Gather active employees & user accounts from PostgreSQL
    const empRows = await this.pool.query<{
      id: string;
      employee_code: string;
      full_name: string;
      employment_status: string;
      email: string | null;
      role: string | null;
    }>(
      `SELECT
         e.id,
         e.employee_code,
         e.full_name,
         e.employment_status,
         u.email_normalized AS email,
         m.role
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN workspace_memberships m ON m.workspace_id = e.workspace_id AND m.user_id = e.user_id
       WHERE e.workspace_id = $1 AND e.employment_status = 'active'
       ORDER BY e.created_at ASC`,
      [auth.workspace.id],
    );

    const wsRes = await this.pool.query<{ name: string }>(
      `SELECT name FROM workspaces WHERE id = $1 LIMIT 1`,
      [auth.workspace.id],
    );
    const workspaceName = wsRes.rows[0]?.name ?? 'Hoài Phương Studio';

    const driveRes = await this.pool
      .query<{ root_folder_id: string | null }>(
        `SELECT root_folder_id FROM storage_drive_connections
         WHERE workspace_id = $1 AND status = 'active'
         ORDER BY updated_at DESC LIMIT 1`,
        [auth.workspace.id],
      )
      .catch(() => ({ rows: [] }));
    const storageRootFolderId = driveRes.rows[0]?.root_folder_id ?? null;

    const employeesPayload = empRows.rows.flatMap((r) => {
      const email = r.email?.trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return [];
      return [
        {
          employee_code: r.employee_code,
          full_name: r.full_name,
          email,
          role: r.role ?? 'staff',
          employment_status: r.employment_status,
        },
      ];
    });

    // Validate the source before sending members or writing local business data.
    const remote = await this.fetchTikTokV4Summary(auth.workspace.id);
    if (!remote.reachable) {
      throw new AuthError(
        'BRIDGE_UNAVAILABLE',
        'Không lấy được dữ liệu nguồn mới. Chưa ghi dữ liệu đồng bộ.',
        502,
      );
    }
    const summary = remote.summary;
    const ack = (await this.requestRemote('/api/bridge/sync-members', {
      employees: employeesPayload,
      workspace_name: workspaceName,
      storage_root_folder_id: storageRootFolderId,
    })) as {
      synced_members?: unknown;
      auto_approved_accounts?: unknown;
      total_employees_received?: unknown;
      workspace_connected?: unknown;
    };
    if (
      !isCount(ack.synced_members) ||
      !isCount(ack.auto_approved_accounts) ||
      !isCount(ack.total_employees_received) ||
      ack.total_employees_received !== employeesPayload.length ||
      (employeesPayload.length > 0 && ack.workspace_connected !== true) ||
      ack.synced_members < employeesPayload.length ||
      ack.auto_approved_accounts > employeesPayload.length
    ) {
      throw new AuthError(
        'BRIDGE_UNCONFIRMED',
        'Phía nhận chưa xác nhận đầy đủ số nhân sự. Chưa ghi dữ liệu cục bộ; hãy kiểm tra trạng thái phía nhận.',
        502,
      );
    }
    const remoteSyncedMembers = ack.total_employees_received;
    const remoteAutoApproved = ack.auto_approved_accounts;
    // The summary has totals, not employee-attributed dated production events.
    // Never infer payroll/report entries from those totals or overwrite manual reports.
    const reportsSynced = 0;
    const warnings = [
      'Chưa tự ghi báo cáo sản lượng: dữ liệu nguồn chưa có ánh xạ nhân viên và ngày nghiệp vụ. Báo cáo hiện có được giữ nguyên.',
    ];
    const skippedEmployees = empRows.rows.length - employeesPayload.length;
    if (skippedEmployees > 0) {
      warnings.push(
        `Có ${skippedEmployees} nhân sự chưa đồng bộ vì chưa có email tài khoản hợp lệ.`,
      );
    }
    let workItemsSynced = 0;
    const localFailure = () =>
      new AuthError(
        'BRIDGE_LOCAL_SYNC_FAILED',
        'Phía nhận đã xác nhận nhân sự, nhưng chưa hoàn tất ghi công việc cục bộ. Hãy kiểm tra trạng thái trước khi thử lại.',
        503,
      );
    const client = await this.pool.connect().catch(() => {
      throw localFailure();
    });
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `tiktok-v4-bridge:${auth.workspace.id}`,
      ]);

      // Only source records become work items; totals never create synthetic work.
      const scripts = new Map(
        summary.recent_scripts.map((script) => [script.script_id, script]),
      );
      for (const script of scripts.values()) {
        const sourceMarker = `TikTok V4 source: ${encodeURIComponent(script.script_id)}`;
        const title =
          `[TikTok V4] Kịch bản: ${script.title || script.script_id}`.slice(
            0,
            190,
          );
        const existingWork = await client.query<{ id: string }>(
          `SELECT id FROM work_items WHERE workspace_id = $1
           AND (split_part(description, E'\\n', 1) = $2 OR (title = $3 AND description NOT LIKE 'TikTok V4 source:%')) LIMIT 1`,
          [auth.workspace.id, sourceMarker, title],
        );
        if (!existingWork.rows[0]) {
          await client.query(
            `INSERT INTO work_items (
               workspace_id, title, description, work_type, priority, status, created_by
             ) VALUES ($1, $2, $3, $4, 'high', 'in_progress', $5)`,
            [
              auth.workspace.id,
              title,
              `${sourceMarker}\nĐồng bộ từ hoaiphuong.click — Sản phẩm: ${script.product_id} | Kênh: ${script.channel_id} | Trạng thái: ${script.status}`,
              'content',
              auth.user.id,
            ],
          );
          workItemsSynced += 1;
        }
      }

      await recordAuditEvent(client, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'BRIDGE_TIKTOK_V4_SYNCED',
        entityType: 'workspace',
        entityId: auth.workspace.id,
        requestId,
        metadata: {
          target_domain: 'https://hoaiphuong.click',
          employees_synced: remoteSyncedMembers,
          auto_approved_accounts: remoteAutoApproved,
          reports_synced: reportsSynced,
          work_items_synced: workItemsSynced,
        },
      });

      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
      throw localFailure();
    } finally {
      client.release();
    }

    const syncedAt = new Date().toISOString();
    writeLocalBridgeCache(auth.workspace.id, {
      last_synced_at: syncedAt,
      last_summary: summary,
    });

    return {
      synced_at: syncedAt,
      employees_synced: remoteSyncedMembers,
      auto_approved_accounts: remoteAutoApproved,
      reports_synced: reportsSynced,
      work_items_synced: workItemsSynced,
      channels_linked: summary.counts.channels,
      drive_connected:
        Boolean(storageRootFolderId) ||
        Boolean(summary.workspace.drive_root_folder_id),
      target_domain: 'https://hoaiphuong.click',
      warnings,
    };
  }
}
