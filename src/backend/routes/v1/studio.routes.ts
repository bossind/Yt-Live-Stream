import { Router } from 'express';
import { AppError } from '../../errors/AppError';
import { requireFirebaseAdmin } from '../../middleware/authGuard';

function createModuleStubRouter(moduleName: string, targetPhase: string): Router {
  const router = Router();
  router.use(requireFirebaseAdmin);
  router.all('*', (_req, _res, next) => {
    next(
      new AppError(
        `${moduleName} API module is scheduled for ${targetPhase}.`,
        501,
        'MODULE_PENDING_FUTURE_PHASE'
      )
    );
  });
  return router;
}

export const channelsRouter = createModuleStubRouter('YouTube Channels', 'Phase 4+');
export const videosRouter = createModuleStubRouter('Video Library', 'Phase 4');
export const streamsRouter = createModuleStubRouter('Live Studio & Streaming History', 'Phase 4+');
export const automationRouter = createModuleStubRouter('Automation & Schedule', 'Phase 5');
export const notificationsRouter = createModuleStubRouter('Notifications', 'Phase 5');
export const settingsRouter = createModuleStubRouter('Studio Integrations Settings', 'Phase 4+');
