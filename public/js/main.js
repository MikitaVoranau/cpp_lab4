/**
 * Главный контроллер Cyber Aim (Vanilla JS, без сторонних фреймворков)
 */

document.addEventListener('DOMContentLoaded', () => {
  const PALETTE = ['#00f5d4', '#ff007f', '#ffbe0b', '#7b2cbf', '#3a86ff', '#2ed573'];

  // Элементы UI
  const canvasEl = document.getElementById('aimCanvas');
  const roundStatusLabel = document.getElementById('roundStatusLabel');
  const roundTimerDisplay = document.getElementById('roundTimerDisplay');
  const timerBarFill = document.getElementById('timerBarFill');

  const connectionStatusEl = document.getElementById('connectionStatus');
  const statusTextEl = document.getElementById('statusText');
  const toggleOfflineBtn = document.getElementById('toggleOfflineBtn');
  const simOfflineStateEl = document.getElementById('simOfflineState');
  const toggleSoundBtn = document.getElementById('toggleSoundBtn');
  const offlineBannerEl = document.getElementById('offlineBanner');
  const offlineQueueCountEl = document.getElementById('offlineQueueCount');
  const retryConnectBtn = document.getElementById('retryConnectBtn');

  const playerAvatarEl = document.getElementById('playerAvatar');
  const playerNameDisplayEl = document.getElementById('playerNameDisplay');
  const myScoreEl = document.getElementById('myScore');
  const myAccuracyEl = document.getElementById('myAccuracy');
  const myHitsEl = document.getElementById('myHits');
  const myMissesEl = document.getElementById('myMisses');

  const livePlayersListEl = document.getElementById('livePlayersList');
  const hallOfFameListEl = document.getElementById('hallOfFameList');
  const conflictLogListEl = document.getElementById('conflictLogList');

  const roundEndOverlayEl = document.getElementById('roundEndOverlay');
  const winnerAnnouncementEl = document.getElementById('winnerAnnouncement');
  const roundPodiumListEl = document.getElementById('roundPodiumList');
  const nextRoundTimerEl = document.getElementById('nextRoundTimer');

  const chatMessagesEl = document.getElementById('chatMessages');
  const chatFormEl = document.getElementById('chatForm');
  const chatInputEl = document.getElementById('chatInput');

  const loginModalEl = document.getElementById('loginModal');
  const loginFormEl = document.getElementById('loginForm');
  const playerNameInputEl = document.getElementById('playerNameInput');
  const modalColorsEl = document.getElementById('modalColors');

  // Инициализация графического движка
  const aimCanvas = new AimCanvas(canvasEl);

  let myPlayerId = null;
  let currentColor = PALETTE[0];
  let selectedModalColor = PALETTE[0];
  let totalRoundDuration = 45;

  // --- 1. Профиль и модальное окно ---
  const savedPlayer = window.clientStorage.getPlayer();
  if (savedPlayer.name) {
    playerNameInputEl.value = savedPlayer.name;
    playerNameDisplayEl.textContent = savedPlayer.name;
  }
  if (savedPlayer.color) {
    currentColor = savedPlayer.color;
    selectedModalColor = savedPlayer.color;
    aimCanvas.myColor = currentColor;
  }

  // Цвета в модалке
  modalColorsEl.innerHTML = '';
  PALETTE.forEach(c => {
    const opt = document.createElement('div');
    opt.className = 'modal-color-opt' + (c === selectedModalColor ? ' active' : '');
    opt.style.backgroundColor = c;
    opt.addEventListener('click', () => {
      modalColorsEl.querySelectorAll('.modal-color-opt').forEach(el => el.classList.remove('active'));
      opt.classList.add('active');
      selectedModalColor = c;
    });
    modalColorsEl.appendChild(opt);
  });

  playerAvatarEl.style.backgroundColor = currentColor;

  loginFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = playerNameInputEl.value.trim() || 'Стрелок';
    currentColor = selectedModalColor;
    aimCanvas.myColor = currentColor;
    playerNameDisplayEl.textContent = name;
    playerAvatarEl.style.backgroundColor = currentColor;
    window.clientStorage.savePlayer(name, currentColor);

    loginModalEl.classList.add('hidden');
    window.soundEffects.ensureContext();
    window.networkManager.connect();
  });

  if (savedPlayer.name) {
    loginModalEl.classList.add('hidden');
    window.networkManager.connect();
  }

  // Звук
  toggleSoundBtn.addEventListener('click', () => {
    const isEnabled = window.soundEffects.toggle();
    toggleSoundBtn.textContent = isEnabled ? '🔊 Звук: ВКЛ' : '🔇 Звук: ВЫКЛ';
  });

  // --- 2. Клики и выстрелы (Aiming & Shooting) ---
  aimCanvas.onTargetClick = (targetId, expectedVersion, arenaX, arenaY) => {
    window.soundEffects.playShot();
    // Отправляем выстрел на сервер с версией цели для контроля конкуренции
    window.networkManager.sendShoot(targetId, expectedVersion);
  };

  aimCanvas.onMissClick = () => {
    window.soundEffects.playShot();
    window.networkManager.sendMiss();
  };

  aimCanvas.onCursorMove = (arenaX, arenaY) => {
    window.networkManager.sendCursorMove(arenaX, arenaY);
  };

  // --- 3. Сетевые события ---

  window.networkManager.on('connecting', ({ attempt }) => {
    setStatus('connecting', `Подключение (${attempt})...`);
  });

  window.networkManager.on('connected', () => {
    setStatus('connected', 'Онлайн (WebSockets)');
    offlineBannerEl.classList.add('hidden');
    updateOfflineQueueUI();
  });

  window.networkManager.on('disconnected', () => {
    setStatus('disconnected', 'Офлайн (Связь потеряна)');
    offlineBannerEl.classList.remove('hidden');
    updateOfflineQueueUI();
  });

  window.networkManager.on('reconnecting_in', ({ seconds }) => {
    setStatus('connecting', `Повтор через ${seconds}с...`);
  });

  // Первоначальное состояние
  window.networkManager.on('init_state', ({ playerId, player, snapshot }) => {
    myPlayerId = playerId;
    totalRoundDuration = snapshot.roundDuration || 45;
    aimCanvas.setTargets(snapshot.targets);
    updateTimerUI(snapshot.timeLeft, snapshot.roundState);
    renderLivePlayers(snapshot.players);
    renderHallOfFame(snapshot.hallOfFame);
    renderConflicts(snapshot.conflictLogs);
    renderChatHistory(snapshot.chatMessages);
  });

  // Старт раунда
  window.networkManager.on('round_started', ({ duration, targets, players }) => {
    totalRoundDuration = duration;
    roundEndOverlayEl.classList.add('hidden');
    aimCanvas.setTargets(targets);
    renderLivePlayers(players);
    updateTimerUI(duration, 'running');
  });

  // Синхронизация времени раунда
  window.networkManager.on('time_sync', ({ timeLeft, state }) => {
    updateTimerUI(timeLeft, state);
  });

  // Появление новой цели
  window.networkManager.on('target_spawned', ({ target }) => {
    aimCanvas.addTarget(target);
  });

  // Попадание в цель
  window.networkManager.on('target_hit', ({ targetId, playerId, playerName, points, newScore, x, y, color, players }) => {
    aimCanvas.removeTarget(targetId);
    aimCanvas.addHitEffect(x, y, color, points);

    if (playerId === myPlayerId) {
      if (points < 0) {
        window.soundEffects.playBomb();
      } else {
        window.soundEffects.playHit(points >= 25);
      }
    }

    renderLivePlayers(players);
  });

  // Исчезновение цели по таймауту
  window.networkManager.on('target_expired', ({ targetId }) => {
    aimCanvas.removeTarget(targetId);
  });

  // КОНФЛИКТ: два игрока нажали на одну цель почти одновременно (Дополнительно: 8-10 баллов)
  window.networkManager.on('target_conflict', ({ conflict, targetPos }) => {
    window.soundEffects.playConflict();
    if (targetPos) {
      aimCanvas.addConflictFlash(targetPos.x, targetPos.y, conflict);
    }
    addConflictToUI(conflict);
  });

  // Конец раунда
  window.networkManager.on('round_ended', ({ winner, scoreboard, nextRoundIn, hallOfFame }) => {
    aimCanvas.setTargets([]);
    roundEndOverlayEl.classList.remove('hidden');

    winnerAnnouncementEl.textContent = winner ? `🏆 Победитель: ${winner.name} (${winner.score} очков)` : 'Ничья!';

    // Подиум топ-3
    roundPodiumListEl.innerHTML = '';
    scoreboard.slice(0, 3).forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'podium-item';
      row.innerHTML = `<span>#${idx + 1} <b>${escapeHtml(p.name)}</b></span> <span>${p.score} очк. (${p.accuracy}%)</span>`;
      roundPodiumListEl.appendChild(row);
    });

    nextRoundTimerEl.textContent = nextRoundIn;
    renderHallOfFame(hallOfFame);
  });

  // Обновление статов игрока
  window.networkManager.on('player_stats_update', ({ playerId, player }) => {
    if (playerId === myPlayerId) {
      myHitsEl.textContent = player.hits;
      myMissesEl.textContent = player.misses;
      myAccuracyEl.textContent = player.accuracy + '%';
      myScoreEl.textContent = player.score;
    }
  });

  // Курсор другого игрока
  window.networkManager.on('cursor_update', ({ playerId, x, y }) => {
    const remote = window.networkManager.knownPlayers?.[playerId] || { name: 'Стрелок', color: '#ff0055' };
    aimCanvas.updateRemoteCursor(playerId, x, y, remote.name, remote.color);
  });

  window.networkManager.on('player_joined', ({ player, players }) => {
    if (!window.networkManager.knownPlayers) window.networkManager.knownPlayers = {};
    window.networkManager.knownPlayers[player.id] = player;
    renderLivePlayers(players);
  });

  window.networkManager.on('player_left', ({ playerId, players }) => {
    aimCanvas.removeRemoteCursor(playerId);
    renderLivePlayers(players);
  });

  window.networkManager.on('chat_message', (msg) => {
    appendChatMessage(msg);
  });

  // --- 4. Офлайн режим и очередь ---
  toggleOfflineBtn.addEventListener('click', () => {
    const isOffline = window.networkManager.toggleSimulateOffline();
    simOfflineStateEl.textContent = isOffline ? 'ВКЛ (СЕТЬ ОТКЛЮЧЕНА)' : 'ВЫКЛ';
    toggleOfflineBtn.classList.toggle('btn-primary', isOffline);
    toggleOfflineBtn.classList.toggle('btn-secondary', !isOffline);
  });

  retryConnectBtn.addEventListener('click', () => {
    if (window.networkManager.isSimulatingOffline) {
      window.networkManager.toggleSimulateOffline();
      simOfflineStateEl.textContent = 'ВЫКЛ';
    } else {
      window.networkManager.connect();
    }
  });

  window.networkManager.on('offline_shot_queued', () => updateOfflineQueueUI());
  window.networkManager.on('offline_queue_flushed', ({ count }) => {
    updateOfflineQueueUI();
    appendChatMessage({
      playerName: 'СИСТЕМА',
      text: `Синхронизировано ${count} накопленных офлайн-выстрелов!`,
      timestamp: Date.now()
    });
  });

  function updateOfflineQueueUI() {
    const count = window.clientStorage.getOfflineQueue().length;
    offlineQueueCountEl.textContent = count;
  }

  function setStatus(cls, text) {
    connectionStatusEl.className = `status-badge ${cls}`;
    statusTextEl.textContent = text;
  }

  // Обновление таймера
  function updateTimerUI(seconds, state) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    roundTimerDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    if (state === 'running') {
      roundStatusLabel.textContent = 'ИДЕТ РАУНД';
      roundStatusLabel.style.color = '#00f5d4';
      const pct = (seconds / totalRoundDuration) * 100;
      timerBarFill.style.width = `${pct}%`;
      timerBarFill.style.backgroundColor = '#00f5d4';
    } else if (state === 'intermission') {
      roundStatusLabel.textContent = 'ПЕРЕРЫВ';
      roundStatusLabel.style.color = '#ffa502';
      nextRoundTimerEl.textContent = seconds;
      timerBarFill.style.width = '100%';
      timerBarFill.style.backgroundColor = '#ffa502';
    } else {
      roundStatusLabel.textContent = 'ОЖИДАНИЕ ИГРОКОВ';
      roundStatusLabel.style.color = '#8b9bb4';
      timerBarFill.style.width = '100%';
    }
  }

  // Рендер живого счета в раунде
  function renderLivePlayers(players) {
    if (!players) return;
    livePlayersListEl.innerHTML = '';
    const sorted = [...players].sort((a, b) => b.score - a.score);

    // Обновляем свою статистику
    const me = sorted.find(p => p.id === myPlayerId);
    if (me) {
      myScoreEl.textContent = me.score;
      myAccuracyEl.textContent = me.accuracy + '%';
      myHitsEl.textContent = me.hits;
      myMissesEl.textContent = me.misses;
    }

    sorted.forEach((p, idx) => {
      const isMe = p.id === myPlayerId;
      const li = document.createElement('li');
      li.className = 'player-score-row' + (isMe ? ' my-row' : '');
      li.innerHTML = `
        <div class="row-left">
          <span class="rank-badge">#${idx + 1}</span>
          <span class="player-dot" style="background-color: ${p.color}"></span>
          <span class="player-name-txt">${escapeHtml(p.name)} ${isMe ? '(Вы)' : ''}</span>
        </div>
        <div class="row-right">
          <span class="accuracy-tag">${p.accuracy}%</span>
          <b class="score-tag">${p.score}</b>
        </div>
      `;
      livePlayersListEl.appendChild(li);
    });
  }

  // Рендер Зала славы (сохраненные рекорды между запусками)
  function renderHallOfFame(list) {
    if (!list || list.length === 0) {
      hallOfFameListEl.innerHTML = '<li class="empty-hint">Рекордов пока нет. Завершите раунд!</li>';
      return;
    }
    hallOfFameListEl.innerHTML = '';
    list.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'leaderboard-item';
      li.innerHTML = `
        <span><b class="leaderboard-rank">#${index + 1}</b> ${escapeHtml(item.name)}</span>
        <b>${item.score} очк.</b>
      `;
      hallOfFameListEl.appendChild(li);
    });
  }

  // Журнал разрешения конфликтов (Дополнительно: 8-10 баллов)
  function renderConflicts(conflicts) {
    if (!conflicts || conflicts.length === 0) return;
    conflictLogListEl.innerHTML = '';
    conflicts.forEach(c => addConflictToUI(c, false));
  }

  function addConflictToUI(conflict, prepend = true) {
    const empty = conflictLogListEl.querySelector('.empty-hint');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'conflict-item';
    item.innerHTML = `
      <div class="conflict-meta">
        <span>Цель: #${conflict.targetId.slice(-4)}</span>
        <span>${new Date(conflict.timestamp).toLocaleTimeString()}</span>
      </div>
      <div>Стрелок <b class="text-success">${escapeHtml(conflict.winnerPlayer)}</b> опередил <b class="text-danger">${escapeHtml(conflict.looserPlayer)}</b> на ${conflict.deltaMs}мс</div>
      <div class="conflict-res">Решение: ${escapeHtml(conflict.resolution)}</div>
    `;

    if (prepend) {
      conflictLogListEl.prepend(item);
      if (conflictLogListEl.children.length > 25) {
        conflictLogListEl.lastElementChild.remove();
      }
    } else {
      conflictLogListEl.appendChild(item);
    }
  }

  // Чат
  chatFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInputEl.value.trim();
    if (!text) return;

    window.networkManager.send({ type: 'chat', text });
    chatInputEl.value = '';
  });

  function renderChatHistory(msgs) {
    if (!msgs) return;
    msgs.forEach(m => appendChatMessage(m));
  }

  function appendChatMessage(msg) {
    const div = document.createElement('div');
    div.className = msg.playerName === 'СИСТЕМА' ? 'chat-system-msg' : 'chat-msg';
    if (msg.playerName === 'СИСТЕМА') {
      div.textContent = msg.text;
    } else {
      div.innerHTML = `<span class="chat-author">${escapeHtml(msg.playerName)}:</span> ${escapeHtml(msg.text)}`;
    }
    chatMessagesEl.appendChild(div);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }
});
