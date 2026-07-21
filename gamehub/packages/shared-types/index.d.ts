export type GameStatus = "ready" | "placeholder";

export interface GameManifest {
  id: string;
  name: string;
  route: string;
  status: GameStatus;
  description: string;
}

export interface GameRoom {
  code: string;
  gameId: string;
  isOwner: boolean;
  playUrl: string;
  createdAt: number;
  updatedAt: number;
}
