'use strict';

const app = document.querySelector('#app');
const TTS_MAX_CHARS = 180;
const routeParams = new URLSearchParams(window.location.search);
const routeRoomCode = (routeParams.get('roomCode') || routeParams.get('room') || '').trim().toUpperCase();
const routeOwnerToken = routeParams.get('ownerToken') || '';
const routeView = (routeParams.get('view') || routeParams.get('role') || '').trim().toLowerCase();

const store = {
  playerId: localStorage.getItem('werewolves.playerId') || '',
  playerName: localStorage.getItem('werewolves.playerName') || '',
  roomCode: routeRoomCode || (localStorage.getItem('werewolves.playerId') ? localStorage.getItem('werewolves.roomCode') || '' : ''),
  playerInputRoomCode: routeRoomCode || '',
  ownerToken: routeOwnerToken || (routeRoomCode ? localStorage.getItem(`gamehub.ownerToken.${routeRoomCode}`) || '' : ''),
  viewMode: routeView === 'host' ? 'host' : routeView === 'player' ? 'player' : localStorage.getItem('werewolves.viewMode') || '',
  roleFlipped: false,
  state: null,
  error: '',
  info: '',
  selectedTargets: new Set(),
  currentActionKey: '',
  witchType: '',
  eventSource: null,
  ttsEnabled: localStorage.getItem('werewolves.tts') !== '0', // Default enabled for auto host
  ttsQueue: [],
  ttsAudio: null,
  ttsPlaying: false,
  lastNarrationId: 0,
  now: Date.now(),
};

// Initial setup
if (!store.viewMode) {
  if (store.ownerToken) {
    store.viewMode = 'host';
  } else if (store.playerId) {
    store.viewMode = 'player';
  } else {
    store.viewMode = 'landing';
  }
}

connectEvents();
refreshState();

setInterval(() => {
  store.now = Date.now();
  if (store.state?.phase === 'day') {
    render();
  }
}, 1000);

// Global Event Listeners
app.addEventListener('submit', async (event) => {
  const form = event.target.closest('form');
  if (!form) return;

  event.preventDefault();

  if (form.id === 'join-form') {
    const input = form.querySelector('[name="name"]');
    const roomCodeInput = form.querySelector('[name="roomCode"]');
    store.playerName = input.value.trim();
    store.playerInputRoomCode = roomCodeInput?.value.trim().toUpperCase() || store.playerInputRoomCode;
    store.roomCode = store.playerInputRoomCode;
    store.viewMode = 'player';
    localStorage.setItem('werewolves.viewMode', 'player');

    await runAction(async () => {
      const result = await apiPost('/api/join', {
        name: store.playerName,
        roomCode: store.roomCode,
        playerId: store.playerId,
      });
      store.playerId = result.playerId;
      localStorage.setItem('werewolves.playerId', store.playerId);
      localStorage.setItem('werewolves.playerName', store.playerName);
      localStorage.setItem('werewolves.roomCode', store.roomCode);
      connectEvents();
      await refreshState();
    });
  }

  if (form.id === 'settings-form') {
    const formData = new FormData(form);
    const roleCounts = {};
    for (const role of store.state.roles) {
      roleCounts[role.id] = Number(formData.get(`role:${role.id}`) || 0);
    }

    await runAction(() =>
      apiPost('/api/settings', {
        targetPlayerCount: Number(formData.get('targetPlayerCount') || 0),
        roleCounts,
      }),
    );
  }
});

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');

  // Flip role card click
  const flipCard = event.target.closest('.role-card-flip');
  if (flipCard && !button) {
    store.roleFlipped = !store.roleFlipped;
    render();
    return;
  }

  if (!button || button.disabled) return;

  const action = button.dataset.action;

  if (action === 'select-view-mode') {
    store.viewMode = button.dataset.mode;
    localStorage.setItem('werewolves.viewMode', store.viewMode);
    render();
    return;
  }

  if (action === 'toggle-language') {
    setLanguage(getLanguage() === 'vi' ? 'en' : 'vi');
    render();
    return;
  }

  if (action === 'toggle-tts') {
    store.ttsEnabled = !store.ttsEnabled;
    localStorage.setItem('werewolves.tts', store.ttsEnabled ? '1' : '0');
    if (store.ttsEnabled) {
      speak('Đã bật đọc giọng Quản trò tự động.');
    } else {
      stopTts();
    }
    render();
    return;
  }

  if (action === 'start-game') {
    await runAction(() => apiPost('/api/start', {}));
    return;
  }

  if (action === 'leave-room') {
    if (confirm(t('confirmLeaveRoom'))) {
      await runAction(() => apiPost('/api/leave', { playerId: store.playerId }));
      localStorage.removeItem('werewolves.playerId');
      store.playerId = '';
      store.viewMode = 'landing';
      localStorage.setItem('werewolves.viewMode', 'landing');
      render();
    }
    return;
  }

  if (action === 'close-room') {
    if (confirm(t('confirmCloseRoom'))) {
      await runAction(() => apiPost('/api/close-room', {}));
      store.info = t('roomClosedInfo');
      render();
    }
    return;
  }

  if (action === 'skip-night-call') {
    await runAction(() => apiPost('/api/skip-call', {}));
    return;
  }

  if (action === 'force-resolve-day') {
    await runAction(() => apiPost('/api/force-resolve-day', {}));
    return;
  }

  if (action === 'reset-game') {
    await runAction(() => apiPost('/api/reset', {}));
    return;
  }

  if (action === 'toggle-target') {
    toggleTarget(button.dataset.targetId, Number(button.dataset.maxTargets || 1));
    render();
    return;
  }

  if (action === 'choose-action-option') {
    store.selectedOptionType = button.dataset.optionType || '';
    store.selectedTargets = new Set();
    render();
    return;
  }

  if (action === 'submit-night-action') {
    await submitNightAction();
    return;
  }

  if (action === 'skip-player-action') {
    await runAction(() =>
      apiPost('/api/action', {
        playerId: store.playerId,
        action: { skip: true },
      }),
    );
    clearSelection();
    return;
  }

  if (action === 'submit-day-vote') {
    const [targetId] = [...store.selectedTargets];
    await runAction(() =>
      apiPost('/api/action', {
        playerId: store.playerId,
        action: { targetId },
      }),
    );
    clearSelection();
    return;
  }

  if (action === 'skip-day-vote') {
    await runAction(() =>
      apiPost('/api/action', {
        playerId: store.playerId,
        action: { skip: true },
      }),
    );
    clearSelection();
    return;
  }
});

app.addEventListener('input', (event) => {
  if (event.target.matches('[name="name"]')) {
    store.playerName = event.target.value;
  }
  if (event.target.matches('[name="roomCode"]')) {
    store.playerInputRoomCode = event.target.value.toUpperCase();
  }
});

async function submitNightAction() {
  const privateAction = store.state?.privateAction;
  if (!privateAction) return;

  const targetIds = [...store.selectedTargets];
  const payloadAction = { targetIds };

  if (store.selectedOptionType) {
    payloadAction.type = store.selectedOptionType;
  }

  await runAction(() =>
    apiPost('/api/action', {
      playerId: store.playerId,
      action: payloadAction,
    }),
  );

  clearSelection();
}

function toggleTarget(targetId, maxTargets) {
  if (!targetId) return;

  if (store.selectedTargets.has(targetId)) {
    store.selectedTargets.delete(targetId);
    return;
  }

  if (maxTargets <= 1) {
    store.selectedTargets = new Set([targetId]);
    return;
  }

  if (store.selectedTargets.size >= maxTargets) {
    const [oldest] = store.selectedTargets;
    store.selectedTargets.delete(oldest);
  }
  store.selectedTargets.add(targetId);
}

function clearSelection() {
  store.selectedTargets = new Set();
  store.currentActionKey = '';
  store.selectedOptionType = '';
  render();
}

async function runAction(task) {
  store.error = '';
  store.info = '';
  render();

  try {
    await task();
    await refreshState();
  } catch (error) {
    store.error = error.message || 'Có lỗi xảy ra.';
    render();
  }
}

function apiUrl(path, params = {}) {
  const url = new URL(String(path).replace(/^\/+/, ''), document.baseURI);
  if (store.roomCode) {
    url.searchParams.set('roomCode', store.roomCode);
  }
  if (store.ownerToken) {
    url.searchParams.set('ownerToken', store.ownerToken);
  }
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
}

async function apiPost(path, body) {
  const payload = {
    ...body,
    roomCode: body.roomCode || store.roomCode,
    ownerToken: body.ownerToken || store.ownerToken,
  };
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Yêu cầu thất bại.');
  }
  return data;
}

function getDisplayRoomCode() {
  return store.state?.roomCode || store.state?.settings?.roomCode || store.roomCode || '';
}

async function refreshState() {
  const response = await fetch(apiUrl('/api/state', { playerId: store.playerId }));
  store.state = await response.json();
  if (store.state?.roomCode && (store.viewMode === 'host' || (store.playerId && store.state?.self))) {
    store.roomCode = store.state.roomCode;
  }
  syncActionKey();
  render();
}

function connectEvents() {
  if (store.eventSource) {
    store.eventSource.close();
  }

  const events = new EventSource(apiUrl('/events', { playerId: store.playerId }));
  store.eventSource = events;

  events.addEventListener('state', (event) => {
    store.state = JSON.parse(event.data);
    if (store.state?.roomCode && (store.viewMode === 'host' || (store.playerId && store.state?.self))) {
      store.roomCode = store.state.roomCode;
    }
    syncActionKey();
    render();
  });

  events.addEventListener('narration', (event) => {
    const narration = JSON.parse(event.data);
    if (narration.id !== store.lastNarrationId) {
      store.lastNarrationId = narration.id;
      // Only host machine plays TTS aloud automatically
      if (store.viewMode === 'host') {
        speak(narration.text);
      }
    }
  });

  events.onerror = () => {
    store.info = 'Đang kết nối lại với server...';
    render();
  };
}

function syncActionKey() {
  const privateAction = store.state?.privateAction;
  const day = store.state?.day;
  const key = privateAction
    ? `night:${privateAction.key}:${privateAction.submitted}`
    : day?.canVote
      ? `day:${day.submitted}`
      : '';

  if (key !== store.currentActionKey) {
    store.selectedTargets = new Set();
    store.witchType = '';
    store.currentActionKey = key;
  }
}

function speak(text) {
  if (!store.ttsEnabled) return;
  store.ttsQueue.push(...splitTtsText(text));
  playNextTts();
}

function splitTtsText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const chunks = [];
  const sentences = normalized.match(/[^.!?;:]+[.!?;:]?/g) || [normalized];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if (trimmed.length <= TTS_MAX_CHARS) {
      chunks.push(trimmed);
      continue;
    }

    let current = '';
    for (const word of trimmed.split(/\s+/)) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > TTS_MAX_CHARS && current) {
        chunks.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);
  }

  return chunks;
}

function playNextTts() {
  if (store.ttsPlaying || !store.ttsEnabled) return;

  const text = store.ttsQueue.shift();
  if (!text) return;

  const audio = new Audio(apiUrl('/api/tts', { text }));
  store.ttsAudio = audio;
  store.ttsPlaying = true;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    if (store.ttsAudio === audio) store.ttsAudio = null;
    store.ttsPlaying = false;
    playNextTts();
  };

  audio.addEventListener('ended', finish, { once: true });
  audio.addEventListener('error', finish, { once: true });
  audio.play().catch(finish);
}

function stopTts() {
  store.ttsQueue = [];
  store.ttsPlaying = false;
  if (store.ttsAudio) {
    store.ttsAudio.pause();
    store.ttsAudio.removeAttribute('src');
    store.ttsAudio.load();
    store.ttsAudio = null;
  }
}

// MAIN RENDER CONTROLLER
function render() {
  if (!store.state) {
    app.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <div>Đang kết nối Quản Trò...</div>
      </div>
    `;
    return;
  }

  if (store.viewMode === 'landing') {
    app.innerHTML = `
      ${renderTopbar()}
      <main class="main-container">
        ${renderLandingView()}
      </main>
    `;
    return;
  }

  if (store.viewMode === 'host') {
    app.innerHTML = `
      ${renderTopbar()}
      <main class="main-container">
        ${renderHostView()}
      </main>
    `;
    return;
  }

  // Player view default
  app.innerHTML = `
    ${renderTopbar()}
    <main class="main-container">
      ${renderPlayerView()}
    </main>
  `;
}

function renderTopbar() {
  const phase = store.state.phase;
  let phaseText = 'Phòng chờ';
  let phaseClass = 'amber';

  if (phase === 'night') {
    phaseText = `Đêm thứ ${store.state.round}`;
    phaseClass = 'red';
  } else if (phase === 'day') {
    phaseText = `Ban ngày thứ ${store.state.round}`;
    phaseClass = 'teal';
  } else if (phase === 'ended') {
    phaseText = 'Kết thúc ván';
    phaseClass = 'red';
  }

  const modeBadge = store.viewMode === 'host'
    ? `<span class="mode-badge host">Màn hình Host</span>`
    : store.viewMode === 'player'
      ? `<span class="mode-badge player">Máy người chơi</span>`
      : '';

  const aliveCount = store.state.players?.filter(p => p.alive).length || 0;
  const deadCount = store.state.players?.filter(p => !p.alive).length || 0;
  const showRoomCodePill = store.viewMode === 'host' || (store.playerId && store.state?.self);

  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-logo">
          <span class="brand-icon">🐺</span>
          <span>${t('gameTitle')}</span>
        </div>
        ${modeBadge}
        <div class="phase-strip">
          <span class="pill ${phaseClass}">${phaseText}</span>
          <span class="pill teal">❤️ ${t('alive')}: <strong>${aliveCount}</strong></span>
          <span class="pill red">💀 ${t('dead')}: <strong>${deadCount}</strong></span>
          ${showRoomCodePill ? `<span class="pill">${t('roomCode')}: <strong>${getDisplayRoomCode()}</strong></span>` : ''}
        </div>
      </div>

      <div class="toolbar">
        <button class="btn btn-sm btn-outline" data-action="toggle-language">
          🌐 ${getLanguage() === 'vi' ? 'English (EN)' : 'Tiếng Việt (VI)'}
        </button>
        ${store.viewMode === 'host' ? `
          <button class="btn btn-sm ${store.ttsEnabled ? 'btn-accent' : 'btn-outline'}" data-action="toggle-tts">
            ${store.ttsEnabled ? t('hostTTSOn') : t('hostTTSOff')}
          </button>
          <button class="btn btn-sm btn-primary" data-action="close-room">
            ${t('closeRoom')}
          </button>
        ` : store.viewMode === 'player' && store.playerId ? `
          <button class="btn btn-sm btn-outline" data-action="leave-room">
            ${t('leaveRoom')}
          </button>
        ` : ''}
        <button class="btn btn-sm btn-outline" data-action="select-view-mode" data-mode="landing">
          ${t('toggleView')}
        </button>
      </div>
    </header>
  `;
}

function renderLandingView() {
  return `
    <div class="landing-view">
      <div class="mode-card host-mode">
        <div class="mode-card-icon">📺</div>
        <h2>${t('hostModeTitle')}</h2>
        <p class="muted">${t('hostModeDesc')}</p>
        <button class="btn btn-primary" data-action="select-view-mode" data-mode="host">
          ${t('enterHostMode')}
        </button>
      </div>

      <div class="mode-card player-mode">
        <div class="mode-card-icon">📱</div>
        <h2>${t('playerModeTitle')}</h2>
        <p class="muted">${t('playerModeDesc')}</p>
        <button class="btn btn-accent" data-action="select-view-mode" data-mode="player">
          ${t('enterPlayerMode')}
        </button>
      </div>
    </div>
  `;
}

function renderHostView() {
  const phase = store.state.phase;

  if (phase === 'lobby') {
    return renderHostLobby();
  }

  if (phase === 'night' || phase === 'day') {
    return renderHostInGame();
  }

  if (phase === 'ended') {
    return renderHostEnded();
  }

  return '';
}

function renderHostLobby() {
  const settings = store.state.settings;
  const players = store.state.players;
  const targetCount = settings.targetPlayerCount;
  const joinedCount = players.length;

  return `
    <div class="host-dashboard">
      <aside class="panel">
        <div class="room-code-banner">
          <div class="room-code-label">MÃ PHÒNG CHO NGƯỜI CHƠI JOIN</div>
          <div class="room-code-display">${getDisplayRoomCode()}</div>
          <div class="room-url-subtext">Đã tham gia: <strong>${joinedCount} / ${targetCount}</strong> người</div>
        </div>

        <form id="settings-form" class="panel">
          <div class="panel-title">
            <h3>Cấu hình Ván chơi</h3>
          </div>

          <div class="field">
            <span>Số người chơi dự kiến (${settings.minPlayers} - ${settings.maxPlayers}):</span>
            <input class="input-field" type="number" name="targetPlayerCount" value="${targetCount}" min="${settings.minPlayers}" max="${settings.maxPlayers}" />
          </div>

          <div class="panel-title" style="margin-top: 12px;">
            <h3>Chọn số lượng Role trong game</h3>
            <span class="muted small">${settings.roleTotal}/${targetCount} vai</span>
          </div>

          <div class="stack" style="max-height: 260px; overflow-y: auto;">
            ${store.state.roles.map(role => `
              <div class="field" style="display: flex; align-items: center; justify-content: space-between;">
                <span>${role.displayName} (${role.groupName}):</span>
                <input class="input-field" style="width: 70px; text-align: center;" type="number" name="role:${role.id}" value="${settings.roleCounts[role.id] || 0}" min="0" max="${targetCount}" />
              </div>
            `).join('')}
          </div>

          <button class="btn btn-outline" type="submit" style="margin-top: 8px;">Lưu Cấu Hình</button>
        </form>

        <button class="btn btn-primary btn-lg" data-action="start-game" ${!settings.readyToStart ? 'disabled' : ''}>
          🎮 Bắt Đầu Ván & Chia Role Ngẫu Nhiên
        </button>
        ${settings.errors?.length ? `<div style="color: #fca5a5; font-size: 0.85rem;">⚠️ ${settings.errors[0]}</div>` : ''}

        <button class="btn btn-outline btn-sm" data-action="close-room" style="margin-top: 10px; border-color: rgba(220, 38, 38, 0.5); color: #fca5a5;">
          🔴 Giải Thể / Đóng Phòng Chơi
        </button>
      </aside>

      <main class="panel">
        <div class="panel-title">
          <h2>Danh sách Người chơi ở Phòng Chờ</h2>
          <span class="muted">${joinedCount} người đã vào</span>
        </div>

        <div class="player-grid">
          ${players.map(p => `
            <div class="player-badge">
              <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
              <div class="player-info">
                <div class="player-name">${p.name}</div>
                <div class="player-status">${p.connected ? '🟢 Đã kết nối' : '🔴 Mất kết nối'}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </main>
    </div>
  `;
}

function renderHostInGame() {
  const currentCall = store.state.currentCall;
  const isNight = store.state.phase === 'night';
  const dayState = store.state.day;

  return `
    <div class="host-dashboard">
      <aside class="panel">
        <div class="panel-title">
          <h2>Điều Khiển Quản Trò (Host)</h2>
        </div>

        ${isNight && currentCall ? `
          <div class="panel" style="background: rgba(220, 38, 38, 0.15); border-color: rgba(220, 38, 38, 0.4);">
            <div class="panel-title">
              <h3>Đang gọi: ${currentCall.title}</h3>
            </div>
            <p style="font-size: 0.9rem; color: #fde047; font-style: italic;">"${currentCall.tts}"</p>
            <div style="font-size: 0.85rem; margin-top: 8px;" class="muted">
              Đã nhận: ${currentCall.submittedCount} / ${currentCall.expectedCount} người
            </div>
            <button class="btn btn-accent btn-sm" data-action="skip-night-call" style="margin-top: 10px;">
              ⏩ Bỏ qua lượt đêm này (Host Override)
            </button>
          </div>
        ` : ''}

        ${!isNight && dayState ? `
          <div class="panel" style="background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.4);">
            <div class="panel-title">
              <h3>Ban ngày - Thảo luận & Bỏ phiếu</h3>
            </div>
            <p>Đã bỏ phiếu: ${dayState.votesSubmitted} / ${dayState.aliveCount} người</p>
            <button class="btn btn-primary btn-sm" data-action="force-resolve-day" style="margin-top: 10px;">
              ⚖️ Xử lý kết quả Bỏ phiếu ngay
            </button>
          </div>
        ` : ''}

        <button class="btn btn-outline btn-sm" data-action="reset-game" style="margin-top: 14px;">
          🔄 Tạo Ván Mới
        </button>
      </aside>

      <main class="panel">
        <div class="panel-title">
          <h2>📜 Nhật Ký Trò Chơi Công Khai</h2>
        </div>

        <div class="log-box">
          ${store.state.activityLog.map(item => `
            <div class="log-item public">
              <span>${item.text}</span>
            </div>
          `).join('')}
        </div>

        <div class="panel-title" style="margin-top: 16px;">
          <h3>Trạng thái Người chơi trong ván</h3>
        </div>
        <div class="player-grid">
          ${store.state.players.map(p => `
            <div class="player-badge" style="${!p.alive ? 'opacity: 0.4; filter: grayscale(1);' : ''}">
              <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
              <div class="player-info">
                <div class="player-name">${p.name}</div>
                <div class="player-status">${p.alive ? '❤️ Còn sống' : `💀 Chết (${p.deathReason || ''})`}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </main>
    </div>
  `;
}

function renderHostEnded() {
  const winner = store.state.winner;

  return `
    <div class="panel" style="max-width: 850px; margin: 20px auto; text-align: center;">
      <h1 style="font-size: 2.4rem; color: var(--amber); margin-bottom: 8px;">🏆 KẾT THÚC VÁN ĐẤU</h1>
      <h2 style="font-size: 1.6rem; color: var(--crimson);">${winner?.name || 'Ván chơi kết thúc'}</h2>
      <p class="muted" style="margin-bottom: 20px;">${winner?.reason || ''}</p>

      <div class="panel-title">
        <h3>BẢNG CÔNG KHAI VAI TRÒ TOÀN BỘ NGƯỜI CHƠI</h3>
      </div>

      <table class="end-table">
        <thead>
          <tr>
            <th>Tên người chơi</th>
            <th>Vai trò được chia</th>
            <th>Phe</th>
            <th>Trạng thái cuối</th>
          </tr>
        </thead>
        <tbody>
          ${store.state.players.map(p => `
            <tr>
              <td><strong>${p.name}</strong></td>
              <td>${p.role?.displayName || 'Chưa chia'}</td>
              <td>${p.role?.groupName || '-'}</td>
              <td>${p.alive ? '🟢 Còn sống' : `💀 ${p.deathReason || 'Đã chết'}`}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <button class="btn btn-primary btn-lg" data-action="reset-game" style="margin-top: 24px; width: 100%;">
        🔄 Bắt Đầu Ván Mới
      </button>
    </div>
  `;
}

function renderPlayerView() {
  if (!store.playerId || !store.state.self) {
    return renderPlayerJoinForm();
  }

  const phase = store.state.phase;

  if (phase === 'lobby') {
    return renderPlayerLobby();
  }

  if (phase === 'night' || phase === 'day') {
    return renderPlayerInGame();
  }

  if (phase === 'ended') {
    return renderPlayerEnded();
  }

  return '';
}

function renderPlayerJoinForm() {
  return `
    <div class="player-layout">
      <form id="join-form" class="panel">
        <div class="panel-title">
          <h2>Tham Gia Game Ma Sói</h2>
        </div>

        <div class="field">
          <span>Mã Phòng:</span>
          <input class="input-field" type="text" name="roomCode" value="${store.playerInputRoomCode}" placeholder="Nhập mã phòng hiển thị trên màn hình Host" required />
        </div>

        <div class="field">
          <span>Tên Người Chơi:</span>
          <input class="input-field" type="text" name="name" value="${store.playerName}" placeholder="Nhập biệt danh của bạn" required maxLength="40" />
        </div>

        ${store.error ? `<div style="color: #fca5a5; font-size: 0.9rem;">⚠️ ${store.error}</div>` : ''}

        <button class="btn btn-accent btn-lg" type="submit" style="margin-top: 10px;">
          🚀 Tham Gia Phòng Chờ
        </button>
      </form>
    </div>
  `;
}

function renderPlayerLobby() {
  const self = store.state.self;

  return `
    <div class="player-layout">
      <div class="panel" style="text-align: center;">
        <h2>Chào ${self.name}! 👋</h2>
        <p class="muted">Bạn đã ở trong phòng chờ. Vui lòng nhìn lên màn hình Host để xem thông báo bắt đầu.</p>
        <div class="pill amber" style="margin: 16px auto; display: inline-flex;">
          ⏳ Đang chờ Host chia vai trò ngẫu nhiên...
        </div>
        <div style="margin-top: 10px;">
          <button class="btn btn-outline btn-sm" data-action="leave-room">
            🚪 Thoát khỏi phòng này
          </button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h3>Người chơi trong phòng</h3>
          <span class="muted">${store.state.players.length} người</span>
        </div>
        <div class="player-grid">
          ${store.state.players.map(p => `
            <div class="player-badge">
              <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
              <div class="player-name">${p.name} ${p.isYou ? ' (Bạn)' : ''}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderPlayerInGame() {
  const self = store.state.self;
  const privateAction = store.state.privateAction;
  const dayState = store.state.day;
  const role = self?.role;

  return `
    <div class="player-layout">
      <!-- Flip Role Card -->
      <div class="role-card-container">
        <div class="role-card-flip ${store.roleFlipped ? 'flipped' : ''}">
          <div class="card-front">
            <h3 style="font-size: 1.4rem; color: var(--amber);">🎴 VAI TRÒ BÍ MẬT CỦA BẠN</h3>
            <p class="card-instruction">👆 Chạm vào thẻ để lật xem vai trò</p>
          </div>

          <div class="card-back">
            <h2 style="font-size: 1.6rem; color: var(--crimson);">${role?.displayName || 'Chưa chia'}</h2>
            <div class="pill teal" style="margin: 6px 0;">${role?.groupName || ''}</div>
            <p style="font-size: 0.88rem; color: var(--text-muted); margin-top: 8px;">${role?.description || ''}</p>
            ${self?.wolfPack ? `
              <div style="font-size: 0.85rem; color: #fca5a5; margin-top: 8px;">
                🐺 Đồng đội Sói: ${self.wolfPack.map(w => w.name).join(', ')}
              </div>
            ` : ''}
            <p class="card-instruction">👆 Chạm để ẩn vai trò</p>
          </div>
        </div>
      </div>

      <!-- Action Panel -->
      ${self?.alive && privateAction ? renderPlayerNightAction(privateAction) : ''}
      ${self?.alive && dayState && dayState.canVote ? renderPlayerDayVote(dayState) : ''}

      ${!self?.alive ? `
        <div class="panel" style="background: rgba(220, 38, 38, 0.2); border-color: var(--crimson);">
          <h3>💀 BẠN ĐÃ CHẾT</h3>
          <p class="muted">Bạn là linh hồn, giữ im lặng và quan sát diễn biến ván đấu.</p>
        </div>
      ` : ''}

      <!-- Personal Log -->
      <div class="panel">
        <div class="panel-title">
          <h3>📖 Nhật Ký Cá Nhân & Hoạt Động</h3>
        </div>
        <div class="log-box">
          ${store.state.privateMessages?.map(msg => `
            <div class="log-item private">
              <span>🔒 ${msg}</span>
            </div>
          `).join('')}
          ${store.state.activityLog?.map(item => `
            <div class="log-item public">
              <span>📢 ${item.text}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderPlayerNightAction(action) {
  if (action.submitted) {
    return `
      <div class="panel" style="background: rgba(16, 185, 129, 0.15);">
        <h3>✅ ĐÃ GỬI HÀNH ĐỘNG</h3>
        <p class="muted">Quản trò đã ghi nhận lựa chọn của bạn. Đang chờ các vai trò khác...</p>
      </div>
    `;
  }

  if (action.mode === 'witch') {
    return `
      <div class="panel">
        <h3>🧙‍♀️ ${action.title}</h3>
        <p class="muted">${action.prompt}</p>
        <div style="display: flex; gap: 8px; margin: 10px 0;">
          ${action.options.map(opt => `
            <button class="btn btn-sm ${store.witchType === opt.type ? 'btn-primary' : 'btn-outline'}" data-action="choose-witch" data-witch-type="${opt.type}">
              ${opt.label}
            </button>
          `).join('')}
        </div>

        ${store.witchType ? `
          <div class="target-selector-grid">
            ${action.options.find(o => o.type === store.witchType)?.candidates.map(c => `
              <div class="target-card ${store.selectedTargets.has(c.id) ? 'selected' : ''}" data-action="toggle-target" data-target-id="${c.id}" data-max-targets="1">
                ${c.name}
              </div>
            `).join('')}
          </div>
          <button class="btn btn-primary" data-action="submit-night-action" style="margin-top: 12px; width: 100%;">
            Xác Nhận Dùng Thuốc
          </button>
        ` : ''}

        <button class="btn btn-outline btn-sm" data-action="skip-player-action" style="margin-top: 8px; width: 100%;">
          Bỏ Qua Không Dùng Thuốc
        </button>
      </div>
    `;
  }

  return `
    <div class="panel">
      <h3>🌙 ${action.title}</h3>
      <p class="muted">${action.prompt}</p>

      <div class="target-selector-grid">
        ${action.candidates?.map(c => `
          <div class="target-card ${c.disabled ? 'disabled' : ''} ${store.selectedTargets.has(c.id) ? 'selected' : ''}" 
               data-action="${c.disabled ? '' : 'toggle-target'}" 
               data-target-id="${c.id}" 
               data-max-targets="${action.maxTargets}">
            <div>${c.name}</div>
            ${c.disabled ? `<div style="font-size: 0.75rem; color: #fca5a5;">${c.reason}</div>` : ''}
          </div>
        `).join('')}
      </div>

      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button class="btn btn-primary" data-action="submit-night-action" style="flex: 1;" ${store.selectedTargets.size < action.minTargets ? 'disabled' : ''}>
          Xác Nhận Hành Động
        </button>
        ${action.canSkip ? `
          <button class="btn btn-outline" data-action="skip-player-action">
            Bỏ Qua
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function renderPlayerDayVote(dayState) {
  if (dayState.submitted) {
    return `
      <div class="panel" style="background: rgba(16, 185, 129, 0.15);">
        <h3>✅ ĐÃ BỎ PHIẾU TREO CỔ</h3>
        <p class="muted">Đang chờ các thành viên còn lại bỏ phiếu...</p>
      </div>
    `;
  }

  return `
    <div class="panel">
      <h3>☀️ Bỏ Phiếu Treo Cổ Ban Ngày</h3>
      <p class="muted">Chọn một người bạn nghi ngờ là Ma Sói để bỏ phiếu treo cổ:</p>

      <div class="target-selector-grid">
        ${dayState.candidates.map(c => `
          <div class="target-card ${store.selectedTargets.has(c.id) ? 'selected' : ''}" data-action="toggle-target" data-target-id="${c.id}" data-max-targets="1">
            ${c.name}
          </div>
        `).join('')}
      </div>

      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button class="btn btn-primary" data-action="submit-day-vote" style="flex: 1;" ${store.selectedTargets.size === 0 ? 'disabled' : ''}>
          Bỏ Phiếu Treo Cổ
        </button>
        <button class="btn btn-outline" data-action="skip-day-vote">
          Bỏ Qua Phiếu
        </button>
      </div>
    </div>
  `;
}

function renderPlayerEnded() {
  const winner = store.state.winner;
  const self = store.state.self;

  return `
    <div class="player-layout">
      <div class="panel" style="text-align: center;">
        <h2 style="font-size: 1.8rem; color: var(--amber);">🏆 KẾT THÚC VÁN</h2>
        <h3 style="color: var(--crimson); margin-top: 6px;">${winner?.name || ''}</h3>
        <p class="muted">${winner?.reason || ''}</p>
        <div class="pill teal" style="margin-top: 12px; display: inline-flex;">
          Vai trò của bạn: ${self?.role?.displayName || ''}
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h3>Bảng tiết lộ vai trò tất cả người chơi</h3>
        </div>
        <table class="end-table">
          <thead>
            <tr>
              <th>Người chơi</th>
              <th>Vai trò</th>
              <th>Kết quả</th>
            </tr>
          </thead>
          <tbody>
            ${store.state.players.map(p => `
              <tr>
                <td>${p.name}</td>
                <td>${p.role?.displayName || '-'}</td>
                <td>${p.alive ? '🟢 Sống' : '💀 Chết'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
