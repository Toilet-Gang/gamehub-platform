import {
  GameState,
  Player,
  GamePhase,
  WerewolfGameSettings,
  ActionPayload,
  NightCall,
  RoleGroup,
  GameLog,
} from '../types/game.js';
import { RoleRegistry } from '../roles/RoleRegistry.js';

export class WerewolfEngine {
  private state: GameState;
  private nightActions: Map<string, string[]> = new Map(); // callKey -> targetIds
  private votes: Map<string, string> = new Map(); // voterId -> targetId

  constructor(roomCode: string, customSettings?: Partial<WerewolfGameSettings>) {
    this.state = {
      roomCode,
      phase: 'LOBBY',
      dayCount: 0,
      players: new Map(),
      settings: {
        minPlayers: 4,
        maxPlayers: 30,
        discussionDurationMs: 300000, // 5 minutes
        rolesConfig: {
          'ma-soi': 1,
          'tien-tri': 1,
          'bao-ve': 1,
          'dan-thuong': 1,
        },
        ...customSettings,
      },
      nightCalls: [],
      currentCallIndex: -1,
      logs: [],
      winnerGroup: null,
    };
  }

  public get roomCode(): string {
    return this.state.roomCode;
  }

  public get phase(): GamePhase {
    return this.state.phase;
  }

  public addPlayer(name: string, socketId: string): Player {
    if (this.state.phase !== 'LOBBY') {
      throw new Error('Không thể tham gia khi game đang diễn ra.');
    }
    if (this.state.players.size >= this.state.settings.maxPlayers) {
      throw new Error('Phòng đã đầy.');
    }

    const id = `player_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const isHost = this.state.players.size === 0;

    const player: Player = {
      id,
      name,
      alive: true,
      isHost,
      roleId: null,
      socketId,
    };

    this.state.players.set(id, player);
    this.addLog(`Người chơi ${name} đã tham gia phòng.`, 'info');
    return player;
  }

  public removePlayer(playerId: string): void {
    const player = this.state.players.get(playerId);
    if (!player) return;

    this.state.players.delete(playerId);
    this.addLog(`Người chơi ${player.name} đã rời phòng.`, 'info');

    // Transfer host if host left
    if (player.isHost && this.state.players.size > 0) {
      const firstPlayer = this.state.players.values().next().value;
      if (firstPlayer) firstPlayer.isHost = true;
    }
  }

  public startGame(): boolean {
    if (this.state.players.size < this.state.settings.minPlayers) {
      throw new Error(`Cần ít nhất ${this.state.settings.minPlayers} người chơi để bắt đầu.`);
    }

    this.assignRoles();
    this.state.dayCount = 1;
    this.startNight();
    return true;
  }

  private assignRoles(): void {
    const playerArray = Array.from(this.state.players.values());
    const rolePool: string[] = [];

    // Fill roles based on config
    Object.entries(this.state.settings.rolesConfig).forEach(([roleId, count]) => {
      for (let i = 0; i < count; i++) rolePool.push(roleId);
    });

    // Fill remaining slots with villagers
    while (rolePool.length < playerArray.length) {
      rolePool.push('dan-thuong');
    }

    // Shuffle role pool
    for (let i = rolePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
    }

    // Assign to players
    playerArray.forEach((player, index) => {
      player.roleId = rolePool[index];
    });

    this.addLog('Trò chơi bắt đầu! Vai trò đã được phân bổ bí mật.', 'phase');
  }

  private startNight(): void {
    this.state.phase = 'NIGHT';
    this.nightActions.clear();
    
    // Build active night calls based on living roles
    const activeRoles = new Set(
      Array.from(this.state.players.values())
        .filter((p) => p.alive && p.roleId)
        .map((p) => p.roleId!)
    );

    const calls: NightCall[] = [];
    activeRoles.forEach((roleId) => {
      const role = RoleRegistry.getRole(roleId);
      if (role) {
        const call = role.getNightCall(this.state);
        if (call) calls.push(call);
      }
    });

    // Sort calls by order
    calls.sort((a, b) => a.order - b.order);
    this.state.nightCalls = calls;
    this.state.currentCallIndex = calls.length > 0 ? 0 : -1;

    this.addLog(`Đêm thứ ${this.state.dayCount} bắt đầu. Làng chìm vào giấc ngủ...`, 'phase');
  }

  public handleNightAction(payload: ActionPayload): void {
    if (this.state.phase !== 'NIGHT') {
      throw new Error('Hiện tại không phải ban đêm.');
    }

    const currentCall = this.state.nightCalls[this.state.currentCallIndex];
    if (!currentCall || currentCall.key !== payload.callKey) {
      throw new Error('Lượt hành động không hợp lệ.');
    }

    this.nightActions.set(payload.callKey, payload.targetIds);
    this.nextNightCall();
  }

  public nextNightCall(): boolean {
    if (this.state.currentCallIndex < this.state.nightCalls.length - 1) {
      this.state.currentCallIndex++;
      return true;
    }

    // End of night calls -> resolve night
    this.resolveNight();
    return false;
  }

  private resolveNight(): void {
    const wolfTargets = this.nightActions.get('wolves') || [];
    const protectedTargets = this.nightActions.get('bodyguard') || [];

    const deaths: Player[] = [];

    wolfTargets.forEach((targetId) => {
      if (!protectedTargets.includes(targetId)) {
        const player = this.state.players.get(targetId);
        if (player && player.alive) {
          player.alive = false;
          deaths.push(player);
        }
      }
    });

    deaths.forEach((p) => {
      this.addLog(`Người chơi ${p.name} đã bị tiêu diệt vào ban đêm.`, 'death');
    });

    if (deaths.length === 0) {
      this.addLog('Đêm qua là một đêm bình yên, không ai chết cả.', 'phase');
    }

    const winner = this.checkWinCondition();
    if (winner) {
      this.endGame(winner);
      return;
    }

    this.startDayDiscussion();
  }

  public startDayDiscussion(): void {
    this.state.phase = 'DAY_DISCUSSION';
    this.votes.clear();
    this.addLog(`Ngày thứ ${this.state.dayCount} bắt đầu. Dân làng hãy thảo luận!`, 'phase');
  }

  public startDayVoting(): void {
    this.state.phase = 'DAY_VOTING';
    this.addLog('Thời gian thảo luận kết thúc. Bắt đầu bỏ phiếu treo cổ!', 'phase');
  }

  public castVote(voterId: string, targetId: string): void {
    if (this.state.phase !== 'DAY_VOTING') {
      throw new Error('Hiện tại chưa tới thời gian bỏ phiếu.');
    }

    const voter = this.state.players.get(voterId);
    if (!voter || !voter.alive) {
      throw new Error('Người chơi đã chết không thể bỏ phiếu.');
    }

    this.votes.set(voterId, targetId);
    this.addLog(`${voter.name} đã hoàn tất bỏ phiếu.`, 'vote');
  }

  public resolveDayVote(): { eliminated: Player | null } {
    const voteCounts: Map<string, number> = new Map();

    this.votes.forEach((targetId) => {
      voteCounts.set(targetId, (voteCounts.get(targetId) || 0) + 1);
    });

    let maxVotes = 0;
    let eliminatedId: string | null = null;
    let tie = false;

    voteCounts.forEach((count, targetId) => {
      if (count > maxVotes) {
        maxVotes = count;
        eliminatedId = targetId;
        tie = false;
      } else if (count === maxVotes) {
        tie = true;
      }
    });

    let eliminatedPlayer: Player | null = null;
    if (eliminatedId && !tie && maxVotes > 0) {
      eliminatedPlayer = this.state.players.get(eliminatedId) || null;
      if (eliminatedPlayer) {
        eliminatedPlayer.alive = false;
        this.addLog(`Dân làng đã bỏ phiếu treo cổ ${eliminatedPlayer.name}!`, 'death');
      }
    } else {
      this.addLog('Kết quả bỏ phiếu hòa/không đủ phiếu. Không ai bị treo cổ.', 'vote');
    }

    const winner = this.checkWinCondition();
    if (winner) {
      this.endGame(winner);
    } else {
      this.state.dayCount++;
      this.startNight();
    }

    return { eliminated: eliminatedPlayer };
  }

  public checkWinCondition(): RoleGroup | null {
    const alivePlayers = Array.from(this.state.players.values()).filter((p) => p.alive);
    const wolvesCount = alivePlayers.filter((p) => {
      const role = RoleRegistry.getRole(p.roleId || '');
      return role?.group === 2;
    }).length;

    const nonWolvesCount = alivePlayers.length - wolvesCount;

    if (wolvesCount === 0) {
      return 1; // Villagers win
    }
    if (wolvesCount >= nonWolvesCount) {
      return 2; // Werewolves win
    }

    return null;
  }

  private endGame(winnerGroup: RoleGroup): void {
    this.state.phase = 'ENDED';
    this.state.winnerGroup = winnerGroup;
    const teamName = winnerGroup === 1 ? 'Phe Dân Làng' : 'Phe Ma Sói';
    this.addLog(`Trò chơi kết thúc! ${teamName} đã chiến thắng! 🎉`, 'phase');
  }

  private addLog(message: string, type: GameLog['type']): void {
    this.state.logs.push({
      timestamp: Date.now(),
      message,
      type,
    });
  }

  public getPublicState(forPlayerId?: string) {
    const playerArray = Array.from(this.state.players.values());
    const self = forPlayerId ? this.state.players.get(forPlayerId) : null;

    return {
      roomCode: this.state.roomCode,
      phase: this.state.phase,
      dayCount: this.state.dayCount,
      currentCall: this.state.nightCalls[this.state.currentCallIndex] || null,
      winnerGroup: this.state.winnerGroup,
      players: playerArray.map((p) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        isHost: p.isHost,
        // Only show role to self or if game ended
        role:
          p.id === forPlayerId || this.state.phase === 'ENDED'
            ? RoleRegistry.getRole(p.roleId || '')?.serialize()
            : null,
      })),
      logs: this.state.logs,
      self: self
        ? {
            id: self.id,
            name: self.name,
            alive: self.alive,
            isHost: self.isHost,
            role: RoleRegistry.getRole(self.roleId || '')?.serialize() || null,
          }
        : null,
    };
  }
}
