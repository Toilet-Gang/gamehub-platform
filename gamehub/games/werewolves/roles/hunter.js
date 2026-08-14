'use strict';
const BaseRole = require('./role-base');
const { t } = require('../i18n');

class HunterRole extends BaseRole {
  constructor(options = {}) {
    super({
      id: 'tho-san',
      nameKey: 'role_tho_san_name',
      descKey: 'role_tho_san_desc',
      group: 1,
      order: 7,
      feature: true,
    });
  }

  getNightCall(gameCtx) {
    return {
      key: 'tho-san',
      roleIds: [this.id],
      title: this.displayName,
      order: this.order,
      sourceIndex: 6,
      tts: t('tts_hunter_wake'),
      prompt: t('prompt_hunter'),
      minTargets: 1,
      maxTargets: 1,
    };
  }

  getCandidates(actorPlayer, gameCtx) {
    const alive = [...gameCtx.players.values()].filter(p => p.alive);
    return alive
      .filter(candidate => candidate.id !== actorPlayer.id)
      .map(candidate => ({ id: candidate.id, name: candidate.name }));
  }

  processNightAction(actions, gameCtx) {
    for (const action of actions) {
      if (action.skip || !action.targetIds?.length) continue;
      gameCtx.hunterTargets.set(action.actorId, action.targetIds[0]);
    }
  }

  onDeath(deadPlayer, gameCtx, deathQueue) {
    const targetId = gameCtx.hunterTargets.get(deadPlayer.id);
    const target = targetId ? gameCtx.players.get(targetId) : null;
    if (target?.alive) {
      deathQueue.push(target.id);
    }
  }
}

module.exports = HunterRole;
