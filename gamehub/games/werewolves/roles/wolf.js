'use strict';
const BaseRole = require('./role-base');
const { t } = require('../i18n');

class WerewolfRole extends BaseRole {
  constructor(options = {}) {
    super({
      id: 'ma-soi',
      nameKey: 'role_ma_soi_name',
      descKey: 'role_ma_soi_desc',
      group: 2,
      order: 3,
      feature: false,
    });
  }

  getNightCall(gameCtx) {
    const extraKills = gameCtx.wolfExtraKills > 0;
    return {
      key: 'wolves',
      roleIds: ['ma-soi', 'soi-con'],
      title: t('group_2'),
      order: this.order,
      sourceIndex: 2,
      tts: extraKills ? t('tts_wolves_wake_cub') : t('tts_wolves_wake'),
      prompt: extraKills ? t('prompt_wolves_cub') : t('prompt_wolves'),
      minTargets: 1,
      maxTargets: extraKills ? 2 : 1,
    };
  }

  getCandidates(actorPlayer, gameCtx) {
    const alive = [...gameCtx.players.values()].filter(p => p.alive);
    return alive
      .filter(candidate => candidate.role?.group !== 2)
      .map(candidate => ({ id: candidate.id, name: candidate.name }));
  }

  processNightAction(actions, gameCtx, helpers) {
    const targetIds = actions.flatMap(action => action.targetIds);
    const selected = helpers.selectTopTargets(
      targetIds,
      gameCtx.night.wolfKillLimit,
      true
    );
    gameCtx.night.wolfAttackIds = selected;
    gameCtx.wolfExtraKills = 0;
  }
}

class WolfCubRole extends BaseRole {
  constructor(options = {}) {
    super({
      id: 'soi-con',
      nameKey: 'role_soi_con_name',
      descKey: 'role_soi_con_desc',
      group: 2,
      order: 3,
      feature: true,
    });
  }

  onDeath(deadPlayer, gameCtx) {
    gameCtx.wolfExtraKills = Math.max(gameCtx.wolfExtraKills, 1);
  }
}

module.exports = { WerewolfRole, WolfCubRole };
