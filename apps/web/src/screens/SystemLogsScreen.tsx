import React, { useCallback, useEffect, useState } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  LoadingState,
  EmptyState,
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
  error: '#dc2626',
  warn: '#d97706',
  info: '#2563eb',
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
  border: '1px solid #cbd5e1',
  font: 'inherit',
  minWidth: 0,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid #e2e8f0',
  fontSize: 12,
  opacity: 0.75,
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #f1f5f9',
  fontSize: 13,
  verticalAlign: 'top',
};
const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
};

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success)
    throw new Error(
      body?.error?.message ?? `Lỗi tải dữ liệu (HTTP ${res.status}).`,
    );
  return body.data as T;
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
  const [detail, setDetail] = useState<Detail | null>(null);
  const [copied, setCopied] = useState(false);

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
      setSummary(s);
      setRows(l.items);
      setCursor(l.next_cursor);
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
    <div>
      <PageHeader
        title="Nhật ký hệ thống"
        subtitle="Lỗi máy chủ, lỗi trình duyệt, yêu cầu chậm — gom nhóm để tìm và sửa lỗi nhanh hơn"
        actions={
          <AppButton variant="secondary" onClick={() => onNavigate?.('/audit')}>
            Nhật ký kiểm toán
          </AppButton>
        }
      />

      <AppCard style={{ marginBottom: 16 }}>
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
          <AppButton size="sm" variant="secondary" onClick={() => void load()}>
            Làm mới
          </AppButton>
        </div>
      </AppCard>

      {loading ? (
        <LoadingState />
      ) : (
        <>
          {error && (
            <AppCard style={{ marginBottom: 16 }}>
              <p role="alert" style={{ color: '#b91c1c', margin: 0 }}>
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
                  <p style={{ color: '#16a34a' }}>
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
                  {rows.map((r) => (
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
                variant="secondary"
                onClick={() => void copy(detail)}
              >
                {copied ? 'Đã sao chép' : 'Sao chép báo cáo lỗi'}
              </AppButton>
              <AppButton
                size="sm"
                variant="secondary"
                onClick={() => onNavigate?.('/issues')}
              >
                Mở Sổ tay Issues
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
                  background: '#0f172a',
                  color: '#e2e8f0',
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
