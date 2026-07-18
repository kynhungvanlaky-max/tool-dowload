const pageTitleEl = document.getElementById('page-title');
const linksListEl = document.getElementById('links-list');
const linksCountEl = document.getElementById('links-count');
const statusIndicator = document.getElementById('connection-status');
const btnRefresh = document.getElementById('btn-refresh');
const btnSyncCookie = document.getElementById('btn-sync-cookie');

let currentTab = null;
const SERVER_URL = 'http://localhost:7788/receive-link';

// ─── Helper: Bắt lỗi "Extension context invalidated" khi SW bị kill ──────────
// Gọi bất kỳ chrome.* API nào trong wrapper này để tránh popup trắng
function safeChrome(fn) {
  try {
    return fn();
  } catch (err) {
    if (err && err.message && err.message.includes('Extension context invalidated')) {
      linksListEl.innerHTML = `
        <div class="empty-list" style="color:#f38ba8">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
          <p>Extension vừa được reload. Vui lòng đóng và mở lại popup.</p>
        </div>`;
    } else {
      console.warn('[MediaFetch Popup] safeChrome error:', err.message);
    }
    return null;
  }
}

// Khi popup được mở
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initPopup();
  } catch (err) {
    // Trường hợp popup bị trắng do lỗi JS sớm
    console.error('[MediaFetch Popup] Init error:', err);
    if (linksListEl) {
      linksListEl.innerHTML = `
        <div class="empty-list" style="color:#f38ba8">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>Lỗi khởi tạo popup: ${err.message}</p>
        </div>`;
    }
  }
});


if (btnRefresh) {
  btnRefresh.addEventListener('click', async () => {
    await initPopup();
  });
}

if (btnSyncCookie) {
  btnSyncCookie.addEventListener('click', syncCookieWithApp);
}

// Lắng nghe tin nhắn cập nhật realtime từ background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'links-updated' && currentTab && request.tabId === currentTab.id) {
    console.log('Nhận cập nhật realtime danh sách link:', request.links);

    chrome.tabs.get(currentTab.id, (tab) => {
      if (tab) {
        pageTitleEl.innerText = tab.title || 'Không rõ tiêu đề';
        pageTitleEl.title = tab.title || '';
      }
    });

    renderLinks(request.links);
  }
});

// Hàm kiểm tra xem một URL có phải là link video/audio cụ thể của nền tảng lớn không
function isMajorPlatformVideo(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const pathname = parsed.pathname;

    // 1. YouTube
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      if (parsed.searchParams.has('v')) return true;
      if (pathname.includes('/shorts/') || pathname.includes('/live/') || pathname.includes('/v/') || pathname.includes('/embed/')) return true;
      return false;
    }

    // 2. Facebook
    if (hostname.includes('facebook.com') || hostname.includes('fb.watch')) {
      if (pathname.includes('/watch') || pathname.includes('/reel/') || pathname.includes('/videos/') || pathname.includes('/posts/') || pathname.includes('story.php')) return true;
      if (hostname.includes('fb.watch')) return true;
      if (parsed.searchParams.has('v')) return true;
      return false;
    }

    // 3. TikTok
    if (hostname.includes('tiktok.com')) {
      if (pathname.includes('/video/') || pathname.includes('/photo/')) return true;
      return false;
    }

    // 4. Spotify
    if (hostname.includes('spotify.com')) {
      if (pathname.includes('/track/') || pathname.includes('/album/') || pathname.includes('/playlist/')) return true;
      return false;
    }
  } catch (e) { }

  return false;
}

async function initPopup() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) return;
  currentTab = tabs[0];

  pageTitleEl.innerText = currentTab.title || 'Không rõ tiêu đề';
  pageTitleEl.title = currentTab.title || '';

  checkAppConnection();

  // Tự động kiểm tra và bắt link trang hiện tại nếu là video/music MXH hợp lệ
  if (currentTab.url && isMajorPlatformVideo(currentTab.url)) {
    const tabId = currentTab.id;
    chrome.storage.local.get([`tab_${tabId}`], (result) => {
      let links = result[`tab_${tabId}`] || [];

      // Nếu link trang hiện tại chưa có trong storage, tự động nạp nó ngay lập tức
      if (!links.some(l => l.url === currentTab.url)) {
        // MXH lớn/Spotify chỉ cần giữ duy nhất link gốc trang hiện tại để làm sạch rác
        const newLink = {
          url: currentTab.url,
          name: currentTab.title || 'Liên kết gốc',
          contentType: 'text/html',
          timestamp: Date.now()
        };
        links = [newLink]; // Đặt duy nhất link gốc này

        const update = {};
        update[`tab_${tabId}`] = links;
        chrome.storage.local.set(update, () => {
          renderLinks(links);
          // Gửi yêu cầu cập nhật Badge sang background
          chrome.runtime.sendMessage({
            action: 'update-badge',
            tabId: tabId,
            count: links.length
          }).catch(() => { });
        });
      } else {
        renderLinks(links);
      }
    });
  } else {
    loadTabLinks(currentTab.id);
  }
}

// Kiểm tra kết nối tới local server của app desktop (3 giây timeout)
function checkAppConnection() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  fetch('http://localhost:7788/receive-link', {
    method: 'OPTIONS',
    mode: 'cors',
    signal: controller.signal
  })
    .then(() => {
      clearTimeout(timeoutId);
      statusIndicator.className = 'status-indicator connected';
      statusIndicator.innerText = 'Đã kết nối App';
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      statusIndicator.className = 'status-indicator disconnected';
      statusIndicator.innerText = err.name === 'AbortError' ? 'App không phản hồi' : 'Chưa bật App';
    });
}

// Load danh sách link từ chrome storage
function loadTabLinks(tabId) {
  chrome.storage.local.get([`tab_${tabId}`], (result) => {
    const links = result[`tab_${tabId}`] || [];
    renderLinks(links);
  });
}

// Render các link lên giao diện
function renderLinks(links) {
  linksListEl.innerHTML = '';
  linksCountEl.innerText = links.length;

  if (links.length === 0) {
    linksListEl.innerHTML = `
      <div class="empty-list">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <p>Không phát hiện link video/audio nào trên trang này. Hãy thử play video để link xuất hiện.</p>
      </div>
    `;
    return;
  }

  // Đảo ngược mảng để link mới nhất lên đầu
  const reversedLinks = [...links].reverse();

  reversedLinks.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'link-card';

    const ext = getExtensionFromUrl(item.url);
    const typeLabel = getTypeLabel(ext, item.url, item.contentType);

    // Tạo tên tệp mặc định sạch đẹp để chỉnh sửa nhanh
    let defaultFileName = item.name || 'video_media';
    if (defaultFileName.includes('.')) {
      defaultFileName = defaultFileName.substring(0, defaultFileName.lastIndexOf('.'));
    }

    card.innerHTML = `
      <div class="link-card-top">
        <div class="link-icon-wrapper">
          ${getIconForExt(ext, item.url)}
        </div>
        <div class="link-info">
          <div class="link-url-text" title="${item.url}">${item.url}</div>
          <div class="link-meta">Định dạng: <span class="format-badge">${typeLabel}</span></div>
        </div>
        <div class="link-actions">
          <button class="btn-small btn-copy" title="Copy Link">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button class="btn-small primary btn-send" title="Gửi sang MediaFetch App">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>
          </button>
        </div>
      </div>
      <div class="link-card-bottom">
        <input type="text" class="input-title-rename" placeholder="Đặt tên tệp lưu về (Không cần nhập đuôi file)..." value="${defaultFileName}" title="Đặt tên tệp tải về">
      </div>
    `;

    linksListEl.appendChild(card);

    // Sự kiện Copy Link
    card.querySelector('.btn-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(item.url);
      showNotification('Đã sao chép link vào clipboard!');
    });

    // Sự kiện Gửi sang App
    card.querySelector('.btn-send').addEventListener('click', () => {
      const customTitle = card.querySelector('.input-title-rename').value.trim();
      sendLinkToApp(item.url, customTitle || defaultFileName);
    });
  });
}

function showNotification(message) {
  const toast = document.createElement('div');
  toast.className = 'mediafetch-toast';
  toast.innerText = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// Gửi link sang Desktop App qua HTTP POST (3 giây timeout để tránh treo UI)
async function sendLinkToApp(url, customTitle) {
  let cookies = [];
  try {
    if (currentTab && currentTab.url && !currentTab.url.startsWith('chrome://') && !currentTab.url.startsWith('about:')) {
      cookies = await chrome.cookies.getAll({ url: currentTab.url });
    }
  } catch (err) {
    console.warn('Lỗi lấy cookie cho link tải:', err.message);
  }

  const payload = {
    url: url,
    pageUrl: currentTab.url,
    pageTitle: customTitle || currentTab.title,
    thumbnail: currentTab.favIconUrl || '',
    cookies: cookies
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // Tăng lên 4 giây để có thêm thời gian xử lý cookie

  fetch(SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    mode: 'cors',
    signal: controller.signal,
    body: JSON.stringify(payload)
  })
    .then(response => {
      clearTimeout(timeoutId);
      return response.json();
    })
    .then(data => {
      if (data.success) {
        showNotification('Đã gửi link kèm cookie sang MediaFetch Desktop App!');
      } else {
        showNotification('Gửi thất bại: ' + data.error);
      }
    })
    .catch(err => {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        showNotification('Hết thời gian chờ! Hãy chắc Desktop App đang mở.');
      } else {
        showNotification('Lỗi kết nối! Hãy chắc chắn Desktop App đang mở.');
      }
    });
}

// Gửi cookie thủ công của tab hiện tại sang Desktop App
async function syncCookieWithApp() {
  if (!chrome.cookies) {
    showNotification('Thiếu quyền cookies! Vui lòng nạp lại (Reload) Extension.');
    return;
  }

  if (!currentTab || !currentTab.url) {
    showNotification('Không xác định được trang hiện tại!');
    return;
  }

  if (currentTab.url.startsWith('chrome://') || currentTab.url.startsWith('edge://') || currentTab.url.startsWith('about:')) {
    showNotification('Không thể lấy cookie của trang hệ thống!');
    return;
  }

  btnSyncCookie.classList.add('syncing');
  btnSyncCookie.disabled = true;
  btnSyncCookie.innerHTML = `
    <svg class="sync-cookie-icon" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5">
      <line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line>
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
      <line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line>
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
    </svg>
    <span>Đang đồng bộ...</span>
  `;

  try {
    const cookies = await chrome.cookies.getAll({ url: currentTab.url });
    const payload = {
      pageUrl: currentTab.url,
      cookies: cookies
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch('http://localhost:7788/receive-cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      mode: 'cors',
      signal: controller.signal,
      body: JSON.stringify(payload)
    });

    clearTimeout(timeoutId);
    const data = await response.json();

    if (data.success) {
      showNotification('Đã đồng bộ cookie của trang sang Desktop App!');
    } else {
      showNotification('Đồng bộ thất bại: ' + data.error);
    }
  } catch (err) {
    console.error('Lỗi đồng bộ cookie:', err);
    showNotification('Lỗi kết nối! Hãy chắc chắn Desktop App đang mở.');
  } finally {
    btnSyncCookie.classList.remove('syncing');
    btnSyncCookie.disabled = false;
    btnSyncCookie.innerHTML = `
      <svg class="sync-cookie-icon" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
      </svg>
      <span>Đồng bộ Cookie</span>
    `;
  }
}

// Helper lấy đuôi file từ URL
function getExtensionFromUrl(url) {
  try {
    const cleanUrl = url.split('?')[0];
    const parts = cleanUrl.split('.');
    if (parts.length > 1) {
      return parts.pop().toLowerCase();
    }
  } catch (e) { }
  return '';
}

// Helper lấy nhãn định dạng
function getTypeLabel(ext, url, contentType) {
  if (url.includes('googlevideo.com/videoplayback')) return 'YouTube Video';
  if (url.includes('spotify.com')) {
    if (url.includes('/track/')) return 'Spotify Track';
    if (url.includes('/album/')) return 'Spotify Album';
    if (url.includes('/playlist/')) return 'Spotify Playlist';
    return 'Spotify Music';
  }
  if (contentType && contentType !== 'unknown') {
    if (contentType.includes('application/x-mpegurl') || contentType.includes('application/vnd.apple.mpegurl')) return 'HLS (.m3u8)';
    if (contentType.includes('application/dash+xml')) return 'DASH (.mpd)';
    if (contentType.includes('video/mp4')) return 'Video (MP4)';
    if (contentType.includes('video/webm')) return 'Video (WebM)';
    if (contentType.includes('audio/mpeg') || contentType.includes('audio/mp3')) return 'Audio (MP3)';
    if (contentType.includes('audio/')) return 'Audio (' + contentType.split('/')[1].toUpperCase() + ')';
    if (contentType.includes('video/')) return 'Video (' + contentType.split('/')[1].toUpperCase() + ')';
  }

  switch (ext) {
    case 'm3u8': return 'HLS (m3u8)';
    case 'mpd': return 'DASH (mpd)';
    case 'mp4': return 'Video MP4';
    case 'webm': return 'Video WebM';
    case 'mkv': return 'Video MKV';
    case 'ts': return 'MPEG TS';
    case 'mp3': return 'Audio MP3';
    case 'm4a': return 'Audio M4A';
    default: return ext ? ext.toUpperCase() : 'Media Stream';
  }
}

// Helper lấy SVG icon tương ứng định dạng
function getIconForExt(ext, url) {
  if (url && url.includes('spotify.com')) {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
  }
  if (['mp3', 'm4a', 'ogg', 'wav'].includes(ext)) {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="17" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>`;
}
