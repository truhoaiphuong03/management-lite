import React from 'react';
import {
  AppButton,
  LinkIcon,
} from '../../../../../packages/ui/src/components/index.js';
import type { StorageDriveConnectionData } from '../../../../../packages/contracts/src/index.js';

export interface StorageDriveOAuthModalProps {
  driveConnection: StorageDriveConnectionData | null;
  oauthUrlPreview: string | null;
  oauthGoogleEmail: string;
  setOauthGoogleEmail: (val: string) => void;
  oauthCode: string;
  setOauthCode: (val: string) => void;
  oauthRootFolderName: string;
  setOauthRootFolderName: (val: string) => void;
  actionLoading: boolean;
  onCopySuccess: (msg: string) => void;
  onPreviewOAuthUrl: () => void;
  onConnectDriveOAuth: (e: React.FormEvent) => void;
  onDisconnectDriveOAuth: () => void;
  onClose: () => void;
}

export const StorageDriveOAuthModal: React.FC<StorageDriveOAuthModalProps> = ({
  driveConnection,
  oauthUrlPreview,
  oauthGoogleEmail,
  setOauthGoogleEmail,
  oauthCode,
  setOauthCode,
  oauthRootFolderName,
  setOauthRootFolderName,
  actionLoading,
  onCopySuccess,
  onPreviewOAuthUrl,
  onConnectDriveOAuth,
  onDisconnectDriveOAuth,
  onClose,
}) => {
  const redirectUri =
    driveConnection?.redirect_uri ||
    'https://ql.hoaiphuong.click/api/v1/storage/drive/oauth/callback';

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--surface-color)',
          boxShadow: 'var(--shadow-lg)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          width: '100%',
          maxWidth: '520px',
          padding: '24px',
        }}
      >
        <h3
          style={{
            margin: '0 0 8px 0',
            fontSize: '18px',
            fontWeight: 700,
            color: 'var(--text-color)',
          }}
        >
          Kết nối Google Drive (OAuth 2.0)
        </h3>
        <p
          style={{
            margin: '0 0 16px 0',
            fontSize: '13px',
            color: 'var(--muted-color)',
            lineHeight: '1.5',
          }}
        >
          Sử dụng phạm vi quyền tối thiểu{' '}
          <code>https://www.googleapis.com/auth/drive.file</code> (chỉ quản lý
          thư mục và tệp do Management Lite khởi tạo). Refresh token được mã hóa
          AES-256-GCM trên máy chủ.
        </p>

        <form onSubmit={onConnectDriveOAuth}>
          <div
            style={{
              marginBottom: '12px',
              padding: '10px 12px',
              backgroundColor: 'var(--surface-subtle)',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              fontSize: '12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                flexWrap: 'wrap',
                marginBottom: '4px',
              }}
            >
              <strong style={{ color: 'var(--text-color)' }}>
                Authorized Redirect URI (Google Cloud Console):
              </strong>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (navigator?.clipboard?.writeText) {
                      void navigator.clipboard.writeText(redirectUri);
                      onCopySuccess(`Đã sao chép Redirect URI: ${redirectUri}`);
                    }
                  }}
                  style={{
                    padding: '3px 8px',
                    fontSize: '12px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--surface-card)',
                    color: 'var(--info-text)',
                    cursor: 'pointer',
                  }}
                >
                  Sao chép URI
                </button>
                <a
                  href="https://console.cloud.google.com/apis/credentials?project=980505397989"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '3px 8px',
                    fontSize: '12px',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--surface-card)',
                    color: 'var(--info-text)',
                    textDecoration: 'none',
                  }}
                >
                  Mở Google Cloud Console ↗
                </a>
              </div>
            </div>
            <code
              style={{
                display: 'block',
                color: 'var(--info-text)',
                wordBreak: 'break-all',
              }}
            >
              {redirectUri}
            </code>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <AppButton
                type="button"
                variant="secondary"
                onClick={onPreviewOAuthUrl}
              >
                <LinkIcon size={14} />
                <span>Lấy URL xác thực Google OAuth 2.0</span>
              </AppButton>
              {oauthUrlPreview && (
                <a
                  href={oauthUrlPreview}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '8px 12px',
                    backgroundColor: 'rgba(56, 189, 248, 0.15)',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    borderRadius: '6px',
                    color: 'var(--info-text)',
                    fontSize: '12px',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  Mở trang ủy quyền Google ↗
                </a>
              )}
            </div>
            {oauthUrlPreview && (
              <div
                style={{
                  marginTop: '8px',
                  padding: '8px 10px',
                  backgroundColor: 'var(--surface-subtle)',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  fontSize: '12px',
                  color: 'var(--info-text)',
                  wordBreak: 'break-all',
                }}
              >
                {oauthUrlPreview}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                color: 'var(--muted-color)',
                marginBottom: '6px',
              }}
            >
              Email tài khoản Google quản trị *
            </label>
            <input
              type="email"
              required
              value={oauthGoogleEmail}
              onChange={(e) => setOauthGoogleEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-color)',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                color: 'var(--muted-color)',
                marginBottom: '6px',
              }}
            >
              Mã ủy quyền OAuth 2.0 (Authorization Code) *
            </label>
            <input
              type="text"
              required
              value={oauthCode}
              onChange={(e) => setOauthCode(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-color)',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '13px',
                color: 'var(--muted-color)',
                marginBottom: '6px',
              }}
            >
              Tên thư mục gốc ứng dụng trên Google Drive
            </label>
            <input
              type="text"
              value={oauthRootFolderName}
              onChange={(e) => setOauthRootFolderName(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-color)',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            {driveConnection?.connected ? (
              <AppButton
                type="button"
                variant="destructive"
                onClick={onDisconnectDriveOAuth}
                disabled={actionLoading}
              >
                Ngắt kết nối Drive
              </AppButton>
            ) : (
              <div />
            )}
            <div style={{ display: 'flex', gap: '10px' }}>
              <AppButton type="button" variant="secondary" onClick={onClose}>
                Đóng
              </AppButton>
              <AppButton
                type="submit"
                variant="primary"
                disabled={actionLoading}
              >
                Kết nối Google Drive
              </AppButton>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
export default StorageDriveOAuthModal;
