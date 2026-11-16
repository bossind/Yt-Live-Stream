# YouTube Live Automation Studio

Private, multi-Gmail allowlisted administrator YouTube live broadcast automation and studio management platform powered by **Firebase Authentication**, **Cloud Firestore**, **Firebase Admin SDK**, and **Google Drive OAuth 2.0** primary video storage.

---

## 1. Project Overview

- **Phase 1 (Project Foundation)**: Responsive studio UI, persistent dark/light theme, English/Hindi centralized i18n, Express REST API (`/api/v1`), Render Static Site + Web Service architecture.
- **Phase 2 (Firebase Multi-Gmail Allowlist Auth & Firestore Foundation)**:
  - **Firebase Authentication**: Google Sign-In (`GoogleAuthProvider`), Email/Password login, official Firebase password reset (`sendPasswordResetEmail`), and client persistence (`browserLocalPersistence` / `browserSessionPersistence`).
  - **Strict Multi-Gmail Admin Allowlist**: Public registration/signup is permanently disabled (`403` on `/api/v1/auth/register` and `/signup`). Protected backend routes verify Firebase ID tokens against a normalized server-side allowlist combining `ADMIN_EMAILS` / `FIREBASE_ADMIN_EMAIL` env vars and Firestore `admin_allowlist` documents, assigning trusted claims (`{ admin: true, role: "ADMIN" }`). The primary administrator cannot be removed, and unlisted Google accounts are rejected with `403 UNAUTHORIZED_ADMIN` and logged in `auth_security_events`.
  - **Cloud Firestore**: Structured collections (`admins`, `admin_allowlist`, `oauth_states`, `system_config`, `auth_security_events`, `storage_configs`, `storage_provider_secrets`, `storage_upload_sessions`, `storage_files`, `storage_activity_logs`) protected by hardened `firestore.rules`.
- **Phase 3 (Google Drive Primary Storage Integration — Active)**:
  - **Primary Provider — Google Drive (OAuth 2.0 + Drive API v3)**: Connect one or more Google Drive accounts independently of your studio admin login—no Cloudflare R2, Amazon S3, or paid storage account required. Optional S3/R2/GCS adapters remain modular extensions.
  - **AES-256-GCM Secret Vault**: Google Drive OAuth refresh/access tokens are encrypted server-side using `GOOGLE_OAUTH_ENCRYPTION_KEY` (falling back to `STORAGE_ENCRYPTION_KEY`), stored in locked server-only Firestore documents (`storage_provider_secrets`), and never returned to the browser. Tokens refresh automatically, and `invalid_grant` transitions the Drive account cleanly to `REVOKED` with one-click reconnect.
  - **Direct-to-Drive Resumable Uploads**: Large video files upload directly from the browser to Google Drive's `resumableSessionUri` in 256-KiB-aligned chunks (`HTTP 308` offset confirmation, `200`/`201` completion) with real-time speed/ETA telemetry, pause/resume (including cross-reload offset probing), cancel (`DELETE` session URI), retry, Manual vs Auto account selection, strict per-account quota checks (never combined into a fake unified total), `files.get` completion verification, verified Drive deletion, and a Phase 4 `DriveStreamPrepService` (`StudioMediaReader`) byte-range interface.
- **Future Phases (Locked)**: YouTube OAuth & channels, Video Library media processing, FFmpeg RTMP/RTMPS live streaming & history (Phase 4), scheduling & Telegram notifications (Phase 5).

---

## 2. Technology Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, React Router v7, Lucide React, Firebase Web SDK (`firebase`)
- **Backend**: Node.js, TypeScript, Express.js, Helmet, CORS, Express-Rate-Limit, Zod, Firebase Admin SDK (`firebase-admin`), `google-auth-library`
- **Database**: Cloud Firestore (Native mode)
- **Deployment Target**: Render Static Site (Frontend) + Render Web Service (Backend)

---

## 3. Firebase Console Setup Instructions

> **Note**: In AI Studio preview environments, a Firebase project (`stable-environs-ftn3v`), Web App config (`firebase-applet-config.json`), and named Firestore database (`ai-studio-youtubeliveautom-4bb31c20-1296-4a64-8c96-284398a3673d`) were provisioned automatically alongside deployed `firestore.rules`. For standalone production or manual verification, follow these steps in [Firebase Console](https://console.firebase.google.com/):

1. **Create / Open Firebase Project**: Select your provisioned project (`stable-environs-ftn3v`) or create a new Firebase project.
2. **Register a Web App**: Go to **Project Settings → General → Your apps → Web** (`</>`) to obtain `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, and `appId`.
3. **Enable Authentication Providers** (**Authentication → Sign-in method**):
   - Enable **Email/Password**.
   - Enable **Google** sign-in and set a Project support email.
4. **Configure Authorized Domains** (**Authentication → Settings → Authorized domains**):
   Add every domain where administrators will sign in:
   - `localhost` (enabled by default)
   - Your Render Static Site domain (e.g., `your-studio-frontend.onrender.com`)
   - Your AI Studio dev and shared domains
5. **Verify Cloud Firestore**: Ensure Cloud Firestore is enabled in Native mode (`(default)` or your configured named database ID).
6. **Deploy Security Rules**: Ensure `firestore.rules` from this repository is deployed (`firebase deploy --only firestore:rules` locally).
7. **Generate Firebase Admin Service Account Key** (**Project Settings → Service Accounts → Generate new private key**):
   - Download the JSON key file safely (NEVER commit it to git).
   - Minify it into a single-line JSON string for `FIREBASE_SERVICE_ACCOUNT_JSON` (or split into `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`).

---

## 4. Authorized Multi-Gmail Admin Setup

This application **never** auto-promotes arbitrary sign-ins. Every website login email must appear in either `ADMIN_EMAILS` / `FIREBASE_ADMIN_EMAIL` or Firestore `admin_allowlist`:

1. Set `FIREBASE_ADMIN_EMAIL` (primary owner) and optionally `ADMIN_EMAILS="primary@gmail.com,secondary@gmail.com"` in `.env` or Render environment variables.
2. Run the trusted CLI initializer for first-time setup or adding an admin from CLI:
   ```bash
   ADMIN_INITIAL_PASSWORD="YourStrongPassword123" npm run admin:setup -- --email="ritikrai2625@gmail.com"
   # Or authorize an additional Gmail admin:
   npm run admin:setup -- --email="co.admin@gmail.com" --add
   ```
3. Once signed in, the Settings page (**Settings → Authorized Gmail Administrators**) lets you add or revoke additional Gmail accounts at runtime. Revoking clears admin custom claims and revokes refresh tokens while preventing accidental removal of the primary owner.

---

## 5. Google Cloud Console Setup (Google Drive OAuth 2.0)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select your project.
2. Enable **Google Drive API** under **APIs & Services → Library**.
3. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen**) in the left navigation.
4. Configure **Branding / App Information**: enter the application name (`YouTube Live Automation Studio`), user support email, and developer contact email.
5. Configure **Audience / User Type**: select **External** (or Internal for Google Workspace organizations).
6. Verify **Data Access / Scopes** (minimal least-privilege):
   - `https://www.googleapis.com/auth/drive.file` — *Access only to files and the `YouTube Live Automation Studio` folder created by this application. Keeps personal Drive files private and avoids Google's restricted `drive` verification.*
   - `https://www.googleapis.com/auth/userinfo.email` — *Identifies which Google account is connected so quotas and files stay separated per Gmail.*
7. Open **Clients → Create Client** (or **APIs & Services → Credentials → Create Credentials → OAuth client ID**) and choose **Web application**.
8. Add **Authorized JavaScript origins**:
   - Local development: `http://localhost:3000`
   - AI Studio Dev Preview: `https://ais-dev-jc4f6qgjtxwyzbgfef6nro-444517033714.asia-southeast1.run.app`
   - AI Studio Shared App: `https://ais-pre-jc4f6qgjtxwyzbgfef6nro-444517033714.asia-southeast1.run.app`
   - Render Backend Web Service: `https://<your-backend-service>.onrender.com`
   - Render Frontend Static Site (if separate): `https://<your-frontend-site>.onrender.com`
9. Add **Authorized redirect URIs** (exact match required — production MUST use `https://`):
   - Local development: `http://localhost:3000/api/v1/storage/google-drive/oauth/callback`
   - AI Studio Dev Preview: `https://ais-dev-jc4f6qgjtxwyzbgfef6nro-444517033714.asia-southeast1.run.app/api/v1/storage/google-drive/oauth/callback`
   - AI Studio Shared App: `https://ais-pre-jc4f6qgjtxwyzbgfef6nro-444517033714.asia-southeast1.run.app/api/v1/storage/google-drive/oauth/callback`
   - Render Backend Web Service: `https://<your-backend-service>.onrender.com/api/v1/storage/google-drive/oauth/callback`
10. Configure **Test Users** while in **Testing** publishing status (**Audience → Test users**):
    - **Max 100 Test Users**: Add every Gmail address you intend to connect as a Drive storage account.
    - **7-Day Refresh Token Expiry**: Google OAuth Testing apps expire refresh tokens after 7 days. When expired, the Studio automatically marks that Drive account as `REVOKED` and provides a one-click **Reconnect Google Drive** button. Publish the app (Production status) when ready for long-lived refresh tokens.
11. Copy the generated **Client ID** (`...apps.googleusercontent.com`) and **Client Secret**, add them to your backend environment variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_DRIVE_CALLBACK_URL`), and restart/redeploy the backend service. Never place `GOOGLE_CLIENT_SECRET` in frontend `VITE_*` variables.

### Phase 4 Streaming & Google Drive Quota Caveats
- Google Drive accounts enforce shared storage quotas across **Drive, Gmail, and Google Photos**; actual free space varies per account (never assumed to be 15 GB).
- Google Drive imposes daily per-file/per-account download bandwidth limits (`downloadQuotaExceeded` / `rateLimitExceeded`). `DriveStreamPrepService` (`StudioMediaReader`) provides byte-range streaming for upcoming Phase 4 FFmpeg/RTMP pipelines and surfaces clear quota-limit diagnostics if Drive throttles playback.

---

## 6. Environment Variables

Never expose Firebase Admin SDK credentials, `GOOGLE_CLIENT_SECRET`, or encryption keys in `VITE_*` frontend variables.

### Backend Server Variables (Express / Render Web Service)
| Variable | Required | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | Yes | `development` or `production` |
| `PORT` | Yes | HTTP port (`3000` locally; injected automatically by Render) |
| `SERVE_STATIC` | Optional | `true` for single-origin mode; `false` on standalone Render Web Service |
| `APP_BASE_URL` | Recommended | Public backend URL (`https://<your-backend>.onrender.com`) used to derive OAuth callbacks |
| `CORS_ORIGINS` | Yes (prod) | Comma-separated allowed frontend origins (e.g. `https://<your-frontend>.onrender.com`) |
| `FIREBASE_PROJECT_ID` | Yes | Firebase Project ID |
| `FIREBASE_DATABASE_ID` | Optional | Firestore database ID (`(default)` or named database ID) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Yes (outside GCP) | Single-line Firebase Admin Service Account JSON |
| `FIREBASE_CLIENT_EMAIL` | Alternative | Alternative to JSON if paired with `FIREBASE_PRIVATE_KEY` |
| `FIREBASE_PRIVATE_KEY` | Alternative | Service account private key (with `\n` newlines preserved/escaped) |
| `FIREBASE_ADMIN_EMAIL` | Yes | Primary owner administrator email (cannot be removed via UI) |
| `ADMIN_EMAILS` | Optional | Comma-separated list of pre-authorized administrator Gmail addresses |
| `FIREBASE_ADMIN_UID` | Optional | Optional extra server-side allowlisted admin UID check |
| `GOOGLE_CLIENT_ID` | Yes (Drive) | Google Cloud OAuth 2.0 Web Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes (Drive) | Google Cloud OAuth 2.0 Web Client Secret |
| `GOOGLE_DRIVE_CALLBACK_URL` | Recommended | Explicit OAuth redirect URI (`https://<backend>/api/v1/storage/google-drive/oauth/callback`) |
| `GOOGLE_OAUTH_ENCRYPTION_KEY` | Yes (prod) | 64-char hex or base64 32-byte key for AES-256-GCM encryption of OAuth tokens (`openssl rand -hex 32`) |
| `STORAGE_ENCRYPTION_KEY` | Optional | Encryption key fallback / optional S3/R2 secret vaulting key |

### Frontend Build-Time Variables (Vite / Render Static Site)
| Variable | Required | Description |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Yes (Static Site) | Render Web Service API base URL (e.g. `https://<your-backend>.onrender.com`; empty `""` if same origin) |
| `VITE_FIREBASE_API_KEY` | Yes (Static Site) | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Yes (Static Site) | Firebase Auth domain (`<project>.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | Yes (Static Site) | Firebase Project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Optional | Firebase Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Optional | Firebase Cloud Messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Yes (Static Site) | Firebase Web App ID |
| `VITE_FIREBASE_DATABASE_ID` | Optional | Firestore database ID (`(default)` or named database ID) |

---

## 7. Local Development & Validation Commands

```bash
npm install
npm run dev           # Run Express + Vite dev server on port 3000
npm run lint          # TypeScript check across client & server
npm run lint:rules    # Validate firestore.rules against Firebase security rules linter
npm run build         # Build client (`dist/`) and backend (`dist-server/`)
npm run start         # Run compiled production server (`node dist-server/server.js`)
```

---

## 8. Render Deployment Instructions (Split Architecture)

### A. Backend (`Render Web Service`)
- **Build Command**: `npm install && npm run build:server`
- **Start Command**: `npm run start`
- **Health Check Path**: `/api/health`
- **Environment Variables** (**Render Dashboard → Web Service → Environment**):
  - `NODE_ENV=production`
  - `SERVE_STATIC=false`
  - `APP_BASE_URL=https://<your-backend-service>.onrender.com` *(must use `https://` in production)*
  - `CORS_ORIGINS=https://<your-frontend-site>.onrender.com`
  - `FIREBASE_PROJECT_ID=<your-firebase-project-id>`
  - `FIREBASE_DATABASE_ID=(default)` *(or your named Firestore database ID)*
  - `FIREBASE_SERVICE_ACCOUNT_JSON=<minified-service-account-json>`
  - `FIREBASE_ADMIN_EMAIL=<your-primary-admin-email>`
  - `ADMIN_EMAILS=<comma-separated-admin-emails>`
  - `GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com`
  - `GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>` *(backend-only — NEVER put in Static Site `VITE_*`)*
  - `GOOGLE_DRIVE_CALLBACK_URL=https://<your-backend-service>.onrender.com/api/v1/storage/google-drive/oauth/callback`
  - `GOOGLE_OAUTH_ENCRYPTION_KEY=<64-char-hex-32-byte-secret>` *(generate with `openssl rand -hex 32`)*
- **Redeploy Requirement**: After adding or updating `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_CALLBACK_URL`, or `APP_BASE_URL` on Render, trigger a manual redeploy (or wait for auto-redeploy to finish) so the Node server loads the updated environment.

### B. Frontend (`Render Static Site`)
- **Build Command**: `npm install && npm run build:client`
- **Publish Directory**: `dist`
- **Rewrite Rule**: `/*` -> `/index.html` (`Rewrite`)
- **Environment Variables**:
  - `VITE_API_BASE_URL=https://<your-backend-service>.onrender.com`
  - `VITE_FIREBASE_API_KEY=<web-api-key>`
  - `VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com`
  - `VITE_FIREBASE_PROJECT_ID=<project-id>`
  - `VITE_FIREBASE_STORAGE_BUCKET=<project-id>.firebasestorage.app`
  - `VITE_FIREBASE_MESSAGING_SENDER_ID=<sender-id>`
  - `VITE_FIREBASE_APP_ID=<app-id>`
  - `VITE_FIREBASE_DATABASE_ID=(default)` *(or your named Firestore database ID)*

### C. Optional Secondary Storage (R2 / S3 / GCS)
If you optionally add Cloudflare R2, Amazon S3, or Google Cloud Storage buckets in the **Optional Extension** tab of the Connect dialog, configure bucket CORS to allow your exact frontend origin and expose the `ETag` response header (use the **Optional R2/S3 CORS Guide** tab inside `/storage`).
