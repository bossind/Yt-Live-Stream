import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { attachFinalErrorHandler, createBackendApp } from './src/backend/app';
import { env } from './src/backend/config/env';
import { getFirebaseAdminState } from './src/backend/firebase/admin';

async function startServer(): Promise<void> {
  const app = createBackendApp();

  if (!env.isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (env.serveStatic) {
    const distDir = path.resolve(process.cwd(), 'dist');
    const indexHtmlPath = path.join(distDir, 'index.html');
    if (fs.existsSync(distDir) && fs.existsSync(indexHtmlPath)) {
      app.use(express.static(distDir));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) {
          return next();
        }
        res.sendFile(indexHtmlPath);
      });
    }
  }

  attachFinalErrorHandler(app);

  const adminState = getFirebaseAdminState();

  const server = app.listen(env.port, '0.0.0.0', () => {
    console.info(
      `[Server] YouTube Live Automation Studio (${env.nodeEnv}) listening on http://0.0.0.0:${env.port}`
    );
    if (!adminState.configured) {
      console.warn(
        `[Firebase] Admin SDK missing configuration: ${adminState.missingConfigKeys.join(', ')}`
      );
    } else if (!adminState.hasFullAdminCredentials) {
      console.warn(
        '[Firebase] Running with Project ID only (set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY for full Firestore Admin SDK access).'
      );
    }
  });

  const shutdown = (signal: string): void => {
    console.info(`[Server] Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
