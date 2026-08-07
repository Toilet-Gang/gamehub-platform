import { BaseRole } from './BaseRole.js';
import { VillagerRole } from './VillagerRole.js';
import { WerewolfRole, WolfCubRole } from './WerewolfRole.js';
import { SeerRole } from './SeerRole.js';
import { BodyguardRole } from './BodyguardRole.js';

export class RoleRegistry {
  private static roles: Map<string, BaseRole> = new Map();

  static {
    RoleRegistry.register(new VillagerRole());
    RoleRegistry.register(new WerewolfRole());
    RoleRegistry.register(new WolfCubRole());
    RoleRegistry.register(new SeerRole());
    RoleRegistry.register(new BodyguardRole());
  }

  static register(role: BaseRole) {
    RoleRegistry.roles.set(role.id, role);
  }

  static getRole(id: string): BaseRole | undefined {
    return RoleRegistry.roles.get(id);
  }

  static getAllRoles(): BaseRole[] {
    return Array.from(RoleRegistry.roles.values());
  }
}
