import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { loadTestRuntime } from './test-runtime.mjs';

const runtime = loadTestRuntime();
after(runtime.cleanup);
const model = await runtime.importModule('riskyBetModel.js');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
function value(result) {
    assert.equal(result.success, true, JSON.stringify(result));
    return result.value;
}

test('factory gives independent distributions, stable identities and default expectation', () => {
    const a = model.createRiskyBetDistribution();
    const b = model.createRiskyBetDistribution();
    assert.notEqual(a, b);
    assert.notEqual(a.outcomes, b.outcomes);
    a.outcomes.forEach((row, i) => assert.notEqual(row, b.outcomes[i]));
    assert.deepEqual(a.outcomes.map(row => [row.multiplier, row.probability]), [[0.5, 0.1], [1, 0.8], [2, 0.1]]);
    assert.equal(new Set(a.outcomes.map(row => row.id)).size, 3);
    assert.equal(a.outcomes.find(row => row.id === a.baseId).multiplier, 1);
    close(model.totalProbability(a), 1);
    close(model.expectedMultiplier(a), 1.05);
});

function edit(d, id, patch) { return value(model.updateRiskyBetOutcome(d, id, patch)); }
function add(d) { return value(model.addRiskyBetOutcome(d)); }
function invariant(d) {
    close(model.totalProbability(d), 1);
    assert.equal(model.validateRiskyBetDistribution(d).success, true);
    assert.equal(new Set(d.outcomes.map(row => row.id)).size, d.outcomes.length);
    assert.equal(d.outcomes.filter(row => row.id === d.baseId).length, 1);
    d.outcomes.forEach(row => assert.ok(row.probability >= 0 && row.probability <= 1));
}

test('probability edits compensate only base, clamp and return removed chance', () => {
    const original = model.createRiskyBetDistribution();
    const saved = structuredClone(original);
    const first = original.outcomes[0].id, last = original.outcomes[2].id;
    let d = edit(original, first, { probability: 0.4 });
    close(d.outcomes[1].probability, 0.5);
    assert.equal(d.outcomes[2].probability, 0.1);
    d = edit(d, first, { probability: 0.95 });
    close(d.outcomes[0].probability, 0.9);
    close(d.outcomes[1].probability, 0);
    d = value(model.removeRiskyBetOutcome(d, last));
    close(d.outcomes.find(row => row.id === d.baseId).probability, 0.1);
    invariant(d);
    assert.deepEqual(original, saved);
    d = edit(d, first, { probability: -10 });
    assert.equal(d.outcomes[0].probability, 0);
    close(d.outcomes[1].probability, 1);
});

test('duplicates including x1 are ordinary distinct outcomes; base alone is protected', () => {
    let d = model.createRiskyBetDistribution();
    const expectation = model.expectedMultiplier(d);
    d = add(add(d));
    assert.notEqual(d.outcomes[3].id, d.outcomes[4].id);
    assert.deepEqual(d.outcomes.slice(3).map(row => [row.multiplier, row.probability]), [[0, 0], [0, 0]]);
    close(model.expectedMultiplier(d), expectation);
    const extra = d.outcomes[3].id;
    d = edit(d, extra, { multiplier: 1, probability: 0.3 });
    close(d.outcomes[1].probability, 0.5);
    d = edit(d, extra, { multiplier: 4 });
    assert.equal(d.outcomes[3].probability, 0.3);
    d = value(model.removeRiskyBetOutcome(d, extra));
    d = add(d);
    assert.notEqual(d.outcomes.at(-1).id, extra);
    for (const result of [model.removeRiskyBetOutcome(d, d.baseId), model.updateRiskyBetOutcome(d, d.baseId, { probability: 0 }), model.updateRiskyBetOutcome(d, d.baseId, { multiplier: 2 })]) {
        assert.deepEqual(result, { success: false, reason: 'protected_base' });
    }
    invariant(d);
});

test('document example expectation uses model probabilities', () => {
    let d = add(model.createRiskyBetDistribution());
    d = edit(d, d.outcomes[0].id, { multiplier: 0, probability: 0.2 });
    d = edit(d, d.outcomes[3].id, { multiplier: 0.1, probability: 0.2 });
    close(d.outcomes[1].probability, 0.5);
    close(model.expectedMultiplier(d), 0.72);
});

test('invalid edits and numeric drafts never damage last valid model', () => {
    const d = model.createRiskyBetDistribution();
    const saved = structuredClone(d);
    for (const multiplier of [-1, NaN, Infinity, '2', null]) {
        assert.equal(model.updateRiskyBetOutcome(d, d.outcomes[0].id, { multiplier }).success, false);
    }
    for (const probability of [NaN, Infinity, '0.2', null]) {
        assert.equal(model.updateRiskyBetOutcome(d, d.outcomes[0].id, { probability }).success, false);
    }
    assert.deepEqual(model.removeRiskyBetOutcome(d, 'missing'), { success: false, reason: 'outcome_not_found' });
    for (const draft of ['', ' ', 'abc', 'Infinity', '0.2x', '0x10']) {
        assert.deepEqual(model.parseNumericDraft(draft), { success: false, reason: 'invalid_number' });
    }
    assert.equal(value(model.parseNumericDraft(' 0.25 ')), 0.25);
    assert.equal(value(model.parseNumericDraft('0')), 0);
    assert.equal(value(model.parseNumericDraft('1e2')), 100);
    assert.deepEqual(d, saved);
});

test('seeded editing preserves distribution invariants', () => {
    let seed = 12345;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    let d = model.createRiskyBetDistribution();
    for (let i = 0; i < 600; i++) {
        const action = random();
        const rows = d.outcomes.filter(row => row.id !== d.baseId);
        const row = rows[Math.floor(random() * rows.length)];
        if (action < 0.2 || !row) d = add(d);
        else if (action < 0.4) d = value(model.removeRiskyBetOutcome(d, row.id));
        else d = edit(d, row.id, { probability: random() * 2 - 0.5, multiplier: random() * 10 });
        invariant(d);
    }
});

test('weighted selection respects intervals, ids, zero chances and invalid RNG', () => {
    const d = model.createRiskyBetDistribution();
    for (const [random, index] of [[0, 0], [0.099, 0], [0.1, 1], [0.899, 1], [0.9, 2], [1 - Number.EPSILON / 2, 2]]) {
        assert.equal(value(model.selectRiskyBetOutcome(d, () => random)).id, d.outcomes[index].id);
    }
    for (const random of [-0.1, 1, Infinity, NaN, '0']) {
        assert.deepEqual(model.selectRiskyBetOutcome(d, () => random), { success: false, reason: 'invalid_random' });
    }
    let single = add(d);
    single = edit(single, single.outcomes[0].id, { probability: 0 });
    single = edit(single, single.outcomes[2].id, { probability: 0 });
    single = edit(single, single.outcomes[3].id, { multiplier: 0, probability: 1 });
    for (const random of [0, 0.5, 1 - Number.EPSILON / 2]) {
        assert.equal(value(model.selectRiskyBetOutcome(single, () => random)).id, single.outcomes[3].id);
    }
    single = edit(single, single.outcomes[3].id, { multiplier: 1 });
    assert.equal(value(model.selectRiskyBetOutcome(single, () => 0)).id, single.outcomes[3].id);
    // Valid IEEE-754 tolerance can leave a tiny gap: fallback must skip a trailing zero row.
    const gap = structuredClone(single);
    gap.outcomes[3].probability = 1 - Number.EPSILON;
    gap.outcomes.push({ id: 'zero-tail', multiplier: 2, probability: 0 });
    assert.equal(value(model.selectRiskyBetOutcome(gap, () => 1 - Number.EPSILON / 2)).id, gap.outcomes[3].id);
});

test('amount calculation follows both modes and normalizes only final sum', () => {
    for (const [input, expected] of [
        [{ mode: 'add', amount: 1000, riskAmount: 100, multiplier: 2 }, 1200],
        [{ mode: 'add', amount: 1000, riskAmount: 100, multiplier: 0 }, 1000],
        [{ mode: 'all', amount: 1234, multiplier: 0 }, 0.01],
        [{ mode: 'all', amount: 1234, riskAmount: 1, multiplier: 2 }, 2468],
        [{ mode: 'all', amount: 0.07, multiplier: 1 }, 0.07],
        [{ mode: 'all', amount: 0.01, multiplier: 0.5 }, 0.01],
        [{ mode: 'all', amount: 1.001, multiplier: 1 }, 1.01],
        [{ mode: 'add', amount: 1.001, riskAmount: 0.001, multiplier: 2 }, 1.01]
    ]) {
        const result = value(model.calculateRiskyBetAmount(input));
        assert.equal(result.amount, expected);
        assert.equal(result.baseAmount, input.mode === 'add' ? input.amount : 0);
        assert.equal(result.riskAmount, input.mode === 'all' ? input.amount : input.riskAmount);
    }
    for (const amount of [0, -1, NaN, Infinity, '1']) {
        assert.equal(model.calculateRiskyBetAmount({ mode: 'all', amount, multiplier: 1 }).success, false);
    }
    for (const riskAmount of [0, -1, NaN, Infinity, '1']) {
        assert.equal(model.calculateRiskyBetAmount({ mode: 'add', amount: 1, riskAmount, multiplier: 1 }).success, false);
    }
    for (const multiplier of [-1, NaN, Infinity, '1']) {
        assert.equal(model.calculateRiskyBetAmount({ mode: 'all', amount: 1, multiplier }).success, false);
    }
    assert.deepEqual(model.calculateRiskyBetAmount({ mode: 'other', amount: 1, multiplier: 1 }), { success: false, reason: 'invalid_mode' });
    assert.deepEqual(model.calculateRiskyBetAmount({ mode: 'all', amount: Number.MAX_VALUE, multiplier: 2 }), { success: false, reason: 'amount_overflow' });
    assert.deepEqual(model.calculateRiskyBetAmount({ mode: 'add', amount: Number.MAX_VALUE, riskAmount: Number.MAX_VALUE, multiplier: 1 }), { success: false, reason: 'amount_overflow' });
});

test('prepare preflights every reachable result before RNG and freezes detached snapshot', () => {
    let calls = 0;
    const random = () => { calls++; return 0; };
    let d = model.createRiskyBetDistribution();
    const params = { lotId: 'lot-17', amount: Number.MAX_VALUE, mode: 'all', riskAmount: 4, distribution: d };
    assert.deepEqual(model.prepareRiskyBet(params, random), { success: false, reason: 'amount_overflow' });
    assert.equal(calls, 0);
    d = edit(d, d.outcomes[2].id, { probability: 0 });
    const pending = value(model.prepareRiskyBet({ ...params, distribution: d }, random));
    assert.equal(calls, 1);
    assert.equal(pending.lotId, params.lotId);
    assert.equal(pending.originalAmount, params.amount);
    assert.equal(pending.riskAmount, params.amount);
    assert.equal(pending.outcome.id, d.outcomes[0].id);
    assert.equal(pending.durationMs, 7000);
    assert.equal(pending.easing, 'rouletteEaseOut');
    for (const object of [pending, pending.distribution, pending.distribution.outcomes, ...pending.distribution.outcomes, pending.outcome]) {
        assert.equal(Object.isFrozen(object), true);
    }
    d.outcomes[0].multiplier = 100;
    assert.equal(pending.outcome.multiplier, 0.5);
    assert.equal(pending.distribution.outcomes[0].multiplier, 0.5);
    assert.throws(() => { pending.outcome.multiplier = 3; }, TypeError);
});

test('malformed distributions fail before RNG without mutating inputs', () => {
    const d = model.createRiskyBetDistribution();
    for (const change of [
        x => { x.outcomes[0].probability = NaN; },
        x => { x.outcomes[0].probability = -0.1; },
        x => { x.outcomes[0].probability = 0.5; },
        x => { x.outcomes[0].id = x.baseId; },
        x => { x.baseId = 'missing'; },
        x => { x.outcomes[1].multiplier = 2; },
        x => { x.outcomes[0].multiplier = Infinity; }
    ]) {
        const bad = structuredClone(d);
        change(bad);
        const saved = structuredClone(bad);
        const rng = () => { assert.fail('RNG must not be called'); };
        assert.deepEqual(model.prepareRiskyBet({ lotId: 'a', amount: 10, mode: 'all', distribution: bad }, rng), { success: false, reason: 'invalid_distribution' });
        assert.equal(model.addRiskyBetOutcome(bad).success, false);
        assert.deepEqual(bad, saved);
    }
    assert.deepEqual(model.prepareRiskyBet({ lotId: '', amount: 10, mode: 'all', distribution: d }), { success: false, reason: 'invalid_lot_id' });
});
