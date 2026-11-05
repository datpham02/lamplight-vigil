import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PLATFORM_SUBMIT_QUEUE_STORAGE_KEY } from '../config/index';
import { SUBMISSION_STATE, type PlatformScoreEntry } from './Platform';
import { PLATFORM_TRANSPORT_OPERATION, type PlatformTransport, type PlatformTransportRequest } from './PlatformTransport';
import { RemotePlatform } from './RemotePlatform';

class FakeStorage {
  public readonly entries = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

class ScriptedTransport implements PlatformTransport {
  public readonly calls: PlatformTransportRequest[] = [];
  public mode: 'resolve' | 'reject' | 'hang' | 'slow' = 'resolve';
  public delayMs = 0;

  public send<TResponse>(request: PlatformTransportRequest): Promise<TResponse> {
    this.calls.push(request);

    if (this.mode === 'hang') {
      return new Promise<TResponse>(() => {});
    }
    if (this.mode === 'reject') {
      return Promise.reject(new Error('offline'));
    }

    const response = this.responseFor(request);
    if (this.mode === 'slow') {
      return new Promise<TResponse>((resolve) => {
        setTimeout(() => {
          resolve(response as TResponse);
        }, this.delayMs);
      });
    }
    return Promise.resolve(response as TResponse);
  }

  private responseFor(request: PlatformTransportRequest): unknown {
    switch (request.operation) {
      case PLATFORM_TRANSPORT_OPERATION.GET_PLAYER:
        return { player: { id: 'p1', displayName: 'Lampkeeper' } };
      case PLATFORM_TRANSPORT_OPERATION.GET_LEADERBOARD:
        return { leaderboard: { entries: [] } };
      case PLATFORM_TRANSPORT_OPERATION.SUBMIT_SCORE:
        return undefined;
    }
  }
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

const scoreEntry = (overrides: Partial<PlatformScoreEntry> = {}): PlatformScoreEntry => ({
  score: 1234,
  mode: 'weekly',
  weekKey: '2026-W45',
  durationMs: 42_000,
  banished: 17,
  seed: 'seed-2026-W45',
  gameVersion: '0.1.0',
  displayName: 'Lampkeeper',
  submittedAtMs: 1_800_000_000_000,
  ...overrides,
});

describe('RemotePlatform', () => {
  it('submits through transport and stays in sent state on success', async () => {
    const storage = new FakeStorage();
    const transport = new ScriptedTransport();
    const platform = new RemotePlatform(transport, { storage, timeoutMs: 50 });

    await platform.submitScore(scoreEntry());

    assert.equal(platform.getSubmissionState(), SUBMISSION_STATE.SENT);
    assert.equal(
      transport.calls.some((call) => call.operation === PLATFORM_TRANSPORT_OPERATION.SUBMIT_SCORE),
      true,
    );
  });

  it('queues failed submissions under a lamplight-vigil namespaced key', async () => {
    const storage = new FakeStorage();
    const transport = new ScriptedTransport();
    transport.mode = 'reject';
    const platform = new RemotePlatform(transport, { storage, timeoutMs: 20 });

    await platform.submitScore(scoreEntry());

    assert.equal(platform.getSubmissionState(), SUBMISSION_STATE.QUEUED);
    const queued = storage.getItem(PLATFORM_SUBMIT_QUEUE_STORAGE_KEY);
    assert.ok(queued !== null);
  });

  it('queues submissions that hang past timeout', async () => {
    const storage = new FakeStorage();
    const transport = new ScriptedTransport();
    transport.mode = 'hang';
    const platform = new RemotePlatform(transport, { storage, timeoutMs: 10 });

    await platform.submitScore(scoreEntry());

    assert.equal(platform.getSubmissionState(), SUBMISSION_STATE.QUEUED);
    assert.ok(storage.getItem(PLATFORM_SUBMIT_QUEUE_STORAGE_KEY) !== null);
  });

  it('accepts slow responses when they complete within timeout', async () => {
    const storage = new FakeStorage();
    const transport = new ScriptedTransport();
    transport.mode = 'slow';
    transport.delayMs = 15;
    const platform = new RemotePlatform(transport, { storage, timeoutMs: 40 });

    await platform.submitScore(scoreEntry());

    assert.equal(platform.getSubmissionState(), SUBMISSION_STATE.SENT);
  });

  it('replays queued submissions on next boot', async () => {
    const storage = new FakeStorage();
    storage.setItem(
      PLATFORM_SUBMIT_QUEUE_STORAGE_KEY,
      JSON.stringify({
        submissions: [{ id: 'queued-1', entry: scoreEntry(), queuedAtMs: 1 }],
      }),
    );

    const transport = new ScriptedTransport();
    const platform = new RemotePlatform(transport, { storage, timeoutMs: 30 });
    await flush();

    assert.equal(platform.getSubmissionState(), SUBMISSION_STATE.SENT);
    assert.equal(storage.getItem(PLATFORM_SUBMIT_QUEUE_STORAGE_KEY), JSON.stringify({ submissions: [] }));
  });

  it('retries queued submissions on resume without waiting for restart', async () => {
    const storage = new FakeStorage();
    const transport = new ScriptedTransport();
    transport.mode = 'reject';
    const platform = new RemotePlatform(transport, { storage, timeoutMs: 20 });

    await platform.submitScore(scoreEntry());
    assert.equal(platform.getSubmissionState(), SUBMISSION_STATE.QUEUED);

    transport.mode = 'resolve';
    platform.notifyResumed();
    await flush();

    assert.equal(platform.getSubmissionState(), SUBMISSION_STATE.SENT);
    assert.equal(storage.getItem(PLATFORM_SUBMIT_QUEUE_STORAGE_KEY), JSON.stringify({ submissions: [] }));
  });

  it('does not resend after queued submission has already succeeded', async () => {
    const storage = new FakeStorage();
    storage.setItem(
      PLATFORM_SUBMIT_QUEUE_STORAGE_KEY,
      JSON.stringify({
        submissions: [{ id: 'queued-1', entry: scoreEntry(), queuedAtMs: 1 }],
      }),
    );
    const transport = new ScriptedTransport();
    const platform = new RemotePlatform(transport, { storage, timeoutMs: 20 });
    await flush();

    const before = transport.calls.filter(
      (call) => call.operation === PLATFORM_TRANSPORT_OPERATION.SUBMIT_SCORE,
    ).length;
    platform.notifyResumed();
    await flush();
    const after = transport.calls.filter(
      (call) => call.operation === PLATFORM_TRANSPORT_OPERATION.SUBMIT_SCORE,
    ).length;

    assert.equal(before, 1);
    assert.equal(after, 1);
  });

  it('caps queue length at configured maximum size', async () => {
    const storage = new FakeStorage();
    const transport = new ScriptedTransport();
    transport.mode = 'reject';
    const platform = new RemotePlatform(transport, { storage, timeoutMs: 10, queueMaxSize: 2 });

    await platform.submitScore(scoreEntry({ submittedAtMs: 1 }));
    await platform.submitScore(scoreEntry({ submittedAtMs: 2 }));
    await platform.submitScore(scoreEntry({ submittedAtMs: 3 }));

    const raw = storage.getItem(PLATFORM_SUBMIT_QUEUE_STORAGE_KEY);
    assert.ok(raw !== null);
    const parsed = JSON.parse(raw ?? '{}') as { submissions?: Array<{ entry?: { submittedAtMs?: number } }> };
    assert.equal(parsed.submissions?.length, 2);
    assert.deepEqual(
      parsed.submissions?.map((queued) => queued.entry?.submittedAtMs),
      [2, 3],
    );
  });
});
