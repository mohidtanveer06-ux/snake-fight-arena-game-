const Game = (() => {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const minimap = document.getElementById('minimap');
  const miniCtx = minimap.getContext('2d');

  let playerId = null;
  let roomCode = null;
  let isHost = false;
  let gameState = null;
  let prevGameState = null;
  let localInput = { up: false, down: false, left: false, right: false };
  let lastDirection = null;
  let lastSentDirection = null;
  const inputTickInterval = 40;
  let inputTimerId = null;
  let animationFrame = null;
  let camera = { x: 0, y: 0 };
  let initialized = false;
  let socket = null;

  let particles = [];
  let screenShake = { intensity: 0, time: 0 };
  let lastCrystalCount = 0;
  let lastPlayerScores = new Map();
  let lastPowerUpCount = 0;
  let lastAliveStates = new Map();

  let swipeStart = null;

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function emitInput() {
    if (socket && socket.connected) {
      const payload = Object.assign({}, localInput);
      if (lastDirection) payload.dir = lastDirection;
      socket.emit('playerInput', payload);
      lastSentDirection = lastDirection || lastSentDirection;
    }
  }

  function isOpposite(a, b) {
    if (!a || !b) return false;
    return (a === 'up' && b === 'down') || (a === 'down' && b === 'up') || (a === 'left' && b === 'right') || (a === 'right' && b === 'left');
  }

  function updateLocalInputFromDirection(dir) {
    localInput.up = localInput.down = localInput.left = localInput.right = false;
    if (!dir) return;
    localInput[dir] = true;
  }

  function setDirection(dir) {
    if (isOpposite(lastSentDirection || lastDirection, dir)) return;
    lastDirection = dir;
    updateLocalInputFromDirection(dir);
    emitInput();
    updateDirectionIndicator(dir);
  }

  function isTextInputFocused() {
    try {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function handleKeyDown(event) {
    if (isTextInputFocused()) return;
    const map = {
      KeyW: 'up', ArrowUp: 'up',
      KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right'
    };
    const key = map[event.code];
    if (!key) return;
    event.preventDefault();
    setDirection(key);
  }

  function updateCamera() {
    const player = getLocalPlayer();
    if (!player || !gameState) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const arenaW = gameState.arena.width;
    const arenaH = gameState.arena.height;
    const targetX = player.x - vw / 2;
    const targetY = player.y - vh / 2;
    camera.x += (targetX - camera.x) * 0.15;
    camera.y += (targetY - camera.y) * 0.15;
    camera.x = clamp(camera.x, 0, Math.max(0, arenaW - vw));
    camera.y = clamp(camera.y, 0, Math.max(0, arenaH - vh));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getLocalPlayer() {
    if (!gameState) return null;
    return gameState.players.find((player) => player.id === playerId) || null;
  }

  function spawnParticles(x, y, color, count = 12, opts = {}) {
    const { speed = 3, life = 0.6, spread = 1, size = 4 } = opts;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (Math.random() * 0.6 + 0.4) * speed;
      particles.push({
        x, y,
        vx: Math.cos(angle) * spd * spread,
        vy: Math.sin(angle) * spd * spread,
        life: life * (0.7 + Math.random() * 0.6),
        maxLife: life,
        color,
        size: size * (0.6 + Math.random() * 0.8)
      });
    }
  }

  function addScreenShake(intensity, duration = 0.25) {
    screenShake.intensity = Math.max(screenShake.intensity, intensity);
    screenShake.time = Math.max(screenShake.time, duration);
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    if (screenShake.time > 0) {
      screenShake.time -= dt;
      screenShake.intensity *= 0.92;
      if (screenShake.time <= 0) { screenShake.intensity = 0; }
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = Math.max(0, p.life / p.maxLife);
      const x = p.x - camera.x;
      const y = p.y - camera.y;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBackground() {
    const width = gameState.arena.width;
    const height = gameState.arena.height;
    ctx.save();
    let sx = 0, sy = 0;
    if (screenShake.intensity > 0.1) {
      sx = (Math.random() - 0.5) * screenShake.intensity * 2;
      sy = (Math.random() - 0.5) * screenShake.intensity * 2;
      ctx.translate(sx, sy);
    }

    ctx.fillStyle = '#060a14';
    ctx.fillRect(-camera.x, -camera.y, width, height);

    ctx.strokeStyle = 'rgba(85, 248, 255, 0.09)';
    const grid = 60;
    for (let x = Math.floor(camera.x / grid) * grid; x < camera.x + window.innerWidth + grid; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x - camera.x, -camera.y);
      ctx.lineTo(x - camera.x, height - camera.y);
      ctx.stroke();
    }
    for (let y = Math.floor(camera.y / grid) * grid; y < camera.y + window.innerHeight + grid; y += grid) {
      ctx.beginPath();
      ctx.moveTo(-camera.x, y - camera.y);
      ctx.lineTo(width - camera.x, y - camera.y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 45, 149, 0.7)';
    ctx.lineWidth = 4;
    ctx.strokeRect(-camera.x + 14, -camera.y + 14, width - 28, height - 28);
    ctx.restore();
  }

  function drawCrystals() {
    if (!gameState) return;
    for (const crystal of gameState.crystals) {
      const x = crystal.x - camera.x;
      const y = crystal.y - camera.y;
      if (x < -40 || x > window.innerWidth + 40 || y < -40 || y > window.innerHeight + 40) continue;
      const pulse = 1 + Math.sin(Date.now() * 0.005 + crystal.x) * 0.18;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.shadowColor = crystal.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = crystal.color;
      ctx.beginPath();
      ctx.moveTo(0, -crystal.radius * pulse);
      ctx.lineTo(crystal.radius * 0.8 * pulse, 0);
      ctx.lineTo(0, crystal.radius * pulse);
      ctx.lineTo(-crystal.radius * 0.8 * pulse, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawDroppedEnergy() {
    if (!gameState) return;
    for (const fragment of gameState.droppedEnergy) {
      const x = fragment.x - camera.x;
      const y = fragment.y - camera.y;
      if (x < -30 || x > window.innerWidth + 30 || y < -30 || y > window.innerHeight + 30) continue;
      const pulse = 1 + Math.sin(Date.now() * 0.008 + fragment.x * 0.01) * 0.2;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255, 209, 102, 0.9)';
      ctx.shadowColor = '#FFD166';
      ctx.shadowBlur = 14;
      ctx.arc(x, y, fragment.radius * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawPowerUps() {
    if (!gameState || !gameState.powerUps) return;
    const now = Date.now();
    for (const pu of gameState.powerUps) {
      const x = pu.x - camera.x;
      const y = pu.y - camera.y;
      if (x < -60 || x > window.innerWidth + 60 || y < -60 || y > window.innerHeight + 60) continue;
      const life = Math.max(0, 1 - (now - pu.spawnedAt) / 30000);
      const pulse = 1 + Math.sin(now * 0.006 + pu.x) * 0.2;
      ctx.save();
      ctx.translate(x, y);
      ctx.shadowColor = pu.color;
      ctx.shadowBlur = 25 * pulse;
      ctx.strokeStyle = pu.color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.3 + life * 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, pu.radius * 1.6 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = pu.color;
      ctx.beginPath();
      ctx.arc(0, 0, pu.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = `${pu.radius * 1.2}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pu.emoji || '?', 0, 2);
      ctx.restore();
    }
  }

  function drawSnake(player, local) {
    if (!player.segments || !player.segments.length) return;
    const now = Date.now();
    const headX = player.segments[0].x - camera.x;
    const headY = player.segments[0].y - camera.y;
    const hasSpeed = player.speedUntil > now;
    const hasMagnet = player.magnetUntil > now;
    const hasShield = player.shieldUntil > now;
    const spawning = player.spawnAnimUntil > now;
    const headRadius = 18;
    const bodyRadius = 15;
    const eyeR = 4.2;

    if (hasMagnet && local) {
      ctx.save();
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.38)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(headX, headY, 180, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    ctx.save();
    if (spawning) {
      const t = 1 - (player.spawnAnimUntil - now) / 1200;
      ctx.globalAlpha = clamp(t * 1.5, 0.2, 1);
    }

    ctx.beginPath();
    for (let i = player.segments.length - 1; i >= 0; i -= 1) {
      const segment = player.segments[i];
      const x = segment.x - camera.x;
      const y = segment.y - camera.y;
      const r = i === 0 ? headRadius : bodyRadius - Math.min(6, i * 0.18);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.shadowColor = hasSpeed ? '#FFD166' : player.color;
    ctx.shadowBlur = local ? 18 : 10;
    ctx.fillStyle = player.color;
    ctx.fill();
    ctx.shadowBlur = 0;

    const snakeAlpha = ctx.globalAlpha;
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = player.segments.length - 1; i >= 0; i -= 1) {
      const segment = player.segments[i];
      const x = segment.x - camera.x;
      const y = segment.y - camera.y;
      const r = i === 0 ? headRadius : bodyRadius - Math.min(6, i * 0.18);
      ctx.moveTo(x, y - r * 0.35);
      ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.35, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha = snakeAlpha;

    if (hasSpeed) {
      const dx = player.dirX || 1;
      const dy = player.dirY || 0;
      for (let t = 1; t <= 3; t += 1) {
        ctx.save();
        ctx.globalAlpha = 0.28 - t * 0.07;
        ctx.fillStyle = player.color;
        ctx.beginPath();
        ctx.arc(headX - dx * t * 12, headY - dy * t * 12, headRadius - t * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    const dirX = player.dirX || 1;
    const dirY = player.dirY || 0;
    const perpX = -dirY;
    const perpY = dirX;
    const eyeBaseX = headX + dirX * 7;
    const eyeBaseY = headY + dirY * 7;
    const sep = 6;
    const eyeLX = eyeBaseX + perpX * sep;
    const eyeLY = eyeBaseY + perpY * sep;
    const eyeRX = eyeBaseX - perpX * sep;
    const eyeRY = eyeBaseY - perpY * sep;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(eyeLX, eyeLY, eyeR, 0, Math.PI * 2);
    ctx.arc(eyeRX, eyeRY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#101828';
    ctx.beginPath();
    ctx.arc(eyeLX + dirX * 1.5, eyeLY + dirY * 1.5, eyeR * 0.55, 0, Math.PI * 2);
    ctx.arc(eyeRX + dirX * 1.5, eyeRY + dirY * 1.5, eyeR * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = '700 13px Rajdhani';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeText(player.username, headX, headY - headRadius - 8);
    ctx.fillText(player.username, headX, headY - headRadius - 8);

    if (hasShield) {
      const shieldPulse = 1 + Math.sin(now * 0.012) * 0.1;
      ctx.strokeStyle = 'rgba(85, 248, 255, 0.95)';
      ctx.lineWidth = 3.5;
      ctx.shadowColor = '#55F8FF';
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.arc(headX, headY, headRadius + 12 + shieldPulse * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function drawPlayers() {
    if (!gameState) return;
    const localP = getLocalPlayer();
    const others = [];
    for (const player of gameState.players) {
      if (player.id === playerId) continue;
      others.push(player);
    }
    for (const player of others) drawSnake(player, false);
    if (localP) drawSnake(localP, true);
  }

  function drawMinimap() {
    if (!gameState) return;
    const { width, height } = gameState.arena;
    miniCtx.clearRect(0, 0, minimap.width, minimap.height);
    miniCtx.fillStyle = 'rgba(4, 6, 13, 0.75)';
    miniCtx.fillRect(0, 0, minimap.width, minimap.height);

    const scaleX = minimap.width / width;
    const scaleY = minimap.height / height;
    miniCtx.strokeStyle = 'rgba(85, 248, 255, 0.6)';
    miniCtx.strokeRect(2, 2, minimap.width - 4, minimap.height - 4);

    if (gameState.powerUps) {
      for (const pu of gameState.powerUps) {
        const px = pu.x * scaleX;
        const py = pu.y * scaleY;
        miniCtx.fillStyle = pu.color;
        miniCtx.beginPath();
        miniCtx.arc(px, py, 2.5, 0, Math.PI * 2);
        miniCtx.fill();
      }
    }

    for (const player of gameState.players) {
      const px = player.x * scaleX;
      const py = player.y * scaleY;
      miniCtx.beginPath();
      miniCtx.fillStyle = player.id === playerId ? '#55F8FF' : player.color;
      miniCtx.globalAlpha = player.alive ? 1 : 0.3;
      miniCtx.arc(px, py, player.id === playerId ? 3.8 : 2.8, 0, Math.PI * 2);
      miniCtx.fill();
      miniCtx.globalAlpha = 1;
    }

    const viewX = camera.x * scaleX;
    const viewY = camera.y * scaleY;
    const viewW = window.innerWidth * scaleX;
    const viewH = window.innerHeight * scaleY;
    miniCtx.strokeStyle = 'rgba(255, 209, 102, 0.7)';
    miniCtx.lineWidth = 1;
    miniCtx.strokeRect(viewX, viewY, viewW, viewH);
  }

  function updateDirectionIndicatorFromState() {
    const el = document.getElementById('direction-indicator');
    if (!el) return;
    let dir = lastDirection;
    try {
      const local = gameState && gameState.players && gameState.players.find((p) => p.id === playerId);
      if (!dir && local) {
        if (local.dirX === 1 && local.dirY === 0) dir = 'right';
        else if (local.dirX === -1 && local.dirY === 0) dir = 'left';
        else if (local.dirY === 1 && local.dirX === 0) dir = 'down';
        else if (local.dirY === -1 && local.dirX === 0) dir = 'up';
      }
    } catch (e) {
      // ignore
    }
    updateDirectionIndicator(dir);
  }

  function updateDirectionIndicator(dir) {
    const el = document.getElementById('direction-indicator');
    if (!el) return;
    el.classList.remove('up', 'down', 'left', 'right');
    if (!dir) return;
    el.classList.add(dir);
  }

  function detectGameEvents() {
    if (!gameState || !prevGameState) return;
    const now = Date.now();
    const crystalCount = gameState.crystals ? gameState.crystals.length : 0;
    const local = getLocalPlayer();

    if (local) {
      const hasPreviousScore = lastPlayerScores.has(local.id);
      const prevScore = lastPlayerScores.get(local.id) || 0;
      if (hasPreviousScore && local.score > prevScore) {
        const gain = local.score - prevScore;
        if (gain >= 1) {
          AudioFX.play('collect');
          spawnParticles(local.x, local.y, '#FFD166', 6 + Math.min(16, gain * 2), { speed: 2.5, life: 0.45 });
          UI.showScoreBump();
        }
      }
      lastPlayerScores.set(local.id, local.score);

      const prevAlive = lastAliveStates.get(local.id);
      if (prevAlive && !local.alive) {
        AudioFX.play('death');
        spawnParticles(local.x, local.y, local.color, 36, { speed: 5, life: 0.9, spread: 1.4, size: 6 });
        spawnParticles(local.x, local.y, '#ff6b6b', 20, { speed: 3.5, life: 0.7 });
        addScreenShake(14, 0.4);
        UI.showToast('You died! Respawning...');
      } else if (prevAlive === false && local.alive) {
        AudioFX.play('respawn');
        spawnParticles(local.x, local.y, '#55F8FF', 24, { speed: 3, life: 0.7 });
        UI.showToast('Respawned!');
      }
      lastAliveStates.set(local.id, local.alive);

      if (gameState.powerUps && local.alive) {
        const prevPUCount = lastPowerUpCount || 0;
        if (gameState.powerUps.length < prevPUCount) {
          const prevPUs = prevGameState.powerUps || [];
          const currentPUs = gameState.powerUps || [];
          const collected = prevPUs.filter((pp) => !currentPUs.some((cp) => cp.id === pp.id));
          for (const pu of collected) {
            const d = Math.hypot(local.x - pu.x, local.y - pu.y);
            if (d < 60) {
              AudioFX.play('powerup');
              spawnParticles(pu.x, pu.y, pu.color, 28, { speed: 4, life: 0.6, size: 5 });
              UI.showToast(`${pu.emoji || ''} ${pu.name}!`);
            }
          }
        }
      }
    }

    for (const p of gameState.players) {
      if (p.id === playerId) continue;
      const prevA = lastAliveStates.get(p.id);
      if (prevA && !p.alive) {
        AudioFX.play('knockout');
        spawnParticles(p.x, p.y, p.color, 28, { speed: 4.5, life: 0.8, spread: 1.3, size: 5 });
      }
      lastAliveStates.set(p.id, p.alive);
    }

    if (gameState.powerUps) {
      lastPowerUpCount = gameState.powerUps.length;
    }
    lastCrystalCount = crystalCount;
  }

  function render(dt) {
    if (!gameState) return;
    updateParticles(dt);
    updateCamera();

    ctx.save();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    ctx.fillStyle = '#04060d';
    ctx.fillRect(0, 0, vw, vh);

    drawBackground();
    drawCrystals();
    drawDroppedEnergy();
    drawPowerUps();
    drawPlayers();
    drawParticles();
    ctx.restore();

    drawMinimap();
    updateDirectionIndicatorFromState();
    detectGameEvents();
    prevGameState = gameState;
  }

  let lastRenderTime = performance.now();
  function loop(now) {
    animationFrame = null;
    if (!gameState) return;
    const dt = Math.min(0.05, (now - lastRenderTime) / 1000);
    lastRenderTime = now;
    render(dt);
    animationFrame = requestAnimationFrame(loop);
  }

  function startRenderLoop() {
    if (animationFrame !== null || !gameState) return;
    lastRenderTime = performance.now();
    animationFrame = requestAnimationFrame(loop);
  }

  function connect() {
    if (socket) return;
    socket = io();

    socket.on('connect', () => {
      UI.showNotification('Connected');
    });

    socket.on('roomCreated', ({ roomCode: code, playerId: id, isHost: hostFlag, lobby }) => {
      playerId = id;
      roomCode = code;
      isHost = hostFlag;
      UI.showScreen('lobby');
      UI.updateLobby(lobby, id);
      UI.showNotification('Room created');
    });

    socket.on('roomJoined', ({ roomCode: code, playerId: id, isHost: hostFlag, lobby }) => {
      playerId = id;
      roomCode = code;
      isHost = hostFlag;
      UI.showScreen('lobby');
      UI.updateLobby(lobby, id);
      UI.showNotification('Room joined');
    });

    socket.on('lobbyUpdate', (lobby) => {
      UI.updateLobby(lobby, playerId);
      if (lobby.phase === 'lobby') {
        UI.showScreen('lobby');
      }
    });

    socket.on('gameStarted', (data) => {
      AudioFX.play('start');
      UI.showNotification(data.message || 'Game starting');
      UI.hideEndScreen();
      particles = [];
      lastPlayerScores.clear();
      lastAliveStates.clear();
      lastCrystalCount = 0;
      lastPowerUpCount = 0;
    });

    socket.on('gameState', (state) => {
      if (state.phase === 'ended' && (!prevGameState || prevGameState.phase !== 'ended')) {
        AudioFX.play('end');
      }
      gameState = state;
      startRenderLoop();
      UI.updateHUD(state, playerId);
      try {
        const local = state.players && state.players.find((p) => p.id === playerId);
        if (local && (local.dirX !== undefined || local.dirY !== undefined)) {
          if (local.dirX === 1 && local.dirY === 0) lastDirection = 'right';
          else if (local.dirX === -1 && local.dirY === 0) lastDirection = 'left';
          else if (local.dirY === 1 && local.dirX === 0) lastDirection = 'down';
          else if (local.dirY === -1 && local.dirX === 0) lastDirection = 'up';
          lastSentDirection = lastDirection;
          updateLocalInputFromDirection(lastDirection);
        }
      } catch (e) {
        // ignore
      }
      if (state.phase === 'countdown' || state.phase === 'playing' || state.phase === 'ended') {
        UI.showScreen('game');
      }
      if (state.phase === 'ended' && state.finalResults) {
        UI.showEndScreen(state.finalResults, isHost, playerId);
      }
    });

    socket.on('playerJoined', (data) => {
      UI.showNotification(data.message);
    });

    socket.on('playerLeft', (data) => {
      UI.showNotification(data.message);
    });

    socket.on('hostChanged', (data) => {
      if (gameState && gameState.hostId === playerId) {
        isHost = true;
      } else {
        isHost = false;
      }
      UI.showNotification(data.message || 'Host changed');
    });

    socket.on('joinError', (data) => {
      UI.showError(data.message, 'menu');
    });

    socket.on('leftRoom', () => {
      playerId = null;
      roomCode = null;
      isHost = false;
      gameState = null;
      particles = [];
      UI.showScreen('menu');
      UI.hideEndScreen();
      UI.hideError('menu');
    });
  }

  function bindEvents() {
    document.getElementById('splash-start-btn').addEventListener('click', () => {
      UI.startMenu();
    });

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', () => {
      lastDirection = null;
      localInput = { up: false, down: false, left: false, right: false };
      emitInput();
    });

    const joystick = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    let pointerDown = false;

    function updateJoystick(clientX, clientY) {
      const rect = joystick.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const distance = Math.min(Math.hypot(dx, dy), rect.width * 0.45);
      const angle = Math.atan2(dy, dx);
      const offsetX = Math.cos(angle) * distance;
      const offsetY = Math.sin(angle) * distance;
      knob.style.left = `${50 + (offsetX / (rect.width * 0.45)) * 38}%`;
      knob.style.top = `${50 + (offsetY / (rect.width * 0.45)) * 38}%`;

      const absX = Math.abs(offsetX);
      const absY = Math.abs(offsetY);
      if (absX > absY) {
        setDirection(offsetX > 0 ? 'right' : 'left');
      } else if (absY > 0) {
        setDirection(offsetY > 0 ? 'down' : 'up');
      }
    }

    joystick.addEventListener('pointerdown', (event) => {
      pointerDown = true;
      joystick.setPointerCapture(event.pointerId);
      updateJoystick(event.clientX, event.clientY);
    });

    joystick.addEventListener('pointermove', (event) => {
      if (!pointerDown) return;
      updateJoystick(event.clientX, event.clientY);
    });

    joystick.addEventListener('pointerup', (event) => {
      pointerDown = false;
      try { joystick.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      knob.style.left = '50%';
      knob.style.top = '50%';
      emitInput();
    });

    joystick.addEventListener('pointercancel', (event) => {
      pointerDown = false;
      try { joystick.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      knob.style.left = '50%';
      knob.style.top = '50%';
      emitInput();
    });

    joystick.addEventListener('pointerleave', () => {
      pointerDown = false;
      knob.style.left = '50%';
      knob.style.top = '50%';
      emitInput();
    });

    const dpad = document.getElementById('dpad');
    if (dpad) {
      dpad.querySelectorAll('.dpad-btn').forEach((btn) => {
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const dir = btn.dataset.dir;
          btn.classList.add('pressed');
          setDirection(dir);
        });
        btn.addEventListener('pointerup', (e) => {
          e.preventDefault();
          btn.classList.remove('pressed');
        });
        btn.addEventListener('pointercancel', (e) => {
          e.preventDefault();
          btn.classList.remove('pressed');
        });
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const dir = btn.dataset.dir;
          setDirection(dir);
        });
      });
    }

    canvas.addEventListener('pointerdown', (e) => {
      if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        swipeStart = { x: e.clientX, y: e.clientY, time: Date.now() };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!swipeStart) return;
      const dx = e.clientX - swipeStart.x;
      const dy = e.clientY - swipeStart.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const threshold = 24;
      if (absX > threshold || absY > threshold) {
        if (absX > absY) {
          setDirection(dx > 0 ? 'right' : 'left');
        } else {
          setDirection(dy > 0 ? 'down' : 'up');
        }
        swipeStart = { x: e.clientX, y: e.clientY, time: Date.now() };
      }
    });
    canvas.addEventListener('pointerup', () => { swipeStart = null; });
    canvas.addEventListener('pointercancel', () => { swipeStart = null; });

    document.getElementById('create-room-btn').addEventListener('click', () => {
      const username = UI.getUsername();
      if (!username) {
        UI.showError('Please enter a username.', 'menu');
        return;
      }
      socket.emit('createRoom', { username });
    });

    document.getElementById('join-room-btn').addEventListener('click', () => {
      const username = UI.getUsername();
      const room = UI.getRoomCode();
      if (!username) {
        UI.showError('Please enter a username.', 'menu');
        return;
      }
      if (!room) {
        UI.showError('Enter a room code.', 'menu');
        return;
      }
      socket.emit('joinRoom', { username, roomCode: room });
    });

    document.getElementById('howto-btn').addEventListener('click', () => {
      document.getElementById('howto-modal').classList.remove('hidden');
    });

    document.getElementById('howto-close').addEventListener('click', () => {
      document.getElementById('howto-modal').classList.add('hidden');
    });

    document.getElementById('copy-code-btn').addEventListener('click', async () => {
      const code = document.getElementById('lobby-room-code').textContent.trim();
      if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(code);
          UI.showNotification('Room code copied');
        } catch (_) {
          UI.showNotification(code);
        }
      }
    });

    document.getElementById('start-game-btn').addEventListener('click', () => {
      socket.emit('startGame');
    });

    document.getElementById('leave-room-btn').addEventListener('click', () => {
      socket.emit('leaveRoom');
    });

    document.getElementById('match-duration-select').addEventListener('change', (event) => {
      if (socket && isHost) {
        socket.emit('setMatchDuration', { duration: Number(event.target.value) });
      }
    });

    document.getElementById('host-restart-btn').addEventListener('click', () => {
      socket.emit('startGame');
    });

    document.getElementById('host-lobby-btn').addEventListener('click', () => {
      socket.emit('backToLobby');
    });

    document.getElementById('results-close-btn').addEventListener('click', () => {
      UI.hideEndScreen();
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;

    resizeCanvas();
    bindEvents();
    connect();

    if (animationFrame) cancelAnimationFrame(animationFrame);
    if (inputTimerId) clearInterval(inputTimerId);

    inputTimerId = setInterval(() => { emitInput(); }, inputTickInterval);

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        resizeCanvas();
      }, 200);
    });
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      const cm = document.getElementById('controls-mobile');
      if (cm) cm.classList.remove('hidden');
      const j = document.getElementById('joystick');
      if (j) j.classList.remove('hidden');
    }
    window.addEventListener('beforeunload', () => {
      if (inputTimerId) clearInterval(inputTimerId);
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => Game.init());
