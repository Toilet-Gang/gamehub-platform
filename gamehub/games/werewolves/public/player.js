'use strict';

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
          <h2>${t('joinFormTitle')}</h2>
        </div>

        <div class="field">
          <span>${t('enterRoomCode')}</span>
          <input class="input-field" type="text" name="roomCode" value="${store.playerInputRoomCode}" placeholder="${t('roomCodePlaceholder')}" required />
        </div>

        <div class="field">
          <span>${t('enterName')}</span>
          <input class="input-field" type="text" name="name" value="${store.playerName}" placeholder="${t('namePlaceholder')}" required maxLength="40" />
        </div>

        ${store.error ? `<div style="color: #fca5a5; font-size: 0.9rem;">⚠️ ${store.error}</div>` : ''}

        <button class="btn btn-accent btn-lg" type="submit" style="margin-top: 10px;">
          ${t('joinLobby')}
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
        <h2>${t('player_welcome', { name: self.name })}</h2>
        <p class="muted">${t('player_in_lobby_desc')}</p>
        <div class="pill amber" style="margin: 16px auto; display: inline-flex;">
          ${t('waiting_host_role_assignment')}
        </div>
        <div style="margin-top: 10px;">
          <button class="btn btn-outline btn-sm" data-action="leave-room">
            ${t('leaveRoom')}
          </button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h3>${t('waitingPlayers')}</h3>
          <span class="muted">${store.state.players.length}</span>
        </div>
        <div class="player-grid">
          ${store.state.players.map(p => `
            <div class="player-badge">
              <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
              <div class="player-name">${p.name} ${p.isYou ? ' ' + t('you_tag') : ''}</div>
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
            <h3 style="font-size: 1.3rem; color: var(--amber);">${t('secretRoleTitle')}</h3>
            <p class="card-instruction">${t('tapToFlip')}</p>
          </div>

          <div class="card-back">
            <h2 style="font-size: 1.5rem; color: var(--crimson);">${role?.displayName || ''}</h2>
            <div class="pill teal" style="margin: 6px 0;">${role?.groupName || ''}</div>
            <p style="font-size: 0.88rem; color: var(--text-muted); margin-top: 8px;">${role?.description || ''}</p>
            ${self?.wolfPack ? `
              <div style="font-size: 0.85rem; color: #fca5a5; margin-top: 8px;">
                ${t('wolf_teammates', { names: self.wolfPack.map(w => w.name).join(', ') })}
              </div>
            ` : ''}
            <p class="card-instruction">${t('tapToHide')}</p>
          </div>
        </div>
      </div>

      <!-- Action Panel -->
      ${self?.alive && privateAction ? renderPlayerNightAction(privateAction) : ''}
      ${self?.alive && dayState && dayState.canVote ? renderPlayerDayVote(dayState) : ''}

      ${!self?.alive ? `
        <div class="panel" style="background: rgba(220, 38, 38, 0.2); border-color: var(--crimson);">
          <h3>${t('deadMessage')}</h3>
          <p class="muted">${t('spiritMessage')}</p>
        </div>
      ` : ''}

      <!-- Personal Log -->
      <div class="panel">
        <div class="panel-title">
          <h3>${t('personalLogTitle')}</h3>
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
        <h3>${t('submitted_action_title')}</h3>
        <p class="muted">${t('submitted_action_desc')}</p>
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
            <button class="btn btn-sm ${store.selectedOptionType === opt.type ? 'btn-primary' : 'btn-outline'}" data-action="choose-action-option" data-option-type="${opt.type}">
              ${opt.label}
            </button>
          `).join('')}
        </div>

        ${store.selectedOptionType ? `
          <div class="target-selector-grid">
            ${action.options.find(o => o.type === store.selectedOptionType)?.candidates.map(c => `
              <div class="target-card ${store.selectedTargets.has(c.id) ? 'selected' : ''}" data-action="toggle-target" data-target-id="${c.id}" data-max-targets="1">
                ${c.name}
              </div>
            `).join('')}
          </div>
          <button class="btn btn-primary" data-action="submit-night-action" style="margin-top: 12px; width: 100%;">
            ${t('confirmWitch')}
          </button>
        ` : ''}

        <button class="btn btn-outline btn-sm" data-action="skip-player-action" style="margin-top: 8px; width: 100%;">
          ${t('skipWitch')}
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
          ${t('confirmAction')}
        </button>
        ${action.canSkip ? `
          <button class="btn btn-outline" data-action="skip-player-action">
            ${t('skipAction')}
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
        <h3>${t('submitted_vote_title')}</h3>
        <p class="muted">${t('submitted_vote_desc')}</p>
      </div>
    `;
  }

  return `
    <div class="panel">
      <h3>${t('day_voting_title')}</h3>
      <p class="muted">${t('day_voting_desc')}</p>

      <div class="target-selector-grid">
        ${dayState.candidates.map(c => `
          <div class="target-card ${store.selectedTargets.has(c.id) ? 'selected' : ''}" data-action="toggle-target" data-target-id="${c.id}" data-max-targets="1">
            ${c.name}
          </div>
        `).join('')}
      </div>

      <div style="display: flex; gap: 8px; margin-top: 12px;">
        <button class="btn btn-primary" data-action="submit-day-vote" style="flex: 1;" ${store.selectedTargets.size === 0 ? 'disabled' : ''}>
          ${t('voteLynch')}
        </button>
        <button class="btn btn-outline" data-action="skip-day-vote">
          ${t('skipLynch')}
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
        <h2 style="font-size: 1.8rem; color: var(--amber);">${t('winnerTitle')}</h2>
        <h3 style="color: var(--crimson); margin-top: 6px;">${winner?.name || ''}</h3>
        <p class="muted">${winner?.reason || ''}</p>
        <div class="pill teal" style="margin-top: 12px; display: inline-flex;">
          ${t('roleAssigned')}: ${self?.role?.displayName || ''}
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h3>${t('fullRoleTable')}</h3>
        </div>
        <table class="end-table">
          <thead>
            <tr>
              <th>${t('playerName')}</th>
              <th>${t('roleAssigned')}</th>
              <th>${t('status')}</th>
            </tr>
          </thead>
          <tbody>
            ${store.state.players.map(p => `
              <tr>
                <td>${p.name}</td>
                <td>${p.role?.displayName || '-'}</td>
                <td>${p.alive ? '🟢 ' + t('alive') : '💀 ' + t('dead')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

if (typeof window !== 'undefined') {
  window.renderPlayerView = renderPlayerView;
}
