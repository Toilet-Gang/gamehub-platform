import express from 'express';
import { createServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import { WerewolfEngine } from './core/WerewolfEngine.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

const PORT = Number(process.env.PORT || 3005);
const rooms = new Map<string, WerewolfEngine>();

app.use(express.json());

// Health Check API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', game: 'werewolves-next', roomsCount: rooms.size });
});

// Create Room API
app.post('/api/rooms', (req, res) => {
  const roomCode = `WOLF_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const engine = new WerewolfEngine(roomCode);
  rooms.set(roomCode, engine);
  res.status(201).json({ roomCode });
});

// Socket.io Real-time Event Handlers
io.on('connection', (socket: Socket) => {
  let currentRoomCode: string | null = null;
  let currentPlayerId: string | null = null;

  socket.on('join_room', ({ roomCode, playerName }: { roomCode: string; playerName: string }) => {
    try {
      let engine = rooms.get(roomCode);
      if (!engine) {
        engine = new WerewolfEngine(roomCode);
        rooms.set(roomCode, engine);
      }

      const player = engine.addPlayer(playerName, socket.id);
      currentRoomCode = roomCode;
      currentPlayerId = player.id;

      socket.join(roomCode);

      socket.emit('joined_success', { playerId: player.id, roomCode });
      broadcastGameState(io, engine);
    } catch (err: any) {
      socket.emit('error_message', { message: err.message });
    }
  });

  socket.on('start_game', () => {
    if (!currentRoomCode) return;
    const engine = rooms.get(currentRoomCode);
    if (!engine) return;

    try {
      engine.startGame();
      broadcastGameState(io, engine);
    } catch (err: any) {
      socket.emit('error_message', { message: err.message });
    }
  });

  socket.on('night_action', ({ callKey, targetIds }: { callKey: string; targetIds: string[] }) => {
    if (!currentRoomCode || !currentPlayerId) return;
    const engine = rooms.get(currentRoomCode);
    if (!engine) return;

    try {
      engine.handleNightAction({ actorId: currentPlayerId, targetIds, callKey });
      broadcastGameState(io, engine);
    } catch (err: any) {
      socket.emit('error_message', { message: err.message });
    }
  });

  socket.on('cast_vote', ({ targetId }: { targetId: string }) => {
    if (!currentRoomCode || !currentPlayerId) return;
    const engine = rooms.get(currentRoomCode);
    if (!engine) return;

    try {
      engine.castVote(currentPlayerId, targetId);
      broadcastGameState(io, engine);
    } catch (err: any) {
      socket.emit('error_message', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    if (currentRoomCode && currentPlayerId) {
      const engine = rooms.get(currentRoomCode);
      if (engine) {
        engine.removePlayer(currentPlayerId);
        broadcastGameState(io, engine);
      }
    }
  });
});

function broadcastGameState(ioServer: Server, engine: WerewolfEngine) {
  const roomSockets = ioServer.sockets.adapter.rooms.get(engine.roomCode);
  if (!roomSockets) return;

  roomSockets.forEach((socketId) => {
    const targetSocket = ioServer.sockets.sockets.get(socketId);
    if (targetSocket) {
      // Send tailored state with secret role information
      const state = engine.getPublicState(socketId);
      targetSocket.emit('game_state_update', state);
    }
  });
}

httpServer.listen(PORT, () => {
  console.log(`🐺 Werewolves-Next Server listening on http://localhost:${PORT}`);
});
