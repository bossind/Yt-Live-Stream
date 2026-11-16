import { Router } from 'express';
import { authRouter } from './auth.routes';
import { storageRouter } from './storage.routes';
import {
  automationRouter,
  channelsRouter,
  notificationsRouter,
  settingsRouter,
  streamsRouter,
  videosRouter,
} from './studio.routes';
import { systemRouter } from './system.routes';

export const v1Router = Router();

v1Router.use('/system', systemRouter);
v1Router.use('/auth', authRouter);
v1Router.use('/storage', storageRouter);

// Protected future-phase modules
v1Router.use('/channels', channelsRouter);
v1Router.use('/videos', videosRouter);
v1Router.use('/streams', streamsRouter);
v1Router.use('/automation', automationRouter);
v1Router.use('/notifications', notificationsRouter);
v1Router.use('/settings', settingsRouter);
