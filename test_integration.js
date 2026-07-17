const path = require('path');
const fs = require('fs');
const Downloader = require('./src/core/downloader');
const HistoryManager = require('./src/core/history');

const testDownloadDir = path.join(__dirname, 'Downloads_Test');
const testHistoryFile = path.join(__dirname, 'history_test.json');

// Khởi tạo dọn dẹp môi trường test
if (!fs.existsSync(testDownloadDir)) {
  fs.mkdirSync(testDownloadDir, { recursive: true });
}
if (fs.existsSync(testHistoryFile)) {
  fs.unlinkSync(testHistoryFile);
}

const historyManager = new HistoryManager(testHistoryFile);
const downloader = new Downloader(testDownloadDir, historyManager, (channel, data) => {
  console.log(`[IPC Event -> ${channel}]:`, data);
});

const spotifyAlbumUrl = 'https://open.spotify.com/album/7v2npwwKr1kRyq1kN7OEtp?si=bBywGQlKSj-NtMYHjsiXPQ';

async function runTest() {
  try {
    console.log('--- BẮT ĐẦU TEST TÍCH HỢP ---');
    
    // 1. Khởi tạo binary yt-dlp
    console.log('\n[TEST 1] Khởi tạo Engine yt-dlp...');
    await downloader.initBinary();
    console.log('Engine yt-dlp đã sẵn sàng.');

    // 2. Phân tích link Spotify Album
    console.log(`\n[TEST 2] Phân tích link Spotify Album: ${spotifyAlbumUrl}`);
    const result = await downloader.analyze(spotifyAlbumUrl);
    
    if (result.success && result.isAlbum) {
      console.log('Phân tích Album THÀNH CÔNG!');
      console.log('Tên Album:', result.title);
      console.log('Nghệ sĩ:', result.artist);
      console.log('Số lượng track con tìm thấy:', result.tracks.length);
      
      // 3. Test tải thử 1 bài hát đầu tiên trong Album vào folder Album riêng
      const firstTrack = result.tracks[0];
      console.log(`\n[TEST 3] Tải thử bài hát đầu tiên: "${firstTrack.title} - ${firstTrack.artist}"`);
      
      // Tạo đường dẫn folder Album con
      const cleanAlbumTitle = result.title.replace(/[\\/:*?"<>|]/g, '_').trim();
      const albumSubDir = path.join(testDownloadDir, cleanAlbumTitle);
      
      console.log('Đường dẫn thư mục lưu Album test:', albumSubDir);
      
      const queryUrl = `ytsearch1:${firstTrack.query}`;
      const downloadResult = downloader.startDownload(
        queryUrl, 
        'bestaudio', 
        true, 
        `${firstTrack.title} - ${firstTrack.artist}`, 
        result.thumbnail, 
        '', 
        albumSubDir
      );
      
      console.log('Bắt đầu tải, ID tiến trình:', downloadResult.id);
      
      // Chờ 10 giây để xem log tải tiến trình từ yt-dlp
      console.log('Đang chờ 10 giây để theo dõi tiến trình tải...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Kiểm tra xem folder con và file part có được sinh ra không
      if (fs.existsSync(albumSubDir)) {
        console.log(`\n[TEST THÀNH CÔNG] Thư mục Album đã được tạo: ${albumSubDir}`);
        const files = fs.readdirSync(albumSubDir);
        console.log('Các file trong thư mục Album con:', files);
        if (files.length > 0) {
          console.log('=> Cơ chế tải vào thư mục Album con HOẠT ĐỘNG HOÀN HẢO!');
        } else {
          console.log('=> Thư mục trống, có thể tiến trình tải đang bắt đầu chậm.');
        }
      } else {
        console.log('\n[TEST THẤT BẠI] Thư mục Album con chưa được tạo!');
      }

      // Hủy tải sau khi test xong
      console.log('\n[TEST 4] Hủy tiến trình tải thử nghiệm để dọn dẹp...');
      downloader.cancelDownload(downloadResult.id);
      console.log('Đã hủy tải.');
    } else {
      console.log('Phân tích Album THẤT BẠI:', result.error || 'Không nhận diện được Album');
    }
  } catch (err) {
    console.error('LỖI TEST TÍCH HỢP:', err);
  } finally {
    // Dọn dẹp
    console.log('\n--- DỌN DẸP SAU TEST ---');
    try {
      if (fs.existsSync(testHistoryFile)) {
        fs.unlinkSync(testHistoryFile);
      }
      // Xóa folder test
      if (fs.existsSync(testDownloadDir)) {
        fs.rmSync(testDownloadDir, { recursive: true, force: true });
      }
      console.log('Dọn dẹp hoàn tất. Thoát test.');
    } catch (e) {
      console.error('Lỗi khi dọn dẹp:', e.message);
    }
  }
}

runTest();
