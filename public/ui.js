const UI = (() => {
  const screens = {
    splash: document.getElementById('splash-screen'),
    menu: document.getElementById('menu-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen')
  };

  const els = {
    menuError: document.getElementById('menu-error'),
    lobbyRoomCode: document.getElementById('lobby-room-code'),
    lobbyPlayerList: document.getElementById('lobby-player-list'),
    lobbyPlayerCount: document.getElementById('lobby-player-count'),
    lobbyStatus: document.getElementById('lobby-status'),
    lobbyHostName: document.getElementById('lobby-host-name'),
    lobbyError: document.getElementById('lobby-error'),
    matchDurationSelect: document.getElementById('match-duration-select'),
    startGameBtn: document.getElementById('start-game-btn'),
    leaveRoomBtn: document.getElementById('leave-room-btn'),
    usernameInput: document.getElementById('username-input'),
    roomCodeInput: document.getElementById('room-code-input'),
    hudUsername: document.getElementById('hud-username'),
    hudScore: document.getElementById('hud-score'),
    hudTimer: document.getElementById('hud-timer'),
    hudPhase: document.getElementById('hud-phase'),
    hudCountdown: document.getElementById('hud-countdown'),
    leaderboardList: document.getElementById('leaderboard-list'),
    roomCodeHud: document.getElementById('room-code-hud'),
    playerCount: document.getElementById('player-count'),
    notification: document.getElementById('notification'),
    toast: document.getElementById('toast'),
    endScreen: document.getElementById('end-screen'),
    resultsList: document.getElementById('results-list'),
    hostRestartBtn: document.getElementById('host-restart-btn'),
    hostLobbyBtn: document.getElementById('host-lobby-btn'),
    resultsCloseBtn: document.getElementById('results-close-btn')
  };

  let powerUpsBar = document.getElementById('powerups-bar');
  let lastPowerUpsRenderAt = 0;
  let lastLeaderboardKey = null;
  if (!powerUpsBar) {
    powerUpsBar = document.createElement('div');
    powerUpsBar.id = 'powerups-bar';
    powerUpsBar.className = 'powerups-bar';
    const hud = document.querySelector('.hud-left');
    if (hud) hud.appendChild(powerUpsBar);
  }

  function startMenu() {
    showScreen('menu');
  }

  let notificationTimeout = null;
  let toastTimeout = null;

  function showScreen(name) {
    if (screens[name].classList.contains('active')) return;
    Object.values(screens).forEach((screen) => screen.classList.remove('active'));
    screens[name].classList.add('active');
  }

  function showError(message, target = 'menu') {
    const targetEl = target === 'lobby' ? els.lobbyError : els.menuError;
    targetEl.textContent = message;
    targetEl.classList.remove('hidden');
  }

  function hideError(target = 'menu') {
    const targetEl = target === 'lobby' ? els.lobbyError : els.menuError;
    targetEl.classList.add('hidden');
  }

  function showNotification(message) {
    els.notification.textContent = message;
    els.notification.classList.remove('hidden');
    clearTimeout(notificationTimeout);
    notificationTimeout = setTimeout(() => els.notification.classList.add('hidden'), 2600);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => els.toast.classList.add('hidden'), 1800);
  }

  function showScoreBump() {
    els.hudScore.classList.remove('bump');
    void els.hudScore.offsetWidth;
    els.hudScore.classList.add('bump');
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.max(0, seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function renderActivePowerUps(player) {
    if (!powerUpsBar) return;
    const now = Date.now();
    if (now - lastPowerUpsRenderAt < 200) return;
    lastPowerUpsRenderAt = now;
    if (!player || !player.activePowerUps || player.activePowerUps.length === 0) {
      if (powerUpsBar.childElementCount) powerUpsBar.innerHTML = '';
      return;
    }
    powerUpsBar.innerHTML = player.activePowerUps
      .filter((pu) => pu.until > now)
      .map((pu) => {
        const remaining = Math.max(0, pu.until - now);
        const total = pu.type === 'speed' ? 5000 : pu.type === 'magnet' ? 8000 : 6000;
        const pct = Math.min(100, (remaining / total) * 100);
        return `
          <div class="pu-chip" style="--pu-color:${pu.color};">
            <span class="pu-emoji">${pu.emoji || '?'}</span>
            <div class="pu-meta">
              <div class="pu-name">${pu.name || pu.type}</div>
              <div class="pu-bar"><div class="pu-bar-fill" style="width:${pct}%"></div></div>
            </div>
          </div>
        `;
      }).join('');
  }

  function updateLobby(lobby, playerId) {
    const hostPlayer = lobby.players.find((player) => player.id === lobby.hostId);
    els.lobbyRoomCode.textContent = lobby.roomCode;
    els.lobbyPlayerCount.textContent = `${lobby.playerCount}/${lobby.maxPlayers}`;
    els.lobbyHostName.textContent = hostPlayer ? hostPlayer.username : '—';
    els.matchDurationSelect.value = String(lobby.matchDuration || 300);
    els.matchDurationSelect.disabled = lobby.hostId !== playerId;

    els.lobbyPlayerList.innerHTML = Array.from({ length: lobby.maxPlayers }, (_, index) => {
      const player = lobby.players[index];
      if (!player) {
        return '<li><span class="player-dot" style="background: rgba(255,255,255,0.2);"></span><span>Empty</span></li>';
      }
      const hostBadge = player.isHost ? '<span class="host-pill">Host</span>' : '';
      const youBadge = player.id === playerId ? '<span class="you-pill">You</span>' : '';
      return `
        <li>
          <span class="player-dot" style="background:${player.color}; color:${player.color};"></span>
          <span>${escapeHtml(player.username)}</span>
          ${hostBadge}
          ${youBadge}
        </li>
      `;
    }).join('');

    const hostView = lobby.hostId === playerId;
    els.startGameBtn.classList.toggle('hidden', !hostView);
    els.startGameBtn.disabled = lobby.playerCount < 2;
    els.lobbyStatus.textContent = hostView ? 'You are the host.' : 'Waiting for host...';
  }

  function updateHUD(state, playerId) {
    const me = state.players.find((player) => player.id === playerId);
    if (me) {
      if (els.hudUsername.textContent !== me.username) els.hudUsername.textContent = me.username;
      if (els.hudUsername.dataset.playerColor !== me.color) {
        els.hudUsername.style.color = me.color;
        els.hudUsername.dataset.playerColor = me.color;
      }
      const score = String(me.score || 0);
      if (els.hudScore.textContent !== score) els.hudScore.textContent = score;
      renderActivePowerUps(me);
    }

    const roomCode = state.roomCode || '—';
    if (els.roomCodeHud.textContent !== roomCode) els.roomCodeHud.textContent = roomCode;
    const playerCount = `${state.playerCount}/${state.maxPlayers}`;
    if (els.playerCount.textContent !== playerCount) els.playerCount.textContent = playerCount;
    const timer = formatTime(state.timeLeft || 0);
    if (els.hudTimer.textContent !== timer) els.hudTimer.textContent = timer;

    if (state.timeLeft && state.timeLeft <= 30) {
      els.hudTimer.classList.add('warning');
    } else {
      els.hudTimer.classList.remove('warning');
    }

    if (state.phase === 'countdown') {
      els.hudPhase.textContent = 'Get Ready';
      els.hudPhase.classList.remove('hidden');
      els.hudCountdown.textContent = String(state.countdown || 0);
      els.hudCountdown.classList.remove('hidden');
    } else if (state.phase === 'playing') {
      els.hudPhase.classList.add('hidden');
      els.hudCountdown.classList.add('hidden');
    } else if (state.phase === 'ended') {
      els.hudPhase.textContent = 'Match Over';
      els.hudPhase.classList.remove('hidden');
      els.hudCountdown.classList.add('hidden');
    }

    const leaderboardKey = state.players
      .map((player) => `${player.id}:${player.totalScore || player.score || 0}:${player.alive ? 1 : 0}`)
      .join('|');
    if (leaderboardKey === lastLeaderboardKey) return;
    lastLeaderboardKey = leaderboardKey;
    const ordered = [...state.players].sort((a, b) => (b.totalScore || b.score || 0) - (a.totalScore || a.score || 0));
    els.leaderboardList.innerHTML = ordered.map((player, index) => {
      const highlight = player.id === playerId ? ' class="you"' : '';
      const statusIcon = !player.alive ? '💀' : '';
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
      return `
        <li${highlight}>
          <span class="lb-rank">${medal || (index + 1) + '.'}</span>
          <span class="lb-name" style="color:${player.color}">${statusIcon}${escapeHtml(player.username)}</span>
          <span class="lb-score">${player.totalScore || player.score || 0}</span>
        </li>
      `;
    }).join('');
  }

  function showEndScreen(results, isHost, playerId) {
    const ordered = [...results].sort((a, b) => a.rank - b.rank);
    els.resultsList.innerHTML = ordered.map((entry) => {
      const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : '';
      const youClass = entry.id === playerId ? ' class="you-row"' : '';
      return `
        <li${youClass}>
          <span class="rank-pill">${medal || '#' + entry.rank}</span>
          <span style="color:${entry.color}">${escapeHtml(entry.username)}</span>
          <strong>${entry.score}</strong>
        </li>
      `;
    }).join('');

    els.hostRestartBtn.classList.toggle('hidden', !isHost);
    els.hostLobbyBtn.classList.toggle('hidden', !isHost);
    els.endScreen.classList.remove('hidden');
  }

  function hideEndScreen() {
    els.endScreen.classList.add('hidden');
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  function getUsername() {
    return els.usernameInput.value.trim();
  }

  function getRoomCode() {
    return els.roomCodeInput.value.trim().toUpperCase();
  }

  return {
    showScreen,
    startMenu,
    showError,
    hideError,
    showNotification,
    showToast,
    showScoreBump,
    updateLobby,
    updateHUD,
    showEndScreen,
    hideEndScreen,
    getUsername,
    getRoomCode,
    els
  };
})();
