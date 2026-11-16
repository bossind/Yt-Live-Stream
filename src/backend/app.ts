import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { AppError } from './errors/AppError';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRateLimiter } from './middleware/rateLimiters';
import { requestLogger } from './middleware/requestLogger';
import { apiRouter } from './routes';

export function createBackendApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Allow Firebase Auth / Firestore / Google Sign-In scripts, iframes, and API requests when SERVE_STATIC=true
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    })
  );

  app.use(
    cors((req, callback) => {
      const originHeader = req.headers.origin;
      const origin = typeof originHeader === 'string' ? originHeader.replace(/\/+$/, '') : '';

      if (!origin) {
        return callback(null, { origin: false });
      }

      const forwardedHost =
        typeof req.headers['x-forwarded-host'] === 'string'
          ? req.headers['x-forwarded-host'].split(',')[0].trim()
          : req.headers.host;
      const rawProto =
        typeof req.headers['x-forwarded-proto'] === 'string'
          ? req.headers['x-forwarded-proto'].split(',')[0].trim().toLowerCase()
          : req.protocol;
      const hostOnly = forwardedHost ? forwardedHost.split(':')[0].toLowerCase() : '';
      const isLocal = hostOnly === 'localhost' || hostOnly === '127.0.0.1' || hostOnly === '::1';
      const effectiveProto = !forwardedHost || isLocal ? rawProto : 'https';
      const sameOrigin = forwardedHost ? `${effectiveProto}://${forwardedHost}` : '';

      const isAllowed =
        env.corsOrigins.includes(origin) || (sameOrigin.length > 0 && origin === sameOrigin);

      if (isAllowed) {
        return callback(null, {
          origin: true,
          credentials: false,
          methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-Firebase-Auth'],
        });
      }

      return callback(
        new AppError('Origin not allowed by CORS policy.', 403, 'CORS_ORIGIN_FORBIDDEN')
      );
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(requestLogger);
  app.use('/api', apiRateLimiter);

  app.use('/api', apiRouter);
  app.use('/api/*', notFoundHandler);

  return app;
}

export function attachFinalErrorHandler(app: Express): void {
  app.use(errorHandler);
}
