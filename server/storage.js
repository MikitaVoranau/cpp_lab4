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
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const data = JSON.parse(raw);
        console.log(`[Storage] Успешно загружена статистика Aim Arena из ${DATA_FILE}`);
        return data;
      }
    } catch (err) {
      console.error('[Storage] Ошибка чтения aim_gamestate.json:', err.message);
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
      const json = JSON.stringify(state, null, 2);
      fs.writeFileSync(tempFile, json, 'utf-8');
      fs.renameSync(tempFile, DATA_FILE);
      console.log(`[Storage] Статистика Aim Arena сохранена на диск (${new Date().toLocaleTimeString()})`);
    } catch (err) {
      console.error('[Storage] Ошибка сохранения aim_gamestate.json:', err.message);
    }
  }
}

module.exports = new Storage();
