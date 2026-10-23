'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { industries, getResources, buildResourceContext } = require('./data/resources');

const ROOT = __dirname;
const PUBLIC_ROOT = path.join(ROOT, 'public');
const DEFAULT_PORT = 3000;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 18000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 10;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp'
};

const rateBuckets = new Map();

function loadLocalEnv() {
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile) || typeof process.loadEnvFile !== 'function') return;
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    console.warn(`[warn] 无法读取 .env：${error.message}`);
  }
}

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function securityHeaders(contentType = '') {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; " +
      "form-action 'self'; frame-ancestors 'none'"
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

function getClientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { count: 1, startedAt: now });
    return { allowed: true, remaining: RATE_LIMIT - 1 };
  }
  if (bucket.count >= RATE_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - bucket.startedAt)) / 1000))
    };
  }
  bucket.count += 1;
  return { allowed: true, remaining: RATE_LIMIT - bucket.count };
}

function cleanRateBuckets() {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now - bucket.startedAt > RATE_WINDOW_MS * 2) rateBuckets.delete(ip);
  }
}

const rateCleanup = setInterval(cleanRateBuckets, RATE_WINDOW_MS);
rateCleanup.unref();

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求内容过大'), { status: 413, code: 'BODY_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) {
        reject(Object.assign(new Error('请求内容为空'), { status: 400, code: 'EMPTY_BODY' }));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('请求格式不是有效 JSON'), { status: 400, code: 'INVALID_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function validateMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw Object.assign(new Error('messages 必须是非空数组'), { status: 400, code: 'INVALID_MESSAGES' });
  }
  if (input.length > MAX_MESSAGES) {
    throw Object.assign(new Error(`单次最多发送 ${MAX_MESSAGES} 条消息`), {
      status: 400,
      code: 'TOO_MANY_MESSAGES'
    });
  }

  let totalChars = 0;
  const messages = input.map((message) => {
    const role = message && message.role;
    const content = message && message.content;
    if (!['user', 'assistant'].includes(role) || typeof content !== 'string') {
      throw Object.assign(new Error('消息格式无效'), { status: 400, code: 'INVALID_MESSAGE' });
    }
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > MAX_MESSAGE_CHARS) {
      throw Object.assign(new Error(`单条消息需为 1–${MAX_MESSAGE_CHARS} 个字符`), {
        status: 400,
        code: 'INVALID_MESSAGE_LENGTH'
      });
    }
    totalChars += trimmed.length;
    return { role, content: trimmed };
  });

  if (totalChars > MAX_TOTAL_CHARS) {
    throw Object.assign(new Error('对话内容过长，请新建对话后再试'), {
      status: 400,
      code: 'CONVERSATION_TOO_LONG'
    });
  }
  if (messages[messages.length - 1].role !== 'user') {
    throw Object.assign(new Error('最后一条消息必须来自用户'), {
      status: 400,
      code: 'LAST_MESSAGE_NOT_USER'
    });
  }
  return messages;
}

function getAiConfig() {
  const apiKey = String(process.env.AI_API_KEY || '').trim();
  const rawBaseUrl = String(process.env.AI_BASE_URL || '').trim();
  const model = String(process.env.AI_MODEL || '').trim();
  return {
    configured: Boolean(apiKey && rawBaseUrl && model),
    apiKey,
    model,
    endpoint: rawBaseUrl
      ? rawBaseUrl.endsWith('/chat/completions')
        ? rawBaseUrl
        : `${rawBaseUrl.replace(/\/+$/, '')}/chat/completions`
      : '',
    maxTokens: clampInteger(process.env.AI_MAX_TOKENS, 1200, 256, 4096)
  };
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function buildSystemPrompt(industry) {
  const industryLabels = {
    all: '餐饮与美容美发',
    food: '餐饮',
    beauty: '美容美发'
  };
  const context = buildResourceContext(industry, 12000);
  return [
    '你是“行业 AI 工具包”的专业经营助理。',
    `当前服务范围是：${industryLabels[industry]}。`,
    '你的回答要面向门店一线执行，优先给出判断依据、步骤、检查项和注意事项。',
    '下方是站内示例资料。引用时可使用「参考：《资料标题》」；不要编造站外资料、数据或法规条文。',
    '资料只作为管理参考。涉及食品安全、医疗健康、法律、预付资金、合同或个人信息时，应明确提示按所在地法规、正式规范和专业人员意见处理。',
    '美容美发场景不做医学诊断，不承诺治疗效果；餐饮场景不为降低食品安全要求提供建议。',
    '信息不足时先提出最多 3 个最关键的问题，不要自行补全顾客、门店或法规背景。',
    '回答默认使用简洁中文，可适量使用 Markdown 标题、列表和表格。',
    '',
    '【站内资料】',
    context
  ].join('\n');
}

async function requestChatCompletion({ messages, industry }) {
  const config = getAiConfig();
  if (!config.configured) {
    throw Object.assign(new Error('AI 服务尚未配置'), {
      status: 503,
      code: 'AI_NOT_CONFIGURED'
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35 * 1000);
  let upstream;
  try {
    upstream = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: buildSystemPrompt(industry) }, ...messages],
        temperature: 0.35,
        max_tokens: config.maxTokens
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error('AI 服务响应超时'), {
        status: 504,
        code: 'AI_TIMEOUT'
      });
    }
    throw Object.assign(new Error('无法连接 AI 服务'), {
      status: 502,
      code: 'AI_UPSTREAM_UNREACHABLE'
    });
  } finally {
    clearTimeout(timeout);
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch {
    throw Object.assign(new Error('AI 服务返回了无法解析的内容'), {
      status: 502,
      code: 'AI_INVALID_RESPONSE'
    });
  }

  if (!upstream.ok) {
    const upstreamMessage =
      payload && payload.error && typeof payload.error.message === 'string'
        ? payload.error.message.slice(0, 240)
        : '';
    throw Object.assign(new Error(upstreamMessage || 'AI 服务暂时不可用'), {
      status: upstream.status === 401 || upstream.status === 403 ? 502 : 502,
      code: upstream.status === 401 || upstream.status === 403 ? 'AI_AUTH_FAILED' : 'AI_UPSTREAM_ERROR'
    });
  }

  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : '';
  const text = Array.isArray(content)
    ? content
        .filter((part) => part && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
    : typeof content === 'string'
      ? content
      : '';

  if (!text.trim()) {
    throw Object.assign(new Error('AI 服务没有返回有效回复'), {
      status: 502,
      code: 'AI_EMPTY_RESPONSE'
    });
  }

  return {
    message: text.trim(),
    model: payload.model || config.model,
    usage: payload.usage || null
  };
}

async function handleChat(req, res) {
  const rate = checkRateLimit(getClientIp(req));
  if (!rate.allowed) {
    json(
      res,
      429,
      { error: '请求过于频繁，请稍后再试。', code: 'RATE_LIMITED' },
      { 'Retry-After': String(rate.retryAfter) }
    );
    return;
  }

  try {
    const body = await readJsonBody(req);
    const messages = validateMessages(body.messages);
    const industry = ['all', 'food', 'beauty'].includes(body.industry) ? body.industry : 'all';
    const result = await requestChatCompletion({ messages, industry });
    json(res, 200, result);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    const isInternal = status >= 500 && !error.code;
    json(
      res,
      status,
      {
        error: isInternal ? '服务暂时出现异常，请稍后再试。' : error.message || '请求失败',
        code: error.code || 'INTERNAL_ERROR'
      }
    );
  }
}

function serveStatic(req, res, pathname) {
  let relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  if (relative.includes('\0')) return sendNotFound(res);

  const filePath = path.resolve(PUBLIC_ROOT, relative);
  const publicPrefix = `${path.resolve(PUBLIC_ROOT)}${path.sep}`;
  if (filePath !== path.resolve(PUBLIC_ROOT, 'index.html') && !filePath.startsWith(publicPrefix)) {
    return sendNotFound(res);
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) return sendNotFound(res);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      ...securityHeaders(contentType),
      'Content-Length': stats.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function sendNotFound(res) {
  json(res, 404, { error: '页面不存在', code: 'NOT_FOUND' });
}

function createApp() {
  loadLocalEnv();
  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    const pathname = requestUrl.pathname;

    try {
      if (pathname === '/api/health' && req.method === 'GET') {
        json(res, 200, { status: 'ok', service: 'industry-ai-toolkit' });
        return;
      }

      if (pathname === '/api/status' && req.method === 'GET') {
        const config = getAiConfig();
        json(res, 200, {
          aiConfigured: config.configured,
          model: config.model,
          industries: industries.map(({ id, name }) => ({ id, name }))
        });
        return;
      }

      if (pathname === '/api/resources' && req.method === 'GET') {
        const industry = requestUrl.searchParams.get('industry') || 'all';
        if (!['all', 'food', 'beauty'].includes(industry)) {
          json(res, 400, { error: '行业参数无效', code: 'INVALID_INDUSTRY' });
          return;
        }
        json(res, 200, {
          industries,
          resources: getResources({ industry })
        });
        return;
      }

      if (pathname === '/api/chat' && req.method === 'POST') {
        await handleChat(req, res);
        return;
      }

      if (pathname.startsWith('/api/')) {
        json(res, 404, { error: 'API 不存在', code: 'API_NOT_FOUND' });
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { ...securityHeaders(), Allow: 'GET, HEAD' });
        res.end();
        return;
      }

      serveStatic(req, res, pathname);
    } catch (error) {
      console.error('[request-error]', error);
      if (!res.headersSent) {
        json(res, 500, { error: '服务暂时出现异常，请稍后再试。', code: 'INTERNAL_ERROR' });
      } else {
        res.end();
      }
    }
  });
}

if (require.main === module) {
  const app = createApp();
  const port = clampInteger(process.env.PORT, DEFAULT_PORT, 1, 65535);
  const host = process.env.HOST || '127.0.0.1';
  app.listen(port, host, () => {
    const config = getAiConfig();
    console.log(`行业 AI 工具包已启动：http://${host}:${port}`);
    console.log(
      config.configured
        ? `AI 对话已配置：${config.model}`
        : 'AI 对话未配置：请在 .env 中填写 AI_API_KEY'
    );
  });
}

module.exports = { createApp };
