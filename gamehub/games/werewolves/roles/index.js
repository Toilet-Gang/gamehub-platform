'use strict';

const BaseRole = require('./role-base');
const VillagerRole = require('./villager');
const { WerewolfRole, WolfCubRole } = require('./wolf');
const GuardRole = require('./guard');
const MotherRole = require('./mother');
const CultLeaderRole = require('./cult');
const SeerRole = require('./seer');
const PsychologistRole = require('./psychologist');
const HunterRole = require('./hunter');
const WitchRole = require('./witch');

const roleInstances = [
  new GuardRole(),
  new MotherRole(),
  new WerewolfRole(),
  new WolfCubRole(),
  new CultLeaderRole(),
  new SeerRole(),
  new PsychologistRole(),
  new HunterRole(),
  new WitchRole(),
  new VillagerRole(),
];

const roleMap = new Map(roleInstances.map(role => [role.id, role]));

const roleCatalog = roleInstances.map((role, index) => {
  const serialized = role.serialize();
  serialized.sourceIndex = index;
  return serialized;
});

function getRoleById(id) {
  return roleMap.get(id) || null;
}

// OOP Night Call Builder
function buildNightCalls(gameCtx) {
  const calls = [];
  for (const role of roleInstances) {
    const call = role.getNightCall(gameCtx);
    if (call) {
      calls.push(call);
    }
  }
  return calls.sort((a, b) => a.order - b.order || a.sourceIndex - b.sourceIndex);
}

// OOP Night Action Processor
function processNightCall(call, actions, gameCtx, helpers) {
  for (const roleId of call.roleIds) {
    const role = getRoleById(roleId);
    if (role && typeof role.processNightAction === 'function') {
      role.processNightAction(actions, gameCtx, helpers);
    }
  }
}

// OOP Death Hooks Trigger
function triggerDeathHooks(deadPlayer, gameCtx, deathQueue) {
  if (!deadPlayer.role) return;
  const role = getRoleById(deadPlayer.role.id);
  if (role && typeof role.onDeath === 'function') {
    role.onDeath(deadPlayer, gameCtx, deathQueue);
  }
}

module.exports = {
  BaseRole,
  VillagerRole,
  WerewolfRole,
  WolfCubRole,
  GuardRole,
  MotherRole,
  CultLeaderRole,
  SeerRole,
  PsychologistRole,
  HunterRole,
  WitchRole,
  roleInstances,
  roleMap,
  roleCatalog,
  getRoleById,
  buildNightCalls,
  processNightCall,
  triggerDeathHooks,
};
