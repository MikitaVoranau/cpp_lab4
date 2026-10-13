document.addEventListener('DOMContentLoaded', () => {
  const PALETTE = ['#00f5d4', '#ff007f', '#ffbe0b', '#7b2cbf', '#3a86ff', '#2ed573'];

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

  const startGameBtn = document.getElementById('startGameBtn');
  const modalStartBtn = document.getElementById('modalStartBtn');
  const playAgainBtn = document.getElementById('playAgainBtn');
  const startHintEl = document.getElementById('startHint');
  const lobbyOverlayEl = document.getElementById('lobbyOverlay');
  const lobbyPlayerCountEl = document.getElementById('lobbyPlayerCount');

  const pauseOverlayEl = document.getElementById('pauseOverlay');
  const pausePlayerInfoEl = document.getElementById('pausePlayerInfo');
  const pauseTimerCounterEl = document.getElementById('pauseTimerCounter');

  const playerAvatarEl = document.getElementById('playerAvatar');
  const playerNameDisplayEl = document.getElementById('playerNameDisplay');
  const changeNameBtn = document.getElementById('changeNameBtn');

  const myScoreEl = document.getElementById('myScore');
  const myAccuracyEl = document.getElementById('myAccuracy');
  const myHitsEl = document.getElementById('myHits');
  const myMissesEl = document.getElementById('myMisses');

  const livePlayersListEl = document.getElementById('livePlayersList');
  const hallOfFameListEl = document.getElementById('hallOfFameList');

  const roundEndOverlayEl = document.getElementById('roundEndOverlay');
  const winnerAnnouncementEl = document.getElementById('winnerAnnouncement');
  const roundEndReasonEl = document.getElementById('roundEndReason');
  const roundPodiumListEl = document.getElementById('roundPodiumList');

  const conflictToastEl = document.getElementById('conflictToast');
  const conflictToastTitleEl = document.getElementById('conflictToastTitle');
  const conflictToastDescEl = document.getElementById('conflictToastDesc');
  let conflictToastTimer = null;

  const loginModalEl = document.getElementById('loginModal');
  const loginFormEl = document.getElementById('loginForm');
  const playerNameInputEl = document.getElementById('playerNameInput');
  const modalColorsEl = document.getElementById('modalColors');

  const aimCanvas = new AimCanvas(canvasEl);

  let myPlayerId = null;
  let currentColor = PALETTE[0];
  let selectedModalColor = PALETTE[0];
  let totalRoundDuration = 45;

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

    if (!window.networkManager.isConnected) {
      window.networkManager.connect();
    } else {
      window.networkManager.send({
        type: 'join',
        name,
        color: currentColor
      });
    }
  });

  changeNameBtn.addEventListener('click', () => {
    loginModalEl.classList.remove('hidden');
  });

  if (savedPlayer.name) {
    loginModalEl.classList.add('hidden');
    window.networkManager.connect();
  } else {
    loginModalEl.classList.remove('hidden');
  }

  toggleSoundBtn.addEventListener('click', () => {
    const isEnabled = window.soundEffects.toggle();
    toggleSoundBtn.textContent = isEnabled ? '🔊 Звук: ВКЛ' : '🔇 Звук: ВЫКЛ';
  });

  function requestStartGame() {
    window.soundEffects.ensureContext();
    window.networkManager.send({ type: 'start_game' });
  }

  startGameBtn.addEventListener('click', requestStartGame);
  modalStartBtn.addEventListener('click', requestStartGame);
  playAgainBtn.addEventListener('click', requestStartGame);

  aimCanvas.onTargetClick = (targetId, expectedVersion) => {
    window.soundEffects.playShot();
    window.networkManager.sendShoot(targetId, expectedVersion);
  };

  aimCanvas.onMissClick = () => {
    window.soundEffects.playShot();
    window.networkManager.sendMiss();
  };

  aimCanvas.onCursorMove = (arenaX, arenaY) => {
    window.networkManager.sendCursorMove(arenaX, arenaY);
  };

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

  window.networkManager.on('init_state', ({ playerId, player, snapshot }) => {
    myPlayerId = playerId;
    if (player) {
      playerNameDisplayEl.textContent = player.name;
      playerAvatarEl.style.backgroundColor = player.color;
      currentColor = player.color;
      aimCanvas.myColor = player.color;
      window.clientStorage.savePlayer(player.name, player.color);
    }

    totalRoundDuration = snapshot.roundDuration || 45;
    aimCanvas.setTargets(snapshot.targets);
    updateTimerUI(snapshot.timeLeft, snapshot.roundState);
    renderLivePlayers(snapshot.players);
    renderHallOfFame(snapshot.hallOfFame);

    if (snapshot.isPaused) {
      showPause(snapshot.pausedPlayerName, snapshot.pauseSecondsLeft);
    } else {
      pauseOverlayEl.classList.add('hidden');
      aimCanvas.isPaused = false;
    }

    if (snapshot.roundState === 'running') {
      lobbyOverlayEl.classList.add('hidden');
      roundEndOverlayEl.classList.add('hidden');
    } else {
      lobbyOverlayEl.classList.remove('hidden');
    }
  });

  window.networkManager.on('round_started', ({ duration, targets, players, startedBy }) => {
    totalRoundDuration = duration;
    lobbyOverlayEl.classList.add('hidden');
    roundEndOverlayEl.classList.add('hidden');
    pauseOverlayEl.classList.add('hidden');
    aimCanvas.isPaused = false;
    aimCanvas.setTargets(targets);
    renderLivePlayers(players);
    updateTimerUI(duration, 'running');

    startGameBtn.disabled = true;
    startGameBtn.textContent = '⏳ РАУНД ИДЕТ...';
    startHintEl.textContent = `Запустил: ${startedBy}`;
  });

  window.networkManager.on('time_sync', ({ timeLeft, state }) => {
    updateTimerUI(timeLeft, state);
  });

  window.networkManager.on('target_spawned', ({ target }) => {
    aimCanvas.addTarget(target);
  });

  window.networkManager.on('target_hit', ({ targetId, playerId, points, x, y, color, players }) => {
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

  window.networkManager.on('target_expired', ({ targetId }) => {
    aimCanvas.removeTarget(targetId);
  });

  window.networkManager.on('target_conflict', ({ conflict, targetPos }) => {
    window.soundEffects.playConflict();
    if (targetPos) {
      aimCanvas.addConflictFlash(targetPos.x, targetPos.y, conflict);
    }
    showToast(`⚡ Коллизия цели #${conflict.targetId.slice(-4)}`, `${conflict.winnerPlayer} опередил ${conflict.looserPlayer} на ${conflict.deltaMs}мс`);
  });

  window.networkManager.on('game_paused', ({ playerName, secondsLeft }) => {
    showPause(playerName, secondsLeft);
  });

  window.networkManager.on('pause_tick', ({ playerName, secondsLeft }) => {
    pausePlayerInfoEl.textContent = `Игрок ${escapeHtml(playerName)} отключился`;
    pauseTimerCounterEl.textContent = secondsLeft;
  });

  window.networkManager.on('game_resumed', ({ playerName, players }) => {
    pauseOverlayEl.classList.add('hidden');
    aimCanvas.isPaused = false;
    showToast('🟢 Игра возобновлена', `Игрок ${playerName} переподключился!`);
    if (players) renderLivePlayers(players);
  });

  window.networkManager.on('player_forfeited', ({ playerName, message }) => {
    pauseOverlayEl.classList.add('hidden');
    aimCanvas.isPaused = false;
    showToast('⚠️ Игрок исключен', message);
  });

  function showPause(playerName, seconds) {
    aimCanvas.isPaused = true;
    pausePlayerInfoEl.textContent = `Игрок ${escapeHtml(playerName || 'Участник')} отключился`;
    pauseTimerCounterEl.textContent = seconds;
    pauseOverlayEl.classList.remove('hidden');
  }

  window.networkManager.on('round_ended', ({ winner, scoreboard, hallOfFame, reason }) => {
    aimCanvas.setTargets([]);
    pauseOverlayEl.classList.add('hidden');
    aimCanvas.isPaused = false;
    roundEndOverlayEl.classList.remove('hidden');

    winnerAnnouncementEl.textContent = winner ? `🏆 Победитель: ${winner.name} (${winner.score} очк.)` : 'Ничья!';
    roundEndReasonEl.textContent = reason || '';

    roundPodiumListEl.innerHTML = '';
    scoreboard.slice(0, 3).forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'podium-item';
      row.innerHTML = `<span>#${idx + 1} <b>${escapeHtml(p.name)}</b></span> <span>${p.score} очк. (${p.accuracy}%)</span>`;
      roundPodiumListEl.appendChild(row);
    });

    renderHallOfFame(hallOfFame);

    startGameBtn.disabled = false;
    startGameBtn.textContent = '▶ НАЧАТЬ РАУНД (45с)';
    startHintEl.textContent = 'Нажмите, чтобы запустить новый раунд';
  });

  window.networkManager.on('player_stats_update', ({ playerId, player }) => {
    if (playerId === myPlayerId) {
      myHitsEl.textContent = player.hits;
      myMissesEl.textContent = player.misses;
      myAccuracyEl.textContent = player.accuracy + '%';
      myScoreEl.textContent = player.score;
    }
  });

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

  toggleOfflineBtn.addEventListener('click', () => {
    const isOffline = window.networkManager.toggleSimulateOffline();
    simOfflineStateEl.textContent = isOffline ? 'ВКЛ' : 'ВЫКЛ';
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
  window.networkManager.on('offline_queue_flushed', () => updateOfflineQueueUI());

  function updateOfflineQueueUI() {
    const count = window.clientStorage.getOfflineQueue().length;
    offlineQueueCountEl.textContent = count;
  }

  function setStatus(cls, text) {
    connectionStatusEl.className = `status-badge ${cls}`;
    statusTextEl.textContent = text;
  }

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
    } else {
      roundStatusLabel.textContent = 'ЛОББИ (ОЖИДАНИЕ)';
      roundStatusLabel.style.color = '#8b9bb4';
      timerBarFill.style.width = '100%';
      timerBarFill.style.backgroundColor = '#8b9bb4';
    }
  }

  function showToast(title, desc) {
    if (conflictToastTimer) clearTimeout(conflictToastTimer);
    conflictToastTitleEl.textContent = title;
    conflictToastDescEl.textContent = desc;
    conflictToastEl.classList.remove('hidden');

    conflictToastTimer = setTimeout(() => {
      conflictToastEl.classList.add('hidden');
    }, 3000);
  }

  function renderLivePlayers(players) {
    if (!players) return;
    livePlayersListEl.innerHTML = '';
    lobbyPlayerCountEl.textContent = players.length;

    const sorted = [...players].sort((a, b) => b.score - a.score);
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
      li.className = 'player-score-row' + (isMe ? ' my-row' : '') + (!p.connected ? ' disconnected-row' : '');
      li.innerHTML = `
        <div class="row-left">
          <span class="rank-badge">#${idx + 1}</span>
          <span class="player-dot" style="background-color: ${p.color}"></span>
          <span class="player-name-txt">${escapeHtml(p.name)} ${isMe ? '(Вы)' : ''} ${!p.connected ? '(Отключен)' : ''}</span>
        </div>
        <div class="row-right">
          <span class="accuracy-tag">${p.accuracy}%</span>
          <b class="score-tag">${p.score}</b>
        </div>
      `;
      livePlayersListEl.appendChild(li);
    });
  }

  function renderHallOfFame(list) {
    if (!list || list.length === 0) {
      hallOfFameListEl.innerHTML = '<li class="empty-hint">Рекордов пока нет</li>';
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

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }
});
