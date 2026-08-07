'use strict';
const BaseRole = require('./role-base');
const { t } = require('../i18n');

class GuardRole extends BaseRole {
  constructor(options = {}) {
    super({
      id: 'bao-ve',
      nameKey: 'role_bao_ve_name',
      descKey: 'role_bao_ve_desc',
      group: 1,
      order: 1,
      feature: true,
    });
  }

  getNightCall(gameCtx) {
    return {
      key: 'guard',
      roleIds: [this.id],
      title: this.displayName,
      order: this.order,
      sourceIndex: 0,
      tts: t('tts_guard_wake'),
      prompt: t('prompt_guard'),
      minTargets: 1,
      maxTargets: 1,
    };
  }

  getCandidates(actorPlayer, gameCtx) {
    const alive = [...gameCtx.players.values()].filter(p => p.alive);
    const lastTarget = gameCtx.guardLastTargets.get(actorPlayer.id);
    return alive.map(candidate => ({
      id: candidate.id,
      name: candidate.name,
      disabled: candidate.id === lastTarget,
      reason: candidate.id === lastTarget ? t('reason_guard_last_night') : '',
    }));
  }

  processNightAction(actions, gameCtx) {
    for (const action of actions) {
      if (action.skip || !action.targetIds?.length) continue;
      const targetId = action.targetIds[0];
      gameCtx.night.protectedIds.add(targetId);
      gameCtx.guardLastTargets.set(action.actorId, targetId);
    }
  }
}

module.exports = GuardRole;
