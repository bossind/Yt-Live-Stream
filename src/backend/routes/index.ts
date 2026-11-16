import { Router } from 'express';
import { healthRouter } from './health.routes';
import { v1Router } from './v1';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/v1', v1Router);
