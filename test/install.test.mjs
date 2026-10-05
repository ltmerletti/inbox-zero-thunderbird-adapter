import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalConfig } from '../scripts/local-config.mjs';

async function installation(t) {
  const parent = await mkdtemp(join(tmpdir(), 'adapter-install-test-'));
  const root = join(parent, 'thunderbird-inbox-zero');
  await mkdir(root);
  await mkdir(join(parent, 'inbox-zero/apps/web'), { recursive: true });
  t.after(() => rm(parent, { recursive: true, force: true }));
  return { parent, root };
}

test('first install makes matching private credentials and retry preserves them', async t => {
  const { parent, root } = await installation(t);
  const first = await createLocalConfig(root);
  const envPath = join(parent, 'inbox-zero/apps/web/.env.local');
  const original = await readFile(envPath, 'utf8');
  assert.match(original, /^LOCAL_AI_DISABLED=true$/m);
  assert.match(original, /^NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED=false$/m);
  assert.match(original, /^LOCAL_THUNDERBIRD_ENABLED=true$/m);
  assert.ok(original.includes(`THUNDERBIRD_BRIDGE_TOKEN=${first.http}`));
  assert.ok(original.includes(`postgres:${first.postgres}@127.0.0.1`));
  assert.doesNotMatch(original, /^(OPENAI_API_KEY|ANTHROPIC_API_KEY|LLM_API_KEY)=/m);
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(root, '.private'))).mode & 0o777, 0o700);
  const second = await createLocalConfig(root);
  assert.deepEqual(second, first);
  assert.equal(await readFile(envPath, 'utf8'), original);
  assert.equal((await readFile(join(root, '.private/local-inbox-zero-password.txt'), 'utf8')).trim(), first.password);
});

test('installer refuses an existing configuration without changing it', async t => {
  const { parent, root } = await installation(t);
  const envPath = join(parent, 'inbox-zero/apps/web/.env.local');
  await writeFile(envPath, 'KEEP_THIS_CONFIGURATION=true\n');
  await assert.rejects(createLocalConfig(root), /will not replace/);
  assert.equal(await readFile(envPath, 'utf8'), 'KEEP_THIS_CONFIGURATION=true\n');
});
