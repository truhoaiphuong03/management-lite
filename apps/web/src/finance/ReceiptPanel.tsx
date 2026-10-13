import { useEffect, useRef, useState } from 'react';
import { AppButton, TOKENS } from '../../../../packages/ui/src/index.js';
import {
  checkReceiptBytes,
  receiptRejectionMessage,
  suggestionToPrefill,
  type PrefillFields,
  type ReceiptApi,
} from './receipt.js';
import { FIN_AI_ENABLED } from './flags.js';

type Phase = 'idle' | 'uploading' | 'uploaded' | 'extracting';
export interface ReceiptPanelProps {
  api: ReceiptApi;
  categoryIds: ReadonlySet<string>;
  disabled?: boolean;
  /** Only the Owner's confirmed Save posts a transaction; this just prefills the form. */
  onPrefill: (fields: PrefillFields) => void;
  /** Receipt id to attach on save, or null. */
  onReceiptChange: (receiptId: string | null) => void;
  now?: () => Date;
  /** Shows "Đọc bằng AI". Defaults to the release switch (off in phase 1). */
  aiEnabled?: boolean;
}
export function ReceiptPanel({
  api,
  categoryIds,
  disabled,
  onPrefill,
  onReceiptChange,
  now = () => new Date(),
  aiEnabled = FIN_AI_ENABLED,
}: ReceiptPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const token = useRef(0);
  const active = useRef<AbortController | null>(null);
  const previewRef = useRef<string | null>(null);
  function setPreviewUrl(url: string | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreview(url);
  }
  useEffect(
    () => () => {
      token.current++;
      active.current?.abort();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );
  async function onFile(file: File | undefined) {
    if (!file) return;
    const my = ++token.current;
    active.current?.abort();
    const c = new AbortController();
    active.current = c;
    setMessage('');
    setFlagged([]);
    onReceiptChange(null);
    setReceiptId(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (my !== token.current) return;
    const check = checkReceiptBytes(bytes);
    if (!check.ok) {
      setPreviewUrl(null);
      setPhase('idle');
      setMessage(receiptRejectionMessage[check.reason]);
      return;
    }
    setPreviewUrl(
      URL.createObjectURL(new Blob([bytes as BlobPart], { type: check.mime })),
    );
    setPhase('uploading');
    try {
      const up = await api.upload(bytes, check.mime, c.signal);
      if (my !== token.current) return;
      setReceiptId(up.id);
      onReceiptChange(up.id);
      setPhase('uploaded');
      setMessage(
        up.duplicate_of_entry_id
          ? 'Ảnh này đã được gắn vào một giao dịch khác. Hãy kiểm tra trước khi lưu.'
          : 'Đã tải ảnh lên.',
      );
    } catch {
      if (my !== token.current) return;
      setPhase('idle');
      setMessage(
        'Không tải được ảnh. Bạn vẫn có thể nhập thủ công hoặc thử lại.',
      );
    }
  }
  async function readWithAi() {
    if (!receiptId || phase !== 'uploaded') return;
    const my = ++token.current;
    const c = new AbortController();
    active.current = c;
    setPhase('extracting');
    setMessage('Đang đọc ảnh…');
    try {
      const r = await api.extract(receiptId, c.signal);
      if (my !== token.current) return;
      if (r.status !== 'ok') {
        setMessage('Chưa đọc được bằng AI. Hãy nhập thủ công.');
      } else {
        const fields = suggestionToPrefill(r.data, categoryIds, now());
        setFlagged(fields.flagged);
        onPrefill(fields);
        setMessage('AI gợi ý — hãy kiểm tra và chỉnh sửa trước khi lưu.');
      }
    } catch {
      if (my !== token.current) return;
      setMessage('Chưa đọc được bằng AI. Hãy nhập thủ công.');
    }
    setPhase('uploaded');
  }
  async function discard() {
    const id = receiptId;
    token.current++;
    active.current?.abort();
    setPreviewUrl(null);
    setReceiptId(null);
    onReceiptChange(null);
    setFlagged([]);
    setPhase('idle');
    setMessage('');
    if (id) {
      try {
        await api.discard(id, new AbortController().signal);
      } catch {
        // staged receipts expire after 24h; nothing else to do
      }
    }
  }
  const busy = phase === 'uploading' || phase === 'extracting';
  return (
    <div aria-label="Ảnh hóa đơn" style={{ display: 'grid', gap: 8 }}>
      <span
        style={{
          fontSize: TOKENS.typography.fontSize.sm,
          color: TOKENS.colors.textSecondary,
        }}
      >
        Ảnh hóa đơn (không bắt buộc)
      </span>
      <label
        data-testid="receipt-dropzone"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          padding: '12px 14px',
          borderRadius: TOKENS.radii.md,
          border: `1px dashed ${focused ? TOKENS.colors.primary : TOKENS.colors.border}`,
          backgroundColor: TOKENS.colors.surfaceSubtle,
          cursor: disabled || busy ? 'not-allowed' : 'pointer',
          opacity: disabled || busy ? 0.6 : 1,
          outline: focused ? `2px solid ${TOKENS.colors.primary}` : 'none',
          outlineOffset: 2,
        }}
      >
        <input
          type="file"
          accept="image/jpeg,image/png"
          disabled={disabled || busy}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
            overflow: 'hidden',
          }}
        />
        <span
          aria-hidden="true"
          style={{
            padding: '6px 12px',
            borderRadius: TOKENS.radii.sm,
            border: `1px solid ${TOKENS.colors.border}`,
            backgroundColor: TOKENS.colors.surface,
            color: TOKENS.colors.text,
            fontSize: TOKENS.typography.fontSize.sm,
            fontWeight: TOKENS.typography.fontWeight.semibold,
          }}
        >
          {receiptId ? 'Chọn ảnh khác' : 'Chọn ảnh'}
        </span>
        <span
          style={{
            fontSize: TOKENS.typography.fontSize.xs,
            color: TOKENS.colors.muted,
          }}
        >
          JPEG hoặc PNG, tối đa 4 MB
        </span>
      </label>
      {preview && (
        <img
          src={preview}
          alt="Xem trước hóa đơn"
          style={{
            maxWidth: '100%',
            maxHeight: 160,
            objectFit: 'contain',
            borderRadius: TOKENS.radii.sm,
            border: `1px solid ${TOKENS.colors.borderSubtle}`,
          }}
        />
      )}
      {phase === 'uploading' && (
        <p role="status" style={statusText}>
          Đang tải ảnh lên…
        </p>
      )}
      {message && (
        <p role="status" style={statusText}>
          {message}
        </p>
      )}
      {flagged.length > 0 && (
        <p role="status" style={statusText}>
          Cần kiểm tra kỹ: {flagged.join(', ')}
        </p>
      )}
      {receiptId && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {aiEnabled && (
            <AppButton
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled || busy}
              onClick={() => void readWithAi()}
            >
              Đọc bằng AI
            </AppButton>
          )}
          <AppButton
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void discard()}
          >
            Bỏ ảnh
          </AppButton>
        </div>
      )}
    </div>
  );
}
const statusText: React.CSSProperties = {
  margin: 0,
  fontSize: TOKENS.typography.fontSize.sm,
  color: TOKENS.colors.textSecondary,
};
