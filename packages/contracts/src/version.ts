/**
 * Canonical Application Version Source
 * Management Lite Single Source of Truth
 */
export const SYSTEM_NAME = 'Management Lite';
export const SYSTEM_VERSION = '0.2.3';
export const SYSTEM_COMMIT = 'a415f6e';
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
    version: '0.2.3',
    commit: 'latest',
    released_at: '2026-10-30T19:22:00.000Z',
    summary:
      'Hoàn tất Phase 7: Xử lý triệt để lỗi "Chủ sở hữu không được phép tự duyệt ca làm việc của chính mình" trên màn hình Duyệt công nhân viên (/attendance) & bổ sung nút Đóng ca giúp nhân viên khi quên bấm Kết thúc ca.',
    added: [
      'Nút "Đóng ca & Xác nhận giúp NV" ngay trên thẻ ca đang mở (/attendance) kèm API POST /api/v1/attendance/shifts/:id/owner-close để Chủ sở hữu đóng các ca nhân viên quên bấm Ra ca.',
      'Nhãn "Ca Chủ sở hữu (Tự ghi nhận)" rõ ràng cho các ca của chính Owner và tự động duyệt khi Owner kết thúc ca.',
    ],
    improved: [
      'Bộ lọc Chờ xử lý & Chờ duyệt chỉ đếm các ca nhân viên thực sự cần duyệt; ca đang mở hiển thị cảnh báo "Quá hạn chưa đóng ca" khi vượt 12 tiếng.',
    ],
    fixed: [
      'Khắc phục lỗi bấm Duyệt ca trên ca của chính Chủ sở hữu làm bật hộp báo lỗi đỏ toàn màn hình "Chủ sở hữu không được phép tự duyệt ca làm việc của chính mình".',
    ],
  },
  {
    version: '0.2.2',
    commit: 'a415f6e',
    released_at: '2026-10-30T19:07:00.000Z',
    summary:
      'Hoàn tất Phase 6: Chuẩn hóa cửa sổ Bổ sung thông tin nhân viên & Hồ sơ cá nhân — chỉ bắt buộc Số điện thoại (*), các mục CCCD/Địa chỉ/Ngày sinh/Ngân hàng đều ghi rõ Không bắt buộc; đổi bộ chọn Ngày sinh sang chuẩn Ngày / Tháng / Năm tiếng Việt và thêm ô Tìm kiếm nhanh 35 Ngân hàng Việt Nam.',
    added: [
      'Bộ chọn Ngày sinh 3 cột chuẩn tiếng Việt (Ngày / Tháng / Năm) thay cho lịch MM/DD/YYYY tiếng Anh của trình duyệt.',
      'Ô Tìm kiếm tên ngân hàng thông minh (VnBankAutocompleteInput) hỗ trợ gõ tìm nhanh 35 ngân hàng Việt Nam (MB Bank, Vietcombank, Techcombank, VietinBank, BIDV, ACB, Agribank...).',
    ],
    improved: [
      'Ghi chú rõ ràng "(Bắt buộc)" tại ô Số điện thoại liên hệ (*) và "(Không bắt buộc)" tại tất cả các mục Ngày sinh, Giới tính, Số CCCD/CMND, Địa chỉ nơi ở hiện tại và Ngân hàng nhận lương.',
    ],
    fixed: [],
  },
  {
    version: '0.2.1',
    commit: 'e0c0536',
    released_at: '2026-10-30T18:51:00.000Z',
    summary:
      'Hoàn tất Phase 5: Hiển thị chi tiết Thưởng (+), Phụ cấp (+), Khấu trừ (-) và Tài khoản ngân hàng nhận lương trực tiếp trên cả Bảng lương Owner (/payroll) và Phiếu lương cá nhân (/my-pay); làm giàu mô tả thành phẩm Video/Audio Drive khi đồng bộ công việc từ TikTok AI Factory V4.',
    added: [
      'Hiển thị dòng chi tiết Thưởng (+), Phụ cấp (+), Khấu trừ (-) màu sắc trực quan ngay trên thẻ Thu nhập đã duyệt (Tier 1) của cả Owner (/payroll) và Nhân viên (/my-pay).',
      'Hiển thị thông tin Tài khoản ngân hàng nhận lương (Ngân hàng, Số TK, Chủ TK hoặc cảnh báo chưa cập nhật) ngay trên đầu Phiếu lương cá nhân (/my-pay).',
      'Tự động gắn nhãn thành phẩm 🎬 Video MP4 Drive & 🎙️ Audio WAV Drive từ TikTok AI Factory V4 vào mô tả công việc đồng bộ trên /work.',
    ],
    improved: [
      'Hiển thị chính xác dấu trừ (-) màu đỏ đối với các khoản điều chỉnh thuộc nhóm [KHẤU TRỪ] / [TẠM ỨNG] trong danh sách lịch sử điều chỉnh lương.',
    ],
    fixed: [
      'Đảm bảo nhân viên có khoản Khấu trừ nhưng không có Nghỉ phép vẫn hiển thị đầy đủ dòng Khấu trừ trên thẻ tổng hợp lương.',
    ],
  },
  {
    version: '0.2.0',
    commit: 'c444ffe',
    released_at: '2026-10-30T18:35:00.000Z',
    summary:
      'Hoàn tất Phase 4 (100% Lộ trình nâng cấp): Bổ sung Bảng xác nhận ánh xạ nhân sự cố định giữa Management Lite (NV001..NV00n) và TikTok AI Factory V4 (hoaiphuong.click) trên Dashboard; tối ưu hóa đóng gói Frontend (manualChunks) giảm kích thước mỗi gói JS xuống dưới 400 kB.',
    added: [
      'Bảng xác nhận ánh xạ nhân sự cố định (NV001, NV002... ↔ Email tài khoản V4 ↔ Trạng thái liên kết) ngay trong thẻ Kết nối dữ liệu TikTok AI Factory trên Dashboard (/dashboard).',
      'Trường employee_mappings trong API GET /api/v1/bridge/tiktok-v4 trả về danh sách đối chiếu mã nhân viên cố định và trạng thái email liên thông V4.',
    ],
    improved: [
      'Chia nhỏ gói JavaScript (Code-splitting / manualChunks trong vite.config.ts) thành 5 phân vùng độc lập (vendor-react, screen-payroll-finance, screen-attendance-schedule, screen-storage-work-reports, screen-employees-admin), xóa bỏ hoàn toàn cảnh báo chunk > 500 kB và tăng tốc tải trang trên 4G/Mobile.',
    ],
    fixed: [],
  },
  {
    version: '0.1.6',
    commit: 'f41806b',
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
