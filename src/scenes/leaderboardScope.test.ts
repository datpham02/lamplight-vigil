import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLocalPlatform, createRemotePlatform } from '../platform/index';
import { LEADERBOARD_SCOPE } from './events';
import { defaultLeaderboardScope } from './leaderboardScope';

describe('default leaderboard scope', () => {
  it("uses this device's board wording on the local/default path", () => {
    assert.equal(defaultLeaderboardScope(), LEADERBOARD_SCOPE.DEVICE);
    assert.equal(defaultLeaderboardScope(createLocalPlatform()), LEADERBOARD_SCOPE.DEVICE);
  });

  it('switches to weekly board wording when RemotePlatform is injected', () => {
    const remote = createRemotePlatform({
      send: async () => {
        throw new Error('unused');
      },
    });
    assert.equal(defaultLeaderboardScope(remote), LEADERBOARD_SCOPE.WEEKLY);
  });
});
