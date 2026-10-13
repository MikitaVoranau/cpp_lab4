/**
 * Клиентское хранилище LocalStorage для Aim Trainer
 * Сохраняет:
 * 1. Имя и цвет стрелка
 * 2. Очередь офлайн-выстрелов (Дополнительно: 8-10 баллов)
 * 3. Локальный персональный рекорд
 */

const STORAGE_KEYS = {
  PLAYER_NAME: 'aim_player_name',
  PLAYER_COLOR: 'aim_player_color',
  OFFLINE_SHOTS: 'aim_offline_shots',
  PERSONAL_BEST: 'aim_personal_best'
};

class ClientStorage {
  constructor() {
    this.memoryQueue = this.loadOfflineQueue();
  }

  getPlayer() {
    return {
      name: localStorage.getItem(STORAGE_KEYS.PLAYER_NAME) || '',
      color: localStorage.getItem(STORAGE_KEYS.PLAYER_COLOR) || '#00f5d4'
    };
  }

  savePlayer(name, color) {
    if (name) localStorage.setItem(STORAGE_KEYS.PLAYER_NAME, name);
    if (color) localStorage.setItem(STORAGE_KEYS.PLAYER_COLOR, color);
  }

  getPersonalBest() {
    return parseInt(localStorage.getItem(STORAGE_KEYS.PERSONAL_BEST) || '0', 10);
  }

  savePersonalBest(score) {
    const current = this.getPersonalBest();
    if (score > current) {
      localStorage.setItem(STORAGE_KEYS.PERSONAL_BEST, score.toString());
    }
  }

  // Офлайн очередь действий
  loadOfflineQueue() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.OFFLINE_SHOTS);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  enqueueOfflineShot(shot) {
    this.memoryQueue.push({
      ...shot,
      timestamp: Date.now()
    });
    this.persistQueue();
  }

  getOfflineQueue() {
    return this.memoryQueue;
  }

  clearOfflineQueue() {
    this.memoryQueue = [];
    localStorage.removeItem(STORAGE_KEYS.OFFLINE_SHOTS);
  }

  persistQueue() {
    try {
      localStorage.setItem(STORAGE_KEYS.OFFLINE_SHOTS, JSON.stringify(this.memoryQueue));
    } catch (e) {
      console.warn('[Storage] Ошибка сохранения очереди:', e);
    }
  }
}

window.clientStorage = new ClientStorage();
