# Kỹ Năng Tải Media (yt-dlp Downloader Skill)

Tài liệu mô tả kỹ năng nâng cao để tải video và audio từ các URL phức tạp (YouTube, Spotify, CDN phim...) bằng `yt-dlp` trong ứng dụng Node.js & Electron.

---

## 1. Phân Tích Link (Analyze URL)
Lệnh sử dụng để lấy thông tin chi tiết về URL:
```bash
yt-dlp --dump-json --no-playlist --extractor-args "generic:impersonate" --js-runtimes "node" <URL>
```

### Các tùy chọn tối ưu hóa:
- `--no-playlist`: Bắt buộc chỉ phân tích video đơn lẻ ngay cả khi URL đi kèm thông tin danh sách phát (`&list=...`), giúp hiển thị đầy đủ các định dạng chất lượng (1080p, 720p...) của video đó.
- `--extractor-args "generic:impersonate"`: Giả lập TLS fingerprint và chữ ký trình duyệt (Chrome) để vượt qua bộ lọc anti-bot của Cloudflare.
- `--js-runtimes "node"`: Chỉ định rõ sử dụng Node.js làm JS runtime giúp yt-dlp giải mã thành công các thuật toán chữ ký thay đổi của YouTube.

---

## 2. Vượt lỗi HTTP 403 Forbidden (Referer Bypass & Cache Reset)
Một số CDN video (như các CDN phát phim trực tuyến `.m3u8`) yêu cầu kiểm tra nguồn gốc truy cập. Ta cần truyền thêm URL trang web gốc làm `Referer`:
```bash
yt-dlp --referer "<URL_Trang_Gốc>" ...
```
Nếu gặp lỗi `HTTP Error 403: Forbidden` liên tục trên các link YouTube, hãy chạy lệnh xóa bộ nhớ cache chữ ký (signature cache) của `yt-dlp`:
```bash
yt-dlp --rm-cache-dir
```

---

## 3. Tải và Trích xuất thông tin Spotify (Bypass DRM)
Do Spotify sử dụng cơ chế bảo vệ bản quyền số **DRM (Widevine)**, ta không thể tải trực tiếp file từ Spotify. Thay vào đó, ta áp dụng cơ chế **Tìm kiếm & Tải thay thế từ YouTube**:

### A. Cào Metadata tĩnh qua User-Agent giả lập:
Để không bị chặn bởi cơ chế Redirect của Spotify Web Player, ta gửi HTTP request kèm theo User-Agent của **Facebook Crawler**:
```javascript
const ua = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_voiced.html)';
```
Spotify bắt buộc phải trả về mã HTML tĩnh (SSR) chứa cấu trúc bài hát/album/playlist cùng dữ liệu JSON-LD để hiển thị link preview khi share.
* **Lọc chính xác danh sách bài hát**: Chỉ bóc tách các track ID nằm trong thẻ `<meta name="music:song" content="..."/>` ở phần `<head>` để loại bỏ 100% các bài hát đề xuất ngẫu nhiên ở chân trang web.
* **Lấy ảnh bìa riêng của từng bài**: Khi duyệt fetch thông tin chi tiết của từng bài hát con, ta cào thêm trường `og:image` để lấy ảnh Cover Art riêng biệt của chính bài hát đó.

### B. Chuyển đổi và Tải từ YouTube:
Để tải được link Spotify (cả track lẻ và album hàng loạt), ta bắt buộc phải tự động chuyển đổi link Spotify sang chuỗi tìm kiếm trên YouTube trước khi gọi `yt-dlp`:
```javascript
let downloadUrl = url;
if (url.includes('spotify.com')) {
  const spotifyMeta = await scrapeSpotify(url);
  downloadUrl = `ytsearch1:${spotifyMeta.query}`;
}
```
Lệnh tải Audio từ YouTube Music:
```bash
yt-dlp -f bestaudio --extract-audio --audio-format mp3 --audio-quality 0 "ytsearch1:<Tên bài> <Ca sĩ> Official Audio"
```

### C. Tự động nhúng Metadata ID3 Tags & Cover Art bằng FFmpeg:
Để các trình phát nhạc (Media Player) nhận diện được các bài hát thuộc cùng một Album và có đầy đủ thông tin + ảnh bìa riêng lẻ, ta tải ảnh bìa về máy tính làm file tạm và sử dụng `ffmpeg` để nhúng trực tiếp Cover Art và ID3v2.3 tags vào file `.mp3` sau khi tải xong:
```javascript
const ffmpegArgs = [
  '-y',
  '-i', tempPath,            // File audio tạm
  '-i', tempCoverPath,       // File ảnh bìa tạm
  '-map', '0:a',             // Lấy audio từ input thứ 1
  '-map', '1:0',             // Lấy ảnh từ input thứ 2
  '-c:a', 'copy',            // Chỉ sao chép luồng audio (không encode lại, mất 0.1s)
  '-c:v', 'mjpeg',           // Nén ảnh bằng codec mjpeg dành cho MP3 Cover Art
  '-id3v2_version', '3',     // Sử dụng ID3v2.3 (tương thích tốt nhất trên Windows/macOS)
  '-metadata:s:v', 'title=Album cover',
  '-metadata:s:v', 'comment=Cover (front)',
  '-metadata', `title=${metadata.title}`,
  '-metadata', `artist=${metadata.artist}`,
  '-metadata', `album=${metadata.album}`,
  '-metadata', `track=${metadata.track}`, // Số thứ tự bài hát
  actualFilePath             // File output lưu đè
];
const ffmpegProc = spawn('ffmpeg', ffmpegArgs);
```

### D. Quản lý tải Album theo thư mục riêng biệt:
Khi tải toàn bộ Album, ứng dụng sẽ tạo một thư mục con tương ứng trùng tên Album bên trong thư mục downloads:
```javascript
const cleanAlbumTitle = albumTitle.replace(/[\\/:*?"<>|]/g, '_').trim();
const albumDir = path.join(defaultDownloadDir, cleanAlbumTitle);
```
Sau đó, gọi hàm `startDownload` với tham số `customDownloadDir` trỏ về thư mục con này để lưu nhạc gọn gàng.

---

## 4. Chặn bắt link qua Browser Extension
Do trình duyệt sử dụng cơ chế Sandbox và không thể trực tiếp tải file stream lớn hoặc vượt qua các blob URL mã hóa, ta sử dụng **Browser Extension** để chặn bắt các request mạng thực tế (`.m3u8`, `.mp4`...) và gửi thông tin về cổng `7788` của Desktop App:

```js
// Trong background.js của Extension
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Loại bỏ hoàn toàn phân đoạn nhỏ .ts để tránh làm tràn danh sách bắt
    if (details.url.match(/\.(m3u8|mpd|mp4|webm|mp3|m4a)(\?|$)/i)) {
      // Lưu lại link theo tabId và gửi sang Desktop App
    }
  },
  { urls: ["<all_urls>"] }
);
```
Desktop App nhận payload và tự động gán `pageUrl` làm `referer` để bypass 403 Forbidden.
