const $ = id => document.getElementById(id);
let nextCursor;
let sampleMessage;
let listVersion = 0;
let folders = [];
let loadedCount = 0;
let loading = false;
let stopLoading = false;
const loadedIds = new Set();
async function api(path, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([,value]) => value));
  const response = await fetch(`${path}?${query}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Connection failed');
  return data;
}
function feedback(error = '') { $('feedback').textContent = error; }
async function refresh() {
  feedback();
  const status = await api('/api/status');
  $('status').textContent = status.extension === 'connected' ? 'Thunderbird connected · reading only · AI off' : 'Adapter ready · waiting for Thunderbird · AI off';
  if (status.extension !== 'connected') return;
  const accounts = await api('/api/accounts');
  const previous = $('account').value;
  $('account').replaceChildren(new Option('Select an account', ''), ...accounts.map(account => new Option(account.email || account.name, account.id)));
  const selected = accounts.some(account => account.id === previous) ? previous : accounts.length === 1 ? accounts[0].id : '';
  $('account').value = selected;
  if (selected && (selected !== previous || !folders.length)) {
    await changeAccount();
    await load(false, true);
  }
  if (!accounts.length) feedback('Thunderbird is connected. Add your email account in Thunderbird to read mail here.');
}
function resetList() {
  listVersion++; nextCursor = undefined; sampleMessage = undefined;
  loadedCount = 0; loadedIds.clear();
  $('messages').replaceChildren(); $('more').hidden = true; $('all').hidden = true;
  $('subject').textContent = 'Select a message'; $('sender').textContent = '';
  $('body').textContent = 'Message text will appear here.'; $('mapped').textContent = '';
  updateCount();
}
async function changeAccount() {
  resetList(); feedback();
  $('folder').replaceChildren(new Option('All folders', ''));
  folders = [];
  if (!$('account').value) return;
  folders = await api('/api/folders', { accountId: $('account').value });
  $('folder').append(...folders.map(folder => new Option(`${folder.path || folder.name} (${folder.total})`, folder.id)));
  const inbox = folders.find(folder => folder.specialUse.includes('inbox'));
  if (inbox) $('folder').value = inbox.id;
  $('setup').hidden = folders.length > 0;
  updateCount();
}
function render(messages) {
  for (const message of messages) {
    if (loadedIds.has(message.id)) continue;
    loadedIds.add(message.id); loadedCount++;
    const button = document.createElement('button'); button.className = 'message';
    const subject = document.createElement('strong'); subject.textContent = message.subject || '(No subject)';
    const sender = document.createElement('span'); sender.textContent = message.headers.from;
    button.append(subject, sender);
    button.onclick = () => safe(async () => {
      const version = listVersion;
      const loaded = sampleMessage || await api('/api/message', { id: message.id, accountId: $('account').value });
      if (version === listVersion) show(loaded);
    });
    $('messages').append(button);
  }
}
function show(message) {
  $('subject').textContent = message.subject;
  $('sender').textContent = `${message.headers.from} · ${new Date(message.date).toLocaleString()}`;
  $('body').textContent = message.textPlain || (message.textHtml ? 'This message has an HTML body. Open it in Thunderbird to view its formatting.' : 'This message has no downloaded plain-text body.');
  $('mapped').textContent = JSON.stringify(message, null, 2);
}
function updateCount() {
  const folder = folders.find(folder => folder.id === $('folder').value);
  let text = `${loadedCount.toLocaleString()} messages loaded`;
  if (folder && !$('query').value) text += ` · ${folder.total.toLocaleString()} in ${folder.name} · ${folder.unread.toLocaleString()} unread`;
  if (loading) text += ' · loading…';
  else if (loadedCount && !nextCursor && !sampleMessage) text += ' · end of list';
  $('count').textContent = text;
}
async function load(more = false, all = false) {
  if (loading) return;
  feedback();
  if (!$('account').value) throw new Error('Select a Thunderbird account first.');
  if (!more) resetList();
  const version = listVersion;
  loading = true; stopLoading = false;
  $('search').disabled = true; $('more').disabled = true; $('all').disabled = true;
  $('stop').hidden = !all;
  let cursor = more ? nextCursor : undefined;
  const params = { accountId: $('account').value, folderId: $('folder').value, query: $('query').value, limit: all ? '100' : '25' };
  try {
    do {
      const page = await api('/api/messages', { ...params, cursor });
      if (version !== listVersion) return;
      render(page.messages); cursor = page.nextPageToken; nextCursor = cursor;
      $('more').hidden = !cursor; $('all').hidden = !cursor;
      updateCount();
    } while (all && cursor && !stopLoading);
    if (!loadedCount) feedback('No matching messages.');
    else if (all && !cursor) feedback('Full available message list loaded. Bodies are fetched when you open a message.');
    else if (stopLoading) feedback('Loading stopped. You can continue with the next page.');
  } finally {
    loading = false; $('search').disabled = false; $('more').disabled = false; $('all').disabled = false;
    $('stop').hidden = true; updateCount();
  }
}
async function safe(fn) {
  try { await fn(); } catch (error) { feedback(error.message); }
}
$('refresh').onclick = () => safe(refresh);
$('account').onchange = () => safe(async () => { await changeAccount(); if ($('account').value) await load(false, true); });
$('folder').onchange = resetList;
$('query').oninput = resetList;
$('search').onclick = () => safe(() => load(false, true));
$('more').onclick = () => safe(() => load(true));
$('all').onclick = () => safe(() => load(true, true));
$('stop').onclick = () => { stopLoading = true; };
$('sample').onclick = () => safe(async () => {
  resetList(); feedback('Sample mode: this is made-up email, not your mailbox.');
  const data = await api('/api/sample'); sampleMessage = data.messages[0]; render(data.messages); show(sampleMessage); updateCount();
});
safe(refresh);
