// Các phần tử UI
const urlInput = document.getElementById('url-input');
const btnAnalyze = document.getElementById('btn-analyze');
const analysisPanel = document.getElementById('analysis-panel');
const mediaThumb = document.getElementById('media-thumb');
const mediaDuration = document.getElementById('media-duration');
const mediaTitle = document.getElementById('media-title');
const mediaChannel = document.getElementById('media-channel');
const formatSelect = document.getElementById('format-select');
const btnDownload = document.getElementById('btn-download');
const tabVideo = document.getElementById('tab-video');
const tabAudio = document.getElementById('tab-audio');
const historyList = document.getElementById('history-list');
const btnClearHistory = document.getElementById('btn-clear-history');
const binaryBanner = document.getElementById('binary-status-banner');
const binaryText = document.getElementById('binary-status-text');

// Các phần tử UI mới phục vụ tải Album / Playlist hàng loạt
const singleDownloadOptions = document.getElementById('single-download-options');
const albumDownloadOptions = document.getElementById('album-download-options');
const albumTracksContainer = document.getElementById('album-tracks-container');
const albumTracksList = document.getElementById('album-tracks-list');
const albumTracksCount = document.getElementById('album-tracks-count');
const btnDownloadAlbum = document.getElementById('btn-download-album');
const selectAllTracks = document.getElementById('select-all-tracks');

const playlistQualityWrapper = document.getElementById('playlist-quality-wrapper');
const playlistQualitySelect = document.getElementById('playlist-quality-select');
const albumDescText = document.getElementById('album-desc-text');

let analyzedData = null; // Lưu trữ dữ liệu phân tích hiện tại
let currentTab = 'video'; // 'video' hoặc 'audio'
let currentReferer = ''; // Lưu referer của link để bypass Cloudflare
const expandedGroupIds = new Set(); // Lưu ID các Group đang được mở rộng chi tiết

// ─── Debounce History Re-render ───────────────────────────────────────────
// Khi tải album nhiều bài đồng thời, tương tác này đảm bảo render tối đa 1 lần/frame (60fps)
let _historyRenderPending = false;

function scheduleHistoryRender() {
  if (!_historyRenderPending) {
    _historyRenderPending = true;
    requestAnimationFrame(async () => {
      await loadHistory();
      _historyRenderPending = false;
    });
  }
}

// Khi load app xong
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();

  // Tự động nhận diện thay đổi trạng thái binary từ Main
  if (window.electronAPI.onBinaryStatus) {
    window.electronAPI.onBinaryStatus((data) => {
      if (data.status === 'downloading') {
        binaryBanner.className = 'status-banner info';
        binaryBanner.classList.remove('hidden');
        binaryText.innerText = data.message;
      } else if (data.status === 'ready') {
        binaryBanner.className = 'status-banner success hidden'; // ẩn đi khi ready
      } else if (data.status === 'error') {
        binaryBanner.className = 'status-banner error';
        binaryBanner.classList.remove('hidden');
        binaryText.innerText = data.message;
      }
    });
  }

  // Tự động đồng bộ chất lượng từ dropdown chung xuống các dropdown định dạng chi tiết của từng bài
  playlistQualitySelect.addEventListener('change', () => {
    if (analyzedData && analyzedData.isPlaylist) {
      const selects = albumTracksList.querySelectorAll('.track-quality-select');
      const commonVal = playlistQualitySelect.value;

      selects.forEach(sel => {
        const options = Array.from(sel.options);
        let matchedOption = null;

        if (commonVal === 'bestvideo+bestaudio/best') {
          matchedOption = options[0];
        } else if (commonVal === 'bestaudio') {
          matchedOption = options.find(opt => opt.getAttribute('data-isaudio') === 'true' || opt.value.includes('bestaudio'));
        } else if (commonVal.includes('height<=1080')) {
          matchedOption = options.find(opt => opt.getAttribute('data-height') === '1080' || opt.text.includes('1080p'));
        } else if (commonVal.includes('height<=720')) {
          matchedOption = options.find(opt => opt.getAttribute('data-height') === '720' || opt.text.includes('720p'));
        } else if (commonVal.includes('height<=480')) {
          matchedOption = options.find(opt => opt.getAttribute('data-height') === '480' || opt.text.includes('480p'));
        } else if (commonVal.includes('height<=360')) {
          matchedOption = options.find(opt => opt.getAttribute('data-height') === '360' || opt.text.includes('360p'));
        }

        if (matchedOption) {
          sel.value = matchedOption.value;
        } else {
          sel.selectedIndex = 0;
        }
      });
    }
  });

  // Lắng nghe sự kiện click Chọn tất cả
  if (selectAllTracks) {
    selectAllTracks.addEventListener('change', () => {
      const isChecked = selectAllTracks.checked;
      const checkboxes = albumTracksList.querySelectorAll('.track-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = isChecked;
      });
      updateAlbumTracksCount();
    });
  }
});

// Sự kiện click nút Phân tích
btnAnalyze.addEventListener('click', analyzeUrl);
urlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    analyzeUrl();
  }
});

// Hàm phân tích URL
async function analyzeUrl() {
  const url = urlInput.value.trim();
  if (!url) return;

  btnAnalyze.disabled = true;
  const originalText = btnAnalyze.innerText;
  btnAnalyze.innerText = 'Đang quét...';

  analysisPanel.classList.add('hidden');
  albumTracksContainer.classList.add('hidden');
  albumDownloadOptions.classList.add('hidden');
  singleDownloadOptions.classList.add('hidden');

  try {
    const res = await window.electronAPI.analyzeUrl(url, currentReferer);
    currentReferer = ''; // Reset referer sau khi phân tích xong

    if (res.success) {
      analyzedData = res;
      mediaThumb.src = res.thumbnail || 'placeholder.jpg';
      mediaTitle.innerText = res.title;
      mediaChannel.innerText = res.channel || 'Nguồn video';
      mediaDuration.innerText = res.duration || '00:00';

      analysisPanel.classList.remove('hidden');

      if (res.isAlbum) {
        // TẢI HÀNG LOẠT (Spotify Album/Playlist hoặc YouTube Playlist)
        albumDescText.innerText = `Phát hiện ${res.isPlaylist ? 'Playlist YouTube' : 'Album Spotify'}. Bạn có thể tùy chọn chất lượng hoặc click tải toàn bộ về thư mục con riêng biệt.`;
        albumDownloadOptions.classList.remove('hidden');

        // Hiển thị chọn chất lượng chung nếu là YouTube Playlist
        if (res.isPlaylist) {
          playlistQualityWrapper.classList.remove('hidden');
        } else {
          playlistQualityWrapper.classList.add('hidden');
        }

        renderAlbumTracks(res.tracks, res.isPlaylist);
        if (res.isPlaylist) {
          playlistQualitySelect.dispatchEvent(new Event('change'));
        }
        albumTracksContainer.classList.remove('hidden');
      } else {
        // TẢI LẺ 1 VIDEO/AUDIO THÔNG THƯỜNG
        singleDownloadOptions.classList.remove('hidden');
        renderFormats(res.formats);
      }
    } else {
      alert('Không phân tích được liên kết: ' + res.error);
    }
  } catch (error) {
    alert('Lỗi kết nối hoặc xử lý: ' + error.message);
  } finally {
    btnAnalyze.disabled = false;
    btnAnalyze.innerText = originalText;
  }
}

// Render các formats của video lẻ lên dropdown
function renderFormats(formats) {
  formatSelect.innerHTML = '';
  if (!formats || formats.length === 0) {
    formatSelect.innerHTML = '<option value="best">Chất lượng tốt nhất (Mặc định)</option>';
    return;
  }

  // Lọc định dạng theo tab đang chọn (video/audio)
  const isAudioTab = currentTab === 'audio';
  let filtered = formats;

  if (isAudioTab) {
    filtered = [{
      id: 'bestaudio',
      ext: 'mp3',
      resolution: 'Audio chất lượng cao',
      size: '--'
    }];
  }

  filtered.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.text = `${f.resolution} (${f.ext.toUpperCase()}) ${f.size ? `- ${f.size}` : ''}`;
    formatSelect.appendChild(opt);
  });
}

// Render danh sách các bài hát trong Album / Playlist lên UI
function renderAlbumTracks(tracks, isPlaylist) {
  albumTracksList.innerHTML = '';

  // Đặt lại checkbox Chọn tất cả là checked khi render danh sách mới
  if (selectAllTracks) {
    selectAllTracks.checked = true;
  }

  tracks.forEach((track, index) => {
    const item = document.createElement('div');
    item.className = 'album-track-item';

    let qualitySelectHtml = '';

    // Nếu là Playlist YouTube, cho phép chọn chất lượng định dạng chi tiết riêng từng video
    if (isPlaylist) {
      const formats = track.formats || [];
      qualitySelectHtml = `
        <select class="track-quality-select" data-index="${index}">
          ${formats.map(f => {
        const isAudio = f.id === 'bestaudio';
        const sizeLabel = f.size ? `- ${f.size}` : '';
        return `<option value="${f.id}" data-height="${f.height || ''}" data-isaudio="${isAudio}">${f.resolution} (${f.ext.toUpperCase()}) ${sizeLabel}</option>`;
      }).join('')}
          ${formats.length === 0 ? '<option value="bestvideo+bestaudio/best">Tốt nhất (.mp4)</option>' : ''}
        </select>
      `;
    }

    item.innerHTML = `
      <input type="checkbox" class="track-checkbox" data-index="${index}" checked>
      <div class="track-index">${index + 1}</div>
      <div class="track-details">
        <div class="track-title" title="${track.title}">${track.title}</div>
        <div class="track-artist">${track.artist || ''}</div>
      </div>
      ${qualitySelectHtml}
    `;

    // Đăng ký listener thay đổi checkbox bài hát con để cập nhật checkbox Chọn tất cả và số lượng hiển thị
    const cb = item.querySelector('.track-checkbox');
    if (cb) {
      cb.addEventListener('change', () => {
        const allCheckboxes = albumTracksList.querySelectorAll('.track-checkbox');
        const allChecked = Array.from(allCheckboxes).every(c => c.checked);
        if (selectAllTracks) {
          selectAllTracks.checked = allChecked;
        }
        updateAlbumTracksCount(tracks.length);
      });
    }

    albumTracksList.appendChild(item);
  });

  // Cập nhật số lượng hiển thị ban đầu
  updateAlbumTracksCount(tracks.length);
}

// Cập nhật số lượng bài hát đã được check
function updateAlbumTracksCount(totalTracks) {
  if (!albumTracksList) return;
  const checkboxes = albumTracksList.querySelectorAll('.track-checkbox');
  const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
  const total = totalTracks || checkboxes.length;
  if (albumTracksCount) {
    if (checkedCount === total) {
      albumTracksCount.innerText = total;
    } else {
      albumTracksCount.innerText = `${checkedCount} / ${total}`;
    }
  }
}

// Xử lý chuyển đổi Tab Video / Audio của tải lẻ
tabVideo.addEventListener('click', () => {
  if (currentTab === 'video') return;
  currentTab = 'video';
  tabVideo.classList.add('active');
  tabAudio.classList.remove('active');
  if (analyzedData && !analyzedData.isAlbum) {
    renderFormats(analyzedData.formats);
  }
});

tabAudio.addEventListener('click', () => {
  if (currentTab === 'audio') return;
  currentTab = 'audio';
  tabAudio.classList.add('active');
  tabVideo.classList.remove('active');
  if (analyzedData && !analyzedData.isAlbum) {
    renderFormats(analyzedData.formats);
  }
});

// Bắt đầu tải xuống bài hát lẻ
btnDownload.addEventListener('click', async () => {
  if (!analyzedData) return;

  const formatId = formatSelect.value;
  const url = urlInput.value.trim();
  const title = analyzedData.title;
  const thumbnail = analyzedData.thumbnail;
  const isAudio = currentTab === 'audio';

  btnDownload.disabled = true;

  try {
    let ref = currentReferer;
    if (!ref && url.startsWith('http')) {
      try {
        const u = new URL(url);
        ref = u.origin + '/';
      } catch (e) { }
    }
    const res = await window.electronAPI.startDownload({
      url,
      formatId,
      isAudio,
      title,
      thumbnail,
      referer: ref
    });

    if (res.success) {
      await loadHistory();
      urlInput.value = '';
      analysisPanel.classList.add('hidden');
      activateTab('nav-history');
    } else {
      alert('Không thể tải xuống: ' + res.error);
    }
  } catch (error) {
    alert('Lỗi tải xuống: ' + error.message);
  } finally {
    btnDownload.disabled = false;
  }
});

// Bắt đầu tải xuống toàn bộ Album Spotify hoặc Playlist YouTube hàng loạt
btnDownloadAlbum.addEventListener('click', async () => {
  if (!analyzedData || !analyzedData.isAlbum) return;

  // Lọc lấy danh sách các track có checkbox được check
  const checkboxes = albumTracksList.querySelectorAll('.track-checkbox');
  const selectedTracksIndices = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => parseInt(cb.getAttribute('data-index'), 10));

  if (selectedTracksIndices.length === 0) {
    alert('Vui lòng chọn ít nhất một bài hát để tải xuống!');
    return;
  }

  btnDownloadAlbum.disabled = true;
  const labelText = btnDownloadAlbum.querySelector('span');
  const originalText = labelText.innerText;
  labelText.innerText = 'Đang xếp hàng tải...';

  // Lấy danh sách track kèm theo chất lượng được chọn riêng cho từng bài hát con (chỉ gửi các bài đã check)
  const tracksToSend = selectedTracksIndices.map((index) => {
    const track = analyzedData.tracks[index];
    if (analyzedData.isPlaylist) {
      const selectEl = albumTracksList.querySelector(`.track-quality-select[data-index="${index}"]`);
      const selectedQuality = selectEl ? selectEl.value : 'bestvideo+bestaudio/best';
      return {
        ...track,
        quality: selectedQuality
      };
    }
    return track;
  });

  try {
    const res = await window.electronAPI.startAlbumDownload({
      tracks: tracksToSend,
      thumbnail: analyzedData.thumbnail,
      albumTitle: analyzedData.title,
      isPlaylist: analyzedData.isPlaylist || false,
      quality: playlistQualitySelect.value // Chất lượng chung dự phòng
    });

    if (res.success) {
      setTimeout(async () => {
        await loadHistory();
        activateTab('nav-history');
      }, 1000);

      urlInput.value = '';
      analysisPanel.classList.add('hidden');
    } else {
      alert('Lỗi tải hàng loạt: ' + res.error);
    }
  } catch (error) {
    alert('Lỗi tải hàng loạt: ' + error.message);
  } finally {
    btnDownloadAlbum.disabled = false;
    labelText.innerText = originalText;
  }
});

// Load lịch sử tải xuống
async function loadHistory() {
  try {
    const history = await window.electronAPI.getHistory();
    renderHistory(history);
  } catch (error) {
    console.error('Không thể load lịch sử:', error);
  }
}

// Render danh sách lịch sử tải
function renderHistory(history) {
  historyList.innerHTML = '';

  if (history.length === 0) {
    historyList.innerHTML = `
      <div class="empty-history">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <p>Chưa có file tải xuống nào</p>
      </div>
    `;
    return;
  }

  history.forEach(item => {
    const card = document.createElement('div');
    card.className = `history-item ${item.isGroup ? 'group-item' : ''}`;
    card.id = `history-item-${item.id}`;

    let pbClass = '';
    if (item.status === 'completed') pbClass = 'completed';
    if (item.status === 'error') pbClass = 'error';

    if (item.isGroup) {
      // 1. RENDER THẺ LỊCH SỬ GOM NHÓM (Album/Playlist)
      card.innerHTML = `
        <div class="history-item-top">
          <img class="history-thumb" src="${item.thumbnail || 'placeholder.jpg'}" alt="Thumb">
          <div class="history-info">
            <div class="history-title" title="${item.title}">${item.title} <span class="format-badge">${item.groupType === 'playlist' ? 'Playlist' : 'Album'}</span></div>
            <div class="history-meta">
              <span>${item.date.split(',')[0]}</span>
              <span>•</span>
              <span class="history-status-label">${getStatusLabel(item.status)}</span>
            </div>
          </div>
        </div>
        
        <div class="history-item-progress">
          <div class="progress-bar-container">
            <div class="progress-bar ${pbClass}" style="width: ${item.progress}%"></div>
          </div>
          <div class="progress-details">
            <span class="speed-txt">${item.speed || ''}</span>
            <span class="eta-txt">${item.progress > 0 && item.progress < 100 ? `Tải ${item.progress}%` : ''}</span>
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
          <button class="group-details-toggle ${expandedGroupIds.has(item.id) ? 'expanded' : ''}" data-target="${item.id}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
            <span>Chi tiết bài hát</span>
          </button>
          
          <div class="history-actions" style="margin-top: 0;">
            ${renderActionButtons(item)}
          </div>
        </div>

        <div class="group-sub-list ${expandedGroupIds.has(item.id) ? 'show' : ''}" id="sub-list-${item.id}">
          ${item.subItems.map(sub => {
        let subPbClass = '';
        if (sub.status === 'completed') subPbClass = 'completed';
        if (sub.status === 'error') subPbClass = 'error';
        const subLabel = sub.status === 'completed' ? 'Xong' : (sub.status === 'downloading' ? `${sub.progress}% (${sub.speed})` : getStatusLabel(sub.status));
        return `
              <div class="sub-track-item" id="sub-item-${sub.id}">
                <div class="sub-track-top">
                  <span class="sub-track-title" title="${sub.title}">${sub.title}</span>
                  <span class="sub-track-status">${subLabel}</span>
                </div>
                <div class="sub-track-progress-container">
                  <div class="sub-track-progress ${subPbClass}" style="width: ${sub.progress}%"></div>
                </div>
              </div>
            `;
      }).join('')}
        </div>
      `;

      // Đăng ký sự kiện Click Toggle mở rộng/thu nhỏ danh sách bài hát con
      const toggleBtn = card.querySelector('.group-details-toggle');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const subList = card.querySelector('.group-sub-list');
          if (subList) {
            const isShow = subList.classList.contains('show');
            if (isShow) {
              subList.classList.remove('show');
              toggleBtn.classList.remove('expanded');
              expandedGroupIds.delete(item.id);
            } else {
              subList.classList.add('show');
              toggleBtn.classList.add('expanded');
              expandedGroupIds.add(item.id);
            }
          }
        });
      }

    } else {
      // 2. RENDER THẺ LỊCH SỬ ĐƠN LẺ THÔNG THƯỜNG
      card.innerHTML = `
        <div class="history-item-top">
          <img class="history-thumb" src="${item.thumbnail || 'placeholder.jpg'}" alt="Thumb">
          <div class="history-info">
            <div class="history-title" title="${item.title}">${item.title}</div>
            <div class="history-meta">
              <span>${item.date.split(',')[0]}</span>
              <span>•</span>
              <span class="history-status-label">${getStatusLabel(item.status)}</span>
            </div>
          </div>
        </div>
        
        <div class="history-item-progress">
          <div class="progress-bar-container">
            <div class="progress-bar ${pbClass}" style="width: ${item.progress}%"></div>
          </div>
          <div class="progress-details">
            <span class="speed-txt">${item.speed || ''}</span>
            <span class="eta-txt">${item.progress > 0 && item.progress < 100 ? `ETA ${item.eta}` : item.size || ''}</span>
          </div>
        </div>

        <div class="history-actions">
          ${renderActionButtons(item)}
        </div>
      `;
    }

    historyList.appendChild(card);
    setupActionListeners(card, item);
  });
}

function getStatusLabel(status) {
  switch (status) {
    case 'downloading': return 'Đang tải';
    case 'paused': return 'Tạm dừng';
    case 'completed': return 'Đã xong';
    case 'error': return 'Lỗi';
    case 'cancelled': return 'Đã hủy';
    case 'pending': return 'Đang chờ';
    default: return status;
  }
}

function renderActionButtons(item) {
  if (item.status === 'downloading') {
    return `
      <button class="btn-icon btn-pause" title="Tạm dừng">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
      </button>
      <button class="btn-icon danger btn-cancel" title="Hủy tải">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `;
  } else if (item.status === 'paused') {
    return `
      <button class="btn-icon btn-resume" title="Tiếp tục tải">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      </button>
      <button class="btn-icon danger btn-cancel" title="Hủy tải">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `;
  } else if (item.status === 'completed') {
    // Với group item, ta mở thư mục cha chứa Album/Playlist
    return `
      <button class="btn-icon btn-open" title="Mở thư mục chứa file">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
      </button>
      <button class="btn-icon danger btn-delete" title="Xóa khỏi lịch sử">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    `;
  } else {
    return `
      <button class="btn-icon btn-resume" title="Tải lại">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
      </button>
      <button class="btn-icon danger btn-delete" title="Xóa">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    `;
  }
}

function setupActionListeners(card, item) {
  const btnPause = card.querySelector('.btn-pause');
  const btnResume = card.querySelector('.btn-resume');
  const btnCancel = card.querySelector('.btn-cancel');
  const btnOpen = card.querySelector('.btn-open');
  const btnDelete = card.querySelector('.btn-delete');

  if (btnPause) {
    btnPause.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.electronAPI.pauseDownload(item.id);
      loadHistory();
    });
  }

  if (btnResume) {
    btnResume.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.electronAPI.resumeDownload(item.id);
      loadHistory();
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(item.isGroup ? 'Bạn chắc chắn muốn hủy tải Album/Playlist này?' : 'Bạn chắc chắn muốn hủy tải video này?')) {
        await window.electronAPI.cancelDownload(item.id);
        loadHistory();
      }
    });
  }

  if (btnOpen) {
    btnOpen.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Nếu là group item, ta mở folder Album, nếu tải lẻ ta mở folder chứa tệp
      let targetPath = item.filePath;
      if (item.isGroup) {
        // Đường dẫn thư mục Album/Playlist: defaultDownloadDir + cleanTitle
        const downloadDir = await window.electronAPI.getDownloadDir();
        const cleanTitle = item.title.replace(/[\\/:*?"<>|]/g, '_').trim();
        targetPath = `${downloadDir}/${cleanTitle}`;
      }
      const opened = await window.electronAPI.openFileLocation(targetPath);
      if (!opened) {
        alert('Thư mục hoặc File không tồn tại hoặc đã bị di chuyển.');
      }
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.electronAPI.deleteHistoryItem(item.id);
      loadHistory();
    });
  }
}

// Xóa toàn bộ lịch sử
btnClearHistory.addEventListener('click', async () => {
  if (confirm('Bạn muốn xóa toàn bộ lịch sử tải xuống?')) {
    await window.electronAPI.clearHistory();
    loadHistory();
  }
});

// Lắng nghe tiến trình tải từ Main gửi sang
window.electronAPI.onDownloadProgress((data) => {
  // Cập nhật DOM trực tiếp cho item cụ thể (không re-render toàn bộ)
  const card = document.getElementById(`history-item-${data.id}`);
  if (!card) {
    // Nếu chưa có card (item mới), schedule re-render đầy đủ
    scheduleHistoryRender();
    return;
  }

  const pb = card.querySelector('.progress-bar');
  if (pb) pb.style.width = `${data.progress}%`;

  const speedTxt = card.querySelector('.speed-txt');
  if (speedTxt) speedTxt.innerText = data.speed;

  const etaTxt = card.querySelector('.eta-txt');
  if (etaTxt) {
    if (data.status === 'paused') {
      etaTxt.innerText = '--';
    } else if (data.progress > 0 && data.progress < 100) {
      etaTxt.innerText = data.isGroup ? `Tải ${data.progress}%` : `ETA ${data.eta}`;
    } else {
      etaTxt.innerText = data.size || '';
    }
  }

  const statusLabel = card.querySelector('.history-status-label');
  if (statusLabel) statusLabel.innerText = getStatusLabel(data.status);

  // Nếu là Group, cập nhật thêm tiến trình của từng subItem con
  if (data.isGroup && data.subItems) {
    data.subItems.forEach(sub => {
      const subEl = card.querySelector(`#sub-item-${sub.id}`);
      if (subEl) {
        const subStatus = subEl.querySelector('.sub-track-status');
        if (subStatus) {
          subStatus.innerText = sub.status === 'completed' ? 'Xong' : (sub.status === 'downloading' ? `${sub.progress}% (${sub.speed})` : getStatusLabel(sub.status));
        }

        const subPb = subEl.querySelector('.sub-track-progress');
        if (subPb) {
          subPb.style.width = `${sub.progress}%`;
          // Cập nhật màu sắc progress bar con theo trạng thái
          subPb.className = 'sub-track-progress';
          if (sub.status === 'completed') subPb.classList.add('completed');
          if (sub.status === 'error') subPb.classList.add('error');
        }
      }
    });
  }
});


window.electronAPI.onDownloadComplete((data) => {
  loadHistory(); // Full re-render khi một bài hoàn tất
});

window.electronAPI.onDownloadError((data) => {
  loadHistory(); // Full re-render khi xảy ra lỗi
});

// Lắng nghe link gửi từ Browser Extension
if (window.electronAPI.onExternalLinkReceived) {
  window.electronAPI.onExternalLinkReceived((data) => {
    if (data && data.url) {
      urlInput.value = data.url;
      currentReferer = data.pageUrl || '';

      // Tự động chuyển về trang chủ
      if (navHome) {
        navHome.click();
      }

      // Kiểm tra autoAnalyze từ settings để tự động Phân tích
      if (appSettings && appSettings.autoAnalyze !== false) {
        analyzeUrl();
      }
    }
  });
}

// ==========================================================================
// Khởi tạo hệ thống Tab & Cấu hình Settings
// ==========================================================================

// Tab Elements
const navHome = document.getElementById('nav-home');
const navHistory = document.getElementById('nav-history');
const navFailed = document.getElementById('nav-failed');
const navExtension = document.getElementById('nav-extension');
const navGuide = document.getElementById('nav-guide');
const navSettings = document.getElementById('nav-settings');

const sectionHome = document.getElementById('section-home');
const sectionHistory = document.getElementById('section-history');
const sectionFailed = document.getElementById('section-failed');
const sectionExtension = document.getElementById('section-extension');
const sectionGuide = document.getElementById('section-guide');
const sectionSettings = document.getElementById('section-settings');

const tabsList = [
  { button: navHome, section: sectionHome },
  { button: navHistory, section: sectionHistory },
  { button: navFailed, section: sectionFailed },
  { button: navExtension, section: sectionExtension },
  { button: navGuide, section: sectionGuide },
  { button: navSettings, section: sectionSettings }
];

// Click chuyển tab
function activateTab(tabId) {
  const target = tabsList.find(t => t.button && t.button.id === tabId);
  if (target) {
    tabsList.forEach(t => {
      if (t.button) t.button.classList.remove('active');
      if (t.section) t.section.classList.add('hidden');
    });
    target.button.classList.add('active');
    target.section.classList.remove('hidden');

    // Nếu mở tab extension, tự động kiểm tra trạng thái kết nối
    if (tabId === 'nav-extension') {
      updateConnectionStatus();
    }

    // Nếu mở tab Lỗi Tải, nạp danh sách link lỗi
    if (tabId === 'nav-failed') {
      loadFailedLinks();
    }
  }
}

tabsList.forEach(item => {
  if (item.button && item.section) {
    item.button.addEventListener('click', () => {
      activateTab(item.button.id);
    });
  }
});

// Settings Elements
const settingDownloadDir = document.getElementById('setting-download-dir');
const btnBrowseFolder = document.getElementById('btn-browse-folder');
const settingCreateSubdir = document.getElementById('setting-create-subdir');
const settingRateLimit = document.getElementById('setting-rate-limit');
const settingAlbumDelay = document.getElementById('setting-album-delay');
const settingPort = document.getElementById('setting-port');
const settingAutofocus = document.getElementById('setting-autofocus');
const settingAutoanalyze = document.getElementById('setting-autoanalyze');
const settingAccentColor = document.getElementById('setting-accent-color');
const accentColorHex = document.getElementById('accent-color-hex');
const settingShowThumbnails = document.getElementById('setting-show-thumbnails');
const settingCloseAction = document.getElementById('setting-close-action');
const settingStartWithWindows = document.getElementById('setting-start-with-windows');
const settingStartWithBrowser = document.getElementById('setting-start-with-browser');
const settingsSaveIndicator = document.getElementById('settings-save-indicator');

let appSettings = {};
let saveTimeout = null;

// Nạp thông tin cấu hình từ settings.json
async function loadAppSettings() {
  try {
    appSettings = await window.electronAPI.getSettings();
    if (appSettings) {
      if (settingDownloadDir) settingDownloadDir.value = appSettings.downloadDir || '';
      if (settingCreateSubdir) settingCreateSubdir.checked = appSettings.createSubDirForAlbum !== false;
      if (settingRateLimit) settingRateLimit.value = appSettings.rateLimit || 'infinite';
      if (settingAlbumDelay) settingAlbumDelay.value = appSettings.albumDelay || 1200;
      if (settingPort) settingPort.value = appSettings.port || 7788;
      if (settingAutofocus) settingAutofocus.checked = appSettings.autoFocus !== false;
      if (settingAutoanalyze) settingAutoanalyze.checked = appSettings.autoAnalyze !== false;
      if (settingAccentColor) settingAccentColor.value = appSettings.accentColor || '#7c3aed';
      if (accentColorHex) accentColorHex.innerText = appSettings.accentColor || '#7c3aed';
      if (settingShowThumbnails) settingShowThumbnails.checked = appSettings.showThumbnails !== false;
      if (settingCloseAction) settingCloseAction.value = appSettings.closeAction || 'ask';
      if (settingStartWithWindows) settingStartWithWindows.checked = !!appSettings.startWithWindows;
      if (settingStartWithBrowser) settingStartWithBrowser.checked = !!appSettings.startWithBrowser;

      // Áp dụng màu giao diện
      applyAccentColor(appSettings.accentColor || '#7c3aed');
    }
  } catch (e) {
    console.error('Không thể load cấu hình app:', e);
  }
}

// Áp dụng màu nhấn giao diện dynamically
function applyAccentColor(hexColor) {
  if (!hexColor) return;
  document.documentElement.style.setProperty('--border-focus', `${hexColor}80`);

  let customStyleEl = document.getElementById('custom-accent-styles');
  if (!customStyleEl) {
    customStyleEl = document.createElement('style');
    customStyleEl.id = 'custom-accent-styles';
    document.head.appendChild(customStyleEl);
  }

  let thumbnailRule = '';
  if (appSettings && appSettings.showThumbnails === false) {
    thumbnailRule = '.history-thumb { display: none !important; }';
  }

  customStyleEl.innerHTML = `
    .switch input:checked + .slider-round { background-color: ${hexColor} !important; }
    .nav-tab.active { background: linear-gradient(135deg, ${hexColor} 0%, #4f46e5 100%) !important; }
    .btn-primary { background: linear-gradient(135deg, ${hexColor} 0%, #4f46e5 100%) !important; }
    .btn-success-gradient { background: linear-gradient(135deg, ${hexColor} 0%, #4f46e5 100%) !important; }
    ::-webkit-scrollbar-thumb:hover { background: ${hexColor}80 !important; }
    ${thumbnailRule}
  `;
}

// Hiển thị thông báo lưu thành công
function showSaveIndicator() {
  if (settingsSaveIndicator) {
    settingsSaveIndicator.classList.add('show');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      settingsSaveIndicator.classList.remove('show');
    }, 2000);
  }
}

// Lưu cấu hình xuống settings.json
async function saveCurrentSettings() {
  const current = {
    downloadDir: settingDownloadDir ? settingDownloadDir.value : '',
    createSubDirForAlbum: settingCreateSubdir ? settingCreateSubdir.checked : true,
    rateLimit: settingRateLimit ? settingRateLimit.value : 'infinite',
    albumDelay: settingAlbumDelay ? parseInt(settingAlbumDelay.value, 10) : 1200,
    port: settingPort ? parseInt(settingPort.value, 10) : 7788,
    autoFocus: settingAutofocus ? settingAutofocus.checked : true,
    autoAnalyze: settingAutoanalyze ? settingAutoanalyze.checked : true,
    accentColor: settingAccentColor ? settingAccentColor.value : '#7c3aed',
    showThumbnails: settingShowThumbnails ? settingShowThumbnails.checked : true,
    closeAction: settingCloseAction ? settingCloseAction.value : 'ask',
    minimizeToTray: settingCloseAction ? (settingCloseAction.value === 'tray') : false,
    startWithWindows: settingStartWithWindows ? settingStartWithWindows.checked : false,
    startWithBrowser: settingStartWithBrowser ? settingStartWithBrowser.checked : false,
  };

  try {
    const saved = await window.electronAPI.saveSettings(current);
    if (saved) {
      appSettings = saved;
      applyAccentColor(current.accentColor);
      if (accentColorHex) accentColorHex.innerText = current.accentColor;
      showSaveIndicator();
    }
  } catch (e) {
    console.error('Không thể lưu cấu hình:', e);
  }
}

// Chọn thư mục lưu
if (btnBrowseFolder) {
  btnBrowseFolder.addEventListener('click', async () => {
    const selectedPath = await window.electronAPI.openFolderPicker();
    if (selectedPath && settingDownloadDir) {
      settingDownloadDir.value = selectedPath;
      saveCurrentSettings();
    }
  });
}


// Lắng nghe cập nhật settings từ main process
if (window.electronAPI.onSettingsUpdated) {
  window.electronAPI.onSettingsUpdated((newSettings) => {
    appSettings = newSettings;
    if (settingCloseAction) settingCloseAction.value = newSettings.closeAction || 'ask';
    if (settingStartWithWindows) settingStartWithWindows.checked = !!newSettings.startWithWindows;
    if (settingStartWithBrowser) settingStartWithBrowser.checked = !!newSettings.startWithBrowser;
  });
}

// Gán lắng nghe thay đổi tự động cho các control
const settingControls = [
  settingCreateSubdir,
  settingRateLimit,
  settingAlbumDelay,
  settingPort,
  settingAutofocus,
  settingAutoanalyze,
  settingAccentColor,
  settingShowThumbnails,
  settingCloseAction,
  settingStartWithWindows,
  settingStartWithBrowser,
];

settingControls.forEach(ctrl => {
  if (ctrl) {
    ctrl.addEventListener('change', saveCurrentSettings);
  }
});

// Mở thư mục extension trên explorer
const btnOpenExtFolder = document.getElementById('btn-open-ext-folder');
if (btnOpenExtFolder) {
  btnOpenExtFolder.addEventListener('click', async () => {
    const opened = await window.electronAPI.openExtensionFolder();
    if (!opened) {
      alert('Không tìm thấy thư mục Extension đi kèm của ứng dụng.');
    }
  });
}



// Copy đường dẫn thư mục Extension
const btnCopyExtPath = document.getElementById('btn-copy-ext-path');
if (btnCopyExtPath) {
  btnCopyExtPath.addEventListener('click', async () => {
    btnCopyExtPath.disabled = true;
    try {
      const ok = await window.electronAPI.copyExtensionPath();
      if (ok) {
        alert('Đã copy đường dẫn tuyệt đối của thư mục Extension vào clipboard!\n\nCách sử dụng đúng:\n1. Mở trang quản lý tiện ích (ví dụ: chrome://extensions/)\n2. Bật "Developer Mode"\n3. Chọn "Load unpacked" → Mở File Explorer ở bất kỳ đâu\n4. Click vào ô địa chỉ (Address Bar) của Explorer → Paste (Ctrl+V) đường dẫn đã copy → Enter\n5. Chọn thư mục vừa mở là xong!');
      }
    } catch (e) {
      alert('Lỗi: ' + e.message);
    } finally {
      btnCopyExtPath.disabled = false;
    }
  });
}

// Cài đặt tự động vĩnh viễn lên Chrome chính (Registry Policy)
const btnInstallPolicy = document.getElementById('btn-install-policy');
if (btnInstallPolicy) {
  btnInstallPolicy.addEventListener('click', async () => {
    // 1. Hiển thị cảnh báo tắt trình duyệt Chrome
    const confirmInstall = confirm(
      '⚠️ Cảnh báo khởi động lại Google Chrome:\n\n' +
      'Để cài đặt tự động tiện ích mở rộng, ứng dụng cần phải TẮT HOÀN TOÀN trình duyệt Google Chrome hiện tại của bạn.\n\n' +
      'Hãy chắc chắn bạn đã LƯU LẠI công việc đang làm dở trên trình duyệt.\n\n' +
      'Bạn có chắc chắn muốn tiếp tục?'
    );
    if (!confirmInstall) return;

    btnInstallPolicy.disabled = true;
    const originalText = btnInstallPolicy.innerText;
    btnInstallPolicy.innerText = 'Đang tự động cài...';
    try {
      const res = await window.electronAPI.installChromeExtPolicy();
      if (res.success) {
        alert(
          '🎉 Cài đặt tự động thành công!\n\n' +
          'Google Chrome đã được khởi động lại sạch sẽ và tự động nạp sẵn tiện ích mở rộng MediaFetch Helper.'
        );
      } else {
        alert('Lỗi khi cài đặt tự động: ' + res.error);
      }
    } catch (e) {
      alert('Lỗi: ' + e.message);
    } finally {
      btnInstallPolicy.disabled = false;
      btnInstallPolicy.innerText = originalText;
    }
  });
}

// Gỡ cài đặt extension khỏi Chrome (Registry Policy)
const btnUninstallPolicy = document.getElementById('btn-uninstall-policy');
if (btnUninstallPolicy) {
  btnUninstallPolicy.addEventListener('click', async () => {
    if (!confirm('Bạn có chắc chắn muốn gỡ cài đặt Extension khỏi Chrome chính?')) return;
    btnUninstallPolicy.disabled = true;
    try {
      const res = await window.electronAPI.uninstallChromeExtPolicy();
      if (res.success) {
        alert('Đã gỡ cài đặt Extension thành công khỏi Google Chrome của bạn!');
      } else {
        alert('Lỗi khi gỡ cài đặt: ' + res.error);
      }
    } catch (e) {
      alert('Lỗi: ' + e.message);
    } finally {
      btnUninstallPolicy.disabled = false;
    }
  });
}

// Kiểm tra kết nối extension với local server
const btnRecheckConnection = document.getElementById('btn-recheck-connection');
const checkerStatusDot = document.getElementById('checker-status-dot');
const checkerStatusTitle = document.getElementById('checker-status-title');
const checkerStatusDesc = document.getElementById('checker-status-desc');

async function updateConnectionStatus() {
  if (!checkerStatusDot || !checkerStatusTitle || !checkerStatusDesc) return;

  checkerStatusDot.className = 'status-dot-large warning';
  checkerStatusTitle.innerText = 'Đang kiểm tra...';

  try {
    const status = await window.electronAPI.checkServerStatus();
    const serverBanner = document.getElementById('server-status-banner');
    const serverText = document.getElementById('server-status-text');

    if (status && status.running) {
      checkerStatusDot.className = 'status-dot-large active';
      checkerStatusTitle.innerText = 'Đã kết nối thành công!';

      if (status.port !== status.configuredPort) {
        checkerStatusDesc.innerText = `Local server đang chạy trên cổng phụ ${status.port} (Cổng ${status.configuredPort} bị chiếm).`;
        if (serverBanner && serverText) {
          serverBanner.className = 'status-banner warning';
          serverBanner.classList.remove('hidden');
          serverText.innerText = `⚠️ Cổng mặc định ${status.configuredPort} bị chiếm dụng. Đã tự chuyển sang cổng ${status.port}. Hãy đổi cổng trong extension thành ${status.port}.`;
        }
      } else {
        checkerStatusDesc.innerText = `Local server đang hoạt động tốt trên cổng ${status.port}.`;
        if (serverBanner) serverBanner.classList.add('hidden');
      }
    } else {
      checkerStatusDot.className = 'status-dot-large';
      checkerStatusTitle.innerText = 'Chưa kết nối';
      checkerStatusDesc.innerText = 'Local server không chạy hoặc cổng đã bị chiếm.';
      if (serverBanner && serverText) {
        serverBanner.className = 'status-banner error';
        serverBanner.classList.remove('hidden');
        serverText.innerText = '❌ Local server không hoạt động hoặc cổng đã bị chiếm dụng hoàn toàn!';
      }
    }
  } catch (e) {
    checkerStatusDot.className = 'status-dot-large';
    checkerStatusTitle.innerText = 'Lỗi kết nối';
    checkerStatusDesc.innerText = e.message;
  }
}

if (btnRecheckConnection) {
  btnRecheckConnection.addEventListener('click', updateConnectionStatus);
}

// ==========================================================================
// Quản lý liên kết lỗi (Failed Links Section)
// ==========================================================================
const failedListContainer = document.getElementById('failed-list');
const btnExportFailed = document.getElementById('btn-export-failed');
const btnClearFailed = document.getElementById('btn-clear-failed');

async function loadFailedLinks() {
  try {
    const list = await window.electronAPI.getFailedLinks();
    renderFailedLinks(list);
  } catch (error) {
    console.error('Không thể load danh sách link lỗi:', error);
  }
}

function renderFailedLinks(list) {
  if (!failedListContainer) return;
  failedListContainer.innerHTML = '';

  if (!list || list.length === 0) {
    failedListContainer.innerHTML = `
      <div class="empty-history">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M8 12h8"></path>
        </svg>
        <p>Tuyệt vời! Không có lỗi tải xuống nào.</p>
      </div>
    `;
    return;
  }

  list.forEach(item => {
    const card = document.createElement('div');
    card.className = 'history-item';
    card.style.borderColor = 'rgba(244, 63, 94, 0.25)';
    card.style.background = 'rgba(244, 63, 94, 0.02)';

    card.innerHTML = `
      <div class="history-item-top">
        <div class="history-info">
          <div class="history-title" title="${item.title}" style="color: #f43f5e; font-weight: 600;">${item.title}</div>
          <div class="history-meta">
            <span>${item.date.split(',')[0]}</span>
            <span>•</span>
            <span style="color: #e11d48; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px;" title="${item.error}">${item.error}</span>
          </div>
        </div>
      </div>
      <div style="font-size: 11px; background: rgba(0,0,0,0.2); padding: 6px 10px; border-radius: 6px; word-break: break-all; margin-top: 4px;">
        <a href="#" class="failed-link-url" style="color: #38bdf8; text-decoration: underline; cursor: pointer; transition: color 0.2s;" title="Click để mở liên kết trong trình duyệt">${item.url}</a>
      </div>
      <div class="history-actions" style="margin-top: 8px;">
        <button class="btn-icon btn-copy-link" title="Copy link" style="border-color: rgba(255,255,255,0.08);">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
        </button>
        <button class="btn-icon btn-retry-link" title="Tải lại" style="border-color: rgba(16, 185, 129, 0.3); color: #10b981;">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
        </button>
        <button class="btn-icon danger btn-delete-link" title="Xóa">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    // Mở link bằng trình duyệt mặc định
    const linkUrl = card.querySelector('.failed-link-url');
    if (linkUrl) {
      linkUrl.addEventListener('click', (e) => {
        e.preventDefault();
        window.electronAPI.openExternalUrl(item.url);
      });
    }

    // Copy link
    const btnCopy = card.querySelector('.btn-copy-link');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(item.url);
        alert('Đã copy liên kết vào bộ nhớ tạm!');
      });
    }

    // Retry
    const btnRetry = card.querySelector('.btn-retry-link');
    if (btnRetry) {
      btnRetry.addEventListener('click', async () => {
        urlInput.value = item.url;
        activateTab('nav-home');
        btnAnalyze.click();

        await window.electronAPI.deleteFailedLink(item.id);
        loadFailedLinks();
      });
    }

    // Delete
    const btnDelete = card.querySelector('.btn-delete-link');
    if (btnDelete) {
      btnDelete.addEventListener('click', async () => {
        const updated = await window.electronAPI.deleteFailedLink(item.id);
        renderFailedLinks(updated);
      });
    }

    failedListContainer.appendChild(card);
  });
}

if (btnClearFailed) {
  btnClearFailed.addEventListener('click', async () => {
    if (confirm('Bạn có chắc chắn muốn xóa sạch danh sách liên kết lỗi?')) {
      const updated = await window.electronAPI.clearFailedLinks();
      renderFailedLinks(updated);
    }
  });
}

if (btnExportFailed) {
  btnExportFailed.addEventListener('click', async () => {
    const res = await window.electronAPI.exportFailedLinks();
    if (res.success) {
      alert(`Xuất file log thành công tại:\n${res.filePath}`);
    } else if (res.error) {
      alert('Không thể xuất file: ' + res.error);
    }
  });
}

if (window.electronAPI.onFailedLinksUpdated) {
  window.electronAPI.onFailedLinksUpdated((list) => {
    renderFailedLinks(list);
  });
}

if (window.electronAPI.onCookieSynced) {
  window.electronAPI.onCookieSynced((data) => {
    const type = data.auto ? 'tự động' : 'thủ công';
    showToast(`Đã đồng bộ cookie ${data.domain} từ Extension (${type})!`, 'success');
  });
}

if (window.electronAPI.onServerError) {
  window.electronAPI.onServerError((message) => {
    const serverBanner = document.getElementById('server-status-banner');
    const serverText = document.getElementById('server-status-text');
    if (serverBanner && serverText) {
      serverBanner.className = 'status-banner error';
      serverBanner.classList.remove('hidden');
      serverText.innerText = `❌ Lỗi Local Server: ${message}`;
    }
  });
}

if (window.electronAPI.onServerStatus) {
  window.electronAPI.onServerStatus((status) => {
    const serverBanner = document.getElementById('server-status-banner');
    const serverText = document.getElementById('server-status-text');
    if (serverBanner && serverText) {
      if (status.port !== status.configuredPort) {
        serverBanner.className = 'status-banner warning';
        serverBanner.classList.remove('hidden');
        serverText.innerText = `⚠️ Cổng mặc định ${status.configuredPort} bị chiếm dụng. Đã tự chuyển sang cổng ${status.port}. Hãy đổi cổng trong extension thành ${status.port}.`;
      } else {
        serverBanner.classList.add('hidden');
      }
    }
    updateConnectionStatus();
  });
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.bottom = '24px';
  toast.style.right = '24px';
  toast.style.background = 'rgba(30, 30, 46, 0.9)';
  toast.style.color = type === 'success' ? '#a6e3a1' : '#f38ba8';
  toast.style.padding = '10px 20px';
  toast.style.borderRadius = '10px';
  toast.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  toast.style.fontSize = '12px';
  toast.style.fontWeight = 'bold';
  toast.style.boxShadow = '0 8px 25px rgba(0, 0, 0, 0.4)';
  toast.style.zIndex = '99999';
  toast.style.opacity = '0';
  toast.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  toast.style.border = '1px solid rgba(255, 255, 255, 0.08)';
  toast.style.borderLeft = type === 'success' ? '4px solid #a6e3a1' : '4px solid #f38ba8';
  toast.style.backdropFilter = 'blur(10px)';
  toast.style.pointerEvents = 'none';
  toast.style.transform = 'translateY(20px)';

  toast.innerText = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }, 50);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

// Khởi chạy load ban đầu
loadAppSettings();
updateConnectionStatus();
