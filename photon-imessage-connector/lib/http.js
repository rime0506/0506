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
  const expected = process.env.CONNECTOR_ACCESS_KEY;
  if (!expected) {
    res.status(503).json({ success: false, code: 'CONNECTOR_NOT_CONFIGURED', error: '连接器尚未设置访问密钥' });
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
  return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
}

export function normalizeAddress(value) {
  const address = String(value || '').trim();
  if (/^\+[1-9]\d{6,14}$/.test(address)) return address;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return address.toLowerCase();
  return '';
}

export function normalizeSenderPhone(value) {
  const phone = String(value || '').trim();
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : '';
}

export function serializeError(error) {
  const raw = String(error?.message || error || '未知错误');
  const lower = raw.toLowerCase();
  let code = error?.code || 'PHOTON_SEND_FAILED';
  let message = 'Photon 发送失败，请检查项目、号码和收件地址';

  if (code === 'PHOTON_NOT_CONFIGURED' || lower.includes('缺少 spectrum')) {
    message = '连接器缺少 Photon Project ID 或 Project Secret';
  } else if (lower.includes('auth') || lower.includes('credential') || lower.includes('token')) {
    code = 'PHOTON_AUTH_FAILED';
    message = 'Photon 项目凭据无效或已过期';
  } else if (lower.includes('quota') || lower.includes('rate')) {
    code = 'PHOTON_RATE_LIMITED';
    message = 'Photon 发送频率或额度已达到限制';
  } else if (lower.includes('phone') || lower.includes('line')) {
    code = 'PHOTON_LINE_UNAVAILABLE';
    message = '该 Photon 发送号码不可用或不属于当前项目';
  } else if (lower.includes('address') || lower.includes('recipient') || lower.includes('user')) {
    code = 'RECIPIENT_UNAVAILABLE';
    message = '收件手机号或 Apple ID 邮箱不可用';
  }

  return { code, message, detail: raw.slice(0, 300) };
}
