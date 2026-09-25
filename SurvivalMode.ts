import type { Lot, GameMode, GameState, RollResult, Mode } from './types.js';
import { t } from './i18n.js';

export class SurvivalMode implements GameMode {
    readonly id: Mode = 'survival';

    get name(): string { return t('mode.survival.name'); }
    get description(): string { return t('mode.survival.description'); }

    calculateWeight(lot: Lot): number {
        return 1 / lot.amount;
    }

    getRollText(rolledLot: Lot): string {
        return t('mode.survival.resultEliminated', { name: rolledLot.name });
    }

    processRoll(rolledLot: Lot, state: GameState): RollResult {
        // The winner is decided from the state AFTER removing the rolled lot.
        const remaining = state.activeLots.filter(l => l.id !== rolledLot.id);

        if (remaining.length === 1) {
            const winner = remaining[0];
            return {
                finished: true,
                winner,
                deactivate: [rolledLot.id],
                message: t('mode.survival.completionMessage', { name: winner.name })
            };
        }

        // More than one remains → continue; 0 is unreachable under the correct
        // lifecycle (App never spins once the last lot is standing).
        return {
            finished: false,
            winner: null,
            deactivate: [rolledLot.id]
        };
    }
}
