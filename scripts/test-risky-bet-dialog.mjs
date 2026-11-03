import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTestRuntime } from './test-runtime.mjs';
import { installDomEnvironment } from './dom-test-environment.mjs';

const runtime = loadTestRuntime();
after(runtime.cleanup);
writeFileSync(join(runtime.directory, 'i18n.js'), `
export let language = 'en';
const dictionaries = ${JSON.stringify(Object.fromEntries(['en', 'ru'].map(lang => [lang, JSON.parse(readFileSync(new URL('../locales/' + lang + '.json', import.meta.url), 'utf8'))])))};
export const setLanguage = lang => { language = lang; };
export const t = key => dictionaries[language][key] ?? key;
export function translateDOM(root = document) {
 for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.getAttribute('data-i18n'));
}
`);
const model = await runtime.importModule('riskyBetModel.js');
const locale = await runtime.importModule('i18n.js');
const { ModalManager } = await runtime.importModule('modalManager.js');

async function fixture(lots = [
    { id: 'a', name: '<img onerror=bad()>', amount: 10, color: '#123456' },
    { id: 'b', name: '<img onerror=bad()>', amount: 20, color: '#654321' }
]) {
    assert.ok(existsSync(join(runtime.directory, 'riskyBetDialog.js')), 'RiskyBetDialog must exist');
    for (const lot of lots) Object.freeze(lot);
    const env = installDomEnvironment();
    locale.setLanguage('en');
    const { RiskyBetDialog } = await runtime.importModule('riskyBetDialog.js');
    let distribution = model.createRiskyBetDistribution();
    let closed = 0;
    const saves = [];
    const options = { getLots: () => lots, getDistribution: () => distribution,
        onDistributionChange: d => { distribution = d; saves.push(d); }, onClosed: () => { closed++; } };
    const dialog = new RiskyBetDialog(options);
    dialog.open();
    const root = env.document.querySelector('.risky-bet-dialog');
    const q = selector => root.querySelector(selector);
    const qa = selector => root.querySelectorAll(selector);
    return { ...env, dialog, root, q, qa, lots, options, saves, get distribution() { return distribution; }, get closed() { return closed; },
        cleanup() { dialog.destroy(); env.cleanup(); } };
}
const edit = (input, value, event = 'change') => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event(event)); };

test('initial open uses the first lot of the current list, including a single lot', async () => {
    const f = await fixture([{ id: 'a', name: 'Only', amount: 10, color: '#123456' }]);
    try {
        assert.equal(f.q('[data-lot-id="a"]').getAttribute('aria-pressed'), 'true');
        f.dialog.close();
        const { RiskyBetDialog } = await runtime.importModule('riskyBetDialog.js');
        const dialog = new RiskyBetDialog(f.options);
        f.lots.unshift(Object.freeze({ id: 'new-first', name: 'New', amount: 30, color: '#654321' }));
        dialog.open();
        try {
            assert.equal(f.document.querySelector('[data-lot-id="new-first"]').getAttribute('aria-pressed'), 'true');
            assert.equal(f.document.querySelector('[data-field="baseAmount"]').value, '30');
        } finally { dialog.destroy(); }
    } finally { f.cleanup(); }
});

test('dialog CSS is scoped and supplies responsive zones and scrollable tables', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    assert.match(css, /\.modal-content\.risky-bet-dialog\s*\{/);
    assert.match(css, /\.risky-bet-dialog \.risky-bet-zones\s*\{[^}]*display:\s*grid/s);
    assert.match(css, /\.risky-bet-dialog \.risky-bet-table-scroll\s*\{[^}]*overflow:\s*auto/s);
    assert.match(css, /@media[^}]+\.risky-bet-dialog \.risky-bet-zones\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test('invalid drafts stay local across other commits, add/remove, locale refresh and closing', async () => {
    const f = await fixture();
    const field = (id, name) => f.q(`[data-outcome-id="${id}"] [data-field="${name}"]`);
    try {
        const multiplier = field('risk-0', 'multiplier');
        edit(multiplier, '');
        assert.equal(f.saves.length, 0);
        assert.equal(multiplier.getAttribute('aria-invalid'), 'true');
        assert.equal(f.q('.risky-bet-error').hidden, false);
        edit(field('risk-2', 'probability'), '0.25');
        assert.equal(multiplier.value, '');
        assert.equal(f.distribution.outcomes[0].multiplier, 0.5);
        edit(field('risk-0', 'probability'), '0.2');
        assert.equal(multiplier.value, '');
        f.q('[data-action="add"]').click();
        assert.equal(multiplier.value, '');
        const added = f.distribution.outcomes.at(-1).id;
        f.q(`[data-outcome-id="${added}"] [data-action="remove"]`).click();
        assert.equal(multiplier.value, '');
        edit(f.q('[data-field="riskAmount"]'), 'oops');
        locale.setLanguage('ru'); f.dialog.refreshPresentation();
        assert.equal(multiplier.value, '');
        assert.equal(f.q('[data-field="riskAmount"]').value, 'oops');
        assert.ok(!f.q('[data-role="not-ready"]'));
        assert.ok(f.q('.risky-bet-error').textContent.startsWith('Введите'));
        for (const bad of ['NaN', 'Infinity', '-1', '1e999']) {
            edit(multiplier, bad); assert.equal(multiplier.getAttribute('aria-invalid'), 'true');
            assert.equal(f.distribution.outcomes[0].multiplier, 0.5);
        }
        multiplier.value = '1.5'; multiplier.dispatchEvent(new Event('input'));
        assert.equal(f.distribution.outcomes[0].multiplier, 0.5, 'input must not commit');
        multiplier.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        assert.equal(f.distribution.outcomes[0].multiplier, 1.5);
        const saves = f.saves.length;
        multiplier.dispatchEvent(new Event('blur'));
        assert.equal(f.saves.length, saves, 'blur after Enter must not duplicate a commit');
        const saved = f.distribution;
        edit(field('risk-2', 'probability'), '');
        f.q('[data-lot-id="b"]').click();
        f.dialog.close();
        assert.equal(f.distribution, saved);
        const { RiskyBetDialog } = await runtime.importModule('riskyBetDialog.js');
        const reopened = new RiskyBetDialog(f.options);
        reopened.open();
        try {
            assert.equal(f.document.querySelector('[data-outcome-id="risk-2"] [data-field="probability"]').value, '0.25');
            assert.equal(f.document.querySelector('[data-lot-id="a"]').getAttribute('aria-pressed'), 'true');
            assert.equal(f.document.querySelector('[data-field="riskAmount"]').value, '0');
        } finally { reopened.destroy(); }
    } finally { f.cleanup(); }
});

test('close paths unregister, remove listeners and DOM exactly once; open is idempotent', async () => {
    for (const path of ['x', 'escape', 'overlay', 'destroy']) {
        const f = await fixture();
        const overlay = f.root.parentNode;
        const input = f.q('[data-outcome-id="risk-0"] [data-field="multiplier"]');
        try {
            const manager = ModalManager.getInstance();
            f.dialog.open();
            assert.equal(manager.openModals.filter(el => el === overlay).length, 1);
            if (path === 'x') f.q('.modal-close').click();
            if (path === 'escape') f.document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            if (path === 'overlay') overlay.click();
            if (path === 'destroy') f.dialog.destroy();
            assert.equal(f.document.querySelector('.risky-bet-dialog'), null);
            assert.equal(manager.openModals.includes(overlay), false);
            assert.equal(f.document.listeners.get('keydown').length, 0);
            assert.equal(f.closed, 1);
            assert.equal(input.onchange, null, 'detached controls release handlers');
            f.dialog.destroy(); f.dialog.close();
            assert.equal(f.closed, 1);
        } finally { f.cleanup(); }
    }
});

test('scoped decoys remain untouched and all riskyBet locale keys are symmetric and resolved', async () => {
    const f = await fixture();
    try {
        const decoy = f.createElement('div');
        decoy.innerHTML = '<input data-field="riskAmount" value="decoy"><span data-i18n="riskyBet.title">outside</span><div data-outcome-id="risk-0"><input data-field="probability" value="decoy"></div>';
        f.document.body.insertBefore(decoy, f.root.parentNode);
        edit(f.q('[data-outcome-id="risk-0"] [data-field="probability"]'), '0.3');
        locale.setLanguage('ru'); f.dialog.refreshPresentation();
        assert.equal(decoy.querySelector('[data-field="riskAmount"]').value, 'decoy');
        assert.equal(decoy.querySelector('[data-field="probability"]').value, 'decoy');
        assert.equal(decoy.querySelector('span').textContent, 'outside');
        assert.equal(f.q('.modal-close').getAttribute('aria-label'), 'Закрыть');
        const en = JSON.parse(readFileSync(new URL('../locales/en.json', import.meta.url)));
        const ru = JSON.parse(readFileSync(new URL('../locales/ru.json', import.meta.url)));
        const keys = obj => Object.keys(obj).filter(k => k.startsWith('riskyBet.')).sort();
        assert.deepEqual(keys(en), keys(ru));
        for (const node of f.qa('[data-i18n]')) assert.ok(ru[node.dataset.i18n]);
        assert.equal(f.q('[data-mode="add"] span').textContent, '+');
        assert.equal(f.q('[data-mode="all"] span').textContent, '→');
    } finally { f.cleanup(); }
});

test('distribution edits use the real model, protect base by id, allow duplicate x1, and render exact shares', async () => {
    const f = await fixture();
    const field = (id, name) => f.q(`[data-outcome-id="${id}"] [data-field="${name}"]`);
    try {
        assert.equal(f.qa('[data-outcome-id]').length, 3);
        assert.equal(f.q('[data-role="expectation"]').textContent, '1.05');
        assert.equal(field('risk-base', 'multiplier').readOnly, true);
        assert.equal(field('risk-base', 'probability').readOnly, true);
        assert.equal(f.q('[data-outcome-id="risk-base"] [data-action="remove"]').disabled, true);
        edit(field('risk-0', 'probability'), '0.4');
        assert.equal(f.distribution.outcomes[0].probability, 0.4);
        assert.equal(f.distribution.outcomes[1].probability, 0.5);
        assert.equal(f.distribution.outcomes[2].probability, 0.1);
        edit(field('risk-0', 'probability'), '2');
        assert.equal(field('risk-0', 'probability').value, '0.9');
        assert.equal(f.distribution.outcomes[1].probability, 0);
        f.q('[data-action="add"]').click(); f.q('[data-action="add"]').click();
        const added = f.distribution.outcomes.slice(-2);
        assert.notEqual(added[0].id, added[1].id);
        assert.ok(added.every(o => o.multiplier === 0 && o.probability === 0));
        assert.equal(f.qa('[data-segment-id]').length, 2);
        const id = added[0].id;
        edit(field(id, 'multiplier'), '1', 'blur');
        assert.equal(field(id, 'multiplier').readOnly, false);
        assert.equal(f.distribution.outcomes.find(o => o.id === id).multiplier, 1);
        edit(field('risk-0', 'probability'), '0.4');
        edit(field(id, 'probability'), '0.2');
        assert.equal(f.distribution.outcomes.find(o => o.id === f.distribution.baseId).probability, 0.3);
        const segment = f.q(`[data-segment-id="${id}"]`);
        assert.equal(segment.style.width, '20%');
        assert.ok(segment.title.includes('x1'));
        f.q(`[data-outcome-id="${id}"] [data-action="remove"]`).click();
        assert.equal(f.distribution.outcomes.find(o => o.id === f.distribution.baseId).probability, 0.5);
        assert.equal(model.totalProbability(f.distribution), 1);
        assert.deepEqual(f.lots.map(l => l.amount), [10, 20]);
        assert.ok(f.saves.length > 0);
    } finally { f.cleanup(); }
});

test('modes and id-based selection reset only on a real switch and never write lots', async () => {
    const f = await fixture();
    try {
        const risk = f.q('[data-field="riskAmount"]');
        const base = f.q('[data-field="baseAmount"]');
        edit(risk, '7.25');
        f.q('[data-mode="add"]').click();
        f.q('[data-lot-id="a"]').click();
        assert.equal(risk.value, '7.25');
        f.q('[data-mode="all"]').click();
        assert.equal(base.value, '0'); assert.equal(risk.value, '10'); assert.equal(risk.readOnly, true);
        f.q('[data-mode="all"]').click();
        f.q('[data-mode="add"]').click();
        assert.equal(base.value, '10'); assert.equal(risk.value, '0'); assert.equal(risk.readOnly, false);
        edit(risk, 'abc');
        assert.equal(risk.getAttribute('aria-invalid'), 'true');
        f.dialog.refreshPresentation();
        assert.equal(risk.value, 'abc');
        f.q('[data-lot-id="b"]').click();
        assert.equal(base.value, '20'); assert.equal(risk.value, '0');
        assert.equal(f.q('[data-lot-id="b"]').getAttribute('aria-pressed'), 'true');
        assert.deepEqual(f.lots.map(l => l.amount), [10, 20]);
    } finally { f.cleanup(); }
});

test('empty global list has an informative disabled state; a removed selection falls back to first', async () => {
    const f = await fixture([]);
    try {
        assert.equal(f.qa('[data-lot-id]').length, 0);
        assert.equal(f.q('[data-role="empty"]').textContent, 'No lots available.');
        assert.equal(f.q('[data-field="riskAmount"]').disabled, true);
        assert.equal(f.q('[data-action="risk"]').disabled, true);
    } finally { f.cleanup(); }
    const g = await fixture();
    try {
        g.lots.shift(); g.dialog.refreshPresentation();
        assert.equal(g.q('[data-lot-id="b"]').getAttribute('aria-pressed'), 'true');
        assert.equal(g.q('[data-field="baseAmount"]').value, '20');
    } finally { g.cleanup(); }
});

test('first global lot is selected automatically, with no lot writes and disabled stage03 action', async () => {
    const f = await fixture();
    try {
        assert.equal(f.q('[data-lot-id="a"]').getAttribute('aria-pressed'), 'true');
        assert.equal(f.q('[data-field="baseAmount"]').value, '10');
        assert.equal(f.q('[data-field="baseAmount"]').readOnly, true);
        assert.equal(f.q('[data-role="selected-lot"]'), null);
        assert.equal(f.q('[data-field="riskAmount"]').value, '0');
        assert.equal(f.q('[data-action="risk"]').disabled, true);
        assert.ok(!f.q('[data-role="not-ready"]'));
        assert.equal(f.q('[data-lot-id="a"] img'), null);
        assert.ok(f.q('[data-lot-id="a"]').textContent.includes('<img onerror=bad()>'));
        assert.deepEqual(f.lots.map(l => l.amount), [10, 20]);
        assert.equal(f.saves.length, 0);
    } finally { f.cleanup(); }
});


test('risk UI uses shared switches and row controls without removed explanatory blocks', async () => {
    const f = await fixture();
    try {
        assert.ok(f.q('.risky-bet-modes').classList.contains('switch'));
        for (const mode of ['add', 'all']) assert.ok(f.q(`[data-mode="${mode}"]`).classList.contains('switch-btn'));
        assert.ok(f.q('[data-mode="add"]').classList.contains('active'));
        f.q('[data-mode="all"]').click();
        assert.ok(f.q('[data-mode="all"]').classList.contains('active'));
        assert.equal(f.q('[data-mode="add"]').classList.contains('active'), false);
        assert.equal(f.q('.risky-bet-risk h3'), null);
        for (const key of ['formula', 'total', 'expectationNote']) assert.equal(f.q(`[data-i18n="riskyBet.${key}"]`), null);
        assert.equal(f.q('[data-role="total"]'), null);
        assert.equal(f.q('[data-role="selected-lot"]'), null);
        assert.ok(!f.q('thead'));
        assert.ok(!f.q('[data-i18n="riskyBet.base"]'));
        const row = f.q('[data-outcome-id="risk-0"]');
        assert.ok(row.children[0].querySelector('.risky-bet-swatch'));
        assert.ok(row.children[1].textContent.includes('%'));
        const remove = row.querySelector('[data-action="remove"]');
        assert.ok(remove.classList.contains('btn-delete'));
        assert.equal(remove.textContent, '×');
        const add = f.q('[data-action="add"]');
        assert.ok(add.classList.contains('btn-add'));
        assert.ok(f.q('[data-role="outcome-template"]').classList.contains('lot-item'));
        assert.ok(f.q('[data-role="outcome-template"]').classList.contains('add-row'));
        assert.equal(add.textContent, '➕');
        locale.setLanguage('ru'); f.dialog.refreshPresentation();
        assert.equal(f.q('[data-i18n="riskyBet.distribution"]').textContent, 'Шансы');
        assert.equal(remove.textContent, '×'); assert.equal(add.textContent, '➕');
    } finally { f.cleanup(); }
});

test('confirmed chance fields round to thousandths and multipliers to cents with the upper cap', async () => {
    const f = await fixture();
    const field = (id, key) => f.q(`[data-outcome-id="${id}"] [data-field="${key}"]`);
    try {
        edit(field('risk-0', 'probability'), '0.1237');
        assert.equal(field('risk-0', 'probability').value, '0.124');
        assert.equal(f.distribution.outcomes[0].probability, 0.124);
        assert.equal(field('risk-base', 'probability').value, '0.776');
        edit(field('risk-0', 'multiplier'), '3.14159');
        assert.equal(field('risk-0', 'multiplier').value, '3.14');
        assert.equal(f.distribution.outcomes[0].multiplier, 3.14);
        edit(field('risk-0', 'multiplier'), '1e100');
        assert.equal(field('risk-0', 'multiplier').value, '1000000000');
        assert.equal(f.distribution.outcomes[0].multiplier, 1000000000);
        const saves = f.saves.length;
        field('risk-0', 'multiplier').dispatchEvent(new Event('blur'));
        assert.equal(f.saves.length, saves);
        edit(field('risk-0', 'probability'), '0.0004');
        assert.equal(field('risk-0', 'probability').value, '0');
        assert.equal(f.distribution.outcomes[0].probability, 0);
        edit(field('risk-0', 'probability'), '2');
        assert.equal(field('risk-0', 'probability').value, '0.9');
        assert.ok(Math.abs(model.totalProbability(f.distribution) - 1) < 1e-12);
        const input = field('risk-0', 'multiplier');
        input.value = '0.001'; input.dispatchEvent(new Event('input'));
        assert.equal(input.value, '0.001', 'typing is not reformatted before confirmation');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        assert.equal(input.value, '0');
        const snapshot = f.distribution;
        edit(input, ''); assert.equal(f.distribution, snapshot);
    } finally { f.cleanup(); }
});

test('risk dialog fills the available height and does not override shared switch/delete/add styles', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    assert.match(css, /\.modal-content\.risky-bet-dialog\s*\{[^}]*height:\s*90dvh/s);
    assert.match(css, /\.risky-bet-dialog \.risky-bet-lots\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
    const listRules = [...css.matchAll(/\.risky-bet-dialog \.risky-bet-lot-list\s*\{([^}]*)\}/g)].map(m => m[1]).join(' ');
    assert.match(listRules, /flex:\s*1/);
    assert.doesNotMatch(listRules, /max-height:\s*(52|28)vh/);
    assert.doesNotMatch(css, /\.risky-bet-dialog \.risky-bet-modes\s*\{[^}]*flex-direction:\s*column/s);
    assert.ok(css.includes('button:not(.modal-close):not(.switch-btn):not(.btn-delete):not(.btn-add)'));
});


test('new outcome template commits its editable fields atomically and resets only after adding', async () => {
    const f = await fixture();
    try {
        const template = f.q('[data-role="outcome-template"]');
        assert.ok(template, 'An editable template must exist below the scrolling list');
        const multiplier = template.querySelector('[data-field="multiplier"]');
        const probability = template.querySelector('[data-field="probability"]');
        assert.equal(multiplier.value, '0'); assert.equal(probability.value, '0');
        edit(multiplier, '3.14159'); edit(probability, '0.1237');
        assert.equal(f.saves.length, 0);
        assert.equal(multiplier.value, '3.14'); assert.equal(probability.value, '0.124');
        locale.setLanguage('ru'); f.dialog.refreshPresentation();
        assert.equal(multiplier.value, '3.14'); assert.equal(probability.value, '0.124');
        f.q('[data-action="add"]').click();
        assert.equal(f.saves.length, 1);
        const added = f.distribution.outcomes.at(-1);
        assert.equal(added.multiplier, 3.14); assert.equal(added.probability, 0.124);
        assert.ok(Math.abs(model.totalProbability(f.distribution) - 1) < 1e-12);
        assert.equal(multiplier.value, '0'); assert.equal(probability.value, '0');
        assert.ok(f.q(`[data-outcome-id="${added.id}"]`));
        assert.equal(f.qa('[data-outcome-id]').length, 4);
        edit(multiplier, '1e100'); edit(probability, '10');
        assert.equal(multiplier.value, '1000000000');
        multiplier.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        assert.equal(f.saves.length, 2);
        assert.equal(f.distribution.outcomes.at(-1).multiplier, 1000000000);
        assert.ok(Math.abs(model.totalProbability(f.distribution) - 1) < 1e-12);
        assert.equal(f.q('[data-outcome-id="risk-base"] [data-field="probability"]').value, '0');
    } finally { f.cleanup(); }
});

test('invalid template values never insert a partial outcome or overwrite other drafts', async () => {
    const f = await fixture();
    try {
        const template = f.q('[data-role="outcome-template"]');
        assert.ok(template);
        const multiplier = template.querySelector('[data-field="multiplier"]');
        const probability = template.querySelector('[data-field="probability"]');
        const oldMultiplier = f.q('[data-outcome-id="risk-0"] [data-field="multiplier"]');
        edit(oldMultiplier, '');
        for (const bad of ['', 'NaN', 'Infinity', '-1']) {
            edit(multiplier, bad); edit(probability, '0.2');
            assert.equal(f.q('[data-action="add"]').disabled, true);
            f.q('[data-action="add"]').onclick();
            multiplier.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            assert.equal(f.saves.length, 0);
            assert.equal(f.distribution.outcomes.length, 3);
            assert.equal(oldMultiplier.value, '');
        }
        edit(multiplier, '2'); edit(probability, '');
        assert.equal(f.q('[data-action="add"]').disabled, true);
        edit(probability, '0.25'); f.q('[data-action="add"]').click();
        assert.equal(f.saves.length, 1);
        assert.equal(oldMultiplier.value, '');
        assert.equal(f.distribution.outcomes.at(-1).probability, 0.25);
    } finally { f.cleanup(); }
});

test('existing rows and persistent template use the same compact headerless column layout', async () => {
    const f = await fixture();
    try {
        assert.ok(!f.q('thead'));
        assert.ok(!f.q('[data-i18n="riskyBet.base"]'));
        const template = f.q('[data-role="outcome-template"]');
        assert.ok(template);
        const scroller = f.q('.risky-bet-table-scroll');
        assert.equal(scroller.contains(template), false);
        const tables = f.qa('.risky-bet-table');
        assert.equal(tables.length, 2);
        assert.deepEqual([...tables[0].querySelectorAll('col')].map(n => n.className), [...tables[1].querySelectorAll('col')].map(n => n.className));
        assert.equal(template.children.length, f.q('[data-outcome-id="risk-0"]').children.length);
        const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
        assert.ok(/\.risky-bet-dialog \.risky-bet-table\s*\{[^}]*table-layout:\s*fixed/s.test(css));
        assert.ok(!/\.risky-bet-dialog (?:table|\.risky-bet-table)\s*\{[^}]*min-width:\s*380px/s.test(css));
        assert.equal(f.q('[data-outcome-id="risk-base"] [data-field="multiplier"]').readOnly, true);
        assert.equal(f.q('[data-outcome-id="risk-base"] [data-action="remove"]').disabled, true);
    } finally { f.cleanup(); }
});


test('risk layout stacks the left panels and groups the two amounts beside the switch', async () => {
    const f = await fixture();
    try {
        const zones = f.q('.risky-bet-zones');
        assert.deepEqual([...zones.children].map(node => node.className), ['risky-bet-lots', 'risky-bet-distribution', 'risky-bet-risk']);
        const controls = f.q('.risky-bet-risk-controls');
        assert.ok(controls);
        assert.equal(controls.querySelectorAll('label').length, 2);
        assert.ok(controls.contains(f.q('.risky-bet-modes')));
        assert.ok(controls.contains(f.q('[data-field="baseAmount"]')));
        assert.ok(controls.contains(f.q('[data-field="riskAmount"]')));
        const button = f.q('[data-action="risk"]');
        assert.ok(button.classList.contains('btn-primary'));
        assert.equal(button.parentNode, f.q('.risky-bet-risk'));
        assert.equal(f.qa('[role="status"]').length, 0);
        assert.equal(f.q('.risky-bet-error').getAttribute('role'), 'alert');
        const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
        assert.ok(/grid-template-areas:\s*"lots risk"\s*"distribution risk"/.test(css));
        assert.ok(/\.risky-bet-dialog \.risky-bet-risk-controls\s*\{[^}]*grid-template-columns:/s.test(css));
        assert.ok(css.includes(':not(.btn-primary)'));
    } finally { f.cleanup(); }
});

test('result card is hidden until a result and presents translated labels and separate values', async () => {
    const f = await fixture();
    try {
        const result = f.q('[data-role="risk-result"]');
        assert.equal(result.hidden, true);
        assert.equal(result.textContent, '');
        f.dialog.lastResult = { multiplier: 2, riskAmount: 100, before: 1000, after: 1200 };
        f.dialog.refreshPresentation();
        assert.equal(result.hidden, false);
        assert.equal(result.getAttribute('aria-live'), 'polite');
        assert.equal(result.querySelector('.risky-bet-result-multiplier').textContent, '×2');
        assert.equal(result.querySelector('[data-result-field="before"]').textContent, '1000.00');
        assert.equal(result.querySelector('[data-result-field="riskAmount"]').textContent, '100.00');
        assert.equal(result.querySelector('[data-result-field="after"]').textContent, '1200.00');
        locale.setLanguage('ru'); f.dialog.refreshPresentation();
        assert.equal(result.querySelector('.risky-bet-result-title').textContent, 'Результат риска');
        assert.equal(result.querySelector('[data-result-field="after"]').textContent, '1200.00');
        f.q('[data-lot-id="b"]').click();
        assert.equal(result.hidden, true); assert.equal(result.textContent, '');
    } finally { f.cleanup(); }
});
