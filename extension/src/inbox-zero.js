const cursors = new Map();
let reconnectTimer;

function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:7701/?token=${encodeURIComponent(INBOX_ZERO_WS_TOKEN)}`);
  socket.onmessage = async ({ data }) => {
    let request;
    try {
      request = JSON.parse(data);
      const result = await handle(request);
      socket.send(JSON.stringify({ id: request.id, result }));
    } catch (error) {
      if (request?.id && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ id: request.id, error: { message: error.message } }));
      }
    }
  };
  socket.onclose = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 5000);
  };
  socket.onerror = () => socket.close();
}

async function handle({ method, path, body = {} }) {
  if (method === "GET" && path === "/health") return { thunderbird: true, readOnly: true };
  if (method === "GET" && path === "/inbox-zero/accounts") {
    return (await messenger.accounts.list(true)).filter(a => a.type !== "none").map(a => ({
      id: a.id, name: a.name, type: a.type,
      email: a.identities?.[0]?.email || "",
    }));
  }
  if (method !== "POST") throw new Error("Unsupported read operation");
  const account = await messenger.accounts.get(body.accountId, true);
  if (!account || account.type === "none") throw new Error("Select a configured email account");
  if (path === "/inbox-zero/folders") return getFolders(account);
  if (path === "/inbox-zero/move") {
    if (!Number.isInteger(body.messageId) || body.messageId < 1 || typeof body.folderId !== "string") {
      throw new Error("Select a message and destination folder");
    }
    const destination = await messenger.folders.get(body.folderId);
    if (!destination || destination.isRoot || destination.accountId !== account.id) {
      throw new Error("Destination folder belongs to another account or is not a mail folder");
    }
    const header = await messenger.messages.get(body.messageId);
    if (header.folder?.accountId !== account.id) throw new Error("Message belongs to another account");
    const identity = JSON.stringify([header.folder.id, header.headerMessageId ||
      [header.date.toISOString(), header.author || "", header.subject || ""]]);
    if (identity !== body.expectedIdentity) throw new Error("Message changed; refresh before moving it");
    if (header.folder.id !== destination.id) {
      const sourceCapabilities = await messenger.folders.getFolderCapabilities(header.folder.id);
      const destinationCapabilities = await messenger.folders.getFolderCapabilities(destination.id);
      if (!sourceCapabilities.canDeleteMessages || !destinationCapabilities.canAddMessages) {
        throw new Error("Source or destination folder does not support moving messages");
      }
      await messenger.messages.move([header.id], destination.id, { isUserAction: true });
      for (const id of [...cursors.keys()]) discardCursor(id);
    }
    return { moved: true, folderId: destination.id };
  }
  if (path === "/inbox-zero/message") {
    const header = await messenger.messages.get(body.messageId);
    if (header.folder?.accountId !== account.id) throw new Error("Message belongs to another account");
    const full = await messenger.messages.getFull(header.id);
    return { ...formatHeader(header), headers: full.headers || {}, parts: textParts(full) };
  }
  if (path === "/inbox-zero/messages") {
    const limit = body.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Page size must be 1–100");
    expireCursors();
    let page;
    let remaining;
    let nativeId;
    if (body.cursor) {
      const cursor = cursors.get(body.cursor);
      if (!cursor || cursor.accountId !== account.id) throw new Error("Page expired; start the list again");
      cursors.delete(body.cursor);
      remaining = cursor.remaining;
      nativeId = cursor.nativeId;
    } else {
      const query = { accountId: account.id, junk: false };
      if (body.folderId) {
        const folder = await messenger.folders.get(body.folderId);
        if (folder.accountId !== account.id) throw new Error("Folder belongs to another account");
        query.folderId = body.folderId;
      }
      if (body.unreadOnly) query.unread = true;
      if (body.query) {
        if (typeof body.query !== "string" || body.query.length > 500) throw new Error("Search is too long");
        query.fullText = body.query;
      }
      page = await messenger.messages.query(query);
      remaining = page.messages;
      nativeId = page.id;
    }
    const messages = [];
    while (messages.length < limit) {
      const take = Math.min(limit - messages.length, remaining.length);
      messages.push(...remaining.splice(0, take));
      if (messages.length >= limit || !nativeId) break;
      page = await messenger.messages.continueList(nativeId);
      remaining = page.messages;
      nativeId = page.id;
    }
    let nextCursor;
    if (remaining.length || nativeId) {
      if (cursors.size >= 100) discardCursor(cursors.keys().next().value);
      nextCursor = crypto.randomUUID();
      cursors.set(nextCursor, { remaining, nativeId, accountId: account.id, expires: Date.now() + 300000 });
    }
    return { messages: messages.map(formatHeader), nextCursor };
  }
  throw new Error("This extension only supports reading and moving mail");
}

async function getFolders(account) {
  const result = [];
  async function visit(folder) {
    if (!folder.isRoot) {
      const info = await messenger.folders.getFolderInfo(folder);
      result.push({ id: folder.id, name: folder.name, path: folder.path,
        accountId: account.id, specialUse: folder.specialUse || [],
        total: info.totalMessageCount || 0, unread: info.unreadMessageCount || 0 });
    }
    for (const child of folder.subFolders || []) await visit(child);
  }
  if (account.rootFolder) await visit(account.rootFolder);
  else for (const folder of account.folders || []) await visit(folder);
  return result;
}

function formatHeader(message) {
  return { id: message.id, accountId: message.folder?.accountId,
    folderId: message.folder?.id, date: message.date.toISOString(),
    author: message.author || "", subject: message.subject || "",
    recipients: message.recipients || [], ccList: message.ccList || [],
    headerMessageId: message.headerMessageId || "", read: message.read,
    flagged: message.flagged, tags: message.tags || [], size: message.size || 0 };
}

function textParts(part, result = { text: "", html: "", attachments: [] }) {
  if (part.contentType === "text/plain" && part.body) result.text += part.body + "\n";
  else if (part.contentType === "text/html" && part.body) result.html += part.body;
  else if (part.name) result.attachments.push({ name: part.name, contentType: part.contentType,
    size: part.size || 0, partName: part.partName });
  for (const child of part.parts || []) textParts(child, result);
  return result;
}

function discardCursor(id) {
  const cursor = cursors.get(id);
  cursors.delete(id);
  if (cursor?.nativeId) messenger.messages.abortList(cursor.nativeId).catch(() => {});
}

function expireCursors() {
  for (const [id, cursor] of cursors) if (cursor.expires < Date.now()) discardCursor(id);
}

connect();
