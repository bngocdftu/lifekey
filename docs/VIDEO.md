# Quay video demo (2 phút)

Yêu cầu của ban tổ chức: file `.mp4`, dưới 100 MB, đặt trong repo (ví dụ `docs/demo.mp4`), dài khoảng 2 phút, theo 4 phần: khả năng mới, rào cản, bản thử và vai trò của TideCloak, điều gì thay đổi.

## Chạy bản xem trước trên máy quay

Cần Node 20 trở lên (`node -v`). Không cần Docker hay TideCloak.

```bash
git clone https://github.com/bngocdftu/lifekey.git
cd lifekey
npm install
npm run preview
```

Mở http://localhost:3100. Đổi tài khoản bằng cách thêm `?as=...` vào cuối địa chỉ, hoặc bấm tên ở góc dưới thanh bên trái:

| Tài khoản | Địa chỉ |
|---|---|
| Bác sĩ A (xin quyền, mở khẩn cấp) | http://localhost:3100/?as=doctor-a |
| Bác sĩ B (người duyệt) | http://localhost:3100/approve?as=doctor-b |
| Bác sĩ C (người duyệt) | http://localhost:3100/approve?as=doctor-c |
| Bác sĩ D (bác sĩ khác) | http://localhost:3100/proof?as=doctor-d |
| Phòng hồ sơ | http://localhost:3100/setup?as=admin |

Dữ liệu mẫu nằm trong bộ nhớ trình duyệt: tải lại trang là về trạng thái ban đầu. Muốn quay giao diện điện thoại: Chrome → chuột phải → Inspect → bật biểu tượng điện thoại (Toggle device toolbar) → chọn iPhone 14.

Quay màn hình trên macOS: `Cmd + Shift + 5` → Record Selected Portion. Trên Windows: `Win + Alt + R` (Xbox Game Bar).

## Kịch bản

| Thời gian | Nói | Trên màn hình |
|---|---|---|
| 0:00–0:20 **Khả năng mới** | "3 giờ sáng, một bệnh nhân bất tỉnh vào cấp cứu. Bác sĩ cần biết ngay bệnh nhân đang dùng thuốc chống đông, dị ứng penicillin, có van tim cơ học." | `?as=doctor-a` → mở **Bệnh nhân**. Lướt chậm qua 4 cảnh báo cấp cứu và thẻ mã QR. |
| 0:20–0:40 **Rào cản** | "Hệ thống bình thường để server và admin giữ khoá: hack server hoặc một người nội bộ là đọc được mọi hồ sơ. Nên bệnh viện không dám mở hồ sơ chi tiết rộng rãi." | Vẫn ở trang bệnh nhân, chỉ vào phần **Hồ sơ chi tiết**: mỗi hồ sơ cần quyền đọc riêng. |
| 0:40–1:15 **Bản thử: xin quyền và 2 người duyệt** | "Bác sĩ A xin đọc danh sách thuốc. TideCloak tạo một quyền chỉ cho A, chỉ hồ sơ này, hết hạn sau 2 giờ. Quyền chỉ có hiệu lực khi đủ 2 người duyệt ký bằng tài khoản Tide của chính họ." | Bấm **Xin quyền đọc** ở thẻ hồ sơ, nhập lý do, gửi. Đổi sang `/approve?as=doctor-b` → chọn yêu cầu → thẻ quyền đọc có vòng **1/2 chữ ký** → **Ký duyệt**. Đổi sang `?as=doctor-c` → ký → **2/2**. |
| 1:15–1:35 **Bản thử: mạng Tide chặn sai người, sai hồ sơ** | "Kể cả khi quyền và bản mã bị lộ, mạng Tide vẫn từ chối bác sĩ D, và quyền đọc MED-204 không mở được MED-205. Máy chủ cũng không tự ký thay ai được." | `/proof?as=doctor-d` → bảng các phép thử (D1 dùng quyền của A → từ chối). |
| 1:35–1:50 **Mở khẩn cấp** | "Khi không chờ được, bác sĩ trực mở ngay những hồ sơ bệnh nhân đã cho phép từ trước. Mọi bên được báo, hai người rà soát trong 72 giờ." | `?as=doctor-a` → **Mở khẩn cấp** ở thẻ danh sách thuốc. Rồi `/approve?as=doctor-b` → tab **Mở khẩn cấp**. |
| 1:50–2:00 **Điều gì thay đổi** | "Bệnh nhân cho đội cấp cứu thấy điều quan trọng mà không lộ mọi thứ. Không admin, server hay AI nào tự mở được hồ sơ một mình." | Quay lại trang bệnh nhân. Logo LifeKey. |

## Ghi chú trung thực cho video

Bản xem trước dùng dữ liệu mẫu và không kết nối mạng Tide. Nên nói một câu ngắn ở cuối hoặc ghi chữ trên màn hình:

> "TideCloak đã được tích hợp và khởi tạo thật (realm, licence, 5 tài khoản demo). Hôm 22/10 mạng ORK của Tide lỗi (chỉ 6 trên 20 node phản hồi) nên chúng tôi quay luồng duyệt ở chế độ xem trước."

Nếu có thể, chèn 5–10 giây quay màn hình lỗi "Could not reach enough NEW ORKs (got 6 of 20 required)" làm bằng chứng.

## Nén video cho dưới 100 MB

```bash
ffmpeg -i demo-raw.mov -vf "scale=1280:-2" -c:v libx264 -crf 28 -preset veryfast -c:a aac -b:a 96k docs/demo.mp4
```

Không có ffmpeg: macOS QuickTime → File → Export As → 720p cũng thường dưới 100 MB cho 2 phút.
