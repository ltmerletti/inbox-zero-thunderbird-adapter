import { spawn, execFileSync } from 'node:child_process';
import { open,readFile,writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const app=`${root}../inbox-zero/apps/web`;
const saved=`${root}.private/inbox-zero-process.json`;
if(process.argv.includes('--restart')) {
  try {
    const old=JSON.parse(await readFile(saved,'utf8'));
    const command=execFileSync('/bin/ps',['-p',String(old.pid),'-o','command='],{encoding:'utf8'});
    if(!command.includes('next') || !command.includes('3000')) throw new Error('Process identity does not match Inbox Zero');
    process.kill(old.pid,'SIGTERM');
    await new Promise(resolve=>setTimeout(resolve,500));
  } catch(error) {if(error.status!==1 && error.code!=='ENOENT' && error.code!=='ESRCH') throw error;}
}
try {await fetch('http://127.0.0.1:3000',{signal:AbortSignal.timeout(5000)}); console.log('Inbox Zero is already running.'); process.exit(0);}
catch(error){if(error.cause?.code!=='ECONNREFUSED') throw error;}
const require=createRequire(`${app}/package.json`);
const cli=require.resolve('next/dist/bin/next');
const log=await open(`${root}.private/inbox-zero.log`,'a',0o600);
const child=spawn(process.execPath,[cli,'dev','--hostname','127.0.0.1','--port','3000'],{cwd:app,env:{...process.env,NODE_OPTIONS:'--max-old-space-size=2048',NEXT_TELEMETRY_DISABLED:'1'},detached:true,stdio:['ignore',log.fd,log.fd]});
await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
child.unref();await log.close();await writeFile(saved,JSON.stringify({pid:child.pid,cli}),{mode:0o600});
console.log('Starting the real Inbox Zero app at http://127.0.0.1:3000.');
