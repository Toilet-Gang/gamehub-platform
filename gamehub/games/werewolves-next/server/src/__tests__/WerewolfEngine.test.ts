import { describe, it, expect, beforeEach } from 'vitest';
import { WerewolfEngine } from '../core/WerewolfEngine.js';

describe('WerewolfEngine Clean Code Unit Tests', () => {
  let engine: WerewolfEngine;

  beforeEach(() => {
    engine = new WerewolfEngine('TEST01');
  });

  it('should initialize room in LOBBY phase', () => {
    expect(engine.roomCode).toBe('TEST01');
    expect(engine.phase).toBe('LOBBY');
  });

  it('should allow players to join and assign host to first player', () => {
    const p1 = engine.addPlayer('Alice', 'socket_1');
    const p2 = engine.addPlayer('Bob', 'socket_2');

    expect(p1.isHost).toBe(true);
    expect(p2.isHost).toBe(false);
    expect(engine.getPublicState().players.length).toBe(2);
  });

  it('should throw error when starting game with fewer than minPlayers', () => {
    engine.addPlayer('Alice', 'socket_1');
    expect(() => engine.startGame()).toThrow('Cần ít nhất 4 người chơi để bắt đầu.');
  });

  it('should assign roles and transition to NIGHT phase on game start', () => {
    engine.addPlayer('Alice', 'socket_1');
    engine.addPlayer('Bob', 'socket_2');
    engine.addPlayer('Charlie', 'socket_3');
    engine.addPlayer('David', 'socket_4');

    engine.startGame();

    expect(engine.phase).toBe('NIGHT');
    const state = engine.getPublicState();
    expect(state.dayCount).toBe(1);
    expect(state.currentCall).not.toBeNull();
  });
});
