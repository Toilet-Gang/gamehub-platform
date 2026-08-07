export type GamePhase = 'LOBBY' | 'NIGHT' | 'DAY_DISCUSSION' | 'DAY_VOTING' | 'ENDED';

export type RoleGroup = 1 | 2 | 3; // 1: Villager, 2: Werewolf, 3: Third Party

export interface Player {
  id: string;
  name: string;
  alive: boolean;
  isHost: boolean;
  roleId: string | null;
  socketId: string | null;
  targetId?: string | null; // Vote or action target
}

export interface NightCall {
  key: string;
  roleIds: string[];
  title: string;
  order: number;
  ttsPrompt?: string;
  prompt: string;
  minTargets: number;
  maxTargets: number;
}

export interface GameLog {
  timestamp: number;
  message: string;
  type: 'info' | 'death' | 'phase' | 'vote';
}

export interface WerewolfGameSettings {
  minPlayers: number;
  maxPlayers: number;
  discussionDurationMs: number;
  rolesConfig: Record<string, number>; // roleId -> count
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  dayCount: number;
  players: Map<string, Player>;
  settings: WerewolfGameSettings;
  nightCalls: NightCall[];
  currentCallIndex: number;
  logs: GameLog[];
  winnerGroup: RoleGroup | null;
}

export interface ActionPayload {
  actorId: string;
  targetIds: string[];
  callKey: string;
}
