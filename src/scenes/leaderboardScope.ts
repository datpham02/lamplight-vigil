import { asRemotePlatform, type Platform } from '../platform/index';
import { LEADERBOARD_SCOPE, type LeaderboardScope } from './events';

/**
 * Device wording for local fallback; weekly wording only when a RemotePlatform
 * is injected by the host.
 */
export function defaultLeaderboardScope(platform: Platform | null = null): LeaderboardScope {
  if (platform === null) {
    return LEADERBOARD_SCOPE.DEVICE;
  }
  return asRemotePlatform(platform) !== null ? LEADERBOARD_SCOPE.WEEKLY : LEADERBOARD_SCOPE.DEVICE;
}
