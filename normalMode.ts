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
import { formatPercentFloor } from './utils.js';

/**
 * Normal mode.
 *
 * Rules:
 *  - selectionWeight = `amount` (higher amount → higher chance to win);
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

    calculateSelectionWeight(lot: Lot): number {
        return lot.amount;
    }

    getParticipantVisualValue(lot: Lot): number {
        // Visually equivalent to the pre-refactor behaviour (sector size was
        // derived from the selection weight). amount >= 0.01, so this is > 0.
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

    getPresentationData(
        participants: readonly GameParticipantState[],
        lots: readonly Lot[]
    ): ReadonlyMap<string, ModePresentationData> {
        // Normal never eliminates between spins, so the eventual final-win
        // probability equals the current weighted selection probability,
        // amount_i / Σ amount(active). Inactive lots do not contribute to the
        // denominator and are shown as "not participating".
        const byId = new Map(lots.map(l => [l.id, l]));
        let total = 0;
        for (const p of participants) {
            if (!p.active) continue;
            const lot = byId.get(p.lotId);
            if (lot) total += lot.amount;
        }

        const result = new Map<string, ModePresentationData>();
        for (const p of participants) {
            const lot = byId.get(p.lotId);
            const value = p.active && lot && total > 0
                ? formatPercentFloor((lot.amount / total) * 100)
                : '—';
            result.set(p.lotId, { ext: { value } });
        }
        return result;
    }
}
