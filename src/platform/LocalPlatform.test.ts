import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PLATFORM_LEADERBOARD_STORAGE_KEY, PLATFORM_PLAYER_STORAGE_KEY } from '../config/index';
import { createLocalPlatform } from './LocalPlatform';
import { resolvePlatform } from './gateway';

class FakeStorage {
  public readonly entries = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

describe('resolvePlatform', () => {
  it('uses local fallback when no platform is injected', () => {
    const platform = resolvePlatform(undefined);
    assert.equal(platform.capabilities.has('leaderboard'), true);
  });
});

describe('LocalPlatform', () => {
  it('declares leaderboard only', () => {
    const platform = createLocalPlatform({ storage: new FakeStorage() });

    assert.deepEqual(new Set(platform.capabilities), new Set(['leaderboard']));
  });

  it('persists and reuses a local player profile', async () => {
    const storage = new FakeStorage();
    const now = () => 1_234_567_890_000;
    const random = () => 0.5;

    const first = createLocalPlatform({ storage, now, random });
    const one = await first.getPlayer();

    const second = createLocalPlatform({ storage, now, random });
    const two = await second.getPlayer();

    assert.deepEqual(one, two);
    assert.equal(storage.entries.has(PLATFORM_PLAYER_STORAGE_KEY), true);
  });

  it('stores score submissions and returns ranked rows', async () => {
    const storage = new FakeStorage();
    const platform = createLocalPlatform({ storage, now: () => 500, random: () => 0.1 });

    await platform.submitScore({ score: 20, mode: 'weekly', weekKey: '2026-W10', submittedAtMs: 2000 });
    await platform.submitScore({ score: 50, mode: 'weekly', weekKey: '2026-W10', submittedAtMs: 1000 });
    await platform.submitScore({ score: 35, mode: 'free-play', weekKey: null, submittedAtMs: 3000 });

    const weekly = await platform.getLeaderboard({ limit: 10, mode: 'weekly', weekKey: '2026-W10' });
    assert.deepEqual(
      weekly.entries.map((entry) => entry.score),
      [50, 20],
    );

    const top = await platform.getLeaderboard({ limit: 1 });
    assert.equal(top.entries.length, 1);
    assert.equal(top.entries[0]?.score, 50);
    assert.equal(storage.entries.has(PLATFORM_LEADERBOARD_STORAGE_KEY), true);
  });

  it('keeps gameplay alive when storage is unavailable', async () => {
    const platform = createLocalPlatform({ storage: null, now: () => 1, random: () => 0.2 });

    await platform.submitScore({ score: 99, mode: 'weekly', weekKey: '2026-W10' });
    const board = await platform.getLeaderboard({ limit: 5 });

    assert.deepEqual(board.entries, []);
  });
});
