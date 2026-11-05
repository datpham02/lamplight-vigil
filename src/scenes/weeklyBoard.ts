import {
  LEADERBOARD_QUERY_LIMIT,
  LEADERBOARD_TOP_ROWS,
} from '../config/index';
import type {
  Platform,
  PlatformLeaderboardEntry,
  PlatformLeaderboardQuery,
} from '../platform/index';

export const WEEKLY_BOARD_STATUS = {
  LOADING: 'loading',
  SHOWN: 'shown',
  UNAVAILABLE: 'unavailable',
  LAST_KNOWN: 'last-known',
} as const;

export type WeeklyBoardStatus = (typeof WEEKLY_BOARD_STATUS)[keyof typeof WEEKLY_BOARD_STATUS];

export interface WeeklyBoardRow {
  readonly rank: number;
  readonly displayName: string;
  readonly score: number;
  readonly isPlayer: boolean;
}

export interface WeeklyBoardSnapshot {
  readonly weekKey: string | null;
  readonly status: WeeklyBoardStatus;
  readonly rows: readonly WeeklyBoardRow[];
  readonly playerRow: WeeklyBoardRow | null;
}

interface WeeklyBoardOptions {
  readonly topRows?: number;
  readonly queryLimit?: number;
}

const EMPTY_BOARD: WeeklyBoardSnapshot = {
  weekKey: null,
  status: WEEKLY_BOARD_STATUS.UNAVAILABLE,
  rows: [],
  playerRow: null,
};

export function selectBoardRows(
  entries: readonly PlatformLeaderboardEntry[],
  topRows: number,
  playerId: string | null,
): Pick<WeeklyBoardSnapshot, 'rows' | 'playerRow'> {
  const rows = entries.slice(0, topRows).map((entry, index) => {
    return {
      rank: index + 1,
      displayName: entry.displayName,
      score: entry.score,
      isPlayer: playerId !== null && entry.playerId === playerId,
    } satisfies WeeklyBoardRow;
  });

  const playerRow =
    playerId === null
      ? null
      : entries.reduce<WeeklyBoardRow | null>((found, entry, index) => {
          if (found !== null || entry.playerId !== playerId) {
            return found;
          }
          return {
            rank: index + 1,
            displayName: entry.displayName,
            score: entry.score,
            isPlayer: true,
          };
        }, null);

  return { rows, playerRow };
}

export class WeeklyBoardController {
  private readonly platform: Platform;
  private readonly topRows: number;
  private readonly queryLimit: number;

  private playerId: string | null = null;
  private board: WeeklyBoardSnapshot = EMPTY_BOARD;
  private lastShownByWeek = new Map<string, WeeklyBoardSnapshot>();
  private requestNonce = 0;

  public constructor(platform: Platform, options: WeeklyBoardOptions = {}) {
    this.platform = platform;
    this.topRows = Math.max(1, Math.floor(options.topRows ?? LEADERBOARD_TOP_ROWS));
    this.queryLimit = Math.max(this.topRows, Math.floor(options.queryLimit ?? LEADERBOARD_QUERY_LIMIT));
  }

  /** Fire-and-forget. A hanging identity call cannot block input paths. */
  public primePlayer(): void {
    void this.platform
      .getPlayer()
      .then((player) => {
        this.playerId = player.id;
      })
      .catch(() => {
        // Non-fatal by design: own-row highlighting can be absent.
      });
  }

  public snapshot(): WeeklyBoardSnapshot {
    return this.board;
  }

  /**
   * Fetches the board without awaiting in caller paths.
   *
   * Older responses are ignored by nonce so an outdated request cannot overwrite
   * the board for a newer week.
   */
  public refresh(weekKey: string): Promise<void> {
    const nonce = ++this.requestNonce;
    this.board = {
      weekKey,
      status: WEEKLY_BOARD_STATUS.LOADING,
      rows: this.board.rows,
      playerRow: this.board.playerRow,
    };

    const query: PlatformLeaderboardQuery = {
      limit: this.queryLimit,
      mode: 'weekly',
      weekKey,
    };

    return this.platform
      .getLeaderboard(query)
      .then((result) => {
        if (nonce !== this.requestNonce) {
          return;
        }

        const selected = selectBoardRows(result.entries, this.topRows, this.playerId);
        const shown: WeeklyBoardSnapshot = {
          weekKey,
          status: WEEKLY_BOARD_STATUS.SHOWN,
          rows: selected.rows,
          playerRow: selected.playerRow,
        };

        this.lastShownByWeek.set(weekKey, shown);
        this.board = shown;
      })
      .catch(() => {
        if (nonce !== this.requestNonce) {
          return;
        }

        const cached = this.lastShownByWeek.get(weekKey);
        if (cached !== undefined) {
          this.board = { ...cached, status: WEEKLY_BOARD_STATUS.LAST_KNOWN };
          return;
        }

        this.board = {
          weekKey,
          status: WEEKLY_BOARD_STATUS.UNAVAILABLE,
          rows: [],
          playerRow: null,
        };
      });
  }
}
