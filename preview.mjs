import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { ThunderbirdMailReader, toInboxZeroMessage } from '../inbox-zero/apps/web/utils/email/thunderbird.ts';

const sample = {
  id: 1, accountId: 'sample', folderId: 'sample-inbox', date: '2026-10-05T12:00:00.000Z',
  author: 'Example Recruiter <recruiter@example.invalid>', recipients: ['student@example.invalid'],
  ccList: [], subject: 'Sample: interview availability', headerMessageId: '<sample@example.invalid>',
  read: false, flagged: false, tags: [],
  parts: { text: 'This is a made-up email for testing. Please send your availability for an interview next week.', html: '', attachments: [] },
};

export function createPreviewServer({ token, sessionToken, bridgeUrl = 'http://127.0.0.1:7700', port = 3001 }) {
  if (!sessionToken || sessionToken.length < 32) throw new Error('Private preview session token required');
  const reader = accountId => new ThunderbirdMailReader({ token, baseUrl: bridgeUrl, accountId });
  return createServer(async (request, response) => {
    const host = request.headers.host;
    const origin = `http://127.0.0.1:${port}`;
    const localhostOrigin = `http://localhost:${port}`;
    const allowedHost = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
    const allowedOrigin = !request.headers.origin || [origin, localhostOrigin].includes(request.headers.origin);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
    if (!allowedHost || !allowedOrigin) return send(403, { error: 'Local access only' });
    const url = new URL(request.url, origin);
    try {
      if (request.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
        if (url.pathname === '/') response.setHeader('Set-Cookie', `tb_preview=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`);
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const types = { 'index.html': 'text/html', 'app.js': 'text/javascript', 'style.css': 'text/css' };
        response.writeHead(200, { 'Content-Type': types[file] });
        return response.end(await readFile(new URL(`./public/${file}`, import.meta.url)));
      }
      if (request.method !== 'GET') return send(405, { error: 'This preview only reads mail' });
      const cookie = request.headers.cookie?.split('; ').find(value => value.startsWith('tb_preview='))?.slice(11) || '';
      const actual = Buffer.from(cookie), expected = Buffer.from(sessionToken);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { error: 'Open the local preview first' });
      if (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) return send(403, { error: 'Same-origin access required' });
      const accountId = url.searchParams.get('accountId') || undefined;
      if (url.pathname === '/api/sample') return send(200, { messages: [toInboxZeroMessage(sample)] });
      if (url.pathname === '/api/status') {
        try { return send(200, await reader().getStatus()); }
        catch { return send(200, { bridge: 'unavailable', extension: 'disconnected', readOnly: true }); }
      }
      if (url.pathname === '/api/accounts') return send(200, await reader().getAccounts());
      if (url.pathname === '/api/folders') return send(200, await reader(accountId).getThunderbirdFolders());
      if (url.pathname === '/api/messages') return send(200, await reader(accountId).getMessagesWithPagination({
        folderId: url.searchParams.get('folderId') || undefined,
        query: url.searchParams.get('query') || undefined,
        pageToken: url.searchParams.get('cursor') || undefined,
        maxResults: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 25,
      }));
      if (url.pathname === '/api/message') return send(200, await reader(accountId).getMessage(url.searchParams.get('id') || ''));
      send(404, { error: 'Not found' });
    } catch (error) { send(503, { error: error.message }); }
  });
}
