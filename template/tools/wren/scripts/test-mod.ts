// Runs the mod tests in claude/tests under `claude plugin test`, which loads every *.test.ts in the plugin.
// It therefore runs on a copy of the plugin without the Bun tests.
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

const pluginRoot = join(import.meta.dirname, '..');
const modTests = join('claude', 'tests');
const engineTypes = join('.claude-plugin', 'types');

const isCopied = (source: string): boolean => {
  const path = relative(pluginRoot, source);
  if (path.split(sep).includes('node_modules')) return false;
  if (path === engineTypes || path.startsWith(`${engineTypes}${sep}`)) {
    return false;
  }
  if (!/\.test\.tsx?$/u.test(path)) return true;
  return path.startsWith(`${modTests}${sep}`);
};

const copy = await mkdtemp(join(tmpdir(), 'wren-mod-test-'));
process.exitCode = await cp(pluginRoot, copy, {
  filter: isCopied,
  recursive: true,
})
  .then(
    () =>
      spawnSync('claude', ['plugin', 'test', copy], { stdio: 'inherit' })
        .status ?? 1,
  )
  .finally(() => rm(copy, { force: true, recursive: true }));
