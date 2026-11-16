import crypto from 'node:crypto';
import { env } from '../config/env';

export interface ProviderCredentialsPayload {
  // Google Drive OAuth 2.0 tokens
  refreshToken?: string;
  accessToken?: string;
  expiryDateMs?: number | null;
  tokenType?: string;
  scope?: string;

  // Optional S3 / R2 / GCS provider credentials (secondary providers)
  accessKeyId?: string;
  secretAccessKey?: string;
  serviceAccountJson?: string;
}

export interface EncryptedSecretBlob {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

const KEY_VERSION = 1;

function resolveEncryptionKeyBytes(): Buffer {
  const configured = env.googleOAuthEncryptionKey || env.storageEncryptionKey;

  if (!configured) {
    if (env.isProduction) {
      throw new Error(
        'GOOGLE_OAUTH_ENCRYPTION_KEY (or STORAGE_ENCRYPTION_KEY) must be set in production to encrypt/decrypt OAuth tokens and storage secrets.'
      );
    }
    return crypto
      .createHash('sha256')
      .update(`ylas-dev-vault:${env.firebaseProjectId || 'local'}:${process.cwd()}`)
      .digest();
  }

  if (/^[0-9a-fA-F]{64}$/.test(configured)) {
    return Buffer.from(configured, 'hex');
  }

  return crypto.createHash('sha256').update(configured, 'utf8').digest();
}

export function encryptProviderCredentials(
  credentials: ProviderCredentialsPayload
): EncryptedSecretBlob {
  const key = resolveEncryptionKeyBytes();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(credentials);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyVersion: KEY_VERSION,
  };
}

export function decryptProviderCredentials(blob: EncryptedSecretBlob): ProviderCredentialsPayload {
  const key = resolveEncryptionKeyBytes();
  const iv = Buffer.from(blob.iv, 'base64');
  const authTag = Buffer.from(blob.authTag, 'base64');
  const ciphertext = Buffer.from(blob.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted) as ProviderCredentialsPayload;
}

export function maskAccessKeyPreview(rawValue: string | undefined): string {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) {
    return 'OAuth 2.0 Token';
  }
  if (trimmed.length <= 6) {
    return '••••••';
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}
