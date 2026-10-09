import React from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  ClockIcon,
  InfoIcon,
  FileTextIcon,
  BanknoteIcon,
  SettingsIcon,
} from '@management-lite/ui/components';
import type { UserRole } from '../types.js';

export interface DashboardScreenProps {
  role: UserRole;
  onNavigate: (path: string) => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  role,
  onNavigate,
}) => {
  return (
    <div>
      <PageHeader
        title="Tổng quan hoạt động"
        subtitle="Workspace: Studio Media Lite | Múi giờ: Asia/Ho_Chi_Minh"
        badge={
          <StatusBadge
            status={role === 'owner' ? 'neutral' : 'muted'}
            label={
              role === 'owner' ? 'Chủ sở hữu (Owner)' : 'Nhân viên (Staff)'
            }
          />
        }
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <AppButton
              variant="primary"
              onClick={() => onNavigate('/clock')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <ClockIcon size={16} />
              <span>Vào Chấm công</span>
            </AppButton>
          </div>
        }
      />

      {/* Demo status alert */}
      <div
        style={{
          padding: '12px 16px',
          borderRadius: '8px',
          backgroundColor: 'rgba(20, 184, 166, 0.1)',
          border: '1px solid rgba(20, 184, 166, 0.3)',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <InfoIcon size={20} style={{ color: '#14B8A6' }} />
        <div style={{ fontSize: '13px', color: '#F8FAFC' }}>
          <strong>Chế độ xem trước (FT-01 Demo):</strong> Dữ liệu trên màn hình
          là giao diện mẫu. Mọi thao tác trên trang demo không làm thay đổi cơ
          sở dữ liệu backend.
        </div>
      </div>

      {/* Summary metric cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <AppCard padding="16px">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Trạng thái ca làm
            </span>
            <StatusBadge status="success" label="Đang làm" />
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              margin: '8px 0',
              color: '#F8FAFC',
            }}
          >
            03:42:15
          </div>
          <div style={{ fontSize: '12px', color: '#94A3B8' }}>
            Bắt đầu: 08:30 (Hôm nay)
          </div>
        </AppCard>

        <AppCard padding="16px">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Báo cáo hàng ngày
            </span>
            <StatusBadge status="warning" label="Chưa nộp" />
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              margin: '8px 0',
              color: '#F8FAFC',
            }}
          >
            1 Báo cáo
          </div>
          <div style={{ fontSize: '12px', color: '#94A3B8' }}>
            Hạn chót: 23:59 hôm nay
          </div>
        </AppCard>

        {role === 'owner' ? (
          <>
            <AppCard padding="16px">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                  Nhân sự trực tiếp
                </span>
                <StatusBadge status="neutral" label="Owner view" />
              </div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  margin: '8px 0',
                  color: '#F8FAFC',
                }}
              >
                8 Nhân viên
              </div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                6 đang làm việc, 2 nghỉ phép
              </div>
            </AppCard>

            <AppCard padding="16px">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                  Kỳ lương V0.1
                </span>
                <StatusBadge status="muted" label="Draft" />
              </div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  margin: '8px 0',
                  color: '#F8FAFC',
                }}
              >
                Tháng 10/2026
              </div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                C04 kiểm tra: Không có net âm
              </div>
            </AppCard>
          </>
        ) : (
          <AppCard padding="16px">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                Công tháng hiện tại
              </span>
              <StatusBadge status="neutral" label="Staff view" />
            </div>
            <div
              style={{
                fontSize: '24px',
                fontWeight: 700,
                margin: '8px 0',
                color: '#F8FAFC',
              }}
            >
              18 Ca hoàn thành
            </div>
            <div style={{ fontSize: '12px', color: '#94A3B8' }}>
              144 giờ làm việc tích lũy
            </div>
          </AppCard>
        )}
      </div>

      {/* Quick Action Navigation Grid */}
      <h3
        style={{
          fontSize: '16px',
          fontWeight: 600,
          marginBottom: '12px',
          color: '#F8FAFC',
        }}
      >
        Lối tắt thao tác nhanh
      </h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '12px',
        }}
      >
        <AppCard
          padding="16px"
          interactive
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('/clock')}
        >
          <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
            <ClockIcon size={24} />
          </div>
          <div
            style={{ fontWeight: 600, color: '#F8FAFC', marginBottom: '4px' }}
          >
            Chấm công (UI04)
          </div>
          <div style={{ fontSize: '13px', color: '#94A3B8' }}>
            Vào ca, tạm dừng nghỉ, kết thúc ca
          </div>
        </AppCard>

        <AppCard
          padding="16px"
          interactive
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('/reports')}
        >
          <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
            <FileTextIcon size={24} />
          </div>
          <div
            style={{ fontWeight: 600, color: '#F8FAFC', marginBottom: '4px' }}
          >
            Báo cáo (UI08)
          </div>
          <div style={{ fontSize: '13px', color: '#94A3B8' }}>
            Xem danh sách báo cáo hàng ngày
          </div>
        </AppCard>

        {role === 'owner' && (
          <AppCard
            padding="16px"
            interactive
            style={{ cursor: 'pointer' }}
            onClick={() => onNavigate('/payroll')}
          >
            <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
              <BanknoteIcon size={24} />
            </div>
            <div
              style={{ fontWeight: 600, color: '#F8FAFC', marginBottom: '4px' }}
            >
              Bảng lương (UI14)
            </div>
            <div style={{ fontSize: '13px', color: '#94A3B8' }}>
              Xem bảng lương kỳ hiện tại
            </div>
          </AppCard>
        )}

        <AppCard
          padding="16px"
          interactive
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('/settings')}
        >
          <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
            <SettingsIcon size={24} />
          </div>
          <div
            style={{ fontWeight: 600, color: '#F8FAFC', marginBottom: '4px' }}
          >
            Cài đặt (UI20)
          </div>
          <div style={{ fontSize: '13px', color: '#94A3B8' }}>
            Tùy chọn hiển thị & tài khoản
          </div>
        </AppCard>
      </div>
    </div>
  );
};
