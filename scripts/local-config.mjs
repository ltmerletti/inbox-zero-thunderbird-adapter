import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function createLocalConfig(root) {
  const privateDir = resolve(root, '.private');
  const marker = resolve(privateDir, 'installer-state.json');
  const inbox = resolve(root, '../inbox-zero');
  const app = resolve(inbox, 'apps/web');
  const protectedFiles = [resolve(app, '.env.local'), resolve(inbox, '.env.thunderbird'),
    resolve(privateDir, 'secrets.json'), resolve(privateDir, 'inbox-zero-config.json')];
  if (!existsSync(marker) && protectedFiles.some(existsSync)) {
    throw new Error('Existing private configuration found. This installer will not replace it. Use a fresh installation folder.');
  }
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const secret = () => randomBytes(32).toString('hex');
  let state;
  if (existsSync(marker)) state = JSON.parse(await readFile(marker, 'utf8'));
  else {
    state = { http: secret(), ws: secret(), preview: secret(), password: secret(),
      postgres: secret(), redis: secret(), auth: secret(), encrypt: secret(),
      salt: secret(), internal: secret(), apiSalt: secret() };
    await writeFile(marker, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  }
  const writeOnce = async (file, content) => {
    try { await writeFile(file, content, { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  };
  await writeOnce(resolve(privateDir, 'secrets.json'), JSON.stringify({ http: state.http, ws: state.ws, preview: state.preview }));
  await writeOnce(resolve(privateDir, 'inbox-zero-config.json'), JSON.stringify({ password: state.password }));
  await writeOnce(resolve(privateDir, 'local-inbox-zero-password.txt'), state.password + '\n');
  await writeOnce(resolve(inbox, '.env.thunderbird'), `POSTGRES_PASSWORD=${state.postgres}\nREDIS_HTTP_TOKEN=${state.redis}\n`);
  const config = {
    NODE_ENV: 'development', NEXT_PUBLIC_BASE_URL: 'http://127.0.0.1:3000',
    DATABASE_URL: `postgresql://postgres:${state.postgres}@127.0.0.1:5446/inboxzero`,
    AUTH_SECRET: state.auth, EMAIL_ENCRYPT_SECRET: state.encrypt, EMAIL_ENCRYPT_SALT: state.salt,
    INTERNAL_API_KEY: state.internal, API_KEY_SALT: state.apiSalt,
    GOOGLE_CLIENT_ID: 'unused-local-thunderbird', GOOGLE_CLIENT_SECRET: 'unused-local-thunderbird',
    GOOGLE_PUBSUB_TOPIC_NAME: 'unused-local-thunderbird',
    REDIS_HTTP_URL: 'http://127.0.0.1:8076', REDIS_HTTP_TOKEN: state.redis, REDIS_URL: 'redis://127.0.0.1:6386',
    DEFAULT_LLMS: 'openai:gpt-4o-mini', LOCAL_AI_DISABLED: 'true', LOCAL_THUNDERBIRD_ENABLED: 'true',
    THUNDERBIRD_BRIDGE_URL: 'http://127.0.0.1:7700', THUNDERBIRD_BRIDGE_TOKEN: state.http,
    NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS: 'true', NEXT_PUBLIC_AUTO_DRAFT_DISABLED: 'true',
    NEXT_PUBLIC_AI_MODEL_SETTINGS_DISABLED: 'true', SSO_LOGIN_ENABLED: 'false',
    CLI_LLM_ENABLED: 'false', AI_SENDER_PATTERN_LEARNING_ENABLED: 'false', QUEUE_BACKEND: 'internal',
  };
  await writeOnce(resolve(app, '.env.local'), Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
  return state;
}
