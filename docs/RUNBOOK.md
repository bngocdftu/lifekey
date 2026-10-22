# RUNBOOK: chạy bản thử LifeKey trên TideCloak thật

Mục tiêu: tự tay thấy mạng Tide **cho phép** đúng grant và **từ chối** mọi grant sai (trang `/proof`).

## Xem giao diện không cần TideCloak

```bash
npm install
npm run preview      # http://localhost:3100
```

Chế độ này thay SDK Tide bằng bản giả và dùng dữ liệu mẫu, chỉ để xem giao diện. Đổi tài khoản bằng `?as=doctor-a` (hoặc `admin`, `doctor-b`, `doctor-c`, `doctor-d`), hoặc bấm tên ở góc dưới thanh bên trái. Kết quả trang Kiểm chứng trong chế độ này **không** chứng minh gì, vì không có mạng Tide thật.

## 0. Cần có

- Docker Desktop (macOS), Node 20+, `jq`, `curl` (`brew install jq`)
- **5 browser profile** (Chrome → Add profile), mỗi profile một tài khoản Tide riêng: `admin`, `doctor-a`, `doctor-b`, `doctor-c`, `doctor-d`
- Hỏi Tide team (Discord https://discord.gg/XBMd9ny2q5) xem mạng của `tideorg/tidecloak-dev` đã có contract **`RelationshipAttestation:1`** chưa (ORK build từ 16/10/2026). Nếu chưa có thì dừng ở đây.

## 1. Khởi tạo

```bash
cp .env.example .env          # đặt KC_BOOTSTRAP_ADMIN_PASSWORD
npm install
npm run init
```

Script sẽ hỏi **email quản lý licence Tide** và bạn có **đồng ý Terms & Conditions** (https://tide.org/legal) không. Hai câu này phải do chính bạn trả lời.

Script in ra **5 invite link**. Mở mỗi link trong **đúng profile của người đó** và tạo/liên kết một tài khoản Tide. Script chờ đủ 5 người, cấp `tide-realm-admin` cho `admin` (realm chuyển sang multiAdmin), rồi xuất `data/tidecloak.json`.

## 2. Chạy app

```bash
npm run dev      # http://localhost:3000
```

Đăng nhập một lần ở cả 5 profile (để LifeKey ghi nhận Tide key của từng người).

## 3. Biến B và C thành approver (3 admin → ngưỡng 2)

Trong TideCloak admin console (`http://localhost:8080/admin/master/console/#/lifekey`), profile `admin`:

1. Users → `doctor-b` → Role mapping → Assign role → lọc theo client `realm-management` → chọn **`tide-realm-admin`** và **`manage-realm`**.
2. Vào phần Change Requests → duyệt (enclave pop-up). Lúc này mới có 1 admin nên ngưỡng = 1.
3. Làm lại với `doctor-c`. Duyệt bằng `admin` (sau khi có B thì ngưỡng vẫn là `floor(0.7×2) = 1`).
4. Nếu có change request `REGEN_ADMIN_POLICY` thì duyệt nốt. Sau bước này ngưỡng là `floor(0.7×3) = 2`.
5. B và C đăng xuất rồi đăng nhập lại để token có role mới.

Kiểm tra: ở trang chủ LifeKey, B và C hiện badge **tide-realm-admin (approver)**. `doctor-a` **không bao giờ** được cấp role này.

## 4. Enrollment (profile `admin`)

1. `/setup` → **1. Gửi standing grants cho quorum**: tạo 6 change request (4 grant ghi, 1 Tier 1, 1 break-glass).
2. Profile B → `/approve` → chọn tất cả → **Duyệt** (một pop-up cho cả lô) → mỗi mục `1/2`.
3. Profile C → `/approve` → **Duyệt** → `COMMITTED`.
4. Profile `admin` → `/setup` → **Làm mới**: tất cả `SIGNED`. Nếu có dòng `FAILED` thì xem mục Sự cố.
5. **2. Nhập hồ sơ giả lập**: trình duyệt của admin mã hoá 4 record; server chỉ lưu ciphertext.

## 5. Demo

| Bước | Profile | Làm | Thấy |
|---|---|---|---|
| 1 | A | `/emergency/p_8f29a1` | Tier 1: warfarin, penicillin, van tim |
| 2 | A | ALERT-88 → *View source record* → lý do → Gửi | REQ-1042 `PENDING_APPROVAL` |
| 3 | A | `/proof` → chạy | A1 *bỏ qua* (chưa có grant) |
| 4 | B | `/approve` → duyệt REQ-1042 | `1/2` |
| 5 | A | Làm mới | Vẫn `PENDING_APPROVAL`: một chữ ký chưa đủ |
| 6 | C | `/approve` → duyệt | `COMMITTED` |
| 7 | A | Làm mới → **Giải mã** MED-204 | Danh sách thuốc |
| 8 | A | `/proof` → chạy | A1 PASS (cho phép); A2–A6 PASS (bị từ chối); A7 cho phép (giới hạn đã biết) |
| 9 | D | `/proof` → chạy | D1, D2 bị từ chối; D3 cho phép |
| 10 | A | MED-204 → **Break glass** → lý do | Đọc được ngay; B/C thấy mục cần rà soát |
| 11 | B, C | `/approve` → rà soát | `JUSTIFIED` hoặc `FLAGGED` |
| 12 | admin, B | `/proof` | R1, B1 bị từ chối; S1: server không ghi được chữ ký |
| 13 | bất kỳ | `/audit` | Chuỗi hash nguyên vẹn |

Thử hết hạn: tạo request mới, để hết hạn (hoặc sửa `DEFAULT_TTL_SECONDS` trong `src/app/api/emergency-requests/route.ts` xuống 120 giây), rồi chạy lại A1. Mong đợi: bị từ chối.

## 6. Ghi lại bằng chứng

Chụp màn hình `/proof` cho A, D, admin và B; lưu vào `docs/proof/`. Đây là bằng chứng cho mục 6 của bản thiết kế.

## Sự cố

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `Could not reach enough VVK ORKs` ngay sau một phép thử "phải từ chối" | **Đó chính là lời từ chối.** Lý do của contract nằm trong `cause` (trang `/proof` đã in ra) |
| Ký policy báo unknown contract | Mạng chưa có `RelationshipAttestation:1`: hỏi Tide team |
| `/setup` báo `FAILED: signed policy does not match` | TideCloak mã hoá lại policy khác byte gốc: gửi chi tiết cho Tide team (điểm 6.3.2 trong thiết kế) |
| `has not been allowed a voucher action of type vendordecrypt` | Thiếu role voucher `_tide_x.selfdecrypt`, hoặc người dùng chưa đăng nhập lại sau khi được cấp role |
| `/approve` báo HTTP 403 | Approver thiếu `manage-realm` hoặc chưa đăng nhập lại |
| Pop-up enclave không mở | Cho phép pop-up với `localhost:3000`; phải bấm Duyệt trực tiếp (không qua tự động) |
| Ngưỡng vẫn `1` khi đã có 3 admin | Chưa duyệt `REGEN_ADMIN_POLICY` (bước 3.4) |
| `master token: HTTP 401` | Sai `KC_BOOTSTRAP_ADMIN_PASSWORD` trong `.env` |
