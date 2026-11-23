import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await mkdir('.tools/npm', { recursive: true });
const response = await fetch('https://registry.npmjs.org/npm/-/npm-12.2.3.tgz');
if (!response.ok) throw new Error(`npm download failed: ${response.status}`);
await writeFile('.tools/npm.tgz', Buffer.from(await response.arrayBuffer()));
execFileSync('tar', ['-xzf', '.tools/npm.tgz', '-C', '.tools/npm'], { stdio: 'inherit' });
console.log('Local npm ready: node .tools/npm/package/bin/npm-cli.js');
