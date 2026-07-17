const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const Downloader = require('./src/core/downloader');
const HistoryManager = require('./src/core/history');
const SettingsManager = require('./src/core/settings');

let mainWindow;
let downloader;
let historyManager;
let settingsManager;

// Lưu trữ ánh xạ subItemId -> groupId trong bộ nhớ để định tuyến tiến trình realtime
const subItemToGroupMap = new Map();

// Tạo thư mục lưu trữ dữ liệu và tải xuống mặc định
const userDataPath = app.getPath('userData');
const historyFilePath = path.join(userDataPath, 'history.json');
const settingsFilePath = path.join(userDataPath, 'settings.json');
const defaultDownloadDir = path.join(app.getPath('downloads'), 'MediaFetch');

if (!fs.existsSync(defaultDownloadDir)) {
  fs.mkdirSync(defaultDownloadDir, { recursive: true });
}

// Khởi tạo SettingsManager
settingsManager = new SettingsManager(settingsFilePath, defaultDownloadDir);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 950,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1e1e2e',
      symbolColor: '#cdd6f4',
      height: 35
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));
  // mainWindow.webContents.openDevTools(); // Mở khi cần debug
}

let localServer;

function startLocalServer(port = null) {
  const currentSettings = settingsManager.getSettings();
  const serverPort = port || currentSettings.port || 7788;

  if (localServer) {
    try {
      localServer.close();
    } catch (e) {}
  }

  localServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/receive-link') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data && data.url) {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('external-link-received', data);
              
              const settings = settingsManager.getSettings();
              if (settings.autoFocus !== false) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
              }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Đã nhận link thành công!' }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Thiếu tham số url' }));
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'JSON không hợp lệ: ' + err.message }));
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Không tìm thấy endpoint' }));
    }
  });

  localServer.on('error', (err) => {
    console.error('Lỗi Local Server:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-error', err.message);
    }
  });

  localServer.listen(serverPort, () => {
    console.log(`Local Server đang lắng nghe trên cổng ${serverPort} để nhận link từ Extension.`);
  });
}

function migrateOldHistory(historyManager) {
  try {
    const history = historyManager.getHistory();
    let changed = false;
    const newHistory = [];
    const albumGroups = {}; // key: albumTitle -> groupItem

    history.forEach(item => {
      // Nếu là group sẵn rồi thì giữ nguyên
      if (item.isGroup) {
        newHistory.push(item);
      } 
      // Nếu là item đơn lẻ cũ của Spotify có album trong metadata
      else if (item.metadata && item.metadata.album) {
        const albumTitle = item.metadata.album;
        changed = true;
        
        if (!albumGroups[albumTitle]) {
          albumGroups[albumTitle] = {
            id: 'group_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            title: albumTitle,
            thumbnail: item.thumbnail || '',
            status: 'completed',
            progress: 100,
            isGroup: true,
            groupType: 'album',
            date: item.date || new Date().toLocaleString(),
            subItems: []
          };
          newHistory.push(albumGroups[albumTitle]);
        }
        
        // Thêm bài hát con vào group
        albumGroups[albumTitle].subItems.push({
          id: item.id + '_sub',
          title: item.metadata.title || item.title.split(' - ')[0],
          artist: item.metadata.artist || 'N/A',
          url: item.url,
          status: item.status || 'completed',
          progress: item.progress || 100,
          speed: item.speed || 'Xong',
          size: item.size || ''
        });
      } 
      // Nếu là các item tải lẻ khác thì giữ nguyên
      else {
        newHistory.push(item);
      }
    });

    // Cập nhật lại thông tin chung của các group cũ vừa được gộp
    if (changed) {
      newHistory.forEach(item => {
        if (item.isGroup && item.id.startsWith('group_old_')) {
          const totalProgress = item.subItems.reduce((acc, sub) => acc + (sub.progress || 0), 0);
          item.progress = Math.round(totalProgress / item.subItems.length);
          
          const completedCount = item.subItems.filter(sub => sub.status === 'completed').length;
          
          if (completedCount === item.subItems.length) {
            item.status = 'completed';
            item.speed = 'Hoàn tất';
          } else {
            item.status = 'paused';
            item.speed = `Đã tải: ${completedCount}/${item.subItems.length} bài`;
          }
        }
      });
      
      console.log('Đã tự động gom nhóm lịch sử tải Album Spotify cũ thành công!');
      historyManager.saveHistory(newHistory);
    }
  } catch(e) {
    console.error('Lỗi khi migrate lịch sử cũ:', e);
  }
}

app.whenReady().then(async () => {
  // Khởi tạo các manager
  historyManager = new HistoryManager(historyFilePath);
  
  // Tự động gom nhóm các Album cũ trong lịch sử nếu có
  migrateOldHistory(historyManager);
  
  // Nạp lại các ánh xạ subItem -> group từ history cũ phòng khi app khởi động lại
  try {
    const history = historyManager.getHistory();
    history.forEach(item => {
      if (item.isGroup && item.subItems) {
        item.subItems.forEach(sub => {
          if (sub.status === 'downloading' || sub.status === 'pending' || sub.status === 'paused') {
            subItemToGroupMap.set(sub.id, item.id);
          }
        });
      }
    });
  } catch(e) {}

  downloader = new Downloader(defaultDownloadDir, historyManager, (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const id = data.id;
      
      // Định tuyến realtime: Kiểm tra xem ID sự kiện có thuộc về một subItem của Group không
      if (id && subItemToGroupMap.has(id)) {
        const groupId = subItemToGroupMap.get(id);
        
        const history = historyManager.getHistory();
        const groupIndex = history.findIndex(h => h.id === groupId);
        
        if (groupIndex > -1) {
          const group = history[groupIndex];
          const subItemIndex = group.subItems.findIndex(sub => sub.id === id);
          
          if (subItemIndex > -1) {
            const sub = group.subItems[subItemIndex];
            
            if (channel === 'download-progress') {
              sub.progress = data.progress;
              sub.speed = data.speed;
              sub.eta = data.eta;
              sub.size = data.size;
              sub.status = 'downloading';
            } else if (channel === 'download-complete') {
              sub.progress = 100;
              sub.status = 'completed';
              sub.speed = 'Xong';
              // Auto-cleanup: xóa khỏi map khi bài đã hoàn thành
              subItemToGroupMap.delete(id);
            } else if (channel === 'download-error') {
              sub.progress = 0;
              sub.status = 'error';
              sub.speed = 'Lỗi';
              // Giữ trong map nếu user muốn retry bài lỗi này
            }
            
            // Tính toán tiến trình trung bình của cả Group
            const totalProgress = group.subItems.reduce((acc, s) => acc + (s.progress || 0), 0);
            group.progress = Math.round(totalProgress / group.subItems.length);
            
            // Trạng thái tổng quát của Group
            const completedCount = group.subItems.filter(s => s.status === 'completed').length;
            const errorCount = group.subItems.filter(s => s.status === 'error').length;
            
            if (completedCount === group.subItems.length) {
              group.status = 'completed';
              group.speed = 'Hoàn tất';
            } else if (errorCount + completedCount === group.subItems.length) {
              group.status = 'error';
              group.speed = `Lỗi ${errorCount} bài`;
            } else {
              group.status = 'downloading';
              group.speed = `Đang tải: ${completedCount}/${group.subItems.length} bài`;
            }
            
            // Lưu lại history cập nhật
            historyManager.saveHistory(history);
            
            // Gửi sự kiện cập nhật Group về Renderer UI
            mainWindow.webContents.send('download-progress', {
              id: groupId,
              progress: group.progress,
              speed: group.speed,
              eta: group.status === 'completed' ? '00:00' : 'Đang tải...',
              status: group.status,
              isGroup: true,
              subItems: group.subItems
            });
          }
        }
      } else {
        // Đối với file tải lẻ thông thường, chuyển tiếp trực tiếp
        mainWindow.webContents.send(channel, data);
      }
    }
  }, settingsManager);

  // Tự động tải/cập nhật yt-dlp binary khi start app
  try {
    await downloader.initBinary();
  } catch (err) {
    console.error('Không thể khởi tạo yt-dlp binary:', err);
  }

  createWindow();
  startLocalServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Flush lịch sử ra disk ngay lập tức trước khi đóng (tránh mất dữ liệu debounce)
  if (historyManager) {
    historyManager.flushSync();
  }
  if (localServer) {
    localServer.close();
  }
  if (process.platform !== 'darwin') app.quit();
});

// ─── Concurrent Download Queue cho Album/Playlist ──────────────────────────
// Thay thế cơ chế setTimeout delay đơn giản bằng queue thực sự dựa trên concurrentLimit
async function runAlbumQueue(tracks, subItems, groupId, albumDir, settings, isPlaylist, quality, thumbnail, albumTitle) {
  const concurrentLimit = Math.max(1, parseInt(settings.concurrentLimit, 10) || 2);
  let activeCount = 0;
  let trackIndex = 0;

  return new Promise((resolve) => {
    function startNext() {
      // Khởi động tối đa concurrentLimit download cùng lúc
      while (activeCount < concurrentLimit && trackIndex < tracks.length) {
        const idx = trackIndex++;
        const track = tracks[idx];
        const subItemId = subItems[idx].id;
        activeCount++;

        // Đăng ký ánh xạ ID bài con -> Group ID
        subItemToGroupMap.set(subItemId, groupId);

        let downloadPromise;
        if (isPlaylist) {
          const trackQuality = track.quality || quality || 'bestvideo+bestaudio/best';
          const trackIsAudio = trackQuality === 'bestaudio';
          downloadPromise = downloader.startDownload(
            track.url, trackQuality, trackIsAudio,
            track.title, track.thumbnail || thumbnail,
            '', albumDir, null, subItemId
          );
        } else {
          const queryUrl = `ytsearch1:${track.query}`;
          const metadata = {
            title: track.title,
            artist: track.artist,
            album: albumTitle,
            track: idx + 1,
            thumbnail: track.thumbnail || thumbnail
          };
          downloadPromise = downloader.startDownload(
            queryUrl, 'bestaudio', true,
            `${track.title} - ${track.artist}`,
            track.thumbnail || thumbnail,
            '', albumDir, metadata, subItemId
          );
        }

        // Khi một download hoàn thành (hoặc lỗi), giảm counter và kích hoạt bài tiếp theo
        Promise.resolve(downloadPromise)
          .catch(() => {})
          .finally(() => {
            activeCount--;
            startNext();
            // Khi tất cả track đã xong
            if (activeCount === 0 && trackIndex >= tracks.length) {
              resolve();
            }
          });
      }

      // Trường hợp tracks rỗng
      if (tracks.length === 0) resolve();
    }

    startNext();
  });
}

// IPC Handlers
ipcMain.handle('analyze-url', async (event, url, referer) => {
  try {
    return await downloader.analyze(url, referer);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-download', async (event, { url, formatId, isAudio, title, thumbnail, referer }) => {
  try {
    const settings = settingsManager.getSettings();
    const downloadDir = settings.downloadDir || defaultDownloadDir;
    return await downloader.startDownload(url, formatId, isAudio, title, thumbnail, referer, downloadDir);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-album-download', async (event, { tracks, thumbnail, albumTitle, isPlaylist, quality }) => {
  try {
    const settings = settingsManager.getSettings();
    const baseDownloadDir = settings.downloadDir || defaultDownloadDir;
    
    let albumDir = baseDownloadDir;
    if (settings.createSubDirForAlbum !== false) {
      const cleanAlbumTitle = albumTitle.replace(/[\\/:*?"<>|]/g, '_').trim();
      albumDir = path.join(baseDownloadDir, cleanAlbumTitle);
    }

    if (!fs.existsSync(albumDir)) {
      fs.mkdirSync(albumDir, { recursive: true });
    }

    // 1. Tạo Group Download Item lưu vào history
    const groupId = 'group_' + Date.now();
    const subItems = tracks.map((track, idx) => ({
      id: `${groupId}_sub_${idx + 1}`,
      title: track.title,
      artist: track.artist || 'N/A',
      url: track.url || `ytsearch1:${track.query}`,
      status: 'pending',
      progress: 0,
      speed: '--',
      size: '--'
    }));

    const groupItem = {
      id: groupId,
      title: albumTitle,
      thumbnail: thumbnail || '',
      status: 'downloading',
      progress: 0,
      isGroup: true,
      groupType: isPlaylist ? 'playlist' : 'album',
      date: new Date().toLocaleString(),
      subItems: subItems
    };

    historyManager.addItem(groupItem);

    // 2. Chạy queue tải bài con với concurrentLimit thực sự
    // Thay thế cơ chế setTimeout delay đơn giản trước đây
    runAlbumQueue(tracks, subItems, groupId, albumDir, settings, isPlaylist, quality, thumbnail, albumTitle)
      .catch(err => {
        console.error('Album queue error:', err);
      });


    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('pause-download', async (event, downloadId) => {
  const history = historyManager.getHistory();
  const index = history.findIndex(h => h.id === downloadId);
  if (index > -1 && history[index].isGroup) {
    const group = history[index];
    group.status = 'paused';
    group.speed = 'Tạm dừng';
    
    group.subItems.forEach(sub => {
      if (sub.status === 'downloading' || sub.status === 'pending') {
        downloader.pauseDownload(sub.id);
        sub.status = 'paused';
        sub.speed = 'Tạm dừng';
      }
    });
    
    historyManager.saveHistory(history);
    return true;
  }
  return downloader.pauseDownload(downloadId);
});

ipcMain.handle('resume-download', async (event, downloadId) => {
  const history = historyManager.getHistory();
  const index = history.findIndex(h => h.id === downloadId);
  if (index > -1 && history[index].isGroup) {
    const group = history[index];
    group.status = 'downloading';
    group.speed = 'Đang tiếp tục...';
    
    let delay = 0;
    group.subItems.forEach(sub => {
      if (sub.status === 'paused' || sub.status === 'error') {
        sub.status = 'pending';
        sub.progress = 0;
        
        // Đăng ký lại ánh xạ
        subItemToGroupMap.set(sub.id, downloadId);
        
        setTimeout(() => {
          downloader.resumeDownload(sub.id);
        }, delay);
        delay += 1000;
      }
    });
    
    historyManager.saveHistory(history);
    return true;
  }
  return downloader.resumeDownload(downloadId);
});

ipcMain.handle('cancel-download', async (event, downloadId) => {
  const history = historyManager.getHistory();
  const index = history.findIndex(h => h.id === downloadId);
  if (index > -1 && history[index].isGroup) {
    const group = history[index];
    group.subItems.forEach(sub => {
      downloader.cancelDownload(sub.id);
      subItemToGroupMap.delete(sub.id);
    });
    
    historyManager.deleteItem(downloadId);
    return true;
  }
  return downloader.cancelDownload(downloadId);
});

ipcMain.handle('get-history', async () => {
  return historyManager.getHistory();
});

ipcMain.handle('clear-history', async () => {
  return historyManager.clearHistory();
});

ipcMain.handle('delete-history-item', async (event, id) => {
  const history = historyManager.getHistory();
  const index = history.findIndex(h => h.id === id);
  if (index > -1 && history[index].isGroup) {
    // Xóa tất cả ánh xạ của bài con trong group
    history[index].subItems.forEach(sub => {
      subItemToGroupMap.delete(sub.id);
    });
  }
  return historyManager.deleteItem(id);
});

ipcMain.handle('open-file-location', async (event, filePath) => {
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('get-download-dir', async () => {
  const settings = settingsManager.getSettings();
  return settings.downloadDir || defaultDownloadDir;
});

ipcMain.handle('get-settings', async () => {
  return settingsManager.getSettings();
});

ipcMain.handle('save-settings', async (event, newSettings) => {
  const oldSettings = settingsManager.getSettings();
  const saved = settingsManager.saveSettings(newSettings);
  
  // Nếu cổng local server thay đổi, restart server trên cổng mới
  if (newSettings.port && parseInt(newSettings.port, 10) !== parseInt(oldSettings.port, 10)) {
    startLocalServer(parseInt(newSettings.port, 10));
  }
  
  return saved;
});

ipcMain.handle('open-folder-picker', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('open-extension-folder', async () => {
  const extPath = path.join(__dirname, 'extension');
  if (fs.existsSync(extPath)) {
    shell.openPath(extPath);
    return true;
  }
  return false;
});

ipcMain.handle('check-server-status', async () => {
  const isListening = localServer && localServer.listening;
  let serverPort = 7788;
  if (localServer) {
    const address = localServer.address();
    if (address && typeof address === 'object') {
      serverPort = address.port;
    }
  }
  return {
    running: !!isListening,
    port: serverPort
  };
});

ipcMain.handle('launch-chrome-ext', async () => {
  const extPath = path.join(__dirname, 'extension');
  const tempProfilePath = path.join(app.getPath('temp'), 'MediaFetchChromeProfile');
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    // Thêm --user-data-dir để Chrome mở một session hoàn toàn độc lập, đảm bảo nạp được extension kể cả khi Chrome chính đang mở!
    exec(`start chrome --load-extension="${extPath}" --user-data-dir="${tempProfilePath}" "https://open.spotify.com"`, (error) => {
      resolve(!error);
    });
  });
});

ipcMain.handle('copy-extension-path', async () => {
  const extPath = path.join(__dirname, 'extension');
  const { clipboard } = require('electron');
  clipboard.writeText(extPath);
  return true;
});

ipcMain.handle('create-chrome-shortcut', async () => {
  const extPath = path.join(__dirname, 'extension');
  
  // Các đường dẫn cài đặt mặc định của Chrome trên Windows
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ];
  
  let targetChrome = '';
  for (const p of chromePaths) {
    if (fs.existsSync(p)) {
      targetChrome = p;
      break;
    }
  }
  
  if (!targetChrome) {
    return { success: false, error: 'Không tìm thấy Google Chrome cài đặt trên hệ thống.' };
  }
  
  // Script PowerShell tạo file LNK dạng mã hóa UTF-16LE Base64 để tránh lỗi ký tự đặc biệt/khoảng trắng
  // Sử dụng [Environment]::GetFolderPath('Desktop') để tự động giải quyết các trường hợp Desktop được di chuyển (như OneDrive Desktop Backup)
  const { exec } = require('child_process');
  const psScript = `
    $WshShell = New-Object -ComObject WScript.Shell;
    $DesktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop);
    $ShortcutPath = Join-Path $DesktopPath 'Chrome (MediaFetch).lnk';
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath);
    $Shortcut.TargetPath = '${targetChrome}';
    $Shortcut.Arguments = '--load-extension="${extPath}" --no-first-run';
    $Shortcut.IconLocation = '${targetChrome},0';
    $Shortcut.Save();
  `;
  
  const buffer = Buffer.from(psScript, 'utf16le');
  const base64 = buffer.toString('base64');
  
  return new Promise((resolve) => {
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${base64}`, (error) => {
      if (error) {
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true });
      }
    });
  });
});

const crypto = require('crypto');

function getExtensionIdFromPrivateKey(pemString) {
  const privateKey = crypto.createPrivateKey(pemString);
  const publicKey = crypto.createPublicKey(privateKey);
  const spkiBuffer = publicKey.export({ type: 'spki', format: 'der' });
  const hash = crypto.createHash('sha256').update(spkiBuffer).digest('hex');
  return hash.substring(0, 32).split('').map(c => {
    return String.fromCharCode(parseInt(c, 16) + 97);
  }).join('');
}

ipcMain.handle('install-chrome-ext-policy', async () => {
  try {
    const { exec } = require('child_process');
    
    // 0. Tắt toàn bộ tiến trình Google Chrome đang chạy để giải phóng tài nguyên và nạp Registry Policy sạch sẽ
    await new Promise((resolve) => {
      exec('taskkill /F /IM chrome.exe', () => {
        // Cho dù Chrome có đang chạy hay không thì đều resolve để đi tiếp
        resolve();
      });
    });

    const extPath = path.join(__dirname, 'extension');
    const projectDir = __dirname;
    const pemPath = path.join(projectDir, 'extension.pem');
    const crxPath = path.join(projectDir, 'extension.crx');
    const xmlPath = path.join(projectDir, 'extension_update.xml');
    
    // 1. Tạo file extension.pem nếu chưa có
    if (!fs.existsSync(pemPath)) {
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      fs.writeFileSync(pemPath, privateKey, 'utf-8');
    }
    
    // 2. Tính toán Extension ID từ Private Key
    const pemContent = fs.readFileSync(pemPath, 'utf-8');
    const extensionId = getExtensionIdFromPrivateKey(pemContent);
    
    // 3. Định vị chrome.exe
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
    ];
    let chromePath = '';
    for (const p of chromePaths) {
      if (fs.existsSync(p)) {
        chromePath = p;
        break;
      }
    }
    
    if (!chromePath) {
      return { success: false, error: 'Không tìm thấy Google Chrome cài đặt trên hệ thống.' };
    }
    
    // 4. Gọi Chrome đóng gói extension thành file .crx
    await new Promise((resolve, reject) => {
      if (fs.existsSync(crxPath)) {
        try { fs.unlinkSync(crxPath); } catch(e) {}
      }
      exec(`"${chromePath}" --pack-extension="${extPath}" --pack-extension-key="${pemPath}"`, (error) => {
        setTimeout(() => {
          if (fs.existsSync(crxPath)) {
            resolve();
          } else {
            reject(new Error('Chrome không thể đóng gói file .crx: ' + (error ? error.message : 'Hãy tắt Chrome và thử lại')));
          }
        }, 1500);
      });
    });
    
    // 5. Thử ghi khóa Registry HKCU Chrome Extensions (Bọc try-catch phòng trường hợp chính sách Windows chặn ghi)
    try {
      const psScript = `
        $RegPath = "HKCU:\\Software\\Google\\Chrome\\Extensions\\${extensionId}";
        if (!(Test-Path $RegPath)) {
          New-Item -Path $RegPath -Force | Out-Null;
        }
        New-ItemProperty -Path $RegPath -Name "path" -Value "${crxPath}" -PropertyType String -Force | Out-Null;
        New-ItemProperty -Path $RegPath -Name "version" -Value "1.0" -PropertyType String -Force | Out-Null;
      `;
      const buffer = Buffer.from(psScript, 'utf16le');
      const base64 = buffer.toString('base64');
      await new Promise((resolve) => {
        exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${base64}`, () => {
          resolve();
        });
      });
    } catch (regErr) {
      console.warn('Lỗi ghi Registry (bỏ qua):', regErr.message);
    }
    
    // 6. Khởi động lại Google Chrome nạp sẵn tiện ích bằng cờ CLI --load-extension để đảm bảo nạp được ngay
    exec(`start chrome --load-extension="${extPath}" "chrome://extensions/"`);
    
    return { success: true, extensionId };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('uninstall-chrome-ext-policy', async () => {
  try {
    const pemPath = path.join(__dirname, 'extension.pem');
    const crxPath = path.join(__dirname, 'extension.crx');
    
    if (!fs.existsSync(pemPath)) {
      return { success: true, message: 'Chưa từng cài đặt extension bằng chế độ tự động.' };
    }
    
    const pemContent = fs.readFileSync(pemPath, 'utf-8');
    const extensionId = getExtensionIdFromPrivateKey(pemContent);
    
    const psScript = `
      $RegPath = "HKCU:\\Software\\Google\\Chrome\\Extensions\\${extensionId}";
      if (Test-Path $RegPath) {
        Remove-Item -Path $RegPath -Recurse -Force | Out-Null;
      }
    `;
    
    const buffer = Buffer.from(psScript, 'utf16le');
    const base64 = buffer.toString('base64');
    
    const { exec } = require('child_process');
    await new Promise((resolve) => {
      exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${base64}`, () => {
        resolve();
      });
    });
    
    // Xóa các file đóng gói tạm
    try { if (fs.existsSync(crxPath)) fs.unlinkSync(crxPath); } catch(e) {}
    try { if (fs.existsSync(pemPath)) fs.unlinkSync(pemPath); } catch(e) {}
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
