import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTestRuntime } from './test-runtime.mjs';

const runtime = loadTestRuntime();
after(runtime.cleanup);
writeFileSync(join(runtime.directory, 'i18n.js'), `
export const t = (key, params) => key + (params ? JSON.stringify(params) : '');
export const translateDOM = () => {};
export const initI18n = async () => {};
export const syncDocumentLang = () => {};
export default { language: 'en', changeLanguage: (_lang, cb) => cb?.() };
`);
globalThis.document = { addEventListener() {} };
const { App } = await runtime.importModule('app.js');
const { LotManager } = await runtime.importModule('lotManager.js');
const { GameSession } = await runtime.importModule('gameSession.js');
const { MODES } = await runtime.importModule('modes.js');

function fixture(mode = 'normal', amounts = [10, 20, 30]) {
    const manager = new LotManager([]);
    for (const [i, amount] of amounts.entries()) manager.addLot('Lot ' + i, amount, '#123456');
    const app = Object.create(App.prototype);
    app.lotManager = manager;
    app.gameSession = new GameSession(mode, () => manager.getAllLots());
    app.settings = { riskyBetsEnabled: true };
    app.outcomeAccents = new Map();
    const frames = [];
    app.updateUI = (view, accents) => frames.push({ kind: 'list', view, accents });
    app.visualizationDriver = { refresh: (view, accents) => frames.push({ kind: 'canvas', view, accents }) };
    return { app, manager, session: app.gameSession, lot: manager.getAllLots()[0], frames };
}

test('amount edits notify the session and reuse one snapshot for both surfaces', () => {
    const { app, session, lot, frames } = fixture();
    let calls = 0;
    const original = session.refreshLotDerivedState.bind(session);
    session.refreshLotDerivedState = () => { calls++; return original(); };
    app.handleAmountChange(lot.id, 10.001);
    assert.equal(lot.amount, 10.01);
    assert.equal(calls, 1);
    assert.equal(frames.length, 2);
    assert.equal(frames[0].view, frames[1].view);
    app.handleAmountChange(lot.id, 10.001);
    assert.equal(calls, 1);
});

test('all modes refresh derived state before the first spin without changing participation', () => {
    for (const mode of Object.keys(MODES)) {
        const { app, session, lot } = fixture(mode);
        const ids = session.viewState.participants.map(p => [p.lot.id, p.active]);
        const result = app.commitRiskyBet({ lotId: lot.id, expectedAmount: 10, amount: 100 });
        assert.equal(result.success, true, mode);
        assert.equal(result.amount, 100);
        const view = session.viewState;
        assert.deepEqual(view.participants.map(p => [p.lot.id, p.active]), ids);
        if (mode === 'weakest-link') assert.equal(view.participants[0].yValue, 100);
        if (mode === 'king-of-the-hill-amount') {
            assert.equal(view.participants[0].yValue, 100);
            assert.equal(view.participants[0].modeData.accent.kind, 'accent');
        }
        const prepared = session.prepareSpin();
        assert.equal(prepared.ok, true, mode);
        assert.equal(session.refreshLotDerivedState(), false);
        assert.equal(app.commitRiskyBet({ lotId: lot.id, expectedAmount: 100, amount: 200 }).success, false);
        assert.equal(lot.amount, 100);
        session.reset();
        assert.equal(app.commitRiskyBet({ lotId: lot.id, expectedAmount: 100, amount: 200 }).success, true);
    }
});

test('commit validates setting, conflicts, missing lots and nonfinite values', () => {
    const { app, lot } = fixture('normal', [10]);
    for (const request of [
        { lotId: 'missing', expectedAmount: 10, amount: 20 },
        { lotId: lot.id, expectedAmount: 9, amount: 20 },
        { lotId: lot.id, expectedAmount: 10, amount: Infinity }
    ]) assert.equal(app.commitRiskyBet(request).success, false);
    app.settings.riskyBetsEnabled = false;
    assert.equal(app.commitRiskyBet({ lotId: lot.id, expectedAmount: 10, amount: 20 }).success, false);
    assert.equal(lot.amount, 10);
    app.settings.riskyBetsEnabled = true;
    assert.equal(app.commitRiskyBet({ lotId: lot.id, expectedAmount: 10, amount: 0 }).amount, 0.01);
});

test('a failing derived-state hook rolls amount back without changing mode state', () => {
    const { app, session, lot } = fixture('weakest-link');
    const previousState = session.modeState;
    const previousMode = session.currentMode;
    session.currentMode = { ...previousMode, onParticipantsChanged() { throw new Error('test hook failure'); } };
    const result = app.commitRiskyBet({ lotId: lot.id, expectedAmount: 10, amount: 100 });
    assert.equal(result.success, false);
    assert.equal(lot.amount, 10);
    assert.equal(session.modeState, previousState);
});

test('a presentation failure after commit never reports an unapplied result', () => {
    const { app, lot } = fixture();
    app.refreshAfterStateChange = () => { throw new Error('test presentation failure'); };
    const result = app.commitRiskyBet({ lotId: lot.id, expectedAmount: 10, amount: 20 });
    assert.equal(result.success, true);
    assert.equal(result.amount, 20);
    assert.equal(result.presentationFailed, true);
    assert.equal(lot.amount, 20);
});
