import { useEffect, useRef, useState } from 'react';
import type {
  FinancePage,
  FinanceEntryData,
  FinanceCategoryData,
  FinanceCorrectionData,
  FinanceDirection,
} from '../../../../packages/contracts/src/finance.js';
import {
  parseFinanceEntry,
  parseFinanceCorrection,
} from '../../../../packages/contracts/src/finance.js';
import {
  AppInput,
  AppTextarea,
  AppButton,
  AppCard,
  AppDialog,
  ListFooter,
  TOKENS,
  THEME_COLORS,
} from '../../../../packages/ui/src/index.js';
import {
  FinanceNav,
  FinanceHeader,
  ReadStatus,
  useFinanceRead,
  useFinanceMutation,
  MutationNotice,
  financeStyle,
  fieldStyle,
  type FinanceScreenProps,
} from '../finance/ui.js';
import { createReceiptApi, formatVnd } from '../finance/client.js';
import { resolveEntryTime, vnDateTimeLocal } from '../finance/time.js';
import { ReceiptPanel } from '../finance/ReceiptPanel.js';
import type { PrefillFields, ReceiptApi } from '../finance/receipt.js';
export function FinanceEntryScreen({
  identity,
  onNavigate,
  entryId: rawEntryId,
  receipt: receiptProp,
  defaultReceipt = false,
  aiEnabled,
  dialog,
}: FinanceScreenProps & {
  entryId?: string;
  receipt?: ReceiptApi;
  defaultReceipt?: boolean;
  aiEnabled?: boolean;
  /**
   * Render the new-entry form inside an AppDialog instead of a page. The parent mounts this
   * component only while the dialog is open, so every open starts with a clean form.
   */
  dialog?: { onClose: () => void; onSaved: (entryId: string) => void };
}) {
  const entryId = rawEntryId && rawEntryId !== 'new' ? rawEntryId : undefined;
  const receipt =
    receiptProp ?? (defaultReceipt ? createReceiptApi(identity) : undefined);
  const [direction, setDirection] = useState<FinanceDirection>('expense');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString('en-CA'),
  );
  const [autoTime, setAutoTime] = useState(true);
  const [manualTime, setManualTime] = useState(() =>
    vnDateTimeLocal(new Date()),
  );
  const [suggestedAt, setSuggestedAt] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  // Correction of a timed entry edits the instant; legacy date-only rows keep the date input.
  const [originalAt, setOriginalAt] = useState<string | null>(null);
  const [correctionAt, setCorrectionAt] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [validation, setValidation] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const detail = useFinanceRead<FinanceEntryData>(
    identity,
    entryId ? '/entries/' + entryId : '/categories?limit=1',
  );
  const [catCursor, setCatCursor] = useState<string | null>(null);
  const [categories, setCategories] = useState<FinanceCategoryData[]>([]);
  const cats = useFinanceRead<FinancePage<FinanceCategoryData>>(
    identity,
    '/categories?' +
      new URLSearchParams({
        direction,
        limit: '100',
        ...(catCursor ? { cursor: catCursor } : {}),
      }),
  );
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<FinanceCorrectionData[]>([]);
  const h = useFinanceRead<FinancePage<FinanceCorrectionData>>(
    identity,
    entryId
      ? '/entries/' +
          entryId +
          '/corrections?' +
          new URLSearchParams({
            limit: '50',
            ...(historyCursor ? { cursor: historyCursor } : {}),
          })
      : '/categories?limit=1',
  );
  const m = useFinanceMutation(
    identity,
    entryId ? 'correct:' + entryId : 'new-entry',
  );
  useEffect(() => {
    if (cats.data)
      setCategories((prev) => {
        const map = new Map((catCursor ? prev : []).map((c) => [c.id, c]));
        for (const c of cats.data!.items) map.set(c.id, c);
        return [...map.values()];
      });
  }, [cats.data, catCursor]);
  useEffect(() => {
    if (entryId && h.data)
      setHistory((prev) => {
        const map = new Map((historyCursor ? prev : []).map((c) => [c.id, c]));
        for (const c of h.data!.items) map.set(c.id, c);
        return [...map.values()];
      });
  }, [h.data, historyCursor, entryId]);
  function beginCorrection() {
    const d = detail.data;
    if (!d) return;
    setDirection(d.direction);
    setCategory(d.category_id);
    setAmount(d.amount_vnd);
    setDate(d.occurred_on);
    const local = d.occurred_at ? d.occurred_at.slice(0, 16) : null;
    setOriginalAt(local);
    setCorrectionAt(local);
    setNote(d.note ?? '');
    setReason('');
    if (d.direction !== direction) {
      // A different direction triggers a refetch; the same direction keeps the loaded list.
      setCategories([]);
      setCatCursor(null);
    }
    setEditing(true);
  }
  function applyPrefill(f: PrefillFields) {
    if (f.amount) setAmount(f.amount);
    if (f.note) setNote(f.note);
    if (f.direction && f.direction !== direction) {
      setDirection(f.direction);
      setCategory('');
      setCategories([]);
      setCatCursor(null);
    } else if (f.categoryId) setCategory(f.categoryId);
    setSuggestedAt(f.occurredAt ?? null);
  }
  async function save() {
    setValidation('');
    try {
      let timeFields: Record<string, string> = {};
      let correctionTime: Record<string, string> = { occurred_on: date };
      if (entryId && correctionAt !== null && !m.pending) {
        correctionTime = {};
        if (correctionAt !== originalAt) {
          const t = resolveEntryTime({
            auto: false,
            manualLocal: correctionAt,
            now: new Date(),
          });
          if (!t.ok) {
            setValidation(
              t.error === 'future'
                ? 'Không thể chọn thời gian trong tương lai.'
                : 'Ngày giờ không hợp lệ.',
            );
            return;
          }
          correctionTime = { time_mode: 'manual', occurred_at: t.occurred_at };
        }
      }
      if (!entryId && !m.pending) {
        const t = resolveEntryTime({
          auto: autoTime,
          manualLocal: manualTime,
          now: new Date(),
        });
        if (!t.ok) {
          setValidation(
            t.error === 'future'
              ? 'Không thể chọn thời gian trong tương lai.'
              : 'Ngày giờ không hợp lệ.',
          );
          return;
        }
        timeFields =
          t.mode === 'auto'
            ? { time_mode: 'auto' }
            : { time_mode: 'manual', occurred_at: t.occurred_at };
      }
      const payload =
        m.pending?.payload ??
        (entryId
          ? parseFinanceCorrection({
              direction,
              category_id: category,
              amount_vnd: amount,
              ...correctionTime,
              note: note || null,
              reason,
            })
          : parseFinanceEntry({
              direction,
              category_id: category,
              amount_vnd: amount,
              ...timeFields,
              note: note || null,
              ...(receiptId ? { receipt_id: receiptId } : {}),
            }));
      const result = await m.submit(
        entryId ? '/entries/' + entryId + '/correct' : '/entries',
        'POST',
        { ...payload },
        entryId ? (detail.data?.version ?? null) : null,
      );
      if (result) {
        if (entryId) {
          setEditing(false);
          setHistory([]);
          setHistoryCursor(null);
          detail.retry();
          h.retry();
        } else if (dialog) dialog.onSaved(result.id);
        else onNavigate('/finance/entries/' + result.id);
      }
    } catch {
      setValidation(
        'Kiểm tra danh mục, số tiền nguyên dương, ngày hợp lệ và lý do chỉnh sửa.',
      );
    }
  }
  const showForm = !entryId || editing || Boolean(m.pending);
  const inDialog = Boolean(dialog) && !entryId;
  const dirty =
    amount !== '' ||
    category !== '' ||
    note !== '' ||
    receiptId !== null ||
    !autoTime ||
    Boolean(m.pending);
  // Keyboard: put focus on the first field once the dialog has trapped focus on its close button.
  useEffect(() => {
    if (!inDialog) return;
    const t = setTimeout(() => firstFieldRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [inDialog]);
  useEffect(() => {
    if (confirmDiscard)
      discardRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [confirmDiscard]);
  function requestClose() {
    if (!dialog) return;
    // Esc while the discard warning is showing means "keep editing".
    if (confirmDiscard) return setConfirmDiscard(false);
    if (dirty) return setConfirmDiscard(true);
    dialog.onClose();
  }
  const content = (
    <section style={financeStyle}>
      {!inDialog && <FinanceNav onNavigate={onNavigate} />}
      {!inDialog && (
        <FinanceHeader
          title={entryId ? 'Chi tiết giao dịch' : 'Thêm khoản thu/chi'}
        />
      )}
      {inDialog && confirmDiscard && (
        <div
          ref={discardRef}
          role="alert"
          data-testid="entry-discard-warning"
          style={{
            display: 'grid',
            gap: 10,
            padding: 12,
            borderRadius: TOKENS.radii.sm,
            border: `1px solid ${THEME_COLORS.error}`,
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            color: THEME_COLORS.text,
          }}
        >
          <span>Bạn có dữ liệu chưa lưu. Bỏ thay đổi và đóng hộp thoại?</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <AppButton
              size="sm"
              variant="secondary"
              data-testid="entry-keep-editing"
              onClick={() => setConfirmDiscard(false)}
            >
              Tiếp tục nhập
            </AppButton>
            <AppButton
              size="sm"
              variant="destructive"
              data-testid="entry-discard"
              onClick={() => dialog?.onClose()}
            >
              Bỏ thay đổi
            </AppButton>
          </div>
        </div>
      )}
      {entryId && (
        <>
          <ReadStatus {...detail} />
          {detail.data && (
            <AppCard>
              <div
                style={{
                  fontSize: '13px',
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                {detail.data.occurred_at
                  ? detail.data.occurred_at.replace('T', ' ').slice(0, 16)
                  : detail.data.occurred_on}{' '}
                · {detail.data.category_name_snapshot}
              </div>
              <strong
                style={{
                  display: 'block',
                  fontSize: '20px',
                  color: 'var(--text-color)',
                  marginBottom: '8px',
                }}
              >
                {formatVnd(detail.data.amount_vnd)}
              </strong>
              {detail.data.note && (
                <p
                  style={{
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    margin: '0 0 8px 0',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                  }}
                >
                  {detail.data.note}
                </p>
              )}
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                Phiên bản {detail.data.version}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  marginTop: 12,
                }}
              >
                <AppButton
                  disabled={m.busy || Boolean(m.pending)}
                  onClick={beginCorrection}
                >
                  Chỉnh sửa có lý do
                </AppButton>
                <AppButton variant="secondary" onClick={detail.retry}>
                  Tải lại chi tiết
                </AppButton>
              </div>
            </AppCard>
          )}
        </>
      )}
      {showForm && (
        <form
          ref={formRef}
          style={financeStyle}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset
            disabled={m.busy || Boolean(m.pending)}
            style={{
              border: 0,
              padding: 0,
              minWidth: 0,
              display: 'grid',
              gap: 16,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                gap: 16,
                alignItems: 'start',
              }}
            >
              <label>
                Loại
                <select
                  ref={firstFieldRef}
                  style={fieldStyle}
                  value={direction}
                  onChange={(e) => {
                    const nextDir = e.target.value as FinanceDirection;
                    if (nextDir === direction) return;
                    setDirection(nextDir);
                    setCategory('');
                    setCategories([]);
                    setCatCursor(null);
                  }}
                >
                  <option value="income">Thu</option>
                  <option value="expense">Chi</option>
                </select>
              </label>
              <AppInput
                label="Số tiền VND"
                inputMode="numeric"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                helperText="Số nguyên từ 1 đến 9223372036854775807."
              />
            </div>
            <ReadStatus {...cats} />
            <label>
              Danh mục đang sử dụng
              <select
                style={fieldStyle}
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Chọn danh mục</option>
                {categories
                  .filter((c) => c.is_active && c.direction === direction)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            {cats.data?.next_cursor && (
              <AppButton
                type="button"
                onClick={() => setCatCursor(cats.data!.next_cursor)}
              >
                Tải thêm danh mục
              </AppButton>
            )}
            {entryId && correctionAt !== null ? (
              <AppInput
                label="Ngày giờ phát sinh (giờ Việt Nam)"
                type="datetime-local"
                required
                max={vnDateTimeLocal(new Date())}
                value={correctionAt}
                onChange={(e) => setCorrectionAt(e.target.value)}
                helperText="Không chọn thời gian trong tương lai."
              />
            ) : entryId ? (
              <AppInput
                label="Ngày phát sinh"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            ) : (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={autoTime}
                    onChange={(e) => setAutoTime(e.target.checked)}
                  />{' '}
                  Tự động ghi ngày giờ khi lưu
                </label>
                {autoTime ? (
                  <p>
                    Thời gian sẽ được ghi theo lúc bạn bấm Lưu (giờ Việt Nam).
                  </p>
                ) : (
                  <AppInput
                    label="Ngày giờ phát sinh (giờ Việt Nam)"
                    type="datetime-local"
                    required
                    max={vnDateTimeLocal(new Date())}
                    value={manualTime}
                    onChange={(e) => setManualTime(e.target.value)}
                    helperText="Không chọn thời gian trong tương lai."
                  />
                )}
                {autoTime && suggestedAt && (
                  <AppButton
                    type="button"
                    onClick={() => {
                      setAutoTime(false);
                      setManualTime(suggestedAt);
                    }}
                  >
                    Dùng ngày giờ trên ảnh ({suggestedAt.replace('T', ' ')})
                  </AppButton>
                )}
              </>
            )}
            <AppTextarea
              label="Ghi chú"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {!entryId && receipt && (
              <ReceiptPanel
                api={receipt}
                {...(aiEnabled === undefined ? {} : { aiEnabled })}
                categoryIds={
                  new Set(
                    categories
                      .filter((c) => c.is_active && c.direction === direction)
                      .map((c) => c.id),
                  )
                }
                disabled={m.busy || Boolean(m.pending)}
                onPrefill={applyPrefill}
                onReceiptChange={setReceiptId}
              />
            )}
            {entryId && (
              <AppTextarea
                label="Lý do chỉnh sửa"
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </fieldset>
          {validation && <p role="alert">{validation}</p>}
          {inDialog && <button type="submit" hidden aria-hidden="true" />}
          <div
            style={{
              display: inDialog ? 'none' : 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <AppButton
              type="submit"
              disabled={
                !m.ready || m.busy || (Boolean(entryId) && !detail.data)
              }
              isLoading={m.busy}
            >
              {m.pending ? 'Thử lại đúng yêu cầu đã lưu' : 'Lưu giao dịch'}
            </AppButton>
            {entryId && !m.pending && (
              <AppButton
                variant="secondary"
                type="button"
                onClick={() => setEditing(false)}
              >
                Hủy chỉnh sửa
              </AppButton>
            )}
          </div>
        </form>
      )}
      <MutationNotice mutation={m} />
      {entryId && (
        <>
          <h2>Lịch sử chỉnh sửa</h2>
          <ReadStatus {...h} />
          {history.map((c) => (
            <AppCard key={c.id}>
              <p>{c.created_at}</p>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {c.reason}
              </p>
              <p style={{ overflowWrap: 'anywhere' }}>
                Revision: {c.original_revision_id} → {c.replacement_revision_id}
              </p>
            </AppCard>
          ))}
          {!h.loading && !h.error && history.length === 0 && (
            <p>Chưa có chỉnh sửa.</p>
          )}
          <ListFooter
            itemCount={history.length}
            loading={h.loading}
            hasNextPage={Boolean(h.data?.next_cursor)}
            onLoadMore={() => {
              if (h.data?.next_cursor) setHistoryCursor(h.data.next_cursor);
            }}
          />
        </>
      )}
    </section>
  );
  if (!inDialog) return content;
  return (
    <AppDialog
      isOpen
      title="Thêm thu/chi"
      maxWidth="640px"
      cancelLabel="Hủy"
      confirmLabel={m.pending ? 'Thử lại đúng yêu cầu đã lưu' : 'Lưu giao dịch'}
      isLoading={m.busy}
      onClose={requestClose}
      onConfirm={() => {
        if (!m.ready || m.busy) return;
        // Prefer the form's own submit so native required/format checks and Enter behave the same.
        const f = formRef.current;
        if (f && typeof f.requestSubmit === 'function') f.requestSubmit();
        else void save();
      }}
    >
      {content}
    </AppDialog>
  );
}
