const storage = require('./storage');

const ARENA_WIDTH = 1000;
const ARENA_HEIGHT = 650;
const ROUND_DURATION_SEC = 45;
const DISCONNECT_TIMEOUT_SEC = 15;

class AimGame {
  constructor(broadcastCallback) {
    this.broadcast = broadcastCallback;
    this.width = ARENA_WIDTH;
    this.height = ARENA_HEIGHT;

    this.roundState = 'lobby';
    this.timeLeft = ROUND_DURATION_SEC;
    this.roundTimer = null;

    this.isPaused = false;
    this.pausedPlayer = null;
    this.pauseSecondsLeft = 0;
    this.pauseTimer = null;

    this.targets = new Map();
    this.recentHits = new Map();
    this.players = new Map();
    this.hallOfFame = [];

    this.init();
  }

  init() {
    const saved = storage.load();
    if (saved && Array.isArray(saved.hallOfFame)) {
      this.hallOfFame = saved.hallOfFame;
    }
  }

  getAvailableColor(preferredColor) {
    const colors = ['#00f5d4', '#ff007f', '#ffbe0b', '#7b2cbf', '#3a86ff', '#2ed573'];
    const usedColors = new Set(Array.from(this.players.values()).filter(p => p.connected).map(p => p.color));

    if (preferredColor && !usedColors.has(preferredColor)) {
      return preferredColor;
    }

    const freeColors = colors.filter(c => !usedColors.has(c));
    if (freeColors.length > 0) {
      return freeColors[0];
    }

    return colors[Math.floor(Math.random() * colors.length)];
  }

  getUniqueName(desiredName) {
    const base = (desiredName || 'Стрелок').trim();
    const existingNames = new Set(
      Array.from(this.players.values())
        .filter(p => p.connected)
        .map(p => p.name.toLowerCase())
    );

    let finalName = base;
    let counter = 2;
    while (existingNames.has(finalName.toLowerCase())) {
      finalName = `${base} (${counter++})`;
    }
    return finalName;
  }

  addPlayer(id, name, color) {
    const cleanName = (name || `Стрелок #${id.slice(-4)}`).trim();

    if (this.isPaused && this.pausedPlayer && this.pausedPlayer.name.toLowerCase() === cleanName.toLowerCase()) {
      this.clearPause();
      const restored = {
        ...this.pausedPlayer,
        id,
        connected: true,
        cursorX: this.width / 2,
        cursorY: this.height / 2
      };
      this.players.set(id, restored);
      this.pausedPlayer = null;
      this.isPaused = false;

      this.broadcast({
        type: 'game_resumed',
        playerName: restored.name,
        players: this.getPlayersList()
      });

      return restored;
    }

    const uniqueName = this.getUniqueName(cleanName);
    const assignedColor = this.getAvailableColor(color);

    const player = {
      id,
      name: uniqueName,
      color: assignedColor,
      score: 0,
      hits: 0,
      misses: 0,
      accuracy: 100,
      connected: true,
      cursorX: this.width / 2,
      cursorY: this.height / 2
    };

    this.players.set(id, player);
    return player;
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return;

    if (this.roundState === 'running') {
      player.connected = false;

      const activeRemaining = Array.from(this.players.values()).filter(p => p.connected);

      if (activeRemaining.length === 0) {
        this.clearPause();
        this.roundState = 'lobby';
        this.targets.clear();
        if (this.roundTimer) {
          clearInterval(this.roundTimer);
          this.roundTimer = null;
        }
        this.players.delete(id);
        return;
      }

      this.isPaused = true;
      this.pausedPlayer = player;
      this.pauseSecondsLeft = DISCONNECT_TIMEOUT_SEC;

      this.broadcast({
        type: 'game_paused',
        playerName: player.name,
        secondsLeft: this.pauseSecondsLeft,
        activePlayersCount: activeRemaining.length
      });

      if (this.pauseTimer) clearInterval(this.pauseTimer);
      this.pauseTimer = setInterval(() => {
        this.pauseSecondsLeft--;

        this.broadcast({
          type: 'pause_tick',
          playerName: player.name,
          secondsLeft: this.pauseSecondsLeft
        });

        if (this.pauseSecondsLeft <= 0) {
          this.handleDisconnectTimeout(player);
        }
      }, 1000);
    } else {
      this.players.delete(id);
    }
  }

  handleDisconnectTimeout(timedOutPlayer) {
    this.clearPause();
    this.isPaused = false;
    this.pausedPlayer = null;

    const remainingActive = Array.from(this.players.values()).filter(p => p.connected);

    if (remainingActive.length === 1) {
      const winner = remainingActive[0];
      this.endRoundWithWinner(winner, `Игрок ${timedOutPlayer.name} не вернулся. Техническая победа!`);
    } else {
      this.broadcast({
        type: 'player_forfeited',
        playerName: timedOutPlayer.name,
        message: `Игрок ${timedOutPlayer.name} отключен. Его счет заморожен. Игра продолжается!`
      });
    }
  }

  clearPause() {
    if (this.pauseTimer) {
      clearInterval(this.pauseTimer);
      this.pauseTimer = null;
    }
  }

  updatePlayerCursor(id, x, y) {
    const player = this.players.get(id);
    if (player && player.connected) {
      player.cursorX = x;
      player.cursorY = y;
    }
  }

  startGame(requestedByPlayerId) {
    if (this.roundState === 'running') {
      return { success: false, reason: 'Раунд уже идет' };
    }

    const starter = this.players.get(requestedByPlayerId);
    const starterName = starter ? starter.name : 'Игрок';

    this.clearPause();
    this.isPaused = false;
    this.pausedPlayer = null;

    this.roundState = 'running';
    this.timeLeft = ROUND_DURATION_SEC;
    this.targets.clear();
    this.recentHits.clear();

    for (const p of this.players.values()) {
      p.score = 0;
      p.hits = 0;
      p.misses = 0;
      p.accuracy = 100;
    }

    for (let i = 0; i < 5; i++) {
      this.spawnTarget();
    }

    if (this.roundTimer) clearInterval(this.roundTimer);
    this.roundTimer = setInterval(() => this.tick(), 1000);

    this.broadcast({
      type: 'round_started',
      startedBy: starterName,
      duration: ROUND_DURATION_SEC,
      targets: Array.from(this.targets.values()),
      players: this.getPlayersList()
    });

    return { success: true };
  }

  tick() {
    if (this.roundState !== 'running' || this.isPaused) return;

    this.timeLeft--;

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
  }

  endRoundWithWinner(winner, reason) {
    this.roundState = 'finished';
    this.clearPause();
    if (this.roundTimer) {
      clearInterval(this.roundTimer);
      this.roundTimer = null;
    }
    this.targets.clear();

    const scoreboard = this.getPlayersList();
    this.updateHallOfFame(winner.name, winner.score, winner.accuracy);
    this.scheduleSave();

    this.broadcast({
      type: 'round_ended',
      winner,
      scoreboard,
      hallOfFame: this.hallOfFame,
      reason
    });
  }

  endRound() {
    this.roundState = 'finished';
    this.clearPause();
    if (this.roundTimer) {
      clearInterval(this.roundTimer);
      this.roundTimer = null;
    }
    this.targets.clear();

    const scoreboard = this.getPlayersList();
    const winner = scoreboard[0] || null;

    for (const p of scoreboard) {
      if (p.score > 0) {
        this.updateHallOfFame(p.name, p.score, p.accuracy);
      }
    }

    this.scheduleSave();

    this.broadcast({
      type: 'round_ended',
      winner,
      scoreboard,
      hallOfFame: this.hallOfFame
    });
  }

  spawnTarget() {
    if (this.roundState !== 'running' || this.isPaused) return null;

    const id = 't_' + Math.random().toString(36).substring(2, 8);
    const types = [
      { type: 'standard', color: '#00f5d4', radius: 26, points: 10, lifetime: 2400 },
      { type: 'bonus', color: '#ffbe0b', radius: 18, points: 25, lifetime: 1600 },
      { type: 'golden', color: '#ff007f', radius: 14, points: 40, lifetime: 1200 },
      { type: 'bomb', color: '#ff4757', radius: 24, points: -20, lifetime: 2600 }
    ];

    const rand = Math.random();
    let selectedType = types[0];
    if (rand < 0.15) selectedType = types[3];
    else if (rand < 0.35) selectedType = types[2];
    else if (rand < 0.65) selectedType = types[1];

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

  handleShoot(playerId, targetId, clientTimestamp, expectedVersion) {
    const player = this.players.get(playerId);
    if (!player || !player.connected || this.roundState !== 'running' || this.isPaused) return null;

    const now = Date.now();

    if (this.recentHits.has(targetId)) {
      const prevHit = this.recentHits.get(targetId);
      const deltaMs = now - prevHit.hitTime;

      const conflict = {
        id: 'conf_' + now,
        targetId,
        timestamp: now,
        winnerPlayer: prevHit.hitBy.name,
        looserPlayer: player.name,
        deltaMs,
        resolution: `Игрок ${prevHit.hitBy.name} успел первым (-${deltaMs}мс)`
      };

      this.broadcast({
        type: 'target_conflict',
        conflict,
        targetPos: prevHit.targetPos
      });

      player.misses++;
      this.updatePlayerAccuracy(player);
      return { success: false, conflict };
    }

    const target = this.targets.get(targetId);
    if (!target) {
      player.misses++;
      this.updatePlayerAccuracy(player);
      return { success: false };
    }

    player.hits++;
    player.score = Math.max(0, player.score + target.points);
    this.updatePlayerAccuracy(player);

    this.recentHits.set(targetId, {
      hitBy: { id: player.id, name: player.name },
      hitTime: now,
      version: target.version,
      targetPos: { x: target.x, y: target.y }
    });

    setTimeout(() => this.recentHits.delete(targetId), 2000);
    this.targets.delete(targetId);

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

    setTimeout(() => this.spawnTarget(), 150);
    return { success: true };
  }

  handleMiss(playerId) {
    const player = this.players.get(playerId);
    if (player && player.connected && this.roundState === 'running' && !this.isPaused) {
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

  syncOfflineShots(playerId, shots) {
    const player = this.players.get(playerId);
    if (!player || !player.connected || !Array.isArray(shots)) return { processed: 0 };

    let processed = 0;
    for (const shot of shots) {
      if (shot.targetId) {
        const res = this.handleShoot(playerId, shot.targetId, shot.timestamp, shot.version);
        if (res) processed++;
      }
    }
    return { processed };
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

  getPlayersList() {
    const list = Array.from(this.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      hits: p.hits,
      misses: p.misses,
      accuracy: p.accuracy,
      connected: p.connected,
      cursorX: p.cursorX,
      cursorY: p.cursorY
    }));
    list.sort((a, b) => b.score - a.score);
    return list;
  }

  getSnapshot() {
    return {
      arenaWidth: this.width,
      arenaHeight: this.height,
      roundState: this.roundState,
      timeLeft: this.timeLeft,
      roundDuration: ROUND_DURATION_SEC,
      isPaused: this.isPaused,
      pausedPlayerName: this.pausedPlayer ? this.pausedPlayer.name : null,
      pauseSecondsLeft: this.pauseSecondsLeft,
      targets: Array.from(this.targets.values()),
      players: this.getPlayersList(),
      hallOfFame: this.hallOfFame
    };
  }

  scheduleSave() {
    storage.saveDebounced({
      hallOfFame: this.hallOfFame,
      savedAt: Date.now()
    });
  }

  saveImmediate() {
    storage.saveSync({
      hallOfFame: this.hallOfFame,
      savedAt: Date.now()
    });
  }
}

module.exports = AimGame;
