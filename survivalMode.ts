import type {
    GameMode,
    GameModeState,
    GameParticipantState,
    Lot,
    MessageDescriptor,
    Mode,
    ParticipantModeState,
    TurnOutcome
} from './types.js';
import { t } from './i18n.js';

/**
 * Survival mode (elimination).
 *
 * Rules:
 *  - selectionWeight = `1 / amount` (higher amount → lower chance to be eliminated);
 *  - each spin eliminates the rolled lot;
 *  - the winner is decided from the state AFTER removing the rolled lot, so
 *    the last lot standing is never spun again;
 *  - a spun participant that was the only active one wins without being
 *    eliminated (degenerate case — the game must still reach a terminal
 *    state instead of stalling with no participants).
 *
 * The mode has no state of its own, but implements the full GameMode
 * contract so it is a first-class strategy alongside stateful modes.
 */
export class SurvivalMode implements GameMode {
    readonly id: Mode = 'survival';

    get name(): string { return t('mode.survival.name'); }
    get description(): string { return t('mode.survival.description'); }

    createGameState(_lots: readonly Lot[]): GameModeState { return {}; }

    createParticipantState(_lot: Lot): ParticipantModeState { return {}; }

    onParticipantsChanged(state: GameModeState): GameModeState { return state; }

    calculateSelectionWeight(lot: Lot): number {
        return 1 / lot.amount;
    }

    getParticipantVisualValue(lot: Lot): number {
        // Visually equivalent to the pre-refactor behaviour: sector size was
        // the selection weight 1/amount. amount >= 0.01, so this is finite.
        return 1 / lot.amount;
    }

    processRoll(
        rolledLot: Lot,
        _rolled: GameParticipantState,
        participants: readonly GameParticipantState[],
        lots: readonly Lot[],
        state: GameModeState
    ): { state: GameModeState; participants: GameParticipantState[]; outcome: TurnOutcome } {
        // The winner is decided from the state AFTER removing the rolled lot.
        const remaining = participants.filter(p => p.active && p.lotId !== rolledLot.id);

        const result: MessageDescriptor = {
            key: 'mode.survival.resultEliminated',
            params: { name: rolledLot.name }
        };

        if (remaining.length === 1) {
            const winnerId = remaining[0].lotId;
            const winnerLot = lots.find(l => l.id === winnerId);

            const outcome: TurnOutcome = {
                rolledLotId: rolledLot.id,
                winners: [winnerId],
                eliminated: [rolledLot.id],
                changed: [rolledLot.id],
                finished: true,
                result,
                message: {
                    key: 'mode.survival.completionMessage',
                    params: { name: winnerLot ? winnerLot.name : '' }
                }
            };
            return {
                state,
                participants: participants.map(p =>
                    p.lotId === rolledLot.id ? { ...p, active: false } : p
                ),
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
                    key: 'mode.survival.completionMessage',
                    params: { name: rolledLot.name }
                }
            };
            return { state, participants: [...participants], outcome };
        }

        // More than one remains → continue, eliminating the rolled lot.
        const outcome: TurnOutcome = {
            rolledLotId: rolledLot.id,
            winners: [],
            eliminated: [rolledLot.id],
            changed: [rolledLot.id],
            finished: false,
            result
        };
        return {
            state,
            participants: participants.map(p =>
                p.lotId === rolledLot.id ? { ...p, active: false } : p
            ),
            outcome
        };
    }

    getParticipantPresentation(): undefined { return undefined; }
}
