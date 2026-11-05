import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LEADERBOARD_SCOPE } from './events';
import { defaultLeaderboardScope } from './leaderboardScope';

describe('default leaderboard scope for SOU-14', () => {
  it("uses this device's board wording on the default path", () => {
    assert.equal(defaultLeaderboardScope(), LEADERBOARD_SCOPE.DEVICE);
  });
});
