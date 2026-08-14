'use strict';
const BaseRole = require('./role-base');
const { t } = require('../i18n');

class PsychologistRole extends BaseRole {
  constructor(options = {}) {
    super({
      id: 'nha-tam-than-hoc',
      nameKey: 'role_nha_tam_than_hoc_name',
      descKey: 'role_nha_tam_than_hoc_desc',
      group: 1,
      order: 6,
      feature: true,
    });
  }

  getNightCall(gameCtx) {
    return {
      key: 'psychologist',
      roleIds: [this.id],
      title: this.displayName,
      order: this.order,
      sourceIndex: 5,
      tts: t('tts_psychologist_wake'),
      prompt: t('prompt_psychologist'),
      minTargets: 2,
      maxTargets: 2,
    };
  }

  getCandidates(actorPlayer, gameCtx) {
    const alive = [...gameCtx.players.values()].filter(p => p.alive);
    return alive.map(candidate => ({ id: candidate.id, name: candidate.name }));
  }

  processNightAction(actions, gameCtx, helpers) {
    for (const action of actions) {
      if (action.skip || action.targetIds?.length < 2) continue;
      const [firstId, secondId] = action.targetIds;
      const first = gameCtx.players.get(firstId);
      const second = gameCtx.players.get(secondId);
      const sameGroup = first?.role?.group === second?.role?.group;
      const firstName = first?.name || 'Người 1';
      const secondName = second?.name || 'Người 2';
      helpers.addPrivateMessage(
        action.actorId,
        sameGroup
          ? t('msg_psychologist_same', { first: firstName, second: secondName })
          : t('msg_psychologist_diff', { first: firstName, second: secondName })
      );
    }
  }
}

module.exports = PsychologistRole;
