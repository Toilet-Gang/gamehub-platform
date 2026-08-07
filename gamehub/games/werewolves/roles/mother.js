'use strict';
const BaseRole = require('./role-base');
const { t } = require('../i18n');

class MotherRole extends BaseRole {
  constructor(options = {}) {
    super({
      id: 'me-tre',
      nameKey: 'role_me_tre_name',
      descKey: 'role_me_tre_desc',
      group: 1,
      order: 2,
      feature: true,
    });
  }

  getNightCall(gameCtx) {
    if (gameCtx.round !== 1) return null;
    return {
      key: 'mother',
      roleIds: [this.id],
      title: this.displayName,
      order: this.order,
      sourceIndex: 1,
      tts: t('tts_mother_wake'),
      prompt: t('prompt_mother'),
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
      if (!gameCtx.motherBonds.has(action.actorId)) {
        gameCtx.motherBonds.set(action.actorId, action.targetIds[0]);
      }
    }
  }

  onDeath(deadPlayer, gameCtx, deathQueue) {
    const bondedId = gameCtx.motherBonds.get(deadPlayer.id);
    const bonded = bondedId ? gameCtx.players.get(bondedId) : null;
    if (bonded?.alive) {
      deathQueue.push(bonded.id);
    }
  }
}

module.exports = MotherRole;
