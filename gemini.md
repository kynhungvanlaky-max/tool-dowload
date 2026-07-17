# Hướng dẫn Phát triển & Bảo trì cho Gemini (gemini.md)

Chào Gemini! Đây là tài liệu ghi nhớ cấu trúc, cách thức hoạt động, API và các lưu ý nâng cấp cho dự án **MediaFetch Desktop Downloader** tích hợp Browser Extension.

---

## 1. Cấu trúc Dự án
Dự án bao gồm hai phần chính: **Electron Desktop App** và **Chrome Browser Extension**.

### Desktop App (Electron + Node.js)
- [main.js](file:///d:/Tooldowload/main.js): Entry point của Electron. Quản lý cửa sổ Browser, IPC communication và khởi chạy **Local HTTP Server ở cổng 7788** để nhận link gửi từ Browser Extension. Bổ sung IPC handler `start-album-download` để tải Album hàng loạt ngầm. Tích hợp quản lý gom nhóm tải xuống (`subItemToGroupMap`) và điều hướng cập nhật tiến trình hàng loạt.
- [preload.js](file:///d:/Tooldowload/preload.js): Context Bridge chuyển tiếp các hàm và sự kiện an toàn sang UI, bao gồm sự kiện nhận link ngoài `onExternalLinkReceived` và API tải album `startAlbumDownload`.
- [src/core/downloader.js](file:///d:/Tooldowload/src/core/downloader.js): Điều khiển yt-dlp binary. Tích hợp giải pháp giả lập chữ ký (`impersonate`), cấu hình JS Runtimes của hệ thống (`node`), bypass Cloudflare (`referer`) và tối ưu hóa phân tích video đơn lẻ (`--no-playlist`). Hỗ trợ tải vào thư mục con tùy biến `customDownloadDir` cho Album. Bổ sung cơ chế phân tích nhanh Playlist YouTube (`--flat-playlist`) và nhúng ID3 tag + ảnh bìa bằng FFmpeg. Nhận tham số `forceId` để định danh tải hàng loạt.
- [src/utils/spotifyScraper.js](file:///d:/Tooldowload/src/utils/spotifyScraper.js): Module cào thông tin metadata bài hát/album/playlist Spotify bằng cách giả lập User-Agent của Facebook Crawler (`facebookexternalhit/1.1`) nhằm bypass 100% chặn của Spotify Web Player.
- [src/core/history.js](file:///d:/Tooldowload/src/core/history.js): Đọc/ghi lịch sử tải dạng JSON (`history.json`).
- [src/renderer/](file:///d:/Tooldowload/src/renderer): Giao diện HTML/CSS/JS (Dark mode glassmorphism). Tự động hiển thị danh sách bài hát và cho phép tải trọn bộ Album Spotify về thư mục con riêng biệt. Sửa lỗi layout bị co bẹp thẻ lịch sử bằng `flex-shrink: 0`. Tích hợp vẽ Group Card lịch sử và Toggle trượt mở xem chi tiết các bài hát con.

### Browser Extension (Manifest V3)
- [extension/manifest.json](file:///d:/Tooldowload/extension/manifest.json): Khai báo quyền `webRequest`, `storage`, `tabs` và host permission `<all_urls>`.
- [extension/background.js](file:///d:/Tooldowload/extension/background.js): Lắng nghe `onBeforeRequest` để phát hiện và lọc các đường dẫn media thô (`.m3u8`, `.mp4`...). Đã loại bỏ `.ts` để tránh hiện tượng ngập rác danh sách phân đoạn con. Tích hợp bắt link gốc Spotify Web Player, hiển thị Badge số lượng link bắt được trên icon và dọn dẹp realtime.
- [extension/popup/](file:///d:/Tooldowload/extension/popup): Giao diện popup hiển thị link bắt được của tab hiện tại, hỗ trợ copy nhanh, đổi tên tệp nhanh và gửi link sang cổng 7788 của Desktop App. Tự động kiểm tra và bắt link trang hiện tại khi mở popup (Auto-Capture).

---

## 2. Các lệnh Quản lý Dự án

### Cài đặt thư viện:
```bash
npm install
```

### Chạy chế độ Development:
```bash
npm start
```
*(Lưu ý: Không dùng `npm run dev` vì script khởi chạy mặc định là `npm start`)*

---

## 3. Quy trình Giao tiếp IPC & HTTP APIs

```
[Browser Webpage] 
       │ (Phát video)
       ▼
[Extension Background] ──(Bắt link .m3u8)──► [Popup UI]
                                                 │ (Click gửi link)
                                                 ▼
[Local HTTP Server: 7788] ◄──(POST /receive-link)┘
       │ (Tự động Focus + Show Window)
       ▼ [main.js]
(IPC: 'external-link-received') ──► [preload.js]
                                         │
                                         ▼ [renderer.js]
                                  (Auto Fill URL + Analyze)
```

---

## 4. Các điểm cần Lưu ý khi phát triển tiếp
1. **Quản lý Cổng Local Server**:
   - Hiện tại cổng Local Server cố định là `7788`. Nếu cổng bị chiếm dụng (`EADDRINUSE`), cần viết thêm cơ chế tự động tìm cổng rảnh hoặc báo lỗi thân thiện trên UI.
2. **Nâng cấp FFmpeg**:
   - Đối với các video độ phân giải cực cao (1080p, 4K) trên YouTube bị tách rời hình và tiếng, cần cài đặt/tải thêm `ffmpeg` binary và đưa đường dẫn vào yt-dlp qua tham số `--ffmpeg-location` để yt-dlp tự động merge thành file MP4 hoàn chỉnh.
3. **Cập nhật tự động yt-dlp**:
   - Định kỳ chạy lệnh cập nhật hoặc kiểm tra phiên bản mới của yt-dlp khi khởi chạy app để tránh lỗi phân tích khi các nền tảng (YouTube, TikTok...) cập nhật thuật toán.
4. **Lịch sử gom nhóm (Grouping)**:
   - Các subItems của group có thuộc tính `id` dạng `<groupId>_sub_<index>`. Khi tạm dừng, tiếp tục hoặc hủy, `main.js` cần lặp qua danh sách subItems này để gọi downloader core tương ứng.

</RULE[GEMINI.md]>
