import { RoleGroup, NightCall, Player, GameState } from '../types/game.js';

export interface RoleOptions {
  id: string;
  name: string;
  description: string;
  group: RoleGroup;
  order: number;
}

export abstract class BaseRole {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly group: RoleGroup;
  readonly order: number;

  constructor(options: RoleOptions) {
    this.id = options.id;
    this.name = options.name;
    this.description = options.description;
    this.group = options.group;
    this.order = options.order;
  }

  // Override to return night call configuration
  getNightCall(gameState: GameState): NightCall | null {
    return null;
  }

  // Override to list valid target candidates for action
  getCandidates(actor: Player, gameState: GameState): Player[] {
    return [];
  }

  // Passive hook when player with this role dies
  onDeath(deadPlayer: Player, gameState: GameState): void {}

  // Process night action effects
  processNightAction(targets: Player[], gameState: GameState): void {}

  serialize() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      group: this.group,
      order: this.order,
    };
  }
}
