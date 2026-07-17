const fs = require('fs');
const path = require('path');

class SettingsManager {
  constructor(filePath, defaultDownloadDir) {
    this.filePath = filePath;
    this._cache = null; // In-memory cache: tránh đọc disk mỗi lần IPC handler gọi getSettings()
    this.defaultSettings = {
      downloadDir: defaultDownloadDir,
      createSubDirForAlbum: true,
      rateLimit: 'infinite',
      concurrentLimit: 3,
      albumDelay: 1200,
      port: 7788,
      autoFocus: true,
      autoAnalyze: true,
      videoQuality: 'bestvideo+bestaudio/best',
      audioFormat: 'bestaudio',
      accentColor: '#7c3aed',
      showThumbnails: true
    };
    this.ensureFileExists();
  }

  ensureFileExists() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(this.defaultSettings, null, 2), 'utf-8');
      this._cache = { ...this.defaultSettings };
    } else {
      // Merge với defaults để đảm bảo các setting mới được thêm vào
      try {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        const current = JSON.parse(data);
        const merged = { ...this.defaultSettings, ...current };
        fs.writeFileSync(this.filePath, JSON.stringify(merged, null, 2), 'utf-8');
        this._cache = merged;
      } catch (e) {
        fs.writeFileSync(this.filePath, JSON.stringify(this.defaultSettings, null, 2), 'utf-8');
        this._cache = { ...this.defaultSettings };
      }
    }
  }

  getSettings() {
    // Cache hit: trả về ngay, không đọc disk
    if (this._cache !== null) return this._cache;

    try {
      this.ensureFileExists();
      const data = fs.readFileSync(this.filePath, 'utf-8');
      this._cache = JSON.parse(data);
      return this._cache;
    } catch (error) {
      console.error('Lỗi đọc settings:', error);
      return this.defaultSettings;
    }
  }

  saveSettings(settings) {
    try {
      this.ensureFileExists();
      const current = this.getSettings();
      const merged = { ...current, ...settings };
      fs.writeFileSync(this.filePath, JSON.stringify(merged, null, 2), 'utf-8');
      this._cache = merged; // Cập nhật cache ngay sau khi ghi
      return merged;
    } catch (error) {
      console.error('Lỗi lưu settings:', error);
      return null;
    }
  }
}

module.exports = SettingsManager;
