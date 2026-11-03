import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = mkdtempSync(join(tmpdir(), 'lot-manager-test-'));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, [
    join(root, 'node_modules/typescript/bin/tsc'),
    '--project', join(root, 'tsconfig.json'),
    '--outDir', output,
    '--sourceMap', 'false'
], { cwd: root, stdio: 'inherit' });
writeFileSync(join(output, 'package.json'), '{"type":"module"}\n');
const { LotManager } = await import(pathToFileURL(join(output, 'lotManager.js')).href);

function fixture() {
    const lot = { id: 'lot', name: 'Original', amount: 1, color: '#123456' };
    return { lot, manager: new LotManager([lot]) };
}

test('updateLot rounds amounts upward to cents without raising exact cents', () => {
    const { lot, manager } = fixture();
    for (const [input, expected] of [[1.001, 1.01], [0.07, 0.07], [1.01, 1.01]]) {
        assert.equal(manager.updateLot(lot.id, { amount: input }), true);
        assert.equal(lot.amount, expected, `amount ${input}`);
    }
});

test('addLot applies the same final amount policy as updateLot', () => {
    const manager = new LotManager([]);
    const result = manager.addLot('Created', 1.001, '#123456');
    assert.equal(result.success, true);
    assert.equal(result.lot.amount, 1.01);
});

test('normalization handles decimal boundaries, exponents, and MIN', () => {
    for (const [input, expected] of [
        [0, 0.01], [-1, 0.01], [Number.MIN_VALUE, 0.01], [1e-7, 0.01],
        [0.010001, 0.02], [0.07000000000000002, 0.08],
        [1.009, 1.01], [1.01001, 1.02], [1.999, 2],
        [1.23456789e-1, 0.13], [1e21, 1e21], [Number.MAX_VALUE, Number.MAX_VALUE]
    ]) {
        assert.equal(LotManager.normalizeAmount(input), expected, `amount ${input}`);
    }
});

test('exact cents remain unchanged and normalization is idempotent', () => {
    for (let cents = 1; cents <= 10000; cents++) {
        const amount = Number(`${cents}e-2`);
        assert.equal(LotManager.normalizeAmount(amount), amount);
        const rounded = LotManager.normalizeAmount(amount + 0.001);
        assert.equal(rounded, Number(`${cents + 1}e-2`));
        assert.equal(LotManager.normalizeAmount(rounded), rounded);
    }
});

test('updateLot rejects nonfinite amounts without partially changing the lot', () => {
    const { lot, manager } = fixture();
    for (const amount of [NaN, Infinity, -Infinity]) {
        assert.equal(LotManager.normalizeAmount(amount), null);
        assert.equal(manager.updateLot(lot.id, { amount, name: 'Changed', color: '#ffffff' }), false);
        assert.deepEqual(lot, { id: 'lot', name: 'Original', amount: 1, color: '#123456' });
    }
});

test('updates without amount preserve it and missing ids return false', () => {
    const { lot, manager } = fixture();
    assert.equal(manager.updateLot('missing', { amount: 1.001 }), false);
    assert.equal(manager.updateLot(lot.id, { name: ' Renamed ', color: '#ffffff' }), true);
    assert.deepEqual(lot, { id: 'lot', name: 'Renamed', amount: 1, color: '#ffffff' });
    assert.equal(manager.updateLot(lot.id, { amount: 0 }), true);
    assert.equal(lot.amount, 0.01);
});

test('addLot rejects invalid amounts and normalizes positive amounts below MIN', () => {
    const manager = new LotManager([]);
    for (const amount of [NaN, Infinity, -Infinity, 0, -1]) {
        assert.deepEqual(manager.addLot('Rejected', amount, '#123456'), {
            success: false, reason: 'invalid_amount'
        });
    }
    assert.equal(manager.getTotalCount(), 0);
    const result = manager.addLot('Tiny', 1e-7, '#123456');
    assert.equal(result.success, true);
    assert.equal(result.lot.amount, 0.01);
});

test('merge and replace imports use the same amount normalization', async () => {
    const { MERGE_STRATEGY, REPLACE_STRATEGY } = await import(
        pathToFileURL(join(output, 'importStrategies.js')).href
    );
    const { lot, manager } = fixture();
    MERGE_STRATEGY.execute([
        { name: 'Original', amount: 1.001 },
        { name: 'New', amount: 0.0701 }
    ], manager);
    assert.equal(lot.amount, 1.01);
    assert.equal(manager.getAllLots().find(item => item.name === 'New').amount, 0.08);
    REPLACE_STRATEGY.execute([{ name: 'Replacement', amount: 2.001 }], manager);
    assert.equal(manager.getTotalCount(), 1);
    assert.equal(manager.getAllLots()[0].amount, 2.01);
});
