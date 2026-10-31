import { useEffect, useMemo, useState } from 'react';
import type {
  FinanceCategoryData,
  FinanceDirection,
} from '../../../../packages/contracts/src/finance.js';
import {
  computePlanSummary,
  daysInMonth,
  parseFinancePlanItem,
  parseFinancePlanItemUpdate,
  parsePlanMonth,
  type FinancePlanData,
  type FinancePlanItemData,
} from '../../../../packages/contracts/src/finance-plan.js';
import {
  AppBadge,
  AppButton,
  AppCard,
  AppDialog,
  AppInput,
  TOKENS, THEME_COLORS,
} from '../../../../packages/ui/src/index.js';
import {
  FinanceNav,
  FinanceHeader,
  FinanceStat,
  useGridColumns,
  FinanceIconButton,
  iconActionsStyle,
  ReadStatus,
  useFinanceRead,
  useFinanceMutation,
  MutationNotice,
  financePageStyle,
  fieldStyle,
  FinancePager,
  type FinanceScreenProps,
  clampPage,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
} from '../finance/ui.js';
import { formatVnd, loadCategoryPages } from '../finance/client.js';

const currentVnMonth = (): string =>
  new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
/** Keep digits only (max 13 = plan limit) so "10.000.000" pastes cleanly; no float parsing anywhere. */
const digitsOnly = (v: string): string =>
  v.replace(/\D/g, '').replace(/^0+/, '').slice(0, 13);
const grouped = (digits: string): string =>
  digits ? BigInt(digits).toLocaleString('vi-VN') : '';

const labelStyle = {
  fontSize: TOKENS.typography.fontSize.xs,
  color: THEME_COLORS.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: TOKENS.typography.fontWeight.semibold,
} as const;

export function FinancePlanScreen({
  identity,
  onNavigate,
}: FinanceScreenProps) {
  const [month, setMonth] = useState(currentVnMonth);
  const [direction, setDirection] = useState<FinanceDirection>('expense');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [validation, setValidation] = useState('');
  const [edit, setEdit] = useState<FinancePlanItemData | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editError, setEditError] = useState('');
  const [deactivate, setDeactivate] = useState<FinancePlanItemData | null>(
    null,
  );
  const [snap, setSnap] = useState<FinancePlanData | null>(null);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [pages, setPages] = useState<Record<FinanceDirection, number>>({
    income: 0,
    expense: 0,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [cats, setCats] = useState<{
    key: string;
    items: FinanceCategoryData[];
    error: boolean;
  }>({ key: '', items: [], error: false });
  const [catRetry, setCatRetry] = useState(0);

  const r = useFinanceRead<FinancePlanData>(identity, '/plan');
  const m = useFinanceMutation(identity, 'plan');
  // Keep the last good list while a refresh is in flight so numbers never flicker to empty.
  useEffect(() => {
    if (r.data) setSnap(r.data);
  }, [r.data]);

  const catKey = `${identity.userId}:${identity.workspaceId}:${direction}`;
  useEffect(() => {
    const c = new AbortController();
    void loadCategoryPages(identity, direction, c.signal)
      .then((items) => {
        if (!c.signal.aborted) setCats({ key: catKey, items, error: false });
      })
      .catch(() => {
        if (!c.signal.aborted) setCats({ key: catKey, items: [], error: true });
      });
    return () => c.abort();
  }, [identity.userId, identity.workspaceId, direction, catRetry]);
  const catReady = cats.key === catKey;
  const activeCats = catReady ? cats.items.filter((c) => c.is_active) : [];

  const items = snap?.items ?? [];
  // Same exact BigInt function the API uses; recomputed instantly for the chosen month.
  const summary = useMemo(
    () => computePlanSummary(items, month),
    [items, month],
  );
  const busy = m.busy || Boolean(m.pending);

  async function submit(
    path: string,
    method: 'POST' | 'PATCH',
    payload: Record<string, unknown>,
    version: number | null,
  ): Promise<boolean> {
    const d = await m.submit(
      path,
      method,
      m.pending ? m.pending.payload : payload,
      version,
    );
    if (d) r.retry();
    return Boolean(d);
  }
  async function create() {
    setValidation('');
    try {
      if (m.pending) {
        await submit(m.pending.path, m.pending.method, {}, m.pending.version);
        return;
      }
      if (!categoryId) {
        setValidation('Hãy chọn danh mục.');
        return;
      }
      const payload = parseFinancePlanItem({
        direction,
        category_id: categoryId,
        amount_vnd: amount,
      });
      if (await submit('/plan-items', 'POST', { ...payload }, null)) {
        setAmount('');
        setCategoryId('');
      }
    } catch {
      setValidation(
        'Số tiền phải là số nguyên VND từ 1 đến 9.999.999.999.999.',
      );
    }
  }
  async function saveEdit() {
    if (!edit) return;
    setEditError('');
    try {
      const payload = parseFinancePlanItemUpdate({ amount_vnd: editAmount });
      if (
        await submit(
          '/plan-items/' + edit.id,
          'PATCH',
          { ...payload },
          edit.version,
        )
      )
        setEdit(null);
    } catch {
      setEditError('Số tiền phải là số nguyên VND từ 1 đến 9.999.999.999.999.');
    }
  }
  async function setActive(item: FinancePlanItemData, active: boolean) {
    if (
      await submit(
        '/plan-items/' + item.id,
        'PATCH',
        { is_active: active },
        item.version,
      )
    )
      setDeactivate(null);
  }

  const deficit = summary.status === 'deficit';
  const statusBadge =
    summary.status === 'surplus' ? (
      <AppBadge variant="success" size="sm">
        Dự kiến còn dư
      </AppBadge>
    ) : deficit ? (
      <AppBadge variant="danger" size="sm">
        Dự kiến thiếu tiền
      </AppBadge>
    ) : (
      <AppBadge variant="info" size="sm">
        Dự kiến cân bằng
      </AppBadge>
    );

  const list = (dir: FinanceDirection, title: string, total: string) => {
    // Totals/summary always use ALL items; only the visible slice is paged (client-side).
    const all = items.filter((i) => i.direction === dir);
    const filtered = searchQuery.trim()
      ? all.filter((i) =>
          i.category_name
            .toLowerCase()
            .includes(searchQuery.toLowerCase().trim()),
        )
      : all;
    const pg = clampPage(pages[dir], filtered.length, pageSize);
    const rows = filtered.slice(pg * pageSize, (pg + 1) * pageSize);
    const isIncome = dir === 'income';
    return (
      <AppCard padding="0" data-testid={`plan-list-${dir}`}>
        <div
          style={{
            padding: '14px 18px',
            borderBottom: `1px solid ${THEME_COLORS.borderSubtle}`,
            backgroundColor: THEME_COLORS.surfaceSubtle,
            borderTopLeftRadius: TOKENS.radii.md,
            borderTopRightRadius: TOKENS.radii.md,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: TOKENS.typography.fontSize.sm,
              fontWeight: TOKENS.typography.fontWeight.semibold,
              color: THEME_COLORS.textSecondary,
            }}
          >
            {title} ({all.length})
          </span>
          <strong
            style={{
              fontSize: TOKENS.typography.fontSize.base,
              color: isIncome ? THEME_COLORS.success : THEME_COLORS.text,
            }}
          >
            {formatVnd(total)}/tháng
          </strong>
        </div>
        {all.length === 0 ? (
          <div
            style={{
              padding: '28px 16px',
              textAlign: 'center',
              color: THEME_COLORS.muted,
              fontSize: TOKENS.typography.fontSize.sm,
            }}
          >
            Chưa có khoản {isIncome ? 'thu' : 'chi'} dự kiến nào.
          </div>
        ) : filtered.length === 0 ? (
          <div
            data-testid="plan-empty-search"
            style={{
              padding: '28px 16px',
              textAlign: 'center',
              color: THEME_COLORS.muted,
              fontSize: TOKENS.typography.fontSize.sm,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div>
              Không tìm thấy khoản {isIncome ? 'thu' : 'chi'} nào khớp với &quot;{searchQuery}&quot;.
            </div>
            <AppButton
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setPages({ income: 0, expense: 0 });
              }}
            >
              Xóa tìm kiếm
            </AppButton>
          </div>
        ) : (
          rows.map((i, idx) => (
            <div
              key={i.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                padding: '12px 18px',
                borderBottom:
                  idx === rows.length - 1
                    ? 'none'
                    : `1px solid ${THEME_COLORS.borderSubtle}`,
                backgroundColor: i.is_active
                  ? 'transparent'
                  : 'rgba(15, 23, 42, 0.35)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                  flex: '1 1 220px',
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontWeight: TOKENS.typography.fontWeight.semibold,
                    color: i.is_active
                      ? THEME_COLORS.text
                      : THEME_COLORS.muted,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {i.category_name}
                </span>
                <AppBadge variant={i.is_active ? 'success' : 'muted'} size="sm">
                  {i.is_active ? 'Đang dùng' : 'Ngừng dùng'}
                </AppBadge>
                {!i.category_is_active && (
                  <AppBadge variant="warning" size="sm">
                    Danh mục đã ngừng dùng
                  </AppBadge>
                )}
              </div>
              <strong
                style={{
                  color: i.is_active ? THEME_COLORS.text : THEME_COLORS.muted,
                }}
              >
                {formatVnd(i.amount_vnd)}/tháng
              </strong>
              <div style={iconActionsStyle}>
                <FinanceIconButton
                  action="edit"
                  target={i.category_name}
                  testId={`plan-edit-${i.id}`}
                  disabled={busy}
                  onClick={() => {
                    setEdit(i);
                    setEditAmount(i.amount_vnd);
                    setEditError('');
                  }}
                />
                {i.is_active ? (
                  <FinanceIconButton
                    action="deactivate"
                    target={i.category_name}
                    testId={`plan-deactivate-${i.id}`}
                    disabled={busy}
                    onClick={() => setDeactivate(i)}
                  />
                ) : (
                  <FinanceIconButton
                    action="reactivate"
                    target={i.category_name}
                    testId={`plan-reactivate-${i.id}`}
                    disabled={busy}
                    onClick={() => void setActive(i, true)}
                  />
                )}
              </div>
            </div>
          ))
        )}
        {filtered.length > PAGE_SIZE_OPTIONS[0] && (
          <div
            style={{
              padding: '10px 18px',
              borderTop: `1px solid ${THEME_COLORS.borderSubtle}`,
            }}
          >
            <FinancePager
              testId={`plan-pager-${dir}`}
              total={filtered.length}
              page={pg}
              pageSize={pageSize}
              loading={false}
              pageSizes={PAGE_SIZE_OPTIONS}
              onPage={(n) => setPages((p) => ({ ...p, [dir]: n }))}
              onPageSize={(n) => {
                setPageSize(n);
                setPages({ income: 0, expense: 0 });
              }}
            />
          </div>
        )}
      </AppCard>
    );
  };

  const [metricsRef, metricCols] = useGridColumns();
  const isIncomeForm = direction === 'income';
  let monthDays = 30;
  try {
    monthDays = daysInMonth(parsePlanMonth(month));
  } catch {
    /* keep default for display only; month state is validated on change */
  }

  return (
    <section style={financePageStyle}>
      <FinanceHeader
        title="Kế hoạch thu chi cố định"
        description="Sổ kế hoạch: nhập số tiền dự kiến mỗi tháng. Đây không phải giao dịch thực tế và không làm thay đổi Tổng hợp thu chi."
      />
      <FinanceNav onNavigate={onNavigate} />
      <ReadStatus {...r} />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          padding: '10px 12px',
          borderRadius: TOKENS.radii.md,
          border: `1px solid ${THEME_COLORS.borderSubtle}`,
          backgroundColor: THEME_COLORS.surface,
        }}
      >
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: TOKENS.typography.fontSize.sm,
            color: THEME_COLORS.textSecondary,
          }}
        >
          Tháng quy đổi theo ngày/tuần
          <input
            type="month"
            aria-label="Tháng quy đổi theo ngày/tuần"
            value={month}
            onChange={(e) => {
              try {
                setMonth(parsePlanMonth(e.target.value));
              } catch {
                /* ignore cleared/invalid month */
              }
            }}
            style={{
              ...fieldStyle,
              width: 170,
              minHeight: 36,
              padding: '6px 10px',
            }}
          />
        </label>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: TOKENS.typography.fontSize.sm,
            color: THEME_COLORS.muted,
          }}
        >
          Tháng này có {monthDays} ngày.
        </span>
      </div>

      <div
        ref={metricsRef}
        data-testid="plan-metrics"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${metricCols}, minmax(0, 1fr))`,
          gap: 12,
        }}
      >
        <FinanceStat
          testId="plan-total-income"
          label="Tổng thu dự kiến/tháng"
          value={formatVnd(summary.total_income_vnd)}
          color={THEME_COLORS.success}
        />
        <FinanceStat
          testId="plan-total-expense"
          label="Tổng chi dự kiến/tháng"
          value={formatVnd(summary.total_expense_vnd)}
          color={THEME_COLORS.error}
        />
        <FinanceStat
          testId="plan-net"
          label="Chênh lệch thu − chi"
          value={formatVnd(summary.net_vnd)}
          color={deficit ? THEME_COLORS.error : THEME_COLORS.primary}
          hint={<div data-testid="plan-status">{statusBadge}</div>}
        />
        <FinanceStat
          testId="plan-shortfall"
          label="Số tiền cần kiếm thêm"
          value={formatVnd(summary.shortfall_vnd)}
          color={deficit ? THEME_COLORS.warning : THEME_COLORS.success}
          hint={deficit ? 'mỗi tháng' : 'Thu nhập dự kiến đã đủ chi phí'}
        />
      </div>

      <AppCard padding="16px">
        <span style={labelStyle}>Cần kiếm thêm để cân bằng</span>
        <div
          data-testid="plan-need"
          style={{
            marginTop: 10,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 12,
          }}
        >
          {(
            [
              ['Mỗi ngày', summary.need_per_day_vnd, 'plan-need-day'],
              ['Mỗi tuần', summary.need_per_week_vnd, 'plan-need-week'],
              ['Mỗi tháng', summary.need_per_month_vnd, 'plan-need-month'],
            ] as const
          ).map(([label, value, id]) => (
            <div
              key={id}
              style={{
                padding: '10px 12px',
                borderRadius: TOKENS.radii.sm,
                border: `1px solid ${THEME_COLORS.borderSubtle}`,
                backgroundColor: THEME_COLORS.surfaceSubtle,
              }}
            >
              <div
                style={{
                  fontSize: TOKENS.typography.fontSize.xs,
                  color: THEME_COLORS.muted,
                }}
              >
                {label}
              </div>
              <div
                data-testid={id}
                style={{
                  marginTop: 4,
                  fontWeight: TOKENS.typography.fontWeight.bold,
                  fontSize: TOKENS.typography.fontSize.lg,
                  color: deficit ? THEME_COLORS.warning : THEME_COLORS.text,
                }}
              >
                {formatVnd(value)}
              </div>
            </div>
          ))}
        </div>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: TOKENS.typography.fontSize.xs,
            color: THEME_COLORS.muted,
          }}
        >
          Số tiền theo ngày và tuần là mức bình quân quy đổi (làm tròn lên đến
          đồng) theo số ngày thực tế của tháng, không phải lịch thanh toán thực
          tế.
        </p>
      </AppCard>

      <AppCard padding="14px 16px">
        <h3
          style={{
            margin: '0 0 10px',
            fontSize: TOKENS.typography.fontSize.md,
            fontWeight: TOKENS.typography.fontWeight.semibold,
            color: THEME_COLORS.text,
          }}
        >
          Thêm khoản dự tính
        </h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (m.ready && !m.busy) void create();
          }}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: '10px 12px',
          }}
        >
          <div
            role="tablist"
            aria-label="Loại khoản dự tính"
            style={{
              display: 'inline-flex',
              gap: 4,
              padding: 3,
              backgroundColor: THEME_COLORS.surfaceSubtle,
              borderRadius: TOKENS.radii.sm,
              border: `1px solid ${THEME_COLORS.borderSubtle}`,
            }}
          >
            {(
              [
                ['income', 'Thu'],
                ['expense', 'Chi'],
              ] as const
            ).map(([v, l]) => (
              <AppButton
                key={v}
                type="button"
                role="tab"
                aria-selected={direction === v}
                variant={direction === v ? 'primary' : 'quiet'}
                size="sm"
                disabled={busy}
                onClick={() => {
                  setDirection(v);
                  setCategoryId('');
                  setValidation('');
                }}
              >
                {l}
              </AppButton>
            ))}
          </div>
          <label
            style={{
              flex: '1 1 200px',
              minWidth: 0,
              display: 'grid',
              gap: 4,
              fontSize: TOKENS.typography.fontSize.sm,
              color: THEME_COLORS.textSecondary,
            }}
          >
            Danh mục {isIncomeForm ? 'thu' : 'chi'}
            <select
              style={fieldStyle}
              value={categoryId}
              disabled={busy}
              onChange={(e) => setCategoryId(e.target.value)}
              aria-label="Danh mục"
            >
              <option value="">Chọn danh mục</option>
              {activeCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <AppInput
              label="Số tiền dự kiến mỗi tháng (VND)"
              inputMode="numeric"
              autoComplete="off"
              value={grouped(amount)}
              disabled={busy}
              onChange={(e) => setAmount(digitsOnly(e.target.value))}
              placeholder="VD: 10.000.000"
            />
          </div>
          <AppButton
            type="submit"
            disabled={!m.ready || m.busy || (!m.pending && !amount)}
            isLoading={m.busy}
          >
            {m.pending ? 'Thử lại yêu cầu đã lưu' : 'Lưu khoản dự tính'}
          </AppButton>
        </form>
        {cats.error && catReady && (
          <div role="alert" style={{ marginTop: 8 }}>
            Không tải được danh mục.{' '}
            <AppButton
              size="sm"
              variant="secondary"
              onClick={() => setCatRetry((v) => v + 1)}
            >
              Thử lại
            </AppButton>
          </div>
        )}
        {catReady && !cats.error && activeCats.length === 0 && (
          <div
            style={{
              marginTop: 8,
              color: THEME_COLORS.muted,
              fontSize: TOKENS.typography.fontSize.sm,
            }}
          >
            Chưa có danh mục {isIncomeForm ? 'thu' : 'chi'} đang dùng.{' '}
            <AppButton
              size="sm"
              variant="secondary"
              onClick={() => onNavigate('/finance/categories')}
            >
              Mở Danh mục
            </AppButton>
          </div>
        )}
        {validation && (
          <p
            role="alert"
            style={{ margin: '8px 0 0', color: THEME_COLORS.error }}
          >
            {validation}
          </p>
        )}
      </AppCard>

      <MutationNotice mutation={m} />

      {/* Plan Category Search Bar */}
      <div style={{ marginBottom: 4 }}>
        <input
          type="text"
          data-testid="plan-search-input"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPages({ income: 0, expense: 0 });
          }}
          placeholder="Tìm kiếm khoản dự tính theo tên danh mục…"
          style={{
            width: '100%',
            padding: '8px 12px',
            backgroundColor: THEME_COLORS.surface,
            border: `1px solid ${THEME_COLORS.borderSubtle}`,
            borderRadius: TOKENS.radii.sm,
            color: THEME_COLORS.text,
            fontSize: TOKENS.typography.fontSize.sm,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {!r.loading && r.error ? null : (
        <div style={{ display: 'grid', gap: 16 }}>
          {list('income', 'Thu dự kiến', summary.total_income_vnd)}
          {list('expense', 'Chi dự kiến', summary.total_expense_vnd)}
        </div>
      )}

      <AppDialog
        isOpen={Boolean(edit)}
        title="Sửa số tiền dự kiến"
        description={edit ? edit.category_name : ''}
        confirmLabel="Lưu"
        isLoading={m.busy}
        onClose={() => setEdit(null)}
        onConfirm={() => void saveEdit()}
      >
        <AppInput
          label="Số tiền dự kiến mỗi tháng (VND)"
          inputMode="numeric"
          autoComplete="off"
          value={grouped(editAmount)}
          onChange={(e) => setEditAmount(digitsOnly(e.target.value))}
          error={editError || null}
        />
      </AppDialog>

      <AppDialog
        isOpen={Boolean(deactivate)}
        title="Xác nhận ngừng dùng khoản dự tính"
        confirmLabel="Ngừng dùng"
        confirmVariant="destructive"
        isLoading={m.busy}
        onClose={() => setDeactivate(null)}
        onConfirm={() => {
          if (deactivate) void setActive(deactivate, false);
        }}
      >
        <p style={{ margin: 0, color: THEME_COLORS.textSecondary }}>
          Ngừng dùng{' '}
          <strong style={{ color: THEME_COLORS.text }}>
            {deactivate?.category_name}
          </strong>{' '}
          ({deactivate ? formatVnd(deactivate.amount_vnd) : ''}/tháng)? Khoản
          này sẽ không còn được tính vào tổng. Dữ liệu được giữ lại và bạn có
          thể kích hoạt lại bất kỳ lúc nào.
        </p>
      </AppDialog>
    </section>
  );
}
