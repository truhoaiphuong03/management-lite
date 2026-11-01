# Remediation — Đợt 1 (W1) tài liệu và công cụ

Nhánh: `remediation/audit-v1` (worktree `C:\Projects\management-lite-remediation`), tách từ `main@d5693ef`. **Chưa push, chưa gộp vào `main`, chưa áp dụng lên Production.**

| Tệp | Nội dung |
|---|---|
| `P0-A-NO-AUTO-DEPLOY-POLICY.md` | Quy tắc AI không tự deploy, định nghĩa D1–D7, phối hợp nhiều phiên, freeze |
| `P0-B-ENVIRONMENT-SEPARATION.md` | Thiết kế tách DEV / TEST / STAGING / PRODUCTION |
| `P0-C-KEY-ESCROW-DESIGN.md` | Đánh giá phương án ký quỹ khóa + công cụ `key-escrow.mjs` |
| `P0-D-RELEASE-TRACEABILITY-ANTI-DEPLOY.md` | Truy vết phát hành + thiết kế chống deploy trái phép |
| `P0-E-RESTORE-VERIFICATION.md` | Kết quả restore backup trong cụm cô lập |
| `evidence/` | Bằng chứng số liệu (không chứa dữ liệu cá nhân hay khóa) |
| `../../scripts/governance/Test-ProdProvenance.ps1` | Kiểm tra truy vết Production — **chỉ đọc** |
| `../../scripts/governance/Scan-GitHistory.mjs` | Quét lịch sử Git tìm dữ liệu nhạy cảm — chỉ xuất số đếm |
| `../../scripts/governance/key-escrow.mjs` | Ký quỹ khóa mã hóa bằng passphrase — **Owner tự chạy** |
| `../../scripts/governance/hooks/pre-commit`, `pre-push` | Guard tùy chọn (chưa cài vào repo dùng chung) |
| `../../scripts/governance/Install-GitGuards.ps1`, `Set-FreezeFlag.ps1` | Cài hook / bật-tắt cờ freeze (mặc định chạy thử, từ chối repo dùng chung) |

## Chạy các công cụ chỉ đọc

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\governance\Test-ProdProvenance.ps1 -RepoPath C:\Projects\management-lite -OutFile <đường dẫn ngoài Production>
node scripts\governance\Scan-GitHistory.mjs C:\Projects\management-lite
```

## Rollback toàn bộ Đợt 1

1. Gỡ các **junction** trong `node_modules` của worktree **trước** (tuyệt đối không dùng `Remove-Item -Recurse` lên thư mục chứa junction: có thể xóa nội dung đích):
   `Get-ChildItem C:\Projects\management-lite-remediation\node_modules -Force | ForEach-Object { cmd /c rmdir "$($_.FullName)" }` — lệnh `rmdir` không đệ quy chỉ gỡ liên kết. Với thư mục `@management-lite` (thư mục thật chứa junction) gỡ từng junction con rồi `rmdir` thư mục.
2. `git worktree remove --force C:\Projects\management-lite-remediation` rồi `git branch -D remediation/audit-v1`.
3. Xóa bundle trong thư mục `scratch\baseline` nếu không còn cần.
`main`, `origin` và Production không bị thay đổi bởi Đợt 1 nên không cần hoàn tác.
