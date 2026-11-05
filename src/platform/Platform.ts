// src/platform owns the boundary between gameplay and any host/backend provider.
// Gameplay talks only to this contract, never to provider SDKs directly.

/** Capabilities a platform may expose. */
export type PlatformCapability = 'leaderboard' | 'rewardedAd' | 'purchases';

/** Lamplight Vigil currently uses leaderboard only. */
export const LAMPLIGHT_DECLARED_CAPABILITIES: readonly PlatformCapability[] = ['leaderboard'];

/** The player identity a platform resolves for score ownership. */
export interface PlatformPlayer {
  readonly id: string;
  readonly displayName: string;
}

/** Payload submitted when a run ends. */
export interface PlatformScoreEntry {
  readonly score: number;
  readonly mode: string;
  readonly weekKey: string | null;
  readonly displayName?: string;
  readonly submittedAtMs?: number;
}

/** One rank row returned by a board query. */
export interface PlatformLeaderboardEntry {
  readonly playerId: string;
  readonly displayName: string;
  readonly score: number;
  readonly mode: string;
  readonly weekKey: string | null;
  readonly submittedAtMs: number;
}

/** Query for leaderboard rows. */
export interface PlatformLeaderboardQuery {
  readonly limit: number;
  readonly mode?: string;
  readonly weekKey?: string | null;
}

/** Response shape for leaderboard rows. */
export interface PlatformLeaderboardResult {
  readonly entries: readonly PlatformLeaderboardEntry[];
}

/** Response for rewarded ads in games that declare the capability later. */
export interface RewardedAdResult {
  readonly granted: boolean;
}

/** Purchase receipt shape for games with purchases enabled. */
export interface PurchaseReceipt {
  readonly receiptId: string;
  readonly sku: string;
  readonly grantedAtMs: number;
}

/** Entitlement row for games that consume purchases. */
export interface Entitlement {
  readonly id: string;
  readonly sku: string;
  readonly grantedAtMs: number;
}

export type PlatformUnsubscribe = () => void;

/**
 * The only interface gameplay is allowed to call for online features.
 *
 * Methods for rewarded ads and purchases are named now for contract stability;
 * Lamplight Vigil does not declare those capabilities.
 */
export interface Platform {
  readonly capabilities: ReadonlySet<PlatformCapability>;
  getPlayer(): Promise<PlatformPlayer>;
  submitScore(entry: PlatformScoreEntry): Promise<void>;
  getLeaderboard(query: PlatformLeaderboardQuery): Promise<PlatformLeaderboardResult>;
  onPause(callback: () => void): PlatformUnsubscribe;
  onResume(callback: () => void): PlatformUnsubscribe;
  showRewardedAd(placement: string): Promise<RewardedAdResult>;
  purchase(sku: string): Promise<PurchaseReceipt>;
  getEntitlements(): Promise<readonly Entitlement[]>;
}

/** True only when a capability is present on a platform instance. */
export function hasCapability(platform: Platform, capability: PlatformCapability): boolean {
  return platform.capabilities.has(capability);
}
