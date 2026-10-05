import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const latest = args.includes('--latest');
const directoryIndex = args.indexOf('--directory');
if (directoryIndex !== -1 && !args[directoryIndex + 1]) {
  throw new Error('--directory requires an empty destination for the upstream checkouts');
}
const parent = directoryIndex === -1 ? dirname(root) : resolve(args[directoryIndex + 1]);
const upstreams = JSON.parse(await readFile(new URL('../upstreams.json', import.meta.url), 'utf8'));
const run = (cwd, ...arguments_) => execFileSync('git', arguments_, {
  cwd, stdio: 'inherit', timeout: 120_000,
});

// Never reset an existing checkout or touch its local configuration.
for (const name of Object.keys(upstreams)) {
  if (existsSync(resolve(parent, name))) throw new Error(`${name} already exists. Use a fresh --directory.`);
}
await mkdir(parent, { recursive: true });
for (const [name, upstream] of Object.entries(upstreams)) {
  const checkout = resolve(parent, name);
  run(parent, 'clone', '--filter=blob:none', '--no-tags', upstream.url, checkout);
  if (!latest) run(checkout, 'checkout', '--detach', upstream.revision);
  const patch = resolve(root, upstream.patch);
  run(checkout, 'apply', '--check', patch);
  run(checkout, 'apply', patch);
  console.log(`${name}: integration applied${latest ? ' to the current default branch' : ' to the pinned revision'}`);
}
console.log('Source checkouts prepared. No services, email connections, or AI models were started.');
