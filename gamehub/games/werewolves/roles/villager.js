'use strict';
const BaseRole = require('./role-base');

class VillagerRole extends BaseRole {
  constructor(options = {}) {
    super({
      id: 'dan-lang',
      nameKey: 'role_dan_lang_name',
      descKey: 'role_dan_lang_desc',
      group: 1,
      order: 99,
      feature: false,
    });
  }
}

module.exports = VillagerRole;
