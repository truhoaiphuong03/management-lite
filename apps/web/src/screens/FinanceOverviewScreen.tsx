import { useEffect, useState } from 'react';
import type {
  FinanceSummaryData,
  FinancePeriod,
} from '../../../../packages/contracts/src/finance.js';
import {
  AppButton,
  AppCard,
  AppToast,
  TOKENS,
  THEME_COLORS,
} from '../../../../packages/ui/src/index.js';
import {
  FinanceNav,
  FinanceHeader,
  FinanceStat,
  fieldStyle,
  ReadStatus,
  useFinanceRead,
  financePageStyle,
  type FinanceScreenProps,
} from '../finance/ui.js';
import { formatVnd } from '../finance/client.js';
import type { ReceiptApi } from '../finance/receipt.js';
import { FinanceEntryScreen } from './FinanceEntryScreen.js';

export function FinanceOverviewScreen({
  identity,
  onNavigate,
  receipt,
  aiEnabled,
  entryRequest = 0,
}: FinanceScreenProps & {
  receipt?: ReceiptApi;
  aiEnabled?: boolean;
  /** Increments to ask the screen to open the add-entry dialog (e.g. legacy /finance/new). */
  entryRequest?: number;
}) {
  const [entryOpen, setEntryOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (entryRequest > 0) setEntryOpen(true);
  }, [entryRequest]);
  const [period, setPeriod] = useState<FinancePeriod>('month');
  const [anchor, setAnchor] = useState(() =>
    new Date().toLocaleDateString('en-CA'),
  );
  const q = new URLSearchParams({ period, anchor });
  const r = useFinanceRead<FinanceSummaryData>(identity, '/summary?' + q);

  const periodLabel: Record<FinancePeriod, string> = {
    day: 'ngày',
    week: 'tuần',
    month: 'tháng',
    year: 'năm',
  };
  const income =
    (Array.isArray(r.data?.categories) ? r.data.categories : []).filter(
      (c) => c.direction === 'income',
    ) ?? [];
  const expense =
    (Array.isArray(r.data?.categories) ? r.data.categories : []).filter(
      (c) => c.direction !== 'income',
    ) ?? [];
  const sum = (rows: typeof income) =>
    rows.reduce((t, c) => t + BigInt(c.total_vnd), 0n);

  const group = (
    title: string,
    rows: typeof income,
    color: string,
    empty: string,
    testId: string,
  ) => {
    const total = sum(rows);
    return (
      <AppCard padding="0" data-testid={testId}>
        <div
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${THEME_COLORS.borderSubtle}`,
            backgroundColor: THEME_COLORS.surfaceSubtle,
            borderTopLeftRadius: TOKENS.radii.md,
            borderTopRightRadius: TOKENS.radii.md,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: TOKENS.typography.fontSize.md,
              fontWeight: TOKENS.typography.fontWeight.semibold,
              color: THEME_COLORS.text,
            }}
          >
            {title} ({rows.length})
          </span>
          <strong style={{ color, fontSize: TOKENS.typography.fontSize.md }}>
            {formatVnd(total.toString())}
          </strong>
        </div>
        {rows.length === 0 ? (
          <div
            style={{
              padding: '20px 16px',
              textAlign: 'center',
              color: THEME_COLORS.muted,
              fontSize: TOKENS.typography.fontSize.sm,
            }}
          >
            {empty}
          </div>
        ) : (
          rows.map((c, index) => {
            const pct =
              total > 0n
                ? Number((BigInt(c.total_vnd) * 1000n) / total) / 10
                : 0;
            return (
              <div
                key={c.category_id}
                style={{
                  padding: '9px 16px',
                  borderBottom:
                    index === rows.length - 1
                      ? 'none'
                      : `1px solid ${THEME_COLORS.borderSubtle}`,
                  display: 'grid',
                  gap: 4,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      color: THEME_COLORS.text,
                      fontSize: TOKENS.typography.fontSize.md,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {c.category_name}
                  </span>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    <strong style={{ color }}>{formatVnd(c.total_vnd)}</strong>
                    <span
                      style={{
                        marginLeft: 8,
                        color: THEME_COLORS.muted,
                        fontSize: TOKENS.typography.fontSize.xs,
                      }}
                    >
                      {pct}%
                    </span>
                  </span>
                </div>
                <div
                  aria-hidden="true"
                  style={{
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: THEME_COLORS.borderSubtle,
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, pct)}%`,
                      height: '100%',
                      borderRadius: 2,
                      backgroundColor: color,
                      opacity: 0.8,
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </AppCard>
    );
  };

  return (
    <section style={financePageStyle}>
      <FinanceNav onNavigate={onNavigate} />

      <FinanceHeader
        title="Tổng hợp thu chi"
        description="Tổng thu, tổng chi và chênh lệch theo kỳ đã chọn."
        action={
          <AppButton variant="primary" onClick={() => setEntryOpen(true)}>
            + Thêm thu/chi
          </AppButton>
        }
      />

      {entryOpen && (
        <FinanceEntryScreen
          identity={identity}
          onNavigate={onNavigate}
          {...(receipt ? { receipt } : {})}
          {...(aiEnabled === undefined ? {} : { aiEnabled })}
          dialog={{
            onClose: () => setEntryOpen(false),
            onSaved: () => {
              setEntryOpen(false);
              setSaved(true);
              r.retry();
            },
          }}
        />
      )}
      {saved && (
        <AppToast
          message="Đã lưu giao dịch thành công."
          variant="success"
          durationMs={4000}
          onClose={() => setSaved(false)}
        />
      )}

      {/* Một hàng điều khiển: chọn kỳ + ngày trong kỳ + khoảng ngày đang xem */}
      <div
        data-testid="overview-toolbar"
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
        <div
          role="tablist"
          aria-label="Kỳ tổng hợp"
          style={{
            display: 'inline-flex',
            gap: 4,
            padding: 3,
            backgroundColor: THEME_COLORS.surfaceSubtle,
            borderRadius: TOKENS.radii.sm,
            border: `1px solid ${THEME_COLORS.borderSubtle}`,
          }}
        >
          {[
            ['day', 'Ngày'],
            ['week', 'Tuần'],
            ['month', 'Tháng'],
            ['year', 'Năm'],
          ].map(([v, l]) => (
            <AppButton
              key={v}
              type="button"
              variant={period === v ? 'primary' : 'quiet'}
              size="sm"
              onClick={() => setPeriod(v as FinancePeriod)}
            >
              {l}
            </AppButton>
          ))}
        </div>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: TOKENS.typography.fontSize.sm,
            color: THEME_COLORS.textSecondary,
          }}
        >
          Ngày trong {periodLabel[period]}
          <input
            type="date"
            aria-label="Ngày trong kỳ"
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
            style={{
              ...fieldStyle,
              width: 160,
              minHeight: 36,
              padding: '6px 10px',
            }}
          />
        </label>
        {r.data && !Array.isArray(r.data) && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: TOKENS.typography.fontSize.sm,
              color: THEME_COLORS.muted,
            }}
          >
            Kỳ: {r.data.from} — {r.data.to}
          </span>
        )}
      </div>

      <ReadStatus {...r} />

      {r.data && !Array.isArray(r.data) && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
              gap: 12,
            }}
          >
            <FinanceStat
              testId="stat-income"
              label="Tổng thu"
              value={formatVnd(r.data.total_income_vnd)}
              color={THEME_COLORS.success}
            />
            <FinanceStat
              testId="stat-expense"
              label="Tổng chi"
              value={formatVnd(r.data.total_expense_vnd)}
              color={THEME_COLORS.error}
            />
            <FinanceStat
              testId="stat-net"
              label="Chênh lệch thu chi"
              value={formatVnd(r.data.net_vnd)}
              color={
                BigInt(r.data.net_vnd) >= 0n
                  ? THEME_COLORS.primary
                  : THEME_COLORS.error
              }
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
              gap: 12,
              alignItems: 'start',
            }}
          >
            {group(
              'Nguồn thu',
              income,
              THEME_COLORS.success,
              'Chưa có khoản thu trong kỳ này.',
              'overview-income-list',
            )}
            {group(
              'Khoản chi',
              expense,
              THEME_COLORS.error,
              'Chưa có khoản chi trong kỳ này.',
              'overview-expense-list',
            )}
          </div>
        </>
      )}
    </section>
  );
}
