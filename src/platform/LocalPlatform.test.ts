import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DISPLAY_NAME_STORAGE_KEY,
  PLATFORM_LEADERBOARD_STORAGE_KEY,
  PLATFORM_PLAYER_STORAGE_KEY,
} from '../config/index';
import { createLocalPlatform } from './LocalPlatform';
import { RemotePlatform } from './RemotePlatform';
import {
  PLATFORM_TRANSPORT_OPERATION,
  type PlatformTransportRequest,
  type PlatformTransport,
} from './PlatformTransport';
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

  it('builds RemotePlatform when a transport is injected', () => {
    const transport: PlatformTransport = {
      send: async <TResponse>(request: PlatformTransportRequest) => {
        if (request.operation === PLATFORM_TRANSPORT_OPERATION.GET_PLAYER) {
          return { player: { id: 'p1', displayName: 'Lampkeeper' } } as TResponse;
        }
        if (request.operation === PLATFORM_TRANSPORT_OPERATION.GET_LEADERBOARD) {
          return { leaderboard: { entries: [] } } as TResponse;
        }
        return undefined as TResponse;
      },
    };

    const platform = resolvePlatform({ transport });
    assert.equal(platform instanceof RemotePlatform, true);
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
    assert.equal(storage.entries.has(PLATFORM_PLAYER_STORAGE_KEY), false);

    const one = await first.getPlayer();
    assert.equal(storage.entries.has(PLATFORM_PLAYER_STORAGE_KEY), true);

    const second = createLocalPlatform({ storage, now, random });
    const two = await second.getPlayer();

    assert.deepEqual(one, two);
  });

  it('reflects renamed display names from scene storage', async () => {
    const storage = new FakeStorage();
    const platform = createLocalPlatform({ storage, now: () => 7, random: () => 0.3 });

    storage.setItem(DISPLAY_NAME_STORAGE_KEY, JSON.stringify({ name: 'Vigil 7421', renamedAt: null }));
    const beforeRename = await platform.getPlayer();

    storage.setItem(DISPLAY_NAME_STORAGE_KEY, JSON.stringify({ name: 'Lampkeeper', renamedAt: 1_700_000_000_000 }));
    const afterRename = await platform.getPlayer();

    assert.equal(afterRename.id, beforeRename.id);
    assert.equal(afterRename.displayName, 'Lampkeeper');
  });

  it('stores score submissions and returns ranked rows', async () => {
    const storage = new FakeStorage();
    const platform = createLocalPlatform({ storage, now: () => 500, random: () => 0.1 });

    await platform.submitScore({
      score: 20,
      mode: 'weekly',
      weekKey: '2026-W10',
      durationMs: 20_000,
      banished: 7,
      seed: 'seed-a',
      gameVersion: '0.1.0',
      submittedAtMs: 2000,
    });
    await platform.submitScore({
      score: 50,
      mode: 'weekly',
      weekKey: '2026-W10',
      durationMs: 25_000,
      banished: 9,
      seed: 'seed-b',
      gameVersion: '0.1.0',
      submittedAtMs: 1000,
    });
    await platform.submitScore({
      score: 35,
      mode: 'free-play',
      weekKey: null,
      durationMs: 35_000,
      banished: 12,
      seed: 'seed-c',
      gameVersion: '0.1.0',
      submittedAtMs: 3000,
    });

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

    await platform.submitScore({
      score: 99,
      mode: 'weekly',
      weekKey: '2026-W10',
      durationMs: 40_000,
      banished: 11,
      seed: 'seed-z',
      gameVersion: '0.1.0',
    });
    const board = await platform.getLeaderboard({ limit: 5 });

    assert.deepEqual(board.entries, []);
  });
});
