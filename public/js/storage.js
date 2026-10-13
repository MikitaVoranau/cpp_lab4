const STORAGE_KEYS = {
  PLAYER_NAME: 'aim_player_name',
  PLAYER_COLOR: 'aim_player_color',
  OFFLINE_SHOTS: 'aim_offline_shots'
};

class ClientStorage {
  constructor() {
    this.memoryQueue = this.loadOfflineQueue();
  }

  getPlayer() {
    return {
      name: sessionStorage.getItem(STORAGE_KEYS.PLAYER_NAME) || '',
      color: sessionStorage.getItem(STORAGE_KEYS.PLAYER_COLOR) || ''
    };
  }

  savePlayer(name, color) {
    if (name) sessionStorage.setItem(STORAGE_KEYS.PLAYER_NAME, name);
    if (color) sessionStorage.setItem(STORAGE_KEYS.PLAYER_COLOR, color);
  }

  loadOfflineQueue() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.OFFLINE_SHOTS);
      return raw ? JSON.parse(raw) : [];
    } catch {
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
    sessionStorage.removeItem(STORAGE_KEYS.OFFLINE_SHOTS);
  }

  persistQueue() {
    try {
      sessionStorage.setItem(STORAGE_KEYS.OFFLINE_SHOTS, JSON.stringify(this.memoryQueue));
    } catch {}
  }
}

window.clientStorage = new ClientStorage();
