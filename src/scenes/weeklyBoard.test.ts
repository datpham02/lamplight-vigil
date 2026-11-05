import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  Platform,
  PlatformLeaderboardQuery,
  PlatformLeaderboardResult,
  PlatformPlayer,
  PlatformScoreEntry,
  PlatformUnsubscribe,
  PurchaseReceipt,
  RewardedAdResult,
} from '../platform/index';
import { WEEKLY_BOARD_STATUS, WeeklyBoardController, selectBoardRows } from './weeklyBoard';

const HANGING_PROMISE = new Promise<never>(() => {});

class FakePlatform implements Platform {
  public readonly capabilities = new Set(['leaderboard'] as const);
  public boards = new Map<string, PlatformLeaderboardResult>();
  public rejectBoard = false;
  public hangingBoard = false;
  public player: PlatformPlayer = { id: 'player-1', displayName: 'Lampkeeper' };

  async getPlayer(): Promise<PlatformPlayer> {
    return this.player;
  }

  async submitScore(_entry: PlatformScoreEntry): Promise<void> {}

  getLeaderboard(query: PlatformLeaderboardQuery): Promise<PlatformLeaderboardResult> {
    if (this.hangingBoard) {
      return HANGING_PROMISE;
    }

    if (this.rejectBoard) {
      return Promise.reject(new Error('offline'));
    }

    return Promise.resolve(this.boards.get(query.weekKey ?? '') ?? { entries: [] });
  }

  onPause(_callback: () => void): PlatformUnsubscribe {
    return () => {};
  }

  onResume(_callback: () => void): PlatformUnsubscribe {
    return () => {};
  }

  async showRewardedAd(_placement: string): Promise<RewardedAdResult> {
    return { granted: false };
  }

  async purchase(_sku: string): Promise<PurchaseReceipt> {
    throw new Error('not implemented');
  }

  async getEntitlements(): Promise<readonly []> {
    return [];
  }
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('selectBoardRows', () => {
  it('keeps top N rows and keeps own row when outside top N', () => {
    const picked = selectBoardRows(
      [
        { playerId: 'p1', displayName: 'A', score: 100, mode: 'weekly', weekKey: '2026-W45', submittedAtMs: 1 },
        { playerId: 'p2', displayName: 'B', score: 90, mode: 'weekly', weekKey: '2026-W45', submittedAtMs: 2 },
        { playerId: 'p3', displayName: 'C', score: 80, mode: 'weekly', weekKey: '2026-W45', submittedAtMs: 3 },
        { playerId: 'me', displayName: 'Me', score: 70, mode: 'weekly', weekKey: '2026-W45', submittedAtMs: 4 },
      ],
      3,
      'me',
    );

    assert.equal(picked.rows.length, 3);
    assert.equal(picked.rows[2]?.rank, 3);
    assert.equal(picked.playerRow?.rank, 4);
    assert.equal(picked.playerRow?.displayName, 'Me');
  });
});

describe('WeeklyBoardController', () => {
  it('enters loading immediately, without awaiting the board call', () => {
    const platform = new FakePlatform();
    platform.hangingBoard = true;
    const board = new WeeklyBoardController(platform);

    board.refresh('2026-W45');
    assert.equal(board.snapshot().status, WEEKLY_BOARD_STATUS.LOADING);
  });

  it('moves to unavailable when board fetch rejects and there is no cache', async () => {
    const platform = new FakePlatform();
    platform.rejectBoard = true;
    const board = new WeeklyBoardController(platform);

    board.refresh('2026-W45');
    await flush();

    assert.equal(board.snapshot().status, WEEKLY_BOARD_STATUS.UNAVAILABLE);
    assert.equal(board.snapshot().rows.length, 0);
  });

  it('keeps last-known rows when a later refresh for the same week fails', async () => {
    const platform = new FakePlatform();
    platform.boards.set('2026-W45', {
      entries: [{ playerId: 'p1', displayName: 'A', score: 100, mode: 'weekly', weekKey: '2026-W45', submittedAtMs: 1 }],
    });
    const board = new WeeklyBoardController(platform);

    board.refresh('2026-W45');
    await flush();
    assert.equal(board.snapshot().status, WEEKLY_BOARD_STATUS.SHOWN);

    platform.rejectBoard = true;
    board.refresh('2026-W45');
    await flush();

    assert.equal(board.snapshot().status, WEEKLY_BOARD_STATUS.LAST_KNOWN);
    assert.equal(board.snapshot().rows[0]?.displayName, 'A');
  });
});
