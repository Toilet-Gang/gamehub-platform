import { BaseRole } from './BaseRole.js';
import { GameState, NightCall, Player } from '../types/game.js';

export class SeerRole extends BaseRole {
  constructor() {
    super({
      id: 'tien-tri',
      name: 'Tiên Tri',
      description: 'Mỗi đêm có thể soi 1 người chơi để biết họ thuộc phe Dân Làng hay Ma Sói.',
      group: 1,
      order: 20,
    });
  }

  override getNightCall(gameState: GameState): NightCall {
    return {
      key: 'seer',
      roleIds: ['tien-tri'],
      title: 'Tiên Tri',
      order: this.order,
      prompt: 'Tiên Tri hãy thức dậy và chọn 1 người chơi để kiểm tra danh tính.',
      ttsPrompt: 'Tiên Tri hãy thức dậy',
      minTargets: 1,
      maxTargets: 1,
    };
  }

  override getCandidates(actor: Player, gameState: GameState): Player[] {
    return Array.from(gameState.players.values()).filter(
      (p) => p.alive && p.id !== actor.id
    );
  }
}
