/**
 * Shared game core.
 * Runs in Node (required by server.js) and in the browser (used by the offline
 * fallback engine), so both share exactly the same rules and state shape.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_PLAYERS = 6;
  const ARENA_WIDTH = 2400;
  const ARENA_HEIGHT = 1800;
  const PLAYER_SPEED = 180;
  const PLAYER_RADIUS = 16;
  const ARENA_PADDING = PLAYER_RADIUS + 10;
  const WALL_KILL_MARGIN = ARENA_PADDING + 1;
  const MATCH_OPTIONS = [120, 300, 600, 900];
  const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const PLAYER_COLORS = ['#00F5D4', '#FF006E', '#4CC9F0', '#FFBE0B', '#A36BFF', '#06FFA5'];
  const TICK_RATE = 30;
  const TICK_MS = 1000 / TICK_RATE;
  const DEFAULT_BOT_COUNT = 3;
  const MAX_BOT_COUNT = MAX_PLAYERS - 1;

  const POWERUP_TYPES = {
    SPEED: { id: 'speed', name: 'Speed Boost', color: '#FFD166', duration: 5000, emoji: '⚡' },
    MAGNET: { id: 'magnet', name: 'Pellet Magnet', color: '#C084FC', duration: 8000, emoji: '🧲' },
    SHIELD: { id: 'shield', name: 'Invincibility', color: '#55F8FF', duration: 6000, emoji: '🛡️' }
  };

  const CELL_SIZE = 12; // segment spacing

  const BOT_NAMES = ['Viper', 'Bolt', 'Shadow', 'Fang', 'Cobra', 'Rush'];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function sanitizeUsername(value) {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    if (name.length < 2 || name.length > 16) return null;
    if (!/^[A-Za-z0-9 _-]+$/.test(name)) return null;
    return name;
  }

  function sanitizeRoomCode(value) {
    if (typeof value !== 'string') return null;
    const code = value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return null;
    return code;
  }

  function generateRoomCode(rooms) {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 6; i += 1) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
      }
    } while (rooms && rooms.has(code));
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

  function uniqueId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function createCrystal(type) {
    const types = {
      small: { value: 1, color: '#67E8F9', radius: 9 },
      blue: { value: 3, color: '#60A5FA', radius: 11 },
      rare: { value: 5, color: '#C084FC', radius: 14 },
      gold: { value: 10, color: '#FBBF24', radius: 17 },
      mega: { value: 25, color: '#FFF7AE', radius: 24, mega: true }
    };
    const crystalType = type || ['small', 'small', 'small', 'blue', 'blue', 'rare', 'gold'][Math.floor(Math.random() * 7)];
    const spawn = randomSpawn();
    const data = types[crystalType];
    return {
      id: uniqueId('crystal'),
      type: crystalType,
      x: spawn.x,
      y: spawn.y,
      value: data.value,
      radius: data.radius,
      color: data.color,
      mega: data.mega || false
    };
  }

  function createCrystalField(count = 18) {
    const field = [];
    for (let i = 0; i < count; i += 1) {
      field.push(createCrystal(i % 17 === 0 ? 'mega' : i % 5 === 0 ? 'gold' : null));
    }
    return field;
  }

  function createEnergyDrop(value, x, y) {
    const count = Math.max(4, Math.min(12, Math.ceil(value / 4)));
    const fragments = [];
    for (let i = 0; i < count; i += 1) {
      fragments.push({
        id: `${uniqueId('drop')}-${i}`,
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
      id: uniqueId('powerup'),
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
      segments.push({ x: headX - i * CELL_SIZE, y: headY });
    }
    return segments;
  }

  function createPlayer(id, username, color, spawn, isBot) {
    return {
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
      ghostUntil: 0,
      doubleUntil: 0,
      activePowerUps: [],
      lastDeathReason: null,
      spawnAnimUntil: 0,
      killCombo: 0,
      lastKillAt: 0,
      isBot: !!isBot,
      botNextDirAt: 0,
      botDir: 'right',
      moveAccumulator: 0
    };
  }

  const DIRECTIONS = ['up', 'down', 'left', 'right'];

  function isValidDirection(dir) {
    return DIRECTIONS.indexOf(dir) !== -1;
  }

  function isOppositeDirection(a, b) {
    if (!a || !b) return false;
    return (a === 'up' && b === 'down') || (a === 'down' && b === 'up')
      || (a === 'left' && b === 'right') || (a === 'right' && b === 'left');
  }

  function getPlayerDirection(player) {
    if (Math.abs(player.dirX) > Math.abs(player.dirY)) return player.dirX > 0 ? 'right' : 'left';
    if (player.dirY !== 0) return player.dirY > 0 ? 'down' : 'up';
    return player.dirX >= 0 ? 'right' : 'left';
  }

  /**
   * Validates and stores a player's requested direction.
   * Shared by the Socket.IO server and the offline engine so both behave the same.
   */
  function applyPlayerInput(room, playerId, input) {
    if (!room) return false;
    const player = room.players.get(playerId);
    if (!player) return false;
    if (room.phase !== 'countdown' && room.phase !== 'playing') return false;

    const current = getPlayerDirection(player);
    const dir = input && typeof input.dir === 'string' ? input.dir : null;

    let desired = dir;
    if (!desired && input) {
      if (input.left && !input.right) desired = 'left';
      else if (input.right && !input.left) desired = 'right';
      else if (input.up && !input.down) desired = 'up';
      else if (input.down && !input.up) desired = 'down';
    }

    if (!desired || !isValidDirection(desired) || isOppositeDirection(current, desired)) return false;

    player.input = { up: false, down: false, left: false, right: false };
    player.input[desired] = true;
    return true;
  }

  const KILL_STREAK_WINDOW = 5000;
  const STREAK_LABELS = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'RAMPAGE', 5: 'UNSTOPPABLE' };

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
      this.botCount = DEFAULT_BOT_COUNT;
      this.killFeed = [];
    }

    findSafeSpawn(excludeRadius = 120) {
      const players = Array.from(this.players.values());
      let attempts = 0;
      let spawn = null;
      while (attempts < 50) {
        spawn = randomSpawn();
        const safe = players.every((p) => !p.alive || dist(spawn, p) >= excludeRadius);
        if (safe) break;
        attempts += 1;
      }
      return spawn || randomSpawn();
    }

    pickColor() {
      const usedColors = new Set(Array.from(this.players.values()).map((player) => player.color));
      return PLAYER_COLORS.find((entry) => !usedColors.has(entry))
        || PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
    }

    addPlayer(id, username) {
      if (this.players.size >= MAX_PLAYERS) return false;
      const spawn = this.findSafeSpawn(160);
      this.players.set(id, createPlayer(id, username, this.pickColor(), spawn, false));
      return true;
    }

    addBotPlayer() {
      if (this.players.size >= MAX_PLAYERS) return false;
      const usedNames = new Set(Array.from(this.players.values()).map((p) => p.username));
      const name = BOT_NAMES.find((n) => !usedNames.has(n)) || `Bot${Math.floor(Math.random() * 999)}`;
      const spawn = this.findSafeSpawn(180);
      const id = uniqueId('bot');
      const bot = createPlayer(id, name, this.pickColor(), spawn, true);
      bot.botNextDirAt = Date.now() + 400;
      this.players.set(id, bot);
      return true;
    }

    removeBots() {
      for (const [id, player] of this.players) {
        if (player.isBot) this.players.delete(id);
      }
    }

    hasHumans() {
      return Array.from(this.players.values()).some((player) => !player.isBot);
    }

    updateBotAI(player) {
      if (!player.isBot || !player.alive) return;
      const now = Date.now();
      if (now < player.botNextDirAt) return;
      const dirs = ['up', 'down', 'left', 'right'];
      const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' };
      const current = player.botDir;

      let targetDir = current;
      let bestScore = -Infinity;
      for (const dir of dirs) {
        if (dir === opposite[current]) continue;
        const vec = dir === 'up' ? [0, -1] : dir === 'down' ? [0, 1] : dir === 'left' ? [-1, 0] : [1, 0];
        const fx = player.x + vec[0] * 140;
        const fy = player.y + vec[1] * 140;
        if (fx < 80 || fx > ARENA_WIDTH - 80 || fy < 80 || fy > ARENA_HEIGHT - 80) continue;
        let s = Math.random() * 0.4;
        const closestCrystal = this.crystals.reduce((acc, c) => {
          const d = Math.hypot(fx - c.x, fy - c.y);
          return d < acc.d ? { d, c } : acc;
        }, { d: Infinity, c: null });
        if (closestCrystal.c) {
          const reward = closestCrystal.c.value * 10;
          s += reward / (1 + Math.hypot(fx - closestCrystal.c.x, fy - closestCrystal.c.y));
        }
        for (const other of this.players.values()) {
          if (other.id === player.id || !other.alive) continue;
          const d = Math.hypot(fx - other.x, fy - other.y);
          if (d < 110) s -= (110 - d) * 2;
          for (const segment of other.segments) {
            if (Math.hypot(fx - segment.x, fy - segment.y) < 60) s -= 400;
          }
        }
        if (s > bestScore) { bestScore = s; targetDir = dir; }
      }

      const vec = targetDir === 'up' ? [0, -1] : targetDir === 'down' ? [0, 1] : targetDir === 'left' ? [-1, 0] : [1, 0];
      player.input = { up: false, down: false, left: false, right: false };
      if (vec[0] === 1) player.input.right = true;
      else if (vec[0] === -1) player.input.left = true;
      else if (vec[1] === 1) player.input.down = true;
      else if (vec[1] === -1) player.input.up = true;
      player.botDir = targetDir;
      player.botNextDirAt = now + 250 + Math.random() * 450;
    }

    removePlayer(id) {
      const player = this.players.get(id);
      this.players.delete(id);
      if (id === this.hostId) {
        const nextHost = Array.from(this.players.values()).find((entry) => !entry.isBot);
        this.hostId = nextHost ? nextHost.id : null;
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
          isBot: player.isBot,
          alive: player.alive
        })),
        playerCount: this.players.size,
        maxPlayers: MAX_PLAYERS,
        matchDuration: this.matchDuration,
        botCount: this.botCount,
        maxBots: MAX_BOT_COUNT
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
          dirX: player.dirX,
          dirY: player.dirY,
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
          ghostUntil: player.ghostUntil,
          doubleUntil: player.doubleUntil,
          activePowerUps: player.activePowerUps,
          spawnAnimUntil: player.spawnAnimUntil,
          lastDeathReason: player.lastDeathReason,
          killCombo: player.killCombo,
          isBot: player.isBot,
          isHost: player.id === this.hostId
        })),
        crystals: this.crystals,
        droppedEnergy: this.droppedEnergy,
        powerUps: this.powerUps,
        playerCount: this.players.size,
        maxPlayers: MAX_PLAYERS,
        finalResults: this.finalResults,
        killFeed: this.killFeed.slice(-5),
        roundNumber: this.roundNumber
      };
    }

    setMatchDuration(seconds) {
      if (!MATCH_OPTIONS.includes(seconds)) return;
      this.matchDuration = seconds;
      this.timeLeft = seconds;
    }

    setBotCount(count) {
      const value = Number(count);
      if (!Number.isInteger(value) || value < 0 || value > MAX_BOT_COUNT) return false;
      this.botCount = value;
      return true;
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
      player.ghostUntil = 0;
      player.doubleUntil = 0;
      player.activePowerUps = [];
      player.spawnAnimUntil = Date.now() + 1200;
      player.respawnAt = 0;
      player.lastDeathReason = null;
      player.killCombo = 0;
      player.lastKillAt = 0;
      if (player.isBot) {
        player.botNextDirAt = Date.now() + 500;
        player.botDir = 'right';
      }
      player.moveAccumulator = 0;
    }

    startMatch() {
      if (this.players.size < 1) return false;
      this.removeBots();
      const target = Math.min(MAX_PLAYERS, this.players.size + this.botCount);
      while (this.players.size < target) {
        if (!this.addBotPlayer()) break;
      }
      this.phase = 'countdown';
      this.countdown = 3;
      this.timeLeft = this.matchDuration;
      this.roundNumber += 1;
      this.finalResults = null;
      this.killFeed = [];
      this.crystals = createCrystalField();
      this.droppedEnergy = [];
      this.powerUps = [];
      this.nextPowerUpAt = Date.now() + 8000;
      this.lastTick = Date.now();
      this.players.forEach((player) => this.resetPlayerForMatch(player));
      return true;
    }

    returnToLobby() {
      this.phase = 'lobby';
      this.countdown = 3;
      this.timeLeft = this.matchDuration;
      this.finalResults = null;
      this.killFeed = [];
      this.crystals = createCrystalField();
      this.droppedEnergy = [];
      this.powerUps = [];
      this.nextPowerUpAt = 0;
      this.removeBots();
      for (const player of this.players.values()) {
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
        player.ghostUntil = 0;
        player.doubleUntil = 0;
        player.activePowerUps = [];
        player.spawnAnimUntil = 0;
        player.respawnAt = 0;
        player.lastDeathReason = null;
        player.killCombo = 0;
        player.lastKillAt = 0;
        player.moveAccumulator = 0;
      }
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
      const speedMult = player.speedUntil > now ? 1.65 : 1;
      const effectiveSpeed = PLAYER_SPEED * speedMult;

      player.x = clamp(player.x + (player.dirX || 0) * effectiveSpeed * dt, ARENA_PADDING, ARENA_WIDTH - ARENA_PADDING);
      player.y = clamp(player.y + (player.dirY || 0) * effectiveSpeed * dt, ARENA_PADDING, ARENA_HEIGHT - ARENA_PADDING);

      const spacing = CELL_SIZE;
      const segments = player.segments;
      if (!segments || segments.length === 0) {
        player.segments = [{ x: player.x, y: player.y }];
        return;
      }

      segments[0] = { x: player.x, y: player.y };
      for (let i = 1; i < segments.length; i += 1) {
        const prev = segments[i - 1];
        const cur = segments[i];
        const dx = prev.x - cur.x;
        const dy = prev.y - cur.y;
        const gap = Math.hypot(dx, dy) || 0.00001;
        if (gap > spacing) {
          const ux = dx / gap;
          const uy = dy / gap;
          segments[i] = { x: prev.x - ux * spacing, y: prev.y - uy * spacing };
        } else {
          segments[i] = { x: cur.x, y: cur.y };
        }
      }

      const desiredLen = Math.max(5, Math.min(22, 5 + Math.floor((player.totalScore || 0) / 8)));
      if (segments.length > desiredLen) {
        segments.splice(desiredLen, segments.length - desiredLen);
      } else if (segments.length < desiredLen) {
        const last = segments[segments.length - 1] || { x: player.x, y: player.y };
        while (segments.length < desiredLen) segments.push({ x: last.x, y: last.y });
      }
    }

    collectCrystals(player) {
      const now = Date.now();
      const magnetRadius = player.magnetUntil > now ? 180 : 0;
      for (let i = this.crystals.length - 1; i >= 0; i -= 1) {
        const crystal = this.crystals[i];
        const pickupDist = crystal.radius + PLAYER_RADIUS + 8;
        const d = dist(player, crystal);
        if (magnetRadius && d < magnetRadius && d >= pickupDist) {
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
      const magnetRadius = player.magnetUntil > now ? 180 : 0;
      for (let i = this.droppedEnergy.length - 1; i >= 0; i -= 1) {
        const fragment = this.droppedEnergy[i];
        const pickupDist = fragment.radius + PLAYER_RADIUS + 8;
        const d = dist(player, fragment);
        if (magnetRadius && d < magnetRadius && d >= pickupDist) {
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
      if (player.isBot) {
        player.botNextDirAt = Date.now() + 300;
        player.botDir = 'right';
      }
    }

    registerKill(killer, victim, reason) {
      if (killer && killer.id !== victim.id) {
        const now = Date.now();
        killer.killCombo = now - killer.lastKillAt < KILL_STREAK_WINDOW ? killer.killCombo + 1 : 1;
        killer.lastKillAt = now;
      } else if (killer && killer.id === victim.id) {
        killer.killCombo = 0;
      }
      this.killFeed.push({
        id: uniqueId('kill'),
        at: Date.now(),
        reason: reason || 'ELIMINATED',
        killerId: killer ? killer.id : null,
        killerName: killer ? killer.username : null,
        killerColor: killer ? killer.color : null,
        victimId: victim.id,
        victimName: victim.username,
        victimColor: victim.color,
        isBotKiller: killer ? !!killer.isBot : false,
        streak: killer ? killer.killCombo : 0,
        streakLabel: killer ? (STREAK_LABELS[killer.killCombo] || null) : null
      });
      if (this.killFeed.length > 12) this.killFeed.splice(0, this.killFeed.length - 12);
    }

    killPlayer(player, reason, killer = null) {
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
      this.registerKill(killer, player, reason);
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
          if (dist(first, second) < PLAYER_RADIUS * 2.1) {
            if (first.shieldUntil <= now) this.killPlayer(first, 'HEAD COLLISION');
            if (second.shieldUntil <= now) this.killPlayer(second, 'HEAD COLLISION');
          }
        }
      }

      for (const player of players) {
        if (!player.alive || player.shieldUntil > now) continue;
        for (const other of players) {
          if (other.id === player.id || !other.alive) continue;
          if (other.segments.some((segment) => dist(player, segment) < PLAYER_RADIUS + 5)) {
            this.killPlayer(player, 'BODY HIT', other);
            other.eliminations += 1;
            break;
          }
        }
      }

      for (const player of players) {
        if (!player.alive || player.shieldUntil > now) continue;
        for (let i = 2; i < player.segments.length; i += 1) {
          if (dist(player, player.segments[i]) < PLAYER_RADIUS + 4) {
            this.killPlayer(player, 'SELF COLLISION');
            break;
          }
        }
      }

      for (const player of players) {
        if (!player.alive || player.shieldUntil > now) continue;
        const hitWall = player.x <= WALL_KILL_MARGIN || player.x >= ARENA_WIDTH - WALL_KILL_MARGIN
          || player.y <= WALL_KILL_MARGIN || player.y >= ARENA_HEIGHT - WALL_KILL_MARGIN;
        if (hitWall) this.killPlayer(player, 'WALL HIT');
      }
    }

    tick() {
      const now = Date.now();
      const dt = Math.min((now - this.lastTick) / 1000, 0.08);
      this.lastTick = now;

      if (this.phase === 'lobby') return;

      if (this.phase === 'countdown') {
        this.countdown = Math.max(0, this.countdown - dt);
        if (this.countdown <= 0) this.phase = 'playing';
        return;
      }

      if (this.phase !== 'playing') return;

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
          if (player.isBot) this.updateBotAI(player);
          this.updateMovement(player, dt);
          this.collectCrystals(player);
          this.collectDroppedEnergy(player);
          this.collectPowerUps(player);
          if (player.totalScore > player.longestSnake * 5) {
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

    isEmpty() {
      return this.players.size === 0;
    }
  }

  /**
   * Offline engine: exposes the same event API as a Socket.IO client socket but
   * runs the match locally. Used when the page is opened without the Node server
   * (for example by double-clicking index.html), so the game is always playable.
   */
  function createLocalSocket() {
    const handlers = new Map();
    let room = null;
    let playerId = null;
    let tickTimer = null;

    function on(event, handler) {
      if (typeof handler !== 'function') return;
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    }

    function off(event, handler) {
      const list = handlers.get(event);
      if (!list) return;
      handlers.set(event, list.filter((entry) => entry !== handler));
    }

    function dispatch(event, payload) {
      const list = handlers.get(event);
      if (!list) return;
      for (const handler of list.slice()) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`Local game handler for "${event}" failed.`, error);
        }
      }
    }

    function stopTicking() {
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    }

    function startTicking() {
      if (tickTimer) return;
      tickTimer = setInterval(() => {
        if (!room) return;
        if (room.phase !== 'countdown' && room.phase !== 'playing') return;
        room.tick();
        dispatch('gameState', room.getState());
      }, TICK_MS);
    }

    function requireUsername(payload) {
      const username = sanitizeUsername(payload && payload.username);
      if (!username) {
        dispatch('joinError', { message: 'Please enter a name with 2-16 letters, numbers, spaces, underscores or dashes.' });
        return null;
      }
      return username;
    }

    function emit(event, payload) {
      switch (event) {
        case 'createRoom': {
          const username = requireUsername(payload);
          if (!username) return;
          stopTicking();
          const code = generateRoomCode(null);
          playerId = `local-player-${Math.random().toString(36).slice(2, 8)}`;
          room = new GameRoom(code, playerId);
          room.addPlayer(playerId, username);
          dispatch('roomCreated', {
            roomCode: code,
            playerId,
            isHost: true,
            lobby: room.getLobbyState()
          });
          break;
        }
        case 'joinRoom':
          dispatch('joinError', {
            message: 'Joining with a room code needs the online server. Run "npm start" and open http://localhost:3000 for multiplayer.'
          });
          break;
        case 'playerInput':
          applyPlayerInput(room, playerId, payload);
          break;
        case 'setMatchDuration':
          if (room && playerId === room.hostId && room.setMatchDuration(Number(payload && payload.duration))) {
            dispatch('lobbyUpdate', room.getLobbyState());
          }
          break;
        case 'setBotCount':
          if (room && playerId === room.hostId && room.setBotCount(payload && payload.count)) {
            dispatch('lobbyUpdate', room.getLobbyState());
          }
          break;
        case 'startGame':
          if (!room || playerId !== room.hostId) return;
          if (room.phase !== 'lobby' && room.phase !== 'ended') return;
          if (!room.startMatch()) return;
          dispatch('gameStarted', { message: 'Game starting!' });
          dispatch('lobbyUpdate', room.getLobbyState());
          dispatch('gameState', room.getState());
          startTicking();
          break;
        case 'backToLobby':
          if (!room || playerId !== room.hostId || room.phase !== 'ended') return;
          stopTicking();
          room.returnToLobby();
          dispatch('lobbyUpdate', room.getLobbyState());
          break;
        case 'leaveRoom':
          stopTicking();
          room = null;
          playerId = null;
          dispatch('leftRoom');
          break;
        default:
          break;
      }
    }

    setTimeout(() => dispatch('connect'), 0);

    return {
      id: 'local-socket',
      connected: true,
      isLocal: true,
      on,
      off,
      emit,
      removeAllListeners() {
        handlers.clear();
      },
      disconnect() {
        stopTicking();
      }
    };
  }

  return {
    GameRoom,
    createLocalSocket,
    applyPlayerInput,
    MAX_PLAYERS,
    MAX_BOT_COUNT,
    DEFAULT_BOT_COUNT,
    ARENA_WIDTH,
    ARENA_HEIGHT,
    PLAYER_RADIUS,
    PLAYER_SPEED,
    ARENA_PADDING,
    MATCH_OPTIONS,
    TICK_RATE,
    TICK_MS,
    PLAYER_COLORS,
    POWERUP_TYPES,
    sanitizeUsername,
    sanitizeRoomCode,
    generateRoomCode,
    createCrystalField
  };
});
