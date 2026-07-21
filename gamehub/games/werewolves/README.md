# Ma Sói Client Server

Ứng dụng dùng Node.js thuần, không cần cài dependency. Server đóng vai Quản Trò: đọc `roles.md`, chia vai ngẫu nhiên, gọi lượt ban đêm theo `Order`, nhận hành động của client và xử lý điều kiện thắng theo `rule.md`.

## Chạy

```bash
npm start
```

Mở trình duyệt tại:

```text
http://localhost:3000
```

Có thể đổi cổng, mã phòng, số người tối thiểu hoặc thời gian thảo luận:

```bash
PORT=4000 ROOM_CODE=SOI2026 MIN_PLAYERS=5 DISCUSSION_MS=60000 npm start
```

Trên PowerShell:

```powershell
$env:PORT=4000
$env:HOST="0.0.0.0"
$env:ROOM_CODE="SOI2026"
$env:MIN_PLAYERS=5
$env:DISCUSSION_MS=60000
npm start
```

Nếu không đặt `ROOM_CODE`, server sẽ tự tạo mã 6 ký tự và in ra console khi khởi động.

## Ngrok

Server mặc định lắng nghe trên `0.0.0.0:3000`, phù hợp để mở tunnel bằng ngrok.

Nếu chưa cấu hình token:

```bash
ngrok config add-authtoken YOUR_NGROK_TOKEN
```

Chạy server ở terminal thứ nhất:

```bash
npm start
```

Chạy tunnel ở terminal thứ hai:

```bash
npm run ngrok
```

Ngrok sẽ trả về URL `https://...ngrok-free.app`; gửi URL đó cho người chơi dùng làm client.
Gửi kèm mã phòng đang in trên console server để client nhập khi tham gia.

## Luồng Chơi

- Người chơi vào phòng bằng mã phòng và tên hiển thị.
- Ở phòng chờ, chỉnh số người chơi và số lượng từng vai trò.
- Khi đủ người và tổng vai khớp số người, bấm `Bắt đầu ván`.
- Server chia ngẫu nhiên bộ vai đã chọn cho client và gửi riêng từng vai.
- Ban đêm, server gọi vai trò theo cột `Order` trong `roles.md`; client bật `Bật TTS` để trình duyệt đọc lời Quản Trò.
- TTS dùng endpoint server `/api/tts`, server proxy audio tiếng Việt từ Google Translate TTS.
- Client chỉ thấy bảng chọn hành động khi tới lượt vai trò của mình.
- Ban ngày, người còn sống bỏ phiếu treo cổ hoặc bỏ qua.
- Server tự xử lý chết trong đêm, treo cổ, hiệu ứng vai trò và điều kiện thắng.
- Nhật ký trong ván chỉ ghi sự kiện công khai như vai đã chọn, người đã bỏ phiếu, kết quả ban ngày/ban đêm; vai trò của từng người chỉ được công bố khi ván kết thúc.

## Vai Trò Đã Xử Lý

- Bảo vệ: bảo vệ một người, không trùng mục tiêu với đêm trước.
- Mẹ trẻ: đêm đầu chọn một người chết theo nếu Mẹ trẻ chết.
- Ma sói và Sói con: cùng chọn nạn nhân; nếu Sói con chết, đêm sau đàn Sói được chọn hai nạn nhân.
- Trưởng giáo phái: chọn người gia nhập; thắng khi toàn bộ người còn sống đã vào Giáo phái.
- Tiên tri: kiểm tra một người có phải Ma sói hay không.
- Nhà tâm thần học: kiểm tra hai người có cùng phe hay không.
- Thợ săn: chọn mục tiêu bị kéo theo nếu Thợ săn chết.
- Phù thủy: có một thuốc cứu và một thuốc giết, mỗi đêm dùng tối đa một bình.
- Dân làng: không có hành động ban đêm, bỏ phiếu ban ngày.
