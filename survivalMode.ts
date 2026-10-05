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
import { formatPercent } from './utils.js';

/**
 * Survival selection weight for an amount — the single source of the mode's
 * selection semantics (also reused by the final-win probability below).
 */
function survivalSelectionWeight(amount: number): number {
    return 1 / amount;
}

/**
 * Practical bound for the exact final-win computation (O(2^n · n)); above it
 * the displayed value degrades to "…" instead of hanging the UI.
 */
const SURVIVAL_EXACT_MAX_ACTIVE = 18;

/**
 * Exact eventual final-win (last-remaining) probabilities for the given active
 * amounts, following the mode's real elimination semantics:
 *
 *   P(S, i) = 1                                if S = {i}
 *   P(S, i) = Σ_{j ∈ S, j ≠ i} p_j(S) · P(S \ {j}, i)
 *
 * where p_j(S) = w_j / Σ w(S) and w = `survivalSelectionWeight(amount)`. Being
 * selected eliminates the lot, so i's own selection contributes nothing.
 * Deterministic and exact — memoised over subsets, never a simulation.
 *
 * Returns `null` when the active count exceeds the exact bound.
 */
function survivalWinProbabilities(amounts: readonly number[]): number[] | null {
    const n = amounts.length;
    if (n === 0) return [];
    if (n === 1) return [1];
    if (n > SURVIVAL_EXACT_MAX_ACTIVE) return null;

    const w = amounts.map(survivalSelectionWeight);
    const full = (1 << n) - 1;

    // Subset weight sums, built from the lowest set bit.
    const sum = new Float64Array(1 << n);
    for (let mask = 1; mask <= full; mask++) {
        const lsb = mask & -mask;
        sum[mask] = sum[mask ^ lsb] + w[31 - Math.clz32(lsb)];
    }

    const memo = new Float64Array(1 << n);
    const result = new Array<number>(n);
    for (let i = 0; i < n; i++) {
        memo.fill(NaN);
        const self = 1 << i;
        const last = (mask: number): number => {
            if (mask === self) return 1;
            const cached = memo[mask];
            if (cached === cached) return cached; // NaN-safe memo hit
            const total = sum[mask];
            let acc = 0;
            let m = mask;
            while (m) {
                const lsb = m & -m;
                m ^= lsb;
                const j = 31 - Math.clz32(lsb);
                if (j !== i) acc += (w[j] / total) * last(mask ^ lsb);
            }
            memo[mask] = acc;
            return acc;
        };
        result[i] = last(full);
    }
    return result;
}

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
        return survivalSelectionWeight(lot.amount);
    }

    getParticipantVisualValue(lot: Lot): number {
        // Visually equivalent to the pre-refactor behaviour: sector size was
        // the selection weight 1/amount. amount >= 0.01, so this is finite.
        return survivalSelectionWeight(lot.amount);
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

    getPresentationData(
        participants: readonly GameParticipantState[],
        lots: readonly Lot[]
    ): ReadonlyMap<string, ModePresentationData> {
        // Eventual final-win probability: accounts for ALL future elimination
        // spins, not merely the next selection. Only active lots participate.
        const byId = new Map(lots.map(l => [l.id, l]));

        const activeIds: string[] = [];
        const amounts: number[] = [];
        for (const p of participants) {
            if (!p.active) continue;
            const lot = byId.get(p.lotId);
            if (!lot) continue;
            activeIds.push(p.lotId);
            amounts.push(lot.amount);
        }
        const indexById = new Map(activeIds.map((id, i) => [id, i]));
        const probs = survivalWinProbabilities(amounts);

        const label: MessageDescriptor = { key: 'mode.survival.extLabel' };
        const result = new Map<string, ModePresentationData>();
        for (const p of participants) {
            let value = '—'; // not participating
            if (p.active) {
                const idx = indexById.get(p.lotId);
                if (idx === undefined) value = '—';
                else if (probs === null) value = '…'; // beyond the exact bound
                else value = formatPercent(probs[idx] * 100);
            }
            result.set(p.lotId, { ext: { label, value } });
        }
        return result;
    }
}
