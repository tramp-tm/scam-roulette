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
 * Survival selection weight for an amount — the single source of the mode's
 * selection semantics (also reused by the final-win probability below).
 */
function survivalSelectionWeight(amount: number): number {
    return 1 / amount;
}

/**
 * Practical bound for the exact final-win computation (O(2^n · n)); above it the
 * deterministic trapezoidal quadrature is used instead. No simulation.
 */
const SURVIVAL_EXACT_MAX_ACTIVE = 18;

/** Trapezoidal quadrature step count (fixed → predictable per-call load). */
const SURVIVAL_QUADRATURE_STEPS = 1000;

/**
 * Tail constant for the integration limit `T_max = (ln n + c) / λ_min`. The mass
 * left outside the integral is ≤ e^(−c)/n per lot, i.e. ≤ e^(−c) ≈ 1.7e-5 in
 * total at c = 11 — below the one-decimal display resolution (0.1%).
 */
const SURVIVAL_QUADRATURE_TAIL_C = 11;

/**
 * Exact eventual final-win (last-remaining) probabilities for the active amounts,
 * following the mode's real elimination semantics. Deterministic and exact —
 * memoised over subsets, never a simulation.
 *
 * The exact path of `survivalWinProbabilities`; call that dispatcher instead —
 * this is only valid while the active count stays small.
 */
function survivalWinProbabilitiesExact(amounts: readonly number[]): number[] {
    const n = amounts.length;
    if (n === 0) return [];
    if (n === 1) return [1];

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
 * Approximate path for large active sets: deterministic trapezoidal quadrature of
 * the exponential-race (Plackett–Luce last-place) law, equal in value to the exact
 * DP. The integration limit is `(ln n + SURVIVAL_QUADRATURE_TAIL_C) / λ_min` with
 * `λ = survivalSelectionWeight(amount)`, so the truncated tail mass stays
 * ≤ e^(−SURVIVAL_QUADRATURE_TAIL_C).
 *
 * The per-step product over the other lots uses prefix/suffix products — no
 * division by the omitted factor, no epsilon hacks; underflow to 0 happens only
 * where the true density mass is negligible.
 */
function survivalWinProbabilitiesQuadrature(amounts: readonly number[]): number[] {
    const n = amounts.length;
    if (n === 0) return [];
    if (n === 1) return [1];

    const lambda = new Float64Array(n);
    let lambdaMin = Infinity;
    for (let i = 0; i < n; i++) {
        const l = survivalSelectionWeight(amounts[i]);
        lambda[i] = l;
        if (l < lambdaMin) lambdaMin = l;
    }
    // Defensive: amounts are finite and > 0 (LotManager ≥ 0.01), so λ_min is
    // finite and positive; fall back to the symmetric answer otherwise.
    if (!(lambdaMin > 0) || !isFinite(lambdaMin)) {
        return amounts.map(() => 1 / n);
    }

    const tMax = (Math.log(n) + SURVIVAL_QUADRATURE_TAIL_C) / lambdaMin;
    const steps = SURVIVAL_QUADRATURE_STEPS;
    const dt = tMax / steps;

    const ex = new Float64Array(n);   // e^(−λ_i·t)
    const om = new Float64Array(n);   // 1 − e^(−λ_i·t)
    const pref = new Float64Array(n);
    const suff = new Float64Array(n);
    const acc = new Float64Array(n);  // accumulated trapezoid integrals

    for (let k = 0; k <= steps; k++) {
        const t = k * dt;

        for (let i = 0; i < n; i++) {
            const e = Math.exp(-lambda[i] * t);
            ex[i] = e;
            om[i] = 1 - e;
        }

        pref[0] = om[0];
        for (let i = 1; i < n; i++) pref[i] = pref[i - 1] * om[i];

        suff[n - 1] = om[n - 1];
        for (let i = n - 2; i >= 0; i--) suff[i] = suff[i + 1] * om[i];

        const w = k === 0 || k === steps ? dt / 2 : dt; // trapezoid weights
        for (let i = 0; i < n; i++) {
            const others = (i > 0 ? pref[i - 1] : 1) * (i < n - 1 ? suff[i + 1] : 1);
            acc[i] += w * lambda[i] * ex[i] * others;
        }
    }

    let total = 0;
    for (let i = 0; i < n; i++) total += acc[i];
    if (!(total > 0)) return amounts.map(() => 1 / n);

    const result = new Array<number>(n);
    for (let i = 0; i < n; i++) result[i] = acc[i] / total;
    return result;
}

/**
 * Eventual final-win probabilities for the active amounts (sum ≈ 1): exact DP
 * while the active count stays small, deterministic quadrature beyond the bound.
 * Never a simulation.
 */
function survivalWinProbabilities(amounts: readonly number[]): number[] {
    return amounts.length <= SURVIVAL_EXACT_MAX_ACTIVE
        ? survivalWinProbabilitiesExact(amounts)
        : survivalWinProbabilitiesQuadrature(amounts);
}

/**
 * Survival mode (elimination).
 *
 * Rules:
 *  - xValue = `1 / amount` (higher amount → lower chance to be eliminated);
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

    calculateSelectionWeight(lot: Lot, _state: GameModeState): number {
        return survivalSelectionWeight(lot.amount);
    }

    getParticipantMagnitude(_lot: Lot): number | undefined {
        // Axis 2 stays empty on purpose: a magnitude here would only duplicate
        // the chance (`xValue = 1/amount`). An ABSENT magnitude is rendered by
        // every visualization at its maximum size, which is the previous look.
        return undefined;
    }

    processRoll(
        rolledLot: Lot,
        participants: readonly GameParticipantState[],
        lotById: ReadonlyMap<string, Lot>,
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
            const winnerLot = lotById.get(winnerId);

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
        lotById: ReadonlyMap<string, Lot>
    ): ReadonlyMap<string, ModePresentationData> {
        // Eventual final-win probability: accounts for ALL future elimination
        // spins, not merely the next selection. Only active lots participate.

        const activeIds: string[] = [];
        const amounts: number[] = [];
        for (const p of participants) {
            if (!p.active) continue;
            const lot = lotById.get(p.lotId);
            if (!lot) continue;
            activeIds.push(p.lotId);
            amounts.push(lot.amount);
        }
        const indexById = new Map(activeIds.map((id, i) => [id, i]));
        const probs = survivalWinProbabilities(amounts);

        const result = new Map<string, ModePresentationData>();
        for (const p of participants) {
            let value = '—'; // not participating
            if (p.active) {
                const idx = indexById.get(p.lotId);
                value = idx === undefined ? '—' : formatPercentFloor(probs[idx] * 100);
            }
            result.set(p.lotId, { ext: { value } });
        }
        return result;
    }
}
