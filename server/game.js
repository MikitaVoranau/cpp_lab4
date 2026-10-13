const storage = require('./storage');

const GRID_WIDTH = 40;
const GRID_HEIGHT = 40;
const DEFAULT_COLOR = '#1e222d';

class GameManager {
  constructor() {
    this.width = GRID_WIDTH;
    this.height = GRID_HEIGHT;
    this.cells = new Map(); // key: "x,y" => { color, owner, ownerId, version, updatedAt, text }
    this.players = new Map(); // id => { id, name, color, x, y, score, ping }
    this.conflictLogs = [];
    this.chatMessages = [];
    this.leaderboard = [];

    this.init();
  }

  init() {
    const saved = storage.load();
    if (saved && saved.cells) {
      this.width = saved.width || GRID_WIDTH;
      this.height = saved.height || GRID_HEIGHT;
      for (const [key, val] of Object.entries(saved.cells)) {
        this.cells.set(key, val);
      }
      this.conflictLogs = saved.conflictLogs || [];
      this.chatMessages = saved.chatMessages || [];
      console.log(`[Game] Загружено ${this.cells.size} измененных клеток.`);
    } else {
      console.log('[Game] Создано новое игровое поле.');
    }
    this.recalculateLeaderboard();
  }

  getCell(x, y) {
    const key = `${x},${y}`;
    if (this.cells.has(key)) {
      return this.cells.get(key);
    }
    return {
      color: DEFAULT_COLOR,
      owner: null,
      ownerId: null,
      version: 0,
      updatedAt: 0,
      text: ''
    };
  }

  addPlayer(id, name, color) {
    const player = {
      id,
      name: name || `Игрок #${id.slice(-4)}`,
      color: color || this.getRandomColor(),
      cursorX: -1,
      cursorY: -1,
      score: 0,
      connectedAt: Date.now()
    };
    this.players.set(id, player);
    this.recalculateLeaderboard();
    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.recalculateLeaderboard();
  }

  updatePlayerCursor(id, x, y) {
    const player = this.players.get(id);
    if (player) {
      player.cursorX = x;
      player.cursorY = y;
    }
  }

  /**
   * Обновление клетки с разрешением конкурентных конфликтов
   * @param {Object} update
   * @returns {Object} { success, cell, conflict }
   */
  updateCell({ x, y, color, expectedVersion, playerId, playerName, clientTimestamp, text }) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return { success: false, reason: 'Координаты выходят за пределы поля' };
    }

    const key = `${x},${y}`;
    const current = this.getCell(x, y);
    let conflict = null;

    // Контроль конкурентного доступа: проверка совпадения версий
    if (typeof expectedVersion === 'number' && expectedVersion !== current.version) {
      // Версия на сервере изменилась раньше, чем клиент прислал свой апдейт
      const timeDiff = Math.abs(Date.now() - (current.updatedAt || 0));
      const resolution = (clientTimestamp && clientTimestamp > current.updatedAt)
        ? 'Last-Write-Wins (принято более позднее действие)'
        : 'Отклонено (преимущество у текущей серверной версии)';

      conflict = {
        id: 'conf_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        x,
        y,
        timestamp: Date.now(),
        clientPlayer: playerName || `ID:${playerId}`,
        prevPlayer: current.owner || 'Система',
        expectedVersion,
        currentVersion: current.version,
        resolution
      };

      this.conflictLogs.unshift(conflict);
      if (this.conflictLogs.length > 50) this.conflictLogs.pop();

      // Если разрешаем в пользу текущей серверной версии при конфликте:
      // При LWW (Last-Write-Wins): если запрос пришел позже, перезаписываем с новой версией
      // Но клиент уведомляется о возникшем и разрешенном конфликте!
    }

    // Применяем изменение
    const newVersion = current.version + 1;
    const updatedCell = {
      color: color || current.color,
      owner: playerName,
      ownerId: playerId,
      version: newVersion,
      updatedAt: Date.now(),
      text: typeof text === 'string' ? text.slice(0, 4) : current.text
    };

    this.cells.set(key, updatedCell);
    this.recalculateLeaderboard();
    this.scheduleSave();

    return {
      success: true,
      x,
      y,
      cell: updatedCell,
      conflict
    };
  }

  /**
   * Пакетная синхронизация действий, накопленных клиентом в офлайне
   */
  syncOfflineActions(playerId, playerName, actions) {
    const results = [];
    const conflicts = [];

    if (!Array.isArray(actions)) return { results, conflicts };

    for (const act of actions) {
      const res = this.updateCell({
        x: act.x,
        y: act.y,
        color: act.color,
        expectedVersion: act.expectedVersion,
        playerId,
        playerName,
        clientTimestamp: act.timestamp,
        text: act.text
      });

      if (res.success) {
        results.push({ x: act.x, y: act.y, cell: res.cell });
        if (res.conflict) {
          conflicts.push(res.conflict);
        }
      }
    }

    return { results, conflicts };
  }

  addChatMessage(playerId, playerName, text) {
    const msg = {
      id: 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      playerId,
      playerName,
      text: String(text).slice(0, 200),
      timestamp: Date.now()
    };
    this.chatMessages.push(msg);
    if (this.chatMessages.length > 100) this.chatMessages.shift();
    return msg;
  }

  recalculateLeaderboard() {
    const counts = {};
    for (const cell of this.cells.values()) {
      if (cell.owner) {
        counts[cell.owner] = (counts[cell.owner] || 0) + 1;
      }
    }

    const list = Object.entries(counts).map(([name, count]) => ({
      name,
      count
    }));
    list.sort((a, b) => b.count - a.count);
    this.leaderboard = list.slice(0, 10);
  }

  scheduleSave() {
    storage.saveDebounced(this.toSerializable());
  }

  saveImmediate() {
    storage.saveSync(this.toSerializable());
  }

  toSerializable() {
    const cellsObj = {};
    for (const [key, val] of this.cells.entries()) {
      cellsObj[key] = val;
    }
    return {
      width: this.width,
      height: this.height,
      cells: cellsObj,
      conflictLogs: this.conflictLogs.slice(0, 50),
      chatMessages: this.chatMessages.slice(-50),
      savedAt: Date.now()
    };
  }

  getSnapshot() {
    const cellsObj = {};
    for (const [key, val] of this.cells.entries()) {
      cellsObj[key] = val;
    }

    const onlinePlayers = Array.from(this.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      cursorX: p.cursorX,
      cursorY: p.cursorY
    }));

    return {
      width: this.width,
      height: this.height,
      cells: cellsObj,
      players: onlinePlayers,
      leaderboard: this.leaderboard,
      conflictLogs: this.conflictLogs.slice(0, 20),
      chatMessages: this.chatMessages.slice(-30),
      serverTime: Date.now()
    };
  }

  getRandomColor() {
    const palette = [
      '#e63946', '#f1faee', '#a8dadc', '#457b9d', '#1d3557',
      '#ffbe0b', '#fb5607', '#ff006e', '#8338ec', '#3a86ff',
      '#06d6a0', '#118ab2', '#073b4c', '#ef476f', '#ffd166'
    ];
    return palette[Math.floor(Math.random() * palette.length)];
  }
}

module.exports = GameManager;
