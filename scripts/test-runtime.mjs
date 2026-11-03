import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Compile real project modules into a disposable, DOM-free ESM runtime. */
export function loadTestRuntime() {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const directory = mkdtempSync(join(tmpdir(), 'skam-test-'));
    const cleanup = () => rmSync(directory, { recursive: true, force: true });
    try {
        execFileSync(process.execPath, [
            join(root, 'node_modules/typescript/bin/tsc'),
            '--project', join(root, 'tsconfig.json'), '--outDir', directory,
            '--sourceMap', 'false'
        ], { cwd: root, stdio: 'inherit' });
        writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
        return {
            directory,
            importModule: name => import(pathToFileURL(join(directory, name)).href),
            cleanup
        };
    } catch (error) {
        cleanup();
        throw error;
    }
}
