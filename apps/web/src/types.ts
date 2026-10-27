export type UserRole = 'owner' | 'admin' | 'staff';

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
    | 'work'
    | 'accounts'
    | 'storage'
    | 'audit'
    | 'system'
    | 'issues'
    | 'finance';
}

export const ROUTE_REGISTRY: Record<string, RouteMeta> = {
  '/finance': {
    id: 'FIN-UI-1',
    path: '/finance',
    title: 'Thu chi cá nhân',
    ownerOnly: true,
    implemented: true,
    category: 'finance',
  },
  '/finance/new': {
    id: 'FIN-UI-2',
    path: '/finance/new',
    title: 'Thêm thu chi',
    ownerOnly: true,
    implemented: true,
    category: 'finance',
  },
  '/finance/history': {
    id: 'FIN-UI-3',
    path: '/finance/history',
    title: 'Lịch sử thu chi',
    ownerOnly: true,
    implemented: true,
    category: 'finance',
  },
  '/finance/categories': {
    id: 'FIN-UI-4',
    path: '/finance/categories',
    title: 'Danh mục thu chi',
    ownerOnly: true,
    implemented: true,
    category: 'finance',
  },
  '/finance/plan': {
    id: 'FIN-UI-6',
    path: '/finance/plan',
    title: 'Kế hoạch thu chi cố định',
    ownerOnly: true,
    implemented: true,
    category: 'finance',
  },
  '/finance/entries/:id': {
    id: 'FIN-UI-5',
    path: '/finance/entries/:id',
    title: 'Chi tiết thu chi',
    ownerOnly: true,
    implemented: true,
    category: 'finance',
  },

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
  '/verify-email': {
    id: 'UI02B',
    path: '/verify-email',
    title: 'Xác minh Email',
    implemented: true,
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
  '/schedule': {
    id: 'UI-SCH-01',
    path: '/schedule',
    title: 'Lịch làm việc',
    implemented: true,
    category: 'attendance',
  },
  '/attendance': {
    id: 'UI05',
    path: '/attendance',
    title: 'Lịch sử ca làm',
    implemented: true,
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
    implemented: true,
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
    implemented: true,
    category: 'payroll',
  },
  '/payroll/stats': {
    id: 'UI15B',
    path: '/payroll/stats',
    title: 'Thống kê lương & Excel chấm công',
    ownerOnly: true,
    implemented: true,
    category: 'payroll',
  },
  '/payroll/:id': {
    id: 'UI15',
    path: '/payroll/:id',
    title: 'Chi tiết kỳ lương (C04)',
    ownerOnly: true,
    implemented: true,
    category: 'payroll',
  },
  '/my-pay': {
    id: 'UI16',
    path: '/my-pay',
    title: 'Lương cá nhân của tôi',
    staffOnly: true,
    implemented: true,
    category: 'payroll',
  },
  '/work': {
    id: 'UI-WORK-01',
    path: '/work',
    title: 'Quản lý công việc',
    implemented: true,
    category: 'work',
  },
  '/work/new': {
    id: 'UI-WORK-02',
    path: '/work/new',
    title: 'Giao việc mới',
    ownerOnly: true,
    implemented: true,
    category: 'work',
  },
  '/work/:id': {
    id: 'UI-WORK-03',
    path: '/work/:id',
    title: 'Chi tiết công việc',
    implemented: true,
    category: 'work',
  },
  '/accounts': {
    id: 'UI17',
    path: '/accounts',
    title: 'Tài khoản quản lý (ACC)',
    ownerOnly: true,
    implemented: true,
    category: 'accounts',
  },
  '/accounts/:id': {
    id: 'UI18',
    path: '/accounts/:id',
    title: 'Chi tiết tài khoản & Secret (C05)',
    ownerOnly: true,
    implemented: true,
    category: 'accounts',
  },
  '/storage': {
    id: 'UI-STORAGE-01',
    path: '/storage',
    title: 'Quản lý tệp & Drive (STORAGE)',
    implemented: true,
    category: 'storage',
  },
  '/storage/:id': {
    id: 'UI-STORAGE-02',
    path: '/storage/:id',
    title: 'Chi tiết nhóm thư mục & Thùng rác',
    implemented: true,
    category: 'storage',
  },
  '/audit': {
    id: 'UI19',
    path: '/audit',
    title: 'Nhật ký kiểm toán hệ thống',
    ownerOnly: true,
    implemented: true,
    category: 'audit',
  },
  '/settings': {
    id: 'UI20',
    path: '/settings',
    title: 'Cài đặt hệ thống',
    implemented: true,
    category: 'system',
  },
  '/issues': {
    id: 'UI-ISSUES-01',
    path: '/issues',
    title: 'Sổ tay Vấn đề & Lỗi (Issues)',
    ownerOnly: true,
    implemented: true,
    category: 'issues',
  },
  '/issues/:id': {
    id: 'UI-ISSUES-02',
    path: '/issues/:id',
    title: 'Chi tiết vấn đề (Issues)',
    ownerOnly: true,
    implemented: true,
    category: 'issues',
  },
  '/groups/:groupId': {
    id: 'UI-GROUP-HUB',
    path: '/groups/:groupId',
    title: 'Tổng quan nhóm chức năng',
    implemented: true,
    category: 'core',
  },
  '/forgot-password': {
    id: 'AUTH-FORGOT-PW',
    path: '/forgot-password',
    title: 'Khôi phục mật khẩu',
    implemented: true,
    category: 'core',
  },
  '/reset-password': {
    id: 'AUTH-RESET-PW',
    path: '/reset-password',
    title: 'Đặt lại mật khẩu',
    implemented: true,
    category: 'core',
  },
};
