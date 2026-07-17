const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { EventEmitter } = require('events');

/**
 * Helper tải tệp tin từ internet (dành cho tải Cover Art ảnh bìa và các chunk video)
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      };

      https.get(options, (response) => {
        // Xử lý redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          downloadFile(response.headers.location, dest).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Tải tệp lỗi: HTTP ${response.statusCode}`));
          return;
        }

        const file = fs.createWriteStream(dest);
        response.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve(dest));
        });
      }).on('error', (err) => {
        try {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
        } catch (e) {}
        reject(err);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Phát hiện phần số tăng dần trong URL phân đoạn .ts
function detectTsPattern(url) {
  const regex = /(\d+)\.ts(\?|$)/i;
  const match = url.match(regex);
  if (!match) return null;
  
  const fullMatch = match[0]; // ví dụ: "1.ts" hoặc "001.ts" hoặc "01.ts?"
  
  // Lấy chính xác phần số và phần đuôi ".ts" (loại trừ ký tự "?" nếu có)
  const dotTsIndex = fullMatch.toLowerCase().indexOf('.ts');
  const numberStr = fullMatch.substring(0, dotTsIndex);
  
  const index = match.index; // vị trí bắt đầu khớp của regex
  
  return {
    prefix: url.substring(0, index),
    suffix: url.substring(index + dotTsIndex + 3), // +3 để bỏ qua ".ts"
    startNum: parseInt(numberStr, 10),
    padLength: numberStr.length,
    originalNumStr: numberStr
  };
}

class Downloader extends EventEmitter {
  constructor(downloadDir, historyManager, emitToRenderer, settingsManager = null) {
    super();
    this.downloadDir = downloadDir;
    this.historyManager = historyManager;
    this.emitToRenderer = emitToRenderer;
    this.settingsManager = settingsManager;
    this.activeDownloads = new Map(); // id -> process
    
    // Thư mục chứa binaries trong AppData
    this.binDir = path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + '/.config'), 'MediaFetch', 'bin');
    if (!fs.existsSync(this.binDir)) {
      fs.mkdirSync(this.binDir, { recursive: true });
    }

    this.ytDlpPath = path.join(this.binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  }

  // Tải yt-dlp binary từ Github release nếu chưa có
  async initBinary() {
    // Kiểm tra FFmpeg có trong PATH không (một lần duy nhất khi khởi động)
    await this._checkFfmpeg();

    if (fs.existsSync(this.ytDlpPath)) {
      console.log('yt-dlp binary đã tồn tại:', this.ytDlpPath);
      return;
    }

    const downloadUrl = process.platform === 'win32' 
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

    console.log(`Đang tải yt-dlp từ ${downloadUrl}...`);
    this.emitToRenderer('binary-status', { status: 'downloading', message: 'Đang tải engine yt-dlp...' });

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(this.ytDlpPath);
      
      const request = (url) => {
        https.get(url, (response) => {
          if (response.statusCode === 302 || response.statusCode === 301) {
            // Chuyển hướng
            request(response.headers.location);
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Tải yt-dlp thất bại. Status code: ${response.statusCode}`));
            return;
          }

          response.pipe(file);

          file.on('finish', () => {
            file.close();
            // Cấp quyền thực thi nếu là Unix
            if (process.platform !== 'win32') {
              fs.chmodSync(this.ytDlpPath, '755');
            }
            console.log('Tải yt-dlp hoàn tất.');
            this.emitToRenderer('binary-status', { status: 'ready', message: 'Engine yt-dlp đã sẵn sàng.' });
            resolve();
          });
        }).on('error', (err) => {
          fs.unlink(this.ytDlpPath, () => {});
          this.emitToRenderer('binary-status', { status: 'error', message: 'Tải engine yt-dlp lỗi: ' + err.message });
          reject(err);
        });
      };

      request(downloadUrl);
    });
  }

  // Kiểm tra FFmpeg có trong PATH không
  async _checkFfmpeg() {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      exec('ffmpeg -version', { timeout: 5000 }, (error) => {
        if (error) {
          this.ffmpegAvailable = false;
          console.warn('[MediaFetch] FFmpeg không tìm thấy trong PATH.');
          console.warn('[MediaFetch] Nhúng ID3 tag và ảnh bìa album sẽ bị bỏ qua.');
          this.emitToRenderer('binary-status', {
            status: 'error',
            message: '⚠️ FFmpeg chưa được cài đặt! Tải nhạc sẽ thiếu ảnh bìa và ID3 tag. Tải FFmpeg tại: https://ffmpeg.org/download.html'
          });
        } else {
          this.ffmpegAvailable = true;
          console.log('[MediaFetch] FFmpeg đã sẵn sàng trong PATH.');
        }
        resolve();
      });
    });
  }

  // Phân tích thông tin formats của 1 video con trong Playlist YouTube
  analyzeSingleVideoForPlaylist(url) {
    return new Promise((resolve, reject) => {
      const args = [
        '--dump-json',
        '--no-playlist',
        '--extractor-args', 'generic:impersonate',
        '--js-runtimes', 'node',
        url
      ];
      const proc = spawn(this.ytDlpPath, args, { env: process.env });
      
      let stdoutData = '';
      let stderrData = '';

      proc.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(stderrData.trim() || `Exit code ${code}`));
        }

        try {
          const info = JSON.parse(stdoutData.split('\n')[0]);
          const formats = [];
          if (info.formats) {
            info.formats.forEach(f => {
              const hasVideo = f.vcodec !== 'none';
              const hasAudio = f.acodec !== 'none';
              
              let typeLabel = '';
              if (hasVideo && hasAudio) typeLabel = 'Video + Audio';
              else if (hasVideo) typeLabel = 'Chỉ Video';
              else if (hasAudio) typeLabel = 'Chỉ Audio';

              let sizeStr = f.filesize ? `${(f.filesize / (1024 * 1024)).toFixed(1)} MB` : 'N/A';
              if (!f.filesize && f.filesize_approx) {
                sizeStr = `~${(f.filesize_approx / (1024 * 1024)).toFixed(1)} MB`;
              }

              formats.push({
                formatId: f.format_id,
                ext: f.ext,
                resolution: f.resolution || (f.height ? `${f.height}p` : 'N/A'),
                fps: f.fps || '',
                size: sizeStr,
                type: typeLabel,
                hasVideo,
                hasAudio,
                quality: f.format_note || ''
              });
            });
          }
          resolve({
            title: info.title,
            thumbnail: info.thumbnail,
            formats: formats.reverse()
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  // Phân tích URL bằng yt-dlp
  analyze(url, referer = '') {
    return new Promise(async (resolve, reject) => {
      if (!fs.existsSync(this.ytDlpPath)) {
        return reject(new Error('Engine tải xuống chưa sẵn sàng. Vui lòng đợi trong giây lát.'));
      }

      // Kiểm tra xem có phải link phân đoạn .ts thô hay không
      const isSegmentedTs = url.includes('.ts') && !url.includes('.m3u8');
      if (isSegmentedTs) {
        const pattern = detectTsPattern(url);
        if (pattern) {
          return resolve({
            success: true,
            title: 'Video Phân đoạn (' + pattern.originalNumStr + '.ts)',
            thumbnail: '',
            duration: 'Không xác định',
            channel: 'Website Stream',
            formats: [
              { formatId: 'segmented_ts', resolution: 'Gốc (Nối các mảnh)', ext: 'mp4', size: 'Tính toán sau', type: 'Video + Audio', hasVideo: true, hasAudio: true }
            ]
          });
        }
      }

      // 1. Kiểm tra link Spotify
      let isSpotifyTrack = false;
      let spotifyMeta = null;

      if (url.includes('spotify.com')) {
        try {
          const { scrapeSpotify } = require('../utils/spotifyScraper');
          spotifyMeta = await scrapeSpotify(url);
          
          if (spotifyMeta.type === 'album') {
            return resolve({
              success: true,
              isAlbum: true,
              isPlaylist: false,
              title: spotifyMeta.title.replace(/ - Album by.*$/i, '').trim(),
              artist: spotifyMeta.artist,
              thumbnail: spotifyMeta.image,
              tracks: spotifyMeta.tracks
            });
          } else {
            isSpotifyTrack = true;
            url = `ytsearch1:${spotifyMeta.query}`;
            referer = '';
          }
        } catch (err) {
          return reject(new Error('Không thể phân tích link Spotify: ' + err.message));
        }
      }

      // 2. Kiểm tra link YouTube Playlist
      const isYoutubePlaylist = url.includes('youtube.com/playlist') || url.includes('youtu.be/playlist') || (url.includes('youtube.com/') && url.includes('list=') && !url.includes('watch?v='));
      
      console.log('Đang phân tích URL:', url, 'Referer:', referer);
      
      const args = [
        '--dump-json',
        isYoutubePlaylist ? '--flat-playlist' : '--no-playlist',
        '--extractor-args', 'generic:impersonate',
        '--js-runtimes', 'node'
      ];

      if (referer) {
        args.push('--referer', referer);
      }

      args.push(url);

      const proc = spawn(this.ytDlpPath, args, { env: process.env });
      
      let stdoutData = '';
      let stderrData = '';

      proc.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      proc.on('close', async (code) => {
        if (code !== 0) {
          console.error('Lỗi phân tích URL:', stderrData);
          return reject(new Error(stderrData.trim() || `yt-dlp exit code ${code}`));
        }

        try {
          const lines = stdoutData.split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('{'));
          
          if (lines.length === 0) {
            throw new Error('Không tìm thấy dữ liệu cấu trúc JSON hợp lệ.');
          }

          if (isYoutubePlaylist) {
            // Xử lý YouTube Playlist
            const entries = lines.map(line => JSON.parse(line));
            const firstEntry = entries[0];
            
            const playlistTitle = firstEntry.playlist_title || firstEntry.playlist || 'Danh sách phát YouTube';
            const playlistUploader = firstEntry.playlist_uploader || firstEntry.uploader || 'N/A';
            
            let playlistThumb = '';
            if (firstEntry.thumbnails && firstEntry.thumbnails.length > 0) {
              playlistThumb = firstEntry.thumbnails[firstEntry.thumbnails.length - 1].url;
            }

            console.log(`Đang cào chi tiết định dạng formats cho ${entries.length} video trong playlist...`);
            this.emitToRenderer('binary-status', { status: 'downloading', message: `Đang phân tích định dạng của ${entries.length} video con...` });

            const tracks = [];
            // Phân tích song song theo lô 5 video một lúc để tối ưu tốc độ
            const batchSize = 5;
            for (let i = 0; i < entries.length; i += batchSize) {
              const batch = entries.slice(i, i + batchSize);
              const promises = batch.map(async (entry) => {
                try {
                  const videoUrl = entry.url || entry.webpage_url;
                  const videoInfo = await this.analyzeSingleVideoForPlaylist(videoUrl);
                  return {
                    title: entry.title || videoInfo.title || 'Video không tên',
                    artist: entry.uploader || entry.channel || 'N/A',
                    url: videoUrl,
                    thumbnail: videoInfo.thumbnail || (entry.thumbnails && entry.thumbnails.length ? entry.thumbnails[entry.thumbnails.length-1].url : ''),
                    formats: videoInfo.formats,
                    query: entry.title
                  };
                } catch (e) {
                  console.error(`Không thể phân tích formats cho video ${entry.id}:`, e.message);
                  // Dự phòng nếu lỗi phân tích formats chi tiết
                  return {
                    title: entry.title || 'Video không tên',
                    artist: entry.uploader || entry.channel || 'N/A',
                    url: entry.url || entry.webpage_url,
                    thumbnail: (entry.thumbnails && entry.thumbnails.length ? entry.thumbnails[entry.thumbnails.length-1].url : ''),
                    formats: [
                      { formatId: 'bestvideo+bestaudio/best', resolution: 'Cao nhất', ext: 'mp4', size: 'N/A', type: 'Video + Audio', hasVideo: true },
                      { formatId: 'bestaudio', resolution: 'Chỉ Audio', ext: 'mp3', size: 'N/A', type: 'Chỉ Audio', hasVideo: false }
                    ],
                    query: entry.title
                  };
                }
              });

              const results = await Promise.all(promises);
              results.forEach(r => {
                if (r) tracks.push(r);
              });
            }

            this.emitToRenderer('binary-status', { status: 'ready', message: 'Phân tích playlist hoàn tất.' });

            return resolve({
              success: true,
              isAlbum: true,
              isPlaylist: true,
              title: playlistTitle,
              artist: playlistUploader,
              thumbnail: playlistThumb,
              tracks: tracks
            });
          } else {
            // Xử lý Video/Audio đơn lẻ
            const info = JSON.parse(lines[0]);
            
            // Lọc các format tiện ích
            const formats = [];
            if (info.formats) {
              info.formats.forEach(f => {
                const hasVideo = f.vcodec !== 'none';
                const hasAudio = f.acodec !== 'none';
                
                let typeLabel = '';
                if (hasVideo && hasAudio) typeLabel = 'Video + Audio';
                else if (hasVideo) typeLabel = 'Chỉ Video';
                else if (hasAudio) typeLabel = 'Chỉ Audio';

                let sizeStr = f.filesize ? `${(f.filesize / (1024 * 1024)).toFixed(1)} MB` : 'N/A';
                if (!f.filesize && f.filesize_approx) {
                  sizeStr = `~${(f.filesize_approx / (1024 * 1024)).toFixed(1)} MB`;
                }

                formats.push({
                  formatId: f.format_id,
                  ext: f.ext,
                  resolution: f.resolution || (f.height ? `${f.height}p` : 'N/A'),
                  fps: f.fps || '',
                  vcodec: f.vcodec,
                  acodec: f.acodec,
                  size: sizeStr,
                  type: typeLabel,
                  hasVideo,
                  hasAudio,
                  quality: f.format_note || ''
                });
              });
            }

            resolve({
              success: true,
              title: isSpotifyTrack ? spotifyMeta.title : (info.title || 'Video tải xuống'),
              thumbnail: isSpotifyTrack ? spotifyMeta.image : (info.thumbnail || ''),
              duration: info.duration ? this.formatDuration(info.duration) : 'N/A',
              channel: isSpotifyTrack ? spotifyMeta.artist : (info.uploader || info.channel || 'N/A'),
              formats: formats.reverse()
            });
          }
        } catch (e) {
          reject(new Error('Lỗi phân tích thông tin trả về: ' + e.message));
        }
      });
    });
  }

  // Tải và ghép video phân đoạn thô (.ts)
  async startSegmentedTsDownload(id, url, pattern, title, thumbnail, referer, customDownloadDir, forceId = null) {
    const cleanTitle = title.replace(/[\\/:*?"<>|]/g, '_');
    const targetDir = customDownloadDir || this.downloadDir;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const outputFilePath = path.join(targetDir, `${cleanTitle}.mp4`);
    const tempDir = path.join(this.binDir, `temp_ts_${id}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const downloadItem = {
      id,
      url: url,
      title,
      thumbnail: thumbnail || '',
      formatId: 'segmented_ts',
      filePath: outputFilePath,
      status: 'downloading',
      progress: 0,
      speed: 'Tải phân đoạn...',
      eta: 'Đang kết nối...',
      size: 'Đang tải...',
      date: new Date().toLocaleString(),
      referer: referer,
      metadata: null
    };

    // Chỉ thêm vào history khi là tải lẻ thông thường.
    if (!forceId) {
      this.historyManager.addItem(downloadItem);
    }
    this.emitToRenderer('download-progress', { id, progress: 1, speed: 'Đang tải...', eta: 'Đang tải...' });

    // Khởi chạy tác vụ tải ngầm
    (async () => {
      try {
        const fileNames = [];
        let currentNum = pattern.startNum;
        let consecutiveErrors = 0;
        const maxErrors = 3; // dừng khi lỗi liên tiếp 3 mảnh

        while (consecutiveErrors < maxErrors) {
          const chunkNumStr = String(currentNum).padStart(pattern.padLength, '0');
          const chunkUrl = pattern.prefix + chunkNumStr + '.ts' + pattern.suffix;
          const chunkFileName = `${String(currentNum).padStart(6, '0')}.ts`;
          const chunkFilePath = path.join(tempDir, chunkFileName);

          try {
            console.log(`Đang tải mảnh: ${chunkUrl}`);
            await downloadFile(chunkUrl, chunkFilePath);
            fileNames.push(chunkFileName);
            consecutiveErrors = 0;
            
            // Cập nhật tiến trình giả lập
            const progress = Math.min(90, 5 + (fileNames.length * 2));
            this.emitToRenderer('download-progress', { 
              id, 
              progress, 
              speed: `Tải mảnh ${fileNames.length}`, 
              eta: 'Đang tải...' 
            });
          } catch (err) {
            console.warn(`Lỗi tải mảnh ${currentNum}:`, err.message);
            consecutiveErrors++;
          }
          currentNum++;
        }

        if (fileNames.length === 0) {
          throw new Error('Không tải được mảnh video nào.');
        }

        // Tạo file concat.txt cho ffmpeg
        const concatFilePath = path.join(tempDir, 'concat.txt');
        const concatContent = fileNames.map(f => `file '${f}'`).join('\n');
        fs.writeFileSync(concatFilePath, concatContent);

        this.emitToRenderer('download-progress', { id, progress: 95, speed: 'Đang ghép video...', eta: 'Chờ ghép...' });

        // Gọi ffmpeg ghép lại
        const ffmpegArgs = [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', concatFilePath,
          '-c', 'copy',
          outputFilePath
        ];

        console.log('ffmpeg args:', ffmpegArgs);
        const ffmpegProc = spawn('ffmpeg', ffmpegArgs);
        
        ffmpegProc.on('close', (code) => {
          // Dọn dẹp tệp tạm
          try {
            fileNames.forEach(f => {
              const p = path.join(tempDir, f);
              if (fs.existsSync(p)) fs.unlinkSync(p);
            });
            if (fs.existsSync(concatFilePath)) fs.unlinkSync(concatFilePath);
            if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
          } catch(e) {}

          if (code === 0) {
            const update = {
              status: 'completed',
              progress: 100,
              speed: '0 KB/s',
              eta: '00:00',
              filePath: outputFilePath
            };
            if (!forceId) this.historyManager.updateItem(id, update);
            this.emitToRenderer('download-complete', { id, filePath: outputFilePath });
          } else {
            const update = { status: 'error', progress: 0, speed: '0 KB/s', eta: 'Lỗi ghép' };
            if (!forceId) this.historyManager.updateItem(id, update);
            this.emitToRenderer('download-error', { id, error: 'Lỗi ghép video phân đoạn' });
          }
        });

      } catch (err) {
        try {
          if (fs.existsSync(tempDir)) {
            fs.rmdirSync(tempDir, { recursive: true });
          }
        } catch(e) {}
        const update = { status: 'error', progress: 0, speed: '0 KB/s', eta: 'Lỗi' };
        if (!forceId) this.historyManager.updateItem(id, update);
        this.emitToRenderer('download-error', { id, error: err.message });
      }
    })();

    return { success: true, id };
  }

  // Tải xuống (Hỗ trợ customDownloadDir và metadata ID3 tag kèm Cover Art)
  // forceId: nếu được truyền vào (ví dụ: subItemId của group), dùng làm id thay vì sinh mới
  async startDownload(url, formatId, isAudio, title, thumbnail, referer = '', customDownloadDir = '', metadata = null, forceId = null) {
    const id = forceId || Date.now().toString();

    // 1. Kiểm tra xem có phải link phân đoạn .ts thô hay không
    const isSegmentedTs = url.includes('.ts') && !url.includes('.m3u8');
    if (isSegmentedTs) {
      const pattern = detectTsPattern(url);
      if (pattern) {
        return this.startSegmentedTsDownload(id, url, pattern, title, thumbnail, referer, customDownloadDir, forceId);
      }
    }
    
    // Nếu là link Spotify đơn lẻ gửi trực tiếp từ Renderer, ta cào và đổi sang tìm kiếm YouTube
    let downloadUrl = url;
    if (url.includes('spotify.com')) {
      try {
        const { scrapeSpotify } = require('../utils/spotifyScraper');
        const spotifyMeta = await scrapeSpotify(url);
        downloadUrl = `ytsearch1:${spotifyMeta.query}`;
        
        if (!metadata) {
          metadata = {
            title: spotifyMeta.title,
            artist: spotifyMeta.artist,
            album: spotifyMeta.title + ' - Single',
            thumbnail: spotifyMeta.image
          };
        }
        if (!thumbnail) {
          thumbnail = spotifyMeta.image;
        }
        title = `${spotifyMeta.title} - ${spotifyMeta.artist}`;
      } catch (err) {
        console.error('Không thể trích xuất metadata Spotify khi tải bài lẻ:', err);
        downloadUrl = `ytsearch1:${title}`;
      }
    }

    const cleanTitle = title.replace(/[\\/:*?"<>|]/g, '_');
    
    const targetDir = customDownloadDir || this.downloadDir;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const ext = isAudio ? 'mp3' : 'mp4';
    const outputFileName = `${cleanTitle}.${ext}`;
    const outputFilePath = path.join(targetDir, outputFileName);

    let args = [];
    let rateLimit = 'infinite';
    if (this.settingsManager) {
      rateLimit = this.settingsManager.getSettings().rateLimit || 'infinite';
    }
    
    if (isAudio) {
      args = [
        '-f', formatId || 'bestaudio',
        '--extract-audio',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--extractor-args', 'generic:impersonate',
        '--js-runtimes', 'node'
      ];
      if (rateLimit !== 'infinite') {
        args.push('--limit-rate', rateLimit);
      }
      if (referer) {
        args.push('--referer', referer);
      }
      args.push('-o', path.join(targetDir, `${cleanTitle}.%(ext)s`), downloadUrl);
    } else {
      const formatSelection = formatId ? `${formatId}+bestaudio/best` : 'best';
      args = [
        '-f', formatSelection,
        '--extractor-args', 'generic:impersonate',
        '--js-runtimes', 'node'
      ];
      if (rateLimit !== 'infinite') {
        args.push('--limit-rate', rateLimit);
      }
      if (referer) {
        args.push('--referer', referer);
      }
      args.push('-o', path.join(targetDir, `${cleanTitle}.%(ext)s`), downloadUrl);
    }

    console.log('Chạy lệnh yt-dlp với args:', args);
    const proc = spawn(this.ytDlpPath, args, { env: process.env });
    
    const downloadItem = {
      id,
      url: url,
      title,
      thumbnail,
      formatId,
      filePath: outputFilePath,
      status: 'downloading',
      progress: 0,
      speed: '0 KiB/s',
      eta: 'Đang chuẩn bị...',
      size: 'Đang tính...',
      date: new Date().toLocaleString(),
      referer: referer,
      metadata: metadata
    };

    // Chỉ thêm vào history khi là tải lẻ thông thường.
    // Nếu forceId được truyền vào thì đây là subItem của group -> group đã lưu sẵn trong history bởi main.js
    if (!forceId) {
      this.historyManager.addItem(downloadItem);
    }
    this.activeDownloads.set(id, { proc, args, url, formatId, isAudio, title, thumbnail, outputFilePath, referer, customDownloadDir, metadata });

    proc.stdout.on('data', (data) => {
      const line = data.toString();
      const progressInfo = this.parseProgress(line);
      
      if (progressInfo) {
        const update = {
          progress: progressInfo.percent,
          speed: progressInfo.speed,
          eta: progressInfo.eta,
          size: progressInfo.size,
          status: 'downloading'
        };
        
        if (!forceId) this.historyManager.updateItem(id, update);
        this.emitToRenderer('download-progress', { id, ...update });
      }
    });

    proc.stderr.on('data', (data) => {
      console.warn('yt-dlp stderr:', data.toString());
    });

    proc.on('close', async (code) => {
      this.activeDownloads.delete(id);
      
      if (code === 0) {
        console.log(`Tải xong item ${id}`);
        let actualFilePath = outputFilePath;
        const dirFiles = fs.readdirSync(targetDir);
        const match = dirFiles.find(f => f.startsWith(cleanTitle));
        if (match) {
          actualFilePath = path.join(targetDir, match);
        }

        if (isAudio && metadata && this.ffmpegAvailable !== false) {
          const tempPath = actualFilePath + '.temp.mp3';
          const tempCoverPath = path.join(this.binDir, `cover_${id}.jpg`);
          let hasCover = false;

          try {
            fs.renameSync(actualFilePath, tempPath);
            
            const coverUrl = thumbnail || metadata.thumbnail;
            if (coverUrl && coverUrl.startsWith('http')) {
              try {
                console.log(`Đang tải ảnh bìa cho ${metadata.title} từ: ${coverUrl}`);
                await downloadFile(coverUrl, tempCoverPath);
                hasCover = fs.existsSync(tempCoverPath);
                console.log('Tải ảnh bìa thành công:', hasCover);
              } catch (e) {
                console.warn('Không thể tải ảnh bìa album:', e.message);
              }
            }

            let ffmpegArgs = [];
            if (hasCover) {
              ffmpegArgs = [
                '-y',
                '-i', tempPath,
                '-i', tempCoverPath,
                '-map', '0:a',
                '-map', '1:0',
                '-c:a', 'copy',
                '-c:v', 'mjpeg',
                '-id3v2_version', '3',
                '-metadata:s:v', 'title=Album cover',
                '-metadata:s:v', 'comment=Cover (front)',
                '-metadata', `title=${metadata.title}`,
                '-metadata', `artist=${metadata.artist}`,
                '-metadata', `album=${metadata.album}`
              ];
            } else {
              ffmpegArgs = [
                '-y',
                '-i', tempPath,
                '-c', 'copy',
                '-id3v2_version', '3',
                '-metadata', `title=${metadata.title}`,
                '-metadata', `artist=${metadata.artist}`,
                '-metadata', `album=${metadata.album}`
              ];
            }
            
            if (metadata.track) {
              ffmpegArgs.push('-metadata', `track=${metadata.track}`);
            }
            
            ffmpegArgs.push(actualFilePath);
            
            console.log('Chạy ffmpeg để nhúng ID3 metadata & cover art:', ffmpegArgs);
            const ffmpegProc = spawn('ffmpeg', ffmpegArgs);
            
            ffmpegProc.on('close', (ffmpegCode) => {
              try {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                if (fs.existsSync(tempCoverPath)) fs.unlinkSync(tempCoverPath);
              } catch(e) {}
              
              if (ffmpegCode === 0) {
                console.log(`Nhúng ID3 metadata và Cover Art thành công cho ${id}`);
              } else {
                console.error(`Lỗi chạy ffmpeg nhúng metadata cho ${id}, code: ${ffmpegCode}`);
                try {
                  if (fs.existsSync(tempPath) && !fs.existsSync(actualFilePath)) {
                    fs.renameSync(tempPath, actualFilePath);
                  }
                } catch(e) {}
              }
              
              const update = {
                status: 'completed',
                progress: 100,
                speed: '0 KB/s',
                eta: '00:00',
                filePath: actualFilePath
              };
              if (!forceId) this.historyManager.updateItem(id, update);
              this.emitToRenderer('download-complete', { id, filePath: actualFilePath });
            });
          } catch (err) {
            console.error('Lỗi khi nhúng metadata bằng ffmpeg:', err);
            try {
              if (fs.existsSync(tempPath) && !fs.existsSync(actualFilePath)) {
                fs.renameSync(tempPath, actualFilePath);
              }
              if (fs.existsSync(tempCoverPath)) fs.unlinkSync(tempCoverPath);
            } catch(e) {}
            
            const update = { status: 'completed', progress: 100, filePath: actualFilePath };
            if (!forceId) this.historyManager.updateItem(id, update);
            this.emitToRenderer('download-complete', { id, filePath: actualFilePath });
          }
        } else {
          const update = {
            status: 'completed',
            progress: 100,
            speed: '0 KB/s',
            eta: '00:00',
            filePath: actualFilePath
          };
          if (!forceId) this.historyManager.updateItem(id, update);
          this.emitToRenderer('download-complete', { id, filePath: actualFilePath });
        }
      } else {
        // Nếu không phải subItem của group mới kiểm tra trạng thái paused
        if (!forceId) {
          const currentItem = this.historyManager.getHistory().find(h => h.id === id);
          if (currentItem && currentItem.status === 'paused') {
            return;
          }
        }
        
        console.error(`Lỗi tải item ${id}, code: ${code}`);
        const update = { status: 'error', progress: 0, speed: '0 KB/s', eta: 'Lỗi' };
        if (!forceId) this.historyManager.updateItem(id, update);
        this.emitToRenderer('download-error', { id, error: `Tải thất bại (code ${code})` });
      }
    });

    return { success: true, id };
  }

  // Tạm dừng tải (kill process)
  pauseDownload(id) {
    const active = this.activeDownloads.get(id);
    if (active) {
      this.historyManager.updateItem(id, { status: 'paused', speed: 'Tạm dừng', eta: '--' });
      active.proc.kill('SIGTERM');
      this.activeDownloads.delete(id);
      this.emitToRenderer('download-progress', { id, status: 'paused', speed: 'Tạm dừng', eta: '--' });
      return true;
    }
    return false;
  }

  // Tiếp tục tải (Khởi động lại process với đúng ID cũ, tránh race condition)
  resumeDownload(id) {
    const history = this.historyManager.getHistory();
    const item = history.find(h => h.id === id);
    if (!item) return false;

    // Đã đang tải rồi thì không làm gì
    if (this.activeDownloads.has(id)) return false;

    const isAudio = !!(item.formatId && (item.formatId.includes('audio') || item.formatId === 'bestaudio'))
      || !!(item.filePath && item.filePath.endsWith('.mp3'));
    const customDownloadDir = path.dirname(item.filePath);

    // Fix race condition: truyền forceId = id để startDownload giữ nguyên ID cũ
    // Không cần hack Array.from().pop() dễ sai khi có concurrent downloads
    this.startDownload(
      item.url,
      item.formatId,
      isAudio,
      item.title,
      item.thumbnail,
      item.referer || '',
      customDownloadDir,
      item.metadata || null,
      id  // <-- forceId: giữ đúng ID gốc
    );

    this.historyManager.updateItem(id, { status: 'downloading', speed: 'Đang tiếp tục...' });
    return true;
  }

  // Hủy tải
  cancelDownload(id) {
    const active = this.activeDownloads.get(id);
    if (active) {
      active.proc.kill('SIGTERM');
      this.activeDownloads.delete(id);
    }

    const item = this.historyManager.getHistory().find(h => h.id === id);
    if (item && item.filePath) {
      const fileDir = path.dirname(item.filePath);
      const baseName = path.basename(item.filePath, path.extname(item.filePath));
      
      try {
        if (fs.existsSync(fileDir)) {
          const files = fs.readdirSync(fileDir);
          files.forEach(f => {
            if (f.startsWith(baseName) && (f.endsWith('.part') || f.endsWith('.ytdl') || f.endsWith('.temp'))) {
              fs.unlinkSync(path.join(fileDir, f));
            }
          });
        }
      } catch (err) {
        console.error('Lỗi khi xóa file tạm hủy tải:', err);
      }
    }

    this.historyManager.deleteItem(id);
    this.emitToRenderer('download-progress', { id, status: 'cancelled' });
    return true;
  }

  // Parse progress từ stdout của yt-dlp
  parseProgress(line) {
    if (!line.includes('[download]')) return null;

    const percentReg = /(\d+\.?\d*)%/;
    const sizeReg = /of\s+(\d+\.?\d*\w+)/;
    const speedReg = /at\s+(\d+\.?\d*\w+\/s)/;
    const etaReg = /ETA\s+(\d+:\d+)/;

    const percentMatch = line.match(percentReg);
    const sizeMatch = line.match(sizeReg);
    const speedMatch = line.match(speedReg);
    const etaMatch = line.match(etaReg);

    if (percentMatch) {
      return {
        percent: parseFloat(percentMatch[1]),
        size: sizeMatch ? sizeMatch[1] : 'N/A',
        speed: speedMatch ? speedMatch[1] : 'N/A',
        eta: etaMatch ? etaMatch[1] : '--:--'
      };
    }

    return null;
  }

  formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    let ret = "";
    if (hrs > 0) {
      ret += "" + hrs + ":" + (mins < 10 ? "0" : "");
    }
    ret += "" + mins + ":" + (secs < 10 ? "0" : "");
    ret += "" + secs;
    return ret;
  }
}

module.exports = Downloader;
