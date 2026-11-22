# Bảng Màu & Nhận Diện Thương Hiệu — Gà Công Nghệ (`GCN-BRAND-01`)

> **Nguồn sự thật duy nhất (CSS):** [`packages/ui/src/brand/gcn-brand.css`](../../packages/ui/src/brand/gcn-brand.css) — chỉ chứa biến gốc `--gcn-*` và font để dùng chung 1:1 giữa `ql.hoaiphuong.click` và `hoaiphuong.click`.
>
> **Nguồn trích xuất thực tế (2026-11-20):**
>
> - Logo chính thức: `https://hoaiphuong.click/assets/img/logo-ngang.svg` (`16.78 KB`, `<= 30 KB` nên giữ nguyên không cần tối ưu `svgo`)
> - Tài nguyên ảnh: `apps/web/public/brand/{logo-ngang.svg, linh-vat.png, favicon.png, og-image.png}`
> - Stylesheet trang chủ: `https://hoaiphuong.click/assets/css/style.css`

---

## 1. Màu trích xuất trực tiếp từ `logo-ngang.svg` & `hoaiphuong.click/assets/css/style.css`

| Vai trò                  | Biến trang chủ (`style.css`) | Biến nguồn (`gcn-brand.css`) | Mã HEX    | Ghi chú                                           |
| ------------------------ | ---------------------------- | ---------------------------- | --------- | ------------------------------------------------- |
| Mào lửa cam (nhấn chính) | `--cam`                      | `--gcn-fire`                 | `#FF6A1A` | Trích trực tiếp từ mào lửa trên `logo-ngang.svg`  |
| Mào lửa hover (-8%)      | —                            | `--gcn-fire-hover`           | `#EB6218` | Giảm sáng 8% RGB từ `#FF6A1A`                     |
| Mào lửa active (-16%)    | —                            | `--gcn-fire-active`          | `#D65916` | Giảm sáng 16% RGB từ `#FF6A1A`                    |
| Lửa vàng                 | `--vang`                     | `--gcn-gold`                 | `#FFB347` | Ngọn lửa trong mào & mỏ gà (`logo-ngang.svg`)     |
| Đỏ than                  | `--do`                       | `--gcn-ember`                | `#E5341D` | Chân mào & yếm gà (`logo-ngang.svg`), dùng rất ít |
| Nền đêm chính            | `--nen`                      | `--gcn-ink`                  | `#0D0A09` | Nền tối chính (`--bg-color` Dark)                 |
| Nền sâu (video/header)   | `--nen-video`                | `--gcn-ink-deep`             | `#0B0907` | Nền video intro & lớp nền sâu hơn `--nen`         |
| Nền phụ tối (ấm bậc 1)   | `--nen-2`                    | `--gcn-surface-subtle`       | `#110D0B` | Nền phụ tối ấm hơn `#0D0A09`                      |
| Bề mặt thẻ (ấm bậc 2)    | `--than`                     | `--gcn-surface`              | `#171210` | Thẻ, panel, sidebar tối (`--surface-color` Dark)  |
| Bề mặt hover (ấm bậc 3)  | `--o-icon`                   | `--gcn-surface-hover`        | `#221913` | Trạng thái hover bề mặt tối (`--surface-hover`)   |
| Bề mặt active (ấm bậc 4) | `--vien`                     | `--gcn-surface-active`       | `#2A2019` | Trạng thái active & viền mảnh tối                 |
| Viền chuẩn nền tối       | `--vien-dam`                 | `--gcn-border`               | `#33281F` | Viền card/input trên nền tối                      |
| Viền hover nền tối       | `#4A3A2C` (`.nut-phu`)       | `--gcn-border-hover`         | `#4A3A2C` | Viền nổi bật khi hover trên nền tối               |
| Viền linh vật            | `--vien-ga`                  | `--gcn-rooster-outline`      | `#2A2320` | Đường viền pixel của đầu gà trong logo            |
| Chữ chính nền tối (kem)  | `--kem`                      | `--gcn-cream`                | `#FFF1DC` | Chữ chính nền tối & chữ trên `logo-ngang.svg`     |
| Chữ phụ nền tối          | `--chu-phu`                  | `--gcn-cream-secondary`      | `#C9B8A3` | Chữ mô tả phụ nền tối                             |
| Chữ mờ nền tối           | `--chu-mo`                   | `--gcn-cream-muted`          | `#B8A590` | Chữ ghi chú/nhãn phụ nền tối                      |

---

## 2. Biến nhấn chữ đạt chuẩn WCAG 2.1 AA (`>= 4.5:1`)

| Biến (`gcn-brand.css`)    | Mã HEX                     | Ứng dụng trong `tokens.css`                                                |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `--gcn-fire-text-light`   | `#B53D00`                  | `--accent-text`, `--primary-color`, `--focus-ring` trên nền Sáng (`light`) |
| `--gcn-fire-light-hover`  | `#9E3300`                  | `--primary-hover` trên nền Sáng (đậm hơn ~8% từ `#B53D00`)                 |
| `--gcn-fire-light-active` | `#872A00`                  | `--primary-active` trên nền Sáng (đậm hơn ~16% từ `#B53D00`)               |
| `--gcn-fire-text-dark`    | `#FF853D`                  | `--accent-text` trên nền Tối (`dark`)                                      |
| `--gcn-fire-subtle`       | `rgba(255, 106, 26, 0.15)` | `--primary-subtle` trên nền Tối                                            |
| `--gcn-fire-subtle-light` | `rgba(255, 106, 26, 0.12)` | `--primary-subtle` trên nền Sáng                                           |
| `--gcn-fire-border`       | `rgba(255, 106, 26, 0.35)` | Viền badge/thẻ nhấn                                                        |

---

## 3. Tỷ lệ tương phản WCAG 2.1 đo thực tế

| Cặp Chữ / Nền                                                                           | Màu chữ   | Màu nền   | Tỷ lệ tương phản | Chuẩn WCAG 2.1           |
| --------------------------------------------------------------------------------------- | --------- | --------- | ---------------: | ------------------------ |
| Chữ nhấn Light trên trắng (`--gcn-fire-text-light` / `#FFFFFF`)                         | `#B53D00` | `#FFFFFF` |     **5.78 : 1** | **PASS AA** (`>= 4.5:1`) |
| Chữ nhấn Light trên canvas sáng (`--gcn-fire-text-light` / `#F8FAFC`)                   | `#B53D00` | `#F8FAFC` |     **5.53 : 1** | **PASS AA**              |
| Chữ nhấn Light trên bề mặt phụ (`--gcn-fire-text-light` / `#F1F5F9`)                    | `#B53D00` | `#F1F5F9` |     **5.28 : 1** | **PASS AA**              |
| Chữ nhấn Light trên badge cam nhạt (`rgba(255,106,26,0.12)` trên `#FFFFFF` ≈ `#FFEDE4`) | `#B53D00` | `#FFEDE4` |     **5.09 : 1** | **PASS AA**              |
| Nút chính Light (chữ trắng trên `--gcn-fire-text-light`)                                | `#FFFFFF` | `#B53D00` |     **5.78 : 1** | **PASS AA**              |
| Nút chính Light hover (chữ trắng trên `--gcn-fire-light-hover`)                         | `#FFFFFF` | `#9E3300` |     **7.17 : 1** | **PASS AAA**             |
| Nút chính Light active (chữ trắng trên `--gcn-fire-light-active`)                       | `#FFFFFF` | `#872A00` |     **8.89 : 1** | **PASS AAA**             |
| Chữ nhấn Dark trên nền đêm (`--gcn-fire-text-dark` / `--gcn-ink`)                       | `#FF853D` | `#0D0A09` |     **8.15 : 1** | **PASS AAA**             |
| Chữ nhấn Dark trên thẻ tối (`--gcn-fire-text-dark` / `--gcn-surface`)                   | `#FF853D` | `#171210` |     **7.67 : 1** | **PASS AAA**             |
| Chữ nhấn Dark trên hover tối (`--gcn-fire-text-dark` / `--gcn-surface-hover`)           | `#FF853D` | `#221913` |     **7.13 : 1** | **PASS AAA**             |
| Chữ nhấn Dark trên active tối (`--gcn-fire-text-dark` / `--gcn-surface-active`)         | `#FF853D` | `#2A2019` |     **6.58 : 1** | **PASS AA+**             |
| Chữ nhấn Dark trên badge cam tối (`rgba(255,106,26,0.18)` trên `#171210` ≈ `#412212`)   | `#FF853D` | `#412212` |     **5.93 : 1** | **PASS AA**              |
| Nút chính Dark (chữ `--gcn-ink` trên `--gcn-fire`)                                      | `#0D0A09` | `#FF6A1A` |     **6.88 : 1** | **PASS AA+**             |
| Nút chính Dark hover (chữ `--gcn-ink` trên `--gcn-fire-hover`)                          | `#0D0A09` | `#EB6218` |     **5.88 : 1** | **PASS AA**              |
| Nút chính Dark active (chữ `--gcn-ink` trên `--gcn-fire-active`)                        | `#0D0A09` | `#D65916` |     **4.98 : 1** | **PASS AA**              |
| Chữ chính Dark trên nền đêm (`--gcn-cream` / `--gcn-ink`)                               | `#FFF1DC` | `#0D0A09` |    **17.72 : 1** | **PASS AAA**             |
| Chữ chính Dark trên thẻ tối (`--gcn-cream` / `--gcn-surface`)                           | `#FFF1DC` | `#171210` |    **16.69 : 1** | **PASS AAA**             |
| Chữ phụ Dark trên thẻ tối (`--gcn-cream-secondary` / `--gcn-surface`)                   | `#C9B8A3` | `#171210` |     **9.61 : 1** | **PASS AAA**             |
| Chữ mờ Dark trên thẻ tối (`--gcn-cream-muted` / `--gcn-surface`)                        | `#B8A590` | `#171210` |     **7.80 : 1** | **PASS AAA**             |
| Chữ mờ Dark trên active tối (`--gcn-cream-muted` / `--gcn-surface-active`)              | `#B8A590` | `#2A2019` |     **6.69 : 1** | **PASS AA+**             |

---

## 4. Phông chữ & Quy tắc bất biến

- **Phông chữ:** `Be Vietnam Pro` — **khớp 100%** với `https://hoaiphuong.click/assets/css/style.css` (`--font: "Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", sans-serif`). Không đổi font.
- **Chế độ mặc định:** Giữ nguyên **Sáng (`light`)**.
- **Logo trên nền sáng:** Vì chữ `"GÀ CÔNG NGHỆ"` trong `logo-ngang.svg` dùng màu kem `#FFF1DC` thiết kế cho nền tối, trên giao diện Sáng logo ngang được đặt trong khung bo tròn nền `#0D0A09` (`--gcn-ink`) đảm bảo tương phản `17.72:1` mà vẫn giữ nguyên vẹn tệp SVG gốc.
- **Không đổi:** Tên workspace DB (`THIẾT KẾ IN ẤN TOÀN GIA PHÁT`), nội dung/màu PDF báo giá in ấn (`#0F766E`), màu trạng thái ngữ nghĩa (`success`, `warning`, `danger`, `info`), tên package npm, tên cookie và tên repo.
