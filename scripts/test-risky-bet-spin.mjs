import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTestRuntime } from './test-runtime.mjs';
import { installDomEnvironment } from './dom-test-environment.mjs';
const runtime = loadTestRuntime();
after(runtime.cleanup);
writeFileSync(join(runtime.directory, 'i18n.js'), `
const dictionaries = ${JSON.stringify(Object.fromEntries(['en', 'ru'].map(lang => [lang, JSON.parse(readFileSync(new URL('../locales/' + lang + '.json', import.meta.url)))])))};
export const t = (key, params = {}) => (dictionaries.en[key] ?? key).replace(/{{(\\w+)}}/g, (_, name) => String(params[name] ?? ''));
export const translateDOM = (root = document) => root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
export const initI18n = async () => {};
export const syncDocumentLang = () => {};
export default { language: 'en', changeLanguage: (_lang, cb) => cb?.() };
`);
const model = await runtime.importModule('riskyBetModel.js');
const { LotManager } = await runtime.importModule('lotManager.js');
const { GameSession } = await runtime.importModule('gameSession.js');

async function fixture({ amount = 1000, multiplier, presentationFailure = false } = {}) {
    const env = installDomEnvironment();
    const saved = new Map();
    function expose(key, value) { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
    let clock = 0, next = 1, commits = 0, writes = 0;
    const frames = new Map();
    expose('performance', { now: () => clock });
    expose('requestAnimationFrame', cb => { const id = next++; frames.set(id, cb); return id; });
    expose('cancelAnimationFrame', id => frames.delete(id));
    const create = env.document.createElement;
    const ctx = new Proxy({ measureText: text => ({ width: text.length * 8 }) }, { get: (target, key) => target[key] ?? (() => {}) });
    env.document.createElement = tag => {
        const node = create(tag);
        if (tag === 'canvas') {
            node.getContext = () => ctx;
            node.getBoundingClientRect = () => ({ width: node.isConnected ? 400 : 0, height: node.isConnected ? 140 : 0 });
        }
        return node;
    };
    env.window.devicePixelRatio = 2;
    const { App } = await runtime.importModule('app.js');
    const { RiskyBetDialog } = await runtime.importModule('riskyBetDialog.js');
    const manager = new LotManager([]);
    const lot = manager.addLot('Target', amount, '#123456').lot;
    const session = new GameSession('normal', () => manager.getAllLots());
    const app = Object.create(App.prototype);
    Object.assign(app, { lotManager: manager, gameSession: session, settings: { riskyBetsEnabled: true }, outcomeAccents: new Map(),
        updateUI() { if (presentationFailure) throw new Error('display failure'); }, visualizationDriver: { refresh() {} } });
    const update = manager.updateLot.bind(manager);
    manager.updateLot = (...args) => { writes++; return update(...args); };
    let distribution = model.createRiskyBetDistribution();
    if (multiplier !== undefined) {
        distribution = model.updateRiskyBetOutcome(distribution, 'risk-2', { probability: 0 }).value;
        distribution = model.updateRiskyBetOutcome(distribution, 'risk-0', { multiplier, probability: 1 }).value;
    }
    const dialog = new RiskyBetDialog({ getLots: () => manager.getAllLots(), getDistribution: () => distribution,
        onDistributionChange: d => { distribution = d; }, onClosed: () => { app.riskyBetDialog = null; },
        canRisk: () => app.settings.riskyBetsEnabled && !session.isSessionLocked,
        onCommit: request => { commits++; assert.equal(dialog.isCommitting, true); return app.commitRiskyBet(request); }
    });
    app.riskyBetDialog = dialog;
    dialog.open();
    const root = env.document.querySelector('.risky-bet-dialog');
    const q = selector => root.querySelector(selector);
    const editRisk = value => { const input = q('[data-field="riskAmount"]'); input.value = String(value); input.dispatchEvent(new Event('input')); };
    return { ...env, dialog, app, manager, lot, session, q, editRisk,
        get commits() { return commits; }, get writes() { return writes; },
        step(ms) { clock += ms; const batch = [...frames.values()]; frames.clear(); for (const cb of batch) cb(clock); },
        cleanup() { dialog.destroy(); env.cleanup(); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
    };
}

test('add mode animates for 7000ms then commits exactly once via real App path', async () => {
    const f = await fixture({ multiplier: 2 });
    try {
        f.editRisk(100);
        assert.equal(f.q('[data-action="risk"]').disabled, false);
        f.q('[data-action="risk"]').click();
        assert.equal(f.lot.amount, 1000);
        assert.equal(f.dialog.animationController.duration, 7000);
        const { EasingFunctions } = await runtime.importModule('animation.js');
        assert.equal(f.dialog.animationController.easing, EasingFunctions.rouletteEaseOut.fn);
        const complete = f.dialog.animationController.onComplete;
        f.dialog.startRisk();
        f.step(6999);
        assert.equal(f.lot.amount, 1000);
        f.step(1);
        assert.equal(f.lot.amount, 1200);
        assert.equal(f.commits, 1); assert.equal(f.writes, 1);
        complete(); assert.equal(f.writes, 1);
        assert.equal(f.q('[data-field="riskAmount"]').value, '0');
        assert.ok(f.q('[data-role="risk-result"]').textContent.includes('1200'));
        assert.equal(f.dialog.renderer.getCursorOutcomeId(), 'risk-0');
    } finally { f.cleanup(); }
});

test('all mode uses the complete current stake and zero clamps to MIN', async () => {
    const f = await fixture({ amount: 1234, multiplier: 0 });
    try {
        f.q('[data-mode="all"]').click();
        f.q('[data-field="riskAmount"]').value = '1';
        f.dialog.startRisk(); f.step(7000);
        assert.equal(f.lot.amount, 0.01);
        assert.equal(f.q('[data-field="riskAmount"]').value, '0.01');
        assert.equal(f.q('[data-field="riskAmount"]').readOnly, true);
        assert.equal(f.q('[data-field="baseAmount"]').value, '0');
    } finally { f.cleanup(); }
});

test('all close paths and configuration changes are rejected during spin', async () => {
    const f = await fixture({ multiplier: 2 });
    try {
        f.editRisk(100); f.dialog.startRisk();
        const overlay = f.q('.modal-close').parentNode.parentNode;
        f.dialog.close();
        f.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        overlay.click(); f.q('.modal-close').onclick();
        f.q('[data-mode="all"]').onclick();
        assert.equal(f.dialog.mode, 'add');
        assert.equal(f.q('[data-field="riskAmount"]').disabled, true);
        assert.ok(f.document.querySelector('.risky-bet-dialog'));
        assert.equal(f.q('[data-action="add"]').disabled, true);
        const template = f.q('[data-role="outcome-template"]');
        assert.equal(template.querySelector('[data-field="multiplier"]').disabled, true);
        assert.equal(template.querySelector('[data-field="probability"]').disabled, true);
        f.q('[data-action="add"]').onclick();
        assert.equal(f.q('.risky-bet-table-scroll').querySelectorAll('[data-outcome-id]').length, 3);
        assert.equal(f.q('[data-outcome-id="risk-0"] [data-field="probability"]').readOnly, true);
        f.step(7000); f.dialog.close();
        assert.equal(f.document.querySelector('.risky-bet-dialog'), null);
    } finally { f.cleanup(); }
});

test('destroy invalidates queued completion and never applies abandoned risk', async () => {
    const f = await fixture({ multiplier: 2 });
    try {
        f.editRisk(100); f.dialog.startRisk();
        const complete = f.dialog.animationController.onComplete;
        f.dialog.destroy(); f.step(7000); complete();
        assert.equal(f.lot.amount, 1000); assert.equal(f.commits, 0);
    } finally { f.cleanup(); }
});

test('conflicting stake rejects commit without overwriting external change', async () => {
    const f = await fixture({ multiplier: 2 });
    try {
        f.editRisk(100); f.dialog.startRisk();
        f.lot.amount = 2000;
        f.step(7000);
        assert.equal(f.lot.amount, 2000); assert.equal(f.writes, 0);
        assert.equal(f.q('[data-role="risk-result"]').textContent, '');
        assert.equal(f.q('.risky-bet-error').hidden, false);
        f.dialog.close(); assert.equal(f.app.riskyBetDialog, null);
    } finally { f.cleanup(); }
});

test('invalid drafts, session lock and reachable overflow prevent start before RNG', async () => {
    const f = await fixture();
    const originalRandom = Math.random;
    try {
        Math.random = () => { assert.fail('No random choice for refused starts'); };
        f.editRisk(0); f.dialog.startRisk();
        f.editRisk(100);
        const input = f.q('[data-outcome-id="risk-0"] [data-field="probability"]');
        input.value = ''; input.dispatchEvent(new Event('input')); f.dialog.startRisk();
        input.value = '0.1'; input.dispatchEvent(new Event('change'));
        f.app.settings.riskyBetsEnabled = false; f.dialog.startRisk();
        f.app.settings.riskyBetsEnabled = true;
        f.lot.amount = Number.MAX_VALUE; f.q('[data-mode="all"]').click(); f.dialog.startRisk();
        assert.equal(f.commits, 0);
    } finally { Math.random = originalRandom; f.cleanup(); }
});

test('presentation failure after successful write preserves applied outcome without retry', async () => {
    const f = await fixture({ multiplier: 2, presentationFailure: true });
    try {
        f.editRisk(100); f.dialog.startRisk();
        const complete = f.dialog.animationController.onComplete;
        f.step(7000); complete();
        assert.equal(f.lot.amount, 1200); assert.equal(f.writes, 1);
        assert.ok(f.q('[data-role="risk-result"]').textContent.includes('1200'));
    } finally { f.cleanup(); }
});

test('animation render failure unlocks dialog without applying a stake', async () => {
    const f = await fixture({ multiplier: 2 });
    try {
        f.editRisk(100); f.dialog.startRisk();
        f.dialog.renderer.render = () => { throw new Error('test render failure'); };
        f.step(3000); f.step(7000);
        assert.equal(f.lot.amount, 1000); assert.equal(f.commits, 0);
        f.dialog.close(); assert.equal(f.app.riskyBetDialog, null);
    } finally { f.cleanup(); }
});


test('a multi-outcome final cursor survives presentation and locale/theme refresh', async () => {
    const f = await fixture();
    const random = Math.random;
    try {
        Math.random = () => 0.99;
        f.editRisk(100); f.dialog.startRisk(); f.step(7000);
        assert.equal(f.lot.amount, 1200);
        assert.equal(f.dialog.renderer.getCursorOutcomeId(), 'risk-2');
        f.dialog.refreshPresentation();
        assert.equal(f.dialog.renderer.getCursorOutcomeId(), 'risk-2');
    } finally { Math.random = random; f.cleanup(); }
});

test('no-op outcomes skip writes and derived-state hooks; all x2 uses the updated whole stake', async () => {
    for (const [mode, multiplier, expected] of [['add', 0, 1234], ['all', 1, 1234], ['all', 2, 2468]]) {
        const f = await fixture({ amount: 1234, multiplier });
        try {
            let refreshes = 0;
            const refresh = f.session.refreshLotDerivedState.bind(f.session);
            f.session.refreshLotDerivedState = () => { refreshes++; return refresh(); };
            if (mode === 'all') f.q('[data-mode="all"]').click(); else f.editRisk(100);
            f.dialog.startRisk(); f.step(7000);
            assert.equal(f.lot.amount, expected);
            assert.equal(f.writes, multiplier === 2 ? 1 : 0);
            assert.equal(refreshes, multiplier === 2 ? 1 : 0);
            if (mode === 'all') assert.equal(f.q('[data-field="riskAmount"]').value, String(expected));
        } finally { f.cleanup(); }
    }
});

test('commit refuses changed lock, disabled setting and removed selected lot', async () => {
    for (const change of ['lock', 'setting', 'remove']) {
        const f = await fixture({ multiplier: 2 });
        try {
            f.editRisk(100); f.dialog.startRisk();
            if (change === 'lock') f.session.prepareSpin();
            if (change === 'setting') f.app.settings.riskyBetsEnabled = false;
            if (change === 'remove') f.manager.deleteLot(f.lot.id);
            f.step(7000);
            assert.equal(f.writes, 0);
            assert.equal(f.q('[data-role="risk-result"]').textContent, '');
            assert.equal(f.q('.risky-bet-error').hidden, false);
            assert.equal(f.q('[data-action="risk"]').disabled, true);
            f.dialog.close(); assert.equal(f.app.riskyBetDialog, null);
        } finally { f.cleanup(); }
    }
});

test('spin commits its frozen snapshot even if inputs are modified without events', async () => {
    const f = await fixture({ multiplier: 2 });
    try {
        const { EasingFunctions } = await runtime.importModule('animation.js');
        f.app.settings.animationDuration = 300;
        f.app.easingFunction = EasingFunctions.linear.fn;
        f.editRisk(100); f.dialog.startRisk();
        f.q('[data-field="riskAmount"]').value = '99999';
        f.q('[data-outcome-id="risk-0"] [data-field="multiplier"]').value = '999';
        assert.ok(Object.isFrozen(f.dialog.pending));
        f.step(7000);
        assert.equal(f.lot.amount, 1200); assert.equal(f.commits, 1);
        assert.equal(f.dialog.animationController.duration, 7000);
        assert.equal(f.dialog.animationController.easing, EasingFunctions.rouletteEaseOut.fn);
        assert.equal(f.app.settings.animationDuration, 300);
        assert.equal(f.app.easingFunction, EasingFunctions.linear.fn);
    } finally { f.cleanup(); }
});
