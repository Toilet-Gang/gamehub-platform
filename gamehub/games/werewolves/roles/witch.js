'use strict';
const BaseRole = require('./role-base');
const { t } = require('../i18n');

class WitchRole extends BaseRole {
  constructor(options = {}) {
    super({
      id: 'phu-thuy',
      nameKey: 'role_phu_thuy_name',
      descKey: 'role_phu_thuy_desc',
      group: 1,
      order: 8,
      feature: true,
    });
  }

  getNightCall(gameCtx) {
    return {
      key: 'witch',
      roleIds: [this.id],
      title: this.displayName,
      order: this.order,
      sourceIndex: 7,
      tts: t('tts_witch_wake'),
      prompt: t('prompt_witch'),
      minTargets: 0,
      maxTargets: 1,
    };
  }

  getCandidates(actorPlayer, gameCtx, callKey) {
    const potions = gameCtx.witchPotions.get(actorPlayer.id);
    if (!potions) return [];

    const alive = [...gameCtx.players.values()].filter(p => p.alive);
    const options = [];

    if (potions.save) {
      const candidates = gameCtx.night.wolfAttackIds
        .map(targetId => gameCtx.players.get(targetId))
        .filter(target => target?.alive)
        .map(target => ({ id: target.id, name: target.name }));

      if (candidates.length) {
        options.push({ type: 'save', label: t('witchPotionSave'), candidates });
      }
    }

    if (potions.poison) {
      const candidates = alive
        .filter(target => target.id !== actorPlayer.id)
        .map(target => ({ id: target.id, name: target.name }));

      if (candidates.length) {
        options.push({ type: 'poison', label: t('witchPotionPoison'), candidates });
      }
    }

    return options;
  }

  processNightAction(actions, gameCtx) {
    for (const action of actions) {
      if (action.skip || !action.targetIds?.length) continue;
      const potions = gameCtx.witchPotions.get(action.actorId);
      if (!potions) continue;

      const targetId = action.targetIds[0];
      if (action.type === 'save' && potions.save) {
        gameCtx.night.savedByWitchIds.add(targetId);
        potions.save = false;
      }
      if (action.type === 'poison' && potions.poison) {
        gameCtx.night.poisonedIds.add(targetId);
        potions.poison = false;
      }
    }
  }
}

module.exports = WitchRole;
