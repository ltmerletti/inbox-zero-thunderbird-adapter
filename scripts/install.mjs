import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createLocalConfig } from './local-config.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const parent = dirname(root);
const app = resolve(parent, 'inbox-zero/apps/web');
process.on('uncaughtException', error => {
  console.error(`\nSetup stopped. ${error.message}\nFix the issue above and rerun the same command. Saved passwords are preserved.`);
  process.exitCode = 1;
});
const run = (cwd, command, args, extraEnv = {}) => execFileSync(command, args, {
  cwd, stdio: 'inherit', timeout: 30 * 60_000,
  env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', ...extraEnv },
});
if (process.platform !== 'darwin' || Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('This installer requires macOS and Node.js 24. Use the install.sh entry point.');
}
if (!existsSync(resolve(root, '.private/installer-state.json')) &&
    ['.private/inbox-zero-config.json', '.private/secrets.json', '../inbox-zero/apps/web/.env.local',
      '../inbox-zero/.env.thunderbird'].some(file => existsSync(resolve(root, file)))) {
  throw new Error('This folder already has a manually configured installation. It will not be changed.');
}
const installed = resolve(root, '.private/installed.json');
const repos = JSON.parse(await readFile(resolve(root, 'upstreams.json'), 'utf8'));
if (!existsSync(resolve(root, '.private/installer-state.json'))) {
  for (const port of [3000, 3001, 5446, 6386, 7700, 7701, 8076]) {
    await new Promise((done, reject) => {
      const server = createServer();
      server.once('error', () => reject(new Error(`Port ${port} is in use. Stop the other local installation before setting up this one.`)));
      server.listen(port, '127.0.0.1', () => server.close(done));
    });
  }
}
for (const [name, upstream] of Object.entries(repos)) {
    const cwd = resolve(parent, name);
    if (!existsSync(cwd)) {
      run(parent, 'git', ['clone', '--filter=blob:none', '--no-tags', upstream.url, cwd]);
      run(cwd, 'git', ['checkout', '--detach', upstream.revision]);
    }
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    if (revision !== upstream.revision) throw new Error(`${name} is not at the expected revision. Use a fresh installation folder.`);
    // A failed preparation can resume, but unrelated local modifications cannot be overwritten.
    const patch = resolve(root, upstream.patch);
    try { execFileSync('git', ['apply', '--reverse', '--check', patch], { cwd, stdio: 'pipe' }); }
    catch {
      run(cwd, 'git', ['apply', '--check', patch]);
      run(cwd, 'git', ['apply', patch]);
    }
}
const state = await createLocalConfig(root);
const dbEnv = { DATABASE_URL: `postgresql://postgres:${state.postgres}@127.0.0.1:5446/inboxzero` };
if (!existsSync(installed)) {
  console.log('Installing the bridge and Inbox Zero dependencies. The first installation can take several minutes.');
  run(resolve(parent, 'thunderbird-cli'), 'npm', ['ci', '--ignore-scripts']);
  const pkg = JSON.parse(await readFile(resolve(parent, 'inbox-zero/package.json'), 'utf8'));
  const pnpm = ['--yes', pkg.packageManager];
  run(resolve(parent, 'inbox-zero'), 'npx', [...pnpm, '--filter', '.', '--filter', 'inbox-zero-ai...', 'install', '--frozen-lockfile'], { ...dbEnv, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' });
  run(app, 'npx', [...pnpm, 'exec', 'prisma', 'generate'], dbEnv);
}
try { execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 }); }
catch {
  spawn('open', ['-a', 'Docker'], { stdio: 'ignore' });
  console.log('Waiting for Docker Desktop. Complete its first-launch setup if prompted.');
  let ready = false;
  for (let count = 0; count < 60; count++) {
    await new Promise(done => setTimeout(done, 2000));
    try { execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 2000 }); ready = true; break; }
    catch {}
  }
  if (!ready) throw new Error('Docker is not ready. Open Docker Desktop, finish setup, and rerun the same installation command.');
}
run(parent, 'docker', ['compose', '-f', 'inbox-zero/compose.thunderbird.yaml', '--env-file', 'inbox-zero/.env.thunderbird', 'up', '-d', '--wait']);
const pkg = JSON.parse(await readFile(resolve(parent, 'inbox-zero/package.json'), 'utf8'));
run(app, 'npx', ['--yes', pkg.packageManager, 'exec', 'prisma', 'migrate', 'deploy'], dbEnv);
await writeFile(installed, JSON.stringify({ version: 1 }), { mode: 0o600 });
run(root, process.execPath, ['start.mjs']);
console.log('\nAdd one email account in the Thunderbird window and finish Microsoft sign-in.');
console.log('Waiting for your Thunderbird account. No email will be sent or changed.');
let linked = false;
for (let count = 0; count < 600; count++) {
  try {
    const response = await fetch('http://127.0.0.1:7700/inbox-zero/accounts', {
      headers: { Authorization: `Bearer ${state.http}` }, signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    const accounts = body;
    if (response.ok && Array.isArray(accounts) && accounts.length === 1 && accounts[0].email) { linked = true; break; }
    if (Array.isArray(accounts) && accounts.length > 1) throw new Error('Initial setup supports one account. Keep only the account you want to link in this dedicated profile.');
  } catch (error) {
    if (error.message.includes('Initial setup')) throw error;
  }
  await new Promise(done => setTimeout(done, 2000));
}
if (!linked) throw new Error('Sign-in was not completed within 20 minutes. Rerun the same command when ready; your configuration is preserved.');
run(app, 'npx', ['--yes', pkg.packageManager, 'exec', 'tsx', 'scripts/setup-thunderbird.mts']);
run(root, process.execPath, ['start-inbox-zero.mjs']);
for (let count = 0; count < 60; count++) {
  try { await fetch('http://127.0.0.1:3000/login', { signal: AbortSignal.timeout(3000) }); break; }
  catch { await new Promise(done => setTimeout(done, 2000)); }
}
console.log('\nReady. Sign into Inbox Zero with your email address and the separate local password.');
console.log(`Your local password is in ${resolve(root, '.private/local-inbox-zero-password.txt')}`);
run(root, 'open', ['http://127.0.0.1:3000/login']);
run(root, 'open', ['-t', resolve(root, '.private/local-inbox-zero-password.txt')]);
