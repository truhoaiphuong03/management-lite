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
  THEME_COLORS,
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
      <FinanceNav onNavigate={onNavigate} />
      <FinanceHeader
        title="Danh mục thu chi"
        description="Quản lý nguồn thu và khoản chi dùng khi ghi giao dịch."
      />

      {/* Thanh công cụ tạo nhanh & chuyển loại danh mục: căn thẳng hàng 2 tầng Nhãn + Ô điều khiển */}
      <AppCard padding="16px 18px">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: narrow
              ? '1fr'
              : 'auto minmax(min(100%, 360px), 1fr)',
            alignItems: 'end',
            gap: '14px 20px',
          }}
        >
          <div style={{ display: 'grid', gap: 6 }}>
            <span
              style={{
                fontSize: TOKENS.typography.fontSize.xs,
                fontWeight: TOKENS.typography.fontWeight.semibold,
                color: THEME_COLORS.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Loại danh mục
            </span>
            <div
              role="tablist"
              aria-label="Loại danh mục"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 40,
                boxSizing: 'border-box',
                gap: 4,
                padding: 3,
                backgroundColor: THEME_COLORS.surfaceSubtle,
                borderRadius: TOKENS.radii.sm,
                border: `1px solid ${THEME_COLORS.borderSubtle}`,
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
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (m.ready && !m.busy && (m.pending || name.trim())) {
                void save('/categories', { direction, name: name.trim() });
              }
            }}
            style={{
              minWidth: 0,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              gap: 10,
            }}
          >
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <AppInput
                label={`Thêm danh mục ${isExpense ? 'khoản chi' : 'nguồn thu'} mới`}
                placeholder={
                  isExpense
                    ? 'VD: Tiền nhà, Ăn uống, Đi lại…'
                    : 'VD: Lương, Bán hàng, Thưởng…'
                }
                maxLength={100}
                value={name}
                disabled={m.busy || Boolean(m.pending)}
                onChange={(e) => setName(e.target.value)}
                style={{
                  backgroundColor: THEME_COLORS.surface,
                  minHeight: 40,
                }}
              />
            </div>
            <AppButton
              type="submit"
              variant="primary"
              disabled={!m.ready || m.busy || (!m.pending && !name.trim())}
              isLoading={m.busy}
              style={{ minHeight: 40, whiteSpace: 'nowrap' }}
            >
              {m.pending ? 'Thử lại yêu cầu đã lưu' : '+ Tạo danh mục'}
            </AppButton>
          </form>
        </div>
        {validation && (
          <p
            role="alert"
            style={{
              color: THEME_COLORS.error,
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

      {/* Phương án A: Bảng danh sách thẳng cột, nền trắng sáng, không còn ô xám trống */}
      <AppCard padding="0">
        {/* Thanh tiêu đề & tìm kiếm gộp gọn trên 1 hàng */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: `1px solid ${THEME_COLORS.borderSubtle}`,
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px 16px',
            backgroundColor: THEME_COLORS.surface,
            borderTopLeftRadius: TOKENS.radii.md,
            borderTopRightRadius: TOKENS.radii.md,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px 12px',
            }}
          >
            <span
              style={{
                fontSize: TOKENS.typography.fontSize.base,
                fontWeight: TOKENS.typography.fontWeight.bold,
                color: THEME_COLORS.text,
              }}
            >
              Danh sách danh mục {isExpense ? 'khoản chi' : 'nguồn thu'} (
              {total})
            </span>
            <span
              style={{
                fontSize: TOKENS.typography.fontSize.xs,
                color: THEME_COLORS.muted,
                padding: '3px 10px',
                borderRadius: 999,
                backgroundColor: THEME_COLORS.surfaceSubtle,
                border: `1px solid ${THEME_COLORS.borderSubtle}`,
                whiteSpace: 'nowrap',
              }}
            >
              {activeCount} đang dùng · {rows.length - activeCount} ngừng dùng
            </span>
          </div>

          <div
            style={{
              flex: narrow ? '1 1 100%' : '0 1 280px',
              minWidth: narrow ? 0 : 220,
            }}
          >
            <input
              type="text"
              data-testid="category-search-input"
              aria-label={`Tìm kiếm danh mục ${isExpense ? 'khoản chi' : 'nguồn thu'}`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Tìm kiếm danh mục ${isExpense ? 'khoản chi' : 'nguồn thu'}…`}
              style={{
                width: '100%',
                minHeight: 36,
                padding: '6px 12px',
                backgroundColor: THEME_COLORS.surface,
                border: `1px solid ${THEME_COLORS.border}`,
                borderRadius: TOKENS.radii.sm,
                color: THEME_COLORS.text,
                fontSize: TOKENS.typography.fontSize.sm,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {rows.length === 0 && !r.loading && !r.error ? (
          <div
            style={{
              padding: '36px 20px',
              textAlign: 'center',
              color: THEME_COLORS.muted,
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
              color: THEME_COLORS.muted,
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
              backgroundColor: THEME_COLORS.surface,
              overflowX: 'auto',
            }}
          >
            {/* Tiêu đề cột chuẩn bảng trên màn hình rộng */}
            {!narrow && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    '56px minmax(200px, 1fr) 150px 150px 116px',
                  alignItems: 'center',
                  padding: '10px 18px',
                  backgroundColor: THEME_COLORS.surfaceSubtle,
                  borderBottom: `1px solid ${THEME_COLORS.borderSubtle}`,
                  fontSize: TOKENS.typography.fontSize.xs,
                  fontWeight: TOKENS.typography.fontWeight.semibold,
                  color: THEME_COLORS.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                <span>STT</span>
                <span>Tên danh mục</span>
                <span>Phân loại</span>
                <span>Trạng thái</span>
                <span style={{ textAlign: 'right' }}>Thao tác</span>
              </div>
            )}

            {filteredRows.map((c, idx) => {
              const rowNumber = String(page * pageSize + idx + 1).padStart(
                2,
                '0',
              );
              return (
                <div
                  key={c.id}
                  style={{
                    display: narrow ? 'flex' : 'grid',
                    gridTemplateColumns: narrow
                      ? undefined
                      : '56px minmax(200px, 1fr) 150px 150px 116px',
                    justifyContent: narrow ? 'space-between' : undefined,
                    alignItems: 'center',
                    padding: narrow ? '12px 14px' : '10px 18px',
                    gap: narrow ? '10px 12px' : 0,
                    flexWrap: narrow ? 'wrap' : undefined,
                    minWidth: 0,
                    borderBottom:
                      idx === filteredRows.length - 1
                        ? 'none'
                        : `1px solid ${THEME_COLORS.borderSubtle}`,
                    backgroundColor: c.is_active
                      ? THEME_COLORS.surface
                      : THEME_COLORS.surfaceSubtle,
                  }}
                >
                  {!narrow && (
                    <span
                      style={{
                        fontSize: TOKENS.typography.fontSize.xs,
                        fontWeight: TOKENS.typography.fontWeight.semibold,
                        color: THEME_COLORS.muted,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {rowNumber}
                    </span>
                  )}

                  {/* Tên danh mục hiển thị đầy đủ, không cắt chữ */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flex: narrow ? '1 1 180px' : undefined,
                      minWidth: 0,
                      paddingRight: narrow ? 0 : 12,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        flexShrink: 0,
                        backgroundColor: !c.is_active
                          ? THEME_COLORS.muted
                          : isExpense
                            ? THEME_COLORS.warning
                            : THEME_COLORS.success,
                      }}
                    />
                    <span
                      style={{
                        fontSize: TOKENS.typography.fontSize.base,
                        fontWeight: TOKENS.typography.fontWeight.semibold,
                        color: c.is_active
                          ? THEME_COLORS.text
                          : THEME_COLORS.muted,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {c.name}
                    </span>
                    {narrow && (
                      <AppBadge
                        variant={c.is_active ? 'success' : 'muted'}
                        size="sm"
                      >
                        {c.is_active ? 'Đang dùng' : 'Ngừng dùng'}
                      </AppBadge>
                    )}
                  </div>

                  {/* Cột Phân loại */}
                  {!narrow && (
                    <span
                      style={{
                        fontSize: TOKENS.typography.fontSize.sm,
                        color: THEME_COLORS.textSecondary,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isExpense ? 'Khoản chi' : 'Nguồn thu'}
                    </span>
                  )}

                  {/* Cột Trạng thái thẳng hàng */}
                  {!narrow && (
                    <div>
                      <AppBadge
                        variant={c.is_active ? 'success' : 'muted'}
                        size="sm"
                      >
                        {c.is_active ? 'Đang dùng' : 'Ngừng dùng'}
                      </AppBadge>
                    </div>
                  )}

                  {/* Cột Thao tác căn phải */}
                  <div
                    style={{
                      ...iconActionsStyle,
                      justifyContent: 'flex-end',
                    }}
                  >
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

        {/* Thanh phân trang nằm gọn trong chân thẻ, chừa khoảng đệm phải tránh nút Báo lỗi nổi */}
        <div
          style={{
            padding: narrow ? '12px 14px' : '12px 148px 12px 18px',
            borderTop: `1px solid ${THEME_COLORS.borderSubtle}`,
            backgroundColor: THEME_COLORS.surfaceSubtle,
            borderBottomLeftRadius: TOKENS.radii.md,
            borderBottomRightRadius: TOKENS.radii.md,
          }}
        >
          <FinancePager
            testId="cat-pager"
            total={searchQuery.trim() ? filteredRows.length : total}
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
        </div>
      </AppCard>

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
            color: THEME_COLORS.textSecondary,
            fontSize: TOKENS.typography.fontSize.base,
            lineHeight: TOKENS.typography.lineHeight.relaxed,
          }}
        >
          Bạn có chắc chắn muốn ngừng sử dụng danh mục{' '}
          <strong style={{ color: THEME_COLORS.text }}>
            {deactivateTarget?.name}
          </strong>
          ?
        </p>
        <p
          style={{
            margin: '8px 0 0 0',
            color: THEME_COLORS.muted,
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
