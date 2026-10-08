# PK-01 — T1–T4 Foundation Decisions

**CANONICAL DOCUMENT — OWNER-APPROVED DESIGN / LOCAL_ONLY / NOT IMPLEMENTED**

Version: `0.1.0-doc.21` | Parent: `0.1.0-doc.20` | Date: 2026-10-08

## Authority and provenance

Nguồn phê duyệt: nội dung T1–T4 do Owner cung cấp trực tiếp trong packet `PK-01-T1T4-CANON-PUB-01` tại cuộc trò chuyện này. Baseline repository trước publication local: `df1a71efcf8beb3630e20efaa24531cee41f5de6`.

Packet này chỉ cho phép canonical hóa thiết kế LOCAL_ONLY bằng tài liệu này và manifest. Đây không phải START-CODE PK-01, quyền publication lên GitHub, executor assignment hoặc release approval. Nội dung quyết định dưới đây được giữ theo nguồn Owner; không tự bổ sung tên bảng/cột, DTO/API, thuật toán hoặc DDL chưa được phê duyệt.

## Scope and precedence

PK-01 giới hạn ở M00 PostgreSQL prerequisites, M01 Workspace/global User/Audit/Idempotency foundation, transaction helpers và M11 guards/index cần thiết cho các bảng thuộc PK-01.

Giữ nguyên PAY-02, RBAC-02, SEC-02, C01–C06, G01–G05 và canonical precedence trong doc.20: Owner locks > API-SYNC docs/36–37 > UI-REVIEW docs/44–46 > DB-CONSTRAINT docs/50–51 > QA-SYNC docs/47–49 > historical examples. T1–T4 ghi nhận các quyết định kỹ thuật đã được Owner phê duyệt; không thay đổi business policy hoặc mở rộng scope.

M02 AUTH, activation invite, email_outbox, outbox platform mới, business schema của các module sau, PK-02, production và release tiếp tục HOLD. M08–M10 WORK/Drive/Content/Video vẫn nằm ngoài V0.1. Unknown/conflict => STOP + ASK; không tự chọn diễn giải khác nguồn phê duyệt.

## T1 — Idempotency

- `operation_key` phân biệt route/operation namespace và client key.
- Unique theo `(workspace_id, actor_user_id, operation_key)`.
- Request fingerprint từ payload canonical, không chứa plaintext secret hoặc reauth proof.
- Claim, concurrency, replay và mismatch được xử lý nguyên tử.
- Same key + same request trả lại kết quả an toàn đã hoàn thành; khác payload trả 409.
- Claim chưa rõ trạng thái commit phải được reconcile an toàn, không tự thực thi lại chỉ vì timeout.

## T2 — TTL và unknown commit

- TTL baseline local mặc định 24 giờ, có thể cấu hình.
- Không cam kết exactly-once sau khi record hết hạn.
- Retry sau timeout hoặc unknown commit phải đối chiếu bằng chứng durable trước khi thực thi lại.
- Không xóa record chưa xác định kết quả chỉ để cho phép retry.

## T3 — Audit

- Audit append-only, metadata sanitized, không chứa secret/token/password.
- `actor_user_id` NULL chỉ trong trường hợp bootstrap/system được kiểm soát.
- Mutation và audit phải atomic trong cùng transaction khi áp dụng.
- Application DB role không được UPDATE/DELETE audit.
- Kiểm tra DB guard/permissions thực tế khi triển khai; không tuyên bố bảo vệ khỏi superuser.

## T4 — Migration registry

- PostgreSQL-native migration registry tối thiểu.
- Migration IDs có thứ tự và checksum bất biến.
- Lock chống chạy đồng thời.
- Replay không thay đổi schema; checksum mismatch phải fail closed.
- Migration transactional khi PostgreSQL hỗ trợ.
- Không destructive rollback tự động, không bỏ qua failed/partial migration.

## Canonical sources and preservation

Đối chiếu các nguồn hiện hành: docs 20–22 (columns/FK/index/migration DAG), 36–37 (API-SYNC và transaction guards), 50–51 (DB-CONSTRAINT và DBT), 54–55 (ownership/handoff/acceptance), 57 (QA-FINAL và ranh giới PK-01). Các nguồn normative liên quan gồm docs 04 (RBAC-02), 07 (PAY-02), 18 (SEC-02), 24 (idempotency/protocol), 30 (C01–C06), 43 (G01–G05), 44–49 (UI/QA).

58 tài liệu canonical doc.20 được giữ nguyên bytes và SHA-256. Publication local này chỉ thêm một tài liệu và entry tương ứng, cập nhật metadata version/parent/stage/status của manifest; không sửa các nguồn cũ hoặc PK-00 verifier.

## Evidence and remaining gates

T1–T4: Owner-approved DESIGN. Runtime tests, DB guards/permissions, migration fresh/replay/checksum/concurrency/failure recovery và unknown-commit reconciliation: NOT RUN trong packet này. Không suy ra DBF/DBT PASS từ việc canonical hóa. QA-FINAL và release gates của doc.20 giữ nguyên.

Publication GitHub và START-CODE PK-01 cần checkpoint Owner/Reviewer riêng. Dừng sau báo cáo LOCAL_ONLY; không commit, push, tạo PR, chạy SQL/migration, triển khai code hoặc tự giao executor.
