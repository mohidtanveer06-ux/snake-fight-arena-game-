const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const {
  GameRoom,
  MAX_PLAYERS,
  MAX_BOT_COUNT,
  TICK_MS,
  applyPlayerInput,
  sanitizeUsername,
  sanitizeRoomCode,
  generateRoomCode
} = require('./public/game-core.js');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

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

  // A room only lives while at least one human is inside it.
  if (!room.hasHumans()) {
    room.removeBots();
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
    const username = sanitizeUsername(payload && payload.username);
    if (!username) {
      socket.emit('joinError', { message: 'Invalid username. Use 2-16 letters, numbers, spaces, underscores, or dashes.' });
      return;
    }

    const roomCode = generateRoomCode(rooms);
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
    const username = sanitizeUsername(payload && payload.username);
    const roomCode = sanitizeRoomCode(payload && payload.roomCode);

    if (!username) {
      socket.emit('joinError', { message: 'Invalid username. Use 2-16 letters, numbers, spaces, underscores, or dashes.' });
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

    if (!room.addPlayer(socket.id, username)) {
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
    if (!room.setMatchDuration(Number(payload && payload.duration))) return;
    emitLobby(room);
  });

  socket.on('setBotCount', (payload) => {
    const room = getRoomFromSocket(socket);
    if (!room) return;
    if (socket.id !== room.hostId) {
      socket.emit('joinError', { message: 'Only the host can change the bot count.' });
      return;
    }
    if (!room.setBotCount(payload && payload.count)) {
      socket.emit('joinError', { message: `Bots must be between 0 and ${MAX_BOT_COUNT}.` });
      return;
    }
    emitLobby(room);
  });

  socket.on('startGame', () => {
    const room = getRoomFromSocket(socket);
    if (!room) return;
    if (socket.id !== room.hostId) {
      socket.emit('joinError', { message: 'Only the host can start the match.' });
      return;
    }
    if (room.phase !== 'lobby' && room.phase !== 'ended') return;
    if (!room.startMatch()) {
      socket.emit('joinError', { message: 'Unable to start the match.' });
      return;
    }
    io.to(room.code).emit('gameStarted', { message: 'Game starting!' });
    emitLobby(room);
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
    applyPlayerInput(room, socket.id, input);
  });

  socket.on('leaveRoom', () => {
    const room = leaveRoom(socket);
    if (room && !room.isEmpty()) {
      io.to(room.code).emit('hostChanged', {
        hostId: room.hostId,
        message: 'New host assigned.'
      });
      emitLobby(room);
    }
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
  throw err;
});

server.listen(PORT, () => {
  console.log(`MT SNAKE FIGHT ARENA server running at http://localhost:${PORT}`);
});
