import { applyCors, handleOptions, normalizeAddress, parseJsonBody, requireWebhookAccess } from '../lib/http.js';
import { enqueueInboundEvent } from '../lib/queue.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  applyCors(req, res);
  if (req.method !== 'POST') return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', error: '只支持 POST' });
  if (!requireWebhookAccess(req, res)) return;

  try {
    const body = parseJsonBody(req);
    if (body.event !== 'message_inbound') {
      return res.status(200).json({ success: true, ignored: true, event: body.event || 'unknown' });
    }
    const webhookId = String(body.webhook_id || '').trim();
    const messageId = String(body.message_id || '').trim();
    const contact = normalizeAddress(body.contact);
    if (!webhookId || !messageId || !contact) {
      return res.status(400).json({ success: false, code: 'INVALID_WEBHOOK', error: '入站 Webhook 缺少 webhook_id、message_id 或有效 contact' });
    }

    const event = {
      webhookId,
      messageId,
      event: 'message_inbound',
      contact,
      text: String(body.text || '').slice(0, 10000),
      messageType: String(body.message_type || 'text').toLowerCase(),
      sender: String(body.sender || '').trim(),
      channel: String(body.channel || 'imessage').toLowerCase(),
      attachments: Array.isArray(body.attachments) ? body.attachments.slice(0, 10).map(value => String(value).slice(0, 512)) : [],
      receivedAt: Date.now()
    };
    const queued = await enqueueInboundEvent(event);
    return res.status(200).json({ success: true, received: true, duplicate: !queued, webhookId });
  } catch (error) {
    return res.status(error?.status >= 400 ? error.status : 503).json({
      success: false,
      code: error?.code || 'WEBHOOK_QUEUE_FAILED',
      error: String(error?.message || 'Webhook 暂时无法入队').slice(0, 300)
    });
  }
}
