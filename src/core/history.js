const fs = require('fs');
const path = require('path');

// Giới hạn số item lưu trong lịch sử để tránh file JSON phình to
const MAX_HISTORY_ITEMS = 300;

// Debounce delay khi ghi disk (ms) - tránh 400+ disk writes/phút khi tải album
const DEBOUNCE_WRITE_MS = 300;

class HistoryManager {
  constructor(filePath) {
    this.filePath = filePath;
    this._cache = null;       // In-memory cache — tránh đọc disk mỗi lần
    this._saveTimer = null;   // Debounce timer — gộp nhiều lần saveHistory() thành 1 lần ghi disk
    this._pendingHistory = null; // Dữ liệu đang chờ ghi
    this.ensureFileExists();
  }

  ensureFileExists() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), 'utf-8');
    }
  }

  getHistory() {
    // Cache hit: trả về ngay không đọc disk
    if (this._cache !== null) return this._cache;

    try {
      this.ensureFileExists();
      const data = fs.readFileSync(this.filePath, 'utf-8');
      this._cache = JSON.parse(data);
      return this._cache;
    } catch (error) {
      console.error('Lỗi đọc lịch sử:', error);
      this._cache = [];
      return this._cache;
    }
  }

  saveHistory(history) {
    // Cập nhật cache ngay lập tức để getHistory() trả về dữ liệu mới nhất
    this._cache = history;
    this._pendingHistory = history;

    // Debounce: chỉ ghi disk sau DEBOUNCE_WRITE_MS ms idle
    // Tránh ghi disk hàng trăm lần/phút khi tải album nhiều bài
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        this.ensureFileExists();
        fs.writeFileSync(
          this.filePath,
          JSON.stringify(this._pendingHistory, null, 2),
          'utf-8'
        );
        this._pendingHistory = null;
      } catch (error) {
        console.error('Lỗi lưu lịch sử (debounced):', error);
      }
    }, DEBOUNCE_WRITE_MS);

    return true;
  }

  // Ghi disk ngay lập tức, bỏ qua debounce (dùng khi app sắp đóng)
  flushSync() {
    clearTimeout(this._saveTimer);
    if (this._cache !== null) {
      try {
        this.ensureFileExists();
        fs.writeFileSync(
          this.filePath,
          JSON.stringify(this._cache, null, 2),
          'utf-8'
        );
        this._pendingHistory = null;
      } catch (error) {
        console.error('Lỗi flush lịch sử:', error);
      }
    }
  }

  addItem(item) {
    let history = this.getHistory();

    // Cập nhật nếu item đã tồn tại (theo id)
    const index = history.findIndex(h => h.id === item.id);
    if (index > -1) {
      history[index] = { ...history[index], ...item };
    } else {
      history.unshift(item); // Thêm vào đầu

      // Giới hạn tổng số item để tránh file JSON phình to và UI lag khi render
      if (history.length > MAX_HISTORY_ITEMS) {
        history = history.slice(0, MAX_HISTORY_ITEMS);
      }
    }

    this.saveHistory(history);
    return item;
  }

  updateItem(id, updates) {
    const history = this.getHistory();
    const index = history.findIndex(item => item.id === id);
    if (index > -1) {
      history[index] = { ...history[index], ...updates };
      this.saveHistory(history);
      return history[index];
    }
    return null;
  }

  deleteItem(id) {
    let history = this.getHistory();
    history = history.filter(item => item.id !== id);
    this.saveHistory(history);
    return true;
  }

  clearHistory() {
    this._cache = [];
    clearTimeout(this._saveTimer);
    try {
      fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), 'utf-8');
    } catch (e) {
      console.error('Lỗi xóa lịch sử:', e);
    }
    return true;
  }
}

module.exports = HistoryManager;
