/**
 * Canonical Application Version Source
 * Management Lite Single Source of Truth
 */
export const SYSTEM_NAME = 'Management Lite';
export const SYSTEM_VERSION = '0.1.3';
export const SYSTEM_COMMIT = 'ab7500c';
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
    version: '0.1.3',
    commit: 'latest',
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
      'Hợp nhất toàn diện Storage V2 Google Drive, Phân quyền RBAC 3 vai trò (Owner/Admin/Staff), 4 tính năng mở rộng (Export Excel/CSV, Audit Export, GPS Geofencing, MFA/TOTP), Xác thực Email Brevo và Tự động phát hành GitHub ➔ Web Live.',
    added: [
      'Storage V2 Google Drive (migration 0025): kết nối Google Drive OAuth, cấp/thu hồi quyền thư mục, tải lên video phân đoạn và phê duyệt tệp lưu trữ.',
      'Phân quyền RBAC 3 vai trò (Owner / Admin / Staff) và 4 tính năng mở rộng: Xuất báo cáo Excel/CSV, Xuất nhật ký kiểm toán, Chấm công GPS Geofencing và Bảo mật 2 lớp MFA/TOTP.',
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
  {
    version: '0.0.9',
    commit: '3743e99',
    released_at: '2026-10-14T22:18:17.000Z',
    summary:
      'Phát hành phân hệ Quản lý Tài chính (Sổ thu chi, Danh mục, Kế hoạch ngân sách, Đính kèm chứng từ) và quy trình đóng gói bản phát hành chuẩn SHA-256.',
    added: [
      'Phân hệ Tài chính (Finance): quản lý bút toán thu/chi, đính kèm ảnh hóa đơn/chứng từ và đối soát kế hoạch ngân sách.',
      'Công cụ đóng gói bản phát hành có xác thực chữ ký số Ed25519 và kiểm tra toàn vẹn tệp tin SHA-256.',
    ],
    improved: [
      'Tăng cường bảo mật phiên làm việc (CSRF, Rate Limiting, khóa tài khoản tạm thời khi nhập sai mật khẩu nhiều lần).',
    ],
    fixed: [
      'Chuẩn hóa thông tin phiên bản hiển thị trên thanh điều hướng và màn hình Đăng nhập.',
    ],
  },
  {
    version: '0.0.8',
    commit: 'cdb7046',
    released_at: '2026-10-14T07:39:08.876Z',
    summary:
      'Hoàn thiện bảo mật vận hành và chuẩn hóa dữ liệu các phân hệ Nhân sự, Chấm công, Lịch làm việc, Bảng lương, Công việc, Vấn đề, Tài khoản và Lưu trữ.',
    added: [
      'Cơ chế kiểm soát truy cập theo vai trò (Chủ sở hữu / Nhân viên) và nhật ký kiểm toán bảo mật.',
      'Tùy chọn giao diện Sáng/Tối, cấu hình múi giờ và tiền tệ trong mục Cài đặt cá nhân.',
    ],
    improved: [
      'Tối ưu hiệu năng truy vấn danh sách nhân sự, bảng chấm công và tổng hợp bảng lương theo kỳ.',
    ],
    fixed: [
      'Đồng bộ múi giờ chuẩn Việt Nam (Asia/Ho_Chi_Minh) cho toàn bộ dữ liệu chấm công và báo cáo.',
    ],
  },
  {
    version: '0.0.7',
    commit: 'db91003',
    released_at: '2026-10-13T22:22:45.678Z',
    summary:
      'Triển khai đồng bộ các phân hệ quản lý nội bộ: Công việc, Vấn đề phát sinh, Kho tài khoản dùng chung và Lưu trữ đám mây.',
    added: [
      'Phân hệ Quản lý Công việc, theo dõi Vấn đề phát sinh, Tài khoản dùng chung (mã hóa AES-256-GCM) và theo dõi Lưu trữ.',
    ],
    improved: [
      'Áp dụng cô lập dữ liệu không gian làm việc (Workspace Isolation — C06) trên toàn bộ API.',
    ],
    fixed: [
      'Sửa lỗi hiển thị trạng thái phiên làm việc khi chuyển đổi giữa các màn hình chức năng.',
    ],
  },
  {
    version: '0.0.6',
    commit: '1a54557',
    released_at: '2026-10-13T20:54:04.658Z',
    summary:
      'Cập nhật quy trình Chấm công vào/ra ca, phân ca Lịch làm việc và tự động tính Bảng lương nhân sự.',
    added: [
      'Chức năng chấm công trực tuyến, quản lý ca làm việc và chốt bảng lương định kỳ.',
    ],
    improved: [
      'Giao diện tra cứu lịch sử chấm công và báo cáo tổng hợp giờ công.',
    ],
    fixed: [
      'Khắc phục lỗi biên dịch và đồng bộ dịch vụ API trên máy chủ Windows.',
    ],
  },
  {
    version: '0.0.5',
    commit: '9a51c58',
    released_at: '2026-10-13T20:40:36.602Z',
    summary:
      'Khởi tạo hệ thống Management Lite trên môi trường Production với phân hệ Hồ sơ Nhân sự và Xác thực bảo mật.',
    added: [
      'Hệ thống đăng nhập bảo mật Argon2id, quản lý hồ sơ nhân sự và cấu hình máy chủ Production.',
    ],
    improved: [
      'Thiết lập kết nối an toàn qua Cloudflare Tunnel và dịch vụ chạy nền tự động.',
    ],
    fixed: [
      'Hoàn thiện cấu hình khởi động dịch vụ API và cơ sở dữ liệu PostgreSQL.',
    ],
  },
];
