import { LEADERBOARD_SCOPE, type LeaderboardScope } from './events';

/**
 * SOU-14 ships with LocalPlatform only, so weekly board wording defaults to
 * "this device's board" until a backend-capable platform path is added.
 */
export function defaultLeaderboardScope(): LeaderboardScope {
  return LEADERBOARD_SCOPE.DEVICE;
}
