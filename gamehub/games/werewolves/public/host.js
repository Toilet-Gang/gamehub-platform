'use strict';

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
          <div class="room-code-label">${t('roomCodeLabel')}</div>
          <div class="room-code-display">${getDisplayRoomCode()}</div>
          <div class="room-url-subtext">${t('joinedCount', { count: joinedCount, total: targetCount })}</div>
        </div>

        <form id="settings-form" class="panel">
          <div class="panel-title">
            <h3>${t('configTitle')}</h3>
          </div>

          <div class="field">
            <span>${t('targetPlayerCount')} (${settings.minPlayers} - ${settings.maxPlayers}):</span>
            <input class="input-field" type="number" name="targetPlayerCount" value="${targetCount}" min="${settings.minPlayers}" max="${settings.maxPlayers}" />
          </div>

          <div class="panel-title" style="margin-top: 12px;">
            <h3>${t('selectRoles')}</h3>
            <span class="muted small">${settings.roleTotal}/${targetCount}</span>
          </div>

          <div class="stack" style="max-height: 260px; overflow-y: auto;">
            ${store.state.roles.map(role => `
              <div class="field" style="display: flex; align-items: center; justify-content: space-between;">
                <span>${getRoleTranslation(role)} (${getGroupTranslation(role.group)}):</span>
                <input class="input-field" style="width: 70px; text-align: center;" type="number" name="role:${role.id}" value="${settings.roleCounts[role.id] || 0}" min="0" max="${targetCount}" />
              </div>
            `).join('')}
          </div>

          <button class="btn btn-outline" type="submit" style="margin-top: 8px;">${t('saveConfig')}</button>
        </form>

        <button class="btn btn-primary btn-lg" data-action="start-game" ${!settings.readyToStart ? 'disabled' : ''}>
          ${t('startGame')}
        </button>
        ${store.error ? `<div style="color: #fca5a5; font-size: 0.85rem; margin-top: 8px; padding: 8px; background: rgba(220, 38, 38, 0.2); border-radius: 6px;">⚠️ ${store.error}</div>` : ''}
        ${settings.errors?.length ? `<div style="color: #fca5a5; font-size: 0.85rem; margin-top: 6px;">⚠️ ${settings.errors[0]}</div>` : ''}

        <button class="btn btn-outline btn-sm" data-action="close-room" style="margin-top: 10px; border-color: rgba(220, 38, 38, 0.5); color: #fca5a5;">
          ${t('closeRoom')}
        </button>
      </aside>

      <main class="panel">
        <div class="panel-title">
          <h2>${t('waitingPlayers')}</h2>
          <span class="muted">${joinedCount}</span>
        </div>

        <div class="player-grid">
          ${players.map(p => `
            <div class="player-badge">
              <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
              <div class="player-info">
                <div class="player-name">${p.name}</div>
                <div class="player-status">${p.connected ? '🟢' : '🔴'}</div>
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
          <h2>${t('hostControlTitle')}</h2>
        </div>

        ${isNight && currentCall ? `
          <div class="panel" style="background: rgba(220, 38, 38, 0.15); border-color: rgba(220, 38, 38, 0.4);">
            <div class="panel-title">
              <h3>${t('nightCalling', { title: currentCall.title })}</h3>
            </div>
            <p style="font-size: 0.9rem; color: #fde047; font-style: italic;">"${currentCall.tts}"</p>
            <div style="font-size: 0.85rem; margin-top: 8px;" class="muted">
              ${t('submittedCount', { submitted: currentCall.submittedCount, expected: currentCall.expectedCount })}
            </div>
            <button class="btn btn-accent btn-sm" data-action="skip-night-call" style="margin-top: 10px;">
              ${t('skipNightCallHost')}
            </button>
          </div>
        ` : ''}

        ${!isNight && dayState ? `
          <div class="panel" style="background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.4);">
            <div class="panel-title">
              <h3>${t('dayDiscussion')}</h3>
            </div>
            <p>${t('votesSubmitted', { submitted: dayState.votesSubmitted, alive: dayState.aliveCount })}</p>
            <button class="btn btn-primary btn-sm" data-action="force-resolve-day" style="margin-top: 10px;">
              ${t('forceResolveDay')}
            </button>
          </div>
        ` : ''}

        <button class="btn btn-outline btn-sm" data-action="reset-game" style="margin-top: 14px;">
          ${t('startNewGame')}
        </button>
      </aside>

      <main class="panel">
        <div class="panel-title">
          <h2>${t('publicLogTitle')}</h2>
        </div>

        <div class="log-box">
          ${store.state.activityLog.map(item => `
            <div class="log-item public">
              <span>${item.text}</span>
            </div>
          `).join('')}
        </div>

        <div class="panel-title" style="margin-top: 16px;">
          <h3>${t('playerStatusInGame')}</h3>
        </div>
        <div class="player-grid">
          ${store.state.players.map(p => `
            <div class="player-badge" style="${!p.alive ? 'opacity: 0.4; filter: grayscale(1);' : ''}">
              <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
              <div class="player-info">
                <div class="player-name">${p.name}</div>
                <div class="player-status">${p.alive ? '❤️ ' + t('alive') : '💀 ' + t('dead')}</div>
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
      <h1 style="font-size: 2.4rem; color: var(--amber); margin-bottom: 8px;">${t('winnerTitle')}</h1>
      <h2 style="font-size: 1.6rem; color: var(--crimson);">${winner?.name || ''}</h2>
      <p class="muted" style="margin-bottom: 20px;">${winner?.reason || ''}</p>

      <div class="panel-title">
        <h3>${t('fullRoleTable')}</h3>
      </div>

      <table class="end-table">
        <thead>
          <tr>
            <th>${t('playerName')}</th>
            <th>${t('roleAssigned')}</th>
            <th>${t('faction')}</th>
            <th>${t('status')}</th>
          </tr>
        </thead>
        <tbody>
          ${store.state.players.map(p => `
            <tr>
              <td><strong>${p.name}</strong></td>
              <td>${getRoleTranslation(p.role)}</td>
              <td>${getGroupTranslation(p.role?.group)}</td>
              <td>${p.alive ? '🟢 ' + t('alive') : '💀 ' + t('dead')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <button class="btn btn-primary btn-lg" data-action="reset-game" style="margin-top: 24px; width: 100%;">
        ${t('startNewGame')}
      </button>
    </div>
  `;
}

if (typeof window !== 'undefined') {
  window.renderHostView = renderHostView;
}
