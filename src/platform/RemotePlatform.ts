import {
  PLATFORM_SUBMIT_QUEUE_MAX_SIZE,
  PLATFORM_SUBMIT_QUEUE_STORAGE_KEY,
  PLATFORM_TRANSPORT_TIMEOUT_MS,
} from '../config/index';
import {
  LAMPLIGHT_DECLARED_CAPABILITIES,
  SUBMISSION_STATE,
  type Entitlement,
  type Platform,
  type PlatformLeaderboardQuery,
  type PlatformLeaderboardResult,
  type PlatformPlayer,
  type PlatformScoreEntry,
  type PlatformUnsubscribe,
  type PurchaseReceipt,
  type RewardedAdResult,
  type SubmissionState,
} from './Platform';
import {
  PLATFORM_TRANSPORT_OPERATION,
  type GetLeaderboardResponsePayload,
  type GetPlayerResponsePayload,
  type PlatformTransport,
  type SubmitScoreRequestPayload,
} from './PlatformTransport';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface RemotePlatformOptions {
  readonly storage?: StorageLike | null;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly queueStorageKey?: string;
  readonly queueMaxSize?: number;
}

interface QueuedSubmission {
  readonly id: string;
  readonly entry: PlatformScoreEntry;
  readonly queuedAtMs: number;
}

interface StoredQueue {
  readonly submissions: readonly QueuedSubmission[];
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

function writeJson(storage: StorageLike | null, key: string, value: unknown): boolean {
  if (storage === null) {
    return false;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Offline-first path: storage failures are non-fatal.
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let handle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(() => {
      reject(new Error(`platform transport timeout after ${timeoutMs} ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (handle !== null) {
      clearTimeout(handle);
    }
  });
}

function submissionId(entry: PlatformScoreEntry): string {
  return JSON.stringify([
    entry.mode,
    entry.weekKey,
    entry.score,
    entry.durationMs,
    entry.banished,
    entry.seed,
    entry.gameVersion,
    entry.displayName ?? '',
    entry.submittedAtMs ?? 0,
  ]);
}

function isRemotePlatform(value: unknown): value is RemotePlatform {
  return value instanceof RemotePlatform;
}

export class RemotePlatform implements Platform {
  public readonly capabilities = LEADERBOARD_CAPABILITIES;

  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly queueStorageKey: string;
  private readonly queueMaxSize: number;
  private readonly transport: PlatformTransport;

  private submissionState: SubmissionState = SUBMISSION_STATE.SENT;
  private readonly pauseCallbacks = new Set<() => void>();
  private readonly resumeCallbacks = new Set<() => void>();
  private replayingQueue = false;

  public constructor(transport: PlatformTransport, options: RemotePlatformOptions = {}) {
    this.transport = transport;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? PLATFORM_TRANSPORT_TIMEOUT_MS;
    this.queueStorageKey = options.queueStorageKey ?? PLATFORM_SUBMIT_QUEUE_STORAGE_KEY;
    this.queueMaxSize = options.queueMaxSize ?? PLATFORM_SUBMIT_QUEUE_MAX_SIZE;

    // Boot retry is fire-and-forget so first frame timing is never transport-bound.
    void this.replayQueue();
  }

  public getSubmissionState(): SubmissionState {
    return this.submissionState;
  }

  public async getPlayer(): Promise<PlatformPlayer> {
    const response = await withTimeout(
      this.transport.send<GetPlayerResponsePayload>({
        operation: PLATFORM_TRANSPORT_OPERATION.GET_PLAYER,
        payload: {},
      }),
      this.timeoutMs,
    );
    return response.player;
  }

  public async submitScore(entry: PlatformScoreEntry): Promise<void> {
    const queued: QueuedSubmission = {
      id: submissionId(entry),
      entry,
      queuedAtMs: this.now(),
    };

    try {
      await this.sendScore(queued.entry);
      this.removeQueuedById(queued.id);
      this.submissionState = SUBMISSION_STATE.SENT;
      return;
    } catch {
      const queuedOk = this.enqueue(queued);
      this.submissionState = queuedOk ? SUBMISSION_STATE.QUEUED : SUBMISSION_STATE.FAILED;
      if (!queuedOk) {
        throw new Error('remote submit failed and queue write failed');
      }
    }
  }

  public async getLeaderboard(query: PlatformLeaderboardQuery): Promise<PlatformLeaderboardResult> {
    const response = await withTimeout(
      this.transport.send<GetLeaderboardResponsePayload>({
        operation: PLATFORM_TRANSPORT_OPERATION.GET_LEADERBOARD,
        payload: { query },
      }),
      this.timeoutMs,
    );
    return response.leaderboard;
  }

  public onPause(callback: () => void): PlatformUnsubscribe {
    this.pauseCallbacks.add(callback);
    return () => {
      this.pauseCallbacks.delete(callback);
    };
  }

  public onResume(callback: () => void): PlatformUnsubscribe {
    this.resumeCallbacks.add(callback);
    return () => {
      this.resumeCallbacks.delete(callback);
    };
  }

  public notifyPaused(): void {
    for (const callback of this.pauseCallbacks) {
      callback();
    }
  }

  public notifyResumed(): void {
    for (const callback of this.resumeCallbacks) {
      callback();
    }
    void this.replayQueue();
  }

  public async showRewardedAd(_placement: string): Promise<RewardedAdResult> {
    return { granted: false };
  }

  public async purchase(sku: string): Promise<PurchaseReceipt> {
    throw new Error(`purchases capability is not available for sku "${sku}"`);
  }

  public async getEntitlements(): Promise<readonly Entitlement[]> {
    return [];
  }

  private async sendScore(entry: PlatformScoreEntry): Promise<void> {
    await withTimeout(
      this.transport.send<void>({
        operation: PLATFORM_TRANSPORT_OPERATION.SUBMIT_SCORE,
        payload: { entry } satisfies SubmitScoreRequestPayload,
      }),
      this.timeoutMs,
    );
  }

  private queueSnapshot(): readonly QueuedSubmission[] {
    const stored = readJson<StoredQueue>(this.storage, this.queueStorageKey);
    if (!Array.isArray(stored?.submissions)) {
      return [];
    }
    return stored.submissions.filter((submission) => {
      return (
        typeof submission?.id === 'string' &&
        typeof submission?.queuedAtMs === 'number' &&
        typeof submission?.entry?.score === 'number'
      );
    });
  }

  private writeQueue(entries: readonly QueuedSubmission[]): boolean {
    return writeJson(this.storage, this.queueStorageKey, { submissions: entries } satisfies StoredQueue);
  }

  private enqueue(submission: QueuedSubmission): boolean {
    const current = this.queueSnapshot();
    if (current.some((queued) => queued.id === submission.id)) {
      return true;
    }

    const next = [...current, submission];
    if (next.length > this.queueMaxSize) {
      next.splice(0, next.length - this.queueMaxSize);
    }
    return this.writeQueue(next);
  }

  private removeQueuedById(id: string): void {
    const current = this.queueSnapshot();
    const next = current.filter((queued) => queued.id !== id);
    if (next.length !== current.length) {
      this.writeQueue(next);
    }
  }

  private async replayQueue(): Promise<void> {
    if (this.replayingQueue) {
      return;
    }
    this.replayingQueue = true;
    try {
      const pending = this.queueSnapshot();
      if (pending.length === 0) {
        return;
      }

      const remaining: QueuedSubmission[] = [];
      for (const queued of pending) {
        try {
          await this.sendScore(queued.entry);
          this.submissionState = SUBMISSION_STATE.SENT;
        } catch {
          remaining.push(queued);
          this.submissionState = SUBMISSION_STATE.QUEUED;
        }
      }

      this.writeQueue(remaining);
      if (remaining.length > 0) {
        this.submissionState = SUBMISSION_STATE.QUEUED;
      }
    } finally {
      this.replayingQueue = false;
    }
  }
}

export function asRemotePlatform(platform: Platform): RemotePlatform | null {
  return isRemotePlatform(platform) ? platform : null;
}

export function createRemotePlatform(
  transport: PlatformTransport,
  options: RemotePlatformOptions = {},
): Platform {
  return new RemotePlatform(transport, options);
}
