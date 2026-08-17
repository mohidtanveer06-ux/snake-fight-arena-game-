const Game = (() => {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const minimap = document.getElementById('minimap');
  const miniCtx = minimap.getContext('2d');

  let playerId = null;
  let roomCode = null;
  let isHost = false;
  let gameState = null;
  // localInput kept for backward compatibility, but only one direction is active at a time
  let localInput = { up: false, down: false, left: false, right: false };
  // lastDirection: developer-intended current movement direction ('up','down','left','right')
  let lastDirection = null;
  // last direction that was sent to server (to prevent reversing into self)
  let lastSentDirection = null;
  // how often to send input updates to the server (ms)
  // reduced interval for tighter responsiveness
  const inputTickInterval = 40;
  let inputTimerId = null;
  let animationFrame = null;
  let camera = { x: 0, y: 0 };
  // initialization guard to avoid duplicate timers, sockets, and event bindings
  let initialized = false;
  // single socket instance
  let socket = null;

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function emitInput() {
    if (socket && socket.connected) {
      // Send both booleans (for backward compatibility) and a single 'dir' string
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
    // prevent reversing directly into yourself
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
    // If user is typing in an input/textarea/contentEditable, do not handle game keys
    if (isTextInputFocused()) return;

    const map = {
      KeyW: 'up', ArrowUp: 'up',
      KeyS: 'down', ArrowDown: 'down',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right'
    };
    const key = map[event.code];
    if (!key) return;
    // prevent default only when actually handling a game control
    event.preventDefault();
    setDirection(key);
  }

  function updateCamera() {
    const player = getLocalPlayer();
    if (!player || !gameState) return;
    const targetX = clamp(player.x - window.innerWidth / 2, 0, gameState.arena.width - window.innerWidth);
    const targetY = clamp(player.y - window.innerHeight / 2, 0, gameState.arena.height - window.innerHeight);
    camera.x += (targetX - camera.x) * 0.12;
    camera.y += (targetY - camera.y) * 0.12;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getLocalPlayer() {
    if (!gameState) return null;
    return gameState.players.find((player) => player.id === playerId) || null;
  }

  function drawBackground() {
    const width = gameState.arena.width;
    const height = gameState.arena.height;
    ctx.fillStyle = '#060a14';
    ctx.fillRect(-camera.x, -camera.y, width, height);

    ctx.strokeStyle = 'rgba(85, 248, 255, 0.08)';
    const grid = 50;
    for (let x = Math.floor(camera.x / grid) * grid; x < camera.x + window.innerWidth + grid; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x - camera.x, 0 - camera.y);
      ctx.lineTo(x - camera.x, height - camera.y);
      ctx.stroke();
    }
    for (let y = Math.floor(camera.y / grid) * grid; y < camera.y + window.innerHeight + grid; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0 - camera.x, y - camera.y);
      ctx.lineTo(width - camera.x, y - camera.y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 45, 149, 0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(-camera.x + 12, -camera.y + 12, width - 24, height - 24);
  }

  function drawCrystals() {
    if (!gameState) return;
    for (const crystal of gameState.crystals) {
      const x = crystal.x - camera.x;
      const y = crystal.y - camera.y;
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
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255, 209, 102, 0.9)';
      ctx.shadowColor = '#FFD166';
      ctx.shadowBlur = 14;
      ctx.arc(x, y, fragment.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawSnake(player, local) {
    if (!player.segments || !player.segments.length) return;

    const points = player.segments.map((segment) => ({ x: segment.x - camera.x, y: segment.y - camera.y }));
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      ctx.lineTo(point.x, point.y);
    }
    ctx.strokeStyle = player.color;
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = player.color;
    ctx.shadowBlur = local ? 25 : 15;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const headX = points[0].x;
    const headY = points[0].y;
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(headX, headY, 17, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    const eyeOffset = 6;
    const eyeX = player.dirX || 1;
    const eyeY = player.dirY || 0;
    const eyeLX = headX + eyeX * 5 + eyeY * -4;
    const eyeLY = headY + eyeY * 5 + eyeX * 4;
    const eyeRX = headX + eyeX * 5 + eyeY * 4;
    const eyeRY = headY + eyeY * 5 - eyeX * 4;
    ctx.beginPath();
    ctx.arc(eyeLX, eyeLY, 2.3, 0, Math.PI * 2);
    ctx.arc(eyeRX, eyeRY, 2.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e7f5ff';
    ctx.font = '600 12px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText(player.username, headX, headY - 20);

    if (player.shieldUntil > Date.now()) {
      ctx.strokeStyle = 'rgba(85, 248, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(headX, headY, 24, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawPlayers() {
    if (!gameState) return;
    for (const player of gameState.players) {
      drawSnake(player, player.id === playerId);
    }
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

    for (const player of gameState.players) {
      const px = player.x * scaleX;
      const py = player.y * scaleY;
      miniCtx.beginPath();
      miniCtx.fillStyle = player.id === playerId ? '#55F8FF' : player.color;
      miniCtx.arc(px, py, player.id === playerId ? 3.5 : 2.5, 0, Math.PI * 2);
      miniCtx.fill();
    }
  }

  function updateDirectionIndicatorFromState() {
    const el = document.getElementById('direction-indicator');
    if (!el) return;
    // prefer lastDirection (local), otherwise fall back to server state for this player
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

  function render() {
    if (!gameState) return;
    updateCamera();
    drawBackground();
    drawCrystals();
    drawDroppedEnergy();
    drawPlayers();
    drawMinimap();
    updateDirectionIndicatorFromState();
  }

  function loop() {
    render();
    animationFrame = requestAnimationFrame(loop);
  }

  function connect() {
    // avoid creating multiple socket instances
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
      UI.showNotification(data.message || 'Game starting');
      UI.hideEndScreen();
    });

    socket.on('gameState', (state) => {
      gameState = state;
      UI.updateHUD(state, playerId);
      // if server provides the player's current direction, use it to avoid illegal reversals
      try {
        const local = state.players && state.players.find((p) => p.id === playerId);
        if (local && (local.dirX !== undefined || local.dirY !== undefined)) {
          // convert dirX/dirY to discrete direction
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
      UI.showScreen('menu');
      UI.hideEndScreen();
      UI.hideError('menu');
    });
  }

  function applyLocalUserInput() {
    emitInput();
  }

  function bindEvents() {
    // keyboard: only act on keydown so movement persists after releasing the key (classic Snake behaviour)
    window.addEventListener('keydown', handleKeyDown);
    // when the page loses focus, clear input for safety
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

      // convert joystick direction to a discrete direction and persist it (tap or hold)
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
      // reset knob visually but keep the chosen direction (persistent)
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

    // D-pad buttons (mobile) — tap/pointer events set the persistent direction immediately
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
        // also listen for click to support older browsers
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const dir = btn.dataset.dir;
          setDirection(dir);
        });
      });
    }

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

    // clear any existing animation frame and timer to avoid duplicates
    if (animationFrame) cancelAnimationFrame(animationFrame);
    if (inputTimerId) clearInterval(inputTimerId);

    // send inputs at a steady interval for smooth continuous movement
    inputTimerId = setInterval(() => { emitInput(); }, inputTickInterval);

    window.addEventListener('resize', resizeCanvas);
    if (window.matchMedia('(orientation: portrait)').matches) {
      document.getElementById('portrait-warning').classList.remove('hidden');
    }
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      // show mobile controls container which includes D-pad and joystick
      const cm = document.getElementById('controls-mobile');
      if (cm) cm.classList.remove('hidden');
      const j = document.getElementById('joystick');
      if (j) j.classList.remove('hidden');
    }
    // ensure animation loop continues
    animationFrame = requestAnimationFrame(loop);

    // clear timer when unloading
    window.addEventListener('beforeunload', () => {
      if (inputTimerId) clearInterval(inputTimerId);
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => Game.init());
