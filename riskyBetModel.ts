import { LotManager } from './lotManager.js';

export interface RiskyBetOutcome {
    readonly id: string;
    readonly multiplier: number;
    readonly probability: number;
}

export interface RiskyBetDistribution {
    readonly baseId: string;
    readonly outcomes: readonly RiskyBetOutcome[];
    /** Monotonic local identity: removing a row never recycles its id. */
    readonly nextId: number;
}

export type RiskyBetError = 'invalid_distribution' | 'outcome_not_found' | 'protected_base'
    | 'invalid_multiplier' | 'invalid_probability' | 'invalid_number' | 'invalid_random'
    | 'invalid_amount' | 'invalid_risk_amount' | 'invalid_mode' | 'invalid_lot_id'
    | 'amount_overflow';
export type RiskyBetResult<T> = { success: true; value: T }
    | { success: false; reason: RiskyBetError };

export function createRiskyBetDistribution(): RiskyBetDistribution {
    return {
        baseId: 'risk-base', nextId: 3,
        outcomes: [
            { id: 'risk-0', multiplier: 0.5, probability: 0.1 },
            { id: 'risk-base', multiplier: 1, probability: 0.8 },
            { id: 'risk-2', multiplier: 2, probability: 0.1 }
        ]
    };
}

function ok<T>(value: T): RiskyBetResult<T> { return { success: true, value }; }
function error(reason: RiskyBetError): { success: false; reason: RiskyBetError } {
    return { success: false, reason };
}

/** Decimal input boundary only; empty drafts must not silently become zero. */
export function parseNumericDraft(text: string): RiskyBetResult<number> {
    if (typeof text !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim())) {
        return error('invalid_number');
    }
    const number = Number(text);
    return Number.isFinite(number) ? ok(number) : error('invalid_number');
}

export function validateRiskyBetDistribution(d: RiskyBetDistribution): RiskyBetResult<RiskyBetDistribution> {
    if (!d || !Array.isArray(d.outcomes) || !d.outcomes.length
        || !Number.isSafeInteger(d.nextId) || d.nextId < 0) return error('invalid_distribution');
    const ids = new Set<string>();
    for (const row of d.outcomes) {
        if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)
            || !Number.isFinite(row.multiplier) || row.multiplier < 0
            || !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1) {
            return error('invalid_distribution');
        }
        ids.add(row.id);
    }
    const base = d.outcomes.find(row => row.id === d.baseId);
    if (!base || base.multiplier !== 1 || Math.abs(totalProbability(d) - 1) > 1e-12) {
        return error('invalid_distribution');
    }
    return ok(d);
}

export function addRiskyBetOutcome(d: RiskyBetDistribution): RiskyBetResult<RiskyBetDistribution> {
    const valid = validateRiskyBetDistribution(d);
    if (!valid.success) return valid;
    let nextId = d.nextId;
    while (d.outcomes.some(row => row.id === `risk-${nextId}`)) nextId++;
    return ok({ ...d, nextId: nextId + 1,
        outcomes: [...d.outcomes.map(row => ({ ...row })), { id: `risk-${nextId}`, multiplier: 0, probability: 0 }] });
}

export function updateRiskyBetOutcome(
    d: RiskyBetDistribution, id: string,
    patch: { multiplier?: number; probability?: number }
): RiskyBetResult<RiskyBetDistribution> {
    const valid = validateRiskyBetDistribution(d);
    if (!valid.success) return valid;
    if (!d.outcomes.some(row => row.id === id)) return error('outcome_not_found');
    if (id === d.baseId) return error('protected_base');
    if ('multiplier' in patch && (!Number.isFinite(patch.multiplier) || patch.multiplier! < 0)) {
        return error('invalid_multiplier');
    }
    if ('probability' in patch && !Number.isFinite(patch.probability)) return error('invalid_probability');
    const others = d.outcomes.filter(row => row.id !== d.baseId && row.id !== id)
        .reduce((sum, row) => sum + row.probability, 0);
    const previous = d.outcomes.find(row => row.id === id)!;
    const probability = 'probability' in patch
        ? Math.min(Math.max(patch.probability!, 0), Math.max(0, 1 - others)) : previous.probability;
    return ok({ ...d, outcomes: d.outcomes.map(row => {
        if (row.id === id) return { ...row, multiplier: patch.multiplier ?? row.multiplier, probability };
        if (row.id === d.baseId && 'probability' in patch) return { ...row, probability: Math.max(0, 1 - others - probability) };
        return { ...row };
    }) });
}

export function removeRiskyBetOutcome(d: RiskyBetDistribution, id: string): RiskyBetResult<RiskyBetDistribution> {
    const valid = validateRiskyBetDistribution(d);
    if (!valid.success) return valid;
    const removed = d.outcomes.find(row => row.id === id);
    if (!removed) return error('outcome_not_found');
    if (id === d.baseId) return error('protected_base');
    return ok({ ...d, outcomes: d.outcomes.filter(row => row.id !== id).map(row => ({ ...row,
        probability: row.id === d.baseId ? Math.min(1, row.probability + removed.probability) : row.probability
    })) });
}

export type RiskyBetMode = 'add' | 'all';
export interface RiskyBetParameters {
    readonly amount: number;
    readonly mode: RiskyBetMode;
    /** Ignored in all mode: the entire original amount is always at risk. */
    readonly riskAmount?: number;
}
export interface RiskyBetAmount {
    readonly baseAmount: number;
    readonly riskAmount: number;
    readonly rawAmount: number;
    readonly amount: number;
}
export interface PrepareRiskyBetParameters extends RiskyBetParameters {
    readonly lotId: string;
    readonly distribution: RiskyBetDistribution;
}
export interface PendingRiskyBet extends RiskyBetAmount {
    readonly lotId: string;
    readonly originalAmount: number;
    readonly mode: RiskyBetMode;
    readonly distribution: RiskyBetDistribution;
    readonly outcome: RiskyBetOutcome;
    readonly durationMs: 7000;
    readonly easing: 'rouletteEaseOut';
}

/** Half-open intervals, with a positive-only fallback for floating point gaps. */
export function selectRiskyBetOutcome(
    distribution: RiskyBetDistribution, random: () => number = Math.random
): RiskyBetResult<RiskyBetOutcome> {
    const valid = validateRiskyBetDistribution(distribution);
    if (!valid.success) return valid;
    // Detach before calling user-provided random, which may have side effects.
    const positive = distribution.outcomes.filter(row => row.probability > 0).map(row => ({ ...row }));
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) return error('invalid_random');
    let cumulative = 0;
    for (const row of positive) {
        cumulative += row.probability;
        if (sample < cumulative) return ok(row);
    }
    return ok(positive[positive.length - 1]);
}

/** Ordinary number arithmetic; LotManager alone owns final amount policy. */
export function calculateRiskyBetAmount(
    parameters: RiskyBetParameters & { readonly multiplier: number }
): RiskyBetResult<RiskyBetAmount> {
    const { amount, mode, multiplier } = parameters;
    if (mode !== 'add' && mode !== 'all') return error('invalid_mode');
    if (!Number.isFinite(amount) || amount <= 0) return error('invalid_amount');
    const riskAmount = mode === 'all' ? amount : parameters.riskAmount;
    if (riskAmount === undefined || !Number.isFinite(riskAmount) || riskAmount <= 0) return error('invalid_risk_amount');
    if (!Number.isFinite(multiplier) || multiplier < 0) return error('invalid_multiplier');
    const baseAmount = mode === 'add' ? amount : 0;
    const rawAmount = baseAmount + riskAmount * multiplier;
    const normalized = LotManager.normalizeAmount(rawAmount);
    if (normalized === null) return error('amount_overflow');
    return ok({ baseAmount, riskAmount, rawAmount, amount: normalized });
}

/** No lot mutation: prepare once, animate this snapshot, apply later via updateLot. */
export function prepareRiskyBet(
    parameters: PrepareRiskyBetParameters, random: () => number = Math.random
): RiskyBetResult<PendingRiskyBet> {
    const { lotId, amount: originalAmount, mode, riskAmount } = parameters;
    if (typeof lotId !== 'string' || !lotId) return error('invalid_lot_id');
    const valid = validateRiskyBetDistribution(parameters.distribution);
    if (!valid.success) return valid;
    const distribution: RiskyBetDistribution = Object.freeze({
        baseId: parameters.distribution.baseId,
        nextId: parameters.distribution.nextId,
        outcomes: Object.freeze(parameters.distribution.outcomes.map(row => Object.freeze({ ...row })))
    });
    const amounts = new Map<string, RiskyBetAmount>();
    for (const row of distribution.outcomes) {
        if (row.probability <= 0) continue;
        const calculation = calculateRiskyBetAmount({ amount: originalAmount, mode, riskAmount, multiplier: row.multiplier });
        if (!calculation.success) return calculation;
        amounts.set(row.id, calculation.value);
    }
    const selected = selectRiskyBetOutcome(distribution, random);
    if (!selected.success) return selected;
    const outcome = distribution.outcomes.find(row => row.id === selected.value.id)!;
    return ok(Object.freeze({
        lotId, originalAmount, mode, distribution, outcome,
        ...amounts.get(outcome.id)!, durationMs: 7000 as const, easing: 'rouletteEaseOut' as const
    }));
}

export function totalProbability(distribution: RiskyBetDistribution): number {
    return distribution.outcomes.reduce((sum, row) => sum + row.probability, 0);
}

export function expectedMultiplier(distribution: RiskyBetDistribution): number {
    return distribution.outcomes.reduce((sum, row) => sum + row.multiplier * row.probability, 0);
}
