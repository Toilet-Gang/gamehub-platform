import { BaseRole } from './BaseRole.js';
import { GameState, NightCall, Player } from '../types/game.js';

export class BodyguardRole extends BaseRole {
  constructor() {
    super({
      id: 'bao-ve',
      name: 'Bảo Vệ',
      description: 'Mỗi đêm có thể bảo vệ 1 người khỏi đòn tấn công của Ma Sói. Không thể bảo vệ cùng 1 người 2 đêm liên tiếp.',
      group: 1,
      order: 15,
    });
  }

  override getNightCall(gameState: GameState): NightCall {
    return {
      key: 'bodyguard',
      roleIds: ['bao-ve'],
      title: 'Bảo Vệ',
      order: this.order,
      prompt: 'Bảo Vệ hãy thức dậy và chọn 1 người để bảo vệ đêm nay.',
      ttsPrompt: 'Bảo Vệ hãy thức dậy',
      minTargets: 1,
      maxTargets: 1,
    };
  }

  override getCandidates(actor: Player, gameState: GameState): Player[] {
    return Array.from(gameState.players.values()).filter((p) => p.alive);
  }
}
