import { readFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const path = new URL('./.private/processes.json', import.meta.url);
let processes;
try { processes = JSON.parse(await readFile(path, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; console.log('No saved adapter processes.'); process.exit(0); }
// Leave Thunderbird open so the user does not lose an unfinished sign-in.
for (const item of processes.filter(item => item.name !== 'thunderbird')) {
  try {
    const { stdout } = await promisify(execFile)('/bin/ps', ['-p', String(item.pid), '-o', 'command=']);
    const expected = item.name === 'bridge' ? '/thunderbird-cli/bridge/bridge.js' : '/thunderbird-inbox-zero/start.mjs --serve';
    if (!stdout.includes(expected)) continue;
  } catch { continue; }
  try { process.kill(item.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
await unlink(path);
console.log('Stopped the preview and bridge. Thunderbird remains open.');
