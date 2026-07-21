'use strict';

const app = document.querySelector('#app');

const store = {
  games: [],
  room: null,
  knownRooms: loadKnownRooms(),
  playerName: localStorage.getItem('gamehub.playerName') || localStorage.getItem('werewolves.playerName') || '',
  error: '',
  info: '',
};

init();

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('form');
  if (!form) {
    return;
  }
  event.preventDefault();

  if (form.id === 'create-room-form') {
    const formData = new FormData(form);
    await runAction(async () => {
      const result = await apiPost('/api/rooms', {
        gameId: formData.get('gameId'),
      });
      rememberRoom(result.room.code, result.ownerToken);
      store.room = result.room;
      store.info = `Ma phong: ${result.room.code}`;
      render();
    });
  }

  if (form.id === 'join-room-form') {
    const formData = new FormData(form);
    const roomCode = String(formData.get('roomCode') || '').trim().toUpperCase();
    const playerName = String(formData.get('playerName') || '').trim();
    store.playerName = playerName;
    localStorage.setItem('gamehub.playerName', playerName);
    localStorage.setItem('werewolves.playerName', playerName);

    await runAction(async () => {
      const result = await apiGet(`/api/rooms/${encodeURIComponent(roomCode)}`);
      window.location.href = result.room.playUrl;
    });
  }
});

app.addEventListener('change', async (event) => {
  if (!event.target.matches('[data-action="change-game"]')) {
    return;
  }

  const gameId = event.target.value;
  if (!store.room?.isOwner || gameId === store.room.gameId) {
    return;
  }

  await runAction(async () => {
    const result = await apiPost(`/api/rooms/${store.room.code}/game`, {
      gameId,
      ownerToken: ownerTokenFor(store.room.code),
    });
    store.room = result.room;
    rememberRoom(result.room.code, ownerTokenFor(result.room.code));
  });
});

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) {
    return;
  }

  const action = button.dataset.action;

  if (action === 'open-room' && store.room) {
    window.location.href = store.room.playUrl;
  }

  if (action === 'copy-code' && store.room) {
    await copyText(store.room.code);
  }

  if (action === 'load-room') {
    await loadOwnedRoom(button.dataset.roomCode);
  }
});

async function init() {
  await runAction(async () => {
    const result = await apiGet('/api/games');
    store.games = result.games;
  });
}

async function loadOwnedRoom(roomCode) {
  const ownerToken = ownerTokenFor(roomCode);
  await runAction(async () => {
    const result = await apiGet(`/api/rooms/${encodeURIComponent(roomCode)}?ownerToken=${encodeURIComponent(ownerToken)}`);
    store.room = result.room;
  });
}

async function runAction(task) {
  store.error = '';
  store.info = '';
  render();
  try {
    await task();
    render();
  } catch (error) {
    store.error = error.message || 'Co loi xay ra.';
    render();
  }
}

async function apiGet(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Yeu cau that bai.');
  }
  return data;
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Yeu cau that bai.');
  }
  return data;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    store.info = 'Da copy ma phong.';
  } catch {
    store.info = text;
  }
  render();
}

function rememberRoom(code, ownerToken) {
  if (!code || !ownerToken) {
    return;
  }

  const nextRooms = [{ code, ownerToken, savedAt: Date.now() }, ...store.knownRooms.filter((room) => room.code !== code)].slice(0, 6);
  store.knownRooms = nextRooms;
  localStorage.setItem('gamehub.rooms', JSON.stringify(nextRooms));
  localStorage.setItem(`gamehub.ownerToken.${code}`, ownerToken);
}

function loadKnownRooms() {
  try {
    const rooms = JSON.parse(localStorage.getItem('gamehub.rooms') || '[]');
    return Array.isArray(rooms) ? rooms.filter((room) => room.code && room.ownerToken) : [];
  } catch {
    return [];
  }
}

function ownerTokenFor(roomCode) {
  return store.knownRooms.find((room) => room.code === roomCode)?.ownerToken || localStorage.getItem(`gamehub.ownerToken.${roomCode}`) || '';
}

function render() {
  app.innerHTML = `
    <header class="topbar">
      <div>
        <h1>GameHub</h1>
        <p>Phong cho chung cho nhieu game, moi phong co ma rieng va chu phong quan ly setting.</p>
      </div>
      ${renderNotice()}
    </header>
    <section class="layout">
      <section class="surface">
        ${renderCreateRoom()}
        ${renderJoinRoom()}
      </section>
      <section class="surface">
        ${renderRoomControl()}
      </section>
      <section class="surface">
        ${renderGameCatalog()}
        ${renderKnownRooms()}
      </section>
    </section>
  `;
}

function renderCreateRoom() {
  const readyGames = store.games.filter((game) => game.status === 'ready');
  return `
    <section class="panel">
      <div class="panel-title">
        <h2>Tao phong</h2>
      </div>
      <form id="create-room-form" class="stack">
        <label class="field">
          <span>Game</span>
          <select name="gameId">
            ${readyGames.map((game) => `<option value="${escapeAttr(game.id)}">${escapeHtml(game.name)}</option>`).join('')}
          </select>
        </label>
        <button class="button primary" type="submit">Tao ma phong</button>
      </form>
    </section>
  `;
}

function renderJoinRoom() {
  return `
    <section class="panel">
      <div class="panel-title">
        <h2>Vao phong</h2>
      </div>
      <form id="join-room-form" class="stack">
        <label class="field">
          <span>Ten hien thi</span>
          <input name="playerName" maxlength="40" autocomplete="nickname" value="${escapeAttr(store.playerName)}" />
        </label>
        <label class="field">
          <span>Ma phong</span>
          <input name="roomCode" maxlength="12" autocomplete="one-time-code" />
        </label>
        <button class="button" type="submit">Vao game</button>
      </form>
    </section>
  `;
}

function renderRoomControl() {
  if (!store.room) {
    return `
      <section class="empty-state">
        <h2>Chua chon phong</h2>
        <p>Tao phong moi hoac mo lai phong ban da tao tren may nay.</p>
      </section>
    `;
  }

  const readyGames = store.games.filter((game) => game.status === 'ready');

  return `
    <section class="room-focus">
      <div class="room-code">${escapeHtml(store.room.code)}</div>
      <div class="room-meta">
        <span class="tag">${escapeHtml(store.room.game.name)}</span>
        <span class="tag">${store.room.isOwner ? 'Chu phong' : 'Nguoi choi'}</span>
      </div>
      ${
        store.room.isOwner
          ? `<label class="field">
              <span>Doi game</span>
              <select data-action="change-game">
                ${readyGames
                  .map(
                    (game) => `
                      <option value="${escapeAttr(game.id)}" ${game.id === store.room.gameId ? 'selected' : ''}>${escapeHtml(game.name)}</option>
                    `,
                  )
                  .join('')}
              </select>
            </label>`
          : ''
      }
      <div class="action-row">
        <button class="button primary" type="button" data-action="open-room">Mo game</button>
        <button class="button secondary" type="button" data-action="copy-code">Copy ma</button>
      </div>
      <div class="score-panel">
        <h3>Diem theo game</h3>
        ${Object.values(store.room.scores || {})
          .map((score) => `<div class="score-row"><span>${escapeHtml(score.gameId)}</span><span>reset ${formatTime(score.resetAt)}</span></div>`)
          .join('')}
      </div>
    </section>
  `;
}

function renderGameCatalog() {
  return `
    <section class="panel">
      <div class="panel-title">
        <h2>Game</h2>
      </div>
      <div class="game-list">
        ${store.games
          .map(
            (game) => `
              <article class="game-row ${game.status}">
                <div>
                  <h3>${escapeHtml(game.name)}</h3>
                  <p>${escapeHtml(game.description)}</p>
                </div>
                <span class="tag">${escapeHtml(game.status)}</span>
              </article>
            `,
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderKnownRooms() {
  if (!store.knownRooms.length) {
    return '';
  }

  return `
    <section class="panel">
      <div class="panel-title">
        <h2>Phong cua ban</h2>
      </div>
      <div class="known-list">
        ${store.knownRooms
          .map(
            (room) => `
              <button class="known-room" type="button" data-action="load-room" data-room-code="${escapeAttr(room.code)}">
                <strong>${escapeHtml(room.code)}</strong>
                <span>${formatTime(room.savedAt)}</span>
              </button>
            `,
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderNotice() {
  if (store.error) {
    return `<div class="notice error">${escapeHtml(store.error)}</div>`;
  }
  if (store.info) {
    return `<div class="notice">${escapeHtml(store.info)}</div>`;
  }
  return '';
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char];
  });
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
