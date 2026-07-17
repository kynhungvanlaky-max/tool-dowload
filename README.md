# MediaFetch Desktop Downloader & Browser Extension

Ứng dụng hỗ trợ tải xuống đa phương tiện (Video, Audio, YouTube Playlist, Spotify Album/Playlist) tốc độ cao trên Desktop, tích hợp tiện ích mở rộng (Browser Extension) tự động bắt liên kết.

---

## 🚀 Tính năng nổi bật
*   **Tải video lẻ / YouTube Playlist**: Hỗ trợ nhiều độ phân giải, tự động trộn hình ảnh và âm thanh chất lượng cao bằng engine `yt-dlp`.
*   **Tải trọn bộ Spotify Album / Playlist**: Tự động quét metadata bài hát, tìm kiếm bản thu âm tốt nhất trên YouTube, tải về dạng nhạc MP3 chất lượng cao.
*   **Tự động nhúng Tag ID3 & Ảnh bìa**: Sử dụng `FFmpeg` để ghi tên bài hát, ca sĩ, tên album, số thứ tự track và nhúng trực tiếp Cover Art vào file nhạc.
*   **Browser Extension Helper**: Tự động theo dõi các luồng media (m3u8, mp4...) và nhạc trên trình duyệt, gửi trực tiếp sang ứng dụng Desktop chỉ bằng 1-Click.
*   **Hàng đợi tải thông minh**: Tải song song với số lượng luồng cấu hình được (`concurrentLimit`), tránh quá tải đĩa và mạng.
*   **Bộ nhớ đệm thông minh & Tối ưu I/O**: Hạn chế ghi đĩa liên tục giúp ứng dụng mượt mà không bị treo khi tải album hàng trăm bài hát.

---

## 🛠️ Yêu cầu hệ thống
1.  **Node.js** (Khuyên dùng v18 hoặc mới hơn).
2.  **FFmpeg**: Cần có sẵn trong biến môi trường `PATH` của hệ thống để nhúng ảnh bìa và gộp video/audio chất lượng cao.

---

## ⚙️ Hướng dẫn cài đặt & Chạy Development

### 1. Cài đặt và chạy ứng dụng Desktop
Mở terminal tại thư mục gốc của dự án và chạy các lệnh sau:

```bash
# Cài đặt các thư viện Node.js phụ thuộc
npm install

# Khởi chạy ứng dụng Electron ở chế độ Development
npm start
```
*Lưu ý: Ứng dụng Desktop sẽ khởi tạo một Local Server chạy ngầm ở cổng `7788` để nhận dữ liệu đẩy từ Extension.*

### 2. Cài đặt Browser Extension (MediaFetch Helper)
1.  Mở trình duyệt Google Chrome (hoặc Edge/Opera).
2.  Truy cập vào trang quản lý tiện ích: `chrome://extensions/`
3.  Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên cùng bên phải.
4.  Nhấp vào nút **Load unpacked** (Tải tiện ích đã giải nén) ở góc trên bên trái.
5.  Trỏ và chọn thư mục `extension` nằm trong thư mục dự án này (`D:\Tooldowload\extension`).

---

## 📦 Đóng gói & Phát hành (Build Production)

### 1. Đóng gói ứng dụng Desktop sang file `.exe`
Chúng tôi sử dụng `electron-builder` để đóng gói ứng dụng. Chạy lệnh sau tại thư mục gốc:
```bash
npm run dist
```
Sau khi hoàn thành, file cài đặt cài đặt `.exe` sẽ nằm trong thư mục `dist/`.

### 2. Đóng gói Extension sang file `.zip` để chia sẻ
Chạy script PowerShell kiểm tra và tự động đóng gói sẵn có trong thư mục `extension/`:
```powershell
cd extension
powershell -ExecutionPolicy Bypass -File pack-extension.ps1
```
Tệp tin nén `MediaFetch-Extension-v[Phiên bản].zip` sẽ được tạo ra ở thư mục gốc của dự án.

---

## 🤝 Hướng dẫn sử dụng
1.  Bật ứng dụng Desktop và giữ cho app chạy.
2.  Khi bạn lướt web trên Chrome (ví dụ: nghe nhạc trên Spotify Web Player), icon Extension sẽ hiển thị số lượng link đã bắt được.
3.  Click vào icon Extension -> nhấn nút **Gửi sang Desktop App (Mũi tên)**.
4.  Ứng dụng Desktop sẽ tự động nhận link, phân tích metadata và bắt đầu tải xuống theo cấu hình hàng đợi song song.
