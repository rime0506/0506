const MAX_BODY_BYTES = 16 * 1024;

export function applyCors(req, res) {
  const configured = String(process.env.ALLOWED_ORIGIN || '*')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const origin = String(req.headers.origin || '');
  const allowOrigin = configured.includes('*')
    ? '*'
    : (configured.includes(origin) ? origin : configured[0] || 'null');

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}

export function handleOptions(req, res) {
  applyCors(req, res);
  if (req.method !== 'OPTIONS') return false;
  res.status(204).end();
  return true;
}

export function requireAccess(req, res) {
  const expected = String(process.env.CONNECTOR_ACCESS_KEY || '');
  if (!expected) {
    res.status(503).json({ success: false, code: 'CONNECTOR_NOT_CONFIGURED', error: '连接器尚未设置 CONNECTOR_ACCESS_KEY' });
    return false;
  }
  const authorization = String(req.headers.authorization || '');
  if (authorization !== `Bearer ${expected}`) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', error: '连接器访问密钥不正确' });
    return false;
  }
  return true;
}

export function parseJsonBody(req) {
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw Object.assign(new Error('请求内容过大'), { code: 'BODY_TOO_LARGE', status: 413 });
  }
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch (_) {
    throw Object.assign(new Error('请求内容不是有效的 JSON'), { code: 'INVALID_JSON', status: 400 });
  }
}

export function normalizeAddress(value) {
  const address = String(value || '').trim();
  if (/^\+[1-9]\d{6,14}$/.test(address)) return address;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return address.toLowerCase();
  return '';
}

export function serializeError(error) {
  const detail = String(error?.message || error || '未知错误').slice(0, 300);
  const lower = detail.toLowerCase();
  let code = String(error?.code || 'LOOPMESSAGE_REQUEST_FAILED');
  let message = 'LoopMessage 请求失败，请检查账号、Sender 和接收者';

  if (code === 'LOOPMESSAGE_NOT_CONFIGURED') {
    message = '连接器缺少 LOOPMESSAGE_API_KEY';
  } else if (error?.status === 401 || error?.status === 403 || lower.includes('unauthorized') || lower.includes('api key')) {
    code = 'LOOPMESSAGE_AUTH_FAILED';
    message = 'LoopMessage Organization API Key 无效或没有权限';
  } else if (error?.status === 429 || lower.includes('rate') || lower.includes('quota')) {
    code = 'LOOPMESSAGE_RATE_LIMITED';
    message = 'LoopMessage 发送频率或额度已达到限制';
  } else if (lower.includes('sender')) {
    code = 'LOOPMESSAGE_SENDER_UNAVAILABLE';
    message = 'LoopMessage Sender ID 不可用，或当前会话不允许发送';
  } else if (lower.includes('contact') || lower.includes('recipient')) {
    code = 'RECIPIENT_UNAVAILABLE';
    message = '接收者不可用，Sandbox/共享模式可能需要用户先发起会话';
  }

  return { code, message, detail };
}
