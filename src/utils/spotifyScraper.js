const https = require('https');

/**
 * Helper gửi request GET giả lập Facebook Crawler để lấy HTML tĩnh
 */
function fetchHtml(url, userAgent = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_voiced.html)') {
  return new Promise((resolve, reject) => {
    // Phân tích URL
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive'
      }
    };

    https.get(options, (res) => {
      // Xử lý redirect
      if (res.statusCode === 301 || res.statusCode === 302) {
        fetchHtml(res.headers.location, userAgent).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Spotify trả về mã lỗi HTTP: ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Helper trích xuất meta tag content từ HTML
 */
function getMeta(html, property) {
  const regex = new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i');
  const match = html.match(regex);
  return match ? match[1] : null;
}

/**
 * Phân tích link Spotify (Track / Album / Playlist)
 */
async function scrapeSpotify(url) {
  try {
    const ua = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_voiced.html)';
    const html = await fetchHtml(url, ua);
    
    const title = getMeta(html, 'og:title');
    const description = getMeta(html, 'og:description');
    const image = getMeta(html, 'og:image') || '';

    if (!title) {
      throw new Error('Không thể đọc tiêu đề từ trang Spotify.');
    }

    // 1. Nếu là Link bài hát đơn lẻ (Track)
    if (url.includes('/track/')) {
      const parts = description ? description.split(' · ') : [];
      const artist = parts[0] || 'N/A';
      return {
        type: 'track',
        title,
        artist,
        image,
        query: `${title} ${artist} Official Audio`
      };
    }
    
    // 2. Nếu là Link Album hoặc Playlist
    // Chỉ quét các track thực sự được định nghĩa trong thẻ <meta name="music:song" ...> ở phần <head>
    // Điều này giúp loại bỏ 100% các bài hát đề xuất ở chân trang web
    const trackRegex = /<meta[^>]*content=["']https:\/\/open\.spotify\.com\/track\/([a-zA-Z0-9]+)["']/gi;
    let match;
    const uniqueTrackIds = new Set();
    while ((match = trackRegex.exec(html)) !== null) {
      uniqueTrackIds.add(match[1]);
    }

    const trackIds = Array.from(uniqueTrackIds);
    console.log(`Tìm thấy chính xác ${trackIds.length} bài hát trong Album/Playlist Spotify.`);

    const tracks = [];
    
    // Fetch thông tin chi tiết từng bài hát theo nhóm (batch 6 bài một lúc) để tối ưu tốc độ và băng thông
    const batchSize = 6;
    for (let i = 0; i < trackIds.length; i += batchSize) {
      const batch = trackIds.slice(i, i + batchSize);
      const promises = batch.map(async (id) => {
        try {
          const trackUrl = `https://open.spotify.com/track/${id}`;
          const trackHtml = await fetchHtml(trackUrl, ua);
          const trackTitle = getMeta(trackHtml, 'og:title');
          const trackDesc = getMeta(trackHtml, 'og:description');
          const trackImage = getMeta(trackHtml, 'og:image') || ''; // Trích xuất ảnh bìa riêng của từng bài hát con
          
          if (trackTitle) {
            const trackParts = trackDesc ? trackDesc.split(' · ') : [];
            const trackArtist = trackParts[0] || 'N/A';
            return {
              title: trackTitle,
              artist: trackArtist,
              thumbnail: trackImage, // Lưu lại ảnh bìa riêng
              query: `${trackTitle} ${trackArtist} Official Audio`
            };
          }
        } catch (e) {
          console.error(`Không thể cào thông tin track ${id}:`, e.message);
        }
        return null;
      });

      const results = await Promise.all(promises);
      results.forEach(r => {
        if (r) tracks.push(r);
      });
    }

    // Xác định tên nghệ sĩ của album từ description
    let artist = 'Spotify';
    if (description) {
      const parts = description.split(' · ');
      if (parts.length > 2) {
        artist = parts[2]; // Đối với playlist/album cấu trúc thường là "... on Spotify · album · Artist · Year"
      } else if (parts.length > 1) {
        artist = parts[1];
      }
    }

    return {
      type: 'album',
      title,
      artist,
      image,
      tracks
    };
  } catch (error) {
    console.error('Lỗi scraper Spotify:', error);
    throw new Error('Không thể phân tích dữ liệu từ link Spotify này: ' + error.message);
  }
}

module.exports = { scrapeSpotify };
