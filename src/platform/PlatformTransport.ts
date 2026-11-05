import type {
  PlatformLeaderboardResult,
  PlatformPlayer,
  PlatformScoreEntry,
} from './Platform';

export const PLATFORM_TRANSPORT_OPERATION = {
  GET_PLAYER: 'get-player',
  SUBMIT_SCORE: 'submit-score',
  GET_LEADERBOARD: 'get-leaderboard',
} as const;
export type PlatformTransportOperation =
  (typeof PLATFORM_TRANSPORT_OPERATION)[keyof typeof PLATFORM_TRANSPORT_OPERATION];

export interface PlatformTransportRequest {
  readonly operation: PlatformTransportOperation;
  readonly payload: unknown;
}

export interface PlatformTransport {
  send<TResponse>(request: PlatformTransportRequest): Promise<TResponse>;
}

export interface SubmitScoreRequestPayload {
  readonly entry: PlatformScoreEntry;
}

export interface GetLeaderboardRequestPayload {
  readonly query: {
    readonly limit: number;
    readonly mode?: string;
    readonly weekKey?: string | null;
  };
}

export interface GetPlayerResponsePayload {
  readonly player: PlatformPlayer;
}

export interface GetLeaderboardResponsePayload {
  readonly leaderboard: PlatformLeaderboardResult;
}
