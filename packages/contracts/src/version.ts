/**
 * Canonical Application Version Source
 * Management Lite Single Source of Truth
 */
export const SYSTEM_NAME = 'Management Lite';
export const SYSTEM_VERSION = '0.1.6';
export const SYSTEM_COMMIT = 'c4896f0';
export const SYSTEM_ENV = 'staging';

export interface SystemInfo {
  name: string;
  version: string;
  commit: string;
  environment: string;
}

export const getSystemInfo = (): SystemInfo => ({
  name: SYSTEM_NAME,
  version: SYSTEM_VERSION,
  commit: SYSTEM_COMMIT,
  environment: SYSTEM_ENV,
});

export interface ReleaseNoteItem {
  version: string;
  commit: string;
  released_at: string;
  summary: string;
  added: string[];
  improved: string[];
  fixed: string[];
}

export interface ReleaseHistoryEntry extends ReleaseNoteItem {
  is_current: boolean;
}

/**
 * Danh mục ghi chú phát hành theo từng phiên bản (Tiếng Việt ngắn gọn, dễ hiểu).
 * Bản 'latest' tự động gắn với commit thực tế của bản dựng mới nhất khi đóng gói và triển khai.
 */
export const RELEASE_NOTES_CATALOG: ReleaseNoteItem[] = [
  {
    version: '0.1.6',
    commit: 'latest',
    released_at: '2026-10-30T18:29:00.000Z',
    summary:
      'Hoàn tất Phase 3: Hiển thị SĐT, Chức danh, Ngân hàng & nút Xuất CSV danh sách nhân sự (/employees); bổ sung thẻ nhắc nộp Báo cáo ngày ngay sau khi Ra ca (/clock) và Trung tâm Việc cần xử lý trên Dashboard (/dashboard).',
    added: [
      'Nút "📥 Xuất CSV danh sách" trên trang Quản lý nhân sự (/employees) hỗ trợ xuất toàn bộ hồ sơ (Mã NV, Họ tên, Chức danh, SĐT, Email, Trạng thái, Ngân hàng, Số TK, Chủ TK) chuẩn UTF-8 BOM mở trực tiếp bằng Excel.',
      'Thẻ nhắc nộp Báo cáo công việc hôm nay hiển thị ngay sau khi nhân viên bấm Kết thúc ca (/clock) với nút chuyển thẳng tới trang Tạo báo cáo (/reports/new).',
      'Trung tâm Việc cần xử lý hôm nay (Action Center) trên trang Tổng quan (/dashboard) cho cả Owner (Duyệt ca, Báo cáo ngày, Hồ sơ SĐT/Ngân hàng, Bảng lương VietQR) và Staff (Ca làm, Nộp báo cáo, Công việc được giao).',
    ],
    improved: [
      'Hiển thị trực tiếp huy hiệu Chức danh, Số điện thoại (hoặc cảnh báo Chưa có SĐT) và Tài khoản ngân hàng ngay trên từng thẻ nhân viên ở danh sách /employees.',
      'Mở rộng ô tìm kiếm nhân sự hỗ trợ tìm nhanh theo Số điện thoại, Chức danh và Tên ngân hàng.',
    ],
    fixed: [],
  },
  {
    version: '0.1.5',
    commit: 'c4896f0',
    released_at: '2026-10-30T18:18:00.000Z',
    summary:
      'Hoàn tất Phase 2: Mở khóa tính Thưởng (bonus), Phụ cấp (allowance), Khấu trừ (deduction) trong Bảng lương & Import Excel, tích hợp hiển thị Tài khoản Ngân hàng & Mã QR chuyển khoản VietQR tự động trong cửa sổ Chi trả lương, và tự động ghi nhận Phiếu chi lương sang Sổ thu chi (/finance).',
    added: [
      'Bộ chọn phân loại điều chỉnh lương nhanh trên Bảng lương (/payroll): Nghỉ có lương (+), Thưởng KPI/Chuyên cần (+), Phụ cấp ca/Ăn trưa (+), và Khấu trừ / Tạm ứng (-).',
      'Khung Thông tin Ngân hàng nhận lương & Mã QR chuyển khoản VietQR tự động (điền sẵn số tiền còn phải chi và nội dung LUONG <KY> <MA_NV> <HO_TEN>) ngay trong cửa sổ Ghi nhận chi trả lương.',
      'Tự động đồng bộ Phiếu chi lương sang Sổ thu chi (/finance, danh mục "Chi trả lương nhân sự") ngay khi xác nhận chi trả lương.',
    ],
    improved: [
      'Tự động nhập cột THƯỞNG từ file Excel chấm công Google Sheet (.xlsx) vào mục điều chỉnh thưởng của kỳ lương tương ứng.',
      'Bổ sung nút Sao chép nhanh Số tài khoản và lối tắt chuyển sang cập nhật TK ngân hàng nếu nhân sự chưa có thông tin ngân hàng.',
    ],
    fixed: [
      'Đảm bảo tương thích ngược 100% với hợp đồng kiểm toán bất biến (PAY-01) và cơ chế chống chi trả trùng lặp (Idempotency).',
    ],
  },
  {
    version: '0.1.4',
    commit: '96d3d1e',
    released_at: '2026-10-30T17:58:00.000Z',
    summary:
      'Hoàn tất Phase 1: Bổ sung Hồ sơ Nhân sự mở rộng, Thông tin Ngân hàng nhận lương & Nhắc cập nhật SĐT tự động (migration 0030), Thống kê & Import/Export Excel lương (migration 0027), Nhật ký hệ thống (migration 0028) và kích hoạt Google Drive Live OAuth + Mã hóa Tài khoản dùng chung + Quét hóa đơn AI trên Server.',
    added: [
      'Hồ sơ Nhân sự mở rộng & Thông tin Ngân hàng (migration 0030): Số điện thoại, Ngày sinh, Giới tính, CCCD, Địa chỉ, Chức danh, Liên hệ khẩn cấp và Ngân hàng nhận lương (Ngân hàng, Số TK, Chủ TK).',
      'Cửa sổ tự động nhắc nhân viên cập nhật Số điện thoại và Ngân hàng ngay khi đăng nhập nếu hồ sơ chưa có SĐT.',
      'Thống kê Bảng lương & Import/Export file Excel chấm công Google Sheet (.xlsx) trực tiếp lên hệ thống (migration 0027).',
      'Kích hoạt toàn diện cấu hình Server thực tế: Google Drive Live OAuth (Storage V2), khóa mã hóa AES-256-GCM cho Tài khoản dùng chung (ACCOUNT_SECRET_KEY) và thư mục lưu/quét hóa đơn AI (FIN_RECEIPT_DIR).',
    ],
    improved: [
      'Thiết kế lại mẫu Email mã xác thực OTP / Đặt lại mật khẩu với khung chọn nhanh 1-click rõ ràng và ẩn khối kết nối TikTok AI Factory đối với tài khoản Nhân viên.',
      'Chuẩn hóa quản trị dự án theo mô hình Phase -> Task -> Version và Bản đồ Module (MODULE_FILE_MAP) giúp tối ưu tốc độ xử lý.',
    ],
    fixed: [
      'Khắc phục lỗi đăng nhập trên trình duyệt di động/HTTP LAN và đồng bộ đầy đủ 30/30 migrations trên PostgreSQL 18.',
    ],
  },
  {
    version: '0.1.3',
    commit: 'ab7500c',
    released_at: '2026-10-20T15:10:00.000Z',
    summary:
      'Kết nối dữ liệu toàn diện hai chiều giữa Hệ thống Quản Lý Vận Hành (ql.hoaiphuong.click) và TikTok AI Factory V4 (hoaiphuong.click): Đồng bộ Nhân sự/Tài khoản, Sản lượng Kịch bản/Prompt/Video sang Báo cáo & Công việc, và Liên kết Kênh TikTok & Kho lưu trữ Google Drive.',
    added: [
      'Cổng kết nối liên hệ thống BridgeService (/api/v1/bridge/public-summary, /api/v1/bridge/tiktok-v4, /api/v1/bridge/tiktok-v4/sync) liên thông trực tiếp với hoaiphuong.click (/api/bridge/summary & /api/bridge/sync-members).',
      'Bảng điều khiển "Kết nối dữ liệu TikTok AI Factory (hoaiphuong.click)" ngay trên màn hình Tổng quan (Dashboard) với nút 1-chạm "Đồng bộ toàn diện ngay".',
      'Tự động quy đổi sản lượng Kịch bản AI, Prompt VEO và Thành phẩm Video MP4/Audio WAV từ hoaiphuong.click sang Báo cáo hàng ngày (daily_reports) và Công việc (work_items) trên ql.hoaiphuong.click.',
    ],
    improved: [
      'Tự động cấp quyền thành viên Workspace và phê duyệt tài khoản nhân sự đang hoạt động từ ql.hoaiphuong.click sang hoaiphuong.click.',
      'Liên kết trực tiếp thông tin Google Workspace & Kho lưu trữ Google Drive giữa hai hệ thống.',
    ],
    fixed: [
      'Bổ sung cơ chế bộ nhớ đệm liên hệ thống (local bridge cache) đảm bảo hiển thị ổn định ngay cả khi một trong hai dịch vụ đang khởi động lại.',
    ],
  },
  {
    version: '0.1.2',
    commit: '294bf79',
    released_at: '2026-10-20T14:00:00.000Z',
    summary:
      'Hợp nhất toàn diện Storage V2 Google Drive, Phân quyền RBAC 3 vai trò (Owner/Admin/Staff), 4 tính năng mở rộng (Export Excel/CSV, Audit Export, MFA/TOTP), Xác thực Email Brevo và Tự động phát hành GitHub ➔ Web Live.',
    added: [
      'Storage V2 Google Drive (migration 0025): kết nối Google Drive OAuth, cấp/thu hồi quyền thư mục, tải lên video phân đoạn và phê duyệt tệp lưu trữ.',
      'Phân quyền RBAC 3 vai trò (Owner / Admin / Staff) và 4 tính năng mở rộng: Xuất báo cáo Excel/CSV, Xuất nhật ký kiểm toán, Bảo mật 2 lớp MFA/TOTP.',
      'Xác thực Email qua Brevo (/verify-email), Lịch sử & Phê duyệt chấm công nâng cao và Biểu mẫu Kho Tài Khoản mở rộng (migration 0024).',
    ],
    improved: [
      'Chuẩn hóa bố cục Responsive Mobile P0 (320px–Desktop) trên toàn bộ 14 màn hình quản trị.',
      'Tự động hóa luồng đẩy GitHub và cập nhật đồng thời Backend API + Frontend Web + Migration trực tiếp lên ql.hoaiphuong.click.',
    ],
    fixed: [
      'Đồng bộ tức thì mã phiên bản (release-version.json & running-components-sha.json) giữa Backend API và Frontend Web sau mỗi lần phát hành.',
    ],
  },
  {
    version: '0.1.1',
    commit: 'c771cf9',
    released_at: '2026-10-16T00:15:00.000Z',
    summary:
      'Gia cố bảo mật cổng phát hành P0 (SCOPED_WINDOW tối đa 10 lần/7 ngày, mã hóa DPAPI cho GitHub PAT, khóa cứng NTFS ACL OWNER RIGHTS:RX và bảo toàn toàn bộ dịch vụ/backup).',
    added: [
      'Cơ chế Owner phê duyệt một lần theo phạm vi (SCOPED_WINDOW tối đa 10 lần triển khai trong 7 ngày, mặc định khóa tự động chạy migration cơ sở dữ liệu).',
      'Xác thực quyền tối thiểu của GitHub Fine-Grained PAT (push, đọc Actions, tải Artifacts) và mã hóa bảo vệ bằng Windows DPAPI.',
    ],
    improved: [
      'Khóa cứng phân quyền NTFS ACL (OWNER RIGHTS:RX và chặn xóa/đổi tên thư mục cha) đồng thời bảo toàn nguyên vẹn quyền ghi nhật ký, sao lưu và khôi phục của các dịch vụ hệ thống.',
    ],
    fixed: [
      'Ngăn chặn triệt để việc sử dụng CI receipt tự tạo, giả lập GitHub API cục bộ hoặc truyền token qua tham số dòng lệnh.',
    ],
  },
  {
    version: '0.1.0',
    commit: 'fbb6940',
    released_at: '2026-10-15T14:35:00.000Z',
    summary:
      'Bổ sung ghi nhớ đăng nhập an toàn (AUTH-REMEMBER-01), trang Tổng quan thời gian thực, nâng cấp giao diện Máy tính/Điện thoại và mục Phiên bản & Lịch sử cập nhật dành cho Admin.',
    added: [
      'Tùy chọn "Ghi nhớ đăng nhập" trên màn hình Đăng nhập (duy trì phiên làm việc 30 ngày hoặc tự động hết hạn sau 24 giờ khi bỏ chọn).',
      'Mục "Phiên bản và Lịch sử cập nhật" trong Cài đặt hệ thống: hiển thị trực tiếp phiên bản đang chạy và lịch sử cập nhật chi tiết chỉ dành cho Admin.',
      'Trang Tổng quan (Dashboard) hiển thị số liệu thực tế từ máy chủ và lối tắt truy cập nhanh các phân hệ.',
    ],
    improved: [
      'Chuẩn hóa giao diện bảng dữ liệu, bộ lọc, phân trang và bố cục thích ứng (Responsive) trên cả máy tính và điện thoại.',
      'Cơ chế phát hành bán tự động kiểm tra tương thích cơ sở dữ liệu trước khi chuyển đổi bản dựng và tự động khôi phục an toàn khi có sự cố.',
    ],
    fixed: [
      'Khắc phục lỗi tải danh sách nhân sự nhiều trang tại màn hình Lịch làm việc và Công việc.',
      'Tăng cường kiểm soát phân quyền truy cập trực tiếp đường dẫn phân hệ Vấn đề (/issues) đối với tài khoản nhân viên.',
    ],
  },
];
