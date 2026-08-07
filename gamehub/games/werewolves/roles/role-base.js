'use strict';
const { t } = require('../i18n');

class BaseRole {
  constructor(options = {}) {
    this.id = options.id || '';
    this.nameKey = options.nameKey || '';
    this.descKey = options.descKey || '';
    this.group = options.group || 1; // 1: Villager, 2: Werewolf, 3: Third Party
    this.order = options.order || 99;
    this.feature = Boolean(options.feature);
  }

  get name() {
    return t(this.nameKey);
  }

  get displayName() {
    return t(this.nameKey);
  }

  get description() {
    return t(this.descKey);
  }

  get groupName() {
    return t(`group_${this.group}`);
  }

  // Returns night call metadata object for this role
  getNightCall(gameCtx) {
    return null;
  }

  // Returns candidate targets for action
  getCandidates(actorPlayer, gameCtx, callKey) {
    return [];
  }

  // Processes night action effect for this role
  processNightAction(actions, gameCtx, helpers) {
    // Override in subclass
  }

  // Passive death hook triggered when a player with this role dies
  onDeath(deadPlayer, gameCtx, deathQueue) {
    // Override in subclass
  }

  serialize(lang = null) {
    return {
      id: this.id,
      name: t(this.nameKey, {}, lang),
      displayName: t(this.nameKey, {}, lang),
      description: t(this.descKey, {}, lang),
      group: this.group,
      groupName: t(`group_${this.group}`, {}, lang),
      order: this.order,
      feature: this.feature,
    };
  }
}

module.exports = BaseRole;
