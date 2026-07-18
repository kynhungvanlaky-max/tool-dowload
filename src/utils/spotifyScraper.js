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
 * Chuyển đổi link Spotify thường sang link Embed
 */
function getEmbedUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    
    if (pathname.includes('/album/')) {
      const match = pathname.match(/\/album\/([a-zA-Z0-9]+)/);
      if (match) return `https://open.spotify.com/embed/album/${match[1]}`;
    }
    if (pathname.includes('/playlist/')) {
      const match = pathname.match(/\/playlist\/([a-zA-Z0-9]+)/);
      if (match) return `https://open.spotify.com/embed/playlist/${match[1]}`;
    }
    if (pathname.includes('/track/')) {
      const match = pathname.match(/\/track\/([a-zA-Z0-9]+)/);
      if (match) return `https://open.spotify.com/embed/track/${match[1]}`;
    }
  } catch (e) {}
  return url;
}

/**
 * Phân tích link Spotify (Track / Album / Playlist)
 */
async function scrapeSpotify(url) {
  try {
    const embedUrl = getEmbedUrl(url);
    console.log(`[MediaFetch SpotifyScraper] Đang cào URL Embed: ${embedUrl}`);
    const html = await fetchHtml(embedUrl);
    
    const jsonScriptRegex = /<script\s+[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let stateData = null;

    while ((match = jsonScriptRegex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.props?.pageProps?.state?.data?.entity) {
          stateData = parsed.props.pageProps.state.data;
          break;
        }
      } catch (e) {}
    }

    if (!stateData || !stateData.entity) {
      throw new Error('Không thể tìm thấy hoặc phân tích dữ liệu JSON cấu trúc từ Spotify.');
    }

    const entity = stateData.entity;
    const title = entity.title || entity.name || 'Không xác định';
    
    let image = '';
    if (entity.visualIdentity?.image && entity.visualIdentity.image.length > 0) {
      const images = entity.visualIdentity.image;
      const largest = images.find(img => img.maxWidth === 640) || images[0];
      image = largest.url;
    }

    if (entity.type === 'track') {
      const artist = entity.artists && entity.artists.length > 0
        ? entity.artists.map(a => a.name).join(', ')
        : 'N/A';
      
      return {
        type: 'track',
        title,
        artist,
        image,
        query: `${title} ${artist} Official Audio`
      };
    } else {
      // Album hoặc Playlist
      const artist = entity.subtitle || 'Spotify';
      const tracks = (entity.trackList || []).map((t, idx) => {
        const tTitle = t.title || 'Không tên';
        const tArtist = t.subtitle || 'N/A';
        const tUrl = t.uri ? `https://open.spotify.com/track/${t.uri.split(':').pop()}` : '';
        return {
          title: tTitle,
          artist: tArtist,
          thumbnail: image,
          query: `${tTitle} ${tArtist} Official Audio`,
          url: tUrl
        };
      });

      return {
        type: 'album',
        title,
        artist,
        image,
        tracks
      };
    }
  } catch (error) {
    console.error('Lỗi scraper Spotify:', error);
    throw new Error('Không thể phân tích dữ liệu từ link Spotify này: ' + error.message);
  }
}

module.exports = { scrapeSpotify };
