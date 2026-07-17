// Tạo nút tải nổi và nhúng vào document.body để luôn nổi lên đầu video
function createDownloadButton(videoElement) {
  if (videoElement.dataset.mediafetchBtn) return; // Nút đã được chèn rồi

  // Tránh hiển thị nút trên các trình phát quảng cáo/video quá nhỏ
  if (videoElement.offsetWidth < 150 || videoElement.offsetHeight < 100) return;
  
  const container = document.createElement('div');
  container.className = 'mediafetch-floating-container';
  
  const button = document.createElement('button');
  button.className = 'mediafetch-floating-btn';
  button.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span>Tải Video</span>
  `;
  
  container.appendChild(button);
  
  // Style cho Container và Nút Nổi bằng CSS Inline để độc lập hoàn toàn khỏi CSS của website
  container.style.position = 'absolute';
  container.style.zIndex = '2147483647'; // Đảm bảo luôn nổi trên cùng mọi player
  container.style.pointerEvents = 'auto';
  container.style.display = 'none';
  
  button.style.display = 'flex';
  button.style.alignItems = 'center';
  button.style.background = 'rgba(30, 30, 46, 0.9)';
  button.style.backdropFilter = 'blur(8px)';
  button.style.border = '1px solid rgba(255, 255, 255, 0.2)';
  button.style.color = '#cdd6f4';
  button.style.padding = '6px 12px';
  button.style.borderRadius = '8px';
  button.style.fontSize = '12px';
  button.style.fontWeight = '600';
  button.style.cursor = 'pointer';
  button.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.5)';
  button.style.transition = 'all 0.2s ease';
  button.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  
  button.addEventListener('mouseenter', () => {
    button.style.background = 'linear-gradient(135deg, #a6e3a1 0%, #89b4fa 100%)';
    button.style.color = '#11111b';
    button.style.border = '1px solid transparent';
    button.style.transform = 'scale(1.05)';
  });
  
  button.addEventListener('mouseleave', () => {
    button.style.background = 'rgba(30, 30, 46, 0.9)';
    button.style.color = '#cdd6f4';
    button.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    button.style.transform = 'scale(1)';
  });
  
  // Chèn trực tiếp vào document.body để không bị z-index hay overflow của video player che khuất
  document.body.appendChild(container);
  videoElement.dataset.mediafetchBtn = 'true';
  
  // Hàm cập nhật tọa độ nút nổi đè lên trên góc trái video
  function updatePosition() {
    const rect = videoElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      container.style.display = 'none';
      return;
    }
    
    // Tính toán tọa độ tuyệt đối trên trang (bao gồm cả khoảng cuộn trang)
    const absoluteTop = rect.top + window.scrollY;
    const absoluteLeft = rect.left + window.scrollX;
    
    // Đặt ở góc trên bên trái của video (cách lề 12px) để luôn hiển thị và dễ bấm
    container.style.top = `${absoluteTop + 12}px`;
    container.style.left = `${absoluteLeft + 12}px`;
  }
  
  let hideTimeout;
  
  function showBtn() {
    clearTimeout(hideTimeout);
    updatePosition();
    container.style.display = 'block';
  }
  
  function hideBtn() {
    hideTimeout = setTimeout(() => {
      container.style.display = 'none';
    }, 2000);
  }
  
  // Lắng nghe các sự kiện di chuột
  videoElement.addEventListener('mouseenter', showBtn);
  videoElement.addEventListener('mousemove', showBtn);
  videoElement.addEventListener('mouseleave', hideBtn);
  container.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
  container.addEventListener('mouseleave', hideBtn);
  
  // Xử lý khi click nút Tải nổi
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    
    let srcUrl = window.location.href;
    const isMajor = ['youtube.com', 'youtu.be', 'facebook.com', 'fb.watch', 'tiktok.com'].some(p => srcUrl.includes(p));
    
    if (!isMajor) {
      const videoSrc = videoElement.src || videoElement.currentSrc;
      if (videoSrc && !videoSrc.startsWith('blob:')) {
        srcUrl = videoSrc;
      }
    }
    
    button.querySelector('span').innerText = 'Đang gửi...';
    
    // Wrap trong try/catch để tránh crash khi Service Worker chưa sẵn sàng
    try {
      chrome.runtime.sendMessage({
        action: 'mediafetch-download',
        url: srcUrl,
        title: document.title
      }, (res) => {
        // Kiểm tra runtime.lastError để tránh unhandled error khi SW bị kill
        if (chrome.runtime.lastError) {
          console.warn('[MediaFetch] SW chưa sẵn sàng:', chrome.runtime.lastError.message);
          button.querySelector('span').innerText = 'App chưa bật!';
          setTimeout(() => { button.querySelector('span').innerText = 'Tải Video'; }, 2500);
          return;
        }
        if (res && res.success) {
          button.querySelector('span').innerText = 'Đã gửi tải!';
        } else {
          button.querySelector('span').innerText = 'Gửi lỗi!';
        }
        setTimeout(() => {
          button.querySelector('span').innerText = 'Tải Video';
        }, 2000);
      });
    } catch (err) {
      console.warn('[MediaFetch] Không gửi được tin nhắn:', err.message);
      button.querySelector('span').innerText = 'Lỗi!';
      setTimeout(() => { button.querySelector('span').innerText = 'Tải Video'; }, 2000);
    }
  });
}

// Quét các thẻ video trong trang
function scanVideos() {
  const videos = document.querySelectorAll('video');
  videos.forEach(createDownloadButton);
}

// Giới hạn scan tối đa MAX_SCANS lần để tránh tốn tài nguyên trên mọi trang
const MAX_SCANS = 20;
let scanCount = 0;
const scanInterval = setInterval(() => {
  scanVideos();
  scanCount++;
  if (scanCount >= MAX_SCANS) {
    clearInterval(scanInterval);
  }
}, 1500);

// Scan ngay lập tức khi content script được inject
scanVideos();

