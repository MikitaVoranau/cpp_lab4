const storage = require('./storage');

const ARENA_WIDTH = 1000;
const ARENA_HEIGHT = 650;
const ROUND_DURATION_SEC = 45;
const INTERMISSION_SEC = 5;

class AimGame {
  constructor(broadcastCallback) {
    this.broadcast = broadcastCallback;
    this.width = ARENA_WIDTH;
    this.height = ARENA_HEIGHT;

    this.roundState = 'waiting'; // 'waiting' | 'running' | 'intermission'
    this.timeLeft = ROUND_DURATION_SEC;
    this.roundTimer = null;
    this.targetSpawnTimer = null;

    this.targets = new Map(); // id => target
    this.recentHits = new Map(); // targetId => { hitBy, hitTime, version } (for conflict detection)

    this.players = new Map(); // id => { id, name, color, score, hits, misses, accuracy, cursorX, cursorY }
    this.conflictLogs = [];
    this.chatMessages = [];
    this.hallOfFame = []; // Топ рекордов всех времен
    this.matchHistory = [];

    this.init();
  }

  init() {
    const saved = storage.load();
    if (saved) {
      this.hallOfFame = saved.hallOfFame || [];
      this.matchHistory = saved.matchHistory || [];
      this.conflictLogs = saved.conflictLogs || [];
      console.log(`[AimGame] Загружено ${this.hallOfFame.length} рекордов всех времен.`);
    }

    // Состояние раунда инициализировано
  }

  addPlayer(id, name, color) {
    const player = {
      id,
      name: name || `Стрелок #${id.slice(-4)}`,
      color: color || this.getRandomColor(),
      score: 0,
      hits: 0,
      misses: 0,
      accuracy: 100,
      cursorX: this.width / 2,
      cursorY: this.height / 2,
      connectedAt: Date.now()
    };
    this.players.set(id, player);

    // Если игра еще не запущена и набрался хотя бы один игрок
    if (this.roundState === 'waiting' && this.players.size > 0) {
      this.startNewRound();
    }

    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
    if (this.players.size === 0) {
      this.roundState = 'waiting';
      this.targets.clear();
    }
  }

  updatePlayerCursor(id, x, y) {
    const player = this.players.get(id);
    if (player) {
      player.cursorX = x;
      player.cursorY = y;
    }
  }

  // --- Управление раундами ---
  startNewRound() {
    this.roundState = 'running';
    this.timeLeft = ROUND_DURATION_SEC;
    this.targets.clear();
    this.recentHits.clear();

    // Сброс очков игроков на текущий раунд
    for (const p of this.players.values()) {
      p.score = 0;
      p.hits = 0;
      p.misses = 0;
      p.accuracy = 100;
    }

    // Спавним стартовые 5 мишеней
    for (let i = 0; i < 5; i++) {
      this.spawnTarget();
    }

    this.broadcast({
      type: 'round_started',
      duration: ROUND_DURATION_SEC,
      targets: Array.from(this.targets.values()),
      players: this.getPlayersList()
    });

    if (this.roundTimer) clearInterval(this.roundTimer);
    this.roundTimer = setInterval(() => this.tick(), 1000);
  }

  tick() {
    if (this.roundState === 'running') {
      this.timeLeft--;

      // Проверяем протухшие мишени
      const now = Date.now();
      for (const [id, target] of this.targets.entries()) {
        if (now - target.spawnTime >= target.lifetime) {
          this.targets.delete(id);
          this.broadcast({ type: 'target_expired', targetId: id });
          this.spawnTarget();
        }
      }

      this.broadcast({
        type: 'time_sync',
        timeLeft: this.timeLeft,
        state: this.roundState
      });

      if (this.timeLeft <= 0) {
        this.endRound();
      }
    } else if (this.roundState === 'intermission') {
      this.timeLeft--;
      this.broadcast({
        type: 'time_sync',
        timeLeft: this.timeLeft,
        state: this.roundState
      });

      if (this.timeLeft <= 0) {
        this.startNewRound();
      }
    }
  }

  endRound() {
    this.roundState = 'intermission';
    this.timeLeft = INTERMISSION_SEC;
    this.targets.clear();

    // Вычисляем победителя и обновляем рекорды
    const playersList = this.getPlayersList();
    playersList.sort((a, b) => b.score - a.score);
    const winner = playersList[0] || null;

    // Сохранение рекордов в Hall of Fame
    for (const p of playersList) {
      if (p.score > 0) {
        this.updateHallOfFame(p.name, p.score, p.accuracy);
      }
    }

    const matchSummary = {
      id: 'match_' + Date.now(),
      timestamp: Date.now(),
      winner: winner ? { name: winner.name, score: winner.score } : null,
      topPlayers: playersList.slice(0, 3)
    };
    this.matchHistory.unshift(matchSummary);
    if (this.matchHistory.length > 20) this.matchHistory.pop();

    this.scheduleSave();

    this.broadcast({
      type: 'round_ended',
      winner,
      scoreboard: playersList,
      nextRoundIn: INTERMISSION_SEC,
      hallOfFame: this.hallOfFame
    });
  }

  // --- Мишени (Targets) ---
  spawnTarget() {
    if (this.roundState !== 'running') return null;

    const id = 't_' + Math.random().toString(36).substring(2, 8);
    const types = [
      { type: 'standard', color: '#00f5d4', radius: 26, points: 10, lifetime: 2400 },
      { type: 'bonus', color: '#ffbe0b', radius: 18, points: 25, lifetime: 1600 },
      { type: 'golden', color: '#ff007f', radius: 14, points: 40, lifetime: 1200 },
      { type: 'bomb', color: '#ff4757', radius: 24, points: -20, lifetime: 2600 }
    ];

    // Выбираем тип с весами
    const rand = Math.random();
    let selectedType = types[0];
    if (rand < 0.15) selectedType = types[3]; // бомба 15%
    else if (rand < 0.35) selectedType = types[2]; // золотая 20%
    else if (rand < 0.65) selectedType = types[1]; // бонус 30%

    const padding = 50;
    const x = Math.floor(padding + Math.random() * (this.width - padding * 2));
    const y = Math.floor(padding + Math.random() * (this.height - padding * 2));

    const target = {
      id,
      x,
      y,
      radius: selectedType.radius,
      color: selectedType.color,
      type: selectedType.type,
      points: selectedType.points,
      spawnTime: Date.now(),
      lifetime: selectedType.lifetime,
      version: 1
    };

    this.targets.set(id, target);
    this.broadcast({ type: 'target_spawned', target });
    return target;
  }

  // --- Обработка выстрела и Конфликтов (Требование 1 дополнительно) ---
  handleShoot(playerId, targetId, clientTimestamp, expectedVersion) {
    const player = this.players.get(playerId);
    if (!player || this.roundState !== 'running') return null;

    const now = Date.now();

    // 1. Проверка: возможно мишень уже была поражена кем-то другим в этот же момент (КОНФЛИКТ!)
    if (this.recentHits.has(targetId)) {
      const prevHit = this.recentHits.get(targetId);
      const deltaMs = now - prevHit.hitTime;

      // Конкурентная коллизия: два игрока нажали на одну цель почти одновременно
      const conflict = {
        id: 'conf_' + now + '_' + Math.floor(Math.random() * 1000),
        targetId,
        timestamp: now,
        winnerPlayer: prevHit.hitBy.name,
        looserPlayer: player.name,
        deltaMs,
        resolution: `Игрок ${prevHit.hitBy.name} опередил на ${deltaMs}мс (LWW)`
      };

      this.conflictLogs.unshift(conflict);
      if (this.conflictLogs.length > 50) this.conflictLogs.pop();

      // Оповещаем участников о конфликте
      this.broadcast({
        type: 'target_conflict',
        conflict,
        targetPos: prevHit.targetPos
      });

      player.misses++;
      this.updatePlayerAccuracy(player);

      return {
        success: false,
        conflict,
        reason: `Цель уже поражена игроком ${prevHit.hitBy.name} (${deltaMs}мс назад)`
      };
    }

    // 2. Проверка активной мишени
    const target = this.targets.get(targetId);
    if (!target) {
      player.misses++;
      this.updatePlayerAccuracy(player);
      return { success: false, reason: 'Цель уже исчезла' };
    }

    // Попадание!
    player.hits++;
    player.score = Math.max(0, player.score + target.points);
    this.updatePlayerAccuracy(player);

    // Запоминаем факт попадания для выявления последующих конкурентных кликов
    this.recentHits.set(targetId, {
      hitBy: { id: player.id, name: player.name },
      hitTime: now,
      version: target.version,
      targetPos: { x: target.x, y: target.y }
    });

    // Очищаем старые записи через 2 секунды
    setTimeout(() => this.recentHits.delete(targetId), 2000);

    // Удаляем пораженную мишень
    this.targets.delete(targetId);

    // Транслируем всем игрокам попадание
    this.broadcast({
      type: 'target_hit',
      targetId,
      playerId,
      playerName: player.name,
      points: target.points,
      newScore: player.score,
      x: target.x,
      y: target.y,
      color: target.color,
      players: this.getPlayersList()
    });

    // Спавним новую мишень взамен
    setTimeout(() => this.spawnTarget(), 150);

    return { success: true, points: target.points };
  }

  handleMiss(playerId) {
    const player = this.players.get(playerId);
    if (player && this.roundState === 'running') {
      player.misses++;
      this.updatePlayerAccuracy(player);
      this.broadcast({
        type: 'player_stats_update',
        playerId,
        player: {
          id: player.id,
          score: player.score,
          hits: player.hits,
          misses: player.misses,
          accuracy: player.accuracy
        }
      });
    }
  }

  updatePlayerAccuracy(player) {
    const total = player.hits + player.misses;
    player.accuracy = total > 0 ? Math.round((player.hits / total) * 100) : 100;
  }

  // --- Офлайн синхронизация (Требование 2 дополнительно) ---
  syncOfflineShots(playerId, shots) {
    const player = this.players.get(playerId);
    if (!player || !Array.isArray(shots)) return { processed: 0, conflicts: 0 };

    let processed = 0;
    let conflicts = 0;

    for (const shot of shots) {
      if (shot.targetId) {
        const res = this.handleShoot(playerId, shot.targetId, shot.timestamp, shot.version);
        if (res) {
          processed++;
          if (res.conflict) conflicts++;
        }
      }
    }

    return { processed, conflicts };
  }

  updateHallOfFame(name, score, accuracy) {
    const existing = this.hallOfFame.find(h => h.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (score > existing.score) {
        existing.score = score;
        existing.accuracy = accuracy;
        existing.date = Date.now();
      }
    } else {
      this.hallOfFame.push({
        name,
        score,
        accuracy,
        date: Date.now()
      });
    }
    this.hallOfFame.sort((a, b) => b.score - a.score);
    this.hallOfFame = this.hallOfFame.slice(0, 10);
  }

  addChatMessage(playerId, playerName, text) {
    const msg = {
      id: 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      playerId,
      playerName,
      text: String(text).slice(0, 150),
      timestamp: Date.now()
    };
    this.chatMessages.push(msg);
    if (this.chatMessages.length > 50) this.chatMessages.shift();
    return msg;
  }

  getPlayersList() {
    return Array.from(this.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      hits: p.hits,
      misses: p.misses,
      accuracy: p.accuracy,
      cursorX: p.cursorX,
      cursorY: p.cursorY
    }));
  }

  getSnapshot() {
    return {
      arenaWidth: this.width,
      arenaHeight: this.height,
      roundState: this.roundState,
      timeLeft: this.timeLeft,
      roundDuration: ROUND_DURATION_SEC,
      targets: Array.from(this.targets.values()),
      players: this.getPlayersList(),
      hallOfFame: this.hallOfFame,
      conflictLogs: this.conflictLogs.slice(0, 20),
      chatMessages: this.chatMessages.slice(-25),
      serverTime: Date.now()
    };
  }

  scheduleSave() {
    storage.saveDebounced(this.toSerializable());
  }

  saveImmediate() {
    storage.saveSync(this.toSerializable());
  }

  toSerializable() {
    return {
      hallOfFame: this.hallOfFame,
      matchHistory: this.matchHistory.slice(0, 20),
      conflictLogs: this.conflictLogs.slice(0, 30),
      savedAt: Date.now()
    };
  }

  getRandomColor() {
    const colors = ['#00f5d4', '#7b2cbf', '#ffbe0b', '#fb5607', '#ff006e', '#3a86ff'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

module.exports = AimGame;
