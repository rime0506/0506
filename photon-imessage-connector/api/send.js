import {
  applyCors,
  handleOptions,
  normalizeAddress,
  normalizeSenderPhone,
  parseJsonBody,
  requireAccess,
  serializeError
} from '../lib/http.js';
import { sendPhotonText } from '../lib/photon.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  if (!requireAccess(req, res)) return;

  try {
    const body = parseJsonBody(req);
    const senderPhone = normalizeSenderPhone(body.senderPhone);
    const recipient = normalizeAddress(body.recipient);
    const text = String(body.text || '').trim();
    const clientMessageId = String(body.clientMessageId || '').trim().slice(0, 120);

    if (!senderPhone) return res.status(400).json({ success: false, code: 'INVALID_SENDER', error: '发送号码必须包含国际区号，例如 +12025550123' });
    if (!recipient) return res.status(400).json({ success: false, code: 'INVALID_RECIPIENT', error: '收件地址必须是国际格式手机号或 Apple ID 邮箱' });
    if (!text || text.length > 2000) return res.status(400).json({ success: false, code: 'INVALID_TEXT', error: '消息不能为空且不能超过 2000 个字符' });

    const result = await sendPhotonText({ senderPhone, recipient, text });
    return res.status(200).json({
      success: true,
      status: 'sent',
      clientMessageId: clientMessageId || null,
      ...result
    });
  } catch (error) {
    const parsed = serializeError(error);
    const status = Number(error && typeof error === 'object' && 'status' in error ? error.status : 0) || 502;
    return res.status(status).json({ success: false, ...parsed });
  }
}
