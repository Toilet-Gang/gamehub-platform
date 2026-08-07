'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function createWerewolvesApp(options = {}) {
const MIN_PLAYERS = Number(options.minPlayers || process.env.MIN_PLAYERS || 4);
const MAX_PLAYERS = Number(options.maxPlayers || process.env.MAX_PLAYERS || 30);
const DISCUSSION_MS = Number(options.discussionMs || process.env.DISCUSSION_MS || 5 * 60 * 1000);
const ROOM_CODE = normalizeRoomCode(options.roomCode || process.env.ROOM_CODE) || createRoomCode();
const GOOGLE_TTS_MAX_CHARS = 200;

const ROOT_DIR = options.rootDir || __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const ROLES_FILE = path.join(ROOT_DIR, 'roles.md');

const GROUPS = {
  1: 'Dân làng',
  2: 'Ma sói',
  3: 'Phe thứ ba',
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

const { t } = require('./i18n');
const {
  roleCatalog,
  getRoleById,
  buildNightCalls: buildOopNightCalls,
  processNightCall: processOopNightCall,
  triggerDeathHooks: triggerOopDeathHooks,
} = require('./roles');

let game = createGame();
let dayTimer = null;
const sseClients = new Set();

const requestListener = async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && requestUrl.pathname === '/events') {
      return handleEvents(req, res, requestUrl);
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/state') {
      const playerId = requestUrl.searchParams.get('playerId');
      return sendJson(res, 200, buildState(playerId));
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/tts') {
      return handleGoogleTranslateTts(res, requestUrl);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/join') {
      const body = await readJson(req);
      const result = joinPlayer(body);
      broadcastState();
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/settings') {
      const body = await readJson(req);
      const result = updateSettings(body);
      broadcastState();
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/start') {
      startGame();
      broadcastState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/action') {
      const body = await readJson(req);
      handleAction(body);
      broadcastState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/skip-call') {
      skipCurrentNightCall();
      broadcastState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/force-resolve-day') {
      resolveDay();
      broadcastState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/leave') {
      const body = await readJson(req);
      const result = leavePlayer(body.playerId);
      broadcastState();
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/close-room') {
      const result = closeRoom();
      broadcastState();
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/reset') {
      resetGame(true);
      narrate('Ván mới đã sẵn sàng. Người chơi có thể kiểm tra tên và bắt đầu lại.');
      recordActivity('Ván mới đã sẵn sàng.');
      broadcastState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET') {
      return serveStatic(requestUrl.pathname, res);
    }

    return sendJson(res, 404, { error: 'Không tìm thấy endpoint.' });
  } catch (error) {
    return sendJson(res, error.statusCode || 400, { error: error.message || 'Yêu cầu không hợp lệ.' });
  }
};

return {
  gameId: 'werewolves',
  roomCode: ROOM_CODE,
  requestListener,
  buildState,
  resetGame,
};

function createGame() {
  return {
    phase: 'lobby',
    round: 0,
    players: new Map(),
    publicLog: [],
    activityLog: [],
    settings: createDefaultSettings(MIN_PLAYERS),
    deck: [],
    night: null,
    day: null,
    winner: null,
    guardLastTargets: new Map(),
    hunterTargets: new Map(),
    motherBonds: new Map(),
    cultMembers: new Set(),
    witchPotions: new Map(),
    wolfExtraKills: 0,
    nextEventId: 1,
    createdAt: Date.now(),
  };
}

function parseRolesMarkdown(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && !line.includes('---') && !line.startsWith('| Name'))
    .map((line, index) => {
      const cells = line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());

      if (cells.length < 5) {
        return null;
      }

      const [name, description, group, order, feature] = cells;
      return {
        id: slugify(name),
        name,
        displayName: titleCase(name),
        description,
        group: Number(group),
        groupName: GROUPS[Number(group)] || `Phe ${group}`,
        order: Number(order),
        feature: feature.toUpperCase() === 'T',
        sourceIndex: index,
      };
    })
    .filter(Boolean)
    .filter((role) => role.name && Number.isFinite(role.group) && Number.isFinite(role.order));
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function titleCase(text) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase('vi-VN') + word.slice(1))
    .join(' ');
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
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

function validateRoomCode(value) {
  if (normalizeRoomCode(value) !== ROOM_CODE) {
    throw httpError(403, 'Mã phòng không đúng.');
  }
}

function createDefaultSettings(playerCount) {
  const targetPlayerCount = clampInteger(playerCount, MIN_PLAYERS, MAX_PLAYERS);
  return {
    targetPlayerCount,
    roleCounts: recommendedRoleCounts(targetPlayerCount),
    updatedAt: Date.now(),
  };
}

function recommendedRoleCounts(playerCount) {
  const roleCounts = Object.fromEntries(roleCatalog.map((role) => [role.id, 0]));
  const add = (roleId) => {
    if (roleCounts[roleId] !== undefined && countRoles(roleCounts) < playerCount) {
      roleCounts[roleId] += 1;
    }
  };

  add('ma-soi');

  const milestones = [
    [3, 'tien-tri'],
    [4, 'bao-ve'],
    [5, 'phu-thuy'],
    [7, 'soi-con'],
    [8, 'tho-san'],
    [9, 'me-tre'],
    [10, 'nha-tam-than-hoc'],
    [11, 'truong-giao-phai'],
  ];

  for (const [minimum, roleId] of milestones) {
    if (playerCount >= minimum) {
      add(roleId);
    }
  }

  const fillerRoleId = findDefaultVillagerId();
  if (fillerRoleId) {
    roleCounts[fillerRoleId] += Math.max(0, playerCount - countRoles(roleCounts));
  }

  return roleCounts;
}

function findDefaultVillagerId() {
  return (
    findRole('dan-lang')?.id ||
    roleCatalog.find((role) => role.group === 1 && !role.feature)?.id ||
    roleCatalog.find((role) => role.group === 1)?.id ||
    roleCatalog[0]?.id ||
    ''
  );
}

function updateSettings(body) {
  if (game.phase !== 'lobby') {
    throw httpError(409, 'Chỉ có thể đổi cấu hình vai trò khi ván còn ở phòng chờ.');
  }

  const settings = normalizeSettings(body || {});
  game.settings = settings;
  recordActivity(`Cấu hình vai trò đã cập nhật: ${settings.targetPlayerCount} người, ${countRoles(settings.roleCounts)} vai.`);
  return { ok: true, settings: buildSettingsState() };
}

function normalizeSettings(body) {
  const targetPlayerCount = toInteger(body.targetPlayerCount, game.settings.targetPlayerCount);

  if (targetPlayerCount < MIN_PLAYERS || targetPlayerCount > MAX_PLAYERS) {
    throw httpError(400, `Số người chơi phải từ ${MIN_PLAYERS} đến ${MAX_PLAYERS}.`);
  }

  if (targetPlayerCount < game.players.size) {
    throw httpError(409, 'Số người dự kiến không thể nhỏ hơn số người đã vào phòng.');
  }

  const sourceCounts = body.roleCounts && typeof body.roleCounts === 'object' ? body.roleCounts : {};
  const roleCounts = {};

  for (const role of roleCatalog) {
    const count = toInteger(sourceCounts[role.id], 0);
    if (count < 0 || count > targetPlayerCount) {
      throw httpError(400, `Số lượng ${role.displayName} không hợp lệ.`);
    }
    roleCounts[role.id] = count;
  }

  const errors = settingsErrors({ targetPlayerCount, roleCounts }, game.players.size, false);
  if (errors.length) {
    throw httpError(400, errors[0]);
  }

  return {
    targetPlayerCount,
    roleCounts,
    updatedAt: Date.now(),
  };
}

function buildSettingsState() {
  const analysis = analyzeRoleCounts(game.settings.roleCounts);
  const errors = settingsErrors(game.settings, game.players.size, true);

  return {
    roomCode: ROOM_CODE,
    targetPlayerCount: game.settings.targetPlayerCount,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    roleCounts: { ...game.settings.roleCounts },
    roleTotal: analysis.total,
    groupTotals: analysis.groupTotals,
    remainingSeats: Math.max(0, game.settings.targetPlayerCount - game.players.size),
    readyToStart: errors.length === 0,
    errors,
  };
}

function settingsErrors(settings, playerCount, requireExactPlayers) {
  const analysis = analyzeRoleCounts(settings.roleCounts);
  const errors = [];

  if (settings.targetPlayerCount < MIN_PLAYERS) {
    errors.push(`Cần ít nhất ${MIN_PLAYERS} người chơi.`);
  }
  if (settings.targetPlayerCount > MAX_PLAYERS) {
    errors.push(`Số người chơi tối đa là ${MAX_PLAYERS}.`);
  }
  if (analysis.total !== settings.targetPlayerCount) {
    errors.push(`Tổng số vai phải bằng ${settings.targetPlayerCount}.`);
  }
  if (analysis.wolves < 1) {
    errors.push('Cần ít nhất 1 vai phe Ma sói.');
  }
  if (analysis.villagers < 1) {
    errors.push('Cần ít nhất 1 vai phe Dân làng.');
  }
  if (playerCount > settings.targetPlayerCount) {
    errors.push('Số người trong phòng đang nhiều hơn số người dự kiến.');
  }
  if (requireExactPlayers && playerCount !== settings.targetPlayerCount) {
    errors.push(`Cần đúng ${settings.targetPlayerCount} người chơi để bắt đầu.`);
  }

  return errors;
}

function analyzeRoleCounts(roleCounts) {
  const groupTotals = { 1: 0, 2: 0, 3: 0 };
  let total = 0;

  for (const role of roleCatalog) {
    const count = toInteger(roleCounts[role.id], 0);
    total += count;
    groupTotals[role.group] = (groupTotals[role.group] || 0) + count;
  }

  return {
    total,
    groupTotals,
    villagers: groupTotals[1] || 0,
    wolves: groupTotals[2] || 0,
  };
}

function countRoles(roleCounts) {
  return Object.values(roleCounts).reduce((sum, value) => sum + toInteger(value, 0), 0);
}

function toInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return number;
}

function clampInteger(value, min, max) {
  return Math.min(max, Math.max(min, toInteger(value, min)));
}

function joinPlayer(body) {
  const name = String(body.name || '').trim().slice(0, 40);
  const requestedId = typeof body.playerId === 'string' ? body.playerId : '';

  if (!name) {
    throw httpError(400, 'Vui lòng nhập tên người chơi.');
  }

  if (requestedId && game.players.has(requestedId)) {
    const player = game.players.get(requestedId);
    player.name = name;
    player.connected = true;
    player.lastSeenAt = Date.now();
    return { playerId: player.id, player: publicPlayer(player, false) };
  }

  validateRoomCode(body.roomCode);

  if (game.phase !== 'lobby') {
    throw httpError(409, 'Ván đã bắt đầu, người chơi mới chỉ có thể tham gia ở ván sau.');
  }

  if (game.players.size >= game.settings.targetPlayerCount) {
    throw httpError(409, 'Phòng đã đủ số người theo cấu hình hiện tại.');
  }

  const id = crypto.randomUUID();
  const player = {
    id,
    name,
    alive: true,
    connected: true,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
    role: null,
    messages: [],
    deathReason: null,
  };

  game.players.set(id, player);
  narrate(`${name} đã vào phòng.`);
  recordActivity(`${name} đã vào phòng.`);
  return { playerId: id, player: publicPlayer(player, false) };
}

function leavePlayer(playerId) {
  if (!playerId || !game.players.has(playerId)) {
    return { ok: true };
  }

  const player = game.players.get(playerId);
  game.players.delete(playerId);
  narrate(`${player.name} đã rời khỏi phòng.`);
  recordActivity(`${player.name} đã rời khỏi phòng.`);
  return { ok: true };
}

function closeRoom() {
  resetGame(true);
  game.players.clear();
  narrate('Host đã giải thể phòng chơi.');
  recordActivity('Host đã giải thể phòng chơi. Phòng đã đóng.');
  return { ok: true };
}

function startGame() {
  if (game.phase !== 'lobby') {
    throw httpError(409, 'Ván đang chạy.');
  }

  const players = livePlayers({ includeUnassigned: true });
  const errors = settingsErrors(game.settings, players.length, true);
  if (errors.length) {
    throw httpError(409, errors[0]);
  }

  const deck = buildDeck(players.length);
  const shuffledPlayers = shuffle(players);

  shuffledPlayers.forEach((player, index) => {
    const role = deck[index];
    player.role = role;
    player.alive = true;
    player.deathReason = null;
    player.messages = [];
  });

  game.deck = deck;
  game.guardLastTargets.clear();
  game.hunterTargets.clear();
  game.motherBonds.clear();
  game.cultMembers.clear();
  game.witchPotions.clear();
  game.wolfExtraKills = 0;
  game.winner = null;

  for (const player of players) {
    if (player.role.id === 'truong-giao-phai') {
      game.cultMembers.add(player.id);
    }
    if (player.role.id === 'phu-thuy') {
      game.witchPotions.set(player.id, { save: true, poison: true });
    }
    addPrivateMessage(player.id, `Vai trò của bạn là ${player.role.displayName}. ${player.role.description}`);
  }

  narrate('Quản trò đã chia vai bí mật. Đêm đầu tiên bắt đầu, tất cả người chơi nhắm mắt.');
  recordActivity('Ván đấu bắt đầu. Vai trò đã được chia riêng cho từng người chơi.');
  beginNight();
}

function buildDeck(playerCount) {
  const deck = [];

  for (const role of roleCatalog) {
    const count = toInteger(game.settings.roleCounts[role.id], 0);
    for (let index = 0; index < count; index += 1) {
      deck.push(role);
    }
  }

  if (deck.length !== playerCount) {
    throw httpError(409, `Bộ vai hiện có ${deck.length} vai, không khớp ${playerCount} người chơi.`);
  }

  return shuffle(deck);
}

function beginNight() {
  clearDayTimer();
  game.phase = 'night';
  game.round += 1;
  game.day = null;
  game.night = {
    callIndex: -1,
    calls: buildNightCalls(),
    pendingActions: new Map(),
    protectedIds: new Set(),
    wolfAttackIds: [],
    wolfKillLimit: game.wolfExtraKills > 0 ? 2 : 1,
    savedByWitchIds: new Set(),
    poisonedIds: new Set(),
    deaths: [],
  };

  narrate(`Đêm ${game.round} bắt đầu. Quản trò sẽ gọi các vai trò theo thứ tự trong roles.md.`);
  recordActivity(`Đêm ${game.round} bắt đầu.`);
  advanceNightCall();
}

function buildNightCalls() {
  return buildOopNightCalls(game);
}

let nightAutoTimer = null;

function clearNightAutoTimer() {
  if (nightAutoTimer) {
    clearTimeout(nightAutoTimer);
    nightAutoTimer = null;
  }
}

function roleIsInDeck(call) {
  return [...game.players.values()].some(player => player.role && call.roleIds.includes(player.role.id));
}

function advanceNightCall() {
  clearNightAutoTimer();
  if (game.phase !== 'night' || !game.night) {
    return;
  }

  game.night.pendingActions = new Map();
  game.night.callIndex += 1;

  while (game.night.callIndex < game.night.calls.length) {
    const call = currentCall();

    if (roleIsInDeck(call)) {
      const expectedActors = expectedActorsForCall(call);
      narrate(call.tts);

      if (expectedActors.length > 0) {
        return;
      }

      // If actor for this role is dead, narrate call and auto-advance after 5s
      nightAutoTimer = setTimeout(() => {
        advanceNightCall();
        broadcastState();
      }, 5000);
      return;
    }

    game.night.callIndex += 1;
  }

  resolveNight();
}

function skipCurrentNightCall() {
  if (game.phase !== 'night' || !game.night) {
    return;
  }
  const call = currentCall();
  if (call) {
    recordActivity(`${call.title} đã bị Host bỏ qua.`);
  }
  advanceNightCall();
}

function handleAction(body) {
  const player = requirePlayer(body.playerId);

  if (game.phase === 'night') {
    return handleNightAction(player, body.action || {});
  }

  if (game.phase === 'day') {
    return handleDayAction(player, body.action || {});
  }

  throw httpError(409, 'Hiện không có hành động nào để chọn.');
}

function handleNightAction(player, action) {
  if (!player.alive) {
    throw httpError(403, 'Người chơi đã chết không thể hành động.');
  }

  const call = currentCall();
  if (!call) {
    throw httpError(409, 'Quản trò chưa gọi vai trò nào.');
  }

  const expectedActors = expectedActorsForCall(call);
  if (!expectedActors.some((actor) => actor.id === player.id)) {
    throw httpError(403, 'Chưa tới lượt vai trò của bạn.');
  }

  const normalized = normalizeNightAction(player, call, action);
  game.night.pendingActions.set(player.id, normalized);
  addPrivateMessage(player.id, normalized.skip ? 'Bạn đã bỏ qua lượt này.' : 'Quản trò đã ghi nhận lựa chọn của bạn.');

  if (expectedActors.every((actor) => game.night.pendingActions.has(actor.id))) {
    recordActivity(nightCallActivityText(call, [...game.night.pendingActions.values()]));
    processNightCall(call);
    advanceNightCall();
  }
}

function nightCallActivityText(call, actions) {
  const hasAction = actions.some((action) => !action.skip);

  if (!hasAction) {
    return `${call.title} đã bỏ qua.`;
  }

  if (call.key === 'witch') {
    return `${call.title} đã dùng một bình thuốc.`;
  }

  return `${call.title} đã chọn.`;
}

function normalizeNightAction(player, call, action) {
  if (action.skip) {
    return { actorId: player.id, key: call.key, skip: true, targetIds: [] };
  }

  if (call.key === 'witch') {
    return normalizeWitchAction(player, action);
  }

  const targetIds = uniqueArray(Array.isArray(action.targetIds) ? action.targetIds : [action.targetId].filter(Boolean));
  if (targetIds.length < call.minTargets || targetIds.length > call.maxTargets) {
    throw httpError(400, `Cần chọn ${targetText(call.minTargets, call.maxTargets)}.`);
  }

  const candidates = candidateIdsForCall(player, call);
  for (const targetId of targetIds) {
    if (!candidates.has(targetId)) {
      throw httpError(400, 'Mục tiêu không hợp lệ cho lượt này.');
    }
  }

  return { actorId: player.id, key: call.key, skip: false, targetIds };
}

function normalizeWitchAction(player, action) {
  const type = String(action.type || '');
  const options = witchOptionsFor(player);
  const option = options.find((item) => item.type === type);

  if (!option) {
    throw httpError(400, t('err_witch_invalid_potion'));
  }

  const targetIds = uniqueArray(Array.isArray(action.targetIds) ? action.targetIds : [action.targetId].filter(Boolean));
  if (targetIds.length !== 1) {
    throw httpError(400, t('err_witch_target_required'));
  }

  const allowed = new Set(option.candidates.map((candidate) => candidate.id));
  if (!allowed.has(targetIds[0])) {
    throw httpError(400, t('err_invalid_target'));
  }

  return {
    actorId: player.id,
    key: 'witch',
    skip: false,
    type,
    targetIds,
  };
}

function processNightCall(call) {
  const actions = [...game.night.pendingActions.values()].filter((action) => !action.skip);
  processOopNightCall(call, actions, game, {
    selectTopTargets,
    addPrivateMessage,
  });
}

function resolveNight() {
  const protectedIds = game.night.protectedIds;
  const deathIds = new Set();

  for (const targetId of game.night.wolfAttackIds) {
    if (!protectedIds.has(targetId) && !game.night.savedByWitchIds.has(targetId)) {
      deathIds.add(targetId);
    }
  }

  for (const targetId of game.night.poisonedIds) {
    if (!protectedIds.has(targetId)) {
      deathIds.add(targetId);
    }
  }

  const deaths = eliminatePlayers([...deathIds], t('msg_dead_status'));
  game.night.deaths = deaths;

  if (deaths.length === 0) {
    narrate(t('log_morning_no_deaths'));
    recordActivity(t('log_morning_no_deaths'));
  } else {
    const names = deaths.map((death) => death.name).join(', ');
    narrate(t('log_morning_deaths', { names }));
    recordActivity(t('log_morning_deaths', { names }));
  }

  if (maybeEndGame()) {
    return;
  }

  beginDay(deaths);
}

function beginDay(deaths) {
  game.phase = 'day';
  game.day = {
    votes: new Map(),
    discussionEndsAt: Date.now() + DISCUSSION_MS,
    deaths,
  };
  narrate(t('log_discussion_time', { minutes: Math.round(DISCUSSION_MS / 60000) }));
  recordActivity(t('log_day_begin'));
  scheduleDayTimer();
}

function handleDayAction(player, action) {
  if (!player.alive) {
    throw httpError(403, t('err_player_dead'));
  }

  if (game.day.votes.has(player.id)) {
    throw httpError(409, t('err_already_voted'));
  }

  const targetId = action.skip ? null : String(action.targetId || '');
  if (targetId) {
    const target = game.players.get(targetId);
    if (!target || !target.alive || target.id === player.id) {
      throw httpError(400, t('err_invalid_vote'));
    }
  }

  game.day.votes.set(player.id, targetId);
  narrate(t('log_player_voted', { name: player.name }));
  recordActivity(t('log_player_voted', { name: player.name }));

  if (game.day.votes.size >= livePlayers().length) {
    resolveDay();
  }
}

function resolveDay() {
  if (game.phase !== 'day' || !game.day) {
    return;
  }

  clearDayTimer();

  const totalVoters = livePlayers().length;
  const majorityThreshold = Math.floor(totalVoters / 2) + 1;

  const votes = [...game.day.votes.values()].filter(Boolean);
  const tally = tallyTargets(votes);
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  let eliminated = [];

  if (sorted.length) {
    const topScore = sorted[0][1];
    const tiedTop = sorted.filter(([, score]) => score === topScore);

    if (tiedTop.length === 1 && topScore >= majorityThreshold) {
      const target = game.players.get(tiedTop[0][0]);
      eliminated = eliminatePlayers([target.id], t('msg_dead_status'));
      narrate(t('log_lynched_success', { name: target.name, topScore, totalVoters }));
      recordActivity(t('log_lynched_success', { name: target.name, topScore, totalVoters }));
    } else if (topScore < majorityThreshold) {
      narrate(t('log_lynched_majority_failed', { threshold: majorityThreshold }));
      recordActivity(t('log_lynched_majority_failed', { threshold: majorityThreshold }));
    } else {
      narrate(t('log_lynched_tied'));
      recordActivity(t('log_lynched_tied'));
    }
  } else {
    narrate(t('log_no_lynch'));
    recordActivity(t('log_no_lynch'));
  }

  if (maybeEndGame()) {
    return;
  }

  beginNight();
}

function eliminatePlayers(playerIds, reason) {
  const queue = uniqueArray(playerIds).filter(Boolean);
  const deaths = [];

  while (queue.length) {
    const playerId = queue.shift();
    const player = game.players.get(playerId);

    if (!player || !player.alive) {
      continue;
    }

    player.alive = false;
    player.deathReason = reason;
    const death = {
      id: player.id,
      name: player.name,
      role: serializeRole(player.role),
      reason,
    };
    deaths.push(death);
    addPrivateMessage(player.id, t('msg_you_are_dead'));

    triggerOopDeathHooks(player, game, queue);
  }

  return deaths;
}

function maybeEndGame() {
  const winner = checkWinner();
  if (!winner) {
    return false;
  }

  game.phase = 'ended';
  game.winner = winner;
  game.night = null;
  game.day = null;
  clearDayTimer();
  narrate(t('win_announcement', { name: winner.name, reason: winner.reason }));
  recordActivity(t('win_announcement', { name: winner.name, reason: winner.reason }));
  broadcastState();
  return true;
}

function checkWinner() {
  const alive = livePlayers();
  if (alive.length === 0) {
    return { key: 'none', name: t('win_none_name'), reason: t('win_none_reason') };
  }

  const cultLeaderAlive = alive.some((player) => player.role?.id === 'truong-giao-phai');
  if (cultLeaderAlive && alive.every((player) => game.cultMembers.has(player.id))) {
    return {
      key: 'cult',
      name: 'Phe Giáo phái',
      reason: 'Tất cả người còn sống đã gia nhập Giáo phái.',
    };
  }

  const wolves = alive.filter((player) => player.role?.group === 2).length;
  const villagers = alive.filter((player) => player.role?.group === 1).length;

  if (wolves === 0) {
    return { key: 'village', name: 'Phe Dân làng', reason: 'Toàn bộ Ma sói đã bị loại.' };
  }

  if (wolves >= villagers) {
    return {
      key: 'wolves',
      name: 'Phe Ma sói',
      reason: 'Số Ma sói còn sống bằng hoặc vượt số người phe Dân làng.',
    };
  }

  return null;
}

function expectedActorsForCall(call) {
  return livePlayers()
    .filter((player) => player.role && call.roleIds.includes(player.role.id))
    .filter((player) => hasAvailableAction(player, call));
}

function hasAvailableAction(player, call) {
  if (call.key === 'witch') {
    return witchOptionsFor(player).length > 0;
  }
  return candidateIdsForCall(player, call).size >= call.minTargets;
}

function candidateIdsForCall(player, call) {
  const candidates = candidatesForCall(player, call);
  return new Set(candidates.filter((candidate) => !candidate.disabled).map((candidate) => candidate.id));
}

function candidatesForCall(player, call) {
  const role = getRoleById(call.roleIds[0]);
  if (role && typeof role.getCandidates === 'function') {
    return role.getCandidates(player, game, call.key);
  }
  return [];
}

function witchOptionsFor(player) {
  const potions = game.witchPotions.get(player.id);
  if (!potions) {
    return [];
  }

  const options = [];

  if (potions.save) {
    const candidates = game.night.wolfAttackIds
      .map((targetId) => game.players.get(targetId))
      .filter((target) => target?.alive)
      .map((target) => ({ id: target.id, name: target.name }));

    if (candidates.length) {
      options.push({
        type: 'save',
        label: 'Dùng thuốc cứu',
        candidates,
      });
    }
  }

  if (potions.poison) {
    const candidates = livePlayers()
      .filter((target) => target.id !== player.id)
      .map((target) => ({ id: target.id, name: target.name }));

    if (candidates.length) {
      options.push({
        type: 'poison',
        label: 'Dùng thuốc giết',
        candidates,
      });
    }
  }

  return options;
}

function buildState(playerId) {
  const viewer = playerId ? game.players.get(playerId) : null;
  const revealRoles = game.phase === 'ended';
  const players = [...game.players.values()]
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((player) => publicPlayer(player, revealRoles, viewer?.id));

  return {
    phase: game.phase,
    round: game.round,
    roomCode: ROOM_CODE,
    minPlayers: MIN_PLAYERS,
    playerCount: game.players.size,
    serverTime: Date.now(),
    self: viewer ? privatePlayer(viewer) : null,
    players,
    roles: roleCatalog.map(serializeRole),
    roomCodeRequired: true,
    settings: buildSettingsState(),
    currentCall: buildCurrentCallState(),
    privateAction: viewer ? buildPrivateActionState(viewer) : null,
    day: viewer ? buildDayState(viewer) : buildDayState(null),
    activityLog: game.activityLog.slice(-80),
    publicLog: game.phase === 'ended' ? game.publicLog.slice(-80) : [],
    privateMessages: viewer ? viewer.messages.slice(-30) : [],
    winner: game.winner,
  };
}

function publicPlayer(player, revealRole, viewerId) {
  return {
    id: player.id,
    name: player.name,
    alive: player.alive,
    connected: player.connected,
    isYou: player.id === viewerId,
    role: revealRole && player.role ? serializeRole(player.role) : null,
    deathReason: player.deathReason,
  };
}

function privatePlayer(player) {
  const data = {
    id: player.id,
    name: player.name,
    alive: player.alive,
    role: player.role ? serializeRole(player.role) : null,
    inCult: game.cultMembers.has(player.id),
  };

  if (player.role?.group === 2) {
    data.wolfPack = livePlayers()
      .filter((other) => other.role?.group === 2)
      .map((other) => ({ id: other.id, name: other.name, role: other.role.displayName }));
  }

  if (player.role?.id === 'phu-thuy') {
    data.witchPotions = game.witchPotions.get(player.id) || { save: false, poison: false };
  }

  return data;
}

function buildCurrentCallState() {
  if (game.phase !== 'night') {
    return null;
  }

  const call = currentCall();
  if (!call) {
    return null;
  }

  const expectedActors = expectedActorsForCall(call);
  return {
    key: call.key,
    title: call.title,
    order: call.order,
    tts: call.tts,
    prompt: call.prompt,
    expectedCount: expectedActors.length,
    submittedCount: game.night.pendingActions.size,
  };
}

function buildPrivateActionState(player) {
  if (!player.alive || game.phase !== 'night') {
    return null;
  }

  const call = currentCall();
  if (!call || !expectedActorsForCall(call).some((actor) => actor.id === player.id)) {
    return null;
  }

  const submitted = game.night.pendingActions.has(player.id);

  if (call.key === 'witch') {
    return {
      key: call.key,
      title: call.title,
      prompt: call.prompt,
      mode: 'witch',
      submitted,
      options: witchOptionsFor(player),
      canSkip: true,
    };
  }

  return {
    key: call.key,
    title: call.title,
    prompt: call.prompt,
    mode: call.maxTargets > 1 ? 'multi' : 'single',
    minTargets: call.minTargets,
    maxTargets: call.maxTargets,
    submitted,
    canSkip: true,
    candidates: candidatesForCall(player, call),
  };
}

function buildDayState(viewer) {
  if (game.phase !== 'day') {
    return null;
  }

  return {
    discussionEndsAt: game.day.discussionEndsAt,
    votesSubmitted: game.day.votes.size,
    aliveCount: livePlayers().length,
    canVote: Boolean(viewer?.alive),
    submitted: viewer ? game.day.votes.has(viewer.id) : false,
    candidates: viewer
      ? livePlayers()
          .filter((player) => player.id !== viewer.id)
          .map((player) => ({ id: player.id, name: player.name }))
      : [],
  };
}

function serializeRole(role) {
  if (!role) {
    return null;
  }

  return {
    id: role.id,
    name: role.name,
    displayName: role.displayName,
    description: role.description,
    group: role.group,
    groupName: role.groupName,
    order: role.order,
    feature: role.feature,
  };
}

async function handleGoogleTranslateTts(res, requestUrl) {
  const text = String(requestUrl.searchParams.get('text') || '').replace(/\s+/g, ' ').trim();

  if (!text) {
    throw httpError(400, 'Thiếu nội dung cần đọc.');
  }

  if (text.length > GOOGLE_TTS_MAX_CHARS) {
    throw httpError(400, `Nội dung TTS tối đa ${GOOGLE_TTS_MAX_CHARS} ký tự mỗi đoạn.`);
  }

  const ttsUrl = new URL('https://translate.google.com/translate_tts');
  ttsUrl.searchParams.set('ie', 'UTF-8');
  ttsUrl.searchParams.set('client', 'tw-ob');
  ttsUrl.searchParams.set('tl', 'vi');
  ttsUrl.searchParams.set('q', text);

  let upstream;
  try {
    upstream = await fetch(ttsUrl, {
      headers: {
        Accept: 'audio/mpeg,*/*',
        Referer: 'https://translate.google.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      },
    });
  } catch {
    throw httpError(502, 'Không gọi được Google Translate TTS.');
  }

  if (!upstream.ok) {
    throw httpError(502, 'Google Translate TTS không phản hồi thành công.');
  }

  const audio = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(200, {
    'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
    'Cache-Control': 'public, max-age=86400',
    'Content-Length': audio.length,
  });
  res.end(audio);
}

function handleEvents(req, res, requestUrl) {
  const playerId = requestUrl.searchParams.get('playerId');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n');

  const client = { res, playerId };
  sseClients.add(client);

  if (playerId && game.players.has(playerId)) {
    game.players.get(playerId).connected = true;
  }

  sendSse(client, 'state', buildState(playerId));

  req.on('close', () => {
    sseClients.delete(client);
  });
}

function broadcastState() {
  for (const client of sseClients) {
    sendSse(client, 'state', buildState(client.playerId));
  }
}

function broadcastNarration(event) {
  for (const client of sseClients) {
    sendSse(client, 'narration', event);
  }
}

function sendSse(client, event, data) {
  client.res.write(`event: ${event}\n`);
  client.res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function narrate(text) {
  const event = {
    id: game.nextEventId++,
    time: Date.now(),
    text,
  };
  game.publicLog.push(event);
  if (game.publicLog.length > 200) {
    game.publicLog.shift();
  }
  console.log(`[GM] ${text}`);
  broadcastNarration(event);
}

function recordActivity(text) {
  const event = {
    id: game.nextEventId++,
    time: Date.now(),
    text,
  };
  game.activityLog.push(event);
  if (game.activityLog.length > 200) {
    game.activityLog.shift();
  }
}

function addPrivateMessage(playerId, text) {
  const player = game.players.get(playerId);
  if (!player) {
    return;
  }

  player.messages.push({
    id: `${Date.now()}-${player.messages.length}`,
    time: Date.now(),
    text,
  });

  if (player.messages.length > 100) {
    player.messages.shift();
  }
}

function currentCall() {
  if (!game.night || game.night.callIndex < 0 || game.night.callIndex >= game.night.calls.length) {
    return null;
  }
  return game.night.calls[game.night.callIndex];
}

function livePlayers(options = {}) {
  return [...game.players.values()].filter((player) => {
    if (!options.includeUnassigned && !player.role && game.phase !== 'lobby') {
      return false;
    }
    return options.includeUnassigned ? true : player.alive;
  });
}

function requirePlayer(playerId) {
  const player = game.players.get(String(playerId || ''));
  if (!player) {
    throw httpError(401, 'Không tìm thấy người chơi.');
  }
  player.lastSeenAt = Date.now();
  return player;
}

function findRole(roleId) {
  return roleCatalog.find((role) => role.id === roleId);
}

function selectTopTargets(targetIds, limit, randomizeTies) {
  const tally = tallyTargets(targetIds);
  const groups = new Map();

  for (const [targetId, score] of tally.entries()) {
    if (!groups.has(score)) {
      groups.set(score, []);
    }
    groups.get(score).push(targetId);
  }

  const selected = [];
  const scores = [...groups.keys()].sort((a, b) => b - a);

  for (const score of scores) {
    const ids = randomizeTies ? shuffle(groups.get(score)) : groups.get(score);
    for (const id of ids) {
      if (selected.length >= limit) {
        return selected;
      }
      selected.push(id);
    }
  }

  return selected;
}

function tallyTargets(targetIds) {
  const tally = new Map();
  for (const targetId of targetIds) {
    tally.set(targetId, (tally.get(targetId) || 0) + 1);
  }
  return tally;
}

function uniqueArray(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function targetText(minTargets, maxTargets) {
  if (minTargets === maxTargets) {
    return `${minTargets} mục tiêu`;
  }
  return `từ ${minTargets} đến ${maxTargets} mục tiêu`;
}

function scheduleDayTimer() {
  clearDayTimer();
  dayTimer = setTimeout(() => {
    if (game.phase === 'day') {
      narrate('Hết thời gian thảo luận.');
      resolveDay();
      broadcastState();
    }
  }, DISCUSSION_MS);
}

function clearDayTimer() {
  if (dayTimer) {
    clearTimeout(dayTimer);
    dayTimer = null;
  }
}

function resetGame(keepPlayers) {
  clearDayTimer();
  const previousSettings = cloneSettings(game.settings);
  const existingPlayers = keepPlayers
    ? [...game.players.values()].map((player) => ({
        ...player,
        alive: true,
        role: null,
        messages: [],
        deathReason: null,
      }))
    : [];

  game = createGame();
  if (keepPlayers && previousSettings && previousSettings.targetPlayerCount >= existingPlayers.length) {
    game.settings = previousSettings;
  } else if (keepPlayers && existingPlayers.length > MIN_PLAYERS) {
    game.settings = createDefaultSettings(existingPlayers.length);
  }
  for (const player of existingPlayers) {
    game.players.set(player.id, player);
  }
}

function cloneSettings(settings) {
  if (!settings) {
    return null;
  }
  return {
    targetPlayerCount: settings.targetPlayerCount,
    roleCounts: { ...settings.roleCounts },
    updatedAt: settings.updatedAt,
  };
}

function serveStatic(rawPathname, res) {
  const pathname = rawPathname === '/' ? '/index.html' : decodeURIComponent(rawPathname);

  if (pathname.startsWith('/i18n/')) {
    const i18nFilePath = path.normalize(path.join(ROOT_DIR, pathname));
    if (i18nFilePath.startsWith(path.join(ROOT_DIR, 'i18n'))) {
      fs.readFile(i18nFilePath, (error, content) => {
        if (error) return sendJson(res, 404, { error: 'Không tìm thấy file.' });
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        return res.end(content);
      });
      return;
    }
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    return sendJson(res, 403, { error: 'Đường dẫn không hợp lệ.' });
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      return sendJson(res, 404, { error: 'Không tìm thấy file.' });
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
        reject(httpError(413, 'Payload quá lớn.'));
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
        reject(httpError(400, 'JSON không hợp lệ.'));
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

}

if (require.main === module) {
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || '0.0.0.0';
  const app = createWerewolvesApp();
  const server = http.createServer(app.requestListener);

  server.listen(port, host, () => {
    const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
    console.log(`Werewolves server is running at http://${shownHost}:${port}`);
    console.log(`Room code: ${app.roomCode}`);
  });
}

module.exports = {
  createWerewolvesApp,
};
