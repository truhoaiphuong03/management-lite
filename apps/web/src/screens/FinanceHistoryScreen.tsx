import { useEffect, useState, useMemo } from 'react';
import type {
  FinancePage,
  FinanceEntryData,
  FinanceCategoryData,
} from '../../../../packages/contracts/src/finance.js';
import {
  AppButton,
  AppCard,
  AppBadge,
  AppSkeleton,
  TOKENS,
} from '../../../../packages/ui/src/index.js';
import {
  FinanceNav,
  FinanceHeader,
  useNarrow,
  ReadStatus,
  useFinanceRead,
  financePageStyle,
  fieldStyle,
  FinancePager,
  pageCount,
  type FinanceScreenProps,
  FinanceIconButton,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
} from '../finance/ui.js';
import { formatVnd, loadCategoryPages } from '../finance/client.js';
export function FinanceHistoryScreen(props: FinanceScreenProps) {
  return (
    <FinanceHistoryInner
      key={`${props.identity.userId}:${props.identity.workspaceId}`}
      {...props}
    />
  );
}
function FinanceHistoryInner({ identity, onNavigate }: FinanceScreenProps) {
  const [direction, setDirection] = useState('');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [snap, setSnap] = useState<FinancePage<FinanceEntryData> | null>(null);
  const q = new URLSearchParams({
    limit: String(pageSize),
    offset: String(page * pageSize),
  });
  if (direction) q.set('direction', direction);
  if (category) q.set('category_id', category);
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const r = useFinanceRead<FinancePage<FinanceEntryData>>(
    identity,
    '/entries?' + q,
  );
  const catBinding = `${identity.userId}:${identity.workspaceId}:${direction}`;
  const [catState, setCatState] = useState<{
    binding: string;
    items: FinanceCategoryData[];
    error: boolean;
  }>({ binding: '', items: [], error: false });
  const [catRetry, setCatRetry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setCatState({ binding: '', items: [], error: false });
    void loadCategoryPages(identity, direction, c.signal)
      .then((items) => {
        if (!c.signal.aborted)
          setCatState({ binding: catBinding, items, error: false });
      })
      .catch(() => {
        if (!c.signal.aborted)
          setCatState({ binding: catBinding, items: [], error: true });
      });
    return () => c.abort();
  }, [identity.userId, identity.workspaceId, direction, catRetry]);
  const catReady = catState.binding === catBinding;
  const catItems = catReady ? catState.items : [];
  const catError = catReady && catState.error;
  useEffect(() => {
    if (!r.data) return;
    setSnap(r.data);
    const last = pageCount(r.data.total ?? 0, pageSize) - 1;
    if (page > last) setPage(last);
  }, [r.data]);
  const narrow = useNarrow(640);
  const filtered = Boolean(direction || category || from || to || searchQuery);
  const rows = snap?.items ?? [];
  const total = snap?.total ?? 0;
  const displayedRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase().trim();
    return rows.filter((r) => {
      const noteMatch = (r.note ?? '').toLowerCase().includes(q);
      const catMatch = (r.category_name_snapshot ?? '')
        .toLowerCase()
        .includes(q);
      return noteMatch || catMatch;
    });
  }, [rows, searchQuery]);
  const changeFilter = (fn: () => void) => {
    fn();
    setPage(0);
  };
  const COLS = '96px minmax(140px, 1.2fr) minmax(120px, 2fr) 150px 48px';
  return (
    <section style={financePageStyle}>
      <FinanceHeader
        title="Lịch sử thu chi"
        description="Lọc, xem chi tiết và chỉnh sửa giao dịch đã ghi."
      />
      <FinanceNav onNavigate={onNavigate} />
      <div
        data-testid="history-filters"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: '10px 12px',
          padding: '10px 12px',
          borderRadius: TOKENS.radii.md,
          border: `1px solid ${TOKENS.colors.borderSubtle}`,
          backgroundColor: TOKENS.colors.surface,
        }}
      >
        <label style={{ ...filterLabel, flex: '0 1 120px', minWidth: 100 }}>
          Loại
          <select
            style={filterField}
            value={direction}
            onChange={(e) =>
              changeFilter(() => {
                setDirection(e.target.value);
                setCategory('');
              })
            }
          >
            <option value="">Tất cả</option>
            <option value="income">Thu</option>
            <option value="expense">Chi</option>
          </select>
        </label>
        <label style={{ ...filterLabel, flex: '1 1 180px', minWidth: 150 }}>
          Danh mục
          <select
            style={filterField}
            value={category}
            onChange={(e) => changeFilter(() => setCategory(e.target.value))}
          >
            <option value="">Tất cả</option>
            {catItems.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.is_active ? '' : ' (ngừng dùng)'}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...filterLabel, flex: '0 1 150px', minWidth: 130 }}>
          Từ ngày
          <input
            type="date"
            style={filterField}
            value={from}
            onChange={(e) => changeFilter(() => setFrom(e.target.value))}
          />
        </label>
        <label style={{ ...filterLabel, flex: '0 1 150px', minWidth: 130 }}>
          Đến ngày
          <input
            type="date"
            style={filterField}
            value={to}
            onChange={(e) => changeFilter(() => setTo(e.target.value))}
          />
        </label>
        <label style={{ ...filterLabel, flex: '1 1 200px', minWidth: 160 }}>
          Tìm kiếm
          <input
            type="text"
            data-testid="history-search-input"
            placeholder="Tìm theo ghi chú, danh mục..."
            style={filterField}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
        {filtered && (
          <AppButton
            size="sm"
            variant="quiet"
            onClick={() =>
              changeFilter(() => {
                setDirection('');
                setCategory('');
                setFrom('');
                setTo('');
                setSearchQuery('');
              })
            }
          >
            Xóa lọc
          </AppButton>
        )}
        {catError && (
          <div role="alert" style={{ flexBasis: '100%' }}>
            Không tải đủ danh mục. Hãy thử lại.{' '}
            <AppButton
              size="sm"
              variant="secondary"
              onClick={() => setCatRetry((v) => v + 1)}
            >
              Thử lại danh mục
            </AppButton>
          </div>
        )}
      </div>
      <ReadStatus {...r} />
      <AppCard padding="0">
        {!narrow && rows.length > 0 && (
          <div
            aria-hidden="true"
            style={{
              display: 'grid',
              gridTemplateColumns: COLS,
              gap: 12,
              padding: '8px 16px',
              backgroundColor: TOKENS.colors.surfaceSubtle,
              borderBottom: `1px solid ${TOKENS.colors.borderSubtle}`,
              borderTopLeftRadius: TOKENS.radii.md,
              borderTopRightRadius: TOKENS.radii.md,
              fontSize: TOKENS.typography.fontSize.xs,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: TOKENS.colors.muted,
              fontWeight: TOKENS.typography.fontWeight.semibold,
            }}
          >
            <span>Ngày</span>
            <span>Danh mục</span>
            <span>Ghi chú</span>
            <span style={{ textAlign: 'right' }}>Số tiền</span>
            <span />
          </div>
        )}
        <div
          data-testid="history-list"
          style={{ display: 'grid', minWidth: 0 }}
        >
          {displayedRows.map((i, index) => {
            const income = i.direction === 'income';
            const color = income ? TOKENS.colors.success : TOKENS.colors.error;
            const amount = (
              <strong
                style={{
                  color,
                  textAlign: 'right',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {income ? '+' : '−'}
                {formatVnd(i.amount_vnd)}
              </strong>
            );
            const detailBtn = (
              <FinanceIconButton
                action="detail"
                target={`${income ? 'Thu' : 'Chi'} ${formatVnd(i.amount_vnd)} ngày ${i.occurred_on}`}
                testId={`history-detail-${i.id}`}
                onClick={() => onNavigate('/finance/entries/' + i.id)}
              />
            );
            const catCell = (
              <span
                style={{
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AppBadge variant={income ? 'success' : 'error'} size="sm">
                  {income ? 'Thu' : 'Chi'}
                </AppBadge>
                <span
                  style={{
                    fontWeight: TOKENS.typography.fontWeight.semibold,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {i.category_name_snapshot}
                </span>
              </span>
            );
            const border =
              index === displayedRows.length - 1
                ? 'none'
                : `1px solid ${TOKENS.colors.borderSubtle}`;
            return narrow ? (
              <div
                key={i.id}
                data-testid="history-row"
                style={{
                  display: 'grid',
                  gap: 6,
                  padding: '12px 14px',
                  borderBottom: border,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  {catCell}
                  {amount}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <span
                    title={i.note ?? ''}
                    style={{
                      minWidth: 0,
                      fontSize: TOKENS.typography.fontSize.sm,
                      color: TOKENS.colors.muted,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {i.occurred_on} · {i.note || '—'}
                  </span>
                  {detailBtn}
                </div>
              </div>
            ) : (
              <div
                key={i.id}
                data-testid="history-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: COLS,
                  gap: 12,
                  alignItems: 'center',
                  padding: '7px 16px',
                  minWidth: 0,
                  borderBottom: border,
                }}
              >
                <span
                  style={{
                    fontSize: TOKENS.typography.fontSize.sm,
                    color: TOKENS.colors.textSecondary,
                  }}
                >
                  {i.occurred_on}
                </span>
                {catCell}
                <span
                  title={i.note ?? ''}
                  style={{
                    minWidth: 0,
                    color: TOKENS.colors.muted,
                    fontSize: TOKENS.typography.fontSize.sm,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {i.note || '—'}
                </span>
                {amount}
                <span style={{ textAlign: 'right' }}>{detailBtn}</span>
              </div>
            );
          })}
          {r.loading && rows.length === 0 && (
            <div
              data-testid="history-skeleton-container"
              style={{ display: 'grid' }}
              aria-busy="true"
              aria-label="Đang tải lịch sử giao dịch"
            >
              {[1, 2, 3, 4].map((k) => (
                <div
                  key={k}
                  style={
                    narrow
                      ? {
                          display: 'grid',
                          gap: 8,
                          padding: '12px 14px',
                          borderBottom: `1px solid ${TOKENS.colors.borderSubtle}`,
                        }
                      : {
                          display: 'grid',
                          gridTemplateColumns: COLS,
                          gap: 12,
                          alignItems: 'center',
                          padding: '12px 16px',
                          borderBottom: `1px solid ${TOKENS.colors.borderSubtle}`,
                        }
                  }
                >
                  <AppSkeleton variant="text" width="80px" height="16px" />
                  <AppSkeleton variant="text" width="120px" height="16px" />
                  <AppSkeleton variant="text" width="160px" height="16px" />
                  <AppSkeleton
                    variant="text"
                    width="100px"
                    height="16px"
                    style={{ justifySelf: 'end' }}
                  />
                  <AppSkeleton
                    variant="circle"
                    width={28}
                    height={28}
                    style={{ justifySelf: 'end' }}
                  />
                </div>
              ))}
            </div>
          )}
          {!r.loading && !r.error && rows.length === 0 && (
            <p
              style={{
                margin: 0,
                padding: '28px 16px',
                textAlign: 'center',
                color: TOKENS.colors.muted,
              }}
            >
              Chưa có giao dịch.
            </p>
          )}
          {!r.loading && !r.error && rows.length > 0 && displayedRows.length === 0 && (
            <p
              data-testid="history-empty-search"
              style={{
                margin: 0,
                padding: '28px 16px',
                textAlign: 'center',
                color: TOKENS.colors.muted,
              }}
            >
              Không tìm thấy giao dịch nào khớp với từ khóa "{searchQuery}".
            </p>
          )}
        </div>
      </AppCard>
      <FinancePager
        testId="hist-pager"
        total={total}
        page={page}
        pageSize={pageSize}
        loading={r.loading}
        pageSizes={PAGE_SIZE_OPTIONS}
        onPage={setPage}
        onPageSize={(n) => {
          setPageSize(n);
          setPage(0);
        }}
      />
    </section>
  );
}
const filterLabel: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: TOKENS.typography.fontSize.sm,
  color: TOKENS.colors.textSecondary,
};
const filterField: React.CSSProperties = {
  ...fieldStyle,
  minHeight: 38,
  padding: '6px 10px',
};
