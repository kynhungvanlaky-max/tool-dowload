const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const Downloader = require('./src/core/downloader');
const HistoryManager = require('./src/core/history');
const SettingsManager = require('./src/core/settings');
const FailedManager = require('./src/core/failed');

let mainWindow;
let downloader;
let historyManager;
let settingsManager;
let failedManager;
let tray = null;
let isQuitting = false;

// Lưu trữ ánh xạ subItemId -> groupId trong bộ nhớ để định tuyến tiến trình realtime
const subItemToGroupMap = new Map();

// Lưu các queue Album đang chạy: groupId -> { tracks, subItems, albumDir, settings, isPlaylist, quality, thumbnail, albumTitle, trackIndex, activeCount, paused, cancelled }
const activeAlbumQueues = new Map();

// Tạo thư mục lưu trữ dữ liệu và tải xuống mặc định
const userDataPath = app.getPath('userData');
const historyFilePath = path.join(userDataPath, 'history.json');
const settingsFilePath = path.join(userDataPath, 'settings.json');
const failedFilePath = path.join(userDataPath, 'failed_links.json');
const defaultDownloadDir = path.join(app.getPath('downloads'), 'MediaFetch');

if (!fs.existsSync(defaultDownloadDir)) {
  fs.mkdirSync(defaultDownloadDir, { recursive: true });
}

// Khởi tạo bộ nhớ tạm lưu cookie trong RAM
global.memoryCookies = new Map();

// Hàm trích xuất domain chính để quản lý file cookie theo nền tảng
function getDomainFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube.com';
    if (host.includes('facebook.com') || host.includes('fb.watch')) return 'facebook.com';
    if (host.includes('tiktok.com')) return 'tiktok.com';
    if (host.includes('spotify.com')) return 'spotify.com';
    
    return host;
  } catch (e) {
    return 'unknown';
  }
}

// Thư mục lưu trữ extension bên ngoài ASAR để Chrome có thể đọc
const externalExtensionPath = path.join(userDataPath, 'extension');

function copyFolderSync(from, to) {
  if (!fs.existsSync(to)) {
    fs.mkdirSync(to, { recursive: true });
  }
  fs.readdirSync(from).forEach(element => {
    const fromPath = path.join(from, element);
    const toPath = path.join(to, element);
    const stat = fs.lstatSync(fromPath);
    if (stat.isFile()) {
      fs.writeFileSync(toPath, fs.readFileSync(fromPath));
    } else if (stat.isDirectory()) {
      copyFolderSync(fromPath, toPath);
    }
  });
}

function setupExternalExtension() {
  try {
    const sourceExtensionPath = path.join(__dirname, 'extension');
    if (fs.existsSync(sourceExtensionPath)) {
      copyFolderSync(sourceExtensionPath, externalExtensionPath);
      console.log('[MediaFetch] Đã đồng bộ extension ra thư mục AppData vật lý:', externalExtensionPath);
    } else {
      // Ở môi trường dev, nếu file chạy từ asar hoặc cấu trúc khác thì log cảnh báo
      console.log('[MediaFetch] Không tìm thấy thư mục extension nguồn tại:', sourceExtensionPath);
    }
  } catch (error) {
    console.error('[MediaFetch] Lỗi đồng bộ extension:', error);
  }
}

// Khởi tạo SettingsManager
settingsManager = new SettingsManager(settingsFilePath, defaultDownloadDir);

// Cập nhật cài đặt khởi động
function updateStartupSettings(options) {
  const currentSettings = settingsManager.getSettings();
  const updatedSettings = { ...currentSettings, ...options };
  settingsManager.saveSettings(updatedSettings);

  // Áp dụng Khởi động cùng Windows
  if (options.hasOwnProperty('startWithWindows')) {
    try {
      app.setLoginItemSettings({
        openAtLogin: !!options.startWithWindows,
        path: process.execPath,
        args: ['--hidden']
      });
      console.log(`[MediaFetch] Đã cập nhật khởi động cùng Windows: ${options.startWithWindows}`);
    } catch (e) {
      console.error('Lỗi khi thiết lập khởi động cùng Windows:', e);
    }
  }

  // Áp dụng Khởi động cùng Trình duyệt Chrome
  if (options.hasOwnProperty('startWithBrowser')) {
    try {
      setupNativeMessaging(!!options.startWithBrowser);
      console.log(`[MediaFetch] Đã cập nhật khởi động cùng Chrome: ${options.startWithBrowser}`);
    } catch (e) {
      console.error('Lỗi khi thiết lập Native Messaging:', e);
    }
  }

  // Cập nhật lại UI của khay hệ thống nếu có
  updateTrayMenu();
}

// Thiết lập Chrome Native Messaging Host
function setupNativeMessaging(enabled) {
  const manifestPath = path.join(userDataPath, 'com.mediafetch.downloader.json');
  const batPath = path.join(userDataPath, 'mediafetch-native-helper.bat');
  
  if (!enabled) {
    const { exec } = require('child_process');
    const psScript = `
      if (Test-Path "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.mediafetch.downloader") {
        Remove-Item -Path "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.mediafetch.downloader" -Force
      }
    `;
    const buffer = Buffer.from(psScript, 'utf16le');
    const base64 = buffer.toString('base64');
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${base64}`);
    
    try { if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath); } catch(e) {}
    try { if (fs.existsSync(batPath)) fs.unlinkSync(batPath); } catch(e) {}
    return;
  }

  // Tạo file bat khởi chạy app trong nền
  let batContent = '';
  if (!app.isPackaged) {
    batContent = `@echo off\r\nstart "" "${process.execPath}" "${__dirname}" --hidden\r\n`;
  } else {
    batContent = `@echo off\r\nstart "" "${process.execPath}" --hidden\r\n`;
  }
  fs.writeFileSync(batPath, batContent, 'utf-8');

  let allowedOrigins = [
    "chrome-extension://ipmbbglakjlmomfecjhefbfedlpejddf/"
  ];

  try {
    const pemPath = path.join(userDataPath, 'extension.pem');
    if (fs.existsSync(pemPath)) {
      const pemContent = fs.readFileSync(pemPath, 'utf-8');
      const extensionId = getExtensionIdFromPrivateKey(pemContent);
      if (extensionId) {
        allowedOrigins.push(`chrome-extension://${extensionId}/`);
      }
    }
  } catch (e) {
    console.warn('Cannot calculate extension ID for Native Messaging allowed_origins:', e.message);
  }

  allowedOrigins = [...new Set(allowedOrigins)];

  const manifestContent = {
    name: "com.mediafetch.downloader",
    description: "MediaFetch Desktop Downloader Native Messaging Host",
    path: batPath,
    type: "stdio",
    allowed_origins: allowedOrigins
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2), 'utf-8');

  const { exec } = require('child_process');
  const psScript = `
    $RegPath = "HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.mediafetch.downloader";
    if (!(Test-Path $RegPath)) {
      New-Item -Path $RegPath -Force | Out-Null;
    }
    New-ItemProperty -Path $RegPath -Name "" -Value "${manifestPath}" -PropertyType String -Force | Out-Null;
  `;
  const buffer = Buffer.from(psScript, 'utf16le');
  const base64 = buffer.toString('base64');
  exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${base64}`);
}

// Khởi tạo khay hệ thống (System Tray)
function createTray() {
  if (tray) return;

  const iconPath = path.join(__dirname, 'extension/icons/icon16.png');
  if (fs.existsSync(iconPath)) {
    tray = new Tray(iconPath);
  } else {
    const fallbackPath = path.join(__dirname, 'src/renderer/icons/icon16.png');
    if (fs.existsSync(fallbackPath)) {
      tray = new Tray(fallbackPath);
    } else {
      return;
    }
  }

  tray.setToolTip('MediaFetch Desktop Downloader');
  
  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  updateTrayMenu();
}

// Cập nhật Context Menu khay hệ thống
function updateTrayMenu() {
  if (!tray) return;
  const settings = settingsManager.getSettings();
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Mở MediaFetch',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Khởi động cùng Windows',
      type: 'checkbox',
      checked: !!settings.startWithWindows,
      click: (menuItem) => {
        updateStartupSettings({ startWithWindows: menuItem.checked });
      }
    },
    {
      label: 'Khởi động cùng Chrome',
      type: 'checkbox',
      checked: !!settings.startWithBrowser,
      click: (menuItem) => {
        updateStartupSettings({ startWithBrowser: menuItem.checked });
      }
    },
    { type: 'separator' },
    {
      label: 'Thoát hẳn',
      click: () => {
        isQuitting = true;
        if (historyManager) historyManager.flushSync();
        if (localServer) localServer.close();
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
}

function createWindow() {
  const startHidden = process.argv.includes('--hidden') || process.argv.includes('--background');

  mainWindow = new BrowserWindow({
    width: 950,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    show: !startHidden,
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
  
  // Lắng nghe đóng cửa sổ để tối ưu chạy ngầm
  mainWindow.on('close', (e) => {
    if (isQuitting) return;

    e.preventDefault();

    const currentSettings = settingsManager.getSettings();
    const closeAction = currentSettings.closeAction || 'ask';

    if (closeAction === 'tray') {
      mainWindow.hide();
    } else if (closeAction === 'exit') {
      isQuitting = true;
      if (historyManager) historyManager.flushSync();
      if (localServer) localServer.close();
      app.quit();
    } else {
      // closeAction === 'ask'
      dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Xác nhận đóng ứng dụng',
        message: 'Bạn muốn thoát hoàn toàn ứng dụng hay tiếp tục chạy ngầm ở khay hệ thống (System Tray)?',
        buttons: ['Chạy ẩn (Tray)', 'Thoát hẳn', 'Hủy'],
        defaultId: 0,
        cancelId: 2,
        checkboxLabel: 'Nhớ lựa chọn của tôi và không hỏi lại lần sau',
        checkboxChecked: false
      }).then((result) => {
        const response = result.response;
        const remember = result.checkboxChecked;

        if (response === 0) {
          // Chạy ẩn
          if (remember) {
            settingsManager.saveSettings({ closeAction: 'tray', minimizeToTray: true });
            // Gửi tin cập nhật cài đặt cho UI
            mainWindow.webContents.send('settings-updated', settingsManager.getSettings());
            updateTrayMenu();
          }
          mainWindow.hide();
        } else if (response === 1) {
          // Thoát hẳn
          if (remember) {
            settingsManager.saveSettings({ closeAction: 'exit', minimizeToTray: false });
            mainWindow.webContents.send('settings-updated', settingsManager.getSettings());
          }
          isQuitting = true;
          if (historyManager) historyManager.flushSync();
          if (localServer) localServer.close();
          app.quit();
        }
      });
    }
  });
}

let localServer;

function startLocalServer(port = null, retries = 5) {
  const currentSettings = settingsManager.getSettings();
  const configuredPort = currentSettings.port || 7788;
  let serverPort = port || configuredPort;

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
            // Tự động lưu cookies nếu được đính kèm cùng link tải
            if (data.cookies && data.cookies.length > 0 && data.pageUrl) {
              const domain = getDomainFromUrl(data.pageUrl);
              global.memoryCookies.set(domain, data.cookies);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('cookie-synced', { domain, auto: true });
              }
            }

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
            res.end(JSON.stringify({ success: true, message: 'Đã nhận link và đồng bộ cookie thành công!' }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Thiếu tham số url' }));
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'JSON không hợp lệ: ' + err.message }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/receive-cookie') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data && data.pageUrl && data.cookies) {
            const domain = getDomainFromUrl(data.pageUrl);
            global.memoryCookies.set(domain, data.cookies);
            
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('cookie-synced', { domain, auto: false });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: `Đồng bộ cookie cho ${domain} thành công!` }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Thiếu tham số pageUrl hoặc cookies' }));
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
    if (err.code === 'EADDRINUSE' && retries > 0) {
      console.warn(`Cổng ${serverPort} bị chiếm dụng, thử tự động đổi sang cổng ${serverPort + 1}...`);
      startLocalServer(serverPort + 1, retries - 1);
    } else {
      console.error('Lỗi Local Server:', err);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-error', `Không thể khởi chạy Local Server: ${err.message}`);
      }
    }
  });

  localServer.listen(serverPort, () => {
    console.log(`Local Server đang lắng nghe trên cổng ${serverPort} để nhận link từ Extension.`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-status', {
        running: true,
        port: serverPort,
        configuredPort: configuredPort
      });
    }
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
  // Đồng bộ extension ra ngoài ASAR để Chrome có thể nạp
  setupExternalExtension();

  // Khởi tạo các manager
  historyManager = new HistoryManager(historyFilePath);
  failedManager = new FailedManager(failedFilePath);
  
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
              try {
                failedManager.add({
                  id: 'fail_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                  title: `${group.title} - ${sub.title}`,
                  url: sub.url || '',
                  error: data.error || 'Lỗi tải tệp tin trong Album',
                  date: new Date().toLocaleString()
                });
                mainWindow.webContents.send('failed-links-updated', failedManager.getList());
              } catch(e) {}
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
        
        if (channel === 'download-error') {
          try {
            const history = historyManager.getHistory();
            const item = history.find(h => h.id === id);
            failedManager.add({
              id: 'fail_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
              title: item ? item.title : (data.title || 'Tệp tải lẻ'),
              url: item ? item.url : (data.url || ''),
              error: data.error || 'Lỗi phân tích hoặc tải file',
              date: new Date().toLocaleString()
            });
            mainWindow.webContents.send('failed-links-updated', failedManager.getList());
          } catch(e) {}
        }
      }
    }
  }, settingsManager);

  // Tự động tải/cập nhật yt-dlp binary khi start app
  try {
    await downloader.checkAndUpdateBinary();
  } catch (err) {
    console.error('Không thể khởi tạo yt-dlp binary:', err);
  }

  createWindow();
  createTray();
  startLocalServer();

  // Làm mới Native Messaging Host trên startup để đảm bảo đường dẫn chính xác
  try {
    const settings = settingsManager.getSettings();
    if (settings.startWithBrowser) {
      setupNativeMessaging(true);
    }
  } catch (err) {
    console.error('Lỗi nạp cấu hình khởi động ban đầu:', err);
  }

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
async function runAlbumQueue(groupId) {
  const queueObj = activeAlbumQueues.get(groupId);
  if (!queueObj) return;

  const concurrentLimit = Math.max(1, parseInt(queueObj.settings.concurrentLimit, 10) || 2);
  
  const startNext = () => {
    if (queueObj.paused || queueObj.cancelled) {
      return;
    }

    while (queueObj.activeCount < concurrentLimit && queueObj.trackIndex < queueObj.tracks.length) {
      const idx = queueObj.trackIndex++;
      const track = queueObj.tracks[idx];
      const subItemId = queueObj.subItems[idx].id;
      
      // Đồng bộ trạng thái bài sắp tải thành pending/chờ
      const history = historyManager.getHistory();
      const groupIndex = history.findIndex(h => h.id === groupId);
      if (groupIndex > -1) {
        const sub = history[groupIndex].subItems[idx];
        if (sub && (sub.status === 'paused' || sub.status === 'error' || sub.status === 'pending')) {
          sub.status = 'pending';
          sub.progress = 0;
          sub.speed = 'Chờ...';
          historyManager.saveHistory(history);
          
          mainWindow.webContents.send('download-progress', {
            id: groupId,
            progress: history[groupIndex].progress,
            speed: `Đang tải: ${history[groupIndex].subItems.filter(s => s.status === 'completed').length}/${history[groupIndex].subItems.length} bài`,
            status: 'downloading',
            isGroup: true,
            subItems: history[groupIndex].subItems
          });
        }
      }

      queueObj.activeCount++;

      // Đăng ký ánh xạ ID bài con -> Group ID
      subItemToGroupMap.set(subItemId, groupId);

      let downloadPromise;
      if (queueObj.isPlaylist) {
        const trackQuality = track.quality || queueObj.quality || 'bestvideo+bestaudio/best';
        const trackIsAudio = trackQuality === 'bestaudio';
        downloadPromise = downloader.startDownload(
          track.url, trackQuality, trackIsAudio,
          track.title, track.thumbnail || queueObj.thumbnail,
          '', queueObj.albumDir, null, subItemId
        );
      } else {
        const queryUrl = `ytsearch1:${track.query}`;
        const metadata = {
          title: track.title,
          artist: track.artist,
          album: queueObj.albumTitle,
          track: idx + 1,
          thumbnail: track.thumbnail || queueObj.thumbnail
        };
        downloadPromise = downloader.startDownload(
          queryUrl, 'bestaudio', true,
          `${track.title} - ${track.artist}`,
          track.thumbnail || queueObj.thumbnail,
          '', queueObj.albumDir, metadata, subItemId
        );
      }

      Promise.resolve(downloadPromise)
        .catch(() => {})
        .finally(() => {
          queueObj.activeCount--;
          if (!queueObj.paused && !queueObj.cancelled) {
            startNext();
          }
          
          if (queueObj.activeCount === 0 && queueObj.trackIndex >= queueObj.tracks.length) {
            activeAlbumQueues.delete(groupId);
          }
        });
    }
  };

  startNext();
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

    // 2. Đăng ký queue Album in-memory
    const queueObj = {
      groupId,
      tracks,
      subItems,
      albumDir,
      settings,
      isPlaylist,
      quality,
      thumbnail,
      albumTitle,
      trackIndex: 0,
      activeCount: 0,
      paused: false,
      cancelled: false
    };
    activeAlbumQueues.set(groupId, queueObj);

    // 3. Chạy queue tải
    runAlbumQueue(groupId).catch(err => {
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
    
    // Đánh dấu queue in-memory là paused để dừng nhận bài mới
    const queueObj = activeAlbumQueues.get(downloadId);
    if (queueObj) {
      queueObj.paused = true;
    }

    // Tạm dừng tất cả các subItem đang chạy hoặc pending
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
    
    // Kiểm tra hoặc khôi phục lại cấu trúc queueObj
    let queueObj = activeAlbumQueues.get(downloadId);
    if (!queueObj) {
      const settings = settingsManager.getSettings();
      const baseDownloadDir = settings.downloadDir || defaultDownloadDir;
      let albumDir = baseDownloadDir;
      if (settings.createSubDirForAlbum !== false) {
        const cleanAlbumTitle = group.title.replace(/[\\/:*?"<>|]/g, '_').trim();
        albumDir = path.join(baseDownloadDir, cleanAlbumTitle);
      }

      const tracks = group.subItems.map(sub => ({
        title: sub.title,
        artist: sub.artist,
        url: sub.url,
        query: sub.url && sub.url.startsWith('ytsearch1:') ? sub.url.substring(10) : sub.title,
        thumbnail: sub.thumbnail || group.thumbnail
      }));

      queueObj = {
        groupId: downloadId,
        tracks,
        subItems: group.subItems,
        albumDir,
        settings,
        isPlaylist: group.groupType === 'playlist',
        quality: settings.videoQuality,
        thumbnail: group.thumbnail,
        albumTitle: group.title,
        trackIndex: 0,
        activeCount: 0,
        paused: false,
        cancelled: false
      };
      activeAlbumQueues.set(downloadId, queueObj);
    } else {
      queueObj.paused = false;
    }

    queueObj.activeCount = 0;

    // Tìm index của track chưa hoàn thành đầu tiên để bắt đầu lại queue từ đó
    let firstUnfinishedIdx = -1;
    for (let i = 0; i < group.subItems.length; i++) {
      const sub = group.subItems[i];
      if (sub.status !== 'completed') {
        if (firstUnfinishedIdx === -1) {
          firstUnfinishedIdx = i;
        }
        sub.status = 'pending';
        sub.progress = 0;
        sub.speed = 'Chờ...';
        subItemToGroupMap.set(sub.id, downloadId);
      }
    }

    if (firstUnfinishedIdx !== -1) {
      queueObj.trackIndex = firstUnfinishedIdx;
    } else {
      queueObj.trackIndex = group.subItems.length;
    }

    historyManager.saveHistory(history);

    runAlbumQueue(downloadId).catch(err => {
      console.error('Lỗi khi tiếp tục Album queue:', err);
    });

    return true;
  }
  return downloader.resumeDownload(downloadId);
});

ipcMain.handle('cancel-download', async (event, downloadId) => {
  const history = historyManager.getHistory();
  const index = history.findIndex(h => h.id === downloadId);
  if (index > -1 && history[index].isGroup) {
    const group = history[index];
    
    // Đánh dấu queue in-memory là cancelled
    const queueObj = activeAlbumQueues.get(downloadId);
    if (queueObj) {
      queueObj.cancelled = true;
      activeAlbumQueues.delete(downloadId);
    }

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

    // Hủy queue in-memory nếu đang chạy
    const queueObj = activeAlbumQueues.get(id);
    if (queueObj) {
      queueObj.cancelled = true;
      activeAlbumQueues.delete(id);
    }
  }
  return historyManager.deleteItem(id);
});

ipcMain.handle('get-failed-links', async () => {
  return failedManager.getList();
});

ipcMain.handle('delete-failed-link', async (event, id) => {
  failedManager.remove(id);
  return failedManager.getList();
});

ipcMain.handle('clear-failed-links', async () => {
  failedManager.clear();
  return failedManager.getList();
});

ipcMain.handle('export-failed-links', async () => {
  const failedList = failedManager.getList();
  if (failedList.length === 0) return { success: false, error: 'Không có liên kết lỗi để xuất.' };

  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Xuất danh sách liên kết lỗi',
    defaultPath: path.join(app.getPath('downloads'), 'failed_links_log.txt'),
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  });

  if (!filePath) return { success: false, canceled: true };

  try {
    const content = failedList.map(item => `[${item.date}] ${item.title}\r\nURL: ${item.url}\r\nLỗi: ${item.error}\r\n----------------------------------------`).join('\r\n\r\n');
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-file-location', async (event, filePath) => {
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('open-external-url', async (event, url) => {
  if (url && (url.startsWith('http') || url.startsWith('https'))) {
    try {
      await shell.openExternal(url);
      return true;
    } catch(e) {
      console.error('Lỗi khi mở URL ngoài:', e);
    }
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
  
  // Áp dụng cấu hình khởi động cùng hệ thống / Chrome nếu có thay đổi
  const startupChanged = 
    (newSettings.hasOwnProperty('startWithWindows') && newSettings.startWithWindows !== oldSettings.startWithWindows) ||
    (newSettings.hasOwnProperty('startWithBrowser') && newSettings.startWithBrowser !== oldSettings.startWithBrowser);

  if (startupChanged) {
    updateStartupSettings({
      startWithWindows: newSettings.startWithWindows,
      startWithBrowser: newSettings.startWithBrowser
    });
  }

  const saved = settingsManager.saveSettings(newSettings);

  // Áp dụng giới hạn tốc độ động nếu có thay đổi
  const rateLimitChanged = newSettings.hasOwnProperty('rateLimit') && newSettings.rateLimit !== oldSettings.rateLimit;
  if (rateLimitChanged && downloader) {
    downloader.updateRateLimit(newSettings.rateLimit);
  }
  
  // Nếu cổng local server thay đổi, restart server trên cổng mới
  if (newSettings.port && parseInt(newSettings.port, 10) !== parseInt(oldSettings.port, 10)) {
    startLocalServer(parseInt(newSettings.port, 10));
  }
  
  updateTrayMenu();
  
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

ipcMain.handle('open-file-picker', async (event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title || 'Chọn tệp tin',
    properties: ['openFile'],
    filters: options.filters || []
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('open-extension-folder', async () => {
  const extPath = externalExtensionPath;
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
  const currentSettings = settingsManager.getSettings();
  return {
    running: !!isListening,
    port: serverPort,
    configuredPort: currentSettings.port || 7788
  };
});

ipcMain.handle('launch-chrome-ext', async () => {
  const extPath = externalExtensionPath;
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
  const extPath = externalExtensionPath;
  const { clipboard } = require('electron');
  clipboard.writeText(extPath);
  return true;
});

ipcMain.handle('create-chrome-shortcut', async () => {
  const extPath = externalExtensionPath;
  
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

    const extPath = externalExtensionPath;
    const projectDir = app.getPath('userData');
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
