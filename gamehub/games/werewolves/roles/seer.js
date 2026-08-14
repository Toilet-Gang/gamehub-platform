'use strict';
const BaseRole = require('./role-base');
const { t } = require('../i18n');

class SeerRole extends BaseRole {
  constructor(options = {}) {
    super({
      id: 'tien-tri',
      nameKey: 'role_tien_tri_name',
      descKey: 'role_tien_tri_desc',
      group: 1,
      order: 5,
      feature: true,
    });
  }

  getNightCall(gameCtx) {
    return {
      key: 'seer',
      roleIds: [this.id],
      title: this.displayName,
      order: this.order,
      sourceIndex: 4,
      tts: t('tts_seer_wake'),
      prompt: t('prompt_seer'),
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

  processNightAction(actions, gameCtx, helpers) {
    for (const action of actions) {
      if (action.skip || !action.targetIds?.length) continue;
      const target = gameCtx.players.get(action.targetIds[0]);
      const isWolf = target?.role?.group === 2;
      const targetName = target?.name || 'mục tiêu';
      helpers.addPrivateMessage(
        action.actorId,
        isWolf
          ? t('msg_seer_is_wolf', { name: targetName })
          : t('msg_seer_not_wolf', { name: targetName })
      );
    }
  }
}

module.exports = SeerRole;
