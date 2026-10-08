export type UserRole = 'owner' | 'staff';

export interface RouteMeta {
  id: string;
  path: string;
  title: string;
  ownerOnly?: boolean;
  staffOnly?: boolean;
  implemented: boolean;
  category:
    | 'core'
    | 'attendance'
    | 'reports'
    | 'employees'
    | 'payroll'
    | 'accounts'
    | 'audit'
    | 'system';
}

export const ROUTE_REGISTRY: Record<string, RouteMeta> = {
  '/login': {
    id: 'UI01',
    path: '/login',
    title: 'Đăng nhập',
    implemented: true,
    category: 'core',
  },
  '/activate': {
    id: 'UI02',
    path: '/activate',
    title: 'Kích hoạt tài khoản',
    implemented: false,
    category: 'core',
  },
  '/': {
    id: 'UI03',
    path: '/',
    title: 'Tổng quan Dashboard',
    implemented: true,
    category: 'core',
  },
  '/clock': {
    id: 'UI04',
    path: '/clock',
    title: 'Chấm công ca làm',
    implemented: true,
    category: 'attendance',
  },
  '/attendance': {
    id: 'UI05',
    path: '/attendance',
    title: 'Lịch sử ca làm',
    implemented: false,
    category: 'attendance',
  },
  '/attendance/corrections': {
    id: 'UI06',
    path: '/attendance/corrections',
    title: 'Đơn giải trình chấm công (C01)',
    implemented: false,
    category: 'attendance',
  },
  '/attendance/review': {
    id: 'UI07',
    path: '/attendance/review',
    title: 'Duyệt công nhân viên',
    ownerOnly: true,
    implemented: false,
    category: 'attendance',
  },
  '/reports': {
    id: 'UI08',
    path: '/reports',
    title: 'Báo cáo công việc',
    implemented: true,
    category: 'reports',
  },
  '/reports/new': {
    id: 'UI09',
    path: '/reports/new',
    title: 'Tạo báo cáo mới',
    implemented: false,
    category: 'reports',
  },
  '/reports/:id': {
    id: 'UI10',
    path: '/reports/:id',
    title: 'Chi tiết & Revision báo cáo (C02)',
    implemented: false,
    category: 'reports',
  },
  '/employees': {
    id: 'UI11',
    path: '/employees',
    title: 'Danh sách nhân sự',
    ownerOnly: true,
    implemented: false,
    category: 'employees',
  },
  '/employees/new': {
    id: 'UI12',
    path: '/employees/new',
    title: 'Thêm & Mời nhân sự',
    ownerOnly: true,
    implemented: false,
    category: 'employees',
  },
  '/employees/:id': {
    id: 'UI13',
    path: '/employees/:id',
    title: 'Chi tiết nhân sự',
    ownerOnly: true,
    implemented: false,
    category: 'employees',
  },
  '/payroll': {
    id: 'UI14',
    path: '/payroll',
    title: 'Bảng lương tổng quan',
    ownerOnly: true,
    implemented: false,
    category: 'payroll',
  },
  '/payroll/:id': {
    id: 'UI15',
    path: '/payroll/:id',
    title: 'Chi tiết kỳ lương (C04)',
    ownerOnly: true,
    implemented: false,
    category: 'payroll',
  },
  '/my-pay': {
    id: 'UI16',
    path: '/my-pay',
    title: 'Lương cá nhân của tôi',
    staffOnly: true,
    implemented: false,
    category: 'payroll',
  },
  '/accounts': {
    id: 'UI17',
    path: '/accounts',
    title: 'Tài khoản quản lý (ACC)',
    ownerOnly: true,
    implemented: false,
    category: 'accounts',
  },
  '/accounts/:id': {
    id: 'UI18',
    path: '/accounts/:id',
    title: 'Chi tiết tài khoản & Secret (C05)',
    ownerOnly: true,
    implemented: false,
    category: 'accounts',
  },
  '/audit': {
    id: 'UI19',
    path: '/audit',
    title: 'Nhật ký kiểm toán hệ thống',
    ownerOnly: true,
    implemented: false,
    category: 'audit',
  },
  '/settings': {
    id: 'UI20',
    path: '/settings',
    title: 'Cài đặt hệ thống',
    implemented: true,
    category: 'system',
  },
};
