import rateLimit from 'express-rate-limit';
import { FirestoreModel } from '../models/firestore.model';

export const authVerifyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    void FirestoreModel.recordSecurityEvent({
      eventType: 'AUTH_REJECTED',
      ipAddress: req.ip ?? null,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 255) : null,
      reason: 'rate_limited',
    });

    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authentication verification requests. Please wait 15 minutes and try again.',
      },
      timestamp: new Date().toISOString(),
    });
  },
});

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please slow down and try again shortly.',
      },
      timestamp: new Date().toISOString(),
    });
  },
});

export const storageMutationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many storage configuration or deletion requests. Please wait before retrying.',
      },
      timestamp: new Date().toISOString(),
    });
  },
});

export const storageUploadUrlsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Upload part signing rate limit reached. Upload concurrency will retry automatically.',
      },
      timestamp: new Date().toISOString(),
    });
  },
});
