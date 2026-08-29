import { Spectrum } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';

export function assertPhotonConfigured() {
  if (!process.env.SPECTRUM_PROJECT_ID || !process.env.SPECTRUM_PROJECT_SECRET) {
    throw Object.assign(new Error('缺少 Spectrum Cloud 项目凭据'), { code: 'PHOTON_NOT_CONFIGURED' });
  }
}

export async function withPhoton(run) {
  assertPhotonConfigured();
  const projectId = String(process.env.SPECTRUM_PROJECT_ID);
  const projectSecret = String(process.env.SPECTRUM_PROJECT_SECRET);
  const app = await Spectrum({
    projectId,
    projectSecret,
    providers: [imessage.config()],
    telemetry: false
  });

  try {
    return await run(app, imessage(app));
  } finally {
    try { await app.stop(); } catch (_) {}
  }
}

export async function sendPhotonText({ senderPhone, recipient, text }) {
  return await withPhoton(async (_app, platform) => {
    const user = await platform.user(recipient);
    const options = senderPhone ? { phone: senderPhone } : undefined;
    const space = await platform.space.create(user, options);
    const message = await space.send(text);

    return {
      spaceId: space?.id || null,
      messageId: message?.id || message?.message?.id || null,
      senderPhone: senderPhone || space?.phone || null
    };
  });
}
