import { BaseRole } from './BaseRole.js';
import { GameState, NightCall, Player } from '../types/game.js';

export class WerewolfRole extends BaseRole {
  constructor() {
    super({
      id: 'ma-soi',
      name: 'Ma Sói',
      description: 'Thức dậy mỗi đêm cùng đàn sói để chọn 1 dân làng làm nạn nhân.',
      group: 2, // Werewolf team
      order: 10,
    });
  }

  override getNightCall(gameState: GameState): NightCall {
    return {
      key: 'wolves',
      roleIds: ['ma-soi', 'soi-con'],
      title: 'Đàn Ma Sói',
      order: this.order,
      prompt: 'Ma Sói hãy thức dậy và thống nhất chọn 1 nạn nhân để tiêu diệt.',
      ttsPrompt: 'Ma Sói hãy thức dậy',
      minTargets: 1,
      maxTargets: 1,
    };
  }

  override getCandidates(actor: Player, gameState: GameState): Player[] {
    return Array.from(gameState.players.values()).filter(
      (p) => p.alive && p.roleId !== 'ma-soi' && p.roleId !== 'soi-con'
    );
  }
}

export class WolfCubRole extends BaseRole {
  constructor() {
    super({
      id: 'soi-con',
      name: 'Sói Con',
      description: 'Thuộc phe Ma Sói. Nếu Sói Con chết, đêm tiếp theo đàn sói được cắn 2 người.',
      group: 2,
      order: 10,
    });
  }
}
