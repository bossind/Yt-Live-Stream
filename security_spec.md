# Firestore Security Specification

## Data Invariants
1. Default-deny catch-all (`/{document=**}`) blocks all unauthenticated and unauthorized reads/writes.
2. Only a verified administrator (`request.auth != null && request.auth.token.email_verified == true && exists(/databases/$(database)/documents/admins/$(request.auth.uid)) && get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.active == true`) can read studio collections.
3. `/admins/{adminUid}` and `/auth_security_events/{eventId}` are strictly read-only for the verified admin (zero client writes; managed exclusively by trusted Firebase Admin SDK).
4. All client-writable studio collections (`system_config`, `studio_channels`, `media_assets`, `storage_configs`, `stream_sessions`, `automation_schedules`) validate document IDs (`^[a-zA-Z0-9_\-]+$`, max 128 chars), strict key allowlists (`hasAll`/`hasOnly`), string length bounds, `ownerUid == request.auth.uid`, immutable `createdAt`, and server timestamps (`request.time`).
5. No passwords, OAuth secrets, or private keys are ever stored in Firestore.

## Adversarial Payloads Verified Against Rules
1. Unauthenticated read on `/admins/uid1` -> `PERMISSION_DENIED`
2. Unauthenticated write on `/system_config/settings` -> `PERMISSION_DENIED`
3. Signed-in non-admin user read on `/system_config/settings` -> `PERMISSION_DENIED`
4. Signed-in user with `email_verified: false` -> `PERMISSION_DENIED`
5. Self-promotion write to `/admins/{request.auth.uid}` -> `PERMISSION_DENIED`
6. Client write to `/auth_security_events/{id}` -> `PERMISSION_DENIED`
7. Shadow field injection (`extraAdminFlag: true`) on `/system_config/{id}` -> `PERMISSION_DENIED`
8. Spoofed `ownerUid` different from `request.auth.uid` -> `PERMISSION_DENIED`
9. Oversized document ID (>128 chars) or invalid characters -> `PERMISSION_DENIED`
10. Client-forged `createdAt` or `updatedAt != request.time` -> `PERMISSION_DENIED`
11. Modifying immutable `createdAt` or `ownerUid` on update -> `PERMISSION_DENIED`
12. Terminal state mutation on `stream_sessions` after `status == 'ENDED'` -> `PERMISSION_DENIED`
