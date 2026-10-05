import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createContext, runInContext } from 'node:vm';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { ThunderbirdMailReader } from '../../inbox-zero/apps/web/utils/email/thunderbird.ts';
import { createPreviewServer } from '../preview.mjs';

const require = createRequire(new URL('../../thunderbird-cli/package.json', import.meta.url));
const WebSocket = require('ws');
const token = 'a'.repeat(64), wsToken = 'b'.repeat(64), sessionToken = 'c'.repeat(64);

async function port() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}

test('real bridge, extension handlers and Inbox Zero mapping work together without AI', async t => {
  const httpPort = await port(), wsPort = await port();
  const bridgeUrl = `http://127.0.0.1:${httpPort}`;
  const child = spawn(process.execPath, [new URL('../../thunderbird-cli/bridge/bridge.js', import.meta.url).pathname,
    '--port', String(httpPort), '--ws-port', String(wsPort), '--read-only'], {
    env: { ...process.env, TB_AUTH_TOKEN: token, TB_WS_AUTH_TOKEN: wsToken, TB_BRIDGE_TIMEOUT: '2000' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = ''; child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(logs || 'Bridge startup timed out')), 5000);
    child.stdout.on('data', () => { if (logs.includes('Waiting for Thunderbird')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(logs)); });
  });
  const unauthenticated = await fetch(`${bridgeUrl}/bridge/status`);
  assert.equal(unauthenticated.status, 401);
  for (const path of ['/compose', '/messages/delete', '/messages/update', '/bulk/delete', '/unknown']) {
    assert.equal((await fetch(`${bridgeUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}' })).status, 403);
  }
  const rejectedSocket = new WebSocket(`ws://127.0.0.1:${wsPort}/?token=wrong`);
  await new Promise(resolve => rejectedSocket.once('error', resolve));
  rejectedSocket.terminate();

  const folder = { id: 'folder-inbox', accountId: 'account1', name: 'Inbox', path: '/INBOX', specialUse: ['inbox'], subFolders: [] };
  const headers = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1, folder, date: new Date('2026-10-05T12:00:00Z'), author: 'Recruiter <test@example.invalid>',
    subject: index === 0 ? '<script>tracking()</script>' : `Mail ${index + 1}`,
    recipients: ['student@example.invalid'], ccList: [], headerMessageId: `message-${index + 1}@example.invalid`,
    read: false, flagged: index === 0, tags: [],
  }));
  const foreign = { ...headers[0], id: 999, folder: { ...folder, accountId: 'account2' } };
  const nativePages = new Map();
  const account = { id: 'account1', type: 'imap', name: 'Test', identities: [{ email: 'student@example.invalid' }],
    rootFolder: { id: 'root', isRoot: true, subFolders: [folder] } };
  const messenger = {
    accounts: { list: async () => [account], get: async id => id === account.id ? account : undefined },
    folders: { get: async id => id === folder.id ? folder : { ...folder, accountId: 'account2' }, getFolderInfo: async () => ({ totalMessageCount: 7, unreadMessageCount: 7 }) },
    messages: {
      query: async query => {
        assert.equal(query.accountId, 'account1'); assert.equal(query.junk, false);
        const id = randomUUID(); nativePages.set(id, headers.slice(3)); return { id, messages: headers.slice(0, 3) };
      },
      continueList: async id => ({ id: null, messages: nativePages.get(id) }),
      abortList: async id => nativePages.delete(id),
      get: async id => {
        if (id === 999) return foreign;
        const header = headers.find(header => header.id === id);
        if (!header) throw new Error('Message not found');
        return header;
      },
      getFull: async () => ({ contentType: 'multipart/mixed', headers: { 'list-unsubscribe': ['<mailto:stop@example.invalid>'] }, parts: [
        { contentType: 'text/plain', body: 'Interview details\nTuesday at noon.' },
        { contentType: 'text/html', body: '<img src="https://tracking.invalid/pixel">' },
        { contentType: 'application/pdf', name: 'details.pdf', size: 20, partName: '1.3' },
      ] }),
    },
  };
  class TestSocket extends WebSocket {
    constructor(url) { super(url); sockets.push(this); }
  }
  const extensionSource = (await readFile(new URL('../extension/src/inbox-zero.js', import.meta.url), 'utf8'))
    .replace('ws://127.0.0.1:7701/', `ws://127.0.0.1:${wsPort}/`);
  const context = createContext({ WebSocket: TestSocket, INBOX_ZERO_WS_TOKEN: wsToken, messenger,
    crypto: { randomUUID }, setTimeout: () => 0, clearTimeout() {}, console });
  runInContext(extensionSource, context);
  await once(sockets[0], 'open');
  const reader = new ThunderbirdMailReader({ baseUrl: bridgeUrl, token, accountId: 'account1' });
  assert.equal((await reader.getStatus()).readOnly, true);
  assert.equal((await reader.getAccounts())[0].email, 'student@example.invalid');
  assert.deepEqual(await reader.getInboxStats(), { total: 7, unread: 7 });
  const ids = [];
  let cursor;
  do {
    const page = await reader.getMessagesWithPagination({ maxResults: 2, pageToken: cursor });
    ids.push(...page.messages.map(message => message.id)); cursor = page.nextPageToken;
  } while (cursor);
  assert.equal(new Set(ids).size, 7);
  ids.forEach(id => assert.match(id, /^tb:account1:[a-f0-9]{32}$/));
  const message = await reader.getMessage(ids[0]);
  assert.equal(message.subject, '<script>tracking()</script>');
  assert.match(message.textPlain, /Tuesday/); assert.equal(message.headers.from, 'Recruiter <test@example.invalid>');
  assert.equal(message.attachments[0].filename, 'details.pdf'); assert.equal(message.headers['list-unsubscribe'], '<mailto:stop@example.invalid>');
  assert.equal(message.labelIds.includes('STARRED'), true);
  assert.equal(message.labelIds.includes(folder.id), false);
  headers[0].headerMessageId = 'replacement@example.invalid';
  await assert.rejects(reader.getMessage(ids[0]), /message IDs changed/);
  headers[0].headerMessageId = 'message-1@example.invalid';
  headers[0].id = 101;
  const restarted = await reader.getMessage(ids[0]);
  assert.equal(restarted.id, ids[0]);
  assert.equal(restarted.subject, message.subject);
  headers[0].id = 1;
  await assert.rejects(reader.getMessage(ids[0].replace('account1', 'account2')), /another account/);
  await assert.rejects(reader.getMessage('tb:account1:1'), error => error.status === 404);
  const foreignRequest = await fetch(`${bridgeUrl}/inbox-zero/message`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 'account1', messageId: 999 }) });
  assert.match((await foreignRequest.json()).error, /another account/);
  await assert.rejects(reader.getMessagesWithPagination({ folderId: 'foreign' }), /another account/);
  await assert.rejects(reader.getMessagesWithPagination({ pageToken: 'expired' }), /expired/);
  await assert.rejects(reader.getMessagesWithPagination({ maxResults: 1000 }), /Page size/);
  await assert.rejects(reader.getMessagesWithPagination({ after: new Date() }), /not supported/);
  assert.throws(() => new ThunderbirdMailReader({ baseUrl: 'https://remote.invalid', token }), /127.0.0.1/);
  assert.throws(() => new ThunderbirdMailReader({ baseUrl: bridgeUrl, token: '' }), /private bridge token/);

  const previewPort = await port();
  const preview = createPreviewServer({ token, sessionToken, bridgeUrl, port: previewPort });
  preview.listen(previewPort, '127.0.0.1'); await once(preview, 'listening');
  t.after(() => new Promise(resolve => preview.close(resolve)));
  const previewUrl = `http://127.0.0.1:${previewPort}`;
  assert.equal((await fetch(`${previewUrl}/api/accounts`)).status, 401);
  const home = await fetch(previewUrl); const cookie = home.headers.get('set-cookie').split(';')[0];
  assert.match(home.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const html = await home.text(); assert.match(html, /AI processing is disabled/);
  const options = { headers: { Cookie: cookie } };
  assert.equal((await fetch(`${previewUrl}/api/accounts`, options)).status, 200);
  const firstPage = await (await fetch(`${previewUrl}/api/messages?accountId=account1&folderId=folder-inbox&limit=2`, options)).json();
  assert.equal(firstPage.messages.length, 2);
  assert.ok(firstPage.nextPageToken);
  const remainingPage = await (await fetch(`${previewUrl}/api/messages?accountId=account1&limit=100&cursor=${firstPage.nextPageToken}`, options)).json();
  assert.equal(remainingPage.messages.length, 5);
  assert.equal(remainingPage.nextPageToken, undefined);
  assert.equal((await fetch(`${previewUrl}/api/messages?accountId=account1&limit=100000`, options)).status, 503);
  const sample = await (await fetch(`${previewUrl}/api/sample`, options)).json();
  assert.match(sample.messages[0].id, /^tb:sample:[a-f0-9]{32}$/);
  assert.equal((await fetch(`${previewUrl}/api/accounts`, { headers: { Cookie: cookie, Origin: 'https://evil.invalid' } })).status, 403);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${previewUrl}/api/accounts`, { headers: { Cookie: cookie, Host: 'evil.invalid' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject); request.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await fetch(`${previewUrl}/api/accounts`, { method: 'POST', headers: { Cookie: cookie } })).status, 405);
});
