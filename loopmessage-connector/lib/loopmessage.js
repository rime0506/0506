const API_BASE = 'https://a.loopmessage.com/api/v1';
const REQUEST_TIMEOUT_MS = 25000;

function getApiKey() {
  const apiKey = String(process.env.LOOPMESSAGE_API_KEY || '').trim();
  if (!apiKey) {
    throw Object.assign(new Error('缺少 LOOPMESSAGE_API_KEY'), {
      code: 'LOOPMESSAGE_NOT_CONFIGURED',
      status: 503
    });
  }
  return apiKey;
}

async function requestLoopMessage(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Authorization': getApiKey(),
        'Accept': 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok || payload?.success === false) {
      const detail = payload?.message || payload?.error || payload?.detail || `LoopMessage HTTP ${response.status}`;
      throw Object.assign(new Error(String(detail)), {
        code: payload?.code || 'LOOPMESSAGE_API_ERROR',
        status: response.status
      });
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error('LoopMessage 响应超时'), { code: 'LOOPMESSAGE_TIMEOUT', status: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function testLoopMessageCredentials() {
  const payload = await requestLoopMessage('/sender/list/?page=1&per_page=1', { method: 'GET' });
  const senders = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.senders) ? payload.senders : []);
  return { senderCount: Number(payload?.total ?? payload?.count ?? senders.length) || 0 };
}

export async function sendLoopMessageText({ senderId, recipient, text, clientMessageId }) {
  const body = {
    contact: recipient,
    text
  };
  if (senderId) body.sender = senderId;
  if (clientMessageId) body.passthrough = clientMessageId;

  const payload = await requestLoopMessage('/message/send/', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return {
    messageId: data?.message_id || data?.messageId || data?.id || null,
    conversationId: data?.conversation_id || data?.conversationId || null,
    status: data?.status || 'accepted',
    senderId: senderId || data?.sender || null
  };
}
