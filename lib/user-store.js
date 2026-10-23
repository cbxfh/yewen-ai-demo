'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_USERS = 5000;
const MAX_DOCUMENTS_PER_USER = 20;
const MAX_DOCUMENT_CHARS = 250000;
const MAX_USER_DOCUMENT_CHARS = 2000000;
const MAX_CHAT_MESSAGES = 80;

class UserStoreError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'UserStoreError';
    this.code = code;
    this.status = status;
  }
}

function createUserStore(baseDir) {
  const root = path.resolve(baseDir);
  const usersFile = path.join(root, 'users.json');
  const sessionsFile = path.join(root, 'sessions.json');
  const adminFile = path.join(root, 'admin.json');
  const adminSessionsFile = path.join(root, 'admin-sessions.json');
  const userDataRoot = path.join(root, 'users');

  fs.mkdirSync(userDataRoot, { recursive: true });
  ensureJsonFile(usersFile, { version: 1, users: [] });
  ensureJsonFile(sessionsFile, { version: 1, sessions: {} });
  ensureJsonFile(adminFile, { version: 1, admin: null });
  ensureJsonFile(adminSessionsFile, { version: 1, sessions: {} });

  function ensureJsonFile(filePath, fallback) {
    if (fs.existsSync(filePath)) return;
    writeJsonAtomic(filePath, fallback);
  }

  function writeJsonAtomic(filePath, payload) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    fs.renameSync(tempPath, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Windows may ignore POSIX file modes.
    }
  }

  function readJson(filePath, fallback) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return fallback;
    }
  }

  function readRegistry() {
    const registry = readJson(usersFile, { version: 1, users: [] });
    if (!registry || !Array.isArray(registry.users)) return { version: 1, users: [] };
    return registry;
  }

  function readSessions() {
    const sessions = readJson(sessionsFile, { version: 1, sessions: {} });
    if (!sessions || typeof sessions.sessions !== 'object' || Array.isArray(sessions.sessions)) {
      return { version: 1, sessions: {} };
    }
    return sessions;
  }

  function readAdminRecord() {
    const record = readJson(adminFile, { version: 1, admin: null });
    return record && record.admin ? record : { version: 1, admin: null };
  }

  function readAdminSessions() {
    const sessions = readJson(adminSessionsFile, { version: 1, sessions: {} });
    if (!sessions || typeof sessions.sessions !== 'object' || Array.isArray(sessions.sessions)) {
      return { version: 1, sessions: {} };
    }
    return sessions;
  }

  function normalizeUsername(username) {
    return String(username || '').normalize('NFKC').trim();
  }

  function validateCredentials(username, password) {
    const displayName = normalizeUsername(username);
    if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(displayName)) {
      throw new UserStoreError(
        '用户名需为 3–24 个汉字、字母、数字、下划线或短横线',
        'INVALID_USERNAME'
      );
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      throw new UserStoreError('密码长度需为 8–128 个字符', 'INVALID_PASSWORD');
    }
    return displayName;
  }

  function validateAdminCredentials(username, password) {
    const displayName = normalizeUsername(username);
    if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(displayName)) {
      throw new UserStoreError(
        '管理员用户名需为 3–24 个汉字、字母、数字、下划线或短横线',
        'INVALID_ADMIN_USERNAME'
      );
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      throw new UserStoreError('管理员密码长度需为 12–128 个字符', 'INVALID_ADMIN_PASSWORD');
    }
    return displayName;
  }

  function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    return {
      salt,
      passwordHash: crypto.scryptSync(password, salt, 64).toString('hex')
    };
  }

  function verifyPassword(password, user) {
    if (!user || !user.salt || !user.passwordHash) return false;
    const actual = crypto.scryptSync(String(password || ''), user.salt, 64);
    const expected = Buffer.from(user.passwordHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  function publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt
    };
  }

  function findUserById(userId) {
    return readRegistry().users.find((user) => user.id === userId) || null;
  }

  function register(username, password) {
    const displayName = validateCredentials(username, password);
    const usernameKey = displayName.toLocaleLowerCase('zh-CN');
    const registry = readRegistry();
    if (registry.users.length >= MAX_USERS) {
      throw new UserStoreError('当前站点账号数量已达上限', 'USER_LIMIT_REACHED', 503);
    }
    if (registry.users.some((user) => user.usernameKey === usernameKey)) {
      throw new UserStoreError('该用户名已被注册', 'USERNAME_TAKEN', 409);
    }
    const { salt, passwordHash } = hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      username: displayName,
      usernameKey,
      salt,
      passwordHash,
      createdAt: new Date().toISOString()
    };
    registry.users.push(user);
    writeJsonAtomic(usersFile, registry);
    initializeUserData(user.id);
    return publicUser(user);
  }

  function authenticate(username, password) {
    const usernameKey = normalizeUsername(username).toLocaleLowerCase('zh-CN');
    const user = readRegistry().users.find((candidate) => candidate.usernameKey === usernameKey);
    if (!user || !verifyPassword(password, user)) {
      throw new UserStoreError('用户名或密码错误', 'INVALID_CREDENTIALS', 401);
    }
    return publicUser(user);
  }

  function createSession(userId) {
    const user = findUserById(userId);
    if (!user) throw new UserStoreError('账号不存在', 'USER_NOT_FOUND', 404);
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const now = Date.now();
    const store = readSessions();
    const activeEntries = Object.entries(store.sessions)
      .filter(([, session]) => session.expiresAt > now)
      .sort((a, b) => b[1].createdAt - a[1].createdAt)
      .slice(0, 7);
    store.sessions = Object.fromEntries(activeEntries);
    store.sessions[tokenHash] = {
      userId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS
    };
    writeJsonAtomic(sessionsFile, store);
    return { token, expiresAt: now + SESSION_TTL_MS };
  }

  function getSessionUser(token) {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const store = readSessions();
    const session = store.sessions[tokenHash];
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      delete store.sessions[tokenHash];
      writeJsonAtomic(sessionsFile, store);
      return null;
    }
    const user = findUserById(session.userId);
    return user ? publicUser(user) : null;
  }

  function revokeSession(token) {
    if (!token) return;
    const store = readSessions();
    const tokenHash = hashToken(token);
    if (!store.sessions[tokenHash]) return;
    delete store.sessions[tokenHash];
    writeJsonAtomic(sessionsFile, store);
  }

  function hasAdmin() {
    return Boolean(readAdminRecord().admin);
  }

  function setupAdmin(username, password) {
    if (hasAdmin()) {
      throw new UserStoreError('管理员已经初始化', 'ADMIN_ALREADY_CONFIGURED', 409);
    }
    const displayName = validateAdminCredentials(username, password);
    const { salt, passwordHash } = hashPassword(password);
    const admin = {
      username: displayName,
      usernameKey: displayName.toLocaleLowerCase('zh-CN'),
      salt,
      passwordHash,
      createdAt: new Date().toISOString()
    };
    writeJsonAtomic(adminFile, { version: 1, admin });
    return { username: admin.username, createdAt: admin.createdAt };
  }

  function authenticateAdmin(username, password) {
    const admin = readAdminRecord().admin;
    const usernameKey = normalizeUsername(username).toLocaleLowerCase('zh-CN');
    if (!admin || admin.usernameKey !== usernameKey || !verifyPassword(password, admin)) {
      throw new UserStoreError('管理员用户名或密码错误', 'INVALID_ADMIN_CREDENTIALS', 401);
    }
    return { username: admin.username, createdAt: admin.createdAt };
  }

  function createAdminSession(adminUsername) {
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const now = Date.now();
    const store = readAdminSessions();
    store.sessions = Object.fromEntries(
      Object.entries(store.sessions)
        .filter(([, session]) => session.expiresAt > now)
        .sort((a, b) => b[1].createdAt - a[1].createdAt)
        .slice(0, 4)
    );
    store.sessions[tokenHash] = {
      adminUsername,
      createdAt: now,
      expiresAt: now + ADMIN_SESSION_TTL_MS
    };
    writeJsonAtomic(adminSessionsFile, store);
    return { token, expiresAt: now + ADMIN_SESSION_TTL_MS };
  }

  function getAdminSession(token) {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const store = readAdminSessions();
    const session = store.sessions[tokenHash];
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      delete store.sessions[tokenHash];
      writeJsonAtomic(adminSessionsFile, store);
      return null;
    }
    const admin = readAdminRecord().admin;
    if (!admin || admin.username !== session.adminUsername) return null;
    return { username: admin.username };
  }

  function revokeAdminSession(token) {
    if (!token) return;
    const store = readAdminSessions();
    const tokenHash = hashToken(token);
    if (!store.sessions[tokenHash]) return;
    delete store.sessions[tokenHash];
    writeJsonAtomic(adminSessionsFile, store);
  }

  function userDataPath(userId) {
    const user = findUserById(userId);
    if (!user) throw new UserStoreError('账号不存在', 'USER_NOT_FOUND', 404);
    const target = path.resolve(userDataRoot, user.id, 'data.json');
    const allowedPrefix = `${path.resolve(userDataRoot, user.id)}${path.sep}`;
    if (!target.startsWith(allowedPrefix)) {
      throw new UserStoreError('用户数据路径无效', 'INVALID_USER_DATA_PATH', 500);
    }
    return target;
  }

  function emptyUserData() {
    return {
      version: 1,
      documents: [],
      chatMessages: [],
      usage: { day: '', count: 0 },
      updatedAt: new Date().toISOString()
    };
  }

  function initializeUserData(userId) {
    const dataPath = userDataPath(userId);
    if (!fs.existsSync(dataPath)) writeJsonAtomic(dataPath, emptyUserData());
  }

  function readUserData(userId) {
    initializeUserData(userId);
    const data = readJson(userDataPath(userId), emptyUserData());
    return {
      version: 1,
      documents: Array.isArray(data.documents) ? data.documents : [],
      chatMessages: Array.isArray(data.chatMessages) ? data.chatMessages : [],
      usage:
        data.usage && typeof data.usage === 'object'
          ? data.usage
          : { day: '', count: 0 },
      updatedAt: data.updatedAt || new Date().toISOString()
    };
  }

  function writeUserData(userId, data) {
    data.updatedAt = new Date().toISOString();
    writeJsonAtomic(userDataPath(userId), data);
  }

  function documentMetadata(document) {
    return {
      id: document.id,
      name: document.name,
      type: document.type,
      size: document.size,
      charCount: document.charCount,
      createdAt: document.createdAt
    };
  }

  function listDocuments(userId) {
    return readUserData(userId).documents
      .map(documentMetadata)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function createDocument(userId, input) {
    const name = String(input.name || '').trim();
    const type = String(input.type || 'text').trim().toLowerCase();
    const content = String(input.content || '').replace(/\r\n?/g, '\n').trim();
    if (!name || name.length > 160) {
      throw new UserStoreError('资料名称需为 1–160 个字符', 'INVALID_DOCUMENT_NAME');
    }
    if (!/^[a-z0-9_-]{1,20}$/.test(type)) {
      throw new UserStoreError('资料类型无效', 'INVALID_DOCUMENT_TYPE');
    }
    if (!content || content.length > MAX_DOCUMENT_CHARS) {
      throw new UserStoreError(
        `单份资料内容需为 1–${MAX_DOCUMENT_CHARS.toLocaleString()} 个字符`,
        'INVALID_DOCUMENT_CONTENT'
      );
    }

    const data = readUserData(userId);
    if (data.documents.length >= MAX_DOCUMENTS_PER_USER) {
      throw new UserStoreError(
        `每个账号最多保存 ${MAX_DOCUMENTS_PER_USER} 份资料`,
        'DOCUMENT_LIMIT_REACHED',
        409
      );
    }
    const currentChars = data.documents.reduce((sum, document) => sum + document.charCount, 0);
    if (currentChars + content.length > MAX_USER_DOCUMENT_CHARS) {
      throw new UserStoreError('该账号的个人知识库容量已满', 'DOCUMENT_STORAGE_FULL', 409);
    }

    const document = {
      id: crypto.randomUUID(),
      name,
      type,
      content,
      size: Math.max(0, Number(input.size) || Buffer.byteLength(content, 'utf8')),
      charCount: content.length,
      createdAt: new Date().toISOString()
    };
    data.documents.push(document);
    writeUserData(userId, data);
    return documentMetadata(document);
  }

  function getDocument(userId, documentId, includeContent = false) {
    const document = readUserData(userId).documents.find((item) => item.id === documentId);
    if (!document) {
      throw new UserStoreError('资料不存在或不属于当前账号', 'DOCUMENT_NOT_FOUND', 404);
    }
    return includeContent ? { ...document } : documentMetadata(document);
  }

  function deleteDocument(userId, documentId) {
    const data = readUserData(userId);
    const before = data.documents.length;
    data.documents = data.documents.filter((document) => document.id !== documentId);
    if (data.documents.length === before) {
      throw new UserStoreError('资料不存在或不属于当前账号', 'DOCUMENT_NOT_FOUND', 404);
    }
    writeUserData(userId, data);
  }

  function clearDocuments(userId) {
    const data = readUserData(userId);
    data.documents = [];
    writeUserData(userId, data);
  }

  function getKnowledgeByIds(userId, documentIds, limits) {
    if (!Array.isArray(documentIds) || documentIds.length > limits.maxDocuments) {
      throw new UserStoreError(
        `单次最多选择 ${limits.maxDocuments} 份个人资料`,
        'INVALID_KNOWLEDGE_IDS'
      );
    }
    const uniqueIds = [...new Set(documentIds.map((value) => String(value || '')))].filter(Boolean);
    const documentsById = new Map(
      readUserData(userId).documents.map((document) => [document.id, document])
    );
    const documents = [];
    let remaining = limits.maxTotalChars;
    for (const id of uniqueIds) {
      const stored = documentsById.get(id);
      if (!stored) {
        throw new UserStoreError('所选资料不存在或不属于当前账号', 'KNOWLEDGE_NOT_FOUND', 404);
      }
      const allowance = Math.min(limits.maxDocumentChars, remaining, stored.content.length);
      if (allowance <= 0) break;
      documents.push({ name: stored.name, content: stored.content.slice(0, allowance) });
      remaining -= allowance;
    }
    return documents;
  }

  function getChatHistory(userId) {
    return readUserData(userId).chatMessages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt
    }));
  }

  function appendChatExchange(userId, userContent, assistantContent) {
    const data = readUserData(userId);
    const now = new Date().toISOString();
    data.chatMessages.push(
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: userContent,
        createdAt: now
      },
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: assistantContent,
        createdAt: new Date().toISOString()
      }
    );
    if (data.chatMessages.length > MAX_CHAT_MESSAGES) {
      data.chatMessages = data.chatMessages.slice(-MAX_CHAT_MESSAGES);
    }
    writeUserData(userId, data);
  }

  function clearChatHistory(userId) {
    const data = readUserData(userId);
    data.chatMessages = [];
    writeUserData(userId, data);
  }

  function dateKey(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function consumeDailyChat(userId, limit) {
    if (!limit) return { allowed: true, remaining: null };
    const data = readUserData(userId);
    const day = dateKey();
    if (data.usage.day !== day) {
      data.usage = { day, count: 0 };
    }
    if (data.usage.count >= limit) {
      return { allowed: false, remaining: 0 };
    }
    data.usage.count += 1;
    writeUserData(userId, data);
    return { allowed: true, remaining: limit - data.usage.count };
  }

  function getDashboardStats() {
    const now = Date.now();
    const today = dateKey();
    const users = readRegistry().users;
    const activeSessions = Object.values(readSessions().sessions).filter(
      (session) => session.expiresAt > now
    ).length;
    const activeAdminSessions = Object.values(readAdminSessions().sessions).filter(
      (session) => session.expiresAt > now
    ).length;

    const userRows = users.map((user) => {
      const data = readUserData(user.id);
      const lastMessage = data.chatMessages[data.chatMessages.length - 1];
      return {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
        documentCount: data.documents.length,
        messageCount: data.chatMessages.length,
        aiRequestsToday: data.usage.day === today ? Number(data.usage.count) || 0 : 0,
        lastActivityAt: lastMessage?.createdAt || data.updatedAt || user.createdAt
      };
    });

    const dayKeys = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      dayKeys.push(dateKey(new Date(now - offset * 24 * 60 * 60 * 1000)));
    }
    const registrationsByDay = Object.fromEntries(dayKeys.map((day) => [day, 0]));
    users.forEach((user) => {
      const day = dateKey(user.createdAt);
      if (Object.prototype.hasOwnProperty.call(registrationsByDay, day)) {
        registrationsByDay[day] += 1;
      }
    });

    return {
      generatedAt: new Date().toISOString(),
      totalUsers: users.length,
      newUsersToday: users.filter((user) => dateKey(user.createdAt) === today).length,
      activeSessions,
      activeAdminSessions,
      totalDocuments: userRows.reduce((total, user) => total + user.documentCount, 0),
      totalMessages: userRows.reduce((total, user) => total + user.messageCount, 0),
      aiRequestsToday: userRows.reduce((total, user) => total + user.aiRequestsToday, 0),
      recentRegistrations: dayKeys.map((date) => ({
        date,
        count: registrationsByDay[date]
      })),
      users: userRows
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 200)
    };
  }

  return {
    register,
    authenticate,
    createSession,
    getSessionUser,
    revokeSession,
    listDocuments,
    createDocument,
    getDocument,
    deleteDocument,
    clearDocuments,
    getKnowledgeByIds,
    getChatHistory,
    appendChatExchange,
    clearChatHistory,
    consumeDailyChat,
    hasAdmin,
    setupAdmin,
    authenticateAdmin,
    createAdminSession,
    getAdminSession,
    revokeAdminSession,
    getDashboardStats,
    limits: {
      maxDocuments: MAX_DOCUMENTS_PER_USER,
      maxDocumentChars: MAX_DOCUMENT_CHARS,
      maxUserDocumentChars: MAX_USER_DOCUMENT_CHARS,
      maxChatMessages: MAX_CHAT_MESSAGES
    }
  };
}

module.exports = {
  createUserStore,
  UserStoreError
};
