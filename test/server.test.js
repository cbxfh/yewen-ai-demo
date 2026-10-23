'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { before, after, test } = require('node:test');
const { createApp } = require('../server');
const { resources, buildResourceContext } = require('../data/resources');

let server;
let baseUrl;

before(async () => {
  process.env.AI_API_KEY = '';
  server = createApp();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

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
  assert.match(html, /行业 AI 工具包/);
  assert.match(html, /餐饮/);
  assert.match(html, /美容美发/);
  assert.match(html, /AI/);
});

test('static server does not expose files outside public directory', async () => {
  const response = await fetch(`${baseUrl}/..%2Fserver.js`);
  assert.equal(response.status, 404);
});

test('chat endpoint rejects malformed messages before calling a provider', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
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
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: '请帮我设计一份日检表。' }],
      industry: 'food'
    })
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, 'AI_NOT_CONFIGURED');
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
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: '请给我三个日检重点。' }],
        industry: 'food'
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
  } finally {
    process.env.AI_API_KEY = previous.key ?? '';
    process.env.AI_BASE_URL = previous.base ?? '';
    process.env.AI_MODEL = previous.model ?? '';
    await new Promise((resolve, reject) => {
      mockProvider.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('AI resource context stays within the configured limit', () => {
  const context = buildResourceContext('all', 4000);
  assert.ok(context.length <= 4000);
  assert.match(context, /餐饮门店食品安全日检清单/);
  assert.equal(resources.length, 12);
});
