import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createPreviewServer } from './preview.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const privateDir = `${root}.private`;
await mkdir(privateDir, { recursive: true, mode: 0o700 });
const secretsPath = `${privateDir}/secrets.json`;
if (!existsSync(secretsPath)) await writeFile(secretsPath, JSON.stringify({
  http: randomBytes(32).toString('hex'), ws: randomBytes(32).toString('hex'), preview: randomBytes(32).toString('hex'),
}), { mode: 0o600 });
const secrets = JSON.parse(await readFile(secretsPath, 'utf8'));
if (process.argv.includes('--serve')) {
  const server = createPreviewServer({ token: secrets.http, sessionToken: secrets.preview, port: 3001 });
  server.listen(3001, '127.0.0.1', () => console.log('Thunderbird + Inbox Zero preview: http://127.0.0.1:3001'));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
} else {
  const extension = `${root}extension`;
  await mkdir(`${extension}/src`, { recursive: true });
  await writeFile(`${extension}/manifest.json`, JSON.stringify({
    manifest_version: 2, name: 'Inbox Zero Thunderbird Reader', version: '0.2.0',
    description: 'Local mail connection for Inbox Zero with folder moves.',
    browser_specific_settings: { gecko: { id: 'inbox-zero-reader@local', strict_min_version: '140.0' } },
    permissions: ['accountsRead', 'messagesRead', 'messagesMove'],
    background: { scripts: ['config.js', 'src/inbox-zero.js'] },
  }, null, 2));
  await writeFile(`${extension}/config.js`, `const INBOX_ZERO_WS_TOKEN = ${JSON.stringify(secrets.ws)};\n`, { mode: 0o600 });
  const require = createRequire(new URL('../thunderbird-cli/package.json', import.meta.url));
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(); zip.addLocalFolder(extension);
  const profile = `${root}profile`;
  await mkdir(`${profile}/extensions`, { recursive: true, mode: 0o700 });
  zip.writeZip(`${root}inbox-zero-reader.xpi`);
  await copyFile(`${root}inbox-zero-reader.xpi`, `${profile}/extensions/inbox-zero-reader@local.xpi`);
  await writeFile(`${profile}/user.js`, [
    'user_pref("extensions.autoDisableScopes", 0);',
    'user_pref("mail.server.default.autosync_offline_stores", false);',
    'user_pref("mail.shell.checkDefaultClient", false);',
    'user_pref("mail.server.default.using_subscription", false);',
    'user_pref("mail.server.default.check_all_folders_for_new", true);',
    'user_pref("mail.imap.use_status_for_biff", false);',
  ].join('\n') + '\n');
  const processes = [];
  async function launch(name, executable, args, env = {}) {
    const log = await open(`${privateDir}/${name}.log`, 'a', 0o600);
    const child = spawn(executable, args, { cwd: root, env: { ...process.env, ...env },
      detached: true, stdio: ['ignore', log.fd, log.fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    processes.push({ name, pid: child.pid }); child.unref(); await log.close();
  }
  try {
    const status = await fetch('http://127.0.0.1:3001/api/status', { signal: AbortSignal.timeout(1000) });
    if (status.status === 401) {
      console.log('Preview is already running at http://127.0.0.1:3001');
      process.exit(0);
    }
    throw new Error('Port 3001 is occupied by another service');
  } catch (error) {
    if (!['ECONNREFUSED', 'ENOTFOUND'].includes(error.cause?.code)) throw error;
  }
  await launch('bridge', process.execPath, [`${root}../thunderbird-cli/bridge/bridge.js`, '--inbox-zero'], {
    TB_AUTH_TOKEN: secrets.http, TB_WS_AUTH_TOKEN: secrets.ws, TB_BRIDGE_TIMEOUT: '10000',
  });
  await launch('preview', process.execPath, [`${root}start.mjs`, '--serve']);
  const bundled = `${root}Thunderbird.app/Contents/MacOS/thunderbird`;
  const executable = process.env.THUNDERBIRD_EXECUTABLE || (existsSync(bundled) ? bundled : '/Applications/Thunderbird.app/Contents/MacOS/thunderbird');
  if (!existsSync(executable)) throw new Error('Thunderbird is missing. Install Thunderbird or set THUNDERBIRD_EXECUTABLE.');
  await launch('thunderbird', executable, ['-no-remote', '-profile', profile]);
  await writeFile(`${privateDir}/processes.json`, JSON.stringify(processes), { mode: 0o600 });
  console.log('Started Thunderbird, a mail bridge, and the Inbox Zero adapter preview.');
  console.log('Open http://127.0.0.1:3001. Add your email account in Thunderbird when ready.');
}
