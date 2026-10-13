import {
  parseFinanceCategory,
  parseFinanceCategoryUpdate,
} from '../../../../packages/contracts/src/finance.js';
import { useEffect, useState } from 'react';
import type {
  FinancePage,
  FinanceCategoryData,
  FinanceDirection,
} from '../../../../packages/contracts/src/finance.js';
import {
  AppBadge,
  AppButton,
  AppInput,
  AppCard,
  AppDialog,
  TOKENS,
} from '../../../../packages/ui/src/index.js';
import {
  FinanceNav,
  FinanceHeader,
  useNarrow,
  ReadStatus,
  useFinanceRead,
  useFinanceMutation,
  MutationNotice,
  financePageStyle,
  FinancePager,
  PAGE_SIZE_OPTIONS,
  pageCount,
  FinanceIconButton,
  iconActionsStyle,
  type FinanceScreenProps,
  DEFAULT_PAGE_SIZE,
} from '../finance/ui.js';

export function FinanceCategoriesScreen({
  identity,
  onNavigate,
}: FinanceScreenProps) {
  const [direction, setDirection] = useState<FinanceDirection>('expense');
  const [name, setName] = useState('');
  const [validation, setValidation] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [snap, setSnap] = useState<FinancePage<FinanceCategoryData> | null>(
    null,
  );
  const [edit, setEdit] = useState<FinanceCategoryData | null>(null);
  const [editName, setEditName] = useState('');
  const [deactivateTarget, setDeactivateTarget] =
    useState<FinanceCategoryData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const r = useFinanceRead<FinancePage<FinanceCategoryData>>(
    identity,
    '/categories?' +
      new URLSearchParams({
        direction,
        limit: String(pageSize),
        offset: String(page * pageSize),
      }),
  );
  const m = useFinanceMutation(identity, 'categories');

  useEffect(() => {
    if (!r.data) return;
    setSnap(r.data);
    const last = pageCount(r.data.total ?? 0, pageSize) - 1;
    if (page > last) setPage(last);
  }, [r.data]);
  const rows = snap?.items ?? [];
  const total = snap?.total ?? 0;

  const switchDirection = (nextDir: FinanceDirection) => {
    if (nextDir !== direction) {
      setDirection(nextDir);
      setPage(0);
      setSnap(null);
      setValidation('');
      setSearchQuery('');
    }
  };

  async function save(
    path: string,
    payload: Record<string, unknown>,
    version: number | null = null,
  ) {
    setValidation('');
    try {
      const d = await m.submit(
        path,
        version === null ? 'POST' : 'PATCH',
        {
          ...(m.pending?.payload ??
            (version === null
              ? parseFinanceCategory(payload)
              : parseFinanceCategoryUpdate(payload))),
        },
        version,
      );
      if (d) {
        setName('');
        setEdit(null);
        setDeactivateTarget(null);
        r.retry();
      }
    } catch {
      setValidation('Tên danh mục phải có 1–100 ký tự.');
    }
  }

  const narrow = useNarrow(640);
  const activeCount = rows.filter((c) => c.is_active).length;
  const isExpense = direction === 'expense';
  const filteredRows = searchQuery.trim()
    ? rows.filter((c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase().trim()),
      )
    : rows;

  return (
    <section style={financePageStyle}>
      <FinanceHeader
        title="Danh mục thu chi"
        description="Quản lý nguồn thu và khoản chi dùng khi ghi giao dịch."
      />
      <FinanceNav onNavigate={onNavigate} />

      {/* Một khối điều khiển: tab Khoản chi / Nguồn thu + thêm danh mục mới */}
      <AppCard padding="12px 14px">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: '12px 16px',
          }}
        >
          <div
            role="tablist"
            aria-label="Loại danh mục"
            style={{
              display: 'inline-flex',
              gap: 4,
              padding: 3,
              backgroundColor: TOKENS.colors.surfaceSubtle,
              borderRadius: TOKENS.radii.sm,
              border: `1px solid ${TOKENS.colors.borderSubtle}`,
            }}
          >
            <AppButton
              type="button"
              role="tab"
              aria-selected={isExpense}
              variant={isExpense ? 'primary' : 'quiet'}
              size="sm"
              disabled={m.busy}
              onClick={() => switchDirection('expense')}
            >
              Khoản chi
            </AppButton>
            <AppButton
              type="button"
              role="tab"
              aria-selected={!isExpense}
              variant={!isExpense ? 'primary' : 'quiet'}
              size="sm"
              disabled={m.busy}
              onClick={() => switchDirection('income')}
            >
              Nguồn thu
            </AppButton>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (m.ready && !m.busy && (m.pending || name.trim())) {
                void save('/categories', { direction, name: name.trim() });
              }
            }}
            style={{
              flex: '1 1 320px',
              minWidth: 0,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              gap: 10,
            }}
          >
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <AppInput
                label={`Thêm danh mục ${isExpense ? 'khoản chi' : 'nguồn thu'} mới`}
                placeholder={
                  isExpense
                    ? 'VD: Tiền nhà, Ăn uống, Đi lại...'
                    : 'VD: Lương, Bán hàng, Thưởng...'
                }
                maxLength={100}
                value={name}
                disabled={m.busy || Boolean(m.pending)}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <AppButton
              type="submit"
              variant="primary"
              disabled={!m.ready || m.busy || (!m.pending && !name.trim())}
              isLoading={m.busy}
            >
              {m.pending ? 'Thử lại yêu cầu đã lưu' : 'Tạo danh mục'}
            </AppButton>
          </form>
        </div>
        {validation && (
          <p
            role="alert"
            style={{
              color: TOKENS.colors.error,
              fontSize: TOKENS.typography.fontSize.sm,
              margin: '8px 0 0',
            }}
          >
            {validation}
          </p>
        )}
      </AppCard>

      <MutationNotice mutation={m} />
      <ReadStatus {...r} />

      {/* Danh sách danh mục dạng bảng gọn */}
      <AppCard padding="0">
        <div
          style={{
            padding: '14px 18px',
            borderBottom: `1px solid ${TOKENS.colors.borderSubtle}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: TOKENS.colors.surfaceSubtle,
            borderTopLeftRadius: TOKENS.radii.md,
            borderTopRightRadius: TOKENS.radii.md,
          }}
        >
          <span
            style={{
              fontSize: TOKENS.typography.fontSize.sm,
              fontWeight: TOKENS.typography.fontWeight.semibold,
              color: TOKENS.colors.textSecondary,
            }}
          >
            Danh sách danh mục {isExpense ? 'khoản chi' : 'nguồn thu'} ({total})
          </span>
          <span
            style={{
              fontSize: TOKENS.typography.fontSize.xs,
              color: TOKENS.colors.muted,
            }}
          >
            Trang này: {activeCount} đang dùng · {rows.length - activeCount}{' '}
            ngừng dùng
          </span>
        </div>

        {/* Search Bar */}
        <div
          style={{
            padding: '10px 18px',
            borderBottom: `1px solid ${TOKENS.colors.borderSubtle}`,
            backgroundColor: TOKENS.colors.surface,
          }}
        >
          <input
            type="text"
            data-testid="category-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Tìm kiếm danh mục ${isExpense ? 'khoản chi' : 'nguồn thu'}...`}
            style={{
              width: '100%',
              padding: '8px 12px',
              backgroundColor: TOKENS.colors.surfaceSubtle,
              border: `1px solid ${TOKENS.colors.borderSubtle}`,
              borderRadius: TOKENS.radii.sm,
              color: TOKENS.colors.text,
              fontSize: TOKENS.typography.fontSize.sm,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {rows.length === 0 && !r.loading && !r.error ? (
          <div
            style={{
              padding: '36px 20px',
              textAlign: 'center',
              color: TOKENS.colors.muted,
              fontSize: TOKENS.typography.fontSize.sm,
            }}
          >
            Chưa có danh mục nào cho {isExpense ? 'khoản chi' : 'nguồn thu'}.
          </div>
        ) : filteredRows.length === 0 ? (
          <div
            data-testid="category-empty-search"
            style={{
              padding: '36px 20px',
              textAlign: 'center',
              color: TOKENS.colors.muted,
              fontSize: TOKENS.typography.fontSize.sm,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div>Không tìm thấy danh mục phù hợp với "{searchQuery}".</div>
            <AppButton
              variant="secondary"
              size="sm"
              onClick={() => setSearchQuery('')}
            >
              Xóa tìm kiếm
            </AppButton>
          </div>
        ) : (
          <div
            data-testid="category-list"
            style={{
              display: 'grid',
              gridTemplateColumns: narrow
                ? '1fr'
                : 'repeat(auto-fit, minmax(420px, 1fr))',
              gap: 1,
              backgroundColor: TOKENS.colors.borderSubtle,
              borderBottomLeftRadius: TOKENS.radii.md,
              borderBottomRightRadius: TOKENS.radii.md,
              overflow: 'hidden',
            }}
          >
            {filteredRows.map((c) => {
              return (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 14px',
                    gap: '8px 12px',
                    flexWrap: 'wrap',
                    minWidth: 0,
                    backgroundColor: c.is_active
                      ? TOKENS.colors.surface
                      : TOKENS.colors.surfaceSubtle,
                  }}
                >
                  {/* Category Name & Status Badge */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      flex: '1 1 160px',
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: TOKENS.typography.fontSize.base,
                        fontWeight: TOKENS.typography.fontWeight.semibold,
                        color: c.is_active
                          ? TOKENS.colors.text
                          : TOKENS.colors.muted,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {c.name}
                    </span>
                    <AppBadge
                      variant={c.is_active ? 'success' : 'muted'}
                      size="sm"
                    >
                      {c.is_active ? 'Đang dùng' : 'Ngừng dùng'}
                    </AppBadge>
                  </div>

                  {/* Actions Buttons with clear spacing and design-system variants */}
                  <div style={iconActionsStyle}>
                    <FinanceIconButton
                      action="edit"
                      target={c.name}
                      testId={`cat-edit-${c.id}`}
                      disabled={m.busy || Boolean(m.pending)}
                      onClick={() => {
                        setEdit(c);
                        setEditName(c.name);
                      }}
                    />
                    {c.is_active ? (
                      <FinanceIconButton
                        action="deactivate"
                        target={c.name}
                        testId={`cat-deactivate-${c.id}`}
                        disabled={m.busy || Boolean(m.pending)}
                        onClick={() => setDeactivateTarget(c)}
                      />
                    ) : (
                      <FinanceIconButton
                        action="reactivate"
                        target={c.name}
                        testId={`cat-reactivate-${c.id}`}
                        disabled={m.busy || Boolean(m.pending)}
                        onClick={() =>
                          void save(
                            '/categories/' + c.id,
                            { is_active: true },
                            c.version,
                          )
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AppCard>

      <FinancePager
        testId="cat-pager"
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

      {/* Dialog Đổi tên */}
      <AppDialog
        isOpen={Boolean(edit)}
        title="Đổi tên danh mục"
        confirmLabel="Lưu"
        cancelLabel="Hủy"
        confirmVariant="primary"
        onClose={() => setEdit(null)}
        isLoading={m.busy}
        onConfirm={() => {
          if (edit && editName.trim())
            void save(
              '/categories/' + edit.id,
              { name: editName.trim() },
              edit.version,
            );
        }}
      >
        <AppInput
          label="Tên danh mục"
          value={editName}
          maxLength={100}
          onChange={(e) => setEditName(e.target.value)}
          autoFocus
        />
      </AppDialog>

      {/* Dialog Xác nhận Ngừng dùng */}
      <AppDialog
        isOpen={Boolean(deactivateTarget)}
        title="Xác nhận ngừng dùng danh mục"
        confirmLabel="Ngừng dùng"
        confirmVariant="destructive"
        cancelLabel="Hủy"
        isLoading={m.busy}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={() => {
          if (deactivateTarget) {
            void save(
              '/categories/' + deactivateTarget.id,
              { is_active: false },
              deactivateTarget.version,
            );
          }
        }}
      >
        <p
          style={{
            margin: 0,
            color: TOKENS.colors.textSecondary,
            fontSize: TOKENS.typography.fontSize.base,
            lineHeight: TOKENS.typography.lineHeight.relaxed,
          }}
        >
          Bạn có chắc chắn muốn ngừng sử dụng danh mục{' '}
          <strong style={{ color: TOKENS.colors.text }}>
            {deactivateTarget?.name}
          </strong>
          ?
        </p>
        <p
          style={{
            margin: '8px 0 0 0',
            color: TOKENS.colors.muted,
            fontSize: TOKENS.typography.fontSize.sm,
            lineHeight: TOKENS.typography.lineHeight.relaxed,
          }}
        >
          Các khoản thu chi đã ghi nhận trước đây thuộc danh mục này vẫn được
          bảo toàn nguyên vẹn trong lịch sử và báo cáo. Bạn có thể kích hoạt lại
          bất kỳ lúc nào.
        </p>
      </AppDialog>
    </section>
  );
}
