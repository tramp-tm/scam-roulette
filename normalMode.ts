import type { Lot, GameMode, GameState, RollResult, Mode } from './types.js';
import { t } from './i18n.js';

export class NormalMode implements GameMode {
    readonly id: Mode = 'normal';

    get name(): string { return t('mode.normal.name'); }
    get description(): string { return t('mode.normal.description'); }

    calculateWeight(lot: Lot): number {
        return lot.amount;
    }

    getRollText(rolledLot: Lot): string {
        return t('mode.normal.resultWinner', { name: rolledLot.name });
    }

    processRoll(rolledLot: Lot, _state: GameState): RollResult {
        return {
            finished: true,
            winner: rolledLot,
            deactivate: []
        };
    }
}
