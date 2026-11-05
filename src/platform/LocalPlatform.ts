import {
  DISPLAY_NAME_DEFAULT_DIGITS,
  DISPLAY_NAME_DEFAULT_PREFIX,
  DISPLAY_NAME_STORAGE_KEY,
  PLATFORM_LEADERBOARD_STORAGE_KEY,
  PLATFORM_PLAYER_STORAGE_KEY,
} from '../config/index';
import {
  LAMPLIGHT_DECLARED_CAPABILITIES,
  type Entitlement,
  type Platform,
  type PlatformLeaderboardEntry,
  type PlatformLeaderboardQuery,
  type PlatformLeaderboardResult,
  type PlatformPlayer,
  type PlatformScoreEntry,
  type PlatformUnsubscribe,
  type PurchaseReceipt,
  type RewardedAdResult,
} from './Platform';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredPlayerRecord {
  readonly id: string;
}

interface LegacyStoredPlayerRecord {
  readonly id?: unknown;
  readonly displayName?: unknown;
}

interface LocalPlatformOptions {
  readonly storage?: StorageLike | null;
  readonly now?: () => number;
  readonly random?: () => number;
}

const LEADERBOARD_CAPABILITIES = new Set(LAMPLIGHT_DECLARED_CAPABILITIES);

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJson<T>(storage: StorageLike | null, key: string): T | null {
  if (storage === null) {
    return null;
  }

  try {
    const raw = storage.getItem(key);
    if (raw === null || raw === undefined) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(storage: StorageLike | null, key: string, value: unknown): void {
  if (storage === null) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Intentionally ignored: local fallback must never break gameplay.
  }
}

function generatedDisplayName(random: () => number): string {
  const floor = 10 ** (DISPLAY_NAME_DEFAULT_DIGITS - 1);
  const span = 9 * floor;
  const draw = Math.floor(Math.min(Math.max(random(), 0), 0.999999) * span) + floor;
  return `${DISPLAY_NAME_DEFAULT_PREFIX} ${draw}`;
}

function readDisplayNameFromSceneStore(storage: StorageLike | null): string | null {
  const parsed = readJson<{ name?: unknown }>(storage, DISPLAY_NAME_STORAGE_KEY);
  return typeof parsed?.name === 'string' && parsed.name.length > 0 ? parsed.name : null;
}

function readStoredPlayerId(storage: StorageLike | null): string | null {
  const stored = readJson<LegacyStoredPlayerRecord>(storage, PLATFORM_PLAYER_STORAGE_KEY);
  if (typeof stored?.id === 'string' && stored.id.length > 0) {
    return stored.id;
  }
  return null;
}

function readLegacyDisplayName(storage: StorageLike | null): string | null {
  const stored = readJson<LegacyStoredPlayerRecord>(storage, PLATFORM_PLAYER_STORAGE_KEY);
  if (typeof stored?.displayName === 'string' && stored.displayName.length > 0) {
    return stored.displayName;
  }
  return null;
}

function createPlayerId(random: () => number, now: () => number): string {
  const seed = Math.floor(Math.min(Math.max(random(), 0), 0.999999) * 1_000_000_000)
    .toString(36)
    .padStart(6, '0');
  return `local-${now().toString(36)}-${seed}`;
}

function sorted(entries: readonly PlatformLeaderboardEntry[]): readonly PlatformLeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    return a.submittedAtMs - b.submittedAtMs;
  });
}

export function createLocalPlatform(options: LocalPlatformOptions = {}): Platform {
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  let playerId: string | null = null;
  let fallbackDisplayName: string | null = null;

  const resolvePlayerId = (): string => {
    if (playerId !== null) {
      return playerId;
    }

    const stored = readStoredPlayerId(storage);
    if (stored !== null) {
      playerId = stored;
      return playerId;
    }

    playerId = createPlayerId(random, now);
    writeJson(storage, PLATFORM_PLAYER_STORAGE_KEY, { id: playerId } satisfies StoredPlayerRecord);
    return playerId;
  };

  const resolveDisplayName = (): string => {
    const fromSceneStore = readDisplayNameFromSceneStore(storage);
    if (fromSceneStore !== null) {
      return fromSceneStore;
    }

    if (fallbackDisplayName !== null) {
      return fallbackDisplayName;
    }

    fallbackDisplayName = readLegacyDisplayName(storage) ?? generatedDisplayName(random);
    return fallbackDisplayName;
  };

  const onPause = (_callback: () => void): PlatformUnsubscribe => () => {};
  const onResume = (_callback: () => void): PlatformUnsubscribe => () => {};

  return {
    capabilities: LEADERBOARD_CAPABILITIES,

    async getPlayer(): Promise<PlatformPlayer> {
      return { id: resolvePlayerId(), displayName: resolveDisplayName() };
    },

    async submitScore(entry: PlatformScoreEntry): Promise<void> {
      const submittedAtMs = entry.submittedAtMs ?? now();
      const scoreEntry: PlatformLeaderboardEntry = {
        playerId: resolvePlayerId(),
        displayName: entry.displayName ?? resolveDisplayName(),
        score: Math.max(0, Math.floor(entry.score)),
        mode: entry.mode,
        weekKey: entry.weekKey,
        durationMs: Math.max(0, Math.floor(entry.durationMs)),
        banished: Math.max(0, Math.floor(entry.banished)),
        seed: entry.seed,
        gameVersion: entry.gameVersion,
        submittedAtMs,
      };

      const existing = readJson<PlatformLeaderboardEntry[]>(storage, PLATFORM_LEADERBOARD_STORAGE_KEY);
      const next = sorted([...(existing ?? []), scoreEntry]);
      writeJson(storage, PLATFORM_LEADERBOARD_STORAGE_KEY, next);
    },

    async getLeaderboard(query: PlatformLeaderboardQuery): Promise<PlatformLeaderboardResult> {
      const limit = Math.max(0, Math.floor(query.limit));
      if (limit === 0) {
        return { entries: [] };
      }

      const existing = readJson<PlatformLeaderboardEntry[]>(storage, PLATFORM_LEADERBOARD_STORAGE_KEY) ?? [];
      const filtered = existing.filter((entry) => {
        if (query.mode !== undefined && entry.mode !== query.mode) {
          return false;
        }
        if (query.weekKey !== undefined && entry.weekKey !== query.weekKey) {
          return false;
        }
        return true;
      });
      return { entries: sorted(filtered).slice(0, limit) };
    },

    onPause,
    onResume,

    async showRewardedAd(_placement: string): Promise<RewardedAdResult> {
      return { granted: false };
    },

    async purchase(sku: string): Promise<PurchaseReceipt> {
      throw new Error(`purchases capability is not available for sku "${sku}"`);
    },

    async getEntitlements(): Promise<readonly Entitlement[]> {
      return [];
    },
  };
}
