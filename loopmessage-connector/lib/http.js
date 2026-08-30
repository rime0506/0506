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
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return address.toLowerCase();
  const compactPhone = address.replace(/[\s\-().]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(compactPhone)) return compactPhone;
  if (/^[1-9]\d{6,14}$/.test(compactPhone)) return `+${compactPhone}`;
  return '';
}

export function serializeError(error) {
  const detail = String(error?.message || error || '未知错误').slice(0, 300);
  const lower = detail.toLowerCase();
  let code = String(error?.code || 'LOOPMESSAGE_REQUEST_FAILED');
  const parsedProviderCode = Number.parseInt(code, 10);
  const providerCode = Number.isFinite(parsedProviderCode) ? parsedProviderCode : null;
  let message = 'LoopMessage 请求失败，请检查账号、Sender 和接收者';

  const providerMessages = {
    100: 'LoopMessage 拒绝了请求，请检查填写内容',
    110: 'LoopMessage 请求缺少 API 凭据',
    115: 'LoopMessage 请求中有无效参数',
    120: 'LoopMessage 请求缺少必要参数',
    125: 'LoopMessage 请求参数格式不正确',
    130: 'LoopMessage Organization API Key 无效或不存在',
    140: '发送内容不能为空',
    150: '没有填写接收者',
    160: 'LoopMessage 无法识别这个接收者',
    170: '接收者邮箱格式无效，或不是可用的 iMessage 地址',
    180: '接收者手机号格式无效',
    190: '接收者号码不是可用的手机号码',
    200: 'Sandbox 没有与这个接收者建立有效会话：请让该接收者先给 Sandbox 发一条 iMessage，并在 24 小时内重试',
    210: 'LoopMessage 无法为这个接收者找到可用 Sender：Sandbox 请先由接收者发起会话；专用模式请检查 Sender ID',
    220: '填写的 LoopMessage Sender ID 无效',
    230: 'LoopMessage 暂时无法使用这个 Sender，请稍后重试',
    240: '这个 LoopMessage Sender 尚未激活或未付款',
    250: '这个 LoopMessage Sender 已被暂停',
    260: 'LoopMessage 账号没有可用的已购 Sender',
    270: '这次发送需要专用 Sender，Sandbox 或共享 Sender 不支持',
    300: 'LoopMessage 账号已暂停',
    310: 'LoopMessage 账号已被封禁',
    320: 'LoopMessage 账号中的手机号尚未验证',
    330: 'LoopMessage 账号因欠费被暂停',
    340: '接收者已阻止此类消息',
    500: '接收者已经退订消息',
    510: '最近没有与这个接收者的有效会话，请让接收者先发一条消息',
    520: '接收者必须先向当前 Sender 发起会话，之后才能给他发送消息',
    530: '当前 Sender 无法主动向这个接收者开启新会话',
    540: '给长期未联系接收者的发送频率已达到限制，请稍后再试',
    550: 'LoopMessage 套餐发送额度已用完',
    1000: 'LoopMessage 发送服务发生内部错误，请稍后重试',
    1010: 'LoopMessage 本次发送失败，请稍后重试',
    1020: '目标 iMessage 服务返回未送达，请稍后重试',
    1030: '目标 iMessage 服务没有返回送达确认'
  };

  if (code === 'LOOPMESSAGE_NOT_CONFIGURED') {
    message = '连接器缺少 LOOPMESSAGE_API_KEY';
  } else if (providerCode !== null && providerMessages[providerCode]) {
    code = `LOOPMESSAGE_${providerCode}`;
    message = providerMessages[providerCode];
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

  return { code, providerCode, message, error: providerCode ? `${message}（错误码 ${providerCode}）` : message, detail };
}
