'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, after, test } = require('node:test');
const { createApp } = require('../server');
const { resources, buildResourceContext } = require('../data/resources');

let server;
let baseUrl;
let testConfigPath;
let testDataDir;
let testSessionCookie;

before(async () => {
  process.env.AI_API_KEY = '';
  testConfigPath = path.join(os.tmpdir(), `industry-ai-toolkit-test-${process.pid}.json`);
  process.env.AI_CONFIG_PATH = testConfigPath;
  testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'industry-ai-toolkit-data-'));
  process.env.APP_DATA_DIR = testDataDir;
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  const registration = await registerUser('main_tester', 'password-123');
  testSessionCookie = registration.cookie;
});

after(async () => {
  if (testConfigPath && fs.existsSync(testConfigPath)) fs.unlinkSync(testConfigPath);
  if (testDataDir && fs.existsSync(testDataDir)) fs.rmSync(testDataDir, { recursive: true, force: true });
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function getSessionCookie(response) {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  assert.ok(cookies.length, 'expected a session cookie');
  return cookies[0].split(';')[0];
}

async function registerUser(username, password = 'password-123') {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(response.status, 201);
  return {
    cookie: getSessionCookie(response),
    payload: await response.json()
  };
}

function authenticatedFetch(path, options = {}, cookie = testSessionCookie) {
  const headers = new Headers(options.headers || {});
  headers.set('Cookie', cookie);
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

test('health endpoint reports the service as ready', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    service: 'industry-ai-toolkit'
  });
});

test('resource endpoint returns both industries and twelve complete resources', async () => {
  const response = await fetch(`${baseUrl}/api/resources`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.industries.length, 2);
  assert.equal(payload.resources.length, 12);
  assert.equal(payload.resources.filter((item) => item.industry === 'food').length, 6);
  assert.equal(payload.resources.filter((item) => item.industry === 'beauty').length, 6);
  payload.resources.forEach((resource) => {
    assert.ok(resource.id);
    assert.ok(resource.title);
    assert.ok(resource.summary);
    assert.ok(Array.isArray(resource.sections) && resource.sections.length >= 3);
    assert.ok(Array.isArray(resource.checklist) && resource.checklist.length >= 5);
  });
});

test('resource endpoint validates industry filters', async () => {
  const valid = await fetch(`${baseUrl}/api/resources?industry=beauty`);
  assert.equal(valid.status, 200);
  const validPayload = await valid.json();
  assert.equal(validPayload.resources.length, 6);
  assert.ok(validPayload.resources.every((item) => item.industry === 'beauty'));

  const invalid = await fetch(`${baseUrl}/api/resources?industry=unknown`);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'INVALID_INDUSTRY');
});

test('index page includes security headers and primary content', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await response.text();
  assert.match(html, /业问/);
  assert.match(html, /og:title/);
  assert.match(html, /门店老板随身的 AI 参谋/);
  assert.match(html, /餐饮/);
  assert.match(html, /美容美发/);
  assert.match(html, /AI/);
});

test('dedicated assistant page exposes API settings and personal knowledge import', async () => {
  const response = await fetch(`${baseUrl}/assistant`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /AI 助手与个人知识库/);
  assert.match(html, /API 设置/);
  assert.match(html, /个人知识库/);
  assert.match(html, /TXT · MD · CSV · JSON · HTML/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /name="viewport"/);
});

test('login page is public and exposes registration and login forms', async () => {
  const response = await fetch(`${baseUrl}/login`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /注册新账号/);
  assert.match(html, /用户名/);
  assert.match(html, /密码/);
  assert.match(html, /知识库按账号隔离/);
});

test('admin dashboard page is separate and marked noindex', async () => {
  const response = await fetch(`${baseUrl}/admin`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /实时数据后台/);
  assert.match(html, /管理员登录/);
  assert.match(html, /noindex, nofollow/);
});

test('authenticated session returns only the current account profile', async () => {
  const response = await authenticatedFetch('/api/auth/session');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.authenticated, true);
  assert.equal(payload.user.username, 'main_tester');
  assert.equal(Object.prototype.hasOwnProperty.call(payload.user, 'passwordHash'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.user, 'salt'), false);
});

test('register, logout, and login create independent valid sessions', async () => {
  const registered = await registerUser('login_cycle_user');
  const logout = await authenticatedFetch(
    '/api/auth/logout',
    { method: 'POST', headers: { Accept: 'application/json' } },
    registered.cookie
  );
  assert.equal(logout.status, 200);

  const expiredSession = await authenticatedFetch('/api/auth/session', {}, registered.cookie);
  assert.equal((await expiredSession.json()).authenticated, false);

  const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'login_cycle_user', password: 'wrong-password' })
  });
  assert.equal(badLogin.status, 401);
  assert.equal((await badLogin.json()).code, 'INVALID_CREDENTIALS');

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'login_cycle_user', password: 'password-123' })
  });
  assert.equal(login.status, 200);
  const loginCookie = getSessionCookie(login);
  const activeSession = await authenticatedFetch('/api/auth/session', {}, loginCookie);
  const activePayload = await activeSession.json();
  assert.equal(activePayload.authenticated, true);
  assert.equal(activePayload.user.username, 'login_cycle_user');
});

test('mobile web manifest is served with the correct content type', async () => {
  const response = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await response.json();
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
});

test('static server does not expose files outside public directory', async () => {
  const response = await fetch(`${baseUrl}/..%2Fserver.js`);
  assert.equal(response.status, 404);
});

test('knowledge documents are isolated between user accounts', async () => {
  const userA = await registerUser('isolation_user_a');
  const userB = await registerUser('isolation_user_b');

  const createResponse = await authenticatedFetch(
    '/api/knowledge',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'A账号私有资料.txt',
        type: 'txt',
        content: '只允许 isolation_user_a 读取的门店资料。'
      })
    },
    userA.cookie
  );
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();

  const listA = await authenticatedFetch('/api/knowledge', {}, userA.cookie);
  assert.equal(listA.status, 200);
  const listAPayload = await listA.json();
  assert.equal(listAPayload.documents.length, 1);
  assert.equal(listAPayload.documents[0].name, 'A账号私有资料.txt');

  const listB = await authenticatedFetch('/api/knowledge', {}, userB.cookie);
  assert.equal(listB.status, 200);
  const listBPayload = await listB.json();
  assert.equal(listBPayload.documents.length, 0);

  const readAsB = await authenticatedFetch(
    `/api/knowledge/${encodeURIComponent(created.document.id)}`,
    {},
    userB.cookie
  );
  assert.equal(readAsB.status, 404);
  assert.equal((await readAsB.json()).code, 'DOCUMENT_NOT_FOUND');

  const useAsB = await authenticatedFetch(
    '/api/chat',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '尝试使用其他账号的资料',
        industry: 'food',
        knowledgeIds: [created.document.id]
      })
    },
    userB.cookie
  );
  assert.equal(useAsB.status, 404);
  assert.equal((await useAsB.json()).code, 'KNOWLEDGE_NOT_FOUND');

  const historyB = await authenticatedFetch('/api/chat/history', {}, userB.cookie);
  assert.equal(historyB.status, 200);
  assert.equal((await historyB.json()).messages.length, 0);
});

test('unauthenticated visitors cannot access private user endpoints', async () => {
  const knowledge = await fetch(`${baseUrl}/api/knowledge`);
  assert.equal(knowledge.status, 401);
  assert.equal((await knowledge.json()).code, 'AUTH_REQUIRED');

  const chat = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '测试' })
  });
  assert.equal(chat.status, 401);
  assert.equal((await chat.json()).code, 'AUTH_REQUIRED');
});

test('chat endpoint rejects malformed messages before calling a provider', async () => {
  const response = await authenticatedFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [], industry: 'food' })
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, 'INVALID_MESSAGES');
});

test('chat endpoint explains that AI is not configured when no key is present', async () => {
  process.env.AI_API_KEY = '';
  const response = await authenticatedFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: '请帮我设计一份日检表。',
      industry: 'food'
    })
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, 'AI_NOT_CONFIGURED');
});

test('local API settings can be saved, read without the key, and cleared', async () => {
  process.env.AI_API_KEY = '';
  process.env.AI_BASE_URL = '';
  process.env.AI_MODEL = '';
  const saveResponse = await fetch(`${baseUrl}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: 'https://api.example.test/v1',
      model: 'mock-config-model',
      apiKey: 'local-test-secret',
      maxTokens: 900
    })
  });
  assert.equal(saveResponse.status, 200);
  const saved = await saveResponse.json();
  assert.equal(saved.saved, true);
  assert.equal(saved.aiConfigured, true);
  assert.equal(saved.model, 'mock-config-model');
  assert.equal(JSON.stringify(saved).includes('local-test-secret'), false);

  const getResponse = await fetch(`${baseUrl}/api/config`);
  assert.equal(getResponse.status, 200);
  const localConfig = await getResponse.json();
  assert.equal(localConfig.baseUrl, 'https://api.example.test/v1');
  assert.equal(localConfig.model, 'mock-config-model');
  assert.equal(localConfig.hasApiKey, true);
  assert.equal(Object.prototype.hasOwnProperty.call(localConfig, 'apiKey'), false);

  const clearResponse = await fetch(`${baseUrl}/api/config`, { method: 'DELETE' });
  assert.equal(clearResponse.status, 200);
  const cleared = await clearResponse.json();
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.aiConfigured, false);
});

test('API settings reject insecure non-local plain HTTP endpoints', async () => {
  const response = await fetch(`${baseUrl}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: 'http://insecure.example.test/v1',
      model: 'model',
      apiKey: 'secret'
    })
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'INSECURE_BASE_URL');
});

test('API settings refuse non-local host headers', async () => {
  const port = server.address().port;
  const result = await new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/config',
        headers: { Host: 'public.example.test' }
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
          });
        });
      }
    );
    request.on('error', reject);
    request.end();
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'LOCAL_CONFIG_ONLY');
});

test('admin setup is disabled for non-local host headers', async () => {
  const port = server.address().port;
  const result = await new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/admin/status',
        headers: { Host: 'public.example.test' }
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
          });
        });
      }
    );
    request.on('error', reject);
    request.end();
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.adminConfigured, false);
  assert.equal(result.body.setupAllowed, false);
});

test('chat endpoint proxies a configured OpenAI-compatible provider request', async () => {
  let received;
  const mockProvider = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received = {
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'mock-model',
          choices: [{ message: { content: '这是来自模拟供应商的测试回答。' } }],
          usage: { total_tokens: 42 }
        })
      );
    });
  });
  await new Promise((resolve) => mockProvider.listen(0, '127.0.0.1', resolve));
  const mockPort = mockProvider.address().port;
  const previous = {
    key: process.env.AI_API_KEY,
    base: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL
  };

  try {
    process.env.AI_API_KEY = 'server-side-test-key';
    process.env.AI_BASE_URL = `http://127.0.0.1:${mockPort}/v1`;
    process.env.AI_MODEL = 'mock-model';
    const uploadResponse = await authenticatedFetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '门店周会纪要.txt',
        type: 'txt',
        content: '本周发现晚高峰冷柜温度记录存在两次缺漏，由值班经理负责补齐复核。'
      })
    });
    assert.equal(uploadResponse.status, 201);
    const uploaded = await uploadResponse.json();

    const response = await authenticatedFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '请给我三个日检重点。',
        industry: 'food',
        knowledgeIds: [uploaded.document.id]
      })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.message, '这是来自模拟供应商的测试回答。');
    assert.equal(payload.model, 'mock-model');
    assert.equal(received.authorization, 'Bearer server-side-test-key');
    assert.equal(received.body.model, 'mock-model');
    assert.match(received.body.messages[0].content, /站内资料/);
    assert.match(received.body.messages[0].content, /餐饮门店食品安全日检清单/);
    assert.match(received.body.messages[0].content, /用户导入的个人知识库/);
    assert.match(received.body.messages[0].content, /门店周会纪要\.txt/);

    const testResponse = await fetch(`${baseUrl}/api/config/test`, {
      method: 'POST',
      headers: { Accept: 'application/json' }
    });
    assert.equal(testResponse.status, 200);
    const testPayload = await testResponse.json();
    assert.equal(testPayload.connected, true);
    assert.equal(testPayload.reply, '这是来自模拟供应商的测试回答。');

    const historyResponse = await authenticatedFetch('/api/chat/history');
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.equal(history.messages.length, 2);
    assert.equal(history.messages[0].content, '请给我三个日检重点。');
    assert.equal(history.messages[1].role, 'assistant');
  } finally {
    process.env.AI_API_KEY = previous.key ?? '';
    process.env.AI_BASE_URL = previous.base ?? '';
    process.env.AI_MODEL = previous.model ?? '';
    await new Promise((resolve, reject) => {
      mockProvider.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('admin setup and dashboard statistics require the separate admin session', async () => {
  const normalUserStats = await authenticatedFetch('/api/admin/stats');
  assert.equal(normalUserStats.status, 401);
  assert.equal((await normalUserStats.json()).code, 'ADMIN_AUTH_REQUIRED');

  const setup = await fetch(`${baseUrl}/api/admin/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin_owner',
      password: 'admin-password-123'
    })
  });
  assert.equal(setup.status, 201);
  const adminCookie = getSessionCookie(setup);
  const setupPayload = await setup.json();
  assert.equal(setupPayload.authenticated, true);
  assert.equal(setupPayload.admin.username, 'admin_owner');

  const duplicateSetup = await fetch(`${baseUrl}/api/admin/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'another_admin',
      password: 'another-password-123'
    })
  });
  assert.equal(duplicateSetup.status, 409);

  const statsResponse = await authenticatedFetch('/api/admin/stats', {}, adminCookie);
  assert.equal(statsResponse.status, 200);
  const stats = await statsResponse.json();
  assert.equal(stats.admin.username, 'admin_owner');
  assert.ok(stats.totalUsers >= 4);
  assert.ok(Array.isArray(stats.users));
  assert.ok(stats.users.every((user) => !Object.hasOwn(user, 'passwordHash')));
  assert.ok(stats.users.every((user) => !Object.hasOwn(user, 'salt')));
  assert.ok(stats.totalDocuments >= 2);
  assert.ok(stats.totalMessages >= 2);

  const logout = await authenticatedFetch(
    '/api/admin/logout',
    { method: 'POST', headers: { Accept: 'application/json' } },
    adminCookie
  );
  assert.equal(logout.status, 200);
  const expiredStats = await authenticatedFetch('/api/admin/stats', {}, adminCookie);
  assert.equal(expiredStats.status, 401);

  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin_owner',
      password: 'admin-password-123'
    })
  });
  assert.equal(login.status, 200);
  const newAdminCookie = getSessionCookie(login);
  const status = await authenticatedFetch('/api/admin/status', {}, newAdminCookie);
  const statusPayload = await status.json();
  assert.equal(statusPayload.authenticated, true);
  assert.equal(statusPayload.adminConfigured, true);
  assert.equal(statusPayload.setupAllowed, false);
});

test('AI resource context stays within the configured limit', () => {
  const context = buildResourceContext('all', 4000);
  assert.ok(context.length <= 4000);
  assert.match(context, /餐饮门店食品安全日检清单/);
  assert.equal(resources.length, 12);
});
