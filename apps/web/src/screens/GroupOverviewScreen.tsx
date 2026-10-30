import React from 'react';
import {
  PageHeader,
  StatusBadge,
  NavIcon,
  NAV_GROUPS,
  NAV_ITEMS,
} from '../../../../packages/ui/src/components/index.js';
import { ROUTE_REGISTRY } from '../types.js';
import type { UserRole } from '../types.js';
import type { NavItem } from '../../../../packages/ui/src/components/Navigation.js';

export interface GroupOverviewScreenProps {
  groupId: string;
  role: UserRole;
  isOwnerVerified?: boolean | undefined;
  onNavigate: (path: string) => void;
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  overview:
    'Theo dõi tổng quan hoạt động và các chỉ số vận hành quan trọng của hệ thống.',
  attendance:
    'Quản lý lịch trình làm việc, ghi nhận chấm công và theo dõi tiến độ ca trực.',
  work: 'Bàn giao nhiệm vụ công việc, báo cáo định kỳ và quản lý tài liệu lưu trữ.',
  'hr-payroll':
    'Quản lý hồ sơ nhân sự, phân quyền người dùng và tra cứu bảng lương định kỳ.',
  admin:
    'Cấu hình hệ thống, theo dõi nhật ký kiểm toán và quản lý xử lý sự cố.',
};

const ITEM_DESCRIPTIONS: Record<string, string> = {
  dashboard: 'Xem tổng hợp các thông tin và hoạt động gần đây.',
  clock: 'Ghi nhận giờ vào, giờ ra và trạng thái chấm công của bạn.',
  schedule: 'Tra cứu lịch làm việc và phân ca trực được giao.',
  reports: 'Xem và tạo báo cáo tiến độ công việc định kỳ.',
  work: 'Giao việc, cập nhật trạng thái và bàn giao kết quả.',
  storage: 'Lưu trữ tệp tin, tài liệu và liên kết Google Drive.',
  attendance: 'Xem lịch sử điểm danh và ca làm việc chi tiết.',
  'attendance-review': 'Kiểm duyệt và phê duyệt dữ liệu chấm công của nhân sự.',
  employees:
    'Quản lý danh sách nhân sự, trạng thái tài khoản và thông tin liên hệ.',
  payroll: 'Quản lý tổng hợp bảng lương và phê duyệt chi trả.',
  'my-pay': 'Tra cứu chi tiết phiếu lương và thu nhập cá nhân.',
  finance: 'Theo dõi sổ thu chi riêng của bạn.',
  accounts: 'Quản lý danh mục tài khoản dịch vụ và thông tin xác thực.',
  audit: 'Theo dõi nhật ký hoạt động và sự kiện bảo mật trong hệ thống.',
  'system-logs':
    'Tra cứu nhật ký vận hành kỹ thuật, trạng thái tác vụ nền và kết nối dịch vụ.',
  issues: 'Theo dõi, phân loại và xử lý các sự cố kỹ thuật phát sinh.',
  settings: 'Cấu hình thông tin hệ thống và tùy chọn cá nhân.',
};

// Dispatched routes with active screens in App.tsx
const DISPATCHED_PATHS = new Set([
  '/',
  '/clock',
  '/schedule',
  '/attendance',
  '/attendance/review',
  '/reports',
  '/employees',
  '/payroll',
  '/my-pay',
  '/work',
  '/accounts',
  '/finance',
  '/storage',
  '/audit',
  '/system-logs',
  '/issues',
  '/settings',
]);

export const GroupOverviewScreen: React.FC<GroupOverviewScreenProps> = ({
  groupId,
  role,
  isOwnerVerified,
  onNavigate,
}) => {
  const group = NAV_GROUPS.find((g) => g.id === groupId);

  if (!group) {
    return (
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '16px' }}>
        <PageHeader
          title="Không tìm thấy nhóm chức năng"
          subtitle="Nhóm chức năng yêu cầu không tồn tại hoặc đã được chuyển dời."
        />
        <div
          style={{
            backgroundColor: '#151F30',
            border: '1px solid #334155',
            borderRadius: '12px',
            padding: '32px 24px',
            textAlign: 'center',
            marginTop: '16px',
          }}
        >
          <p
            style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '20px' }}
          >
            Vui lòng chọn một nhóm chức năng hợp lệ từ thanh điều hướng.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/')}
            style={{
              padding: '10px 20px',
              borderRadius: '8px',
              backgroundColor: '#1E293B',
              color: '#F8FAFC',
              border: '1px solid #334155',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Quay lại Tổng quan
          </button>
        </div>
      </div>
    );
  }

  const isItemVisible = (item: NavItem): boolean => {
    if (
      (item.id === 'issues' || item.id === 'finance') &&
      (isOwnerVerified !== true || role !== 'owner')
    )
      return false;
    if (role === 'staff' && item.ownerOnly) return false;
    if (role === 'owner' && (item.staffOnly || item.id === 'my-pay'))
      return false;
    return true;
  };

  const itemMap = new Map<string, NavItem>(NAV_ITEMS.map((i) => [i.id, i]));
  const visibleItems = group.itemIds
    .map((id) => itemMap.get(id))
    .filter(
      (item): item is NavItem => item !== undefined && isItemVisible(item),
    );

  const isItemAvailable = (item: NavItem): boolean => {
    // If route is dispatched in router, it is available (e.g. /employees)
    if (DISPATCHED_PATHS.has(item.path)) {
      return true;
    }
    const routeMeta = ROUTE_REGISTRY[item.path];
    return Boolean(routeMeta?.implemented);
  };

  const groupDescription =
    GROUP_DESCRIPTIONS[group.id] ||
    'Các tính năng và công cụ thuộc nhóm quản lý này.';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        maxWidth: '1000px',
        width: '100%',
      }}
    >
      <PageHeader title={group.title} subtitle={groupDescription} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
          gap: '14px',
        }}
      >
        {visibleItems.map((item) => {
          const isAvailable = isItemAvailable(item);
          const description =
            ITEM_DESCRIPTIONS[item.id] ||
            'Tính năng hỗ trợ công việc và quản trị hệ thống.';

          if (!isAvailable) {
            return (
              <div
                key={item.id}
                aria-disabled="true"
                style={{
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  padding: '16px 18px',
                  borderRadius: '10px',
                  backgroundColor: '#151F30',
                  border: '1px solid #334155',
                  opacity: 0.65,
                  cursor: 'not-allowed',
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(51, 65, 85, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#64748B',
                    flexShrink: 0,
                  }}
                >
                  <NavIcon id={item.id} size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '4px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '15px',
                        fontWeight: 600,
                        color: '#94A3B8',
                      }}
                    >
                      {item.label}
                    </span>
                    <StatusBadge status="warning" label="Chưa triển khai" />
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '12px',
                      color: '#64748B',
                      lineHeight: 1.4,
                    }}
                  >
                    {description}
                  </p>
                </div>
              </div>
            );
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.path)}
              style={{
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '16px 18px',
                borderRadius: '10px',
                backgroundColor: '#151F30',
                border: '1px solid #334155',
                color: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                transition:
                  'border-color 0.15s ease, background-color 0.15s ease, transform 0.1s ease',
                width: '100%',
                outline: 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(20, 184, 166, 0.4)';
                e.currentTarget.style.backgroundColor =
                  'rgba(20, 184, 166, 0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#334155';
                e.currentTarget.style.backgroundColor = '#151F30';
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#14B8A6';
                e.currentTarget.style.boxShadow =
                  '0 0 0 2px rgba(20, 184, 166, 0.25)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#334155';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(20, 184, 166, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#14B8A6',
                  flexShrink: 0,
                }}
              >
                <NavIcon id={item.id} size={20} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    color: '#F8FAFC',
                    marginBottom: '4px',
                    lineHeight: 1.2,
                  }}
                >
                  {item.label}
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: '12px',
                    color: '#94A3B8',
                    lineHeight: 1.4,
                  }}
                >
                  {description}
                </p>
              </div>

              <div
                style={{
                  color: '#64748B',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
