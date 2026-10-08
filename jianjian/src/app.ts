import Fastify, { type FastifyInstance } from 'fastify';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { inviteRoutes } from './routes/invites.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { profileRoutes } from './routes/profile.js';
import { recommendationRoutes } from './routes/recommendations.js';
import { settingsRoutes } from './routes/settings.js';
import { shareRoutes } from './routes/share.js';
import { videoRoutes } from './routes/video.js';
import { settleMatchingLifecycle } from './matching-lifecycle.js';

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });
  app.addHook('preHandler', async req => {
    const path = req.url.split('?')[0];
    if (path.startsWith('/api/recommendations/') || path.startsWith('/api/video/') ||
        path.startsWith('/v/') || path.startsWith('/s/rec/') || path.startsWith('/s/video/')) {
      await settleMatchingLifecycle();
    }
  });

  app.get('/health', async () => ({ ok: true, version: '0.1.0' }));

  await app.register(authRoutes);
  await app.register(settingsRoutes);
  await app.register(chatRoutes);
  await app.register(profileRoutes);
  await app.register(onboardingRoutes);
  await app.register(inviteRoutes);
  await app.register(recommendationRoutes);
  await app.register(shareRoutes);
  await app.register(videoRoutes);
  return app;
}
