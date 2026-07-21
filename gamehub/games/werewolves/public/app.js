'use strict';

const app = document.querySelector('#app');
const TTS_MAX_CHARS = 180;
const routeParams = new URLSearchParams(window.location.search);
const routeRoomCode = (routeParams.get('roomCode') || routeParams.get('room') || '').trim().toUpperCase();
const routeOwnerToken = routeParams.get('ownerToken') || '';

const store = {
  playerId: localStorage.getItem('werewolves.playerId') || '',
  playerName: localStorage.getItem('werewolves.playerName') || '',
  roomCode: routeRoomCode || localStorage.getItem('werewolves.roomCode') || '',
  ownerToken: routeOwnerToken || (routeRoomCode ? localStorage.getItem(`gamehub.ownerToken.${routeRoomCode}`) || '' : ''),
  hostedByGameHub: window.location.pathname.startsWith('/games/'),
  state: null,
  error: '',
  info: '',
  selectedTargets: new Set(),
  currentActionKey: '',
  witchType: '',
  eventSource: null,
  ttsEnabled: localStorage.getItem('werewolves.tts') === '1',
  ttsQueue: [],
  ttsAudio: null,
  ttsPlaying: false,
  lastNarrationId: 0,
  now: Date.now(),
};

connectEvents();
refreshState();
setInterval(() => {
  store.now = Date.now();
  if (store.state?.phase === 'day') {
    render();
  }
}, 1000);

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('form');
  if (!form) {
    return;
  }

  event.preventDefault();

  if (form.id === 'join-form') {
    const input = form.querySelector('[name="name"]');
    const roomCodeInput = form.querySelector('[name="roomCode"]');
    store.playerName = input.value.trim();
    store.roomCode = roomCodeInput?.value.trim().toUpperCase() || store.roomCode;
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
      if (store.ownerToken && store.roomCode) {
        localStorage.setItem(`gamehub.ownerToken.${store.roomCode}`, store.ownerToken);
      }
      connectEvents();
      await refreshState();
    });
  }

  if (form.id === 'settings-form') {
    if (!canManageRoom()) {
      return;
    }

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

app.addEventListener('input', (event) => {
  if (event.target.matches('[name="name"]')) {
    store.playerName = event.target.value;
  }
  if (event.target.matches('[name="roomCode"]')) {
    store.roomCode = event.target.value.toUpperCase();
  }
});

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) {
    return;
  }

  const action = button.dataset.action;

  if (action === 'toggle-tts') {
    store.ttsEnabled = !store.ttsEnabled;
    localStorage.setItem('werewolves.tts', store.ttsEnabled ? '1' : '0');
    if (store.ttsEnabled) {
      speak('Đã bật đọc lời quản trò bằng giọng Google dịch tiếng Việt.');
    } else {
      stopTts();
    }
    render();
    return;
  }

  if (action === 'start-game') {
    if (!canManageRoom()) {
      return;
    }
    await runAction(() => apiPost('/api/start', {}));
    return;
  }

  if (action === 'reset-game') {
    if (!canManageRoom()) {
      return;
    }
    await runAction(() => apiPost('/api/reset', {}));
    return;
  }

  if (action === 'toggle-target') {
    toggleTarget(button.dataset.targetId, Number(button.dataset.maxTargets || 1));
    render();
    return;
  }

  if (action === 'choose-witch') {
    store.witchType = button.dataset.witchType || '';
    store.selectedTargets = new Set();
    render();
    return;
  }

  if (action === 'submit-night-action') {
    await submitNightAction();
    return;
  }

  if (action === 'skip-night-action') {
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
  }
});

async function submitNightAction() {
  const privateAction = store.state?.privateAction;
  if (!privateAction) {
    return;
  }

  const targetIds = [...store.selectedTargets];

  if (privateAction.mode === 'witch') {
    if (!store.witchType) {
      store.error = 'Chọn loại thuốc trước khi gửi.';
      render();
      return;
    }
    await runAction(() =>
      apiPost('/api/action', {
        playerId: store.playerId,
        action: {
          type: store.witchType,
          targetIds,
        },
      }),
    );
  } else {
    await runAction(() =>
      apiPost('/api/action', {
        playerId: store.playerId,
        action: { targetIds },
      }),
    );
  }

  clearSelection();
}

function toggleTarget(targetId, maxTargets) {
  if (!targetId) {
    return;
  }

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
  store.witchType = '';
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

async function refreshState() {
  const response = await fetch(apiUrl('/api/state', { playerId: store.playerId }));
  store.state = await response.json();
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
    syncActionKey();
    render();
  });

  events.addEventListener('narration', (event) => {
    const narration = JSON.parse(event.data);
    if (narration.id !== store.lastNarrationId) {
      store.lastNarrationId = narration.id;
      speak(narration.text);
    }
  });

  events.onerror = () => {
    store.info = 'Đang thử kết nối lại với server.';
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
  if (!store.ttsEnabled) {
    return;
  }

  store.ttsQueue.push(...splitTtsText(text));
  playNextTts();
}

function splitTtsText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  const chunks = [];
  const sentences = normalized.match(/[^.!?;:]+[.!?;:]?/g) || [normalized];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) {
      continue;
    }

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
    if (current) {
      chunks.push(current);
    }
  }

  return chunks;
}

function playNextTts() {
  if (store.ttsPlaying || !store.ttsEnabled) {
    return;
  }

  const text = store.ttsQueue.shift();
  if (!text) {
    return;
  }

  const audio = new Audio(apiUrl('/api/tts', { text }));
  store.ttsAudio = audio;
  store.ttsPlaying = true;
  let done = false;

  const finish = () => {
    if (done) {
      return;
    }
    done = true;
    if (store.ttsAudio === audio) {
      store.ttsAudio = null;
    }
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

function render() {
  if (!store.state) {
    app.innerHTML = '<div class="loading">Đang kết nối Quản Trò...</div>';
    return;
  }

  app.innerHTML = `
    ${renderTopbar()}
    <section class="layout">
      <aside class="sidebar">
        ${renderJoinPanel()}
        ${renderPlayersPanel()}
      </aside>
      <section class="main">
        ${renderMainPanel()}
      </section>
      <aside class="activity">
        ${renderPrivateMessages()}
        ${renderLogPanel()}
        ${renderRoleBook()}
      </aside>
    </section>
  `;
}

function renderTopbar() {
  const state = store.state;
  return `
    <header class="topbar">
      <div class="brand">
        <h1>Ma Sói</h1>
        <div class="phase-strip">
          <span class="pill teal">${phaseLabel(state.phase)}</span>
          <span class="pill">Vòng ${state.round || 0}</span>
          <span class="pill">${state.playerCount}/${state.settings?.targetPlayerCount || state.playerCount} người chơi</span>
          ${state.currentCall ? `<span class="pill red">Order ${state.currentCall.order}: ${escapeHtml(state.currentCall.title)}</span>` : ''}
        </div>
      </div>
      <div class="toolbar">
        <button class="button secondary" type="button" data-action="toggle-tts">${store.ttsEnabled ? 'Tắt TTS' : 'Bật TTS'}</button>
        <button class="button danger" type="button" data-action="reset-game">Ván mới</button>
      </div>
    </header>
  `;
}

function renderJoinPanel() {
  const self = store.state.self;
  const settings = store.state.settings;
  const canStart = canManageRoom() && store.state.phase === 'lobby' && settings?.readyToStart;
  const startHint = settings?.errors?.[0] || `Cần đúng ${settings?.targetPlayerCount || store.state.minPlayers} người để bắt đầu.`;

  return `
    <section class="panel">
      <div class="panel-title">
        <h2>${self ? 'Người chơi' : 'Vào phòng'}</h2>
      </div>
      <form id="join-form" class="join-form">
        <label class="field">
          <span>Tên hiển thị</span>
          <input name="name" maxlength="40" autocomplete="nickname" value="${escapeAttr(store.playerName || self?.name || '')}" />
        </label>
        ${
          self
            ? ''
            : `<label class="field">
                <span>Mã phòng</span>
                <input name="roomCode" maxlength="12" autocomplete="one-time-code" value="${escapeAttr(store.roomCode)}" />
              </label>`
        }
        <button class="button full" type="submit">${self ? 'Cập nhật tên' : 'Tham gia'}</button>
      </form>
      <div class="stack" style="margin-top: 10px">
        <button class="button teal full" type="button" data-action="start-game" ${canStart ? '' : 'disabled'}>Bắt đầu ván</button>
        <div class="small muted">${escapeHtml(startHint)}</div>
      </div>
      ${renderNotice()}
    </section>
  `;
}

function renderNotice() {
  if (store.error) {
    return `<div class="notice error small" style="margin-top: 10px">${escapeHtml(store.error)}</div>`;
  }
  if (store.info) {
    return `<div class="notice small" style="margin-top: 10px">${escapeHtml(store.info)}</div>`;
  }
  return '';
}

function canManageRoom() {
  return !store.hostedByGameHub || Boolean(store.ownerToken);
}

function renderPlayersPanel() {
  const players = store.state.players;
  return `
    <section class="panel">
      <div class="panel-title">
        <h3>Danh sách</h3>
        <span class="small muted">${players.filter((player) => player.alive).length} sống</span>
      </div>
      <div class="players">
        ${
          players.length
            ? players.map(renderPlayerCard).join('')
            : '<div class="small muted">Chưa có người chơi.</div>'
        }
      </div>
    </section>
  `;
}

function renderPlayerCard(player) {
  const roleTag = player.role ? `<span class="tag ${roleClass(player.role)}">${escapeHtml(player.role.displayName)}</span>` : '';
  return `
    <div class="player-card ${player.alive ? '' : 'dead'}">
      <div>
        <div class="player-name">${escapeHtml(player.name)}${player.isYou ? ' <span class="muted small">(bạn)</span>' : ''}</div>
        <div class="player-meta">
          <span class="tag ${player.alive ? 'live' : 'dead'}">${player.alive ? 'Sống' : 'Chết'}</span>
          ${roleTag}
          ${player.deathReason ? `<span class="tag">${escapeHtml(player.deathReason)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderMainPanel() {
  const state = store.state;
  if (state.phase === 'lobby') {
    return renderLobby();
  }
  if (state.phase === 'night') {
    return renderNight();
  }
  if (state.phase === 'day') {
    return renderDay();
  }
  if (state.phase === 'ended') {
    return renderEnded();
  }
  return '<section class="hero-status"><h2>Đang chờ Quản Trò</h2></section>';
}

function renderLobby() {
  const settings = store.state.settings;
  return `
    <section class="hero-status">
      <h2>Phòng chờ ván Ma Sói</h2>
      <p>Chọn số người và bộ vai trước khi bắt đầu. Server sẽ chia vai riêng cho từng client.</p>
      <div class="phase-strip">
        <span class="pill teal">${store.state.playerCount}/${settings?.targetPlayerCount || store.state.minPlayers} người</span>
        <span class="pill">${settings?.roleTotal || 0}/${settings?.targetPlayerCount || 0} vai</span>
        <span class="pill">TTS ${store.ttsEnabled ? 'đang bật' : 'đang tắt'}</span>
      </div>
    </section>
    ${renderRoleSetup()}
  `;
}

function renderRoleSetup() {
  const settings = store.state.settings;
  if (!settings) {
    return '';
  }
  if (!canManageRoom()) {
    return '';
  }

  const seatText =
    settings.remainingSeats > 0
      ? `Còn thiếu ${settings.remainingSeats} người`
      : settings.readyToStart
        ? 'Đã đủ người'
        : 'Kiểm tra lại cấu hình';

  return `
    <section class="action-surface">
      <form id="settings-form" class="role-setup-form">
        <div class="action-title">
          <h3>Cấu hình vai trò</h3>
          <span class="tag">${escapeHtml(seatText)}</span>
        </div>
        <div class="settings-head">
          <label class="field compact">
            <span>Số người chơi</span>
            <input
              name="targetPlayerCount"
              type="number"
              min="${settings.minPlayers}"
              max="${settings.maxPlayers}"
              value="${settings.targetPlayerCount}"
            />
          </label>
          <div class="setup-stats">
            <span class="tag role-village">Dân ${settings.groupTotals?.[1] || 0}</span>
            <span class="tag role-wolf">Sói ${settings.groupTotals?.[2] || 0}</span>
            <span class="tag role-third">Phe ba ${settings.groupTotals?.[3] || 0}</span>
            <span class="tag">${settings.roleTotal}/${settings.targetPlayerCount} vai</span>
          </div>
        </div>
        <div class="role-count-grid">
          ${store.state.roles
            .slice()
            .sort((a, b) => a.group - b.group || a.order - b.order || a.displayName.localeCompare(b.displayName, 'vi'))
            .map((role) => renderRoleCountRow(role, settings))
            .join('')}
        </div>
        ${renderSettingsErrors(settings)}
        <div class="action-row">
          <button class="button teal" type="submit">Lưu cấu hình</button>
        </div>
      </form>
    </section>
  `;
}

function renderRoleCountRow(role, settings) {
  return `
    <label class="role-count-row">
      <span>
        <strong>${escapeHtml(role.displayName)}</strong>
        <span class="tag ${roleClass(role)}">${escapeHtml(role.groupName)}</span>
      </span>
      <input
        name="role:${escapeAttr(role.id)}"
        type="number"
        min="0"
        max="${settings.targetPlayerCount}"
        value="${settings.roleCounts?.[role.id] || 0}"
      />
    </label>
  `;
}

function renderSettingsErrors(settings) {
  if (!settings.errors?.length) {
    return '';
  }

  return `
    <div class="settings-errors">
      ${settings.errors.map((error) => `<div class="notice error small">${escapeHtml(error)}</div>`).join('')}
    </div>
  `;
}

function renderNight() {
  const call = store.state.currentCall;
  return `
    <section class="hero-status">
      <h2>Đêm ${store.state.round}</h2>
      <p>${call ? escapeHtml(call.tts) : 'Quản trò đang xử lý kết quả ban đêm.'}</p>
      ${
        call
          ? `<div class="phase-strip">
              <span class="pill red">Order ${call.order}</span>
              <span class="pill">${escapeHtml(call.submittedCount)} / ${escapeHtml(call.expectedCount)} đã chọn</span>
            </div>`
          : ''
      }
    </section>
    ${renderSelfRole()}
    ${renderNightAction()}
  `;
}

function renderDay() {
  const day = store.state.day;
  return `
    <section class="hero-status">
      <h2>Ban ngày</h2>
      <p>Thảo luận còn <span class="countdown">${formatCountdown(day.discussionEndsAt - store.now)}</span>. Khi mọi người đã bỏ phiếu, server tự xử lý treo cổ.</p>
      <div class="phase-strip">
        <span class="pill teal">${day.votesSubmitted} / ${day.aliveCount} phiếu</span>
      </div>
    </section>
    ${renderSelfRole()}
    ${renderDayVote()}
  `;
}

function renderEnded() {
  const winner = store.state.winner;
  return `
    <section class="hero-status">
      <h2>${escapeHtml(winner?.name || 'Ván đã kết thúc')}</h2>
      <p>${escapeHtml(winner?.reason || '')}</p>
    </section>
    <section class="action-surface">
      <div class="action-title">
        <h3>Công bố vai trò</h3>
      </div>
      <div class="players">
        ${store.state.players.map(renderPlayerCard).join('')}
      </div>
    </section>
  `;
}

function renderSelfRole() {
  const self = store.state.self;
  if (!self?.role) {
    return '';
  }

  const wolfPack = self.wolfPack?.length
    ? `<div class="small"><strong>Đàn Sói:</strong> ${self.wolfPack
        .map((wolf) => `${escapeHtml(wolf.name)} (${escapeHtml(wolf.role)})`)
        .join(', ')}</div>`
    : '';

  const witchPotions = self.witchPotions
    ? `<div class="small"><strong>Thuốc:</strong> Cứu ${self.witchPotions.save ? 'còn' : 'đã dùng'}, Giết ${
        self.witchPotions.poison ? 'còn' : 'đã dùng'
      }</div>`
    : '';

  return `
    <section class="role-card">
      <div class="role-heading">
        <h3>${escapeHtml(self.role.displayName)}</h3>
        <span class="tag ${roleClass(self.role)}">${escapeHtml(self.role.groupName)}</span>
      </div>
      <div class="small muted">Order ${self.role.order}${self.role.feature ? ' · Có chức năng' : ''}</div>
      <p>${escapeHtml(self.role.description)}</p>
      ${wolfPack}
      ${self.inCult ? '<div class="small"><strong>Trạng thái:</strong> Thuộc Giáo phái</div>' : ''}
      ${witchPotions}
      ${self.alive ? '' : '<div class="notice small">Bạn đã chết và không thể tiếp tục gửi hành động.</div>'}
    </section>
  `;
}

function renderNightAction() {
  const action = store.state.privateAction;

  if (!store.state.self) {
    return `<section class="action-surface"><div class="muted">Vào phòng để nhận hành động từ Quản Trò.</div></section>`;
  }

  if (!store.state.self.alive) {
    return `<section class="action-surface"><div class="muted">Bạn đang quan sát ván chơi.</div></section>`;
  }

  if (!action) {
    return `<section class="action-surface"><div class="muted">Chưa tới lượt vai trò của bạn.</div></section>`;
  }

  if (action.submitted) {
    return `<section class="action-surface"><div class="notice small">Lựa chọn của bạn đã được gửi. Đang chờ các người chơi cùng lượt.</div></section>`;
  }

  if (action.mode === 'witch') {
    return renderWitchAction(action);
  }

  const selectedCount = store.selectedTargets.size;
  return `
    <section class="action-surface">
      <div class="action-title">
        <h3>${escapeHtml(action.title)}</h3>
        <span class="tag">Chọn ${action.minTargets === action.maxTargets ? action.maxTargets : `${action.minTargets}-${action.maxTargets}`}</span>
      </div>
      <div class="muted">${escapeHtml(action.prompt)}</div>
      ${renderTargetGrid(action.candidates, action.maxTargets)}
      <div class="action-row">
        <button class="button teal" type="button" data-action="submit-night-action" ${
          selectedCount >= action.minTargets && selectedCount <= action.maxTargets ? '' : 'disabled'
        }>Gửi lựa chọn</button>
        <button class="button secondary" type="button" data-action="skip-night-action">Bỏ qua</button>
      </div>
    </section>
  `;
}

function renderWitchAction(action) {
  const currentOption = action.options.find((option) => option.type === store.witchType);
  const canSubmit = currentOption && store.selectedTargets.size === 1;

  return `
    <section class="action-surface">
      <div class="action-title">
        <h3>${escapeHtml(action.title)}</h3>
        <span class="tag">Một hành động</span>
      </div>
      <div class="muted">${escapeHtml(action.prompt)}</div>
      <div class="option-row">
        ${action.options
          .map(
            (option) => `
              <button class="button ${store.witchType === option.type ? 'amber' : 'secondary'}" type="button" data-action="choose-witch" data-witch-type="${escapeAttr(option.type)}">
                ${escapeHtml(option.label)}
              </button>
            `,
          )
          .join('')}
      </div>
      ${currentOption ? renderTargetGrid(currentOption.candidates, 1) : '<div class="small muted">Chọn loại thuốc để hiện mục tiêu.</div>'}
      <div class="action-row">
        <button class="button teal" type="button" data-action="submit-night-action" ${canSubmit ? '' : 'disabled'}>Gửi lựa chọn</button>
        <button class="button secondary" type="button" data-action="skip-night-action">Bỏ qua</button>
      </div>
    </section>
  `;
}

function renderDayVote() {
  const day = store.state.day;
  if (!day?.canVote) {
    return `<section class="action-surface"><div class="muted">Bạn đang quan sát phần bỏ phiếu.</div></section>`;
  }
  if (day.submitted) {
    return `<section class="action-surface"><div class="notice small">Phiếu của bạn đã được ghi nhận.</div></section>`;
  }

  return `
    <section class="action-surface">
      <div class="action-title">
        <h3>Bỏ phiếu treo cổ</h3>
        <span class="tag">${day.votesSubmitted}/${day.aliveCount}</span>
      </div>
      ${renderTargetGrid(day.candidates, 1)}
      <div class="action-row">
        <button class="button danger" type="button" data-action="submit-day-vote" ${store.selectedTargets.size === 1 ? '' : 'disabled'}>Gửi phiếu</button>
        <button class="button secondary" type="button" data-action="skip-day-vote">Không treo ai</button>
      </div>
    </section>
  `;
}

function renderTargetGrid(candidates, maxTargets) {
  if (!candidates.length) {
    return '<div class="notice small">Không có mục tiêu hợp lệ.</div>';
  }

  return `
    <div class="target-grid">
      ${candidates
        .map((candidate) => {
          const active = store.selectedTargets.has(candidate.id);
          return `
            <button
              class="target-button ${active ? 'active' : ''}"
              type="button"
              data-action="toggle-target"
              data-target-id="${escapeAttr(candidate.id)}"
              data-max-targets="${maxTargets}"
              ${candidate.disabled ? 'disabled' : ''}
            >
              <strong>${escapeHtml(candidate.name)}</strong>
              ${candidate.reason ? `<div class="small">${escapeHtml(candidate.reason)}</div>` : ''}
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderPrivateMessages() {
  const messages = store.state.privateMessages || [];
  if (!messages.length) {
    return '';
  }

  return `
    <section class="panel">
      <div class="panel-title">
        <h3>Tin riêng</h3>
      </div>
      <div class="log-list">
        ${messages
          .slice()
          .reverse()
          .map(
            (item) => `
              <div class="log-item">
                <span class="small muted">${formatTime(item.time)}</span>
                <span>${escapeHtml(item.text)}</span>
              </div>
            `,
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderLogPanel() {
  const log = store.state.activityLog?.length ? store.state.activityLog : store.state.publicLog || [];
  return `
    <section class="panel">
      <div class="panel-title">
        <h3>Nhật ký</h3>
      </div>
      <div class="log-list">
        ${
          log.length
            ? log
                .slice()
                .reverse()
                .map(
                  (item) => `
                    <div class="log-item">
                      <span class="small muted">${formatTime(item.time)}</span>
                      <span>${escapeHtml(item.text)}</span>
                    </div>
                  `,
                )
                .join('')
            : '<div class="small muted">Chưa có sự kiện.</div>'
        }
      </div>
    </section>
  `;
}

function renderRoleBook() {
  return `
    <section class="panel">
      <div class="panel-title">
        <h3>Thứ tự gọi</h3>
      </div>
      <div class="book-list">
        ${store.state.roles
          .slice()
          .sort((a, b) => a.order - b.order)
          .map(
            (role) => `
              <div class="book-row">
                <strong>Order ${role.order}: ${escapeHtml(role.displayName)}</strong>
                <span class="tag ${roleClass(role)}">${escapeHtml(role.groupName)}</span>
              </div>
            `,
          )
          .join('')}
      </div>
    </section>
  `;
}

function roleClass(role) {
  if (role.group === 2) {
    return 'role-wolf';
  }
  if (role.group === 3) {
    return 'role-third';
  }
  return 'role-village';
}

function phaseLabel(phase) {
  const labels = {
    lobby: 'Phòng chờ',
    night: 'Ban đêm',
    day: 'Ban ngày',
    ended: 'Kết thúc',
  };
  return labels[phase] || phase;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function formatCountdown(ms) {
  const remaining = Math.max(0, ms);
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
