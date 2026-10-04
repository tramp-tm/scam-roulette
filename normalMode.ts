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
 * Normal mode.
 *
 * Rules:
 *  - weight = `amount` (higher amount → higher chance to win);
 *  - one spin ends the game;
 *  - the rolled lot is the winner;
 *  - nobody is eliminated.
 *
 * The mode has no state of its own, but implements the full GameMode
 * contract so it is a first-class strategy alongside stateful modes.
 */
export class NormalMode implements GameMode {
    readonly id: Mode = 'normal';

    get name(): string { return t('mode.normal.name'); }
    get description(): string { return t('mode.normal.description'); }

    createGameState(_lots: readonly Lot[]): GameModeState { return {}; }

    createParticipantState(_lot: Lot): ParticipantModeState { return {}; }

    onParticipantsChanged(state: GameModeState): GameModeState { return state; }

    calculateWeight(lot: Lot): number {
        return lot.amount;
    }

    processRoll(
        rolledLot: Lot,
        _rolled: GameParticipantState,
        participants: readonly GameParticipantState[],
        _lots: readonly Lot[],
        state: GameModeState
    ): { state: GameModeState; participants: GameParticipantState[]; outcome: TurnOutcome } {
        const result: MessageDescriptor = {
            key: 'mode.normal.resultWinner',
            params: { name: rolledLot.name }
        };

        const outcome: TurnOutcome = {
            rolledLotId: rolledLot.id,
            winners: [rolledLot.id],
            eliminated: [],
            changed: [],
            finished: true,
            result
        };

        return { state, participants: [...participants], outcome };
    }

    getParticipantPresentation(): undefined { return undefined; }
}
