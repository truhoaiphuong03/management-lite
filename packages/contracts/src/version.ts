/**
 * Canonical Application Version Source
 * Management Lite Single Source of Truth
 */
export const SYSTEM_NAME = 'Management Lite';
export const SYSTEM_VERSION = '0.9.16';
export const SYSTEM_COMMIT = '13e9847';
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
    version: '0.9.16',
    commit: 'latest',
    released_at: '2026-11-09',
    summary:
      'Kiểm toán & nâng cấp toàn diện trang Bấm giờ (/clock, /attendance) và đặt lại trạng thái chấm công để bắt đầu làm việc mới từ hôm nay (giữ nguyên 100% 61 ca bảng công Google Sheet của NV001).',
    added: [
      'Nút "🔄 Đặt lại để bắt đầu từ hôm nay" (POST /api/v1/attendance/reset-today) và Migration 0040 tự động xóa các ca bấm giờ thử nghiệm / ca treo trên web để bắt đầu làm việc mới từ hôm nay.',
      'Đồng hồ đếm giờ làm việc trực tiếp từng giây (HH:MM:SS) và huy hiệu tổng hợp ca hôm nay ngay trên thẻ Bấm giờ (/clock).',
    ],
    improved: [
      'Cho phép bấm "Kết thúc ca" trực tiếp khi đang ở trạng thái tạm nghỉ (tự động đóng lượt nghỉ trước khi kết thúc ca) và bổ sung nút xử lý đơn giải trình trực tiếp trong chế độ xem "Theo từng nhân viên".',
    ],
    fixed: [
      'Chuẩn hóa múi giờ Việt Nam (Asia/Ho_Chi_Minh, +07:00) cho bộ chọn ngày/giờ giải trình chấm công, nâng giới hạn tải lịch sử lên 500 ca và khắc phục độ tương phản màu sắc ở chế độ Sáng (Light Mode).',
    ],
  },
  {
    version: '0.9.15',
    commit: '13e9847',
    released_at: '2026-11-09',
    summary:
      'Đổi bộ chọn tháng trên /payroll và /finance/plan sang menu thả xuống (<select>) kèm dải nút chọn nhanh T6..T11 1-chạm để bấm vào tháng là nhảy ra danh sách tháng ngay lập tức.',
    added: [
      'Dải nút chọn nhanh kỳ lương T6 · T7 · T8 · T9 · T10 · T11 ngay trên thanh điều khiển /payroll (payroll-quick-months).',
    ],
    improved: [
      'Thay thế ô <input type="month"> (bị bôi đen chữ trên Chrome macOS khi bấm vào chữ tháng) bằng menu thả xuống <select> (payroll-month-select) hiển thị đầy đủ Tháng 01 → Tháng 12 theo từng năm trên /payroll và /finance/plan.',
    ],
    fixed: [
      'Khắc phục lỗi bấm vào ô tháng trên /payroll chỉ bôi xanh chữ "tháng 10" mà không nhảy ra danh sách các tháng cần chọn.',
    ],
  },
  {
    version: '0.9.14',
    commit: '500af9b',
    released_at: '2026-11-09',
    summary:
      'Đồng bộ lại các kỳ lương đã chốt & đã chi trả (tháng 10/2026 và các tháng 2026) trên /payroll để khớp 100% với bản Excel Google Sheet của NV001 (9 ngày công · 21h 25p · 535.417 đ).',
    added: [
      'Migration 0039_reconcile_finalized_payroll_snapshots_nv001 tự động tính lại và cập nhật trực tiếp bảng snapshot kỳ lương đã chốt (payroll_employee_items, payroll_daily_breakdowns) và phiếu chi trả (payroll_disbursements) của NV001 cho toàn bộ năm 2026.',
    ],
    improved: [
      'Khi bấm "Đồng bộ Google Sheet" trên /payroll hoặc /payroll/stats, hệ thống tự động cập nhật cả các kỳ lương đã chốt (finalized) thay vì bỏ qua các kỳ đã có bản ghi chi trả.',
    ],
    fixed: [
      'Khắc phục lỗi trang /payroll tháng 10/2026 vẫn hiển thị số liệu chốt sớm 5 ngày đầu (11h 40p · 291.667 đ) thay vì đủ 9 ngày công theo Google Sheet (21h 25p · 535.417 đ).',
    ],
  },
  {
    version: '0.9.13',
    commit: '74b78e6',
    released_at: '2026-11-09',
    summary:
      'Khắc phục lỗi Google OAuth Error 400: redirect_uri_mismatch trên /storage, tự động dự phòng Redirect URI và hỗ trợ dán URL callback trực tiếp',
    added: [
      'Khung hiển thị Authorized Redirect URI kèm nút Sao chép URI 1-chạm và liên kết mở nhanh Google Cloud Console trong cửa sổ Kết nối Google Drive (/storage).',
      'Hỗ trợ dán nguyên đường dẫn URL callback OAuth (http://... hoặc https://...) vào ô Mã ủy quyền để tự động tách code, state và redirect_uri.',
    ],
    improved: [
      'Tự động kiểm tra và chuyển dự phòng sang Redirect URI đã đăng ký khi tạo URL ủy quyền Google OAuth 2.0 và khi đổi mã authorization_code lấy refresh_token.',
    ],
    fixed: [
      'Sửa lỗi Error 400: redirect_uri_mismatch khi kết nối Google Drive (truhoaiphuong03@gmail.com) trên /storage.',
    ],
  },
  {
    version: '0.9.12',
    commit: 'ab60935',
    released_at: '2026-11-09',
    summary:
      'Tự động đồng bộ & đối chiếu bảng lương trực tiếp từ Google Sheet (T6–T11), sửa bảng lương tháng 10 của NV001 (535.417 đ) và loại bỏ hoàn toàn lương NV002',
    added: [
      'Tính năng Tự động đồng bộ & Đối chiếu Chấm công Hệ thống ↔ Google Sheet trực tiếp trên /payroll/stats và nút 1-chạm trên /payroll (API POST /api/v1/payroll-tools/timesheet/sync-google-sheet).',
      'Bảng đối chiếu chi tiết theo từng tháng và từng ngày (Khớp 100%, Lệch giờ, Thiếu trên HT, Chỉ có trên Web) phục vụ giai đoạn nhân viên chấm công trên Web song song với đối chiếu Excel.',
    ],
    improved: [
      'Chuẩn hóa toàn diện lương NV001 (Nguyễn Huỳnh Thế Vinh, VCB 1031739417) từ T6 đến T11 khớp 100% với Google Sheet (61 ngày công, 188,53 giờ, tổng lương 4.427.502 đ).',
    ],
    fixed: [
      'Sửa bảng lương tháng 10 (2026-10) của NV001 đúng đủ 9 ngày công (05, 13, 14, 15, 21, 27, 28, 29, 30/10 — 21,42 giờ — đơn giá 25.000 đ/h — 535.417 đ) và loại bỏ hoàn toàn lương/ca trùng của NV002 (Migration 0038).',
    ],
  },
  {
    version: '0.9.11',
    commit: '90a6c5d',
    released_at: '2026-11-09',
    summary:
      'Thiết kế lại trang Danh mục thu chi (/finance/categories) theo Phương án A: Bảng danh sách 5 cột thẳng hàng, nền trắng sáng, xóa mảng xám thừa và chống nút Báo lỗi đè phân trang',
    added: [
      'Bảng danh sách 5 cột chuẩn mực (STT, Tên danh mục, Phân loại, Trạng thái, Thao tác) trên /finance/categories kèm kiểm thử hồi quy giao diện.',
    ],
    improved: [
      'Căn thẳng trục ngang/dọc giữa bộ chuyển Khoản chi / Nguồn thu và form Thêm danh mục mới; gộp thanh tiêu đề và ô tìm kiếm trên 1 hàng gọn đẹp.',
    ],
    fixed: [
      'Xóa triệt để mảng xám trống 2/3 màn hình ở hàng cuối khi số lượng danh mục lẻ cột, khắc phục cắt chữ (...) tên danh mục dài và chống nút Báo lỗi nổi đè lên thanh phân trang.',
    ],
  },
  {
    version: '0.9.10',
    commit: '1448a5d',
    released_at: '2026-11-08',
    summary:
      'Hợp nhất v0.9.10: Chuẩn hóa /accounts (UI-099), quy đổi mức cần kiếm Ngày → Tuần → Tháng → Năm từ khoản chi trên /finance/plan (FIN-PLAN-099) và xử lý trọn bộ 10 vấn đề mở BUG-0031..BUG-0040',
    added: [
      'Chỉ số need_per_year_vnd (Mỗi ngày → Mỗi tuần → Mỗi tháng → Mỗi năm) tính từ tổng khoản chi dự kiến trên /finance/plan; phân trang số trên /issues & /system-logs; thanh nhắc việc nhân viên trên AppShell và nút Copy tin gửi Zalo trên /work/new.',
    ],
    improved: [
      'Loại bỏ icon emoji trước nhãn nền tảng trên /accounts; hiện/ẩn mật khẩu UI20 trên /settings; chip khổ A0-A4, Cán màng, Công nghệ in trên /print-quotes/new; tách createReceiptApi vào màn hình Thu chi giữ gói JS khởi đầu ~125.9 KB gzip.',
    ],
    fixed: [
      'Khắc phục nền bảng /accounts xám đục ở Chế độ Sáng, rớt dòng cột/nút thao tác và tương phản nút P2 / chi tiết lỗi trên /issues.',
    ],
  },
  {
    version: '0.9.9',
    commit: '8734c7a',
    released_at: '2026-11-07',
    summary:
      'Tự động tắt mọi thông báo và toast trên toàn hệ thống sau một khoảng thời gian (4 giây với thông báo thành công/thông tin, 5 giây với thông báo lỗi)',
    added: [
      'Hook dùng chung useAutoDismiss trong @hp/ui tự động xóa trạng thái thông báo sau thời gian cấu hình và tự làm mới bộ đếm khi có thông báo mới.',
    ],
    improved: [
      'Đồng bộ tự động tắt thông báo trên toàn bộ 20 màn hình (Nhân sự, Chấm công, Lịch làm việc, Giao việc, Báo cáo, Lương, Thu chi, Kho lưu trữ, Báo giá in ấn, Tài khoản dùng chung, Nhật ký hệ thống, Sổ tay lỗi, Cài đặt).',
    ],
    fixed: [
      'Khắc phục lỗi AppToast bị đặt lại bộ đếm mỗi lần màn hình cha render lại khiến thông báo treo vĩnh viễn không tự biến mất.',
    ],
  },
  {
    version: '0.9.8',
    commit: '21848db',
    released_at: '2026-11-07',
    summary:
      'Khắc phục lỗi "An unexpected internal error occurred" khi lưu Phân quyền Quản lý phụ (Admin vận hành) hoặc cập nhật hồ sơ nhân sự trên môi trường Production',
    added: [
      'Bổ sung kiểm thử hồi quy tự động khóa cứng không cho phép chạy câu lệnh DDL runtime (ALTER/CREATE/DROP TABLE) trong toàn bộ mã nguồn API.',
    ],
    improved: [
      'Loại bỏ hoàn toàn câu lệnh DDL runtime (ALTER TABLE) trong EmployeeService và AccountsService để tương thích tuyệt đối với tài khoản DB phân quyền tối thiểu (hp_app_runtime).',
    ],
    fixed: [
      'Khắc phục lỗi PostgreSQL 42501 (must be owner of table employees) làm hủy giao dịch khi bấm Lưu thay đổi phân quyền Quản lý phụ / quyền phụ trên màn hình Hồ sơ nhân viên (/employees/:id).',
    ],
  },
  {
    version: '0.9.7',
    commit: '5669d1b',
    released_at: '2026-11-07',
    summary:
      'Tăng tốc toàn diện thời gian tải trang ql.hoaiphuong.click (Brotli/Gzip, immutable cache, khử thác nước 11 API trên Báo giá in ấn, cache cầu nối V4) và tốc độ sửa code / CI',
    added: [
      'Kịch bản chuyển đổi máy chủ web Production an toàn có tự động hoàn tác (Switch-ProductionWebServerToServeWeb.ps1) sang serve-web.cjs chuẩn (nén Brotli/Gzip, pre-warm RAM, keep-alive proxy và immutable cache 1 năm cho /assets/*).',
      'Cấu hình kiểm tra kiểu tăng dần tsconfig.typecheck.json (tsc --incremental) rút ngắn thời gian typecheck cục bộ và hàm preloadRouteScreen tải trước màn hình song song với phiên đăng nhập.',
    ],
    improved: [
      'Tách 1.128 dòng CSS khỏi PrintQuoteScreen.tsx sang printquote-styles.ts, gom luồng nạp dữ liệu /print-quotes từ 2 tầng 11 API xuống 1 tầng song song theo đúng tab đang mở kèm bộ nhớ đệm 15 giây.',
      'Song song hóa cổng bảo mật Windows P0 và luồng kiểm thử Ubuntu trên GitHub Actions CI (foundation.yml) sau cổng publish-release-artifact; bổ sung cache 60 giây cho cầu nối V4 để /dashboard phản hồi tức thì.',
    ],
    fixed: [
      'Khắc phục hiện tượng trình duyệt và Cloudflare phải tải lại toàn bộ gói JavaScript không nén do script máy chủ web cũ trả Cache-Control: no-store và khắc phục độ trễ chờ tối đa 3,5 giây tới hoaiphuong.click khi mở Tổng quan.',
    ],
  },
  {
    version: '0.9.6',
    commit: '69355d4',
    released_at: '2026-11-06',
    summary:
      'Đổi tên Workspace chuẩn sang "THIẾT KẾ IN ẤN TOÀN GIA PHÁT" đồng bộ trên Tổng quan (/dashboard), Cơ sở dữ liệu và tiêu đề Báo giá PDF A4 gửi khách (/print-quotes)',
    added: [
      'Migration 0037_rename_workspace_toan_gia_phat tự động cập nhật tên Workspace đang hoạt động từ "Hoài Phương Media" sang "THIẾT KẾ IN ẤN TOÀN GIA PHÁT" kèm kịch bản rollback đối ứng.',
    ],
    improved: [
      'Đồng bộ tên thương hiệu mặc định "THIẾT KẾ IN ẤN TOÀN GIA PHÁT" trên Tổng quan hoạt động (/dashboard), màn hình Báo giá in ấn và khung xem trước / xuất file PDF A4 gửi khách hàng.',
    ],
    fixed: [
      'Khắc phục endpoint tải trực tiếp file PDF báo giá đã lưu (GET /api/v1/print-quotes/quotes/:id/pdf-file) chưa truyền tên Workspace thực tế từ phiên làm việc vào bộ kết xuất A4.',
    ],
  },
  {
    version: '0.9.5',
    commit: '4b6c4d6',
    released_at: '2026-11-06',
    summary:
      'Chuyển danh bạ Khách hàng đặt in và Nhà in đối tác trong Báo giá in ấn (/print-quotes/catalog/customers & /vendors) sang dạng bảng danh sách chuẩn trên Máy tính và Điện thoại',
    added: [
      'Bảng danh sách 5 cột thẳng hàng cho Khách hàng đặt in (Khách hàng, Công ty / Đơn vị, Số điện thoại, Địa chỉ giao hàng, Thao tác) và Nhà in đối tác (Nhà in đối tác, Số điện thoại, Ngân hàng, Số tài khoản, Bảng giá).',
    ],
    improved: [
      'Mở rộng ô tìm kiếm Nhà in đối tác theo cả số tài khoản ngân hàng, hiển thị bộ đếm kết quả lọc và tự chuyển sang thẻ dòng gọn (.rt-cards) không viền kép, tự ẩn trường trống trên màn hình điện thoại.',
    ],
    fixed: [
      'Khắc phục giao diện Khách hàng đặt in và Nhà in đối tác bị tách dạng lưới thẻ 2 cột và căn giữa chữ gây tốn diện tích, khó dò danh sách dài.',
    ],
  },
  {
    version: '0.9.4',
    commit: '3d2d5c0',
    released_at: '2026-11-06',
    summary:
      'Nâng cấp ô Khách hàng nhận báo giá (/print-quotes/new) thành ô tìm kiếm thông minh theo tên (không dấu) hoặc số điện thoại (đầu +84/0, số cuối)',
    added: [
      'Ô chọn Khách hàng nhận báo giá hỗ trợ gõ tìm tức thì theo tên khách hàng (không phân biệt dấu tiếng Việt), công ty hoặc số điện thoại (hỗ trợ +84, khoảng trắng, dấu chấm và 4 số cuối).',
      'Nút Thêm khách mới 1 chạm ngay trong danh sách gợi ý khi chưa có khách khớp tên/SĐT đang nhập (tự điền sẵn SĐT hoặc Tên vào biểu mẫu).',
    ],
    improved: [
      'Hiển thị rõ số điện thoại bên cạnh tên & mã khách trong danh sách gợi ý cùng nút xóa chọn nhanh về Khách lẻ và điều hướng bàn phím (Mũi tên / Enter / Escape).',
    ],
    fixed: [
      'Khắc phục bất tiện thẻ <select> tĩnh không thể gõ tìm theo SĐT trên danh sách khách hàng dài và tách gói printquote-helpers giữ mọi chunk JS dưới trần 300 KB.',
    ],
  },
  {
    version: '0.9.3',
    commit: '4356aab',
    released_at: '2026-11-06',
    summary:
      'Căn thẳng hàng 4 ô nhập sản phẩm trên màn hình Tạo báo giá in ấn (/print-quotes/new), nới rộng ô Số lượng và khử viền kép đỏ-xanh khi chọn từ bảng giá đã lưu',
    added: [
      'Kiểm thử trình duyệt tự động kiểm chứng độ thẳng hàng ngang của 4 ô Tên sản phẩm, Quy cách, Số lượng, Đơn vị ở 1366px/1440px và trạng thái viền khi chọn giá cơ bản đã lưu.',
    ],
    improved: [
      'Đồng bộ chiều cao hàng nhãn (.pq-field-label-row) và tỷ lệ cột lưới sản phẩm (.pq-product-info-grid) để 4 ô Tên sản phẩm, Quy cách / Chất liệu, Số lượng và Đơn vị luôn thẳng hàng ngang, không rớt 2 dòng nhãn trên màn hình laptop & desktop.',
      'Nới rộng ô Số lượng (tối thiểu 108px) và tách riêng trạng thái chạm/rời ô Số lượng để không báo viền đỏ sớm ngay khi vừa chọn sản phẩm từ Giá cơ bản đã lưu.',
    ],
    fixed: [
      'Khử hiện tượng 2 vòng viền đỏ lồng xanh (outline-offset chồng lên border) khi đặt con trỏ vào các ô nhập trên phân hệ Báo giá in ấn.',
    ],
  },
  {
    version: '0.9.2',
    commit: '497e7fa',
    released_at: '2026-11-05',
    summary:
      'Mặc định giao diện Sáng (màu trắng) khi mở trang & đăng nhập, đồng thời sửa tương phản huy hiệu mã nhân viên (NV002) và các nhãn phụ ở chế độ Sáng',
    added: [
      'Tự động kích hoạt chế độ Giao diện Sáng (màu trắng) làm mặc định ngay khi khởi động và sau mỗi lần đăng nhập thành công.',
    ],
    improved: [
      'Người dùng vẫn có thể chuyển nhanh Sáng / Tối / Hệ thống trên thanh tiêu đề hoặc trong Cài đặt và lưu tùy chọn riêng cho phiên hiện tại.',
      'Bổ sung đầy đủ biến màu --secondary-color, --secondary-hover, --secondary-active và đổ bóng nhẹ chuẩn chế độ Sáng trong tokens.css.',
    ],
    fixed: [
      'Sửa lỗi huy hiệu mã nhân viên (NV001/NV002…) trên màn hình Nhân sự (/employees) bị nền tối chữ tối khó đọc khi dùng giao diện Sáng.',
      'Chuẩn hóa màu chữ var(--info-text) và viền var(--border-color, #334155) cho nhãn Quản lý phụ, Chức danh, nút Chi lương vô hiệu hóa và ô nhập Đăng nhập ở chế độ Sáng.',
    ],
  },
  {
    version: '0.9.1',
    commit: 'aefeaec',
    released_at: '2026-11-05',
    summary:
      'Thống nhất giao diện toàn hệ thống theo chuẩn phân hệ Công việc (/work), đồng bộ tiêu đề, phụ đề và thanh điều hướng phân hệ trên máy tính & điện thoại (Sáng/Tối), và khử triệt để race kiểm thử Chrome',
    added: [
      'Bộ kiểm thử trình duyệt thực tế đối chiếu chuẩn /work (tests/web/ui-unify-work-standard.test.mjs): kiểm chứng font thực tế qua CDP, cấp chữ, thanh điều hướng .app-subnav-bar, phân quyền RBAC, điều hướng bàn phím và chống tràn ngang trên 7 phân hệ.',
    ],
    improved: [
      'Chuẩn hóa tiêu đề trang (22px/700 trên máy tính, 17.5px trên điện thoại), phụ đề và thanh điều hướng phân hệ (.app-subnav-bar & .pq-module-nav) đồng bộ theo /work trên Chấm công, Nhân sự, Tài khoản, Thu chi, Báo giá in ấn, Sổ tay lỗi và Quản trị.',
      'Gỡ bỏ giới hạn chiều rộng lệch nhau (maxWidth 800–1200px) trên các màn hình con để thẳng mép trái – phải với khung chuẩn AppShell 1280px, đồng thời giữ nguyên 100% bố cục PDF A4 tiếng Việt và Sổ Công nợ AR/AP v0.9.0.',
    ],
    fixed: [
      'Khắc phục triệt để lỗi race theo bộ đếm thời gian cố định trong kiểm thử Chrome (scripts/test-ui-fix-47-chrome.mjs & scripts/qa-chrome-harness.mjs) bằng cơ chế chờ theo điều kiện thực tế và làm nóng module entry trước khi mở tab.',
    ],
  },
  {
    version: '0.9.0',
    commit: '5134bff',
    released_at: '2026-11-05',
    summary:
      'Hoàn thiện Sổ Công nợ & Tài chính In ấn độc lập AR/AP (migrations 0034–0036), Danh mục Giá xưởng & Công đoạn gia công đa tầng, Cổng kiểm soát chi phí thực tế 3 tầng và Hàng đợi đối chiếu công nợ lịch sử an toàn',
    added: [
      'Danh mục Bảng giá xưởng cơ bản & Công đoạn gia công nhiều bước (0034), hỗ trợ tính diện tích m² chính xác 6 chữ số thập phân, minh bạch diện tích thực tế vs diện tích tính tiền (D-02) trên PDF/Web và lưu báo giá nháp chờ giá xưởng (PENDING_COST).',
      'Cổng kiểm soát chi phí thực tế 3 tầng trên Đơn hàng in ấn (0035: UNVERIFIED / ENTERED_UNCONFIRMED / CONFIRMED) kèm sổ lịch sử chi phí bất biến (print_order_cost_history).',
      'Sổ Công nợ Phải thu khách hàng (print_ar_*) và Phải trả nhà in (print_ap_*) tách biệt 100% khỏi /finance (0036): đặt việc đa xưởng (print_workshop_jobs), quyết toán biên bản đơn hủy (print_order_cancellation_settlements), công nợ đầu kỳ & nhập đối chiếu từ Google Sheet.',
      'Hàng đợi đối chiếu phiếu thu/hoàn cũ (print_legacy_ar_reconciliations): giữ nguyên dữ liệu lịch sử, tự động phát hiện bất thường (thiếu customer_id, lệch số dư, hoàn vượt thu) và chỉ ghi vào sổ AR chính thức sau khi Chủ sở hữu xác nhận.',
    ],
    improved: [
      'Bắt buộc gắn hồ sơ khách hàng hợp lệ cùng workspace (customer_id) trước khi chuyển báo giá mới thành đơn hàng (hỗ trợ tạo nhanh khách hàng trực tiếp) và chống tính trùng giữa sổ cũ và sổ AR chính thức trong suốt giai đoạn chuyển tiếp.',
      'Tinh gọn giao diện Công nợ & Tài chính in ấn trên máy tính và điện thoại: ưu tiên thao tác chính, giữ thanh tìm kiếm nhanh và phân biệt rõ trạng thái đối chiếu cùng số tiền.',
      'Gia cố hạ tầng CI/CD bảo mật đa lớp cho cơ sở dữ liệu kiểm thử E2E cô lập (ci-web-db.mjs) và kịch bản rollback 0036 fail-closed (ROLLBACK_BLOCKED khi đã phát sinh giao dịch/xác nhận sau nâng cấp).',
    ],
    fixed: [
      'Khắc phục sai lệch hiển thị phép nhân diện tích lẻ trên PDF báo giá gửi khách (giữ chính xác đến 6 chữ số thập phân, tổng tiền khớp tuyệt đối và ẩn 100% giá vốn/lợi nhuận nội bộ).',
      'Khắc phục lỗi dừng bộ ghi nhật ký hệ thống khi đang xả hàng đợi (activeFlush) và khóa chặt quyền chỉ-thêm (append-only) trên toàn bộ các bảng lịch sử giao dịch tài chính in ấn.',
    ],
  },
  {
    version: '0.8.4',
    commit: 'latest',
    released_at: '2026-11-03',
    summary:
      'Tối ưu toàn diện giao diện Báo giá in ấn (/print-quotes) theo phong cách tối giản hiện đại, chuẩn tương phản Sáng/Tối AA và hiển thị cân đối trên Desktop & iPhone',
    added: [
      'Bộ biểu tượng hình học SVG đồng nhất (PrintQuoteIcons) thay thế toàn bộ emoji rời rạc và khung xem trước trang giấy A4 trực quan trên màn hình Chi tiết báo giá.',
    ],
    improved: [
      'Loại bỏ khung viền lồng nhau dư thừa, hợp nhất thanh điều hướng dạng pill, chuẩn hóa bố cục nhập liệu 2 cột thoáng mắt, chữ số thẳng hàng (tabular-nums) và hiển thị trọn 4 mục trên màn hình iPhone.',
    ],
    fixed: [
      'Khắc phục cắt chữ ở các ô chọn chế độ giá vốn/lợi nhuận và loại bỏ tiêu đề trùng lặp phía trên các trang Báo giá in ấn.',
    ],
  },
  {
    version: '0.8.3',
    commit: 'latest',
    released_at: '2026-11-03',
    summary:
      'Sửa dứt điểm lỗi nhập số trên iPhone trong Báo giá in ấn (/print-quotes), tự ẩn thanh dưới/nút Báo lỗi khi mở bàn phím ảo và bảo toàn chế độ giá vốn Trọn lô khi mở lại báo giá đã lưu',
    added: [
      'Bổ sung ô nhập số nháp NumericDraftInput hỗ trợ xóa trắng hoàn toàn, không tự chèn 0/1 khi đang gõ, chuẩn hóa số 0 đứng đầu khi hoàn tất nhập và hỗ trợ dán chuỗi số tiền.',
      'Lưu tường minh chế độ tính giá vốn (vendorCostMode: PER_UNIT / TOTAL_BATCH) trong dữ liệu báo giá và bổ sung thanh xác nhận 1 chạm không suy đoán cho các báo giá cũ chưa lưu rõ kiểu giá vốn khi đổi số lượng.',
    ],
    improved: [
      'Tự động nhận diện bàn phím ảo trên iPhone (visualViewport), cuộn vùng đang nhập vào khung nhìn và ẩn tức thì thanh điều hướng đáy cùng nút Báo lỗi nổi để không che khuất trường nhập liệu.',
    ],
    fixed: [
      'Khắc phục lỗi xóa trắng Số lượng bị ép về 1 (gây nối thành 1500), nhập Giá nhà in/Tiền lời bị dính số 0 đầu (05000, 0500) và lỗi mở lại báo giá Trọn lô (VD: 30.000đ / 100 tờ) bị nhảy sang Theo từng tờ khi đổi số lượng.',
    ],
  },
  {
    version: '0.8.2',
    commit: 'latest',
    released_at: '2026-11-03',
    summary:
      'Sửa lỗi điều hướng ?edit=1 khi bấm nút Phân quyền / Sửa trên danh sách nhân sự (/employees/:id?edit=1)',
    added: [
      'Bổ sung cơ chế tự động mở biểu mẫu chỉnh sửa & phân quyền thông qua thuộc tính initialEdit đồng bộ với tham số truy vấn ?edit=1 và tự động làm sạch URL sau khi lưu hoặc hủy.',
    ],
    improved: [
      'Tách biệt sạch chuỗi truy vấn (?query) và neo (#hash) khỏi đường dẫn định tuyến trong bộ khớp route (router.ts) và trình điều hướng trung tâm (App.tsx).',
    ],
    fixed: [
      'Khắc phục triệt để lỗi "Endpoint GET /api/v1/employees/<id>%3Fedit%3D1 not found" khi mở nhanh chế độ Phân quyền / Sửa từ màn hình Nhân sự (/employees).',
    ],
  },
  {
    version: '0.8.1',
    commit: 'latest',
    released_at: '2026-11-03',
    summary:
      'Thiết kế lại Giao diện Báo giá in ấn (PrintQuote UX/UI v0.8.1) tinh gọn, trực quan trên Desktop & iPhone và chuẩn hóa trình bày đơn giá trên PDF A4 gửi khách',
    added: [
      'Gom điều hướng phân hệ Báo giá in ấn (/print-quotes) thành 4 nhóm chính rõ ràng (Báo giá, Đơn hàng, Danh mục, Báo cáo) kèm dải nhảy nhanh 1 dòng trên màn hình Tạo báo giá.',
      'Thêm nhanh hồ sơ Khách hàng mới ngay trong màn hình Tạo báo giá và tự động thu gọn các dòng sản phẩm đã nhập xong (kèm nút Sửa, Nhân đôi, Xóa dòng).',
      'Bảng tổng kết duy nhất chuyển đổi 1-chạm giữa "Bản gửi khách (Ẩn giá vốn)" và "Bóc tách nội bộ (Giá vốn & Lời)", mặc định thu gọn phần Tùy chọn nâng cao.',
    ],
    improved: [
      'Chuẩn hóa trình bày đơn giá trên PDF A4 gửi khách & Bản gửi khách: hiển thị khớp phép nhân đối với đơn giá thập phân hữu hạn 2 chữ số (VD: 763,16 ₫ × 100 tờ = 76.316 ₫) và trình bày tự nhiên "~đơn giá (Tính trọn gói N đơn vị)" đối với số lượng lẻ chia không hết, loại bỏ hoàn toàn thuật ngữ kỹ thuật "Hiệu chỉnh làm tròn".',
      'Tối ưu hiển thị điện thoại (320px, 390px) và máy tính (1440px): lưới nhóm 2×2 trên mobile không cắt chữ, nút cảm ứng chuẩn 44px và vùng đệm đáy chống nút Báo lỗi đè lên tổng tiền/thanh hành động.',
    ],
    fixed: [
      'Sửa lỗi hiển thị tiếng Việt trong trạng thái đang tải của phân hệ Báo giá in ấn và khử thông tin lặp lại trên tiêu đề thẻ sản phẩm khi đang mở nhập liệu.',
    ],
  },
  {
    version: '0.8.0',
    commit: 'latest',
    released_at: '2026-11-02',
    summary:
      'Phân hệ Báo giá in ấn (MGL-PRINTQUOTE V1 — /print-quotes): Nhà in & Bảng giá, Tạo báo giá tự động phân bổ vận chuyển, Xuất file PDF A4 tiếng Việt ẩn giá vốn, Quản lý Đơn hàng, Đặt cọc/Công nợ & Thống kê lợi nhuận',
    added: [
      'Bổ sung phân hệ "Báo giá in ấn" (/print-quotes, chỉ dành cho Chủ sở hữu) với 6 tab chức năng: Tạo báo giá, Danh sách báo giá, Nhà in & Bảng giá, Khách hàng, Đơn hàng, Lợi nhuận & Công nợ.',
      'Động cơ tính giá in ấn chuẩn xác (giá nhà in theo đơn vị/lô, lợi nhuận VND/% theo đơn vị/lô, cước vận chuyển cộng 1 lần và phân bổ Largest Remainder vào đơn giá báo khách, bảo toàn lịch sử giá đơn cũ khi cập nhật bảng giá).',
      'Xuất và tải trực tiếp file báo giá PDF khổ A4 tiếng Việt (<quote_code>.pdf) chỉ hiển thị đơn giá bán và thành tiền khách hàng, ẩn 100% giá vốn nhà in và lợi nhuận nội bộ.',
      'Quản lý vòng đời Đơn hàng in ấn (chuyển báo giá thành đơn hàng chống trùng lặp 409 CONFLICT, cấp mã nguyên tử BG-YYYYMM-NNN / DH-YYYYMM-NNN, theo dõi ngày đặt in, tiến độ sản xuất & giao hàng, đặt cọc/thanh toán nhiều đợt/hoàn tiền và công nợ thực tế).',
    ],
    improved: [
      'Gia cố bộ kết xuất PDF A4 chạy ổn định dưới tài khoản dịch vụ Windows (NT AUTHORITY\\LocalService / Session 0) và khóa phân quyền Owner-only chặt chẽ tại cả tầng giao diện lẫn API.',
      'Hoàn tất kiểm thử nghiệm thu độc lập trên Windows Staging (PostgreSQL 18 TEST :55433 cô lập, migration tuần tự 0031 ➔ 0032 ➔ 0033 và Playwright trình duyệt Chrome thật Desktop + iPhone).',
    ],
    fixed: [
      'Khắc phục xung đột lịch sử nhánh giữa feature/printquote-module-v1 và main (v0.7.2), đồng bộ đầy đủ các bản vá bảo mật và cổng phát hành Owner-Locked Release Gate.',
    ],
  },
  {
    version: '0.7.2',
    commit: 'latest',
    released_at: '2026-11-02',
    summary:
      'Phân quyền Nhân sự 3 cấp (Nhân viên / Quản lý phụ - Admin / Chủ sở hữu - Owner) kèm 6 nhóm quyền phụ chi tiết (sub_permissions) & nút mở nhanh Phân quyền / Sửa',
    added: [
      'Bổ sung vai trò "Quản lý phụ (Admin vận hành)" và 6 nhóm quyền phụ chi tiết (Duyệt chấm công & lịch ca, Giao việc & duyệt báo cáo, Quản lý hồ sơ nhân sự, Quản lý Tài khoản dùng chung & Drive, Quản lý & chốt Bảng lương, Quản lý Sổ Thu chi) trong chỉnh sửa nhân sự (/employees/:id).',
      'Thêm nút "Phân quyền / Sửa" mở nhanh 1-chạm từ danh sách nhân sự (/employees) vào thẳng chế độ chỉnh sửa phân quyền (/employees/:id?edit=1).',
    ],
    improved: [
      'Tích hợp kiểm tra ủy quyền động (delegated RBAC) tại tầng phiên đăng nhập và cổng bảo vệ API kèm chặn Quản lý phụ tự ý chỉnh sửa/hạ quyền Chủ sở hữu.',
      'Chuẩn hóa toàn bộ 71 tệp kiểm thử tự động trên môi trường PostgreSQL cô lập (:55433) kèm bảo vệ chống chạm cơ sở dữ liệu Production.',
    ],
    fixed: [
      'Khắc phục lỗi thiếu đồng bộ phiên bản kiểm thử và khóa an toàn chống tự động hạ quyền Chủ sở hữu duy nhất.',
    ],
  },
  {
    version: '0.7.1',
    commit: 'latest',
    released_at: '2026-11-01',
    summary:
      'Sắp xếp lại thứ tự ưu tiên & đặt tên ngắn gọn 2 chữ cho Thanh menu đứng (Tổng quan, Công việc, Chấm công, Nhân sự, Tài khoản, Thu chi, Quản trị)',
    added: [
      'Đưa phân hệ "Tài khoản" (/accounts) lên trực tiếp Thanh menu đứng kèm biểu tượng khóa riêng biệt.',
    ],
    improved: [
      'Sắp xếp lại thứ tự 7 mục trên Thanh menu đứng theo đúng luồng vận hành hằng ngày: Tổng quan ➔ Công việc ➔ Chấm công ➔ Nhân sự ➔ Tài khoản ➔ Thu chi ➔ Quản trị.',
      'Chuẩn hóa tên gọi 7 mục trên Thanh menu đứng đồng bộ 2 chữ ngắn gọn, dễ nhìn (bỏ các cụm từ dài dòng như "Ca & Chấm công", "Nhân sự & Lương", "Tài khoản dùng chung", "Thu chi cá nhân").',
      'Khi bấm vào "Quản trị", mở trực tiếp tab "Sổ tay lỗi" (/issues) thay vì trang trung gian.',
    ],
    fixed: [
      'Sửa đường dẫn (breadcrumb) trên màn hình Tài khoản dùng chung (/accounts): không còn hiện sai mục cha "Quản trị" sau khi mục này được đưa lên Thanh menu đứng.',
      'Thanh điều hướng phụ trên điện thoại xuống dòng gọn trong khung thay vì cuộn ngang, thu gọn khoảng cách để không bị tràn trên màn hình nhỏ.',
    ],
  },
  {
    version: '0.7.0',
    commit: 'a11d175',
    released_at: '2026-11-01',
    summary:
      'Tối giản Lịch sử Chấm công theo Tháng của từng nhân viên, Tối ưu Giao diện Điện thoại & Chuẩn hóa Giao việc Nhân sự Media (/work/new)',
    added: [
      'Bổ sung ô chọn Tháng công riêng ngay trên tiêu đề mỗi nhân viên (NV001, NV002, ADM01) trên /attendance (mặc định hiển thị tháng gần nhất có ca, thu gọn còn 5 ca kèm nút "▾ Xem thêm N ca").',
      'Thay các nút mẫu máy/AI kỹ thuật trên màn hình Giao việc mới (/work/new) bằng 4 mẫu công việc thực tế cho đội ngũ Media: "+ Dựng Video", "+ Viết Kịch bản / Nội dung", "+ Đăng bài & Chăm sóc kênh", "+ Thiết kế Ảnh / Thumbnail".',
      'Thêm dải nút chọn nhanh hạn chót 1-chạm ("Hôm nay 18:00", "Trưa mai 12:00", "Chiều mai 18:00", "+3 ngày") và nút "Chọn tất cả NV" / "Bỏ chọn" trên biểu mẫu Giao việc (/work/new).',
    ],
    improved: [
      'Rút gọn 6 tầng thanh công cụ trên /attendance thành 1 thanh điều khiển duy nhất (chuyển chế độ xem + 1 ô chọn Tháng + Xuất CSV + Bảng lương + Bộ lọc nâng cao thu gọn).',
      'Tối ưu giao diện điện thoại trên toàn bộ các trang: ẩn các thanh thông báo phụ rườm rà, thu gọn bộ lọc nâng cao mặc định và mở rộng huy hiệu mã nhân viên (NV001, ADM01) không bị bó chữ.',
    ],
    fixed: [
      'Khắc phục lỗi hiển thị trùng tài khoản quản trị (ADM01 / ADMIN) trong danh sách chọn người nhận việc (/work/new) và loại bỏ chuỗi tiếng Anh "Imported from timesheet" cùng phần giây (:ss) gây cắt chữ trên thẻ ca làm.',
    ],
  },
  {
    version: '0.6.9',
    commit: '3e65928',
    released_at: '2026-11-01',
    summary:
      'Xuất CSV tổng hợp công theo nhân viên, Duyệt nhanh toàn bộ ca chờ theo nhân sự, Đối soát Bảng lương 1-chạm & Dọn sạch Sổ tay lỗi',
    added: [
      'Bổ sung nút "Xuất CSV tổng hợp công" trên /attendance: xuất bảng tổng hợp giờ làm, giờ đã duyệt và chi tiết từng ca theo từng nhân viên chuẩn UTF-8 mở trực tiếp trên Excel.',
      'Thêm nút "✓ Duyệt nhanh N ca" ngay trên từng thẻ nhân sự trong chế độ xem Theo từng nhân viên để Chủ sở hữu duyệt toàn bộ ca hợp lệ của 1 nhân viên chỉ với 1 chạm.',
      'Thêm lối tắt "Đối soát Bảng lương →" và "Bảng lương →" trên từng nhân viên để chuyển nhanh từ bảng chấm công sang đối chiếu kỳ lương.',
    ],
    improved: [
      'Hiển thị rõ số giờ công đã duyệt bên cạnh số ca đã duyệt trên từng nhóm nhân viên (/attendance).',
    ],
    fixed: [
      'Hỗ trợ tham số phân trang ?limit= trên API GET /api/v1/work-items tránh cảnh báo 400 Invalid filter trong Nhật ký hệ thống và hoàn tất xác nhận đóng 30 phiếu kiểm thử tồn đọng trong Sổ tay lỗi (/issues).',
    ],
  },
  {
    version: '0.6.8',
    commit: '018b16a',
    released_at: '2026-11-01',
    summary:
      'Chế độ xem Chấm công Theo từng nhân viên, tổng hợp giờ công & bộ lọc nhanh nhân sự trên /attendance',
    added: [
      'Bổ sung chế độ xem "Theo từng nhân viên" mặc định trên Lịch sử & Duyệt công (/attendance): tự động gom toàn bộ ca làm theo từng nhân sự kèm tổng số ca, tổng giờ làm, tổng giờ đã duyệt và số ca chờ duyệt.',
      'Thêm dải nút chọn nhanh nhân sự 1-chạm ("Xem nhanh theo nhân sự") ngay trên thanh bộ lọc Chấm công để xem riêng từng nhân viên tức thì.',
    ],
    improved: [
      'Cho phép chuyển đổi linh hoạt giữa 2 góc nhìn "Theo từng nhân viên" và "Theo từng ca", kèm nút Thu gọn / Mở rộng danh sách ca của từng nhân sự và duyệt/đóng ca trực tiếp ngay trong bảng nhân viên.',
    ],
    fixed: [
      'Khắc phục lỗi danh sách ca làm hiển thị rời rạc theo thứ tự thời gian khiến Chủ sở hữu khó theo dõi tổng công của từng nhân viên và bổ sung tự động danh sách nhân viên từ dữ liệu ca thực tế vào bộ lọc.',
    ],
  },
  {
    version: '0.6.7',
    commit: '81ee366',
    released_at: '2026-11-01',
    summary:
      'Kiểm toán UX/UI tự động 144 kịch bản (Playwright + axe-core đạt 0 lỗi) & Tinh chỉnh hiển thị Mobile/Desktop',
    added: [
      'Hoàn tất kiểm toán tự động 144 kịch bản (24 màn hình × 3 kích thước Mobile/Tablet/Desktop × 2 giao diện Sáng/Tối) với 0 lỗi tràn ngang, 0 lỗi tương phản màu và 0 lỗi runtime.',
    ],
    improved: [
      'Căn chỉnh thẻ KPI trên Tổng quan (/dashboard) tự động xuống dòng nhãn trạng thái trên màn hình điện thoại hẹp, không còn bị gãy chữ thành 3 dòng dọc.',
      'Hiển thị trọn vẹn 4 tab góc nhìn trên Quản lý Tài khoản (/accounts), ẩn nút Kết nối Google Drive trùng lặp trên Tệp & Drive (/storage), thay emoji bằng icon SVG trên Nhân sự (/employees) và thu gọn mô tả phụ trên thẻ KPI Bảng lương (/payroll) khi xem bằng điện thoại.',
    ],
    fixed: [
      'Đồng bộ đường dẫn import UI trên Công việc (/work), bổ sung guard mảng/đối tượng an toàn trên Thống kê lương (/payroll/stats), Nhật ký hệ thống (/system-logs), Sổ tay lỗi (/issues), Tổng hợp thu chi (/finance) và chuẩn hóa tương phản màu WCAG AA chế độ Sáng trên /storage, /work.',
    ],
  },
  {
    version: '0.6.6',
    commit: '012f7ea',
    released_at: '2026-10-31',
    summary:
      'Làm mới toàn bộ hệ thống biểu tượng SVG tối giản hiện đại (strokeWidth 1.75, mỗi tab điều hướng một icon riêng biệt) và loại bỏ các khối giao diện cầu kỳ, trùng lặp.',
    added: [
      'Bộ biểu tượng SVG hiện đại chuyên biệt cho từng phân hệ (CalendarClockIcon, UserCheckIcon, CheckSquareIcon, CreditCardIcon, ShieldCheckIcon, SlidersIcon).',
    ],
    improved: [
      'Thiết kế tối giản cho Thanh bên (DesktopSidebar), Thanh đỉnh (AppShell Header) và Thanh điều hướng phụ (Sub-Navigation Bar) phẳng, sạch, không viền hộp kép.',
      'Màn hình Tổng quan (/dashboard), Chấm công (/clock) và Công việc (/work): ẩn mặc định lưới 10 thẻ Lối tắt trùng lặp, thu gọn thanh trạng thái V4 1 dòng và gỡ bỏ các emoji rườm rà.',
    ],
    fixed: [
      'Khắc phục triệt để tràn ngang các nút điều hướng phụ (.app-subnav-bar) ở khung nhìn di động 320px.',
    ],
  },
  {
    version: '0.6.5',
    commit: '797a343',
    released_at: '2026-10-31',
    summary:
      'Tối giản hóa toàn diện giao diện Điện thoại & Máy tính: gỡ bỏ khoảng đệm thừa, gom thanh Sub-Navigation gọn gàng, ẩn phụ đề dài trên di động, thu gọn bộ lọc nâng cao (/accounts, /dashboard) và tự động ẩn dòng trống trên thẻ bảng di động.',
    added: [
      'Chế độ thu gọn bộ lọc nâng cao ("▾ Lọc nâng cao") trên /accounts và chi tiết liên thông ("Chi tiết V4") trên /dashboard.',
    ],
    improved: [
      'Giao diện Điện thoại (<=768px): loại bỏ padding kép làm hẹp màn hình, ẩn dòng mô tả dài dưới tiêu đề trang và thu gọn nút Báo lỗi thành biểu tượng tròn.',
      'Bảng dữ liệu trên Điện thoại (rt-cards): tự động ẩn các ô trống (— / Chưa gán) và đưa cột tên chính lên làm tiêu đề thẻ rõ ràng, dễ đọc.',
    ],
    fixed: [
      'Loại bỏ các nút trùng lặp trên màn hình Quản lý Tài khoản (/accounts) và ẩn 4 thẻ KPI khi chưa có dữ liệu tài khoản.',
    ],
  },
  {
    version: '0.6.4',
    commit: '00e8fa0',
    released_at: '2026-10-31',
    summary:
      'Tối ưu hóa điều hướng 1-chạm (bấm phân hệ vào thẳng tab chức năng đầu tiên, bỏ qua màn hình thẻ trung gian) và loại bỏ dòng Breadcrumb trùng lặp phía trên thanh Sub-Navigation ngang.',
    added: [
      'Cơ chế điều hướng trực tiếp 1-chạm từ nhóm phân hệ vào màn hình chức năng đầu tiên tương ứng theo vai trò.',
    ],
    improved: [
      'Thanh bên DesktopSidebar và thanh đáy MobileBottomNav mở thẳng màn hình chức năng đầu tiên của phân hệ chỉ với 1 cú nhấp chuột.',
      'Ẩn dòng Breadcrumb cấp 2 trùng lặp trên các màn hình danh sách chính khi đã có thanh điều hướng ngang (Sub-Navigation Bar), giữ lại Breadcrumb & nút Quay lại trên các trang chi tiết cấp 3.',
    ],
    fixed: [
      'Chuyển hướng tự động các đường dẫn nhóm (/groups/*) về màn hình chức năng đầu tiên tương ứng theo vai trò.',
    ],
  },
  {
    version: '0.6.3',
    commit: '6b031dd',
    released_at: '2026-10-31',
    summary:
      'Kiểm tra toàn diện hệ thống, chuẩn hóa tương phản giao diện Sáng/Tối & khung nhìn 320px trên /accounts, hợp nhất helper dùng chung (/issues, /schedules) và loại bỏ code thừa không sử dụng.',
    added: [
      'Module tiện ích dùng chung issues-helpers.ts cho Sổ tay lỗi (/issues & /issues/:id).',
    ],
    improved: [
      'Chuẩn hóa biến màu tương phản AA (var(--danger-text), var(--warning-text), var(--info-text)) cho các nhãn nền tảng & cụm bảo vệ trên /accounts.',
      'Hỗ trợ đóng nhanh cửa sổ Thêm/Sửa tài khoản bằng phím Escape và loại bỏ các hàm/hằng xuất khẩu dư thừa không sử dụng.',
    ],
    fixed: [
      'Sửa 3 lỗi ESLint prefer-const trong AccountsService và chuẩn hóa lưới responsive minmax(min(100%, 220px), 1fr) chống tràn ngang ở khung nhìn 320px.',
      'Đồng bộ bộ kiểm thử Sổ tay lỗi (issues-b01, issues-screen) tương thích với thao tác Đóng hàng loạt (bulk-confirm).',
    ],
  },
  {
    version: '0.6.2',
    commit: 'latest',
    released_at: '2026-10-31',
    summary:
      'Tinh gọn & làm đẹp giao diện Quản lý Tài khoản (/accounts) theo hướng đơn giản cho người dùng, ẩn tùy chọn nâng cao trong cửa sổ Thêm tài khoản và sửa lỗi truy vấn API/Migration 0031.',
    added: [
      'Nút thu gọn/mở rộng "Tùy chọn nâng cao" (Progressive Disclosure) trong cửa sổ Thêm tài khoản.',
    ],
    improved: [
      'Thiết kế lại đầu trang, thẻ thống kê và thanh công cụ Quản lý Tài khoản gọn gàng trên 1 khung hợp nhất.',
    ],
    fixed: [
      'Sửa lỗi hiển thị khung truy vết tìm kiếm khi ô tìm kiếm đang trống.',
      'Sửa lỗi GRANT bảng không tồn tại trong migration 0031 và tự động dự phòng cột trong AccountsService.',
    ],
  },
  {
    version: '0.6.0',
    commit: 'latest',
    released_at: '2026-10-31T08:45:00.000Z',
    summary:
      'Nâng cấp toàn diện Hệ sinh thái Tài khoản 4 Tầng (SĐT/SIM ➔ Gmail gốc ➔ TikTok / Facebook / YouTube + Google Authenticator + Tài khoản Khôi phục) kèm Tra cứu 2 chiều 360° và Tự sinh mã 6 số 2FA trực tiếp.',
    added: [
      'Hỗ trợ đầy đủ nền tảng Facebook (FB), YouTube (YTB), Google Authenticator, Tài khoản Khôi phục và liên kết phân cấp SĐT ➔ Gmail gốc ➔ Kênh con.',
      'Tra cứu 2 chiều 360° (filterAccounts360): gõ ID TikTok, UID FB/YTB, Gmail hoặc SĐT để tự động truy vết toàn bộ họ hàng tài khoản liên quan.',
      '4 Tab góc nhìn trên /accounts: Tất cả & Tra cứu 360°, Theo Cụm Gmail gốc, Theo Số điện thoại (đếm số Gmail/SĐT + vị trí SIM), Theo GG Authenticator & TK Khôi phục.',
      'Tự sinh mã 6 số 2FA trực tiếp (RFC 6238 TOTP) khi xem secret 2FA, lưu lịch sử mật khẩu cũ (account_secret_history) và nhập nhanh hàng loạt (email|pass|recovery|2fa|sdt).',
    ],
    improved: [
      'Cửa sổ Thêm/Sửa tài khoản tự động kế thừa SĐT, vị trí SIM, GG Authenticator và TK Khôi phục từ Gmail gốc; cho phép tạo nhanh cụm kênh TikTok/FB/YTB 1 chạm.',
    ],
    fixed: [
      'Đảm bảo tương thích ngược 100% với kho bí mật AES-256-GCM (C05 / SEC-02) và bộ kiểm thử tự động ẩn mật khẩu sau 30 giây.',
    ],
  },
  {
    version: '0.5.7',
    commit: '5b1b735',
    released_at: '2026-10-31T07:44:00.000Z',
    summary:
      'Khắc phục nút Báo lỗi bị đứng yên một chỗ: khôi phục chế độ nổi theo màn hình khi cuộn trang và bổ sung tính năng giữ-kéo di chuyển nút Báo lỗi tới bất kỳ vị trí nào trên cả Máy tính và Điện thoại.',
    added: [
      'Cho phép giữ và kéo nút "Báo lỗi" (chuột trên máy tính hoặc ngón tay trên điện thoại) để di chuyển tới vị trí tùy ý trên màn hình, tự động ghi nhớ vị trí trong trình duyệt (mglite_bug_btn_pos).',
    ],
    improved: [
      'Tự động giới hạn vùng kéo trong khung nhìn an toàn (không bị khuất mép màn hình hoặc đè lên thanh điều hướng đáy trên điện thoại) và phân biệt chính xác thao tác kéo với thao tác bấm mở cửa sổ Báo lỗi.',
    ],
    fixed: [
      'Sửa lỗi quy tắc CSS position: static !important làm nút Báo lỗi bị khóa cố định một chỗ ở cuối trang thay vì nổi và di chuyển linh hoạt theo người dùng.',
    ],
  },
  {
    version: '0.5.6',
    commit: '5b1b735',
    released_at: '2026-10-31T07:15:00.000Z',
    summary:
      'Hoàn tất Phase 19 (Vệ sinh dữ liệu, chuẩn hóa Hồ sơ nhân sự & Công cụ Vận hành an toàn): sửa lỗi SQL placeholder khi cập nhật hồ sơ nhân viên trong EmployeeService, kiểm tra chặt Ngày sinh (YYYY-MM-DD / DD/MM/YYYY) và Số tài khoản ngân hàng (chỉ chữ số), đồng thời bổ sung bộ công cụ kiểm toán & diễn tập khôi phục sao lưu (RPO/RTO).',
    added: [
      'Bộ kiểm tra và chuẩn hóa dữ liệu hồ sơ nhân sự (apps/api/src/employees/profile-validator.ts) cho cả AuthService và EmployeeService.',
      'Bộ 4 công cụ vận hành an toàn chế độ Dry-Run (scripts/ops/audit-test-workspaces.mjs, audit-secrets-hygiene.mjs, backup-restore-drill.mjs, verify-profile-data.mjs).',
    ],
    improved: [
      'Chuẩn hóa tự động Ngày sinh từ định dạng Ngày/Tháng/Năm (DD/MM/YYYY) hoặc YYYY-MM-DD sang chuẩn ISO YYYY-MM-DD và chặn các ngày không tồn tại trên lịch.',
      'Chuẩn hóa Số tài khoản ngân hàng (loại bỏ khoảng trắng/dấu gạch ngang thừa và chỉ cho phép từ 6 đến 25 chữ số).',
    ],
    fixed: [
      'Sửa triệt để lỗi thiếu ký hiệu $ trong câu lệnh SQL UPDATE employees của EmployeeService.createEmployee và EmployeeService.updateEmployee khi lưu SĐT, Ngày sinh, CCCD và Ngân hàng.',
    ],
  },
  {
    version: '0.5.5',
    commit: 'f1d2da2',
    released_at: '2026-10-31T07:10:00.000Z',
    summary:
      'Hoàn tất Phase UI-5 (Đổi nhãn menu tiếng Việt thân thiện & đạt 0 lỗi tương phản màu Sáng/Tối) và Phase 18 (Hiệu năng Backend/DB & Sức khỏe Mã nguồn: bảng định tuyến O(1) RouteTable, gộp UNNEST lịch tuần, phân trang con trỏ Chấm công, tách module tiện ích Web và chỉ mục đường nóng).',
    added: [
      'Bộ định tuyến RouteTable tra cứu đường dẫn cố định O(1) kết hợp phân nhánh theo tiền tố (apps/api/src/routes/router.ts) và 4 module định tuyến độc lập (schedules, accounts, storage, issues/audit).',
      'Bộ chỉ mục tối ưu đường nóng (scripts/perf/ensure-hot-indexes.sql) và công cụ đo kế hoạch thực thi truy vấn EXPLAIN ANALYZE (scripts/perf/explain-hot-queries.mjs).',
      'Các module hàm tiện ích giao diện độc lập (payroll-helpers.ts, work-helpers.ts, accounts-helpers.ts, storage-helpers.ts) giúp giảm kích thước các màn hình lớn.',
    ],
    improved: [
      'Đổi nhãn điều hướng và đường dẫn (Breadcrumb) sang tiếng Việt rõ nghĩa: "Tài khoản ACC" → "Tài khoản dùng chung", "Sổ tay Issues" → "Sổ tay lỗi".',
      'Gộp thao tác lưu các ca đăng ký lịch làm việc trong tuần (SchedulesService) thành 1 truy vấn UNNEST duy nhất thay vì lặp 7 lệnh INSERT tuần tự.',
      'Bổ sung phân trang con trỏ (keyset cursor) không dùng OFFSET cho danh sách ca chấm công (/api/v1/attendance/shifts và /api/v1/attendance/me).',
    ],
    fixed: [
      'Xử lý triệt để toàn bộ lỗi tương phản màu (axe color-contrast = 0 trên cả 2 chế độ Sáng và Tối qua 144 lượt kiểm tra 24 màn hình × 3 khung nhìn) cho StatusBadge, AppButton, Breadcrumb và các thẻ nền mờ.',
      'Khắc phục tình trạng tập trung hơn 4.100 dòng mã định tuyến vào một tệp app.ts duy nhất (giảm gần 1.200 dòng trong app.ts) và loại bỏ nút thắt N+1 INSERT khi lưu lịch làm việc tuần.',
    ],
  },
  {
    version: '0.5.4',
    commit: '0f6384e',
    released_at: '2026-10-31T06:50:00.000Z',
    summary:
      'Hoàn tất Phase 16 & Phase 17 (Toàn vẹn phát hành, chuẩn hóa định dạng đa hệ điều hành & hiển thị điện thoại 320px): tự động sinh thông tin bản dựng từ Git, tài liệu hóa quy trình phát hành qua cổng Owner, sửa lỗi tràn ngang trên màn hình 320px và đạt 100% kiểm thử xanh (436/436 test).',
    added: [
      'Công cụ tự động sinh thông tin bản dựng (scripts/gen-build-info.mjs) vào dist/release-version.json và apps/web/dist/release-version.json trực tiếp từ package.json và Git HEAD.',
      'Tài liệu quy trình phát hành chuẩn qua Cổng Khóa Chủ sở hữu (docs/deployment/OWNER-RELEASE-RUNBOOK.md) và đóng gói kèm máy chủ tĩnh (scripts/runtime/serve-web.cjs).',
      'Khôi phục thẻ lối tắt "Vấn đề & Issues" dành cho Chủ sở hữu trên trang Tổng quan (/dashboard).',
    ],
    improved: [
      'Chuẩn hóa ký tự xuống dòng đa hệ điều hành (.gitattributes và endOfLine: auto trong .prettierrc.json), giữ nguyên toàn vẹn băm SHA-256 cho thư mục docs/canonical.',
      'Thanh điều hướng nhanh phân hệ (.app-subnav-bar) tự động xuống dòng gọn gàng trên màn hình điện thoại nhỏ (320px), không còn phần tử tràn mép phải.',
    ],
    fixed: [
      'Khắc phục toàn bộ 11 bài kiểm thử tự động bị đỏ do lệch dòng CRLF/LF, thiếu bản ghi lịch sử 0.0.9 khi kiểm thử khôi phục (Rollback) và tràn ngang ở độ rộng 320px.',
    ],
  },
  {
    version: '0.5.3',
    commit: '4908051',
    released_at: '2026-10-31T06:50:00.000Z',
    summary:
      'Đánh bóng giao diện (Phase UI-5): ô nhập/chọn có tên truy cập cho trình đọc màn hình, dấu chấm lửng chuẩn "…" và chữ không còn nhỏ hơn 12px.',
    added: [
      'Tự động gắn tên truy cập cho các ô lọc ngày và ô chọn chưa có nhãn liên kết (Chấm công, Báo cáo, Tài khoản…), giúp trình đọc màn hình đọc đúng tên từng ô.',
    ],
    improved: [
      'Dấu chấm lửng chuẩn "…" thay cho "..." ở các thông báo đang tải và gợi ý nhập liệu.',
      'Chữ nhỏ hơn 12px trên các màn hình và thành phần dùng chung được nâng lên 12px để dễ đọc trên điện thoại.',
    ],
    fixed: ['Ô chọn tháng ở Bảng lương nay có nhãn truy cập.'],
  },
  {
    version: '0.5.2',
    commit: 'deeaf16',
    released_at: '2026-10-31T06:00:00.000Z',
    summary:
      'Hoàn tất Phase 15 (Tốc độ tải trang): chỉ tải phần cần thiết khi mở ứng dụng — mã JavaScript tải lần đầu giảm từ khoảng 1,08 MB xuống 0,42 MB (đã nén: từ khoảng 260 KB xuống 119 KB), và các lần mở sau gần như không phải tải lại.',
    added: [
      'Mỗi màn hình được tải theo yêu cầu (chỉ khi bạn mở màn hình đó) thay vì tải toàn bộ ngay từ đầu; có khung chờ "Đang tải màn hình…" trong lúc tải.',
      'Công cụ kiểm tra dung lượng gói tải lần đầu (npm run check:bundle) với ngưỡng cảnh báo khi vượt ngân sách.',
    ],
    improved: [
      'Tệp giao diện đã băm tên (assets) được trình duyệt lưu 1 năm; trang chính luôn kiểm tra bản mới. Mở lại ứng dụng không còn tải lại toàn bộ mã.',
      'Tệp văn bản (JS, CSS, HTML) được nén brotli/gzip và lưu sẵn trong bộ nhớ máy chủ, hỗ trợ ETag nên trình duyệt chỉ nhận mã 304 khi không đổi.',
      'Kiểm tra sức khỏe hệ thống (/api/v1/health) không còn chạy lệnh git mỗi lần gọi; thông tin phát hành được nạp một lần khi khởi động.',
    ],
    fixed: [
      'Tệp giao diện bị thiếu (ví dụ bản cũ sau khi cập nhật) giờ trả về lỗi 404 đúng nghĩa thay vì trả trang HTML với mã 200 gây lỗi khó hiểu trên trình duyệt.',
    ],
  },
  {
    version: '0.5.0',
    commit: 'a0122fb',
    released_at: '2026-10-31T05:45:00.000Z',
    summary:
      'Chuẩn hóa giao diện toàn hệ thống (Phase UI-0 → UI-4): giao diện Sáng dùng được trên mọi màn hình, thanh điều hướng đáy điện thoại có tên truy cập, bảng tự chuyển thành thẻ trên điện thoại và có công cụ kiểm tra giao diện tự động.',
    added: [
      'Công cụ kiểm tra giao diện tự động (npm run audit:ui): chụp ảnh 3 cỡ màn hình × 2 giao diện, phát hiện tràn ngang và lỗi truy cập.',
      'Bảng dữ liệu tự hiển thị dạng thẻ trên điện thoại (nhãn cột giữ nguyên), không còn phải cuộn ngang.',
      'Liên kết "Bỏ qua tới nội dung chính" cho người dùng bàn phím.',
    ],
    improved: [
      'Giao diện Sáng: thanh bên, thẻ, nút, ô nhập, biểu mẫu đăng nhập và chữ đều đổi theo chế độ Sáng / Tối / Hệ thống; màu nút và huy hiệu đạt chuẩn tương phản.',
      'Thanh điều hướng đáy điện thoại: nhãn 11px, nút cao 52px, mỗi nút có tên truy cập duy nhất.',
      'Biểu tượng riêng cho Thu chi và Nhật ký hệ thống; trang 404/403 có tiêu đề chuẩn.',
    ],
    fixed: [
      'Sửa các biến màu bị thiếu (font, màu thương hiệu, nền phụ) khiến ô chọn ngày và thanh phân hệ sai màu ở giao diện Sáng.',
      'Bỏ hiệu ứng chuyển động "all" gây giật trên thanh phân hệ và bộ lọc Công việc.',
    ],
  },
  {
    version: '0.3.3',
    commit: '12f78ed',
    released_at: '2026-10-31T12:40:00.000Z',
    summary:
      'Hoàn tất Phase 14 (Bảo mật khẩn từ kiểm toán 31/10): chặn giả mạo địa chỉ IP để vượt giới hạn đăng nhập, thêm giới hạn thử sai theo từng tài khoản, bổ sung header bảo mật cho giao diện và API, dọn phiên đăng nhập cũ và đặt giới hạn thời gian truy vấn cơ sở dữ liệu.',
    added: [
      'Giới hạn số lần đăng nhập sai theo từng tài khoản (20 lần / 15 phút) bên cạnh giới hạn theo địa chỉ IP, chống dò mật khẩu từ nhiều địa chỉ khác nhau.',
      'Header bảo mật cho giao diện web: Content-Security-Policy, chống nhúng khung (clickjacking), HSTS khi chạy qua HTTPS, Referrer-Policy và Permissions-Policy.',
      'Tác vụ nền tự dọn phiên đăng nhập hết hạn, bằng chứng xác thực lại đã dùng và bản ghi idempotency quá hạn.',
    ],
    improved: [
      'Nhận diện địa chỉ IP người dùng an toàn: không còn tin phần tử đầu của X-Forwarded-For (do người dùng tự đặt), ưu tiên CF-Connecting-IP của Cloudflare hoặc phần tử đáng tin cậy ngoài cùng bên phải.',
      'Mọi phản hồi JSON của API có thêm X-Frame-Options, X-Content-Type-Options, Referrer-Policy và Cross-Origin-Resource-Policy.',
      'Máy chủ API có timeout kết nối, bắt lỗi ngoài dự kiến và tự thoát để dịch vụ khởi động lại; truy vấn cơ sở dữ liệu tối đa 30 giây và gắn nhãn application_name.',
      'Máy chủ web được đưa vào kho mã (scripts/runtime/serve-web.cjs) với proxy API có timeout và ghi nhận chuỗi chuyển tiếp IP.',
    ],
    fixed: [
      'Giá trị X-Request-Id do máy khách gửi lên chỉ được dùng khi hợp lệ (tối đa 64 ký tự chữ, số, dấu chấm, gạch dưới, gạch nối), tránh làm bẩn nhật ký.',
      'Tên cookie phiên tùy chỉnh (SESSION_COOKIE_NAME) giờ áp dụng cho mọi đường dẫn API; trước đây 41/50 chỗ bỏ sót nên đổi tên sẽ làm hỏng đăng nhập.',
    ],
  },
  {
    version: '0.3.2',
    commit: 'e65ae75',
    released_at: '2026-10-31T11:36:00.000Z',
    summary:
      'Hoàn tất Phase 13 (Hotfix Cửa sổ Bổ sung Hồ sơ & Lưu thông tin cá nhân): Sửa lỗi lưu thông tin cá nhân (PATCH /api/v1/auth/profile), sửa nút đóng (✕) trên cửa sổ Bổ sung hồ sơ nhân viên, căn thẳng hàng tuyệt đối các trường SĐT / Ngày sinh / Ngân hàng và chuẩn hóa tên Workspace Hoài Phương Media.',
    added: [
      'Ngày sinh, giới tính và thông tin ngân hàng nhập ở cửa sổ Bổ sung hồ sơ được lưu thật vào hồ sơ nhân sự (trước đây bị lỗi SQL nên không lưu).',
    ],
    improved: [
      'Căn chỉnh thẳng hàng 100% các ô nhập liệu trong cửa sổ Bổ sung thông tin hồ sơ nhân viên: đồng bộ chiều cao 40px giữa Số điện thoại và Ngày/Tháng/Năm, mở rộng ô Tìm tên ngân hàng ra toàn chiều ngang để không bị cắt chữ.',
      'Ghi nhớ trạng thái đóng cửa sổ nhắc bổ sung SĐT trong suốt phiên làm việc và cập nhật tên Workspace chuẩn "Hoài Phương Media".',
    ],
    fixed: [
      'Sửa lỗi SQL placeholder ($1, $2...) trong AuthService.updateProfile khiến nút "Lưu thông tin" trong cửa sổ Bổ sung hồ sơ không lưu được SĐT và thông tin ngân hàng.',
      'Sửa lỗi nút đóng góc phải (✕) trên cửa sổ Bổ sung hồ sơ nhân viên không đóng ngay hộp thoại khi bấm.',
    ],
  },
  {
    version: '0.3.1',
    commit: 'bc2f076',
    released_at: '2026-10-30T21:42:00.000Z',
    summary:
      'Hoàn tất Phase 12 (Mobile UI/UX Optimization & Responsive Bugfix): Sửa triệt để các lỗi hiển thị trên màn hình điện thoại (iPhone/Android) — thanh điều hướng đáy 1 dòng gọn gàng, cửa sổ Modal tự cuộn mượt trong màn hình nhỏ, bố cục thẻ 2 cột tiết kiệm chiều dọc, danh sách Thư mục Drive dạng thẻ di động và chống tràn ngang trên mọi màn hình.',
    added: [
      'Chế độ hiển thị Thẻ thư mục di động (Mobile Cards) trên màn hình Tệp & Drive (/storage) thay thế bảng 7 cột khi xem bằng điện thoại, giúp xem trạng thái tải/duyệt và bấm Mở Drive 1 chạm.',
    ],
    improved: [
      'Tối ưu Thanh điều hướng đáy trên điện thoại (MobileBottomNav): rút gọn nhãn hiển thị trên 1 dòng sắc nét (Tổng quan, Chấm công, Công việc, Nhân sự, Thu chi, Quản trị), không còn bị gãy chữ thành 2–3 dòng.',
      'Tối ưu không gian đầu trang trên điện thoại: tự động ẩn nút Back lặp lại khi đã có Thanh điều hướng nhanh phân hệ (Sub-Navigation Bar), giảm khoảng đệm thừa hai bên và xếp các thẻ KPI / Lối tắt thao tác nhanh theo lưới 2 cột (2x2) gọn đẹp.',
    ],
    fixed: [
      'Sửa lỗi các cửa sổ bật lên (Modal Bổ sung SĐT, Chi trả lương VietQR, Nghỉ phép) bị tràn khỏi mép trên/dưới màn hình điện thoại khi mở bàn phím ảo — bổ sung thanh cuộn mượt (100dvh) và nút đóng (✕) góc phải.',
      'Sửa lỗi tràn ngang (Horizontal Overflow) tại hàng nhãn trạng thái Công việc (/work), ô gợi ý Ngân hàng và nút Thêm nhân sự trên màn hình điện thoại.',
    ],
  },
  {
    version: '0.3.0',
    commit: '11d2138',
    released_at: '2026-10-30T20:45:00.000Z',
    summary:
      'Hoàn tất Phase 11 (UI/UX Redesign & Bugfix): Thiết kế lại toàn bộ giao diện hiện đại, gọn gàng, thân thiện người dùng — bổ sung Thanh điều hướng nhanh phân hệ (Sub-Navigation Bar), sửa triệt để lỗi đè chữ trên các ô chọn ngày, mở khóa Nhật ký hệ thống trên Quản trị và sửa liên kết Lịch làm việc trên Công việc.',
    added: [
      'Thanh điều hướng nhanh phân hệ (Sub-Navigation Bar) ngay dưới Breadcrumb giúp chuyển đổi 1 chạm giữa các màn hình cùng nhóm (Chấm công / Lịch làm việc / Lịch sử công / Duyệt công; Công việc / Báo cáo / Tệp & Drive; Nhân sự / Bảng lương; Quản trị).',
    ],
    improved: [
      'Thiết kế lại trang Tổng quan (/dashboard): thẻ KPI tương tác trực tiếp, Trung tâm Việc cần xử lý và Lối tắt thao tác nhanh dạng ngang gọn gàng, thay toàn bộ nhãn tiếng Anh (Owner view / Staff view) sang tiếng Việt (Quản lý / Cá nhân).',
      'Đồng bộ độ rộng khung nội dung chuẩn (1240px căn giữa) trên toàn bộ màn hình (/work, /storage, /dashboard, /clock) và tương thích hoàn chỉnh chế độ Sáng/Tối (Light/Dark Mode).',
    ],
    fixed: [
      'Sửa triệt để lỗi đè chữ 2 lớp trên các ô chọn ngày (Từ ngày / Đến ngày) tại màn hình Chấm công & Duyệt công (/clock, /attendance) và lỗi mất nút chọn lịch trên các ô ngày hẹp.',
      'Mở khóa mục Nhật ký hệ thống (/system-logs) bị báo nhầm "Chưa triển khai" tại nhóm Quản trị (/groups/admin) và sửa lỗi đường dẫn /schedules gây 404 trên màn hình Công việc (/work).',
    ],
  },
  {
    version: '0.2.6',
    commit: '924d1b9',
    released_at: '2026-10-30T20:18:00.000Z',
    summary:
      'Hoàn tất Phase 10 (Master Plan ML-03, ML-04, ML-05): Nâng cấp Quản lý công việc (/work) thành Trung tâm điều phối chuẩn cho Web, App iPhone và Telegram/AWM — bổ sung mẫu Task Packet 1 chạm cho Máy/AI Executor, thanh lọc thông minh Hôm nay / Quá hạn / Cần sửa / Chờ duyệt và xem bằng chứng nộp bài trực tiếp.',
    added: [
      'Thanh lọc thông minh ML-04 (📅 Hôm nay, 🚨 Quá hạn, ⛔ Cần sửa / Bị chặn, ⏳ Chờ duyệt) khớp 100% dữ liệu nguồn trên /work.',
      'Bộ nút chèn nhanh mẫu Task Packet chuẩn ML-03 (🤖 Anty Win 1, 🖥️ Máy Win 2, 💻 MacBook, 🎬 Sản xuất Video V4) khi giao việc mới (/work/new).',
      'Hiển thị trực tiếp huy hiệu Máy/Executor, số lượng báo cáo nộp và đường link bằng chứng đính kèm (📎) ngay trên thẻ công việc (/work).',
    ],
    improved: [
      'Sẵn sàng API đồng bộ đa thiết bị (ML-05) với kiểm soát phiên bản If-Match, chống tạo trùng Idempotency-Key và nhật ký kiểm toán Audit.',
    ],
    fixed: [
      'Đồng bộ định dạng Ngày/Tháng/Năm (dd/mm/yyyy) kèm mở lịch 1 chạm trên mọi ô chọn ngày.',
    ],
  },
  {
    version: '0.2.5',
    commit: '2dfd336',
    released_at: '2026-10-30T20:14:00.000Z',
    summary:
      'Hoàn tất Phase 9: Đổi bộ lọc Từ ngày / Đến ngày sang chuẩn Ngày/Tháng/Năm (dd/mm/yyyy) tiếng Việt kèm nút chọn nhanh Hôm nay / 7 ngày qua / Tháng này trên Ca & Chấm công (/attendance); tự động hoàn tất kết nối Google Drive 1 chạm sau khi ủy quyền OAuth (/storage).',
    added: [
      'Thanh chọn nhanh khoảng thời gian 1 chạm (📅 Hôm nay, 📆 7 ngày qua, 🗓️ Tháng này, 🔄 Toàn thời gian) trên cả tab Duyệt công nhân viên và Lịch sử cá nhân (/attendance).',
      'Tự động hoàn tất kết nối Google Drive ngay khi Google OAuth redirect về /storage?oauth_code=... mà không cần bấm xác nhận lần 2.',
    ],
    improved: [
      'Hiển thị chuẩn Ngày / Tháng / Năm (dd/mm/yyyy) tiếng Việt trực tiếp trên các ô lọc Từ ngày / Đến ngày, thay thế hoàn toàn chữ mm/dd/yyyy tiếng Anh.',
    ],
    fixed: [
      'Khắc phục việc phải bấm xác nhận thủ công lần 2 sau khi Google OAuth chuyển hướng về trang Lưu trữ.',
    ],
  },
  {
    version: '0.2.4',
    commit: 'cedb252',
    released_at: '2026-10-30T19:35:00.000Z',
    summary:
      'Hoàn tất Phase 8: Sửa triệt để lỗi "Invalid, missing, or mismatched CSRF token" trên màn hình Quản lý Tệp & Drive (/storage) và kết nối sẵn Google Drive OAuth 2.0 cho truhoaiphuong03@gmail.com.',
    added: [
      'Cơ chế tự động nạp và đảm bảo CSRF token (ensureCsrfToken) từ /api/v1/auth/me cho toàn bộ 17 thao tác trên màn hình Quản lý Tệp & Drive (/storage).',
    ],
    improved: [
      'Chuẩn hóa GOOGLE_REDIRECT_URI sang https://ql.hoaiphuong.click/api/v1/storage/drive/oauth/callback và kích hoạt sẵn kết nối Google Drive cho truhoaiphuong03@gmail.com.',
    ],
    fixed: [
      'Khắc phục lỗi "Invalid, missing, or mismatched CSRF token" khi bấm Kết nối Google Drive, Tạo thư mục hoặc Tải tệp trên /storage.',
    ],
  },
  {
    version: '0.2.3',
    commit: 'ad3b092',
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
    fixed: [
      'Bỏ yêu cầu bắt buộc nhập CCCD và Địa chỉ khi cập nhật nhanh Số điện thoại liên hệ.',
    ],
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
    fixed: [
      'Xóa bỏ cảnh báo gói JavaScript đơn lẻ vượt quá 500 kB khi đóng gói giao diện Web.',
    ],
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
    fixed: [
      'Khắc phục thiếu cột thông tin Số điện thoại và Ngân hàng trên danh sách nhân sự tổng hợp.',
    ],
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
  {
    version: '0.0.9',
    commit: '3743e99',
    released_at: '2026-10-14T18:00:00.000Z',
    summary:
      'Phiên bản nền tảng trước khi bổ sung ghi nhớ đăng nhập mở rộng, phục vụ đối chiếu và khôi phục an toàn.',
    added: [
      'Hệ thống chấm công, lịch làm việc, báo cáo ngày, công việc, bảng lương, sổ thu chi và kho tài khoản dùng chung.',
    ],
    improved: [
      'Chuẩn hóa xác thực phiên làm việc và bảo vệ CSRF trên toàn bộ đường dẫn biến đổi dữ liệu.',
    ],
    fixed: [
      'Ổn định kết nối cơ sở dữ liệu và kiểm tra sức khỏe dịch vụ khi chuyển đổi phiên bản.',
    ],
  },
];
