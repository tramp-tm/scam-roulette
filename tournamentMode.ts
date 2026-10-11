import type {
    GameMode,
    GameModeState,
    GameParticipantState,
    Lot,
    MessageDescriptor,
    Mode,
    ModePresentationData,
    ParticipantModeState,
    TurnOutcome
} from './types.js';
import { t } from './i18n.js';

/** Number of lots drawn into each round's mini-roulette. Lives in the mode. */
const TOURNAMENT_SIZE = 3;

/**
 * Game-level state: the lots of the CURRENT round's mini-roulette. `null` while
 * resting — the group exists only between `prepareTurn` (spin) and `processRoll`
 * (finish), so the resting view is the whole pool (uniform).
 */
interface TournamentGameState {
    groupIds: ReadonlySet<string> | null;
}

/**
 * Uniform draw of up to `size` distinct ids (partial Fisher–Yates shuffle). This
 * is a local lottery, not a roulette: the group is drawn between rounds, while
 * the elimination itself always goes through `RouletteEngine`.
 */
function pickTournamentGroup(ids: readonly string[], size: number): string[] {
    const pool = [...ids];
    const n = Math.min(size, pool.length);
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(Math.random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
}

/** Deactivates the rolled participant (pure — returns a new array). */
function eliminate(
    participants: readonly GameParticipantState[],
    lotId: string
): GameParticipantState[] {
    return participants.map(p => (p.lotId === lotId ? { ...p, active: false } : p));
}

/**
 * Tournament elimination.
 *
 * Rules:
 *  - each spin runs a MINI-ROULETTE over a group of `TOURNAMENT_SIZE` lots drawn
 *    uniformly from the active pool (`prepareTurn`, a local lottery);
 *  - inside the group the chance axis is `1 / amount` (a lower amount is more
 *    likely to go); outside the group `xValue = 0` — zero chance in this round;
 *  - at rest (no group) every active lot has `xValue = 1`, so the wheel shows
 *    the whole pool uniformly;
 *  - the rolled lot is eliminated and the group is dropped, so the next resting
 *    view is the pool minus the eliminated lot;
 *  - the winner is decided from the state AFTER removing the rolled lot (like
 *    Survival, the last lot standing is never spun again);
 *  - axis 2 stays empty (`yValue = undefined`): visualizations render every lot
 *    at their maximum size.
 *
 * The mode owns only `groupIds`; per-participant state is empty, and the group
 * never survives a roll.
 */
export class TournamentMode implements GameMode {
    readonly id: Mode = 'tournament';

    get name(): string {
        return t('mode.tournament.name');
    }

    get description(): string {
        return t('mode.tournament.description');
    }

    createGameState(_lots: readonly Lot[]): GameModeState {
        return { groupIds: null };
    }

    createParticipantState(_lot: Lot): ParticipantModeState {
        return {};
    }

    onParticipantsChanged(
        _state: GameModeState,
        _participants: readonly GameParticipantState[],
        _lots: readonly Lot[]
    ): GameModeState {
        // Reachable only while unlocked (before the first spin); the group is
        // always null at rest, so there is nothing to reconcile.
        return { groupIds: null };
    }

    prepareTurn(participants: readonly GameParticipantState[]): GameModeState {
        const activeIds = participants.filter(p => p.active).map(p => p.lotId);
        return { groupIds: new Set(pickTournamentGroup(activeIds, TOURNAMENT_SIZE)) };
    }

    calculateSelectionWeight(lot: Lot, state: GameModeState): number {
        const gs = state as TournamentGameState;
        if (!gs.groupIds) return 1;                          // resting: uniform pool
        return gs.groupIds.has(lot.id) ? 1 / lot.amount : 0; // group: inverted weight
    }

    getParticipantMagnitude(): number | undefined {
        // Axis 2 stays empty on purpose: the tournament has no magnitude of its
        // own, so every visualization uses its maximum size.
        return undefined;
    }

    processRoll(
        rolledLot: Lot,
        participants: readonly GameParticipantState[],
        lotById: ReadonlyMap<string, Lot>,
        _state: GameModeState
    ): { state: GameModeState; participants: GameParticipantState[]; outcome: TurnOutcome } {
        // The winner is decided from the state AFTER removing the rolled lot.
        const remaining = participants.filter(p => p.active && p.lotId !== rolledLot.id);

        const result: MessageDescriptor = {
            key: 'mode.tournament.resultEliminated',
            params: { name: rolledLot.name }
        };

        if (remaining.length === 1) {
            const winnerId = remaining[0].lotId;
            const winnerLot = lotById.get(winnerId);

            const outcome: TurnOutcome = {
                rolledLotId: rolledLot.id,
                winners: [winnerId],
                eliminated: [rolledLot.id],
                changed: [rolledLot.id],
                finished: true,
                result,
                message: {
                    key: 'mode.tournament.completionMessage',
                    params: { name: winnerLot ? winnerLot.name : '' }
                }
            };
            return {
                state: { groupIds: null },
                participants: eliminate(participants, rolledLot.id),
                outcome
            };
        }

        // Degenerate case: the rolled lot was the only active participant.
        // There is no elimination to perform — declare it the winner so the
        // session reaches a proper terminal state instead of leaving the game
        // unable to progress.
        if (remaining.length === 0) {
            const outcome: TurnOutcome = {
                rolledLotId: rolledLot.id,
                winners: [rolledLot.id],
                eliminated: [],
                changed: [],
                finished: true,
                result,
                message: {
                    key: 'mode.tournament.completionMessage',
                    params: { name: rolledLot.name }
                }
            };
            return { state: { groupIds: null }, participants: [...participants], outcome };
        }

        // Round over: the rolled lot leaves, the group is dropped (back to pool).
        const outcome: TurnOutcome = {
            rolledLotId: rolledLot.id,
            winners: [],
            eliminated: [rolledLot.id],
            changed: [rolledLot.id],
            finished: false,
            result
        };
        return {
            state: { groupIds: null },
            participants: eliminate(participants, rolledLot.id),
            outcome
        };
    }

    getPresentationData(
        participants: readonly GameParticipantState[],
        _lotById: ReadonlyMap<string, Lot>,
        state: GameModeState
    ): ReadonlyMap<string, ModePresentationData> {
        const gs = state as TournamentGameState;
        const result = new Map<string, ModePresentationData>();
        if (!gs.groupIds) return result;   // resting: no group, no markers

        for (const p of participants) {
            if (p.active && gs.groupIds.has(p.lotId)) {
                // The current mini-roulette is marked in the list only — the
                // wheel already shows the group through its sectors.
                result.set(p.lotId, { accent: { kind: 'info', targets: ['list'] } });
            }
        }
        return result;
    }
}
