# Tổng quan dự án: MediaFetch Desktop Downloader & Browser Extension
- **Công nghệ**: Electron, Node.js, yt-dlp-wrap, fluent-ffmpeg, Chrome Extension (Manifest V3)
- **Kiến trúc hiện tại**:
  - **Desktop App (Electron)**: Gồm `main.js` (main process), `preload.js` (bridge), `src/renderer/` (UI), `src/core/` (business logic: downloader, settings, history, failed), `src/utils/` (spotifyScraper)
  - **Browser Extension**: Thư mục `extension/` với background.js, content.js, popup/ — tự động bắt link media từ trình duyệt và gửi về Desktop App qua local server cổng 7788
  - **Cơ chế tải**: Hàng đợi thông minh, tải song song (concurrentLimit), cache I/O, nhúng ID3 tag & cover art bằng FFmpeg

# Trạng thái hiện tại (Cập nhật ngày 18/07/2026):
- **Đã hoàn thành**:
  - Thiết kế và triển khai toàn bộ ứng dụng Desktop Electron với các chức năng tải video/audio, YouTube Playlist, Spotify Album/Playlist
  - Tích hợp Browser Extension tự động bắt link media (m3u8, mp4, audio) và gửi sang Desktop App
  - Đóng gói thành công file cài đặt `.exe` (phiên bản 1.0.0) tại `dist/electron-downloader Setup 1.0.0.exe`
  - Script đóng gói Extension (`pack-extension.ps1`) và kiểm tra Extension (`check-ext.js`)
  - Hệ thống settings, history, failed downloads
- **Lỗi đang gặp phải / Chức năng đang làm dở**:
  - Đang trong quá trình phát triển và tối ưu — chưa có lỗi nghiêm trọng được ghi nhận tại thời điểm này

# Các file quan trọng cần chú ý:
- `main.js`: Khởi tạo cửa sổ Electron, local server (cổng 7788), xử lý IPC
- `preload.js`: Cầu nối giữa main process và renderer process (contextBridge)
- `src/core/downloader.js`: Engine tải chính — xử lý yt-dlp, hàng đợi, tải song song
- `src/core/settings.js`: Quản lý cấu hình người dùng (concurrentLimit, thư mục đích...)
- `src/core/history.js`: Lịch sử tải xuống
- `src/core/failed.js`: Quản lý các tác vụ tải thất bại
- `src/utils/spotifyScraper.js`: Scraper Spotify — lấy metadata album/playlist, tìm kiếm trên YouTube
- `src/renderer/renderer.js`: Logic giao diện người dùng (tab tải, settings, history)
- `src/renderer/index.html` / `index.css`: Giao diện chính
- `extension/background.js`: Service Worker của Extension — bắt link, giao tiếp với Desktop App
- `extension/content.js`: Content script — inject vào trang web để phát hiện media
- `extension/popup/popup.js` / `popup.html` / `popup.css`: Popup UI của Extension
- `extension/manifest.json`: Cấu hình Extension (Manifest V3)
- `package.json`: Cấu hình dự án, dependencies (electron, yt-dlp-wrap, fluent-ffmpeg)