# P0-D — Truy vết phát hành và cơ chế chống deploy trái phép

**Trạng thái:** thiết kế + công cụ chỉ đọc đã kiểm thử. **Chưa áp dụng bất kỳ thay đổi nào lên Production** (ACL, tác vụ lịch, cấu hình dịch vụ).

## 1. Đánh giá khả năng truy vết hiện tại

Kết quả `scripts/governance/Test-ProdProvenance.ps1` (chỉ đọc) lúc 19:35 ngày 2026-11-01 — bằng chứng đầy đủ: `docs/remediation/evidence/W1.5-prod-provenance-baseline.json`.

| Kiểm tra                                                                                                                | Kết quả                                                                                                                          | Đánh giá                                                |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Bản ghi cổng (`deploy-history.log`, `current-live-sha.txt`, `running-components-sha.json`, `dist/release-version.json`) | thống nhất: `v0.7.0`, sha `8ee37a2`, phát hành 18:28 bởi `WIN-1`                                                                 | **Bản ghi nhất quán với nhau**                          |
| Bundle web đang phục vụ so với đĩa                                                                                      | khớp từng tệp (served = disk)                                                                                                    | Phục vụ đúng cái nằm trên đĩa                           |
| Bundle web đang phục vụ so với bản ghi                                                                                  | **không khớp**: 6 bundle chính (18:29:16, 18:33:08, 18:36:58, 18:46:12, 18:53:54, 19:00:59) và **219 tệp** có mtime sau 18:28:35 | **Có ghi ngoài cổng**                                   |
| HEAD repo so với bản phát hành                                                                                          | HEAD đi trước 6 commit                                                                                                           | Mã Production không truy được về commit đã ghi          |
| `release-version.json` ở gốc thư mục Production                                                                         | `0.3.2` (sha cũ, 10/31) — không được API/web dùng                                                                                | Tệp cũ gây hiểu nhầm, nên loại bỏ khi có cửa sổ bảo trì |
| Ai ghi?                                                                                                                 | **Không xác định được** từ hệ thống: cùng tài khoản Windows, cùng tác giả Git, không bật kiểm toán truy cập tệp                  | **Thiếu bản ghi người/tiến trình ghi**                  |

**Kết luận:** truy vết _ở mức bản ghi cổng_ đạt; truy vết _mã thực sự đang chạy_ **không đạt** — web có thể đổi mà bản ghi không đổi và không phát hiện được nếu không chạy kiểm tra.

## 2. Nguyên nhân khiến triển khai trái phép xảy ra được

| #   | Nguyên nhân                                                                                                      | Loại      |
| --- | ---------------------------------------------------------------------------------------------------------------- | --------- |
| N1  | Chỉ thị trong `AGENTS.md` §4 bước 4 yêu cầu "đồng bộ sang Production" (đã vá trong nhánh `remediation/audit-v1`) | Quy trình |
| N2  | Tài khoản chạy phiên AI (`ADMIN`, nhóm Administrators) có FullControl lên `apps\management-lite\apps\web\dist`   | Quyền     |
| N3  | Thư mục phục vụ web là **nơi ghi trực tiếp** (không có thư mục phát hành bất biến + con trỏ)                     | Kiến trúc |
| N4  | Web server không kiểm tra tính toàn vẹn của dist so với manifest                                                 | Phát hiện |
| N5  | Không có kiểm toán tệp (SACL) và không có kiểm tra định kỳ                                                       | Phát hiện |
| N6  | Bước "sao chép" không cập nhật bản ghi phát hành                                                                 | Quy trình |

## 3. Thiết kế nhiều lớp

### Lớp 1 — Quy trình (làm ngay, không đụng Production)

- `AGENTS.md` §0 (đã soạn trong nhánh) + `docs/remediation/P0-A-NO-AUTO-DEPLOY-POLICY.md`.
- Mọi phiên chạy `Test-ProdProvenance.ps1` đầu/cuối phiên; báo Owner nếu `verdict=DRIFT`.

### Lớp 2 — Phát hiện (chỉ đọc, an toàn)

- Chạy `Test-ProdProvenance.ps1` theo yêu cầu, hoặc theo lịch bằng **tác vụ chỉ đọc** (cần Owner duyệt tạo tác vụ — chưa làm) ghi báo cáo ra thư mục ngoài Production và thông báo khi `DRIFT`.
- Tín hiệu then chốt: `dist_files_newer_than_release.count > 0` ⇒ có ghi sau lần phát hành chính thức.

### Lớp 3 — Manifest toàn vẹn (thay đổi mã/gói, Đợt sau)

- `package-release-bundle.mjs` ghi thêm vào `release-version.json`: `treeSha256` = SHA-256 của danh sách có sắp xếp `(đường dẫn, sha256 tệp)` của `web/` (và `api/`), cùng `artifactSha256`, `builtAt`, `builtBy`.
- Web server (`serve-web.cjs`) tính `treeSha256` khi khởi động và mỗi 5–10 phút; nếu lệch manifest: **ghi log mức ERROR + trả `X-Release-Integrity: MISMATCH` trên `/api/v1/health`** (cảnh báo, không tự dừng, để không gây gián đoạn). Tùy chọn fail-closed do Owner quyết định.
- `/api/v1/health` công khai chỉ trả `status`; chi tiết `sha/tree` chỉ cho người đã xác thực (xem SEC-05).

### Lớp 4 — Phát hành bất biến + con trỏ nguyên tử (kiến trúc, Đợt sau)

- `releases\<sha10>\{web,api}` chỉ ghi một lần (ACL chỉ-đọc ngay sau khi tạo); `current` là **junction** đổi bằng một thao tác nguyên tử; web phục vụ `current\web`.
- Rollback = đổi junction về bản trước (tức thời), không sao chép.
- Hướng này **khớp** với thiết kế ban đầu của `Deploy-WebOnly-Windows.ps1` (`releases\<sha>\web` + `current\web`) nhưng hiện chưa dùng ở Production.

### Lớp 5 — Quyền ghi (cần Owner duyệt riêng — OA-18, **chưa thực hiện**)

Mô hình khuyến nghị (mạnh nhất): **tách tài khoản**.

| Tài khoản                                                  | Quyền trên `C:\HoaiPhuong-Server\apps\management-lite` | Dùng để                       |
| ---------------------------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| `mgl-dev` (người dùng thường, không Administrators)        | **Đọc**                                                | chạy mọi phiên AI/dev         |
| `mgl-deploy` hoặc `SYSTEM` (qua tác vụ do Owner kích hoạt) | **Ghi**                                                | chỉ cổng phát hành            |
| `ADMIN` (Owner, quản trị)                                  | toàn quyền nhưng **không dùng cho phiên AI**           | thao tác quản trị có chủ đích |

Giới hạn trung thực: nếu phiên AI vẫn chạy bằng tài khoản quản trị của Owner thì **không thể** chặn tuyệt đối bằng ACL (quản trị viên đổi được ACL); khi đó chỉ còn Lớp 1–3 + kỷ luật. Vì vậy khuyến nghị chạy phiên AI bằng tài khoản không quản trị.

Lệnh minh họa (**KHÔNG chạy**; đã ghi để Owner xem xét, kèm lệnh hoàn tác):

```
# xem ACL hiện tại (chỉ đọc)
icacls "C:\HoaiPhuong-Server\apps\management-lite\apps\web\dist"
# lưu bản sao ACL để hoàn tác
icacls "C:\HoaiPhuong-Server\apps\management-lite" /save C:\ML-Backup\acl-before.txt /t
# (áp dụng sau khi Owner duyệt) hạ quyền ghi của nhóm dev
icacls "...\dist" /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)RX" "mgl-deploy:(OI)(CI)M" "NETWORK SERVICE:(OI)(CI)RX" "LOCAL SERVICE:(OI)(CI)RX"
# hoàn tác
icacls "C:\HoaiPhuong-Server\apps\management-lite" /restore C:\ML-Backup\acl-before.txt
```

Rủi ro: dịch vụ web (`NETWORK SERVICE`/`LOCAL SERVICE`) mất quyền đọc nếu viết sai; phải thử trên **bản sao** thư mục ở STAGING trước.

### Lớp 6 — Kiểm toán (cần Owner duyệt; chưa làm)

- Bật _Audit File System_ và SACL (ghi `Write/Delete`) trên `...\apps\web\dist` để Windows ghi sự kiện 4663 kèm tài khoản và tiến trình. Cho phép trả lời "ai ghi" ở lần sau. Cần bật chính sách kiểm toán (thay đổi hệ thống).

## 4. Ma trận kiểm soát chống nguyên nhân

| Nguyên nhân | Lớp xử lý | Hiệu lực                                                 | Tác động Production khi áp dụng             |
| ----------- | --------- | -------------------------------------------------------- | ------------------------------------------- |
| N1          | 1         | Cao với phiên đọc `AGENTS.md`; thấp với script không đọc | không                                       |
| N2          | 5         | **Cao** (nếu tách tài khoản)                             | cần ACL, có thể ảnh hưởng dịch vụ nếu sai   |
| N3          | 4         | Cao                                                      | thay đổi layout Production → cửa sổ bảo trì |
| N4          | 3         | Trung bình (phát hiện)                                   | cần phát hành bản web mới qua cổng          |
| N5          | 2, 6      | Phát hiện, sau sự việc                                   | không (Lớp 2) / thay đổi chính sách (Lớp 6) |
| N6          | 3, 4      | Cao                                                      | cùng Lớp 3–4                                |

## 5. Kế hoạch kiểm chứng

| Kiểm chứng                                    | Cách làm                                                     | PASS                                                     |
| --------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| Công cụ phát hiện                             | Chạy `Test-ProdProvenance.ps1` ở trạng thái hiện tại         | trả `DRIFT` + 6 bundle sau phát hành (**đã chạy: PASS**) |
| Công cụ không ghi                             | so sánh mtime `index.html` Production trước/sau khi chạy     | không đổi (**đã kiểm: PASS**)                            |
| Hiệu lực phát hiện                            | trên bản sao STAGING: ghi một tệp vào dist rồi chạy kiểm tra | báo `DRIFT`                                              |
| Hook                                          | `scripts/governance/hooks/*` trên clone cô lập               | xem báo cáo W1.3                                         |
| ACL (sau khi Owner duyệt)                     | thử ghi bằng tài khoản dev vào bản sao STAGING               | `Access denied`                                          |
| Fail-closed/integrity (sau khi triển khai mã) | sửa 1 byte dist ở STAGING                                    | `X-Release-Integrity: MISMATCH`                          |

## 6. Rollback

Lớp 1–2: xóa tệp tài liệu/script. Lớp 3–4: phát hành lại bản trước qua cổng; Lớp 5: `icacls /restore` từ bản đã lưu; Lớp 6: tắt chính sách kiểm toán.
