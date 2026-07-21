'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { createWerewolvesApp } = require('../../games/werewolves/server');

const PORT = Number(process.env.PORT || 3004);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const HOME_PUBLIC_DIR = path.join(ROOT_DIR, 'apps', 'home', 'public');
const WEREWOLVES_DIR = path.join(ROOT_DIR, 'games', 'werewolves');

const rooms = new Map();

const games = {
  werewolves: {
    id: 'werewolves',
    name: 'Ma Soi',
    status: 'ready',
    description: 'Hidden-role village game with night actions, day votes, role settings, and TTS narration.',
    route: '/games/werewolves/',
    createSession(room) {
      return createWerewolvesApp({
        roomCode: room.code,
        rootDir: WEREWOLVES_DIR,
      });
    },
  },
  'game-2': {
    id: 'game-2',
    name: 'Game 2',
    status: 'placeholder',
    description: 'Reserved slot for the next GameHub game.',
    route: '',
  },
  'game-3': {
    id: 'game-3',
    name: 'Game 3',
    status: 'placeholder',
    description: 'Reserved slot for the next GameHub game.',
    route: '',
  },
  'game-4': {
    id: 'game-4',
    name: 'Game 4',
    status: 'placeholder',
    description: 'Reserved slot for the next GameHub game.',
    route: '',
  },
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname.startsWith('/games/')) {
      return await handleGameRequest(req, res, requestUrl);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/games') {
      return sendJson(res, 200, { games: Object.values(games).map(publicGame) });
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/rooms') {
      return sendJson(res, 200, { rooms: [...rooms.values()].map((room) => publicRoom(room)) });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/rooms') {
      const body = await readJson(req);
      const room = createRoom(body);
      return sendJson(res, 201, { room: publicRoom(room, room.ownerToken), ownerToken: room.ownerToken });
    }

    const roomMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)$/);
    if (req.method === 'GET' && roomMatch) {
      const room = requireRoom(roomMatch[1]);
      const ownerToken = requestUrl.searchParams.get('ownerToken') || '';
      return sendJson(res, 200, { room: publicRoom(room, ownerToken) });
    }

    const gameChangeMatch = requestUrl.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/game$/);
    if (req.method === 'POST' && gameChangeMatch) {
      const room = requireRoom(gameChangeMatch[1]);
      const body = await readJson(req);
      requireOwner(room, body.ownerToken || requestUrl.searchParams.get('ownerToken'));
      changeRoomGame(room, body.gameId);
      return sendJson(res, 200, { room: publicRoom(room, room.ownerToken) });
    }

    if (req.method === 'GET') {
      return serveStatic(HOME_PUBLIC_DIR, requestUrl.pathname, res);
    }

    return sendJson(res, 404, { error: 'Endpoint not found.' });
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message || 'Invalid request.' });
  }
});

server.listen(PORT, HOST, () => {
  const shownHost = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
  console.log(`GameHub is running at http://${shownHost}:${PORT}`);
});

function createRoom(body = {}) {
  const gameId = normalizeGameId(body.gameId) || 'werewolves';
  const game = games[gameId];

  if (!game || game.status !== 'ready') {
    throw httpError(400, 'Selected game is not available yet.');
  }

  const code = createRoomCode();
  const room = {
    code,
    ownerToken: crypto.randomUUID(),
    gameId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    scoresByGame: {},
    sessions: new Map(),
  };
  resetScore(room, gameId);
  rooms.set(code, room);
  return room;
}

function changeRoomGame(room, gameIdValue) {
  const gameId = normalizeGameId(gameIdValue);
  const game = games[gameId];

  if (!game || game.status !== 'ready') {
    throw httpError(400, 'Selected game is not available yet.');
  }

  room.gameId = gameId;
  room.updatedAt = Date.now();
  room.sessions.delete(gameId);
  resetScore(room, gameId);
}

function resetScore(room, gameId) {
  room.scoresByGame[gameId] = {
    gameId,
    players: {},
    resetAt: Date.now(),
  };
}

async function handleGameRequest(req, res, requestUrl) {
  const [, gameId] = requestUrl.pathname.match(/^\/games\/([^/]+)/) || [];
  const game = games[gameId];

  if (!game) {
    return sendJson(res, 404, { error: 'Game not found.' });
  }

  if (requestUrl.pathname === `/games/${gameId}`) {
    res.writeHead(302, { Location: `/games/${gameId}/${requestUrl.search}` });
    res.end();
    return;
  }

  const gamePath = requestUrl.pathname.slice(`/games/${gameId}`.length) || '/';

  if (req.method === 'GET' && !gamePath.startsWith('/api/') && gamePath !== '/events') {
    return serveStatic(path.join(ROOT_DIR, 'games', gameId, 'public'), gamePath, res);
  }

  const roomCode = normalizeRoomCode(requestUrl.searchParams.get('roomCode'));
  if (!roomCode) {
    throw httpError(400, 'Missing room code.');
  }

  const room = requireRoom(roomCode);
  if (room.gameId !== gameId) {
    throw httpError(409, 'This room is currently using a different game.');
  }

  const ownerOnlyPaths = new Set(['/api/settings', '/api/start', '/api/reset']);
  if (ownerOnlyPaths.has(gamePath)) {
    requireOwner(room, requestUrl.searchParams.get('ownerToken'));
  }

  const session = getGameSession(room, gameId);
  const originalUrl = req.url;
  req.url = `${gamePath}${requestUrl.search}`;

  try {
    await session.requestListener(req, res);
  } finally {
    req.url = originalUrl;
  }
}

function getGameSession(room, gameId) {
  if (!room.sessions.has(gameId)) {
    room.sessions.set(gameId, games[gameId].createSession(room));
  }
  return room.sessions.get(gameId);
}

function publicRoom(room, ownerToken = '') {
  const game = games[room.gameId];
  const isOwner = Boolean(ownerToken && ownerToken === room.ownerToken);
  const playUrl = `${game.route}?roomCode=${encodeURIComponent(room.code)}${isOwner ? `&ownerToken=${encodeURIComponent(ownerToken)}` : ''}`;

  return {
    code: room.code,
    gameId: room.gameId,
    game: publicGame(game),
    playUrl,
    isOwner,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    scores: room.scoresByGame,
  };
}

function publicGame(game) {
  return {
    id: game.id,
    name: game.name,
    status: game.status,
    description: game.description,
    route: game.route,
  };
}

function normalizeGameId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

function normalizeRoomCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function createRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let index = 0; index < 6; index += 1) {
      code += alphabet[crypto.randomInt(alphabet.length)];
    }
  } while (rooms.has(code));
  return code;
}

function requireRoom(roomCode) {
  const room = rooms.get(normalizeRoomCode(roomCode));
  if (!room) {
    throw httpError(404, 'Room not found.');
  }
  return room;
}

function requireOwner(room, ownerToken) {
  if (!ownerToken || ownerToken !== room.ownerToken) {
    throw httpError(403, 'Only the room owner can do this.');
  }
}

function serveStatic(rootDir, rawPathname, res) {
  const pathname = rawPathname === '/' ? '/index.html' : decodeURIComponent(rawPathname);
  const filePath = path.normalize(path.join(rootDir, pathname));

  if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${path.sep}`)) {
    return sendJson(res, 403, { error: 'Invalid path.' });
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      return sendJson(res, 404, { error: 'File not found.' });
    }

    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    return res.end(content);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(httpError(413, 'Payload too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(httpError(400, 'Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
