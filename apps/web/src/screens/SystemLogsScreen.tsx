import React, { useCallback, useEffect, useState } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  LoadingState,
  EmptyState,
  Pagination,
  DEFAULT_PAGE_SIZE,
  useAutoDismiss,
} from '../../../../packages/ui/src/components/index.js';
import type { UserRole } from '../types.js';

export interface SystemLogsScreenProps {
  role?: UserRole;
  onNavigate?: (path: string) => void;
}

type Level = 'info' | 'warn' | 'error';
interface LogRow {
  id: string;
  occurred_at: string;
  level: Level;
  source: 'api' | 'web';
  request_id: string | null;
  method: string | null;
  route: string | null;
  status: number | null;
  duration_ms: number | null;
  error_code: string | null;
  message: string;
  stack?: string | null;
  fingerprint: string;
  release: string | null;
  user_id: string | null;
  metadata: Record<string, unknown>;
}
interface TopError {
  fingerprint: string;
  count: number;
  users: number;
  first_seen: string;
  last_seen: string;
  message: string;
  route: string | null;
  error_code: string | null;
  status: number | null;
  source: string;
}
interface Summary {
  hours: number;
  totals: { error: number; warn: number; info: number; slow: number };
  timeline: { bucket: string; level: Level; count: number }[];
  top_errors: TopError[];
  top_routes: {
    route: string;
    count: number;
    server_errors: number;
    avg_ms: number | null;
  }[];
  retention_days: number;
}
interface Detail {
  log: LogRow;
  related_audit_events: {
    id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    created_at: string;
  }[];
  same_request_logs: {
    id: string;
    occurred_at: string;
    level: Level;
    message: string;
    status: number | null;
  }[];
  occurrences: { count: number; first_seen: string; last_seen: string } | null;
}

const RANGES: { hours: number; label: string }[] = [
  { hours: 1, label: '1 giờ' },
  { hours: 24, label: '24 giờ' },
  { hours: 168, label: '7 ngày' },
  { hours: 720, label: '30 ngày' },
];
const LEVEL_COLOR: Record<Level, string> = {
  error: 'var(--danger-text, #dc2626)',
  warn: 'var(--warning-text, #d97706)',
  info: 'var(--info-text, #2563eb)',
};
const LEVEL_LABEL: Record<Level, string> = {
  error: 'Lỗi',
  warn: 'Cảnh báo',
  info: 'Thông tin',
};
const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleString('vi-VN', { hour12: false });

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
  gap: 12,
};
const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
  minWidth: 0,
};
const input: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-color, #334155)',
  backgroundColor: 'var(--bg-color, #0B1220)',
  color: 'var(--text-color, #F8FAFC)',
  font: 'inherit',
  minWidth: 0,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid var(--border-color, #334155)',
  fontSize: 12,
  opacity: 0.85,
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border-color, #334155)',
  fontSize: 13,
  verticalAlign: 'top',
};
const mono: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success)
    throw new Error(
      body?.error?.message ?? `Lỗi tải dữ liệu (HTTP ${res.status}).`,
    );
  return body.data as T;
}

async function fetchCsrfToken(): Promise<string> {
  try {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    if (!res.ok) return '';
    const body = (await res.json().catch(() => null)) as {
      data?: { csrf_token?: string };
    } | null;
    return body?.data?.csrf_token ?? '';
  } catch {
    return '';
  }
}

export const SystemLogsScreen: React.FC<SystemLogsScreenProps> = ({
  role = 'owner',
  onNavigate,
}) => {
  const [hours, setHours] = useState(24);
  const [level, setLevel] = useState('');
  const [source, setSource] = useState('');
  const [statusMin, setStatusMin] = useState('');
  const [route, setRoute] = useState('');
  const [text, setText] = useState('');
  const [requestId, setRequestId] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [auto, setAuto] = useState(false);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [lastAiPrompt, setLastAiPrompt] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  useAutoDismiss(actionNotice, () => setActionNotice(null), 4000);
  useAutoDismiss(copied, () => setCopied(false), 3000);

  const query = useCallback(
    (extra?: string) => {
      const q = new URLSearchParams({
        from: new Date(Date.now() - hours * 3600 * 1000).toISOString(),
        limit: '50',
      });
      if (level) q.set('level', level);
      if (source) q.set('source', source);
      if (statusMin) q.set('status_min', statusMin);
      if (route.trim()) q.set('route', route.trim());
      if (text.trim()) q.set('q', text.trim());
      if (requestId.trim()) q.set('request_id', requestId.trim());
      if (fingerprint) q.set('fingerprint', fingerprint);
      if (extra) q.set('cursor', extra);
      return q.toString();
    },
    [hours, level, source, statusMin, route, text, requestId, fingerprint],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, l] = await Promise.all([
        api<Summary>(`/api/v1/system/logs/summary?hours=${hours}`),
        api<{ items: LogRow[]; next_cursor: string | null }>(
          `/api/v1/system/logs?${query()}`,
        ),
      ]);
      setSummary(s && typeof s === 'object' && 'counts' in s ? s : null);
      setRows(Array.isArray(l?.items) ? l.items : []);
      setCursor(l?.next_cursor ?? null);
      setPage(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được nhật ký.');
    } finally {
      setLoading(false);
    }
  }, [hours, query]);

  useEffect(() => {
    if (role === 'owner') {
      setLoading(true);
      void load();
    }
  }, [load, role]);

  useEffect(() => {
    if (!auto || role !== 'owner') return;
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [auto, load, role]);

  if (role !== 'owner') {
    return (
      <EmptyState
        title="Chỉ dành cho Chủ sở hữu"
        description="Nhật ký hệ thống chứa thông tin kỹ thuật nên chỉ Owner được xem."
      />
    );
  }

  const more = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const l = await api<{ items: LogRow[]; next_cursor: string | null }>(
        `/api/v1/system/logs?${query(cursor)}`,
      );
      setRows((r) => [...r, ...l.items]);
      setCursor(l.next_cursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải thêm được.');
    } finally {
      setLoadingMore(false);
    }
  };

  const open = async (id: string) => {
    setCopied(false);
    try {
      setDetail(await api<Detail>(`/api/v1/system/logs/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không mở được chi tiết.');
    }
  };

  const handleDismissGroup = async (fp: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setBusyKey(`dismiss:${fp}`);
    setError(null);
    setActionNotice(null);
    try {
      const csrf = await fetchCsrfToken();
      const res = await api<{ deleted_count: number }>(
        `/api/v1/system/logs?fingerprint=${encodeURIComponent(fp)}`,
        {
          method: 'DELETE',
          headers: csrf ? { 'x-csrf-token': csrf } : {},
        },
      );
      if (fingerprint === fp) setFingerprint('');
      if (detail?.log.fingerprint === fp) setDetail(null);
      setActionNotice(
        `Đã đánh dấu xử lý và ẩn nhóm lỗi (${res.deleted_count} bản ghi).`,
      );
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Không xóa được nhóm lỗi này.',
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleClearResolvedLogs = async () => {
    setBusyKey('clear:all');
    setError(null);
    setActionNotice(null);
    try {
      const csrf = await fetchCsrfToken();
      const res = await api<{ deleted_count: number }>(`/api/v1/system/logs`, {
        method: 'DELETE',
        headers: csrf ? { 'x-csrf-token': csrf } : {},
      });
      setFingerprint('');
      setDetail(null);
      setActionNotice(
        `Đã dọn sạch ${res.deleted_count} nhật ký lỗi cũ đã xử lý.`,
      );
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Không dọn được nhật ký lỗi cũ.',
      );
    } finally {
      setBusyKey(null);
    }
  };

  const copyTextSafe = async (value: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Fallback below
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const handleEscalateError = async (
    payload: { fingerprint?: string; log_id?: string },
    e?: React.MouseEvent,
  ) => {
    e?.stopPropagation();
    const key = `escalate:${payload.fingerprint || payload.log_id || ''}`;
    setBusyKey(key);
    setError(null);
    setActionNotice(null);
    setLastAiPrompt(null);
    try {
      const csrf = await fetchCsrfToken();
      const res = await api<{
        issue_id: string | null;
        bug_code: string | null;
        ai_fix_prompt: string;
        deduplicated: boolean;
      }>('/api/v1/system/logs/escalate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        body: JSON.stringify(payload),
      });
      setLastAiPrompt(res.ai_fix_prompt);
      await copyTextSafe(res.ai_fix_prompt);
      setActionNotice(
        `${res.deduplicated ? 'Đã liên kết phiếu sẵn có' : 'Đã tạo phiếu mới'} ${res.bug_code ?? ''} trong Sổ tay lỗi & sao chép sẵn lệnh Yêu cầu AI sửa vào Clipboard! Anh chỉ cần dán (Ctrl+V) vào khung chat cho AI.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Không thể tạo yêu cầu sửa lỗi lúc này.',
      );
    } finally {
      setBusyKey(null);
    }
  };

  const reportText = (d: Detail): string => {
    const l = d.log;
    return [
      `[${LEVEL_LABEL[l.level]}] ${l.message}`,
      `Thời gian: ${fmtTime(l.occurred_at)}`,
      `Nguồn: ${l.source === 'web' ? 'Trình duyệt' : 'API'} | Phiên bản: ${l.release ?? '—'}`,
      `Yêu cầu: ${l.method ?? ''} ${l.route ?? ''} → ${l.status ?? '—'} (${l.duration_ms ?? '—'} ms)`,
      `Mã lỗi: ${l.error_code ?? '—'} | Request ID: ${l.request_id ?? '—'}`,
      `Số lần gặp: ${d.occurrences?.count ?? 1} (lần đầu ${d.occurrences ? fmtTime(d.occurrences.first_seen) : '—'})`,
      d.related_audit_events.length
        ? `Hành động liên quan: ${d.related_audit_events.map((a) => a.action).join(', ')}`
        : '',
      l.stack ? `\nStack:\n${l.stack}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const copy = async (d: Detail) => {
    try {
      await navigator.clipboard.writeText(reportText(d));
      setCopied(true);
    } catch {
      setError('Không sao chép được vào clipboard.');
    }
  };

  const maxBucket = Math.max(
    1,
    ...Object.values(
      (summary?.timeline ?? []).reduce<Record<string, number>>((acc, t) => {
        acc[t.bucket] = (acc[t.bucket] ?? 0) + t.count;
        return acc;
      }, {}),
    ),
  );
  const buckets = [...new Set((summary?.timeline ?? []).map((t) => t.bucket))];

  return (
    <div style={{ width: '100%' }}>
      <PageHeader
        title="Nhật ký hệ thống"
        subtitle="Lỗi máy chủ, lỗi trình duyệt, yêu cầu chậm — gom nhóm để tìm và yêu cầu AI sửa lỗi 1 chạm"
      />

      <AppCard style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {RANGES.map((r) => (
              <AppButton
                key={r.hours}
                size="sm"
                variant={hours === r.hours ? 'primary' : 'secondary'}
                onClick={() => setHours(r.hours)}
              >
                {r.label}
              </AppButton>
            ))}
            <label style={{ fontSize: 13, marginLeft: 8 }}>
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => setAuto(e.target.checked)}
              />{' '}
              Tự làm mới (15 giây)
            </label>
            <AppButton
              size="sm"
              variant="secondary"
              onClick={() => void load()}
            >
              Làm mới
            </AppButton>
          </div>

          <AppButton
            size="sm"
            variant="secondary"
            data-testid="btn-clear-resolved-logs"
            disabled={busyKey === 'clear:all'}
            onClick={() => void handleClearResolvedLogs()}
          >
            {busyKey === 'clear:all' ? 'Đang dọn log…' : '🧹 Dọn sạch log cũ'}
          </AppButton>
        </div>
      </AppCard>

      {actionNotice && (
        <AppCard
          style={{
            marginBottom: 16,
            border: '1px solid rgba(16, 185, 129, 0.4)',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <p
              role="status"
              style={{
                color: 'var(--success-text, #10b981)',
                margin: 0,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              ✓ {actionNotice}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {lastAiPrompt && (
                <AppButton
                  size="sm"
                  variant="primary"
                  onClick={() => void copyTextSafe(lastAiPrompt)}
                >
                  📋 Sao chép lại lệnh AI
                </AppButton>
              )}
              <AppButton
                size="sm"
                variant="secondary"
                onClick={() => onNavigate?.('/issues')}
              >
                Xem trong Sổ tay lỗi
              </AppButton>
            </div>
          </div>
          {lastAiPrompt && (
            <pre
              style={{
                marginTop: 10,
                marginBottom: 0,
                padding: 10,
                borderRadius: 8,
                backgroundColor: 'rgba(15, 23, 42, 0.45)',
                color: 'var(--text-primary, #f8fafc)',
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {lastAiPrompt}
            </pre>
          )}
        </AppCard>
      )}

      {loading ? (
        <LoadingState />
      ) : (
        <>
          {error && (
            <AppCard style={{ marginBottom: 16 }}>
              <p
                role="alert"
                style={{ color: 'var(--danger-text, #dc2626)', margin: 0 }}
              >
                {error}
              </p>
            </AppCard>
          )}
          {summary && (
            <>
              <div style={{ ...grid, marginBottom: 16 }}>
                <AppCard>
                  <strong style={{ color: LEVEL_COLOR.error, fontSize: 22 }}>
                    {summary.totals.error}
                  </strong>
                  <div>Lỗi</div>
                </AppCard>
                <AppCard>
                  <strong style={{ color: LEVEL_COLOR.warn, fontSize: 22 }}>
                    {summary.totals.warn}
                  </strong>
                  <div>Cảnh báo (4xx, chậm)</div>
                </AppCard>
                <AppCard>
                  <strong style={{ fontSize: 22 }}>
                    {summary.totals.slow}
                  </strong>
                  <div>Yêu cầu chậm ≥ 3 giây</div>
                </AppCard>
                <AppCard>
                  <strong style={{ fontSize: 22 }}>
                    {summary.top_errors.length}
                  </strong>
                  <div>Nhóm lỗi khác nhau</div>
                </AppCard>
              </div>

              {buckets.length > 0 && (
                <AppCard style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>
                    Diễn biến theo thời gian
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-end',
                      gap: 2,
                      height: 64,
                      overflowX: 'auto',
                    }}
                  >
                    {buckets.map((b) => {
                      const items = summary.timeline.filter(
                        (t) => t.bucket === b,
                      );
                      const total = items.reduce((t, i) => t + i.count, 0);
                      return (
                        <div
                          key={b}
                          title={`${fmtTime(b)}: ${items.map((i) => `${LEVEL_LABEL[i.level]} ${i.count}`).join(', ')}`}
                          style={{
                            flex: '1 0 6px',
                            minWidth: 6,
                            height: `${Math.max(6, (total / maxBucket) * 100)}%`,
                            background: items.some((i) => i.level === 'error')
                              ? LEVEL_COLOR.error
                              : LEVEL_COLOR.warn,
                            borderRadius: 2,
                          }}
                        />
                      );
                    })}
                  </div>
                </AppCard>
              )}

              <AppCard style={{ marginBottom: 16, overflowX: 'auto' }}>
                <h3 style={{ marginTop: 0 }}>Lỗi lặp lại nhiều nhất</h3>
                {summary.top_errors.length === 0 ? (
                  <p style={{ color: 'var(--success-text, #16a34a)' }}>
                    Không có lỗi hay cảnh báo trong khoảng này.
                  </p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>Lỗi & nơi xảy ra</th>
                        <th style={{ ...th, textAlign: 'right' }}>Số lần</th>
                        <th style={{ ...th, textAlign: 'right' }}>
                          Người dùng
                        </th>
                        <th style={th}>Lần cuối</th>
                        <th style={th}>Xử lý nhanh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.top_errors.map((t) => (
                        <tr
                          key={t.fingerprint}
                          style={{ cursor: 'pointer' }}
                          onClick={() =>
                            setFingerprint(
                              fingerprint === t.fingerprint
                                ? ''
                                : t.fingerprint,
                            )
                          }
                          aria-selected={fingerprint === t.fingerprint}
                        >
                          <td style={td}>
                            <strong>
                              {t.error_code ?? `HTTP ${t.status ?? ''}`}
                            </strong>
                            <div style={{ opacity: 0.85 }}>
                              {t.message.slice(0, 120)}
                            </div>
                            <div
                              style={{
                                ...mono,
                                opacity: 0.75,
                                marginTop: 2,
                                wordBreak: 'break-word',
                              }}
                            >
                              {t.source === 'web' ? '🌐 ' : ''}
                              {t.route ?? '—'}
                            </div>
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <strong>{t.count}</strong>
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            {t.users}
                          </td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>
                            {fmtTime(t.last_seen)}
                          </td>
                          <td style={td} onClick={(e) => e.stopPropagation()}>
                            <div
                              style={{
                                display: 'flex',
                                gap: 6,
                                flexWrap: 'wrap',
                              }}
                            >
                              <AppButton
                                size="sm"
                                variant="primary"
                                data-testid="btn-escalate-error"
                                disabled={
                                  busyKey === `escalate:${t.fingerprint}`
                                }
                                onClick={(e) =>
                                  void handleEscalateError(
                                    { fingerprint: t.fingerprint },
                                    e,
                                  )
                                }
                              >
                                {busyKey === `escalate:${t.fingerprint}`
                                  ? 'Đang tạo…'
                                  : '🔧 Yêu cầu AI sửa'}
                              </AppButton>
                              <AppButton
                                size="sm"
                                variant="secondary"
                                data-testid="btn-dismiss-error"
                                disabled={
                                  busyKey === `dismiss:${t.fingerprint}`
                                }
                                onClick={(e) =>
                                  void handleDismissGroup(t.fingerprint, e)
                                }
                              >
                                ✓ Đã xử lý
                              </AppButton>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {fingerprint && (
                  <p style={{ fontSize: 12 }}>
                    Đang lọc theo một nhóm lỗi.{' '}
                    <button type="button" onClick={() => setFingerprint('')}>
                      Bỏ lọc
                    </button>
                  </p>
                )}
              </AppCard>
            </>
          )}

          <AppCard style={{ marginBottom: 16 }}>
            <div style={grid}>
              <label style={field}>
                Mức độ
                <select
                  style={input}
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                >
                  <option value="">Tất cả</option>
                  <option value="error">Lỗi</option>
                  <option value="warn">Cảnh báo</option>
                </select>
              </label>
              <label style={field}>
                Nguồn
                <select
                  style={input}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="">Tất cả</option>
                  <option value="api">API (máy chủ)</option>
                  <option value="web">Trình duyệt</option>
                </select>
              </label>
              <label style={field}>
                Mã HTTP từ
                <select
                  style={input}
                  value={statusMin}
                  onChange={(e) => setStatusMin(e.target.value)}
                >
                  <option value="">Tất cả</option>
                  <option value="400">≥ 400</option>
                  <option value="500">≥ 500</option>
                </select>
              </label>
              <label style={field}>
                Đường dẫn
                <input
                  style={input}
                  value={route}
                  placeholder="/api/v1/payroll"
                  onChange={(e) => setRoute(e.target.value)}
                />
              </label>
              <label style={field}>
                Tìm nội dung / mã lỗi
                <input
                  style={input}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <label style={field}>
                Request ID
                <input
                  style={input}
                  value={requestId}
                  onChange={(e) => setRequestId(e.target.value)}
                />
              </label>
            </div>
          </AppCard>

          {rows.length === 0 ? (
            <EmptyState
              title="Không có nhật ký phù hợp"
              description="Chỉ ghi lỗi (4xx, 5xx), yêu cầu chậm ≥ 3 giây và lỗi trình duyệt. Nhật ký giữ 30 ngày."
            />
          ) : (
            <AppCard style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Mức / Mã</th>
                    <th style={th}>Nội dung & yêu cầu</th>
                    <th style={th}>Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .slice(page * pageSize, (page + 1) * pageSize)
                    .map((r) => (
                      <tr
                        key={r.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => void open(r.id)}
                      >
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <div
                            style={{
                              color: LEVEL_COLOR[r.level],
                              fontWeight: 600,
                            }}
                          >
                            {LEVEL_LABEL[r.level]}
                          </div>
                          <div style={{ ...mono, opacity: 0.8 }}>
                            {r.status ?? r.error_code ?? ''}
                          </div>
                        </td>
                        <td style={{ ...td, wordBreak: 'break-word' }}>
                          <div>
                            {r.error_code && <strong>{r.error_code}: </strong>}
                            {r.message.slice(0, 140)}
                          </div>
                          <div
                            style={{
                              ...mono,
                              opacity: 0.75,
                              marginTop: 2,
                            }}
                          >
                            {r.source === 'web' ? '🌐 ' : ''}
                            {r.method} {r.route}
                            {r.duration_ms !== null
                              ? ` · ${r.duration_ms} ms`
                              : ''}
                          </div>
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          {fmtTime(r.occurred_at)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <div style={{ marginTop: 12 }}>
                <Pagination
                  testId="system-logs-pagination"
                  total={rows.length}
                  hasNext={Boolean(cursor)}
                  itemCount={
                    rows.slice(page * pageSize, (page + 1) * pageSize).length
                  }
                  page={page}
                  pageSize={pageSize}
                  onPage={(nextPage) => {
                    setPage(nextPage);
                    if ((nextPage + 1) * pageSize > rows.length && cursor) {
                      void more();
                    }
                  }}
                  onPageSize={(sz) => {
                    setPageSize(sz);
                    setPage(0);
                  }}
                  loading={loading || loadingMore}
                />
              </div>
              {cursor && (
                <div style={{ marginTop: 12 }}>
                  <AppButton
                    variant="secondary"
                    isLoading={loadingMore}
                    onClick={() => void more()}
                  >
                    Tải thêm
                  </AppButton>
                </div>
              )}
            </AppCard>
          )}
        </>
      )}

      {detail && (
        <AppCard style={{ marginTop: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <h3 style={{ margin: 0 }}>
              <span style={{ color: LEVEL_COLOR[detail.log.level] }}>
                {LEVEL_LABEL[detail.log.level]}
              </span>{' '}
              {detail.log.error_code ?? ''}
            </h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <AppButton
                size="sm"
                variant="primary"
                onClick={(e) =>
                  void handleEscalateError({ log_id: detail.log.id }, e)
                }
              >
                🔧 Yêu cầu AI sửa & Copy lệnh
              </AppButton>
              <AppButton
                size="sm"
                variant="secondary"
                onClick={() => void copy(detail)}
              >
                {copied ? 'Đã sao chép' : 'Sao chép báo cáo lỗi'}
              </AppButton>
              <AppButton
                size="sm"
                variant="secondary"
                onClick={(e) =>
                  void handleDismissGroup(detail.log.fingerprint, e)
                }
              >
                ✓ Đã xử lý / Ẩn nhóm lỗi
              </AppButton>
              <AppButton
                size="sm"
                variant="quiet"
                onClick={() => setDetail(null)}
              >
                Đóng
              </AppButton>
            </div>
          </div>
          <p>{detail.log.message}</p>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              gap: '4px 12px',
              fontSize: 13,
            }}
          >
            <dt>Thời gian</dt>
            <dd>{fmtTime(detail.log.occurred_at)}</dd>
            <dt>Nguồn</dt>
            <dd>
              {detail.log.source === 'web' ? 'Trình duyệt' : 'API'} · phiên bản{' '}
              {detail.log.release ?? '—'}
            </dd>
            <dt>Yêu cầu</dt>
            <dd style={mono}>
              {detail.log.method} {detail.log.route} →{' '}
              {detail.log.status ?? '—'} ({detail.log.duration_ms ?? '—'} ms)
            </dd>
            <dt>Request ID</dt>
            <dd style={mono}>
              {detail.log.request_id ?? '—'}{' '}
              {detail.log.request_id && (
                <button
                  type="button"
                  onClick={() => {
                    setRequestId(detail.log.request_id!);
                    setDetail(null);
                  }}
                  style={{
                    marginLeft: 6,
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--surface-hover)',
                    color: 'var(--text-color)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Lọc theo ID
                </button>
              )}
            </dd>
            <dt>Số lần gặp</dt>
            <dd>
              {detail.occurrences
                ? `${detail.occurrences.count} lần (${fmtTime(detail.occurrences.first_seen)} → ${fmtTime(detail.occurrences.last_seen)})`
                : '1 lần'}{' '}
              <button
                type="button"
                onClick={() => {
                  setFingerprint(detail.log.fingerprint);
                  setDetail(null);
                }}
                style={{
                  marginLeft: 6,
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-hover)',
                  color: 'var(--text-color)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Xem tất cả
              </button>
            </dd>
          </dl>
          {detail.related_audit_events.length > 0 && (
            <>
              <h4>Hành động đã ghi trong cùng yêu cầu (audit)</h4>
              <ul>
                {detail.related_audit_events.map((a) => (
                  <li key={a.id}>
                    <span style={mono}>{a.action}</span> — {a.entity_type}{' '}
                    {a.entity_id}
                  </li>
                ))}
              </ul>
            </>
          )}
          {detail.same_request_logs.length > 0 && (
            <>
              <h4>Nhật ký khác cùng yêu cầu</h4>
              <ul>
                {detail.same_request_logs.map((s) => (
                  <li key={s.id}>
                    {fmtTime(s.occurred_at)} — {s.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {detail.log.stack && (
            <>
              <h4>Stack</h4>
              <pre
                style={{
                  ...mono,
                  overflowX: 'auto',
                  background: 'var(--surface-subtle)',
                  color: 'var(--text-color)',
                  padding: 12,
                  borderRadius: 8,
                }}
              >
                {detail.log.stack}
              </pre>
            </>
          )}
          {Object.keys(detail.log.metadata ?? {}).length > 0 && (
            <pre style={{ ...mono, overflowX: 'auto' }}>
              {JSON.stringify(detail.log.metadata, null, 2)}
            </pre>
          )}
        </AppCard>
      )}
    </div>
  );
};
