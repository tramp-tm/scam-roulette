import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { loadTestRuntime } from './test-runtime.mjs';

const runtime = loadTestRuntime();
after(() => runtime.cleanup());
const { RiskyBetStripRenderer } = await runtime.importModule('riskyBetStripRenderer.js');
const { RouletteEngine } = await runtime.importModule('rouletteEngine.js');

// Seed visual landing randomness; the domain's chosen id is always supplied explicitly.
const originalRandom = Math.random;
let seed = 17;
Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
after(() => { Math.random = originalRandom; });

function fixture({ width = 420, height = 140, dpr = 1, observer = true } = {}) {
    const original = { window: globalThis.window, ResizeObserver: globalThis.ResizeObserver };
    const calls = [];
    const context = new Proxy({}, {
        get(target, key) {
            if (!(key in target)) target[key] = (...args) => calls.push([key, ...args]);
            return target[key];
        },
        set(target, key, value) { target[key] = value; return true; }
    });
    const listeners = new Set();
    const observers = [];
    const window = { devicePixelRatio: dpr,
        addEventListener(type, callback) { assert.equal(type, 'resize'); listeners.add(callback); },
        removeEventListener(type, callback) { assert.equal(type, 'resize'); listeners.delete(callback); }
    };
    globalThis.window = window;
    globalThis.ResizeObserver = observer ? class {
        constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
        observe(target) { this.target = target; }
        disconnect() { this.disconnected = true; }
    } : undefined;
    const size = { width, height };
    const canvas = { width: 0, height: 0, getContext: () => context,
        getBoundingClientRect: () => ({ ...size }) };
    const renderer = new RiskyBetStripRenderer(canvas);
    return { renderer, canvas, calls, size, window, listeners, observers,
        resize() { for (const item of observers) item.callback([]); for (const listener of listeners) listener(); },
        close() { renderer.destroy(); Object.assign(globalThis, original); }
    };
}

const outcomes = [
    { id: 'zero', multiplier: 99, probability: 0 },
    { id: 'base', multiplier: 1, probability: 0.8 },
    { id: 'extra-one', multiplier: 1, probability: 0.05 },
    { id: 'double', multiplier: 2, probability: 0.15 }
];

test('equal cards exclude zero probability and land on the requested stable id, including duplicate x1', () => {
    const f = fixture();
    try {
        f.renderer.setOutcomes(outcomes);
        assert.throws(() => f.renderer.computeSpinTarget('zero', 7000));
        assert.throws(() => f.renderer.computeSpinTarget('missing', 7000));
        for (const id of ['base', 'extra-one', 'double']) {
            const target = f.renderer.computeSpinTarget(id, 7000);
            assert.ok(target > f.renderer.getAnimationValue());
            f.renderer.setAnimationValue(target);
            f.calls.length = 0;
            f.renderer.render();
            assert.equal(f.renderer.getCursorOutcomeId(), id);
            const labels = f.calls.filter(call => call[0] === 'fillText');
            assert.ok(labels.length > 1);
            assert.ok(labels.every(call => call[1] !== 'x99'));
            const cards = f.calls.filter(call => call[0] === 'fillRect' && call[3] < f.size.width);
            assert.equal(new Set(cards.map(call => call[3])).size, 1, 'probabilities do not size cards');
            // Labels repeat in positive-outcome order; locate the actual drawn winning card.
            const hit = cards.findIndex(([, x, , width]) => x <= f.size.width / 2 && x + width > f.size.width / 2);
            assert.notEqual(hit, -1);
            assert.equal(labels[hit][1], `x${outcomes.find(row => row.id === id).multiplier}`);
            assert.ok(f.calls.some(call => call[0] === 'moveTo' && call[1] === f.size.width / 2), 'fixed pointer');
        }
    } finally { f.close(); }
});

test('DPR geometry stays frozen during a spin and deferred resize preserves the winning id without RNG', () => {
    for (const width of [180, 420, 735]) {
        const f = fixture({ width, dpr: 2 });
        const savedRandom = Math.random;
        try {
            f.renderer.setOutcomes(outcomes);
            assert.equal(f.canvas.width, width * 2);
            assert.equal(f.canvas.height, 280);
            assert.equal(f.observers[0].target, f.canvas);
            assert.ok(f.calls.some(call => call[0] === 'setTransform' && call[1] === 2 && call[4] === 2));
            f.renderer.setSpinning(true);
            const target = f.renderer.computeSpinTarget('extra-one', 7000);
            f.size.width = width + 257;
            f.size.height = 160;
            f.window.devicePixelRatio = 1.5;
            f.resize();
            assert.equal(f.canvas.width, width * 2, 'bitmap remains frozen');
            f.renderer.setAnimationValue(target);
            f.renderer.render();
            assert.equal(f.renderer.getCursorOutcomeId(), 'extra-one');
            Math.random = () => { throw new Error('resize must not reroll'); };
            f.renderer.setSpinning(false);
            assert.equal(f.canvas.width, Math.round(f.size.width * 1.5));
            assert.equal(f.canvas.height, 240);
            assert.equal(f.renderer.getCursorOutcomeId(), 'extra-one');
            f.size.width += 71;
            f.resize();
            assert.equal(f.renderer.getCursorOutcomeId(), 'extra-one', 'later idle resize also preserves winner');
        } finally { Math.random = savedRandom; f.close(); }
    }
});

test('passes actual geometry to RouletteEngine and targets each id independently of its label', () => {
    const f = fixture({ width: 315 });
    const compute = RouletteEngine.computeFinalScrollOffset;
    try {
        f.renderer.setOutcomes(outcomes);
        f.renderer.setAnimationValue(125);
        f.calls.length = 0;
        f.renderer.render();
        const cardWidth = f.calls.find(call => call[0] === 'fillRect' && call[3] < f.size.width)[3];
        let received;
        RouletteEngine.computeFinalScrollOffset = (...args) => { received = args; return compute(...args); };
        const target = f.renderer.computeSpinTarget('extra-one', 7000);
        assert.deepEqual(received, [cardWidth, cardWidth, 3 * cardWidth, 125, 7000, 315]);
        const cursorIndex = Math.floor((((target + 315 / 2) % (3 * cardWidth)) + 3 * cardWidth) % (3 * cardWidth) / cardWidth);
        assert.equal(cursorIndex, 1, 'independent geometry check distinguishes the two x1 ids');
    } finally { RouletteEngine.computeFinalScrollOffset = compute; f.close(); }
});

test('one positive outcome repeats correctly; reset clears scalar but keeps outcomes; empty strip has no cursor', () => {
    const f = fixture({ width: 270, dpr: 1.25 });
    try {
        assert.equal(f.renderer.getCursorOutcomeId(), null);
        const input = [{ id: 'excluded', multiplier: 77, probability: 0 },
            { id: 'only', multiplier: 1, probability: 1 }];
        f.renderer.setOutcomes(input);
        input[1].id = 'mutated';
        input[1].multiplier = 88;
        f.renderer.setAnimationValue(f.renderer.computeSpinTarget('only', 7000));
        assert.equal(f.renderer.getCursorOutcomeId(), 'only', 'renderer owns detached presentation rows');
        f.calls.length = 0;
        f.renderer.reset();
        assert.equal(f.renderer.getAnimationValue(), 0);
        assert.equal(f.renderer.getCursorOutcomeId(), 'only');
        assert.ok(f.calls.some(call => call[0] === 'clearRect'), 'reset redraws');
        assert.ok(f.calls.filter(call => call[0] === 'fillText').every(call => call[1] === 'x1'));
        f.renderer.setOutcomes([]);
        assert.equal(f.renderer.getCursorOutcomeId(), null);
        assert.throws(() => f.renderer.computeSpinTarget('only', 7000));
    } finally { f.close(); }
});

test('initial zero layout recovers when shown via observer or window fallback; destroy disconnects both', () => {
    for (const observer of [true, false]) {
        const f = fixture({ width: 0, height: 0, observer });
        try {
            f.renderer.setOutcomes(outcomes);
            assert.equal(f.renderer.getCursorOutcomeId(), null);
            assert.throws(() => f.renderer.computeSpinTarget('base', 7000));
            f.size.width = 360;
            f.size.height = 140;
            f.window.devicePixelRatio = 2;
            f.resize();
            assert.equal(f.canvas.width, 720);
            assert.equal(f.canvas.height, 280);
            f.renderer.setAnimationValue(f.renderer.computeSpinTarget('base', 7000));
            assert.equal(f.renderer.getCursorOutcomeId(), 'base');
            assert.equal(f.listeners.size, 1);
            f.renderer.destroy();
            f.renderer.destroy();
            assert.equal(f.listeners.size, 0);
            assert.ok(f.observers.every(item => item.disconnected));
            f.calls.length = 0;
            f.size.width = 600;
            f.resize(); // Exercise a late already-queued observer notification.
            f.renderer.render();
            f.renderer.reset();
            f.renderer.setSpinning(false);
            assert.equal(f.calls.length, 0, 'no canvas work after teardown');
            assert.equal(f.canvas.width, 720);
        } finally { f.close(); }
    }
});

test('invalid animation values and duration fail fast before invoking engine RNG', () => {
    const f = fixture();
    const savedRandom = Math.random;
    try {
        f.renderer.setOutcomes(outcomes);
        Math.random = () => { throw new Error('unexpected RNG'); };
        for (const value of [NaN, Infinity, -Infinity]) {
            assert.throws(() => f.renderer.setAnimationValue(value), /finite/i);
        }
        for (const duration of [NaN, Infinity, -1]) {
            assert.throws(() => f.renderer.computeSpinTarget('base', duration), /duration/i);
        }
        assert.equal(f.renderer.getAnimationValue(), 0);
    } finally { Math.random = savedRandom; f.close(); }
});
