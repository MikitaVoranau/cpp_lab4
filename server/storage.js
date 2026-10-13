const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'aim_gamestate.json');

class Storage {
  constructor() {
    this.saveTimeout = null;
    this.ensureDir();
  }

  ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      }
    } catch {
      return null;
    }
    return null;
  }

  saveDebounced(state, delayMs = 1000) {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveSync(state);
    }, delayMs);
  }

  saveSync(state) {
    try {
      this.ensureDir();
      const tempFile = `${DATA_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf-8');
      fs.renameSync(tempFile, DATA_FILE);
    } catch {}
  }
}

module.exports = new Storage();
