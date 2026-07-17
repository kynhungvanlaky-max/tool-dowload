// ─── Global Error Guard cho Service Worker MV3 ──────────────────────────────
// Ngăn SW crash toàn bộ khi có Promise rejection không được bắt (unhandled)
self.addEventListener('unhandledrejection', (event) => {
  console.warn('[MediaFetch SW] Unhandled rejection caught:', event.reason);
  event.preventDefault(); // Quan trọng: ngăn Chrome báo lỗi SW
});

self.addEventListener('error', (event) => {
  console.warn('[MediaFetch SW] Global error caught:', event.message);
});

// Danh sách các trang lớn cần kiểm soát link
const MAJOR_PLATFORMS = ['youtube.com', 'youtu.be', 'facebook.com', 'fb.watch', 'tiktok.com', 'spotify.com'];

// Hàm kiểm tra xem một URL có thuộc nền tảng lớn không
function isMajorPlatform(url) {
  return MAJOR_PLATFORMS.some(platform => url.includes(platform));
}

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

    // 4. Spotify (Hỗ trợ bắt link bài hát lẻ, link album, link playlist gốc)
    if (hostname.includes('spotify.com')) {
      if (pathname.includes('/track/') || pathname.includes('/album/') || pathname.includes('/playlist/')) return true;
      return false;
    }
  } catch(e) {}
  
  return false;
}

// Hàm cập nhật Badge số lượng link bắt được trên icon Extension (Realtime Alert)
function updateTabBadge(tabId, count) {
  if (tabId < 0) return;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count), tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#89b4fa', tabId: tabId }); // màu xanh pastel nổi bật
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ color: '#11111b', tabId: tabId });
    }
  } else {
    chrome.action.setBadgeText({ text: '', tabId: tabId });
  }
}

// Xử lý khi URL thay đổi hoặc F5 load lại trang (Realtime Sync & Clean Old Links)
function handleUrlChange(tabId, url, title) {
  if (isMajorPlatformVideo(url)) {
    // MXH lớn & Spotify: Xóa sạch các link cũ, chỉ giữ duy nhất link gốc mới đang xem
    const newLink = {
      url: url,
      name: title || 'Liên kết gốc',
      contentType: 'text/html',
      timestamp: Date.now()
    };
    
    const update = {};
    update[`tab_${tabId}`] = [newLink];
    chrome.storage.local.set(update, () => {
      // Cập nhật badge số lượng là 1
      updateTabBadge(tabId, 1);
      
      // Gửi tin nhắn realtime cho popup đang mở cập nhật giao diện
      chrome.runtime.sendMessage({
        action: 'links-updated',
        tabId: tabId,
        links: [newLink]
      }).catch(() => {});
    });
  } else {
    // Trang web thông thường khác: Xóa sạch link cũ khi chuyển trang mới để chuẩn bị bắt các link stream mới
    chrome.storage.local.remove([`tab_${tabId}`], () => {
      // Cập nhật badge về trống
      updateTabBadge(tabId, 0);
      
      chrome.runtime.sendMessage({
        action: 'links-updated',
        tabId: tabId,
        links: []
      }).catch(() => {});
    });
  }
}

// Lắng nghe khi tab thay đổi URL hoặc load trang
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Bắt sự kiện chuyển video/nhạc trong Single Page App (như YouTube click video tiếp theo, Spotify chuyển bài)
  if (changeInfo.url) {
    handleUrlChange(tabId, changeInfo.url, tab.title);
  }
  // Bắt sự kiện người dùng F5 load lại trang
  else if (changeInfo.status === 'loading' && tab.url) {
    handleUrlChange(tabId, tab.url, tab.title);
  }
});

// Lắng nghe các response headers của network request để bắt Content-Type thông minh
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    // Chỉ xử lý các HTTP GET request
    if (details.method !== 'GET') return;

    const url = details.url;
    
    // 1. Đối với YouTube, Facebook, TikTok, Spotify và các CDN của chúng: Bỏ qua các link nhỏ lẻ tẻ
    if (
      isMajorPlatform(url) || 
      url.includes('googlevideo.com') || 
      url.includes('fbcdn.net') || 
      url.includes('tiktokcdn.com')
    ) {
      return;
    }
    
    // Loại trừ các tệp tĩnh phổ biến để tối ưu hiệu năng
    if (url.match(/\.(png|jpg|jpeg|gif|css|js|woff|woff2|svg|json|ico|webp)(\?|$)/i)) return;

    // Tìm Header Content-Type
    const contentTypeHeader = details.responseHeaders.find(
      h => h.name.toLowerCase() === 'content-type'
    );
    
    let isMedia = false;
    let contentType = 'unknown';

    if (contentTypeHeader) {
      contentType = contentTypeHeader.value.toLowerCase();
      
      // Kiểm tra Content-Type xem có phải video hoặc audio hay không
      if (
        contentType.includes('application/x-mpegurl') || 
        contentType.includes('application/vnd.apple.mpegurl') || // HLS Stream (.m3u8)
        contentType.includes('application/dash+xml') ||          // DASH Stream (.mpd)
        contentType.includes('video/') ||                        // Video (mp4, webm, ts...)
        contentType.includes('audio/')                           // Audio (mp3, m4a, ogg...)
      ) {
        // Bỏ qua các tệp phân đoạn quá nhỏ để tránh rác
        if (url.match(/\.(ts|m4s)(\?|$)/i)) {
          return;
        }
        isMedia = true;
      }
    }

    // Dự phòng kiểm tra theo cấu trúc URL
    if (!isMedia) {
      isMedia = url.match(/\.(m3u8|mpd|mp4|webm|mkv|mp3|m4a|ogg|wav)(\?|$)/i);
    }

    if (isMedia) {
      const tabId = details.tabId;
      if (tabId < 0) return; // Bỏ qua background requests không gắn với tab

      // Lấy danh sách link hiện tại của tab từ storage
      chrome.storage.local.get([`tab_${tabId}`], (result) => {
        let links = result[`tab_${tabId}`] || [];
        
        // Kiểm tra xem link này đã được lưu chưa
        if (!links.some(l => l.url === url)) {
          // Trích xuất tên file sạch đẹp từ URL
          let name = 'Tệp tin Media';
          try {
            const parsedUrl = new URL(url);
            const pathName = parsedUrl.pathname;
            const baseName = pathName.substring(pathName.lastIndexOf('/') + 1);
            if (baseName && !baseName.includes('.')) {
              name = parsedUrl.hostname + ' Stream';
            } else if (baseName) {
              name = decodeURIComponent(baseName);
            }
          } catch(e) {}

          links.push({
            url: url,
            name: name,
            contentType: contentType,
            timestamp: Date.now()
          });

          if (links.length > 50) {
            links.shift();
          }

          const update = {};
          update[`tab_${tabId}`] = links;
          chrome.storage.local.set(update, () => {
            // Cập nhật Badge số lượng link bắt được
            updateTabBadge(tabId, links.length);
          });
        }
      });
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Lắng nghe tin nhắn gửi từ Content Script hoặc Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'mediafetch-download') {
    const url = request.url;
    const pageUrl = sender.tab ? sender.tab.url : '';
    
    console.log('Nhận yêu cầu tải từ content script:', url);

    // Gửi yêu cầu sang Local HTTP Server của Desktop App ở cổng 7788
    fetch('http://localhost:7788/receive-link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: url,
        pageUrl: pageUrl,
        title: request.title || 'Video từ Trang Web'
      })
    })
    .then(res => res.json())
    .then(data => {
      sendResponse({ success: true, data });
    })
    .catch(err => {
      console.error('Lỗi khi gửi link tải sang Desktop App:', err);
      sendResponse({ success: false, error: err.message });
    });

    return true;
  }
  
  // Nhận yêu cầu cập nhật Badge từ Popup
  if (request.action === 'update-badge') {
    updateTabBadge(request.tabId, request.count);
    sendResponse({ success: true });
    return true;
  }
});

// Xóa dữ liệu của tab khi tab bị đóng
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove([`tab_${tabId}`]);
});
