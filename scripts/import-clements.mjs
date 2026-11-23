import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const candidates = process.env.EVERYBIRD_PYTHON
  ? [process.env.EVERYBIRD_PYTHON]
  : [...(existsSync(bundled) ? [bundled] : []), 'python3', 'python'];
const executable = candidates.find(candidate => {
  const probe = spawnSync(candidate, ['-c', 'import openpyxl; assert openpyxl.__version__ == "3.1.5"'], { cwd: root, windowsHide: true });
  return !probe.error && probe.status === 0;
});
if (!executable) {
  console.error('Python with openpyxl 3.1.5 is required. Set EVERYBIRD_PYTHON to its executable path.');
  process.exit(1);
}
const result = spawnSync(executable, ['scripts/import-clements2026.py', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
