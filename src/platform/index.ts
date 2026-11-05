export { createLocalPlatform } from './LocalPlatform';
export { asRemotePlatform, createRemotePlatform, RemotePlatform } from './RemotePlatform';
export {
  PLATFORM_TRANSPORT_OPERATION,
  type GetLeaderboardRequestPayload,
  type GetLeaderboardResponsePayload,
  type GetPlayerResponsePayload,
  type PlatformTransport,
  type PlatformTransportOperation,
  type PlatformTransportRequest,
  type SubmitScoreRequestPayload,
} from './PlatformTransport';
export {
  hasCapability,
  hasSubmissionState,
  LAMPLIGHT_DECLARED_CAPABILITIES,
  SUBMISSION_STATE,
  type Entitlement,
  type Platform,
  type PlatformCapability,
  type PlatformLeaderboardEntry,
  type PlatformLeaderboardQuery,
  type PlatformLeaderboardResult,
  type PlatformPlayer,
  type PlatformScoreEntry,
  type PlatformSubmissionStateReadable,
  type PlatformUnsubscribe,
  type PurchaseReceipt,
  type RewardedAdResult,
  type SubmissionState,
} from './Platform';
export { resolvePlatform, type PlatformResolution } from './gateway';
