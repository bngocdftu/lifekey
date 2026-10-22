# Voice-over script (2:00)

Read this while recording `http://localhost:3100/pitch.html?auto=1`. Each block matches one slide
and its length in `public/pitch.html`. Lines are sized for a calm pace (about 2.3 words a second).
The countdown 3-2-1 is not part of the video: start speaking when the title appears.

Tips:
- Record with `Cmd+Shift+5` → **Options** → Microphone: **MacBook Microphone**. Full screen the browser first (`Cmd+Ctrl+F`).
- Do one dry run without recording. If you fall behind, drop the sentence in *(brackets)*.
- The slides say "TideCloak simulated in the browser" on screen, so you do not need to say it.
- Pause slightly when a slide changes. The slides advance by themselves.

---

### 0:00 · Title (5 s)

> This is LifeKey: an emergency medical passport no single person can open.

*Giới thiệu: LifeKey, hộ chiếu y tế cấp cứu mà không một người nào tự mở được.*

### 0:05 · 1 · The possibility (15 s)

> Three a.m. An unconscious patient arrives in the ER. In the first minute, the doctor must know: she takes warfarin, she's allergic to penicillin, and she has a mechanical heart valve.

*3 giờ sáng, bệnh nhân bất tỉnh. Bác sĩ cần biết ngay: thuốc chống đông, dị ứng penicillin, van tim cơ học.*

### 0:20 · 2 · The constraint (15 s)

> Today, whoever runs the server holds the keys. One breach, or one insider, exposes every patient. So hospitals keep detailed records locked away, even in an emergency.

*Hiện nay ai vận hành server là giữ khoá. Một vụ hack hay một người trong nội bộ là lộ hết, nên bệnh viện khoá hồ sơ lại.*

### 0:35 · 3 · How it fits together (11 s)

> In LifeKey, every record is encrypted on its own, and TideCloak decides who may open it: one doctor, one record, for a short time.

*Mỗi hồ sơ được mã hoá riêng; TideCloak quyết định ai được mở: một bác sĩ, một hồ sơ, trong thời gian ngắn.*

### 0:46 · 3 · Sign in (9 s)

> Doctor A signs in with Tide. LifeKey never sees a password or a key, only a token with their roles.

*Bác sĩ A đăng nhập bằng Tide. LifeKey không thấy mật khẩu hay khoá, chỉ nhận token có role.*

### 0:55 · 3 · Scan the QR (9 s)

> Scanning the patient's QR shows the emergency alerts at once. The detailed records stay locked, each one separately.

*Quét QR là thấy ngay cảnh báo cấp cứu. Hồ sơ chi tiết vẫn khoá, từng cái một.*

### 1:04 · 3 · Two approvers (13 s)

> Doctor A asked to read one record. Two approvers must sign, each in their own Tide enclave, and the requester can't approve themselves. Doctor C signs: two of two.

*Bác sĩ A xin đọc một hồ sơ. Cần hai người duyệt ký trong enclave Tide của riêng họ, người xin không tự duyệt được. Bác sĩ C ký: đủ 2/2.*

### 1:17 · 3 · The right doctor (8 s)

> Now Doctor A opens the record. Right person, right record, not expired: allowed.

*Bác sĩ A mở hồ sơ: đúng người, đúng hồ sơ, còn hạn, được phép.*

### 1:25 · 3 · The wrong doctor (8 s)

> Doctor B tries the same record, even though B approved it. Refused. The grant names A only.

*Bác sĩ B thử mở cùng hồ sơ, dù B đã duyệt. Bị từ chối, vì grant chỉ ghi tên A.*

### 1:33 · 3 · Proof (11 s)

> Our proof page runs the attacks: a stolen grant, the wrong record, the server approving on its own. Every one is refused.

*Trang Proof chạy thử các kiểu tấn công: grant bị đánh cắp, sai hồ sơ, server tự duyệt. Tất cả đều bị từ chối.*

### 1:44 · 4 · What changes: the patient (7 s)

> And Alice, the patient, sees exactly who opened her records, and when.

*Bệnh nhân Alice thấy rõ ai đã mở hồ sơ của mình và lúc nào.*

### 1:51 · 4 · What changes (9 s)

> Emergency teams see what matters, and no single admin, server or AI can open a record alone. That's LifeKey.

*Đội cấp cứu thấy điều cần thấy, và không admin, server hay AI nào tự mở được hồ sơ.*

---

**Total: 2:00.** If the take runs long, trim the last second in QuickTime (**Edit → Trim**) before
handing the file over for compression to `docs/demo.mp4`.
