'use strict';
const BaseRole = require('./role-base');
const { t } = require('../i18n');

class CultLeaderRole extends BaseRole {
  constructor(options = {}) {
    super({
      id: 'truong-giao-phai',
      nameKey: 'role_truong_giao_phai_name',
      descKey: 'role_truong_giao_phai_desc',
      group: 3,
      order: 4,
      feature: true,
    });
  }

  getNightCall(gameCtx) {
    return {
      key: 'cult',
      roleIds: [this.id],
      title: this.displayName,
      order: this.order,
      sourceIndex: 3,
      tts: t('tts_cult_wake'),
      prompt: t('prompt_cult'),
      minTargets: 1,
      maxTargets: 1,
    };
  }

  getCandidates(actorPlayer, gameCtx) {
    const alive = [...gameCtx.players.values()].filter(p => p.alive);
    return alive
      .filter(candidate => candidate.id !== actorPlayer.id)
      .map(candidate => ({
        id: candidate.id,
        name: candidate.name,
        disabled: gameCtx.cultMembers.has(candidate.id),
        reason: gameCtx.cultMembers.has(candidate.id) ? t('reason_already_in_cult') : '',
      }));
  }

  processNightAction(actions, gameCtx) {
    for (const action of actions) {
      if (action.skip || !action.targetIds?.length) continue;
      const target = gameCtx.players.get(action.targetIds[0]);
      if (target) {
        gameCtx.cultMembers.add(target.id);
      }
    }
  }
}

module.exports = CultLeaderRole;
