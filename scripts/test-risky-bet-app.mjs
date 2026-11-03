import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTestRuntime } from './test-runtime.mjs';
import { installDomEnvironment } from './dom-test-environment.mjs';
const runtime = loadTestRuntime();
after(runtime.cleanup);
writeFileSync(join(runtime.directory, 'i18n.js'), `
export const t = key => key;
export const translateDOM = () => {};
export const initI18n = async () => {};
export const syncDocumentLang = () => {};
export default { language: 'en', changeLanguage: (_lang, cb) => cb?.() };
`);
globalThis.document = { addEventListener() {} };
const { App } = await runtime.importModule('app.js');
const { LotManager } = await runtime.importModule('lotManager.js');
const { GameSession } = await runtime.importModule('gameSession.js');

function control() {
    const classes = new Set();
    return { disabled: false, classList: {
        toggle(name, value) { if (value) classes.add(name); else classes.delete(name); },
        contains: name => classes.has(name)
    } };
}
function fixture() {
    const app = Object.create(App.prototype);
    app.settings = { riskyBetsEnabled: false };
    app.riskyBetDialog = null;
    app.lotManager = new LotManager([]);
    app.gameSession = new GameSession('normal', () => app.lotManager.getAllLots());
    app.riskyBetButton = control();
    app.riskyBetsSwitch = null;
    app.updateControlsState = () => app.syncRiskyBetControls();
    return app;
}

test('setting controls visibility; zero and one lot have distinct availability', () => {
    const app = fixture();
    app.syncRiskyBetControls();
    assert.equal(app.riskyBetButton.classList.contains('hidden'), true);
    app.setRiskyBetsEnabled(true);
    assert.equal(app.riskyBetButton.classList.contains('hidden'), false);
    assert.equal(app.riskyBetButton.disabled, true);
    const added = app.lotManager.addLot('One', 10, '#123456');
    app.gameSession.addLot(added.lot);
    app.syncRiskyBetControls();
    assert.equal(app.riskyBetButton.disabled, false);
    app.gameSession.prepareSpin();
    app.syncRiskyBetControls();
    assert.equal(app.riskyBetButton.disabled, true);
    app.gameSession.reset();
    app.syncRiskyBetControls();
    assert.equal(app.riskyBetButton.disabled, false);
});

test('an open risk dialog guards main mutations and settings at handler level', () => {
    const app = fixture();
    const added = app.lotManager.addLot('One', 10, '#123456');
    app.gameSession.addLot(added.lot);
    app.riskyBetDialog = {};
    for (const method of ['spin', 'reset', 'addLot', 'handleClearLots', 'openImportDialog']) app[method]();
    app.deleteLot(added.lot.id);
    app.handleAmountChange(added.lot.id, 200);
    app.setRiskyBetsEnabled(true);
    assert.equal(app.settings.riskyBetsEnabled, false);
    assert.equal(added.lot.amount, 10);
    assert.equal(app.lotManager.getTotalCount(), 1);
    assert.equal(app.gameSession.isSessionLocked, false);
});

test('risk controls are present in real markup and use dedicated translation keys', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="risky-bet-btn"/);
    assert.match(html, /id="risky-bets-switch"/);
    assert.match(html, /data-i18n="riskyBet.enable"/);
    assert.match(html, /data-i18n="riskyBet.title"/);
});

test('real App construction wires opening, guards and page-lifetime distribution retention', () => {
    const env = installDomEnvironment();
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {} } });
    let app;
    try {
        const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
        env.document.body.innerHTML = html.match(/<body>([\s\S]*)<script src="papaparse/)[1];
        const canvas = env.document.getElementById('roulette-canvas');
        const context = new Proxy({ measureText: text => ({ width: text.length * 8 }) }, { get: (target, key) => target[key] ?? (() => {}) });
        canvas.getContext = () => context;
        canvas.getBoundingClientRect = () => ({ width: 600, height: 500 });
        const create = env.document.createElement;
        env.document.createElement = tag => {
            const element = create(tag);
            if (tag === 'canvas') {
                element.getContext = () => context;
                element.getBoundingClientRect = () => ({ width: 400, height: 140 });
            }
            return element;
        };
        app = new App();
        const button = env.document.getElementById('risky-bet-btn');
        assert.equal(button.classList.contains('hidden'), true);
        assert.ok(button.textContent.includes('🧨'));
        assert.ok(button.querySelector('[data-i18n="riskyBet.title"]'));
        env.document.querySelector('#risky-bets-switch [data-value="on"]').click();
        env.document.getElementById('new-lot-name').value = 'Only';
        env.document.getElementById('new-lot-amount').value = '10';
        env.document.getElementById('add-lot-btn').click();
        button.click();
        const dialog = app.riskyBetDialog;
        assert.ok(dialog);
        assert.equal(typeof dialog.options.onCommit, 'function');
        assert.equal(dialog.options.canRisk(), true);
        assert.equal(dialog.options.onCommit({ lotId: 'missing', expectedAmount: 10, amount: 20 }).success, false);
        const riskInput = env.document.querySelector('.risky-bet-dialog [data-field="riskAmount"]');
        riskInput.value = '100'; riskInput.dispatchEvent(new Event('input'));
        assert.equal(env.document.querySelector('.risky-bet-dialog [data-action="risk"]').disabled, false);
        assert.equal(env.document.getElementById('spin-btn').disabled, true);
        assert.equal(env.document.getElementById('reset-btn').disabled, true);
        const visualization = env.document.getElementById('visualization-select');
        const previousVisualization = app.settings.visualization;
        visualization.value = previousVisualization === 'strip' ? 'wheel' : 'strip';
        visualization.dispatchEvent(new Event('change'));
        assert.equal(app.settings.visualization, previousVisualization);
        assert.equal(visualization.value, previousVisualization);
        app.openRiskyBetDialog();
        assert.equal(app.riskyBetDialog, dialog);
        env.document.querySelector('.risky-bet-dialog [data-action="add"]').click();
        const distribution = app.riskyBetDistribution;
        assert.equal(distribution.outcomes.length, 4);
        dialog.close();
        assert.equal(app.riskyBetDialog, null);
        assert.equal(env.document.getElementById('spin-btn').disabled, false);
        app.reset();
        app.setRiskyBetsEnabled(false); app.setRiskyBetsEnabled(true);
        button.click();
        assert.equal(app.riskyBetDistribution, distribution);
        assert.equal(env.document.querySelectorAll('.risky-bet-dialog [data-outcome-id]').length, 4);
        app.riskyBetDialog.committing = true;
        const lot = app.lotManager.getAllLots()[0];
        assert.equal(dialog.options.onCommit({ lotId: lot.id, expectedAmount: lot.amount, amount: lot.amount }).success, false);
        app.riskyBetDialog.committing = false;
    } finally {
        app?.riskyBetDialog?.destroy();
        env.cleanup();
        if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
        else delete globalThis.localStorage;
    }
});
