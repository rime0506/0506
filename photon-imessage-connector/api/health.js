import { applyCors, handleOptions, requireAccess, serializeError } from '../lib/http.js';
import { withPhoton } from '../lib/photon.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  if (!requireAccess(req, res)) return;

  try {
    await withPhoton(async () => true);
    return res.status(200).json({ success: true, photonConnected: true, version: '1.0.0' });
  } catch (error) {
    const parsed = serializeError(error);
    return res.status(502).json({ success: false, photonConnected: false, ...parsed });
  }
}
