const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;
const ARENA_WIDTH = 2400;
const ARENA_HEIGHT = 1800;
const PLAYER_SPEED = 180;
const PLAYER_RADIUS = 16;
const MATCH_OPTIONS = [120, 300, 600, 900];
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PLAYER_COLORS = ['#00F5D4', '#FF006E', '#4CC9F0', '#FFBE0B', '#A36BFF', '#06FFA5'];
const TICK_RATE = 30;
const TICK_MS = 1000 / TICK_RATE;

const POWERUP_TYPES = {
  SPEED: { id: 'speed', name: 'Speed Boost', color: '#FFD166', duration: 5000, emoji: '⚡' },
  MAGNET: { id: 'magnet', name: 'Pellet Magnet', color: '#C084FC', duration: 8000, emoji: '🧲' },
  SHIELD: { id: 'shield', name: 'Invincibility', color: '#55F8FF', duration: 6000, emoji: '🛡️' }
};

// Movement settings
const CELL_SIZE = 12; // segment spacing
const MOVE_CELLS_PER_SEC = 8; // legacy, not used in smooth mode
const MOVE_INTERVAL = 1000 / MOVE_CELLS_PER_SEC; // legacy
const GRID_MODE = false; // disable discrete grid stepping; use smooth continuous server-side movement

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeUsername(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (name.length < 3 || name.length > 16) return null;
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) return null;
  return name;
}

function sanitizeRoomCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return null;
  return code;
}

function generateRoomCode() {
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i += 1) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomSpawn() {
  return {
    x: randomBetween(140, ARENA_WIDTH - 140),
    y: randomBetween(140, ARENA_HEIGHT - 140)
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function createCrystal(type) {
  const types = {
    small: { value: 1, color: '#67E8F9', radius: 9 },
    blue: { value: 3, color: '#60A5FA', radius: 11 },
    rare: { value: 5, color: '#C084FC', radius: 14 },
    gold: { value: 10, color: '#FBBF24', radius: 17 }
  };
  const crystalType = type || ['small', 'blue', 'rare', 'gold'][Math.floor(Math.random() * 4)];
  const spawn = randomSpawn();
  const data = types[crystalType];
  return {
    id: `crystal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: crystalType,
    x: spawn.x,
    y: spawn.y,
    value: data.value,
    radius: data.radius,
    color: data.color
  };
}

function createCrystalField(count = 18) {
  return Array.from({ length: count }, (_, index) => createCrystal(index % 5 === 0 ? 'gold' : null));
}

function createEnergyDrop(value, x, y) {
  const count = Math.max(4, Math.min(12, Math.ceil(value / 4)));
  const fragments = [];
  for (let i = 0; i < count; i += 1) {
    fragments.push({
      id: `drop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`,
      x: x + (Math.random() - 0.5) * 32,
      y: y + (Math.random() - 0.5) * 32,
      value: Math.max(1, Math.round(value / count)),
      radius: 5 + Math.random() * 4
    });
  }
  return fragments;
}

function createPowerUp() {
  const types = Object.values(POWERUP_TYPES);
  const type = types[Math.floor(Math.random() * types.length)];
  const spawn = randomSpawn();
  return {
    id: `powerup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: type.id,
    name: type.name,
    color: type.color,
    emoji: type.emoji,
    duration: type.duration,
    x: spawn.x,
    y: spawn.y,
    radius: 18,
    spawnedAt: Date.now()
  };
}

function buildSegments(headX, headY, length) {
  const segments = [];
  for (let i = 0; i < length; i += 1) {
    segments.push({ x: headX - i * 12, y: headY });
  }
  return segments;
}

class GameRoom {
  constructor(code, hostId) {
    this.code = code;
    this.hostId = hostId;
    this.players = new Map();
    this.phase = 'lobby';
    this.matchDuration = 300;
    this.timeLeft = this.matchDuration;
    this.countdown = 3;
    this.crystals = createCrystalField();
    this.droppedEnergy = [];
    this.powerUps = [];
    this.nextPowerUpAt = 0;
    this.finalResults = null;
    this.lastTick = Date.now();
    this.roundNumber = 0;
  }

  findSafeSpawn(excludeRadius = 120) {
    const players = Array.from(this.players.values());
    let attempts = 0;
    let spawn;
    while (attempts < 50) {
      spawn = randomSpawn();
      let safe = true;
      for (const p of players) {
        if (!p.alive) continue;
        if (dist(spawn, p) < excludeRadius) {
          safe = false;
          break;
        }
      }
      if (safe) break;
      attempts += 1;
    }
    return spawn || randomSpawn();
  }

  addPlayer(id, username) {
    if (this.players.size >= MAX_PLAYERS) return false;
    const usedColors = new Set(Array.from(this.players.values()).map((player) => player.color));
    const color = PLAYER_COLORS.find((entry) => !usedColors.has(entry)) || PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
    const spawn = this.findSafeSpawn(160);
    const player = {
      id,
      username,
      color,
      x: spawn.x,
      y: spawn.y,
      dirX: 1,
      dirY: 0,
      alive: true,
      input: { up: false, down: false, left: false, right: false },
      segments: buildSegments(spawn.x, spawn.y, 5),
      score: 0,
      totalScore: 0,
      crystalsCollected: 0,
      eliminations: 0,
      deaths: 0,
      longestSnake: 5,
      combo: 1,
      comboTimeout: 0,
      respawnAt: 0,
      shieldUntil: 0,
      speedUntil: 0,
      magnetUntil: 0,
      activePowerUps: [],
      lastDeathReason: null,
      spawnAnimUntil: 0,
      moveAccumulator: 0
    };
    this.players.set(id, player);
    return true;
  }

  removePlayer(id) {
    const player = this.players.get(id);
    this.players.delete(id);
    if (id === this.hostId && this.players.size > 0) {
      this.hostId = Array.from(this.players.keys())[0];
    }
    if (player && player.score > 0 && this.phase !== 'lobby') {
      this.droppedEnergy.push(...createEnergyDrop(player.score, player.x, player.y));
    }
    return player;
  }

  getLobbyState() {
    return {
      roomCode: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: Array.from(this.players.values()).map((player) => ({
        id: player.id,
        username: player.username,
        color: player.color,
        isHost: player.id === this.hostId,
        alive: player.alive
      })),
      playerCount: this.players.size,
      maxPlayers: MAX_PLAYERS,
      matchDuration: this.matchDuration
    };
  }

  getState() {
    return {
      roomCode: this.code,
      phase: this.phase,
      hostId: this.hostId,
      timeLeft: Math.max(0, Math.ceil(this.timeLeft)),
      countdown: this.countdown > 0 ? Math.ceil(this.countdown) : 0,
      matchDuration: this.matchDuration,
      arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
      players: Array.from(this.players.values()).map((player) => ({
        id: player.id,
        username: player.username,
        color: player.color,
        x: player.x,
        y: player.y,
        segments: player.segments,
        alive: player.alive,
        score: player.score,
        totalScore: player.totalScore,
        crystalsCollected: player.crystalsCollected,
        eliminations: player.eliminations,
        deaths: player.deaths,
        longestSnake: player.longestSnake,
        combo: player.combo,
        shieldUntil: player.shieldUntil,
        speedUntil: player.speedUntil,
        magnetUntil: player.magnetUntil,
        activePowerUps: player.activePowerUps,
        spawnAnimUntil: player.spawnAnimUntil,
        lastDeathReason: player.lastDeathReason,
        isHost: player.id === this.hostId
      })),
      crystals: this.crystals,
      droppedEnergy: this.droppedEnergy,
      powerUps: this.powerUps,
      playerCount: this.players.size,
      maxPlayers: MAX_PLAYERS,
      finalResults: this.finalResults,
      roundNumber: this.roundNumber
    };
  }

  setMatchDuration(seconds) {
    if (!MATCH_OPTIONS.includes(seconds)) return;
    this.matchDuration = seconds;
    this.timeLeft = seconds;
  }

  resetPlayerForMatch(player) {
    const spawn = this.findSafeSpawn(180);
    player.x = spawn.x;
    player.y = spawn.y;
    player.dirX = 1;
    player.dirY = 0;
    player.input = { up: false, down: false, left: false, right: false };
    player.segments = buildSegments(spawn.x, spawn.y, 5);
    player.score = 0;
    player.totalScore = 0;
    player.alive = true;
    player.crystalsCollected = 0;
    player.eliminations = 0;
    player.deaths = 0;
    player.longestSnake = 5;
    player.combo = 1;
    player.comboTimeout = 0;
    player.shieldUntil = Date.now() + 2000;
    player.speedUntil = 0;
    player.magnetUntil = 0;
    player.activePowerUps = [];
    player.spawnAnimUntil = Date.now() + 1200;
    player.respawnAt = 0;
    player.lastDeathReason = null;
    player.moveAccumulator = 0;
  }

  startMatch() {
    if (this.players.size < 2) return false;
    this.phase = 'countdown';
    this.countdown = 3;
    this.timeLeft = this.matchDuration;
    this.roundNumber += 1;
    this.finalResults = null;
    this.crystals = createCrystalField();
    this.droppedEnergy = [];
    this.powerUps = [];
    this.nextPowerUpAt = Date.now() + 8000;
    this.players.forEach((player) => this.resetPlayerForMatch(player));
    return true;
  }

  returnToLobby() {
    this.phase = 'lobby';
    this.countdown = 3;
    this.timeLeft = this.matchDuration;
    this.finalResults = null;
    this.crystals = createCrystalField();
    this.droppedEnergy = [];
    this.powerUps = [];
    this.nextPowerUpAt = 0;
    this.players.forEach((player) => {
      const spawn = this.findSafeSpawn(160);
      player.x = spawn.x;
      player.y = spawn.y;
      player.input = { up: false, down: false, left: false, right: false };
      player.segments = buildSegments(spawn.x, spawn.y, 5);
      player.score = 0;
      player.totalScore = 0;
      player.alive = true;
      player.combo = 1;
      player.comboTimeout = 0;
      player.shieldUntil = 0;
      player.speedUntil = 0;
      player.magnetUntil = 0;
      player.activePowerUps = [];
      player.spawnAnimUntil = 0;
      player.respawnAt = 0;
      player.lastDeathReason = null;
      player.moveAccumulator = 0;
    });
  }

  updateMovement(player, dt) {
    if (!player.alive || this.phase !== 'playing') return;

    const horizontal = (player.input.right ? 1 : 0) - (player.input.left ? 1 : 0);
    const vertical = (player.input.down ? 1 : 0) - (player.input.up ? 1 : 0);
    if (horizontal !== 0 || vertical !== 0) {
      if (Math.abs(horizontal) > Math.abs(vertical)) {
        player.dirX = horizontal > 0 ? 1 : -1;
        player.dirY = 0;
      } else {
        player.dirY = vertical > 0 ? 1 : -1;
        player.dirX = 0;
      }
    }

    const now = Date.now();
    const hasSpeed = player.speedUntil > now;
    const speedMult = hasSpeed ? 1.65 : 1;
    const effectiveSpeed = PLAYER_SPEED * speedMult;

    const nextX = player.x + (player.dirX || 0) * effectiveSpeed * dt;
    const nextY = player.y + (player.dirY || 0) * effectiveSpeed * dt;
    player.x = clamp(nextX, PLAYER_RADIUS + 10, ARENA_WIDTH - PLAYER_RADIUS - 10);
    player.y = clamp(nextY, PLAYER_RADIUS + 10, ARENA_HEIGHT - PLAYER_RADIUS - 10);

    // update segments smoothly so snake moves continuously without teleporting
    const spacing = CELL_SIZE; // desired spacing between segments
    const segments = player.segments;
    if (!segments || segments.length === 0) {
      player.segments = [{ x: player.x, y: player.y }];
      return;
    }

    // update head position
    segments[0] = { x: player.x, y: player.y };

    // For each following segment, move it toward previous segment to maintain spacing
    for (let i = 1; i < segments.length; i += 1) {
      const prev = segments[i - 1];
      const cur = segments[i];
      const dx = prev.x - cur.x;
      const dy = prev.y - cur.y;
      const dist = Math.hypot(dx, dy) || 0.00001;
      if (dist > spacing) {
        // place current segment at distance = spacing from prev along the line
        const ux = dx / dist;
        const uy = dy / dist;
        segments[i] = { x: prev.x - ux * spacing, y: prev.y - uy * spacing };
      } else {
        // small drift: keep current position
        segments[i] = { x: cur.x, y: cur.y };
      }
    }

    // ensure segments length matches player's length (based on totalScore)
    const desiredLen = Math.max(5, player.totalScore ? Math.min(22, 5 + Math.floor(player.totalScore / 8)) : 5);
    if (segments.length > desiredLen) {
      segments.splice(desiredLen, segments.length - desiredLen);
    } else if (segments.length < desiredLen) {
      // append copies of last segment to grow
      const last = segments[segments.length - 1] || { x: player.x, y: player.y };
      while (segments.length < desiredLen) segments.push({ x: last.x, y: last.y });
    }

    player.segments = segments;
  }

  collectCrystals(player) {
    const now = Date.now();
    const hasMagnet = player.magnetUntil > now;
    const magnetRadius = hasMagnet ? 180 : 0;
    for (let i = this.crystals.length - 1; i >= 0; i -= 1) {
      const crystal = this.crystals[i];
      const pickupDist = crystal.radius + PLAYER_RADIUS + 8;
      const d = dist(player, crystal);
      if (hasMagnet && d < magnetRadius && d >= pickupDist) {
        const dx = player.x - crystal.x;
        const dy = player.y - crystal.y;
        const len = Math.hypot(dx, dy) || 1;
        crystal.x += (dx / len) * 8;
        crystal.y += (dy / len) * 8;
      }
      if (d < pickupDist) {
        player.score += crystal.value;
        player.totalScore += crystal.value;
        player.crystalsCollected += 1;
        player.combo = Math.min(8, player.combo + 1);
        player.comboTimeout = 2.5;
        this.crystals.splice(i, 1);
        this.crystals.push(createCrystal(crystal.type));
      }
    }
  }

  collectDroppedEnergy(player) {
    const now = Date.now();
    const hasMagnet = player.magnetUntil > now;
    const magnetRadius = hasMagnet ? 180 : 0;
    for (let i = this.droppedEnergy.length - 1; i >= 0; i -= 1) {
      const fragment = this.droppedEnergy[i];
      const pickupDist = fragment.radius + PLAYER_RADIUS + 8;
      const d = dist(player, fragment);
      if (hasMagnet && d < magnetRadius && d >= pickupDist) {
        const dx = player.x - fragment.x;
        const dy = player.y - fragment.y;
        const len = Math.hypot(dx, dy) || 1;
        fragment.x += (dx / len) * 10;
        fragment.y += (dy / len) * 10;
      }
      if (d < pickupDist) {
        player.score += fragment.value;
        player.totalScore += fragment.value;
        this.droppedEnergy.splice(i, 1);
      }
    }
  }

  applyPowerUp(player, powerUp) {
    const now = Date.now();
    if (powerUp.type === 'speed') {
      player.speedUntil = Math.max(player.speedUntil, now + powerUp.duration);
    } else if (powerUp.type === 'magnet') {
      player.magnetUntil = Math.max(player.magnetUntil, now + powerUp.duration);
    } else if (powerUp.type === 'shield') {
      player.shieldUntil = Math.max(player.shieldUntil, now + powerUp.duration);
    }
    player.activePowerUps = player.activePowerUps.filter((p) => p.type !== powerUp.type);
    player.activePowerUps.push({
      type: powerUp.type,
      name: powerUp.name,
      color: powerUp.color,
      emoji: powerUp.emoji,
      until: now + powerUp.duration
    });
  }

  collectPowerUps(player) {
    for (let i = this.powerUps.length - 1; i >= 0; i -= 1) {
      const pu = this.powerUps[i];
      if (dist(player, pu) < pu.radius + PLAYER_RADIUS + 6) {
        this.applyPowerUp(player, pu);
        this.powerUps.splice(i, 1);
      }
    }
  }

  respawnPlayer(player) {
    const spawn = this.findSafeSpawn(200);
    player.x = spawn.x;
    player.y = spawn.y;
    player.dirX = 1;
    player.dirY = 0;
    player.input = { up: false, down: false, left: false, right: false };
    player.segments = buildSegments(spawn.x, spawn.y, 5);
    player.score = 0;
    player.totalScore = 0;
    player.crystalsCollected = 0;
    player.combo = 1;
    player.comboTimeout = 0;
    player.longestSnake = 5;
    player.alive = true;
    player.shieldUntil = Date.now() + 3000;
    player.speedUntil = 0;
    player.magnetUntil = 0;
    player.activePowerUps = [];
    player.spawnAnimUntil = Date.now() + 1500;
    player.respawnAt = 0;
    player.lastDeathReason = null;
    player.moveAccumulator = 0;
  }

  killPlayer(player, reason) {
    if (!player.alive) return;
    player.alive = false;
    player.deaths += 1;
    player.lastDeathReason = reason;
    const dropValue = Math.max(4, Math.floor(player.totalScore || player.score || 0));
    if (dropValue > 0) {
      this.droppedEnergy.push(...createEnergyDrop(dropValue, player.x, player.y));
    }
    player.score = 0;
    player.totalScore = 0;
    player.combo = 1;
    player.comboTimeout = 0;
    player.longestSnake = 5;
    player.speedUntil = 0;
    player.magnetUntil = 0;
    player.activePowerUps = [];
    player.segments = [];
    player.respawnAt = Date.now() + 2000;
  }

  resolveCollisions() {
    const now = Date.now();
    const players = Array.from(this.players.values());
    for (let i = 0; i < players.length; i += 1) {
      const first = players[i];
      if (!first.alive) continue;
      for (let j = i + 1; j < players.length; j += 1) {
        const second = players[j];
        if (!second.alive) continue;
        const headDistance = dist(first, second);
        if (headDistance < PLAYER_RADIUS * 2.1) {
          const firstShield = first.shieldUntil > now;
          const secondShield = second.shieldUntil > now;
          if (!firstShield) this.killPlayer(first, 'HEAD COLLISION');
          if (!secondShield) this.killPlayer(second, 'HEAD COLLISION');
        }
      }
    }

    for (const player of players) {
      if (!player.alive) continue;
      if (player.shieldUntil > now) continue;
      for (const other of players) {
        if (other.id === player.id || !other.alive) continue;
        for (const segment of other.segments) {
          if (dist(player, segment) < PLAYER_RADIUS + 5) {
            this.killPlayer(player, 'BODY HIT');
            other.eliminations += 1;
            break;
          }
        }
      }
    }

    for (const player of players) {
      if (!player.alive) continue;
      if (player.shieldUntil > now) continue;
      for (let i = 2; i < player.segments.length; i += 1) {
        const segment = player.segments[i];
        if (dist(player, segment) < PLAYER_RADIUS + 4) {
          this.killPlayer(player, 'SELF COLLISION');
          break;
        }
      }
    }

    for (const player of players) {
      if (!player.alive) continue;
      if (player.shieldUntil > now) continue;
      const hitWall = player.x <= 18 || player.x >= ARENA_WIDTH - 18 || player.y <= 18 || player.y >= ARENA_HEIGHT - 18;
      if (hitWall) {
        this.killPlayer(player, 'WALL HIT');
      }
    }
  }

  tick() {
    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.08);
    this.lastTick = now;

    if (this.phase === 'lobby') return;

    if (this.phase === 'countdown') {
      this.countdown = Math.max(0, this.countdown - dt);
      if (this.countdown <= 0) {
        this.phase = 'playing';
      }
      return;
    }

    if (this.phase === 'playing') {
      this.timeLeft = Math.max(0, this.timeLeft - dt);

      if (now >= this.nextPowerUpAt && this.powerUps.length < 3) {
        this.powerUps.push(createPowerUp());
        this.nextPowerUpAt = now + 10000 + Math.random() * 8000;
      }

      this.powerUps = this.powerUps.filter((pu) => now - pu.spawnedAt < 30000);

      for (const player of this.players.values()) {
        if (player.activePowerUps && player.activePowerUps.length > 0) {
          player.activePowerUps = player.activePowerUps.filter((p) => p.until > now);
        }
        if (player.alive) {
          player.comboTimeout = Math.max(0, player.comboTimeout - dt);
          if (player.comboTimeout <= 0) player.combo = 1;
          this.updateMovement(player, dt);
          this.collectCrystals(player);
          this.collectDroppedEnergy(player);
          this.collectPowerUps(player);
          if (player.totalScore > player.longestSnake * 8) {
            player.longestSnake = Math.max(player.longestSnake, Math.min(24, 5 + Math.floor(player.totalScore / 5)));
          }
        } else if (player.respawnAt && now >= player.respawnAt) {
          this.respawnPlayer(player);
        }
      }

      this.resolveCollisions();

      if (this.timeLeft <= 0) {
        this.phase = 'ended';
        this.timeLeft = 0;
        this.finalResults = Array.from(this.players.values())
          .sort((a, b) => b.totalScore - a.totalScore)
          .map((player, index) => ({
            rank: index + 1,
            id: player.id,
            username: player.username,
            color: player.color,
            score: player.totalScore,
            crystalsCollected: player.crystalsCollected,
            eliminations: player.eliminations,
            deaths: player.deaths,
            longestSnake: player.longestSnake,
            combo: player.combo
          }));
      }
    }
  }

  isEmpty() {
    return this.players.size === 0;
  }
}

function getRoomFromSocket(socket) {
  return socket.roomCode ? rooms.get(socket.roomCode) : null;
}

function emitLobby(room) {
  io.to(room.code).emit('lobbyUpdate', room.getLobbyState());
}

function emitGameState(room) {
  io.to(room.code).emit('gameState', room.getState());
}

function leaveRoom(socket) {
  const room = getRoomFromSocket(socket);
  if (!room) return null;
  const player = room.players.get(socket.id);
  const username = player ? player.username : 'Player';
  room.removePlayer(socket.id);
  socket.leave(room.code);
  socket.roomCode = null;

  if (room.isEmpty()) {
    rooms.delete(room.code);
    return room;
  }

  if (room.phase === 'lobby') {
    emitLobby(room);
  } else {
    emitGameState(room);
  }

  io.to(room.code).emit('playerLeft', {
    username,
    message: `${username} left the room.`
  });
  return room;
}

setInterval(() => {
  rooms.forEach((room) => {
    if (room.phase === 'countdown' || room.phase === 'playing') {
      room.tick();
      emitGameState(room);
    }
  });
}, TICK_MS);

io.on('connection', (socket) => {
  socket.on('createRoom', (payload) => {
    const username = sanitizeUsername(payload?.username);
    if (!username) {
      socket.emit('joinError', { message: 'Invalid username. Use 3-16 letters, numbers, spaces, underscores, or dashes.' });
      return;
    }

    const roomCode = generateRoomCode();
    const room = new GameRoom(roomCode, socket.id);
    room.addPlayer(socket.id, username);
    rooms.set(roomCode, room);
    socket.roomCode = roomCode;
    socket.join(roomCode);

    socket.emit('roomCreated', {
      roomCode,
      playerId: socket.id,
      isHost: true,
      lobby: room.getLobbyState()
    });
  });

  socket.on('joinRoom', (payload) => {
    const username = sanitizeUsername(payload?.username);
    const roomCode = sanitizeRoomCode(payload?.roomCode);

    if (!username) {
      socket.emit('joinError', { message: 'Invalid username. Use 3-16 letters, numbers, spaces, underscores, or dashes.' });
      return;
    }

    if (!roomCode) {
      socket.emit('joinError', { message: 'Invalid room code. Use a 6-character code.' });
      return;
    }

    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('joinError', { message: 'ROOM NOT FOUND' });
      return;
    }

    if (room.phase !== 'lobby') {
      socket.emit('joinError', { message: 'MATCH ALREADY STARTED' });
      return;
    }

    if (room.players.size >= MAX_PLAYERS) {
      socket.emit('joinError', { message: 'ROOM FULL' });
      return;
    }

    const added = room.addPlayer(socket.id, username);
    if (!added) {
      socket.emit('joinError', { message: 'Unable to join room.' });
      return;
    }

    socket.roomCode = roomCode;
    socket.join(roomCode);

    socket.emit('roomJoined', {
      roomCode,
      playerId: socket.id,
      isHost: socket.id === room.hostId,
      lobby: room.getLobbyState()
    });

    io.to(roomCode).emit('playerJoined', {
      username,
      message: `${username} joined the room.`
    });
    emitLobby(room);
  });

  socket.on('setMatchDuration', (payload) => {
    const room = getRoomFromSocket(socket);
    if (!room) return;
    if (socket.id !== room.hostId) {
      socket.emit('joinError', { message: 'Only the host can change the match duration.' });
      return;
    }
    const duration = Number(payload?.duration);
    if (!MATCH_OPTIONS.includes(duration)) return;
    room.setMatchDuration(duration);
    emitLobby(room);
  });

  socket.on('startGame', () => {
    const room = getRoomFromSocket(socket);
    if (!room) return;
    if (socket.id !== room.hostId) {
      socket.emit('joinError', { message: 'Only the host can start the match.' });
      return;
    }
    if (room.players.size < 2) {
      socket.emit('joinError', { message: 'At least 2 players are required to start.' });
      return;
    }
    if (room.phase !== 'lobby' && room.phase !== 'ended') return;
    room.startMatch();
    io.to(room.code).emit('gameStarted', { message: 'Game starting!' });
    emitGameState(room);
  });

  socket.on('backToLobby', () => {
    const room = getRoomFromSocket(socket);
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.phase !== 'ended') return;
    room.returnToLobby();
    emitLobby(room);
  });

  socket.on('playerInput', (input) => {
    const room = getRoomFromSocket(socket);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    if (room.phase !== 'countdown' && room.phase !== 'playing') return;

    // Prefer a single-direction 'dir' string when provided (client sends this for clarity)
    const dir = typeof input?.dir === 'string' ? input.dir : null;

    if (dir) {
      // map dir to booleans
      const desired = { up: false, down: false, left: false, right: false };
      if (dir === 'up') desired.up = true;
      else if (dir === 'down') desired.down = true;
      else if (dir === 'left') desired.left = true;
      else if (dir === 'right') desired.right = true;

      // determine current discrete direction from dirX/dirY
      let current = null;
      if (Math.abs(player.dirX) > Math.abs(player.dirY)) {
        current = player.dirX > 0 ? 'right' : 'left';
      } else if (Math.abs(player.dirY) > 0) {
        current = player.dirY > 0 ? 'down' : 'up';
      }

      // prevent direct reversal
      const isOpposite = (a, b) => {
        if (!a || !b) return false;
        return (a === 'up' && b === 'down') || (a === 'down' && b === 'up') || (a === 'left' && b === 'right') || (a === 'right' && b === 'left');
      };

      if (isOpposite(current, dir)) {
        // ignore reversal attempts
        return;
      }

      player.input = desired;
      return;
    }

    // fallback: allow legacy boolean inputs, but sanitize to only one direction if multiple provided
    const up = !!input?.up;
    const down = !!input?.down;
    const left = !!input?.left;
    const right = !!input?.right;

    // If multiple booleans are true, pick the most recent heuristic: prioritize horizontal over vertical if both, or keep existing direction.
    let final = { up: false, down: false, left: false, right: false };
    if (left && !right && !up && !down) final.left = true;
    else if (right && !left && !up && !down) final.right = true;
    else if (up && !down && !left && !right) final.up = true;
    else if (down && !up && !left && !right) final.down = true;
    else if (left && !right) final.left = true;
    else if (right && !left) final.right = true;
    else if (up && !down) final.up = true;
    else if (down && !up) final.down = true;
    else {
      // no clear input — ignore
    }

    // prevent reversal from current direction
    const current = Math.abs(player.dirX) > Math.abs(player.dirY)
      ? (player.dirX > 0 ? 'right' : 'left')
      : (player.dirY > 0 ? 'down' : 'up');

    const desiredDir = final.left ? 'left' : final.right ? 'right' : final.up ? 'up' : final.down ? 'down' : null;
    if (desiredDir && ((current === 'up' && desiredDir === 'down') || (current === 'down' && desiredDir === 'up') || (current === 'left' && desiredDir === 'right') || (current === 'right' && desiredDir === 'left'))) {
      // ignore reversal
      return;
    }

    player.input = final;
  });

  socket.on('leaveRoom', () => {
    leaveRoom(socket);
    socket.emit('leftRoom');
  });

  socket.on('disconnect', () => {
    const room = leaveRoom(socket);
    if (room && !room.isEmpty()) {
      io.to(room.code).emit('hostChanged', {
        hostId: room.hostId,
        message: 'New host assigned.'
      });
      emitLobby(room);
    }
  });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Another server may be running.\n` +
      `Stop the process using the port or change the PORT environment variable and try again.`);
    process.exit(1);
  }
  // rethrow other errors so they are visible
  throw err;
});

server.listen(PORT, () => {
  console.log(`MT SNAKE FIGHT ARENA server running at http://localhost:${PORT}`);
});
