const fs = require('fs');
const path = require('path');

class FailedManager {
  constructor(filePath) {
    this.filePath = filePath;
    this.failedList = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        this.failedList = JSON.parse(data);
      } else {
        this.failedList = [];
      }
    } catch (e) {
      this.failedList = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.failedList, null, 2), 'utf-8');
    } catch (e) {
      console.error('Lỗi lưu failed_links.json:', e);
    }
  }

  add(item) {
    // Tránh trùng lặp URL lỗi
    if (!this.failedList.some(f => f.url === item.url)) {
      this.failedList.push(item);
      this.save();
    }
  }

  remove(id) {
    this.failedList = this.failedList.filter(f => f.id !== id);
    this.save();
  }

  clear() {
    this.failedList = [];
    this.save();
  }

  getList() {
    return this.failedList;
  }
}

module.exports = FailedManager;
