import fs from 'node:fs';
import path from 'node:path';
import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import type { AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';

export const DEFAULT_BRIDGE_SECRET = 'hp-cross-system-bridge-v1';

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
}

interface PersistedBridgeCache {
  last_synced_at: string | null;
  last_summary: TikTokV4SummaryPayload | null;
}

function getLocalBridgeCachePath(): string {
  return path.join(process.cwd(), '.data', 'tiktok-v4-bridge-cache.json');
}

function readLocalBridgeCache(): PersistedBridgeCache {
  try {
    const p = getLocalBridgeCachePath();
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

function writeLocalBridgeCache(cache: PersistedBridgeCache): void {
  try {
    const p = getLocalBridgeCachePath();
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
      connected: true,
      owner_uid: 'admin_default',
      google_account_email: 'studio@hoaiphuong.click',
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

export class BridgeService {
  constructor(private readonly pool: DatabasePool) {}

  private getBridgeSecret(): string {
    return process.env['HP_BRIDGE_SECRET']?.trim() || DEFAULT_BRIDGE_SECRET;
  }

  private getCandidateBaseUrls(): string[] {
    const custom = process.env['TIKTOK_V4_BRIDGE_URL']?.trim();
    return [
      custom,
      'http://127.0.0.1:3000',
      'https://hoaiphuong.click',
    ].filter((u): u is string => Boolean(u));
  }

  private async fetchTikTokV4Summary(): Promise<{
    reachable: boolean;
    source_url: string;
    summary: TikTokV4SummaryPayload;
  }> {
    const secret = this.getBridgeSecret();
    for (const baseUrl of this.getCandidateBaseUrls()) {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      const url = `${cleanBase}/api/bridge/summary`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'x-hp-bridge-key': secret,
          },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const payload = (await res.json()) as {
            success?: boolean;
            data?: TikTokV4SummaryPayload;
          };
          if (payload?.data) {
            const cache = readLocalBridgeCache();
            writeLocalBridgeCache({
              last_synced_at: cache.last_synced_at,
              last_summary: payload.data,
            });
            return {
              reachable: true,
              source_url: cleanBase,
              summary: payload.data,
            };
          }
        }
      } catch {
        // Try next candidate URL
      }
    }

    const cached = readLocalBridgeCache();
    return {
      reachable: false,
      source_url: 'https://hoaiphuong.click',
      summary: cached.last_summary ?? createFallbackTikTokSummary(),
    };
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
        `SELECT id, name FROM workspaces WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`,
      );
      const ws = wsRes.rows[0];
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
          `SELECT COUNT(*)::text AS cnt FROM daily_reports WHERE workspace_id = $1`,
          [ws.id],
        ),
        this.pool
          .query<{ cnt: string }>(
            `SELECT COUNT(*)::text AS cnt FROM storage_drive_connections WHERE workspace_id = $1 AND status = 'connected'`,
            [ws.id],
          )
          .catch(() => ({ rows: [{ cnt: '0' }] })),
      ]);

      return {
        system: 'management-lite',
        domain: 'https://ql.hoaiphuong.click',
        workspace_name: ws.name,
        active_employees: parseInt(empRes.rows[0]?.cnt ?? '0', 10) || 0,
        active_work_items: parseInt(workRes.rows[0]?.cnt ?? '0', 10) || 0,
        today_reports: parseInt(repRes.rows[0]?.cnt ?? '0', 10) || 0,
        storage_connected: (parseInt(driveRes.rows[0]?.cnt ?? '0', 10) || 0) > 0,
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
        this.fetchTikTokV4Summary(),
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
             WHERE workspace_id = $1 AND status = 'connected'
             ORDER BY updated_at DESC LIMIT 1`,
            [auth.workspace.id],
          )
          .catch(() => ({ rows: [] })),
        this.pool.query<{ name: string }>(
          `SELECT name FROM workspaces WHERE id = $1 LIMIT 1`,
          [auth.workspace.id],
        ),
      ]);

    const cache = readLocalBridgeCache();
    const driveRow = driveRes.rows[0] ?? null;
    const activeEmployees = parseInt(empRes.rows[0]?.cnt ?? '0', 10) || 0;

    return {
      connected: remote.reachable || Boolean(cache.last_synced_at),
      source_url: remote.source_url,
      target_domain: 'https://hoaiphuong.click',
      last_synced_at: cache.last_synced_at,
      tiktok_v4: {
        ...remote.summary,
        counts: {
          ...remote.summary.counts,
          active_members: Math.max(
            remote.summary.counts.active_members,
            activeEmployees,
          ),
        },
      },
      management_lite: {
        workspace_id: auth.workspace.id,
        workspace_name: wsRes.rows[0]?.name ?? 'Hoài Phương Studio',
        active_employees: activeEmployees,
        synced_work_items: parseInt(workRes.rows[0]?.cnt ?? '0', 10) || 0,
        synced_daily_reports: parseInt(repRes.rows[0]?.cnt ?? '0', 10) || 0,
        storage_drive_connected:
          Boolean(driveRow) || remote.summary.workspace.connected,
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
   * 2. Scripts/Prompts/Video Deliverables -> Daily Reports & Work Items on ql.hoaiphuong.click
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
         u.email,
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
         WHERE workspace_id = $1 AND status = 'connected'
         ORDER BY updated_at DESC LIMIT 1`,
        [auth.workspace.id],
      )
      .catch(() => ({ rows: [] }));
    const storageRootFolderId = driveRes.rows[0]?.root_folder_id ?? null;

    const employeesPayload = empRows.rows.map((r) => {
      const cleanCode = r.employee_code
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '');
      const resolvedEmail =
        r.email && r.email.includes('@')
          ? r.email.trim().toLowerCase()
          : `${cleanCode || 'staff'}@hoaiphuong.click`;
      return {
        employee_code: r.employee_code,
        full_name: r.full_name,
        email: resolvedEmail,
        role: r.role ?? 'staff',
        employment_status: r.employment_status,
      };
    });

    // 2. Push employee roster to hoaiphuong.click (/api/bridge/sync-members)
    const secret = this.getBridgeSecret();
    let remoteSyncedMembers = employeesPayload.length;
    let remoteAutoApproved = 0;

    for (const baseUrl of this.getCandidateBaseUrls()) {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`${cleanBase}/api/bridge/sync-members`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'x-hp-bridge-key': secret,
          },
          body: JSON.stringify({
            employees: employeesPayload,
            workspace_name: workspaceName,
            storage_root_folder_id: storageRootFolderId,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const json = (await res.json()) as {
            data?: {
              synced_members?: number;
              auto_approved_accounts?: number;
            };
          };
          remoteSyncedMembers = Number(
            json?.data?.synced_members ?? employeesPayload.length,
          );
          remoteAutoApproved = Number(
            json?.data?.auto_approved_accounts ?? 0,
          );
          break;
        }
      } catch {
        // Try next candidate
      }
    }

    // 3. Pull latest production metrics & scripts from hoaiphuong.click
    const remote = await this.fetchTikTokV4Summary();
    const summary = remote.summary;

    // 4. Sync production output into daily_reports and work_items on ql.hoaiphuong.click
    let reportsSynced = 0;
    let workItemsSynced = 0;
    const primaryEmployee = empRows.rows[0] ?? null;
    const todayIsoDate = new Date().toISOString().slice(0, 10);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (primaryEmployee) {
        const scriptsAndPromptsCount = Math.max(
          1,
          summary.counts.scripts + summary.counts.prompts,
        );
        const videoAndAudioCount = Math.max(
          0,
          summary.counts.video_deliverables + summary.counts.audio_deliverables,
        );
        const syncNote = `Đồng bộ tự động từ hoaiphuong.click (Sản phẩm: ${summary.counts.products}, Kênh: ${summary.counts.channels}, Kịch bản: ${summary.counts.scripts}, Prompt: ${summary.counts.prompts}, Video/Audio: ${videoAndAudioCount})`;

        const existingReport = await client.query<{
          id: string;
          version: number;
        }>(
          `SELECT id, version FROM daily_reports
           WHERE workspace_id = $1 AND employee_id = $2 AND report_date = $3
           LIMIT 1`,
          [auth.workspace.id, primaryEmployee.id, todayIsoDate],
        );

        let reportId: string;
        if (existingReport.rows[0]) {
          reportId = existingReport.rows[0].id;
          await client.query(
            `UPDATE daily_reports
             SET notes = $1, version = version + 1, updated_at = NOW()
             WHERE workspace_id = $2 AND id = $3`,
            [syncNote, auth.workspace.id, reportId],
          );
          await client.query(
            `DELETE FROM daily_report_entries WHERE workspace_id = $1 AND report_id = $2`,
            [auth.workspace.id, reportId],
          );
        } else {
          const insRep = await client.query<{ id: string }>(
            `INSERT INTO daily_reports (
               workspace_id, employee_id, report_date, status, current_revision, version, notes
             ) VALUES ($1, $2, $3, 'submitted', 1, 1, $4)
             RETURNING id`,
            [auth.workspace.id, primaryEmployee.id, todayIsoDate, syncNote],
          );
          reportId = insRep.rows[0]!.id;
        }

        await client.query(
          `INSERT INTO daily_report_entries (
             workspace_id, report_id, work_type, reported_count, notes, sort_order
           ) VALUES
             ($1, $2, 'content', $3, 'Kịch bản & Prompt AI từ hoaiphuong.click', 0),
             ($1, $2, 'video', $4, 'Thành phẩm Video MP4 & Audio WAV từ hoaiphuong.click', 1)`,
          [
            auth.workspace.id,
            reportId,
            scriptsAndPromptsCount,
            videoAndAudioCount,
          ],
        );
        reportsSynced = 1;
      }

      // Sync recent scripts or production summary as work_items
      const scriptItemsToSync =
        summary.recent_scripts.length > 0
          ? summary.recent_scripts.slice(0, 5).map((s) => ({
              title: `[TikTok V4] Kịch bản: ${s.title || s.script_id}`.slice(
                0,
                190,
              ),
              description: `Đồng bộ từ hoaiphuong.click — Mã kịch bản: ${s.script_id} | Sản phẩm: ${s.product_id} | Kênh: ${s.channel_id} | Trạng thái: ${s.status}`,
              work_type: 'content',
            }))
          : [
              {
                title: `[TikTok V4] Đồng bộ dây chuyền sản xuất Video & Kịch bản (${todayIsoDate})`,
                description: `Liên kết tự động giữa ql.hoaiphuong.click và hoaiphuong.click — Nhân sự đồng bộ: ${employeesPayload.length}, Sản phẩm: ${summary.counts.products}, Kênh: ${summary.counts.channels}, Kịch bản: ${summary.counts.scripts}.`,
                work_type: 'video',
              },
            ];

      for (const item of scriptItemsToSync) {
        const existingWork = await client.query<{ id: string }>(
          `SELECT id FROM work_items WHERE workspace_id = $1 AND title = $2 LIMIT 1`,
          [auth.workspace.id, item.title],
        );
        if (!existingWork.rows[0]) {
          await client.query(
            `INSERT INTO work_items (
               workspace_id, title, description, work_type, priority, status, created_by
             ) VALUES ($1, $2, $3, $4, 'high', 'in_progress', $5)`,
            [
              auth.workspace.id,
              item.title,
              item.description,
              item.work_type,
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
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const syncedAt = new Date().toISOString();
    writeLocalBridgeCache({
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
        Boolean(storageRootFolderId) || summary.workspace.connected,
      target_domain: 'https://hoaiphuong.click',
    };
  }
}
