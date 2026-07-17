const { scrapeSpotify } = require('../src/utils/spotifyScraper');

const trackUrl = 'https://open.spotify.com/track/2fWYqr8yaQitqsjHMEstVh?si=7d615d972220450d';

async function run() {
  try {
    console.log('--- BẮT ĐẦU CÀO THỬ NGHIỆM LINK SPOTIFY ---');
    const result = await scrapeSpotify(trackUrl);
    console.log('KẾT QUẢ THÀNH CÔNG:', result);
  } catch (err) {
    console.error('KẾT QUẢ THẤT BẠI:', err);
  }
}

run();
